import { useEffect, useState } from 'react';
import { biometricAvailable, disableBiometric, enableBiometric, getLockConfig, setAutoLock, setPin, verifyPin } from '../lock';
import { friendly, requestLock } from './LockScreen';
import { Section } from '../components/ui';

const AUTO_LOCK = [
  { v: 0, l: 'Ao sair do app' },
  { v: 1, l: '1 minuto fora' },
  { v: 5, l: '5 minutos fora' },
  { v: 15, l: '15 minutos fora' },
];

export function SecurityPanel() {
  const [cfg, setCfg] = useState(getLockConfig);
  const [bioOk, setBioOk] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [changing, setChanging] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    biometricAvailable().then(setBioOk);
  }, []);
  const refresh = () => setCfg(getLockConfig());
  const flash = (m: string) => {
    setErr('');
    setMsg(m);
    setTimeout(() => setMsg(''), 2500);
  };

  const toggleBio = async () => {
    setErr('');
    setBusy(true);
    try {
      if (cfg?.bio) {
        disableBiometric();
        flash('Digital desativada.');
      } else {
        await enableBiometric();
        flash('Digital ativada ✓');
      }
      refresh();
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const changePin = async () => {
    setErr('');
    if (!/^\d{4,8}$/.test(next)) return setErr('O novo PIN precisa ter de 4 a 8 dígitos.');
    setBusy(true);
    const ok = await verifyPin(cur);
    if (ok) await setPin(next);
    setBusy(false);
    if (!ok) return setErr('PIN atual incorreto.');
    setChanging(false);
    setCur('');
    setNext('');
    refresh();
    flash('PIN alterado ✓');
  };

  return (
    <Section title="🔒 Segurança" dot="red" action={<button className="btn sm" onClick={requestLock}>Bloquear agora</button>}>
      <div className="stack">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Digital / biometria</div>
            <div className="hint">
              {!bioOk ? 'Indisponível neste navegador ou aparelho.' : cfg?.bio ? 'Ativa — usa o leitor do aparelho.' : 'Desativada.'}
            </div>
          </div>
          {bioOk && (
            <button className={`btn ${cfg?.bio ? 'ghost' : 'primary'}`} disabled={busy} onClick={toggleBio}>
              {cfg?.bio ? 'Desativar' : 'Ativar'}
            </button>
          )}
        </div>

        <div className="field">
          <label className="label">Bloquear automaticamente</label>
          <select
            className="select"
            value={cfg?.autoLockMin ?? 1}
            onChange={(e) => {
              setAutoLock(Number(e.target.value));
              refresh();
            }}
          >
            {AUTO_LOCK.map((o) => (
              <option key={o.v} value={o.v}>{o.l}</option>
            ))}
          </select>
          <span className="hint" style={{ marginTop: 6 }}>O app sempre pede desbloqueio ao ser aberto do zero.</span>
        </div>

        {!changing ? (
          <button className="btn" onClick={() => setChanging(true)}>Alterar PIN</button>
        ) : (
          <div className="stack">
            <div className="field">
              <label className="label">PIN atual</label>
              <input className="input mono" type="password" inputMode="numeric" autoComplete="off" value={cur} onChange={(e) => setCur(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            </div>
            <div className="field">
              <label className="label">Novo PIN (4 a 8 dígitos)</label>
              <input className="input mono" type="password" inputMode="numeric" autoComplete="off" value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            </div>
            <div className="row">
              <button className="btn ghost" onClick={() => setChanging(false)}>Cancelar</button>
              <span className="spacer" />
              <button className="btn primary" disabled={busy} onClick={changePin}>Salvar PIN</button>
            </div>
          </div>
        )}
        {err && <div className="error">{err}</div>}
        {msg && <div className="hint">{msg}</div>}
      </div>
    </Section>
  );
}
