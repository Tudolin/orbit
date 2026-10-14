import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, uid, type Capture, type CaptureImage } from '../db';
import { captureTitle } from '../triage';
import { Review } from './Triage';
import { imageSrc, imageToCapture, recorderSupported, speechSupported, startRecording, whisperTranscribe, type Recording } from '../media';
import { appNeedsReload, cancelCapture, isInFlight, runCapture } from '../pipeline';
import { canPromptInstall, isInstalled, promptInstall } from '../install';
import { useCanInstall } from './InstallPanel';
import { Empty, Section } from '../components/ui';

export function Inbox({ shared }: { shared: string }) {
  const captures = useLiveQuery(() => db.captures.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const open = captures.filter((c) => c.status !== 'triado');
  const done = captures.filter((c) => c.status === 'triado').slice(0, 10);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <InstallBanner />
      <Composer shared={shared} />
      <Section title="Triagem" dot="red" count={open.length} flush>
        {open.length === 0 ? <Empty>Inbox zerada. 🟢</Empty> : open.map((c) => <CaptureCard key={c.id} capture={c} />)}
      </Section>
      {done.length > 0 && (
        <Section title="Triadas recentemente" dot="green" count={done.length} flush>
          {done.map((c) => (
            <div key={c.id} className="item">
              <span className="dot green" />
              <div className="item-main">
                <div className="item-title" style={{ fontWeight: 500 }}>{captureTitle(c.resultado) || c.texto || 'Imagem'}</div>
                <div className="item-meta">
                  <span className="mono">{new Date(c.createdAt).toLocaleString('pt-BR')}</span>
                </div>
              </div>
              <button className="btn ghost sm" onClick={() => db.captures.delete(c.id)}>Remover</button>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Composer({ shared }: { shared: string }) {
  const [texto, setTexto] = useState(shared);
  const [imagens, setImagens] = useState<CaptureImage[]>([]);
  const [viaAudio, setViaAudio] = useState(false);
  const [rec, setRec] = useState<Recording | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [pendingAudio, setPendingAudio] = useState<Blob | null>(null);
  const baseText = useRef('');

  useEffect(() => {
    if (shared) setTexto(shared);
  }, [shared]);

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    setBusy('Preparando imagem…');
    try {
      const imgs = await Promise.all([...files].filter((f) => f.type.startsWith('image/')).map(imageToCapture));
      setImagens((prev) => [...prev, ...imgs]);
    } catch (e) {
      setErr(`Não foi possível ler a imagem: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };

  // Colar print direto (desktop: Win+Shift+S / Cmd+Ctrl+Shift+4 → Ctrl+V).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const transcribe = async (blob: Blob) => {
    const whisperKey = await getSetting('openaiKey');
    setBusy('Transcrevendo com Whisper…');
    setErr('');
    try {
      const t = await whisperTranscribe(blob, whisperKey);
      setTexto((baseText.current + ' ' + t).trim());
      setPendingAudio(null);
    } catch (e) {
      // O áudio fica guardado para tentar de novo (ex.: depois de corrigir a chave em Config).
      setPendingAudio(blob);
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const toggleMic = async () => {
    setErr('');
    if (rec) {
      setRec(null);
      const { blob, liveText } = await rec.stop();
      if (blob && (await getSetting('openaiKey'))) await transcribe(blob);
      else if (!liveText) setErr('Nada foi transcrito. Fale mais perto do microfone ou use o ditado do teclado.');
      return;
    }
    const whisperKey = await getSetting('openaiKey');
    const useWhisper = !!whisperKey && recorderSupported();
    if (!useWhisper && !speechSupported()) {
      setErr('Transcrição indisponível neste navegador. Use o ditado do teclado ou configure Whisper em Config.');
      return;
    }
    baseText.current = texto;
    setViaAudio(true);
    try {
      setRec(
        await startRecording({
          record: useWhisper,
          // No Android, gravar e transcrever ao vivo ao mesmo tempo disputa o microfone.
          live: !useWhisper && speechSupported(),
          onLive: (t) => setTexto((baseText.current + ' ' + t).trim()),
        }),
      );
    } catch (e) {
      setErr(`Microfone indisponível: ${(e as Error).message}`);
    }
  };

  const submit = async () => {
    if (!texto.trim() && !imagens.length) return;
    const capture: Capture = { id: uid(), texto: texto.trim(), imagens, viaAudio, status: 'pendente', createdAt: Date.now() };
    await db.captures.add(capture);
    setTexto('');
    setImagens([]);
    setViaAudio(false);
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    if ((await getSetting('autoProcess')) !== 'off') runCapture(capture.id);
  };

  return (
    <Section title="Quick Capture" dot="yellow">
      <div className="stack">
        <textarea
          className="textarea"
          placeholder="Nota rápida, link, ou cole um print (Ctrl+V)…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit()}
        />
        {imagens.length > 0 && (
          <div className="thumbs">
            {imagens.map((img, i) => (
              <div key={i} className="thumb">
                <img src={imageSrc(img)} alt="" />
                <button onClick={() => setImagens(imagens.filter((_, j) => j !== i))} aria-label="Remover">×</button>
              </div>
            ))}
          </div>
        )}
        <div className="capture-actions">
          <label>
            <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="6" width="18" height="14" /><circle cx="12" cy="13" r="4" /><rect x="8" y="3" width="8" height="3" /></svg>
            Câmera
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <label>
            <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" /><polygon points="3,21 10,12 15,17 18,14 21,17 21,21" fill="currentColor" stroke="none" /></svg>
            Galeria
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <button className={rec ? 'recording' : ''} onClick={toggleMic}>
            <svg className="glyph" viewBox="0 0 24 24" fill={rec ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9" />{!rec && <circle cx="12" cy="12" r="3" fill="currentColor" />}</svg>
            {rec ? 'Parar' : 'Áudio'}
          </button>
        </div>
        {busy && <div className="hint">{busy}</div>}
        {err && <div className="error">{err}</div>}
        {pendingAudio && !busy && (
          <div className="row">
            <span className="hint" style={{ flex: 1 }}>🎙️ Áudio guardado ({Math.round(pendingAudio.size / 1024)} KB).</span>
            <button className="btn sm" onClick={() => transcribe(pendingAudio)}>Tentar de novo</button>
            <button className="btn sm ghost" onClick={() => { setPendingAudio(null); setErr(''); }}>Descartar</button>
          </div>
        )}
        <button className="btn primary block" disabled={(!texto.trim() && !imagens.length) || !!rec || !!busy} onClick={submit}>
          Capturar e processar
        </button>
      </div>
    </Section>
  );
}

function CaptureCard({ capture }: { capture: Capture }) {
  const processing = capture.status === 'processando';
  const [now, setNow] = useState(Date.now());
  const startedAt = useRef(Date.now());
  useEffect(() => {
    if (!processing) return;
    startedAt.current = Date.now();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [processing]);
  const elapsed = Math.round((now - startedAt.current) / 1000);
  // "Processando" sem requisição viva nesta aba = travou (app fechado/atualizado no meio).
  const stuck = processing && !isInFlight(capture.id);
  const label =
    capture.status === 'processando' ? 'Processando…' : capture.status === 'erro' ? 'Erro' : capture.status === 'revisao' ? 'Revisar' : 'Na fila';
  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="item" style={{ borderBottom: 0 }}>
        <span className={`dot ${capture.status === 'erro' ? 'red' : capture.status === 'revisao' ? 'yellow' : 'orange'}`} />
        <div className="item-main">
          <div className="item-title" style={{ fontWeight: 500, whiteSpace: 'pre-wrap' }}>
            {capture.texto ? (capture.texto.length > 220 ? capture.texto.slice(0, 220) + '…' : capture.texto) : `${capture.imagens.length} imagem(ns)`}
          </div>
          <div className="item-meta">
            <span className="chip">{label.toUpperCase()}{processing && !stuck && elapsed > 0 ? ` ${elapsed}s` : ''}</span>
            <span className="mono">{new Date(capture.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
            {capture.imagens.length > 0 && <span>📷 {capture.imagens.length}</span>}
            {capture.viaAudio && <span>🎙️</span>}
          </div>
        </div>
      </div>
      {capture.imagens.length > 0 && (
        <div className="thumbs" style={{ padding: '0 14px 12px' }}>
          {capture.imagens.map((img, i) => (
            <div key={i} className="thumb"><img src={imageSrc(img)} alt="" /></div>
          ))}
        </div>
      )}
      {capture.status === 'erro' && <div className="error" style={{ margin: '0 14px 12px' }}>{capture.erro}</div>}
      {capture.status === 'revisao' && capture.resultado && <Review capture={capture} />}
      {processing && (stuck || elapsed >= 20) && (
        <div className="row" style={{ padding: '0 14px 12px' }}>
          <span className="hint" style={{ flex: 1 }}>{stuck ? 'O processamento foi interrompido.' : 'Está demorando mais que o normal.'}</span>
          {stuck ? (
            <button className="btn sm" onClick={() => runCapture(capture.id)}>Tentar de novo</button>
          ) : (
            <button className="btn sm" onClick={() => cancelCapture(capture.id)}>Cancelar</button>
          )}
        </div>
      )}
      {capture.status !== 'revisao' && !processing && (
        <div className="row" style={{ padding: '0 14px 12px' }}>
          <button className="btn sm" onClick={() => runCapture(capture.id)}>
            {appNeedsReload() ? 'Recarregar e processar' : capture.status === 'erro' ? 'Tentar de novo' : 'Processar'}
          </button>
          <button className="btn ghost sm" onClick={() => db.captures.delete(capture.id)}>Descartar</button>
        </div>
      )}
    </div>
  );
}

function InstallBanner() {
  useCanInstall();
  const [hidden, setHidden] = useState(() => localStorage.getItem('nexus.installBanner') === 'off');
  if (hidden || isInstalled() || !canPromptInstall()) return null;
  return (
    <div className="section row" style={{ padding: '10px 14px', flexWrap: 'nowrap' }}>
      <span className="dot blue" />
      <span style={{ flex: 1, fontSize: 13 }}>Instale o NEXUS como app: tela cheia, ícone próprio, sem navegador.</span>
      <button className="btn sm primary" onClick={promptInstall}>Instalar</button>
      <button className="btn sm ghost" aria-label="Dispensar" onClick={() => { localStorage.setItem('nexus.installBanner', 'off'); setHidden(true); }}>×</button>
    </div>
  );
}
