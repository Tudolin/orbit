import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { setStatus } from './syncStatus';
import { clearTombstones, db, getSetting, markSyncTx, onLocalChange, readTombstones, SYNC_TABLES, type SyncTable } from './db';

/**
 * Sincronização via Supabase (tabela única `nexus_records`, ver supabase/schema.sql).
 *
 * - Push: registros com updatedAt > último push + tombstones de exclusões.
 * - Pull: linhas com updated_at (relógio do servidor) > último pull, com 10 s de sobreposição.
 * - Conflitos: last-write-wins por client_updated_at — o trigger no banco recusa versões
 *   mais antigas e o pull só aplica versões mais novas que a local.
 * - Realtime: mudança em outro aparelho dispara um pull imediato.
 */

const TABLE = 'nexus_records';
const PAGE = 500;
const OVERLAP_MS = 10_000;

interface Row {
  user_id?: string;
  tbl: SyncTable;
  id: string;
  data: Record<string, unknown> | null;
  deleted: boolean;
  client_updated_at: number;
  updated_at?: string;
}

// ---------- Cliente ----------

let client: SupabaseClient | null = null;
let clientKey = '';

export async function getConfig(): Promise<{ url: string; anonKey: string; fromEnv: boolean }> {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (envUrl && envKey) return { url: envUrl, anonKey: envKey, fromEnv: true };
  return { url: await getSetting('supabaseUrl'), anonKey: await getSetting('supabaseAnonKey'), fromEnv: false };
}

async function getClient(): Promise<SupabaseClient | null> {
  const { url, anonKey } = await getConfig();
  if (!url || !anonKey) return null;
  if (!client || clientKey !== url + anonKey) {
    client = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    clientKey = url + anonKey;
  }
  return client;
}

export async function currentUser(): Promise<{ id: string; email?: string } | null> {
  const c = await getClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session?.user ?? null;
}

export async function signIn(email: string, password: string): Promise<void> {
  const c = await getClient();
  if (!c) throw new Error('Configure o Supabase primeiro.');
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(translateAuth(error.message));
  await start();
}

/** Retorna true se a conta já está ativa; false se o Supabase exige confirmar o e-mail. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const c = await getClient();
  if (!c) throw new Error('Configure o Supabase primeiro.');
  const { data, error } = await c.auth.signUp({ email, password });
  if (error) throw new Error(translateAuth(error.message));
  if (data.session) await start();
  return !!data.session;
}

export async function signOut(): Promise<void> {
  stop();
  await client?.auth.signOut();
  setStatus({ state: 'signed-out' });
}

function translateAuth(m: string): string {
  if (/invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/not confirmed/i.test(m)) return 'Confirme seu e-mail (link enviado pelo Supabase) e tente de novo.';
  if (/already registered/i.test(m)) return 'Este e-mail já tem conta. Use Entrar.';
  if (/password/i.test(m)) return `Senha inválida: ${m}`;
  return m;
}

// ---------- Ciclo de vida ----------

let channel: RealtimeChannel | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;
let again = false;
let userId = '';

const onWake = () => document.visibilityState === 'visible' && schedule(0);

/** Inicia a sincronização se houver configuração e sessão. Seguro chamar várias vezes. */
export async function start(): Promise<void> {
  const c = await getClient();
  if (!c) return setStatus({ state: 'off' });
  const user = await currentUser();
  if (!user) return setStatus({ state: 'signed-out' });
  if (userId === user.id && channel) return schedule(0);
  stop();
  userId = user.id;

  onLocalChange(() => schedule(1500));
  channel = c
    .channel(`nexus-${user.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `user_id=eq.${user.id}` }, () => schedule(500))
    .subscribe();
  interval = setInterval(() => schedule(0), 120_000);
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('online', onWake);
  schedule(0);
}

function stop() {
  onLocalChange(null);
  if (channel) client?.removeChannel(channel);
  channel = null;
  if (interval) clearInterval(interval);
  if (timer) clearTimeout(timer);
  interval = timer = null;
  document.removeEventListener('visibilitychange', onWake);
  window.removeEventListener('online', onWake);
  userId = '';
}

export function schedule(delay: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    syncNow();
  }, delay);
}

/** Executa um ciclo push → pull. Chamadas concorrentes viram uma rodada extra. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await cycle();
    } while (again);
  })().finally(() => (running = null));
  return running;
}

const key = (k: string) => `nexus.sync.${userId}.${k}`;

async function cycle() {
  const c = await getClient();
  if (!c || !userId) return;
  if (!navigator.onLine) return setStatus({ state: 'error', message: 'Sem conexão — as mudanças ficam salvas e sobem quando voltar.' });
  setStatus({ state: 'syncing' });
  try {
    await push(c);
    await pull(c);
    setStatus({ state: 'ok', at: Date.now() });
  } catch (e) {
    setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

async function push(c: SupabaseClient) {
  const since = Number(localStorage.getItem(key('lastPush')) ?? 0);
  const startedAt = Date.now();
  const rows: Row[] = [];
  for (const tbl of SYNC_TABLES) {
    const changed = await db.table(tbl).where('updatedAt').above(since).toArray();
    for (const r of changed) rows.push({ user_id: userId, tbl, id: r.id, data: r, deleted: false, client_updated_at: r.updatedAt ?? startedAt });
  }
  const tombs = readTombstones();
  for (const t of tombs) rows.push({ user_id: userId, tbl: t.tbl, id: t.id, data: null, deleted: true, client_updated_at: t.at });

  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await c.from(TABLE).upsert(rows.slice(i, i + 100), { onConflict: 'user_id,tbl,id', ignoreDuplicates: false });
    if (error) throw new Error(`Falha ao enviar: ${error.message}`);
  }
  // -1 ms: um registro alterado no mesmo milissegundo do início entra no próximo push.
  localStorage.setItem(key('lastPush'), String(startedAt - 1));
  clearTombstones(Math.max(0, ...tombs.map((t) => t.at)));
}

async function pull(c: SupabaseClient) {
  const last = localStorage.getItem(key('lastPull'));
  let since = last ? new Date(new Date(last).getTime() - OVERLAP_MS).toISOString() : '1970-01-01T00:00:00Z';
  let cursor = last ?? since;
  for (;;) {
    const { data, error } = await c
      .from(TABLE)
      .select('tbl,id,data,deleted,client_updated_at,updated_at')
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`Falha ao baixar: ${error.message}`);
    const rows = (data ?? []) as Row[];
    if (rows.length) await apply(rows);
    for (const r of rows) if (r.updated_at! > cursor) cursor = r.updated_at!;
    if (rows.length < PAGE) break;
    since = rows[rows.length - 1].updated_at!;
  }
  localStorage.setItem(key('lastPull'), cursor);
}

/** Aplica linhas remotas mais novas que a versão local, sem gerar novas mudanças locais. */
async function apply(rows: Row[]) {
  const tables = SYNC_TABLES.map((t) => db.table(t));
  await db.transaction('rw', tables, async (tx) => {
    markSyncTx(tx);
    for (const r of rows) {
      if (!SYNC_TABLES.includes(r.tbl)) continue;
      const table = db.table(r.tbl);
      const local = (await table.get(r.id)) as { updatedAt?: number } | undefined;
      const ts = Number(r.client_updated_at);
      if (local && (local.updatedAt ?? 0) >= ts) continue;
      if (r.deleted) {
        if (local) await table.delete(r.id);
      } else if (r.data) {
        await table.put({ ...r.data, updatedAt: ts });
      }
    }
  });
}

/** Esquece os cursores deste aparelho (força reenvio e redownload completos). */
export function resetCursors() {
  Object.keys(localStorage)
    .filter((k) => k.startsWith('nexus.sync.') || k === 'nexus.tombstones')
    .forEach((k) => localStorage.removeItem(k));
}
