import Dexie, { type EntityTable, type Transaction } from 'dexie';
import type { Built, StoredResult } from './triage';

export type Prioridade = 'alta' | 'media' | 'baixa';
export type TaskStatus = 'pendente' | 'em-andamento' | 'concluido';
export type Recorrencia = 'diaria' | 'semanal' | 'mensal';
export type CaptureStatus = 'pendente' | 'processando' | 'revisao' | 'triado' | 'erro';

export interface Workspace {
  id: string;
  nome: string;
  ordem: number;
  /** Palavras que identificam o workspace numa captura (ex.: cliente, produto, apelido). */
  palavrasChave?: string[];
  createdAt: number;
  updatedAt?: number;
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
  resultado?: StoredResult;
  createdAt: number;
  updatedAt?: number;
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
  updatedAt?: number;
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
  updatedAt?: number;
  /** Ao concluir, a próxima ocorrência é criada automaticamente. Exige prazo. */
  recorrencia?: Recorrencia;
  /** Id da primeira tarefa da série (ids das ocorrências derivam dele). */
  serieId?: string;
  /** Dia do mês original (mensal), para "dia 31" não virar "dia 28" para sempre após fevereiro. */
  diaMes?: number;
}

export interface Note {
  id: string;
  /** '' quando a nota envolve vários workspaces (ver workspaceIds). */
  workspaceId: string;
  workspaceIds?: string[];
  titulo?: string;
  /** Nota original de uma captura dividida por workspace (#status/dividida). */
  arquivada?: boolean;
  resumo: string;
  decisoes: string[];
  participantes: string[];
  tags: string[];
  captureId?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface Setting {
  key: string;
  value: string;
}

/** Configurações sensíveis cifradas (AES-GCM) — sincronizadas, mas ilegíveis fora dos seus aparelhos. */
export interface VaultRecord {
  id: string;
  iv: string; // base64
  data: string; // base64 do JSON cifrado
  updatedAt?: number;
}

/** Chave de cifragem do cofre, não exportável e nunca sincronizada. */
export interface KeyRecord {
  id: string;
  userId: string;
  key: CryptoKey;
}

export const db = new Dexie('nexus') as Dexie & {
  workspaces: EntityTable<Workspace, 'id'>;
  captures: EntityTable<Capture, 'id'>;
  events: EntityTable<AgendaEvent, 'id'>;
  tasks: EntityTable<Task, 'id'>;
  notes: EntityTable<Note, 'id'>;
  settings: EntityTable<Setting, 'key'>;
  vault: EntityTable<VaultRecord, 'id'>;
  keystore: EntityTable<KeyRecord, 'id'>;
};

db.version(1).stores({
  workspaces: 'id, ordem',
  captures: 'id, status, createdAt',
  events: 'id, workspaceId, inicio',
  tasks: 'id, workspaceId, status, prazo, prioridade',
  notes: 'id, workspaceId, createdAt',
  settings: 'key',
});

// v2: updatedAt em todo registro sincronizável (base do last-write-wins).
db.version(2)
  .stores({
    workspaces: 'id, ordem, updatedAt',
    captures: 'id, status, createdAt, updatedAt',
    events: 'id, workspaceId, inicio, updatedAt',
    tasks: 'id, workspaceId, status, prazo, prioridade, updatedAt',
    notes: 'id, workspaceId, createdAt, updatedAt',
  })
  .upgrade(async (tx) => {
    markSyncTx(tx);
    for (const t of SYNC_TABLES) {
      await tx.table(t).toCollection().modify((r: { updatedAt?: number; createdAt?: number }) => {
        r.updatedAt ??= r.createdAt ?? Date.now();
      });
    }
  });

// v3: cofre de configurações sincronizado + chave local.
db.version(3).stores({
  vault: 'id, updatedAt',
  keystore: 'id',
});

// IDs fixos: dois aparelhos novos não duplicam os workspaces padrão ao sincronizar.
// updatedAt = 1 faz qualquer versão já existente na nuvem prevalecer sobre a semente.
db.on('populate', (tx) => {
  markSyncTx(tx);
  tx.table('workspaces').bulkAdd(
    ['Empresa A', 'Empresa B', 'Empresa C', 'Pessoal'].map((nome, ordem) => ({
      id: `ws-${nome.toLowerCase().replace(/\s+/g, '-')}`,
      nome,
      ordem,
      createdAt: 1,
      updatedAt: 1,
    })),
  );
});

// ---------- Rastreamento de mudanças para a sincronização ----------

export const SYNC_TABLES = ['workspaces', 'captures', 'events', 'tasks', 'notes', 'vault'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

const SYNC_FLAG = '__nexusSync';
/** Marca uma transação como aplicação de dados remotos: hooks não carimbam nem geram tombstones. */
export function markSyncTx(tx: Transaction): void {
  (tx as unknown as Record<string, boolean>)[SYNC_FLAG] = true;
}
const isSyncTx = (tx: Transaction) => !!(tx as unknown as Record<string, boolean>)[SYNC_FLAG];

export interface Tombstone {
  tbl: SyncTable;
  id: string;
  at: number;
}
const TOMB_KEY = 'nexus.tombstones';
export function readTombstones(): Tombstone[] {
  try {
    return JSON.parse(localStorage.getItem(TOMB_KEY) ?? '[]');
  } catch {
    return [];
  }
}
export function clearTombstones(upTo: number): void {
  localStorage.setItem(TOMB_KEY, JSON.stringify(readTombstones().filter((t) => t.at > upTo)));
}

let changeListener: (() => void) | null = null;
export function onLocalChange(fn: (() => void) | null): void {
  changeListener = fn;
}

for (const tbl of SYNC_TABLES) {
  const table = db.table(tbl);
  table.hook('creating', (_key, obj: { updatedAt?: number }, tx) => {
    if (isSyncTx(tx)) return;
    obj.updatedAt = Date.now();
    tx.on('complete', () => changeListener?.());
  });
  table.hook('updating', (_mods, _key, _obj, tx) => {
    if (isSyncTx(tx)) return;
    tx.on('complete', () => changeListener?.());
    return { updatedAt: Date.now() };
  });
  table.hook('deleting', (key, _obj, tx) => {
    if (isSyncTx(tx)) return;
    const at = Date.now();
    tx.on('complete', () => {
      localStorage.setItem(TOMB_KEY, JSON.stringify([...readTombstones(), { tbl, id: String(key), at }]));
      changeListener?.();
    });
  });
}

// ---------- Tarefas recorrentes ----------

export function nextOccurrence(prazo: Date, rec: Recorrencia, diaMes?: number): Date {
  const n = new Date(prazo);
  if (rec === 'diaria') n.setDate(n.getDate() + 1);
  else if (rec === 'semanal') n.setDate(n.getDate() + 7);
  else {
    const day = diaMes ?? prazo.getDate();
    n.setDate(1);
    n.setMonth(n.getMonth() + 1);
    const last = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
    n.setDate(Math.min(day, last));
  }
  return n;
}

async function spawnNext(t: Task) {
  const prazo = t.prazo ? new Date(t.prazo) : null;
  if (!prazo || isNaN(prazo.getTime()) || !t.recorrencia) return;
  const serieId = t.serieId ?? t.id;
  const diaMes = t.recorrencia === 'mensal' ? (t.diaMes ?? prazo.getDate()) : undefined;
  const next = nextOccurrence(prazo, t.recorrencia, diaMes);
  // Id determinístico: se dois aparelhos concluírem a mesma ocorrência, a próxima não duplica.
  const id = `${serieId}@${next.getFullYear()}-${next.getMonth() + 1}-${next.getDate()}`;
  if (await db.tasks.get(id)) return;
  await db.tasks.add({
    ...t,
    id,
    serieId,
    diaMes,
    prazo: next.toISOString(),
    status: 'pendente',
    captureId: undefined,
    createdAt: Date.now(),
    updatedAt: undefined,
  });
}

db.tasks.hook('updating', (mods, _key, obj, tx) => {
  if (isSyncTx(tx)) return;
  const m = mods as Partial<Task>;
  if (m.status === 'concluido' && obj.status !== 'concluido') {
    const t = { ...obj, ...m } as Task;
    if (t.recorrencia) tx.on('complete', () => void spawnNext(t));
  }
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

/** Grava os registros aprovados na triagem e marca a captura como triada. */
export async function commitCapture(captureId: string, built: Built): Promise<void> {
  await db.transaction('rw', [db.events, db.tasks, db.notes, db.captures], async () => {
    await db.events.bulkAdd(built.events);
    await db.tasks.bulkAdd(built.tasks);
    await db.notes.bulkAdd(built.notes);
    await db.captures.update(captureId, { status: 'triado' });
  });
}

/** Notas visíveis num workspace (inclui notas multi-workspace, exclui as arquivadas). */
export const noteInWorkspace = (n: Note, wsId: string) => !n.arquivada && (n.workspaceId === wsId || !!n.workspaceIds?.includes(wsId));

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
