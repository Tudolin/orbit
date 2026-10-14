import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { CaptureImage } from './db';
import type { Effort } from './config';

export const SYSTEM_PROMPT = `Você processa capturas rápidas de um sistema de segundo cérebro (NEXUS). Recebe um conteúdo bruto (texto, transcrição de áudio ou imagem/print de Jira, Teams, Outlook, e-mail) e devolve somente o JSON do schema, sem texto antes ou depois.

O bloco CONTEXTO da mensagem traz a data e hora da captura, a origem e os workspaces disponíveis com suas palavras-chave. Use exatamente esses nomes de workspace.

### Regras de extração de tarefas

1. Cada ação distinta vira uma tarefa separada. Uma frase com várias frentes ("finalizar onboarding da Radix e da Cadastra") gera uma tarefa por frente.
2. Cada tarefa pertence a exatamente um workspace, atribuído individualmente. Nunca copie para todas as tarefas o workspace da primeira menção.
3. Para atribuir o workspace de uma tarefa, siga esta ordem:
   a. menção explícita ao nome ou a uma palavra-chave do workspace dentro da própria tarefa;
   b. contexto imediato da frase em que a tarefa aparece;
   c. se ainda houver dúvida, use null e marque workspace_incerto: true. Não chute.
4. Título da tarefa: verbo no infinitivo, curto, autoexplicativo fora do contexto da captura.
5. Prioridade: alta | media | baixa. Se não for dita, use media e marque prioridade_inferida: true.
6. Prazo, sempre relativo à data e hora da captura:
   - "hoje" → mesmo dia, 18:00
   - "amanhã" → dia seguinte, 18:00
   - "essa semana" / "até o fim da semana" → sexta-feira da semana corrente, 18:00
   - "semana que vem" → sexta-feira da semana seguinte, 18:00
   - dia da semana citado ("quinta") → próxima ocorrência, 18:00
   - data explícita → essa data, 18:00 se não houver horário
   - nenhuma referência → null
   Quando o prazo for interpretado a partir de uma expressão vaga, marque prazo_inferido: true.
   Escreva prazos em ISO 8601 com o fuso informado no CONTEXTO.
7. Recorrência: tarefa que se repete ("todo dia 9", "toda segunda", "diariamente") recebe recorrencia mensal | semanal | diaria e, como prazo, a PRÓXIMA ocorrência. Caso contrário, recorrencia: "nenhuma".

### Eventos de agenda

8. Reuniões e compromissos com data/hora (prints de Outlook/Teams, convites) vão em agenda_eventos, com o mesmo critério de workspace das tarefas (regras 2 e 3). data_fim = null se não houver horário de término.

### Regras da nota

9. workspace_principal:
   - se todas as tarefas com workspace definido forem do mesmo workspace, use esse nome;
   - se houver dois ou mais workspaces diferentes, use "multi";
   - se não houver tarefas, atribua pelo assunto geral da captura, ou null se não for possível.
10. titulo: até 80 caracteres, fiel ao que foi dito, com ortografia corrigida.
11. tags: uma tag por workspace envolvido (#radix, #cadastra…), mais #origem/<origem>, #prio/<maior prioridade entre as tarefas> e #status/pendente.
12. resumo: de 1 a 3 frases em português correto. Registre explicitamente qualquer inferência feita (prazo, prioridade, workspace incerto).
13. decisoes_tomadas e participantes: decisões e pessoas citadas (listas vazias se não houver).
14. sugerir_divisao: true somente se workspace_principal for "multi"; caso contrário, false.
15. Em áudios, ignore vícios de linguagem e repetições da transcrição.

### Exemplo

Captura de quarta, 14/10/2026, 11:58 (-03:00), origem audio: "finalizar onboarding radix e cadastra essa semana"

{"titulo":"Finalizar onboarding da Radix e da Cadastra essa semana","workspace_principal":"multi","tags":["#radix","#cadastra","#origem/audio","#prio/media","#status/pendente"],"resumo":"Finalizar os onboardings da Radix e da Cadastra até sexta-feira, 16/10/2026, às 18:00 (prazo interpretado a partir de 'essa semana'). Prioridade não informada, assumida como média.","decisoes_tomadas":[],"participantes":[],"sugerir_divisao":true,"agenda_eventos":[],"tarefas":[{"titulo":"Finalizar onboarding da Radix","workspace":"Radix","workspace_incerto":false,"prioridade":"media","prioridade_inferida":true,"prazo":"2026-10-16T18:00:00-03:00","prazo_inferido":true,"recorrencia":"nenhuma"},{"titulo":"Finalizar onboarding da Cadastra","workspace":"Cadastra","workspace_incerto":false,"prioridade":"media","prioridade_inferida":true,"prazo":"2026-10-16T18:00:00-03:00","prazo_inferido":true,"recorrencia":"nenhuma"}]}`;

const EngineSchema = z.object({
  titulo: z.string(),
  workspace_principal: z.string().nullable(),
  tags: z.array(z.string()),
  resumo: z.string(),
  decisoes_tomadas: z.array(z.string()),
  participantes: z.array(z.string()),
  sugerir_divisao: z.boolean(),
  tarefas: z.array(
    z.object({
      titulo: z.string(),
      workspace: z.string().nullable(),
      workspace_incerto: z.boolean(),
      prioridade: z.enum(['alta', 'media', 'baixa']),
      prioridade_inferida: z.boolean(),
      prazo: z.string().nullable(),
      prazo_inferido: z.boolean(),
      recorrencia: z.enum(['nenhuma', 'diaria', 'semanal', 'mensal']),
    }),
  ),
  agenda_eventos: z.array(
    z.object({
      titulo: z.string(),
      data_inicio: z.string(),
      data_fim: z.string().nullable(),
      workspace: z.string().nullable(),
      workspace_incerto: z.boolean(),
    }),
  ),
});

export type EngineResult = z.infer<typeof EngineSchema>;

export class InvalidOutputError extends Error {}
export type Origem = 'audio' | 'texto' | 'imagem';

export interface EngineInput {
  apiKey: string;
  model: string;
  effort: Effort;
  texto: string;
  imagens: CaptureImage[];
  origem: Origem;
  /** Momento da captura (não do processamento): "amanhã" é relativo a quando você falou. */
  capturadaEm: number;
  /** "Nome: palavra1, palavra2" por workspace. */
  workspaces: { nome: string; palavrasChave: string[] }[];
  signal?: AbortSignal;
}

function isoWithOffset(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(ms + off * 60_000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? '+' : '-'}${p(off / 60)}:${p(off % 60)}`;
}

function contextBlock(input: EngineInput): string {
  const d = new Date(input.capturadaEm);
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'long' });
  const ws = input.workspaces.map((w) => `- ${w.nome}${w.palavrasChave.length ? `: ${w.palavrasChave.join(', ')}` : ''}`).join('\n');
  return [
    'CONTEXTO',
    `- Data e hora da captura: ${isoWithOffset(input.capturadaEm)} (${dia}; fuso ${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
    `- Origem: ${input.origem}`,
    '- Workspaces disponíveis (nome: palavras-chave):',
    ws || '(nenhum)',
  ].join('\n');
}

export async function processCapture(input: EngineInput): Promise<EngineResult> {
  // Sem isso o SDK espera até 10 min (com novas tentativas) numa rede travada.
  const client = new Anthropic({ apiKey: input.apiKey, dangerouslyAllowBrowser: true, timeout: 90_000, maxRetries: 1 });

  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...input.imagens.map(
      (img): Anthropic.Beta.BetaImageBlockParam => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.data },
      }),
    ),
    {
      type: 'text',
      text: `${contextBlock(input)}\n\nCONTEÚDO:\n${input.texto.trim() || '(somente imagem — extraia tudo da imagem)'}`,
    },
  ];

  // Fallback server-side em recusas falso-positivas; Haiku não tem fallback.
  const fallback = input.model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };

  const response = await client.beta.messages.parse({
    model: input.model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { effort: input.effort, format: betaZodOutputFormat(EngineSchema) },
    messages: [{ role: 'user', content }],
    ...fallback,
  }, { signal: input.signal });

  if (response.stop_reason === 'refusal') {
    throw new Error(`A engine recusou a captura${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'}`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Resposta cortada por limite de tokens. Divida a captura em partes menores.');
  }
  if (!response.parsed_output) throw new InvalidOutputError('A engine não devolveu um JSON válido.');
  return response.parsed_output;
}

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Chave da API inválida. Verifique em Config.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Chave sem permissão para este modelo.';
  if (e instanceof Anthropic.RateLimitError) return 'Limite de requisições atingido. Tente de novo em instantes.';
  if (e instanceof Anthropic.BadRequestError) return `Requisição rejeitada: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'A API demorou demais para responder (rede lenta ou VPN?). Tente de novo.';
  if (e instanceof Anthropic.APIConnectionError) return 'Sem conexão com a API. A captura ficou salva na Inbox.';
  if (e instanceof Anthropic.APIError) return `Erro da API (${e.status ?? '?'}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
