/**
 * Bloqueio do app: PIN (PBKDF2) + digital/biometria via WebAuthn (autenticador da plataforma).
 *
 * A asserção WebAuthn é verificada localmente contra a chave pública registrada
 * (desafio, origem, rpId, flags de presença/verificação e assinatura ES256/RS256).
 */

const KEY = 'nexus.lock';
const ATTEMPTS_KEY = 'nexus.lock.attempts';
const PBKDF2_ITERATIONS = 210_000;

export interface LockConfig {
  pinHash: string; // base64
  salt: string; // base64
  iterations: number;
  autoLockMin: number; // 0 = ao sair do app
  bio?: { credId: string; publicKey: string; alg: number }; // base64url / base64 SPKI
}

export function getLockConfig(): LockConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LockConfig) : null;
  } catch {
    return null;
  }
}

function saveLockConfig(c: LockConfig) {
  localStorage.setItem(KEY, JSON.stringify(c));
}

// ---------- base64 ----------

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf: ArrayBuffer | Uint8Array) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

// ---------- PIN ----------

async function hashPin(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return b64(bits);
}

function equalConstTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function setPin(pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prev = getLockConfig();
  saveLockConfig({
    pinHash: await hashPin(pin, salt, PBKDF2_ITERATIONS),
    salt: b64(salt),
    iterations: PBKDF2_ITERATIONS,
    autoLockMin: prev?.autoLockMin ?? 1,
    bio: prev?.bio,
  });
  resetAttempts();
}

/** Espera obrigatória após erros: 5 erros → 30 s, dobrando a cada erro seguinte (máx. 1 h). */
export function lockoutRemainingMs(): number {
  const a = readAttempts();
  return Math.max(0, a.until - Date.now());
}

function readAttempts(): { count: number; until: number } {
  try {
    return JSON.parse(localStorage.getItem(ATTEMPTS_KEY) ?? '') as { count: number; until: number };
  } catch {
    return { count: 0, until: 0 };
  }
}
function resetAttempts() {
  localStorage.removeItem(ATTEMPTS_KEY);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const c = getLockConfig();
  if (!c || lockoutRemainingMs() > 0) return false;
  const ok = equalConstTime(await hashPin(pin, unb64(c.salt), c.iterations), c.pinHash);
  if (ok) {
    resetAttempts();
  } else {
    const a = readAttempts();
    const count = a.count + 1;
    const until = count >= 5 ? Date.now() + Math.min(3_600_000, 30_000 * 2 ** (count - 5)) : 0;
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify({ count, until }));
  }
  return ok;
}

export function setAutoLock(min: number) {
  const c = getLockConfig();
  if (c) saveLockConfig({ ...c, autoLockMin: min });
}

// ---------- Biometria (WebAuthn) ----------

export async function biometricAvailable(): Promise<boolean> {
  try {
    return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

export async function enableBiometric(): Promise<void> {
  const c = getLockConfig();
  if (!c) throw new Error('Crie um PIN antes de ativar a digital.');
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'NEXUS', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'nexus-lock', displayName: 'NEXUS — desbloqueio' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256 (Windows Hello)
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Cadastro da digital cancelado.');
  const resp = cred.response as AuthenticatorAttestationResponse;
  const spki = resp.getPublicKey?.();
  const alg = resp.getPublicKeyAlgorithm?.();
  if (!spki || (alg !== -7 && alg !== -257)) throw new Error('Este navegador não informou a chave da biometria. Use o Chrome ou o Samsung Internet atualizados.');
  saveLockConfig({ ...c, bio: { credId: b64url(cred.rawId), publicKey: b64(spki), alg } });
}

export function disableBiometric() {
  const c = getLockConfig();
  if (c) saveLockConfig({ ...c, bio: undefined });
}

/** Pede a digital e verifica a assinatura. Lança erro se cancelado ou inválido. */
export async function unlockWithBiometric(): Promise<void> {
  const c = getLockConfig();
  if (!c?.bio) throw new Error('Digital não configurada.');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: unb64url(c.bio.credId), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Leitura cancelada.');
  const r = cred.response as AuthenticatorAssertionResponse;

  const client = JSON.parse(new TextDecoder().decode(r.clientDataJSON)) as { type: string; challenge: string; origin: string };
  if (client.type !== 'webauthn.get' || client.challenge !== b64url(challenge) || client.origin !== location.origin) {
    throw new Error('Resposta biométrica inválida.');
  }
  const authData = new Uint8Array(r.authenticatorData);
  const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(location.hostname)));
  const flags = authData[32];
  if (!rpIdHash.every((b, i) => b === authData[i]) || !(flags & 0x01) || !(flags & 0x04)) {
    throw new Error('A biometria não confirmou sua identidade.');
  }

  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', r.clientDataJSON));
  const signed = new Uint8Array(authData.length + clientHash.length);
  signed.set(authData);
  signed.set(clientHash, authData.length);

  const es256 = c.bio.alg === -7;
  const key = await crypto.subtle.importKey(
    'spki',
    unb64(c.bio.publicKey),
    es256 ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const sig = es256 ? derToRaw(new Uint8Array(r.signature)) : new Uint8Array(r.signature);
  const ok = await crypto.subtle.verify(es256 ? { name: 'ECDSA', hash: 'SHA-256' } : 'RSASSA-PKCS1-v1_5', key, sig as BufferSource, signed);
  if (!ok) throw new Error('Assinatura biométrica inválida.');
  resetAttempts();
}

/** Assinatura ECDSA DER (SEQUENCE{r,s}) → formato bruto r||s de 64 bytes usado pelo WebCrypto. */
function derToRaw(der: Uint8Array): Uint8Array {
  let i = 2;
  if (der[1] & 0x80) i += der[1] & 0x7f;
  const read = () => {
    const len = der[i + 1];
    let v = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const raw = new Uint8Array(64);
  raw.set(read(), 0);
  raw.set(read(), 32);
  return raw;
}

// ---------- Redefinição ----------

/** "Esqueci o PIN": apaga dados locais e a sessão da nuvem; os dados voltam após novo login na sincronização. */
export async function wipeDevice(): Promise<void> {
  const { db } = await import('./db');
  db.close();
  localStorage.clear();
  sessionStorage.clear();
  await new Promise<void>((res) => {
    const req = indexedDB.deleteDatabase('nexus');
    req.onsuccess = req.onerror = req.onblocked = () => res();
  });
  location.reload();
}
