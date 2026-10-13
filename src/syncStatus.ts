/** Estado da sincronização, sem dependências pesadas (usado na barra superior). */

export type SyncStatus =
  | { state: 'off' }
  | { state: 'signed-out' }
  | { state: 'syncing' }
  | { state: 'ok'; at: number }
  | { state: 'error'; message: string };

let status: SyncStatus = { state: 'off' };
const listeners = new Set<() => void>();
export function setStatus(s: SyncStatus) {
  status = s;
  listeners.forEach((l) => l());
}
export const getStatus = () => status;
export function subscribeStatus(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

