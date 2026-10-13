import { db, getSetting } from './db';
import { DEFAULT_MODEL, type Effort } from './config';

/** Envia uma captura da Inbox para a engine e guarda o resultado para revisão. */
export async function runCapture(id: string): Promise<void> {
  const capture = await db.captures.get(id);
  if (!capture) return;
  const apiKey = await getSetting('anthropicKey');
  if (!apiKey) {
    await db.captures.update(id, { status: 'erro', erro: 'Configure sua ANTHROPIC_API_KEY em Config para processar.' });
    return;
  }
  await db.captures.update(id, { status: 'processando', erro: undefined });
  // SDK + zod carregados sob demanda: o app abre rápido no celular.
  const { describeError, processCapture } = await import('./engine');
  try {
    const workspaces = (await db.workspaces.orderBy('ordem').toArray()).map((w) => w.nome);
    const resultado = await processCapture({
      apiKey,
      model: (await getSetting('model')) || DEFAULT_MODEL,
      effort: ((await getSetting('effort')) || 'medium') as Effort,
      texto: capture.texto,
      imagens: capture.imagens,
      viaAudio: capture.viaAudio,
      workspaces,
    });
    await db.captures.update(id, { status: 'revisao', resultado });
  } catch (e) {
    await db.captures.update(id, { status: 'erro', erro: describeError(e) });
  }
}

/** Retoma capturas que ficaram "processando" quando o app foi fechado. */
export async function resumeStuck(): Promise<void> {
  const stuck = await db.captures.where('status').equals('processando').toArray();
  await Promise.all(stuck.map((c) => db.captures.update(c.id, { status: 'pendente' })));
}
