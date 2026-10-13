import Dexie, { type EntityTable } from 'dexie';
import type { EngineResult } from './engine';

export type Prioridade = 'alta' | 'media' | 'baixa';
export type TaskStatus = 'pendente' | 'em-andamento' | 'concluido';
export type CaptureStatus = 'pendente' | 'processando' | 'revisao' | 'triado' | 'erro';

export interface Workspace {
  id: string;
  nome: string;
  ordem: number;
  createdAt: number;
}

export interface CaptureImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  data: string; // base64 sem prefixo data:
}

export interface Capture {
  id: string;
  texto: string;
  imagens: CaptureImage[];
  viaAudio: boolean;
  status: CaptureStatus;
  erro?: string;
  resultado?: EngineResult;
  createdAt: number;
}

export interface AgendaEvent {
  id: string;
  workspaceId: string;
  titulo: string;
  inicio: string; // ISO
  fim: string | null;
  origem: string;
  tags: string[];
  captureId?: string;
  createdAt: number;
}

export interface Task {
  id: string;
  workspaceId: string;
  descricao: string;
  prazo: string | null;
  prioridade: Prioridade;
  status: TaskStatus;
  origem: string;
  tags: string[];
  captureId?: string;
  createdAt: number;
}

export interface Note {
  id: string;
  workspaceId: string;
  resumo: string;
  decisoes: string[];
  participantes: string[];
  tags: string[];
  captureId?: string;
  createdAt: number;
}

export interface Setting {
  key: string;
  value: string;
}

export const db = new Dexie('nexus') as Dexie & {
  workspaces: EntityTable<Workspace, 'id'>;
  captures: EntityTable<Capture, 'id'>;
  events: EntityTable<AgendaEvent, 'id'>;
  tasks: EntityTable<Task, 'id'>;
  notes: EntityTable<Note, 'id'>;
  settings: EntityTable<Setting, 'key'>;
};

db.version(1).stores({
  workspaces: 'id, ordem',
  captures: 'id, status, createdAt',
  events: 'id, workspaceId, inicio',
  tasks: 'id, workspaceId, status, prazo, prioridade',
  notes: 'id, workspaceId, createdAt',
  settings: 'key',
});

db.on('populate', (tx) => {
  const now = Date.now();
  tx.table('workspaces').bulkAdd([
    { id: uid(), nome: 'Empresa A', ordem: 0, createdAt: now },
    { id: uid(), nome: 'Empresa B', ordem: 1, createdAt: now },
    { id: uid(), nome: 'Empresa C', ordem: 2, createdAt: now },
    { id: uid(), nome: 'Pessoal', ordem: 3, createdAt: now },
  ]);
});

export function uid(): string {
  return crypto.randomUUID();
}

export async function getSetting(key: string): Promise<string> {
  return (await db.settings.get(key))?.value ?? '';
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}

export async function deleteWorkspace(id: string): Promise<void> {
  await db.transaction('rw', [db.workspaces, db.events, db.tasks, db.notes], async () => {
    await db.events.where('workspaceId').equals(id).delete();
    await db.tasks.where('workspaceId').equals(id).delete();
    await db.notes.where('workspaceId').equals(id).delete();
    await db.workspaces.delete(id);
  });
}

export async function moveWorkspace(id: string, delta: -1 | 1): Promise<void> {
  const list = await db.workspaces.orderBy('ordem').toArray();
  const i = list.findIndex((w) => w.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await db.transaction('rw', db.workspaces, async () => {
    await Promise.all(list.map((w, ordem) => db.workspaces.update(w.id, { ordem })));
  });
}

/** Distribui o resultado de uma captura no workspace escolhido. */
export async function commitCapture(capture: Capture, workspaceId: string, r: EngineResult): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', [db.events, db.tasks, db.notes, db.captures], async () => {
    await db.events.bulkAdd(
      r.agenda_eventos.map((e) => ({
        id: uid(),
        workspaceId,
        titulo: e.titulo,
        inicio: e.data_inicio,
        fim: e.data_fim,
        origem: e.origem,
        tags: r.tags,
        captureId: capture.id,
        createdAt: now,
      })),
    );
    await db.tasks.bulkAdd(
      r.tarefas.map((t) => ({
        id: uid(),
        workspaceId,
        descricao: t.descricao,
        prazo: t.prazo,
        prioridade: t.prioridade,
        status: 'pendente' as const,
        origem: t.origem,
        tags: r.tags,
        captureId: capture.id,
        createdAt: now,
      })),
    );
    const ctx = r.segundo_cerebro_contexto;
    if (ctx.resumo.trim() || ctx.decisoes_tomadas.length) {
      await db.notes.add({
        id: uid(),
        workspaceId,
        resumo: ctx.resumo,
        decisoes: ctx.decisoes_tomadas,
        participantes: ctx.participantes,
        tags: r.tags,
        captureId: capture.id,
        createdAt: now,
      });
    }
    await db.captures.update(capture.id, { status: 'triado', resultado: r });
  });
}

export async function exportAll(): Promise<string> {
  const [workspaces, captures, events, tasks, notes] = await Promise.all([
    db.workspaces.toArray(),
    db.captures.toArray(),
    db.events.toArray(),
    db.tasks.toArray(),
    db.notes.toArray(),
  ]);
  return JSON.stringify({ app: 'nexus', version: 1, exportedAt: new Date().toISOString(), workspaces, captures, events, tasks, notes });
}

export async function importAll(json: string): Promise<void> {
  const data = JSON.parse(json);
  if (data?.app !== 'nexus') throw new Error('Arquivo não é um backup do NEXUS.');
  await db.transaction('rw', [db.workspaces, db.captures, db.events, db.tasks, db.notes], async () => {
    await db.workspaces.bulkPut(data.workspaces ?? []);
    await db.captures.bulkPut(data.captures ?? []);
    await db.events.bulkPut(data.events ?? []);
    await db.tasks.bulkPut(data.tasks ?? []);
    await db.notes.bulkPut(data.notes ?? []);
  });
}
