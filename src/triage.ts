import type { AgendaEvent, Note, Prioridade, Recorrencia, Task, Workspace } from './db';
import type { EngineResult, Origem } from './engine';

/**
 * Triagem: transforma a resposta da engine num rascunho editável, valida workspaces,
 * recalcula o workspace principal no código (sem confiar na IA) e monta os registros finais.
 */

export interface DraftTask {
  key: string;
  titulo: string;
  workspaceId: string | null;
  incerto: boolean;
  prioridade: Prioridade;
  prioridadeInferida: boolean;
  prazo: string | null;
  prazoInferido: boolean;
  recorrencia?: Recorrencia;
  incluir: boolean;
}

export interface DraftEvent {
  key: string;
  titulo: string;
  inicio: string;
  fim: string | null;
  workspaceId: string | null;
  incerto: boolean;
  incluir: boolean;
}

export interface Draft {
  titulo: string;
  resumo: string;
  decisoes: string[];
  participantes: string[];
  /** Tags sem as de workspace (essas são recalculadas por item). */
  tagsBase: string[];
  origem: Origem;
  tasks: DraftTask[];
  events: DraftEvent[];
  /** Workspace da nota quando não há tarefas com workspace (vem da IA ou da escolha do usuário). */
  noteWorkspaceId: string | null;
  incluirNota: boolean;
  dividir: boolean;
}

/** Resultado no formato da versão anterior da engine (capturas antigas ainda em revisão). */
interface LegacyResult {
  workspace_sugerido: string;
  tags: string[];
  agenda_eventos: { titulo: string; data_inicio: string; data_fim: string | null }[];
  tarefas: { descricao: string; prazo: string | null; prioridade: Prioridade; recorrencia?: string }[];
  segundo_cerebro_contexto: { resumo: string; decisoes_tomadas: string[]; participantes: string[] };
}
export type StoredResult = EngineResult | LegacyResult;

export const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, '-');

const wsTag = (w: Workspace) => `#${slug(w.nome)}`;

/** Nome devolvido pela IA → id. Nome desconhecido vira null (regra 2 do backend). */
export function resolveWorkspace(nome: string | null, workspaces: Workspace[]): string | null {
  if (!nome || nome === 'multi') return null;
  return workspaces.find((w) => slug(w.nome) === slug(nome))?.id ?? null;
}

function upgradeLegacy(r: LegacyResult): EngineResult {
  const ctx = r.segundo_cerebro_contexto;
  return {
    titulo: ctx.resumo.slice(0, 80),
    workspace_principal: r.workspace_sugerido || null,
    tags: r.tags,
    resumo: ctx.resumo,
    decisoes_tomadas: ctx.decisoes_tomadas,
    participantes: ctx.participantes,
    sugerir_divisao: false,
    tarefas: r.tarefas.map((t) => ({
      titulo: t.descricao,
      workspace: r.workspace_sugerido || null,
      workspace_incerto: false,
      prioridade: t.prioridade,
      prioridade_inferida: false,
      prazo: t.prazo,
      prazo_inferido: false,
      recorrencia: (t.recorrencia as EngineResult['tarefas'][number]['recorrencia']) ?? 'nenhuma',
    })),
    agenda_eventos: r.agenda_eventos.map((e) => ({ ...e, workspace: r.workspace_sugerido || null, workspace_incerto: false })),
  };
}

export function captureTitle(r: StoredResult | undefined): string {
  if (!r) return '';
  return 'titulo' in r ? r.titulo : r.segundo_cerebro_contexto.resumo;
}

export function toDraft(stored: StoredResult, workspaces: Workspace[], origem: Origem): Draft {
  const r = 'workspace_sugerido' in stored ? upgradeLegacy(stored) : stored;
  const allWsTags = new Set(workspaces.map(wsTag));
  const resolve = (nome: string | null, incerto: boolean) => {
    const id = resolveWorkspace(nome, workspaces);
    // Nome fora da lista cadastrada → null + incerto.
    return { workspaceId: id, incerto: incerto || !id };
  };
  return {
    titulo: r.titulo,
    resumo: r.resumo,
    decisoes: r.decisoes_tomadas,
    participantes: r.participantes,
    // #prio, #origem e #status são recalculados pelo app; tags de workspace vêm de cada item.
    tagsBase: r.tags.filter((t) => !allWsTags.has(t.toLowerCase()) && !/^#(prio|origem|status)\//.test(t)),
    origem,
    tasks: r.tarefas.map((t, i) => ({
      key: `t${i}`,
      titulo: t.titulo,
      ...resolve(t.workspace, t.workspace_incerto),
      prioridade: t.prioridade,
      prioridadeInferida: t.prioridade_inferida,
      prazo: t.prazo,
      prazoInferido: t.prazo_inferido,
      recorrencia: t.recorrencia === 'nenhuma' || !t.prazo ? undefined : t.recorrencia,
      incluir: true,
    })),
    events: r.agenda_eventos.map((e, i) => ({
      key: `e${i}`,
      titulo: e.titulo,
      inicio: e.data_inicio,
      fim: e.data_fim,
      ...resolve(e.workspace, e.workspace_incerto),
      incluir: true,
    })),
    noteWorkspaceId: resolveWorkspace(r.workspace_principal, workspaces),
    incluirNota: !!(r.resumo.trim() || r.decisoes_tomadas.length),
    dividir: false,
  };
}

/** Passo 3 do backend: principal recalculado a partir das tarefas incluídas. */
export function principalOf(d: Draft): { principal: string | 'multi' | null; ids: string[] } {
  const ids = [...new Set(d.tasks.filter((t) => t.incluir && t.workspaceId).map((t) => t.workspaceId!))];
  if (ids.length === 1) return { principal: ids[0], ids };
  if (ids.length > 1) return { principal: 'multi', ids };
  return { principal: d.noteWorkspaceId, ids: d.noteWorkspaceId ? [d.noteWorkspaceId] : [] };
}

export const sugerirDivisao = (d: Draft) => principalOf(d).principal === 'multi';

/** O que impede aprovar: itens incluídos sem workspace e nota sem destino. */
export function blockers(d: Draft): string[] {
  const out: string[] = [];
  const t = d.tasks.filter((x) => x.incluir && !x.workspaceId).length;
  const e = d.events.filter((x) => x.incluir && !x.workspaceId).length;
  if (t) out.push(`${t} tarefa(s) sem workspace`);
  if (e) out.push(`${e} evento(s) sem workspace`);
  if (d.incluirNota && !principalOf(d).principal) out.push('nota sem workspace');
  return out;
}

export interface Built {
  tasks: Task[];
  events: AgendaEvent[];
  notes: Note[];
}

/** Monta os registros finais. Cada tarefa/evento leva o próprio workspace (não herdado da nota). */
export function buildRecords(d: Draft, captureId: string, workspaces: Workspace[], uid: () => string, now = Date.now()): Built {
  const byId = new Map(workspaces.map((w) => [w.id, w]));
  const tagOf = (id: string) => (byId.has(id) ? wsTag(byId.get(id)!) : '');
  const origemTag = `#origem/${d.origem}`;
  const rank: Record<Prioridade, number> = { alta: 0, media: 1, baixa: 2 };

  const tasks: Task[] = d.tasks
    .filter((t) => t.incluir && t.workspaceId)
    .map((t) => ({
      id: uid(),
      workspaceId: t.workspaceId!,
      descricao: t.titulo,
      prazo: t.prazo,
      prioridade: t.prioridade,
      status: 'pendente',
      origem: d.origem,
      recorrencia: t.prazo ? t.recorrencia : undefined,
      tags: [tagOf(t.workspaceId!), origemTag, `#prio/${t.prioridade}`, '#status/pendente'],
      captureId,
      createdAt: now,
    }));

  const events: AgendaEvent[] = d.events
    .filter((e) => e.incluir && e.workspaceId)
    .map((e) => ({
      id: uid(),
      workspaceId: e.workspaceId!,
      titulo: e.titulo,
      inicio: e.inicio,
      fim: e.fim,
      origem: d.origem,
      tags: [tagOf(e.workspaceId!), origemTag],
      captureId,
      createdAt: now,
    }));

  const notes: Note[] = [];
  const { principal, ids } = principalOf(d);
  if (d.incluirNota && principal) {
    const prioFor = (wsIds: string[]) => {
      const ps = tasks.filter((t) => wsIds.includes(t.workspaceId)).map((t) => t.prioridade);
      return ps.length ? `#prio/${ps.sort((a, b) => rank[a] - rank[b])[0]}` : null;
    };
    const tagsFor = (wsIds: string[], extra: string[] = []) =>
      [...wsIds.map(tagOf), ...d.tagsBase, origemTag, prioFor(wsIds), ...(extra.length ? extra : ['#status/pendente'])].filter((x): x is string => !!x);
    const base = { resumo: d.resumo, decisoes: d.decisoes, participantes: d.participantes, captureId, createdAt: now };

    if (principal !== 'multi') {
      notes.push({ id: uid(), workspaceId: principal, titulo: d.titulo, tags: tagsFor([principal]), ...base });
    } else if (d.dividir) {
      for (const id of ids) {
        notes.push({ id: uid(), workspaceId: id, titulo: `${d.titulo} — ${byId.get(id)?.nome ?? ''}`, tags: tagsFor([id]), ...base });
      }
      // Original arquivada, com referência à mesma captura.
      notes.push({ id: uid(), workspaceId: '', workspaceIds: ids, titulo: d.titulo, arquivada: true, tags: tagsFor(ids, ['#status/dividida']), ...base });
    } else {
      notes.push({ id: uid(), workspaceId: '', workspaceIds: ids, titulo: d.titulo, tags: tagsFor(ids), ...base });
    }
  }
  return { tasks, events, notes };
}

/** Nota simples sem tarefas, usada quando a engine falha duas vezes em devolver JSON válido. */
export function fallbackResult(texto: string): EngineResult {
  return {
    titulo: texto.trim().slice(0, 80) || 'Captura',
    workspace_principal: null,
    tags: ['#status/pendente'],
    resumo: texto.trim(),
    decisoes_tomadas: [],
    participantes: [],
    sugerir_divisao: false,
    tarefas: [],
    agenda_eventos: [],
  };
}
