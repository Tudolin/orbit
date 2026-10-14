import { db, getSetting } from './db';
import { DEFAULT_MODEL, type Effort } from './config';

/** Capturas com requisição em andamento nesta aba (o que estiver "processando" fora daqui travou). */
const inFlight = new Map<string, AbortController>();
export const isInFlight = (id: string) => inFlight.has(id);

/** O app foi atualizado com a aba aberta: os arquivos antigos da engine sumiram do servidor. */
let needsReload = false;
export const appNeedsReload = () => needsReload;

/** Envia uma captura da Inbox para a engine e guarda o resultado para revisão. */
export async function runCapture(id: string): Promise<void> {
  if (needsReload) return location.reload();
  if (inFlight.has(id)) return;
  const capture = await db.captures.get(id);
  if (!capture) return;
  const apiKey = await getSetting('anthropicKey');
  if (!apiKey) {
    await db.captures.update(id, { status: 'erro', erro: 'Configure sua ANTHROPIC_API_KEY em Config para processar.' });
    return;
  }
  const ctrl = new AbortController();
  inFlight.set(id, ctrl);
  await db.captures.update(id, { status: 'processando', erro: undefined });
  let engine: typeof import('./engine');
  try {
    // SDK + zod carregados sob demanda: o app abre rápido no celular.
    engine = await import('./engine');
  } catch {
    needsReload = true;
    inFlight.delete(id);
    await db.captures.update(id, { status: 'erro', erro: 'O app foi atualizado enquanto estava aberto. Toque em "Recarregar e processar".' });
    return;
  }
  try {
    const workspaces = (await db.workspaces.orderBy('ordem').toArray()).map((w) => w.nome);
    const resultado = await engine.processCapture({
      apiKey,
      model: (await getSetting('model')) || DEFAULT_MODEL,
      effort: ((await getSetting('effort')) || 'medium') as Effort,
      texto: capture.texto,
      imagens: capture.imagens,
      viaAudio: capture.viaAudio,
      workspaces,
      signal: ctrl.signal,
    });
    await db.captures.update(id, { status: 'revisao', resultado });
  } catch (e) {
    const erro = ctrl.signal.aborted ? 'Cancelado. Toque em Tentar de novo quando quiser.' : engine.describeError(e);
    await db.captures.update(id, { status: 'erro', erro });
  } finally {
    inFlight.delete(id);
  }
}

export function cancelCapture(id: string): void {
  const ctrl = inFlight.get(id);
  if (ctrl) ctrl.abort();
  else void db.captures.update(id, { status: 'erro', erro: 'O processamento foi interrompido. Toque em Tentar de novo.' });
}

/** Retoma capturas que ficaram "processando" quando o app foi fechado. */
export async function resumeStuck(): Promise<void> {
  const stuck = await db.captures.where('status').equals('processando').toArray();
  if (!stuck.length) return;
  await Promise.all(stuck.map((c) => db.captures.update(c.id, { status: 'pendente' })));
  if ((await getSetting('autoProcess')) !== 'off') stuck.forEach((c) => void runCapture(c.id));
}
