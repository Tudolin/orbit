import { useEffect, useState } from 'react';
import { db, exportAll, getSetting, importAll, setSetting } from '../db';
import { DEFAULT_MODEL, EFFORTS, MODELS } from '../config';
import { openaiKeyProblem, recorderSupported, speechSupported, testOpenAIKey } from '../media';
import { Section } from '../components/ui';
import { SyncPanel } from './SyncPanel';
import { InstallPanel } from './InstallPanel';
import { applyVault, publishSettings } from '../vault';
import { SecurityPanel } from './SecurityPanel';

export function Settings() {
  const [key, setKey] = useState('');
  const [openai, setOpenai] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [effort, setEffort] = useState('medium');
  const [auto, setAuto] = useState('on');
  const [saved, setSaved] = useState('');
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState('');
  const [wipe, setWipe] = useState(false);
  const [oaTest, setOaTest] = useState('');

  useEffect(() => {
    (async () => {
      await applyVault();
      setKey(await getSetting('anthropicKey'));
      setOpenai(await getSetting('openaiKey'));
      setModel((await getSetting('model')) || DEFAULT_MODEL);
      setEffort((await getSetting('effort')) || 'medium');
      setAuto((await getSetting('autoProcess')) || 'on');
    })();
  }, []);

  const save = async () => {
    await Promise.all([
      setSetting('anthropicKey', key.trim()),
      setSetting('openaiKey', openai.trim()),
      setSetting('model', model),
      setSetting('effort', effort),
      setSetting('autoProcess', auto),
    ]);
    const synced = await publishSettings();
    setSaved(synced ? 'Salvo e sincronizado (cifrado) ✓' : 'Salvo neste aparelho ✓');
    setTimeout(() => setSaved(''), 2000);
  };

  const doExport = async () => {
    const blob = new Blob([await exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nexus-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      await importAll(await f.text());
      setMsg('Backup importado ✓');
    } catch (e) {
      setMsg(`Falha ao importar: ${(e as Error).message}`);
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <InstallPanel />

      <Section title="🤖 Engine — Anthropic API" dot="blue">
        <div className="stack">
          <div className="field">
            <label className="label">ANTHROPIC_API_KEY</label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input mono" type={show ? 'text' : 'password'} autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
              <button className="btn" onClick={() => setShow(!show)}>{show ? 'Ocultar' : 'Ver'}</button>
            </div>
          </div>
          <div className="notice">
            A chave é enviada direto para api.anthropic.com. Com a sincronização ligada, ela vai para os seus outros aparelhos cifrada com a senha da sua conta — a nuvem só guarda texto cifrado. Use uma chave dedicada com limite de gasto no Console da Anthropic.
          </div>
          <div className="field">
            <label className="label">Modelo</label>
            <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Esforço de raciocínio</label>
            <select className="select" value={effort} onChange={(e) => setEffort(e.target.value)}>
              {EFFORTS.map((e) => <option key={e} value={e}>{{ low: 'Baixo (mais rápido)', medium: 'Médio (recomendado)', high: 'Alto (prints complexos)' }[e]}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Processar ao capturar</label>
            <select className="select" value={auto} onChange={(e) => setAuto(e.target.value)}>
              <option value="on">Automático</option>
              <option value="off">Manual (botão Processar)</option>
            </select>
          </div>
        </div>
      </Section>

      <Section title="🎙️ Transcrição de áudio" dot="yellow">
        <div className="stack">
          <div className="hint">
            Web Speech (navegador): {speechSupported() ? '🟢 disponível' : '🔴 indisponível'} · Gravação: {recorderSupported() ? '🟢 disponível' : '🔴 indisponível'}
          </div>
          <div className="field">
            <label className="label">OpenAI API key (opcional — Whisper)</label>
            <input className="input mono" type="password" autoComplete="off" placeholder="sk-…" value={openai} onChange={(e) => setOpenai(e.target.value)} />
            <span className="hint" style={{ marginTop: 6 }}>Com a chave, o áudio gravado é transcrito pelo Whisper (mais preciso). Sem ela (campo vazio), usa a transcrição ao vivo do navegador, que é grátis.</span>
            {openaiKeyProblem(openai.trim()) && <div className="error" style={{ marginTop: 8 }}>{openaiKeyProblem(openai.trim())}</div>}
            {openai.trim() && (
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  className="btn sm"
                  onClick={async () => {
                    setOaTest('Testando…');
                    try {
                      await testOpenAIKey(openai.trim());
                      setOaTest('🟢 Chave da OpenAI funcionando.');
                    } catch (e) {
                      setOaTest(`🔴 ${(e as Error).message}`);
                    }
                  }}
                >
                  Testar chave
                </button>
                <span className="hint" style={{ flex: 1 }}>{oaTest}</span>
              </div>
            )}
          </div>
        </div>
      </Section>

      <div className="row">
        <span className="hint">{saved}</span>
        <span className="spacer" />
        <button className="btn primary" onClick={save}>Salvar configurações</button>
      </div>

      <SecurityPanel />

      <SyncPanel />

      <Section title="💾 Dados locais" dot="green">
        <div className="stack">
          <div className="hint">Os dados ficam neste aparelho e, com a sincronização ligada, também na sua nuvem Supabase. O backup JSON é uma cópia extra.</div>
          <div className="row">
            <button className="btn" onClick={doExport}>Exportar backup</button>
            <label className="btn">Importar backup<input type="file" accept="application/json" hidden onChange={(e) => doImport(e.target.files?.[0])} /></label>
          </div>
          {msg && <div className="hint">{msg}</div>}
          <button
            className="btn danger"
            onClick={async () => {
              if (!wipe) return setWipe(true);
              // Apaga só este aparelho; com sincronização ligada, tudo volta da nuvem ao recarregar.
              Object.keys(localStorage).filter((k) => k.startsWith('nexus.')).forEach((k) => localStorage.removeItem(k));
              await db.delete();
              location.reload();
            }}
          >
            {wipe ? 'Confirmar: apagar dados deste aparelho' : 'Apagar dados deste aparelho'}
          </button>
        </div>
      </Section>
    </div>
  );
}
