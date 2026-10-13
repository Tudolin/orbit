import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  biometricAvailable,
  enableBiometric,
  getLockConfig,
  lockoutRemainingMs,
  setPin,
  unlockWithBiometric,
  verifyPin,
  wipeDevice,
} from '../lock';

const MIN_PIN = 4;
const MAX_PIN = 8;

let lockNow: () => void = () => {};
/** Bloqueia o app imediatamente (botão na barra superior / Config). */
export const requestLock = () => lockNow();

/**
 * Portão de segurança: nada do app é montado antes do primeiro desbloqueio.
 * Depois disso o app continua montado sob a tela de bloqueio (não perde o que estava sendo digitado
 * nem a foto da câmera quando o celular sai do app).
 */
export function LockGate({ children }: { children: ReactNode }) {
  const [hasConfig, setHasConfig] = useState(() => !!getLockConfig());
  const [locked, setLocked] = useState(true);
  const [everUnlocked, setEverUnlocked] = useState(false);
  const hiddenAt = useRef<number | null>(null);

  lockNow = useCallback(() => setLocked(true), []);

  useEffect(() => {
    const onVis = () => {
      const cfg = getLockConfig();
      if (!cfg) return;
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        if (cfg.autoLockMin === 0) setLocked(true);
      } else if (hiddenAt.current !== null) {
        if (Date.now() - hiddenAt.current >= cfg.autoLockMin * 60_000) setLocked(true);
        hiddenAt.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const unlock = () => {
    setLocked(false);
    setEverUnlocked(true);
  };

  return (
    <>
      {everUnlocked && <div aria-hidden={locked} style={locked ? { visibility: 'hidden' } : undefined}>{children}</div>}
      {!hasConfig ? (
        <SetupPin onDone={() => { setHasConfig(true); unlock(); }} />
      ) : (
        locked && <Unlock onUnlock={unlock} />
      )}
    </>
  );
}

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="lock">
      <div className="lock-inner stack" style={{ gap: 20 }}>
        <div className="stack" style={{ alignItems: 'center', gap: 10 }}>
          <span className="brand-mark lock-mark"><i /><i /><i /><i /></span>
          <div className="brand" style={{ fontSize: 15 }}>NEXUS</div>
          <div className="big" style={{ fontSize: 18, textAlign: 'center' }}>{title}</div>
          {subtitle && <div className="hint" style={{ textAlign: 'center' }}>{subtitle}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

function PinDots({ length }: { length: number }) {
  return (
    <div className="pin-dots" aria-label={`${length} dígitos`}>
      {Array.from({ length: Math.max(MIN_PIN, Math.min(MAX_PIN, length + (length < MAX_PIN ? 1 : 0))) }, (_, i) => (
        <span key={i} className={i < length ? 'on' : ''} />
      ))}
    </div>
  );
}

function Keypad({ value, onChange, onSubmit, disabled, extra }: { value: string; onChange: (v: string) => void; onSubmit: () => void; disabled?: boolean; extra?: ReactNode }) {
  // Teclado físico (desktop).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (disabled) return;
      if (/^\d$/.test(e.key) && value.length < MAX_PIN) onChange(value + e.key);
      else if (e.key === 'Backspace') onChange(value.slice(0, -1));
      else if (e.key === 'Enter' && value.length >= MIN_PIN) onSubmit();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [value, onChange, onSubmit, disabled]);

  const press = (d: string) => !disabled && value.length < MAX_PIN && onChange(value + d);
  return (
    <div className="keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <button key={d} disabled={disabled} onClick={() => press(d)}>{d}</button>
      ))}
      {extra ?? <span />}
      <button disabled={disabled} onClick={() => press('0')}>0</button>
      <button disabled={disabled} aria-label="Apagar" onClick={() => onChange(value.slice(0, -1))}>⌫</button>
      <button className="ok" disabled={disabled || value.length < MIN_PIN} onClick={onSubmit}>Entrar</button>
    </div>
  );
}

function SetupPin({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'pin' | 'confirm' | 'bio'>('pin');
  const [first, setFirst] = useState('');
  const [pin, setPinValue] = useState('');
  const [err, setErr] = useState('');
  const [bioOk, setBioOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    biometricAvailable().then(setBioOk);
  }, []);

  const submit = async () => {
    setErr('');
    if (step === 'pin') {
      setFirst(pin);
      setPinValue('');
      setStep('confirm');
    } else if (step === 'confirm') {
      if (pin !== first) {
        setErr('Os PINs não conferem. Comece de novo.');
        setFirst('');
        setPinValue('');
        setStep('pin');
        return;
      }
      setBusy(true);
      await setPin(pin);
      setBusy(false);
      if (bioOk) setStep('bio');
      else onDone();
    }
  };

  if (step === 'bio') {
    return (
      <Shell title="Ativar digital?" subtitle="Desbloqueie com a biometria do aparelho. O PIN continua valendo como alternativa.">
        {err && <div className="error">{err}</div>}
        <button
          className="btn primary block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr('');
            try {
              await enableBiometric();
              onDone();
            } catch (e) {
              setErr(friendly(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          ☝ Ativar digital
        </button>
        <button className="btn ghost block" onClick={onDone}>Agora não</button>
      </Shell>
    );
  }

  return (
    <Shell
      title={step === 'pin' ? 'Crie um PIN de acesso' : 'Confirme o PIN'}
      subtitle={step === 'pin' ? `${MIN_PIN} a ${MAX_PIN} dígitos. Ele protege tudo o que está neste aparelho.` : 'Digite o mesmo PIN de novo.'}
    >
      <PinDots length={pin.length} />
      {err && <div className="error">{err}</div>}
      <Keypad value={pin} onChange={setPinValue} onSubmit={submit} disabled={busy} />
    </Shell>
  );
}

function Unlock({ onUnlock }: { onUnlock: () => void }) {
  const cfg = getLockConfig()!;
  const [pin, setPinValue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(lockoutRemainingMs());
  const [forgot, setForgot] = useState(false);
  const tried = useRef(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait(lockoutRemainingMs()), 1000);
    return () => clearInterval(t);
  }, [wait]);

  const bio = useCallback(async () => {
    setErr('');
    try {
      await unlockWithBiometric();
      onUnlock();
    } catch (e) {
      // Cancelar o prompt não é erro para mostrar.
      if ((e as DOMException)?.name !== 'NotAllowedError') setErr(friendly(e));
    }
  }, [onUnlock]);

  // Abre o prompt da digital automaticamente (onde o navegador permite sem toque).
  useEffect(() => {
    if (cfg.bio && !tried.current && document.visibilityState === 'visible') {
      tried.current = true;
      bio();
    }
  }, [cfg.bio, bio]);

  const submit = async () => {
    setBusy(true);
    setErr('');
    const ok = await verifyPin(pin);
    setBusy(false);
    setPinValue('');
    if (ok) return onUnlock();
    const w = lockoutRemainingMs();
    setWait(w);
    setErr(w > 0 ? 'Muitas tentativas.' : 'PIN incorreto.');
  };

  if (forgot) {
    return (
      <Shell title="Esqueceu o PIN?" subtitle="Por segurança, a única saída é apagar os dados deste aparelho e a sessão da nuvem.">
        <div className="notice">
          Se a sincronização estiver ligada, seus dados continuam na nuvem: depois de criar um novo PIN, entre de novo na conta em Config → Sincronização e tudo volta. Sem sincronização, os dados deste aparelho serão perdidos.
        </div>
        <button className="btn danger block" onClick={wipeDevice}>Apagar este aparelho e recomeçar</button>
        <button className="btn ghost block" onClick={() => setForgot(false)}>Voltar</button>
      </Shell>
    );
  }

  const locked = wait > 0;
  return (
    <Shell title="App bloqueado" subtitle={locked ? `Aguarde ${Math.ceil(wait / 1000)} s para tentar de novo.` : cfg.bio ? 'Use a digital ou o PIN.' : 'Digite seu PIN.'}>
      <PinDots length={pin.length} />
      {err && <div className="error">{err}</div>}
      <Keypad
        value={pin}
        onChange={setPinValue}
        onSubmit={submit}
        disabled={busy || locked}
        extra={cfg.bio ? <button className="bio" aria-label="Usar digital" onClick={bio}>☝</button> : undefined}
      />
      <button className="btn ghost sm" onClick={() => setForgot(true)}>Esqueci o PIN</button>
    </Shell>
  );
}

export function friendly(e: unknown): string {
  const name = (e as DOMException)?.name;
  if (name === 'NotAllowedError') return 'Leitura cancelada ou expirou. Tente de novo.';
  if (name === 'InvalidStateError') return 'Esta biometria já está cadastrada neste aparelho.';
  if (name === 'SecurityError') return 'A biometria exige HTTPS (funciona no endereço da Vercel).';
  if (name === 'NotSupportedError') return 'Este navegador não suporta biometria.';
  return e instanceof Error ? e.message : String(e);
}
