import { liveQuery } from 'dexie';
import { db, getSetting, setSetting } from './db';

/**
 * Cofre de configurações sincronizado com criptografia de ponta a ponta.
 *
 * A chave AES-256-GCM é derivada da senha da conta de sincronização (PBKDF2, salt = id do usuário),
 * então todos os seus aparelhos chegam à mesma chave sem que ela trafegue. Na nuvem fica só o texto cifrado.
 */

export const VAULT_KEYS = ['anthropicKey', 'openaiKey', 'model', 'effort', 'autoProcess'] as const;
const RECORD_ID = 'settings';
const APPLIED = 'nexus.vault.applied';
const ITERATIONS = 310_000;

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function deriveVaultKey(password: string, userId: string): Promise<void> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(`nexus-vault:${userId}`), iterations: ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  await db.keystore.put({ id: 'vault', userId, key });
}

async function getKey(userId?: string): Promise<CryptoKey | null> {
  const rec = await db.keystore.get('vault');
  if (!rec || (userId && rec.userId !== userId)) return null;
  return rec.key;
}

export async function hasVaultKey(userId: string): Promise<boolean> {
  return !!(await getKey(userId));
}

export async function forgetVaultKey(): Promise<void> {
  await db.keystore.delete('vault');
}

/** Cifra as configurações locais e grava no cofre (a sincronização envia). Sem chave, não faz nada. */
export async function publishSettings(): Promise<boolean> {
  const key = await getKey();
  if (!key) return false;
  const values: Record<string, string> = {};
  for (const k of VAULT_KEYS) values[k] = await getSetting(k);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(values)));
  await db.vault.put({ id: RECORD_ID, iv: b64(iv), data: b64(data) });
  const saved = await db.vault.get(RECORD_ID);
  localStorage.setItem(APPLIED, String(saved?.updatedAt ?? Date.now()));
  return true;
}

export type VaultState = 'no-record' | 'applied' | 'locked' | 'wrong-key';

/** Decifra o cofre recebido e aplica nas configurações locais. */
export async function applyVault(): Promise<VaultState> {
  const rec = await db.vault.get(RECORD_ID);
  if (!rec) return 'no-record';
  const key = await getKey();
  if (!key) return 'locked';
  if (Number(localStorage.getItem(APPLIED) ?? 0) >= (rec.updatedAt ?? 0)) return 'applied';
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.data));
    const values = JSON.parse(new TextDecoder().decode(plain)) as Record<string, string>;
    for (const k of VAULT_KEYS) if (typeof values[k] === 'string') await setSetting(k, values[k]);
    localStorage.setItem(APPLIED, String(rec.updatedAt ?? Date.now()));
    return 'applied';
  } catch {
    // Cofre cifrado com outra senha (ex.: senha da conta trocada). Salvar de novo regrava com a chave atual.
    return 'wrong-key';
  }
}

let watching = false;
/** Aplica automaticamente qualquer versão nova do cofre que chegar pela sincronização. */
export function watchVault(): void {
  if (watching) return;
  watching = true;
  liveQuery(() => db.vault.get(RECORD_ID)).subscribe({ next: () => void applyVault() });
}
