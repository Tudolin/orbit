import { useEffect, useState, useSyncExternalStore } from 'react';
import { getSetting, setSetting } from '../db';
import { getStatus, subscribeStatus } from '../syncStatus';
import { Section } from '../components/ui';
import { applyVault, hasVaultKey, publishSettings, watchVault, type VaultState } from '../vault';

// O SDK do Supabase só é baixado quando a sincronização é usada.
const loadSync = () => import('../sync');

export function useSyncStatus() {
  return useSyncExternalStore(subscribeStatus, getStatus);
}

export function statusLabel(s: ReturnType<typeof getStatus>): { dot: string; text: string } {
  switch (s.state) {
    case 'ok':
      return { dot: 'green', text: `Sincronizado às ${new Date(s.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` };
    case 'syncing':
      return { dot: 'orange', text: 'Sincronizando…' };
    case 'error':
      return { dot: 'red', text: s.message };
    case 'signed-out':
      return { dot: 'yellow', text: 'Entre na sua conta para sincronizar' };
    default:
      return { dot: '', text: 'Sincronização desligada (dados só neste aparelho)' };
  }
}

export function SyncPanel() {
  const status = useSyncStatus();
  const [fromEnv, setFromEnv] = useState(true);
  const [url, setUrl] = useState('');
  const [anon, setAnon] = useState('');
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [vault, setVault] = useState<VaultState | 'no-key' | null>(null);
  const [vaultPass, setVaultPass] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = async () => {
    const s = await loadSync();
    const cfg = await s.getConfig();
    setFromEnv(cfg.fromEnv);
    setUrl(cfg.fromEnv ? '' : cfg.url);
    setAnon(cfg.fromEnv ? '' : cfg.anonKey);
    const u = await s.currentUser();
    setUser(u);
    if (u) setVault((await hasVaultKey(u.id)) ? await applyVault() : 'no-key');
  };

  /** Depois do login: traz o cofre da nuvem ou, se ainda não existir, publica as chaves deste aparelho. */
  const settleVault = async () => {
    const s = await loadSync();
    await s.syncNow();
    if ((await applyVault()) === 'no-record' && (await publishSettings())) await s.syncNow();
  };
  useEffect(() => {
    refresh();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = () =>
    run(async () => {
      await setSetting('supabaseUrl', url.trim());
      await setSetting('supabaseAnonKey', anon.trim());
      await (await loadSync()).start();
      setMsg('Configuração salva ✓');
    });

  const configured = fromEnv || (!!url && !!anon);
  const { dot, text } = statusLabel(status);

  return (
    <Section title="☁️ Sincronização (celular ↔ computador)" dot="green">
      <div className="stack">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          {dot && <span className={`dot ${dot}`} />}
          <span className="hint" style={{ color: status.state === 'error' ? 'var(--red)' : undefined }}>{text}</span>
        </div>

        {!fromEnv && (
          <>
            <div className="hint">
              Informe o projeto Supabase (ou defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY na Vercel para não precisar digitar em cada aparelho).
            </div>
            <div className="field">
              <label className="label">Supabase URL</label>
              <input className="input mono" placeholder="https://xxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Supabase anon key</label>
              <input className="input mono" type="password" autoComplete="off" value={anon} onChange={(e) => setAnon(e.target.value)} />
            </div>
            <button className="btn" disabled={busy || !url || !anon} onClick={saveConfig}>Salvar projeto</button>
          </>
        )}

        {configured && !user && (
          <>
            <div className="field">
              <label className="label">E-mail</label>
              <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Senha</label>
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="row">
              <button className="btn primary" disabled={busy || !email || password.length < 6} onClick={() => run(async () => { await (await loadSync()).signIn(email, password); await settleVault(); })}>
                Entrar
              </button>
              <button
                className="btn"
                disabled={busy || !email || password.length < 6}
                onClick={() =>
                  run(async () => {
                    const active = await (await loadSync()).signUp(email, password);
                    if (active) await settleVault();
                    setMsg(active ? 'Conta criada ✓' : 'Conta criada. Confirme pelo link enviado ao seu e-mail e depois toque em Entrar.');
                  })
                }
              >
                Criar conta
              </button>
            </div>
            <div className="hint">Use a mesma conta em todos os aparelhos. Os dados locais deste aparelho são mesclados com a nuvem no primeiro login.</div>
          </>
        )}

        {user && (
          <>
            <div className="hint">Conectado como <b style={{ color: 'var(--text)' }}>{user.email}</b></div>
            {vault === 'applied' && <div className="hint">🔐 Chaves de API sincronizadas com criptografia de ponta a ponta.</div>}
            {vault === 'wrong-key' && <div className="notice">As chaves na nuvem foram salvas com outra senha. Informe-as de novo em Engine e toque em Salvar para regravar.</div>}
            {vault === 'no-key' && (
              <div className="stack">
                <div className="notice">Digite a senha da conta uma vez para liberar as chaves de API sincronizadas neste aparelho.</div>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input className="input" type="password" autoComplete="current-password" placeholder="Senha da conta" value={vaultPass} onChange={(e) => setVaultPass(e.target.value)} />
                  <button
                    className="btn primary"
                    disabled={busy || !vaultPass}
                    onClick={() =>
                      run(async () => {
                        await (await loadSync()).unlockVault(vaultPass);
                        setVaultPass('');
                        await settleVault();
                        setMsg('Chaves liberadas ✓ — reabra Config para vê-las.');
                      })
                    }
                  >
                    Liberar
                  </button>
                </div>
              </div>
            )}
            <div className="row">
              <button className="btn" disabled={busy} onClick={() => run(async () => (await loadSync()).syncNow())}>Sincronizar agora</button>
              <button className="btn ghost" disabled={busy} onClick={() => run(async () => (await loadSync()).signOut())}>Sair</button>
            </div>
          </>
        )}
        {msg && <div className="notice">{msg}</div>}
      </div>
    </Section>
  );
}

/** Inicia a sincronização no carregamento do app, se houver projeto configurado. */
export async function bootSync() {
  const envReady = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (!envReady && !(await getSetting('supabaseUrl'))) return;
  watchVault();
  (await loadSync()).start();
}
