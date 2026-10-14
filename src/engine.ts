import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { CaptureImage } from './db';
import type { Effort } from './config';

export const SYSTEM_PROMPT = `Você é a engine de processamento de dados e extração estruturada do aplicativo 'NEXUS / Segundo Cérebro'. Sua função é receber capturas multimídia (fotos de quadros Jira, prints de calendários, conversas de Teams/e-mail, transcrições de áudio ou notas rápidas) e devolver um JSON estritamente formatado com as informações extraídas e categorizadas.

REGRAS DE PROCESSAMENTO:
1. Extraia com precisão (OCR/Visão) dados de fotos e prints de telas de computadores.
2. Identifique e isole:
   - Título e contexto da tarefa ou evento.
   - Prazos (due dates) e horários.
   - Prioridade (Alta, Média, Baixa).
   - Workspace de destino (identificado ou sugerido com base no contexto).
   - Ponto de decisão/resumo do Segundo Cérebro para memória futura.
3. Ignore vícios de linguagem em áudios e resuma os pontos com verbos no infinitivo.

FORMATO DE RESPOSTA OBRIGATÓRIO (JSON APENAS):
{
  "workspace_sugerido": "string",
  "tags": ["string"],
  "agenda_eventos": [
    {
      "titulo": "string",
      "data_inicio": "ISO_STRING",
      "data_fim": "ISO_STRING",
      "origem": "outlook|teams|jira|foto|audio"
    }
  ],
  "tarefas": [
    {
      "descricao": "string",
      "prazo": "ISO_STRING ou null",
      "prioridade": "alta|media|baixa",
      "origem": "jira|teams|foto|audio"
    }
  ],
  "segundo_cerebro_contexto": {
    "resumo": "string",
    "decisoes_tomadas": ["string"],
    "participantes": ["string"]
  }
}`;

// "texto" foi acrescentado às origens para notas digitadas, que não se encaixam nas demais.
const EngineSchema = z.object({
  workspace_sugerido: z.string(),
  tags: z.array(z.string()),
  agenda_eventos: z.array(
    z.object({
      titulo: z.string(),
      data_inicio: z.string(),
      data_fim: z.string().nullable(),
      origem: z.enum(['outlook', 'teams', 'jira', 'foto', 'audio', 'texto']),
    }),
  ),
  tarefas: z.array(
    z.object({
      descricao: z.string(),
      prazo: z.string().nullable(),
      prioridade: z.enum(['alta', 'media', 'baixa']),
      origem: z.enum(['jira', 'teams', 'foto', 'audio', 'texto']),
      recorrencia: z.enum(['nenhuma', 'diaria', 'semanal', 'mensal']),
    }),
  ),
  segundo_cerebro_contexto: z.object({
    resumo: z.string(),
    decisoes_tomadas: z.array(z.string()),
    participantes: z.array(z.string()),
  }),
});

export type EngineResult = z.infer<typeof EngineSchema>;

export interface EngineInput {
  apiKey: string;
  model: string;
  effort: Effort;
  texto: string;
  imagens: CaptureImage[];
  viaAudio: boolean;
  workspaces: string[];
  signal?: AbortSignal;
}

function contextBlock(input: EngineInput): string {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const offset = `${sign}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
  const hoje = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  return [
    `CONTEXTO DO DISPOSITIVO:`,
    `- Agora: ${hoje}, ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} (fuso ${tz}, UTC${offset}).`,
    `- Resolva datas relativas ("amanhã", "sexta") a partir de hoje e escreva todas as datas ISO 8601 com o offset ${offset}.`,
    `- Prazo sem horário: use 18:00 do dia. Evento sem fim explícito: data_fim = null.`,
    `- Tarefa que se repete ("todo dia 9", "toda segunda", "diariamente"): preencha recorrencia (mensal/semanal/diaria) e use como prazo a PRÓXIMA ocorrência. Senão, recorrencia = "nenhuma".`,
    `- Workspaces existentes: ${input.workspaces.map((w) => `"${w}"`).join(', ') || '(nenhum)'}. Em workspace_sugerido, use exatamente um desses nomes quando o contexto permitir; senão sugira um nome curto novo.`,
    `- Tags no padrão #workspace, #origem/x, #prio/x, #status/x (sem espaços).`,
    `- Origem da captura: ${input.imagens.length ? 'imagem/print' : input.viaAudio ? 'transcrição de áudio (use origem "audio")' : 'texto digitado (use origem "texto" se nenhuma outra se aplicar)'}.`,
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
      text: `${contextBlock(input)}\n\nCAPTURA:\n${input.texto.trim() || '(somente imagem — extraia tudo da imagem)'}`,
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
  if (!response.parsed_output) throw new Error('A engine não devolveu um JSON válido.');
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
