import { useEffect, useState } from 'react';
import { commitCapture, db, uid, type Capture, type Prioridade } from '../db';
import { captureOrigem, runCapture } from '../pipeline';
import { blockers, buildRecords, principalOf, slug, toDraft, type Draft, type DraftEvent, type DraftTask } from '../triage';
import { fmtDateTime, fromLocalInput, toLocalInput } from '../dates';
import { Tags, useWorkspaces } from '../components/ui';

const NEW_WS = '__new__';

/** Marcador de inferência: toque para confirmar o valor sugerido pela IA. */
function Inferred({ on, label, onConfirm }: { on: boolean; label: string; onConfirm: () => void }) {
  if (!on) return null;
  return (
    <button className="chip yellow inferred" title={`${label} inferido pela IA — toque para confirmar`} onClick={onConfirm}>
      ≈ {label}
    </button>
  );
}

/** Modelo 1 — triagem com workspace por item, indicadores de inferência e divisão por workspace. */
export function Review({ capture }: { capture: Capture }) {
  const workspaces = useWorkspaces();
  const [d, setD] = useState<Draft | null>(null);

  useEffect(() => {
    if (!d && workspaces.length && capture.resultado) setD(toDraft(capture.resultado, workspaces, captureOrigem(capture)));
  }, [workspaces, capture, d]);
  if (!d) return null;

  const byId = new Map(workspaces.map((w) => [w.id, w]));
  const { principal, ids } = principalOf(d);
  const blocks = blockers(d);
  const isMulti = principal === 'multi';

  const setTask = (key: string, patch: Partial<DraftTask>) => setD({ ...d, tasks: d.tasks.map((t) => (t.key === key ? { ...t, ...patch } : t)) });
  const setEvent = (key: string, patch: Partial<DraftEvent>) => setD({ ...d, events: d.events.map((e) => (e.key === key ? { ...e, ...patch } : e)) });

  /** Seletor de workspace; "+ Novo…" cria na hora. */
  const pickWorkspace = async (value: string, apply: (id: string | null) => void) => {
    if (value !== NEW_WS) return apply(value || null);
    const nome = window.prompt('Nome do novo workspace')?.trim();
    if (!nome) return;
    const id = uid();
    await db.workspaces.add({ id, nome, ordem: workspaces.length, createdAt: Date.now() });
    apply(id);
  };

  const WsSelect = ({ value, onChange, missing }: { value: string | null; onChange: (id: string | null) => void; missing: boolean }) => (
    <select className={`select sm-select ${missing ? 'missing' : ''}`} value={value ?? ''} onChange={(e) => pickWorkspace(e.target.value, onChange)}>
      <option value="">— escolher workspace —</option>
      {workspaces.map((w) => (
        <option key={w.id} value={w.id}>{w.nome}</option>
      ))}
      <option value={NEW_WS}>+ Novo workspace…</option>
    </select>
  );

  const approve = async () => {
    if (blocks.length) return;
    await commitCapture(capture.id, buildRecords(d, capture.id, workspaces, uid));
  };

  const tags = [...ids.map((id) => (byId.has(id) ? `#${slug(byId.get(id)!.nome)}` : '')).filter(Boolean), ...d.tagsBase];
  const wsLabel = isMulti ? ids.map((id) => byId.get(id)?.nome).join(' + ') : principal ? byId.get(principal)?.nome : null;

  return (
    <div className="stack" style={{ padding: '0 14px 14px', gap: 16 }}>
      <div className="stack" style={{ gap: 6 }}>
        <textarea className="input title-input" rows={2} value={d.titulo} onChange={(e) => setD({ ...d, titulo: e.target.value })} aria-label="Título da captura" />
        <div className="row" style={{ gap: 6 }}>
          <span className="label" style={{ margin: 0 }}>📌 Workspace</span>
          {isMulti ? <span className="chip blue">MULTI · {wsLabel}</span> : wsLabel ? <span className="chip ws">{wsLabel}</span> : <span className="chip red">INDEFINIDO</span>}
        </div>
        <Tags tags={tags} />
      </div>

      {isMulti && (
        <div className="notice stack" style={{ gap: 8 }}>
          <div>Esta captura envolve {ids.length} workspaces.</div>
          <label className="row" style={{ cursor: 'pointer', flexWrap: 'nowrap' }}>
            <input type="checkbox" checked={d.dividir} onChange={() => setD({ ...d, dividir: !d.dividir })} />
            <b>Dividir por workspace</b>
          </label>
          {d.dividir && (
            <ul className="plain hint">
              {ids.map((id) => <li key={id}>{d.titulo} — {byId.get(id)?.nome}</li>)}
              <li>Original arquivada como #status/dividida</li>
            </ul>
          )}
        </div>
      )}

      {d.events.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="label" style={{ margin: 0 }}>📅 Agenda & Prazos</div>
          {d.events.map((e) => (
            <div key={e.key} className={`triage-item ${e.incluir && !e.workspaceId ? 'blocked' : ''}`} style={{ opacity: e.incluir ? 1 : 0.45 }}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input type="checkbox" checked={e.incluir} onChange={() => setEvent(e.key, { incluir: !e.incluir })} aria-label="Incluir evento" />
                <span className="dot blue" />
                <span style={{ flex: 1, fontWeight: 600 }}>{e.titulo}</span>
                <span className="mono hint">{fmtDateTime(e.inicio)}</span>
              </div>
              <div className="row triage-controls">
                <WsSelect value={e.workspaceId} missing={e.incluir && !e.workspaceId} onChange={(id) => setEvent(e.key, { workspaceId: id, incerto: false })} />
                <Inferred on={e.incerto && !!e.workspaceId} label="workspace" onConfirm={() => setEvent(e.key, { incerto: false })} />
              </div>
            </div>
          ))}
        </div>
      )}

      {d.tasks.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="label" style={{ margin: 0 }}>✅ Tarefas / Action Items</div>
          {d.tasks.map((t) => (
            <div key={t.key} className={`triage-item ${t.incluir && !t.workspaceId ? 'blocked' : ''}`} style={{ opacity: t.incluir ? 1 : 0.45 }}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input type="checkbox" checked={t.incluir} onChange={() => setTask(t.key, { incluir: !t.incluir })} aria-label="Incluir tarefa" />
                <span className={`dot ${t.prioridade === 'alta' ? 'red' : 'orange'}`} />
                <input className="input inline-input" value={t.titulo} onChange={(ev) => setTask(t.key, { titulo: ev.target.value })} aria-label="Título da tarefa" />
              </div>
              <div className="row triage-controls">
                <WsSelect value={t.workspaceId} missing={t.incluir && !t.workspaceId} onChange={(id) => setTask(t.key, { workspaceId: id, incerto: false })} />
                <Inferred on={t.incerto && !!t.workspaceId} label="workspace" onConfirm={() => setTask(t.key, { incerto: false })} />
              </div>
              <div className="row triage-controls">
                <select className="select sm-select" value={t.prioridade} onChange={(ev) => setTask(t.key, { prioridade: ev.target.value as Prioridade, prioridadeInferida: false })}>
                  <option value="alta">🔴 Alta</option>
                  <option value="media">🟠 Média</option>
                  <option value="baixa">⚪ Baixa</option>
                </select>
                <Inferred on={t.prioridadeInferida} label="prioridade" onConfirm={() => setTask(t.key, { prioridadeInferida: false })} />
              </div>
              <div className="row triage-controls">
                <input
                  className="input sm-select"
                  type="datetime-local"
                  value={toLocalInput(t.prazo)}
                  onChange={(ev) => setTask(t.key, { prazo: fromLocalInput(ev.target.value), prazoInferido: false })}
                  aria-label="Prazo"
                />
                <Inferred on={t.prazoInferido} label="prazo" onConfirm={() => setTask(t.key, { prazoInferido: false })} />
                {t.recorrencia && <span className="chip blue">↻ {t.recorrencia}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {(d.resumo || d.decisoes.length > 0) && (
        <div className="stack" style={{ gap: 6, opacity: d.incluirNota ? 1 : 0.45 }}>
          <label className="row label" style={{ cursor: 'pointer', margin: 0 }}>
            <input type="checkbox" checked={d.incluirNota} onChange={() => setD({ ...d, incluirNota: !d.incluirNota })} /> 🧠 Segundo Cérebro
          </label>
          <blockquote className="stack" style={{ gap: 6 }}>
            <div>🟡 <b>Resumo:</b> {d.resumo}</div>
            {d.decisoes.length > 0 && <ul className="plain">{d.decisoes.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            {d.participantes.length > 0 && <div>👤 <b>Participantes:</b> {d.participantes.join(', ')}</div>}
          </blockquote>
          {d.incluirNota && !principal && (
            <div className="row triage-controls">
              <span className="hint">Salvar nota em:</span>
              <WsSelect value={d.noteWorkspaceId} missing onChange={(id) => setD({ ...d, noteWorkspaceId: id })} />
            </div>
          )}
        </div>
      )}

      {blocks.length > 0 && <div className="error">Para aprovar, defina: {blocks.join(' · ')}.</div>}
      <div className="row">
        <button className="btn ghost sm" onClick={() => runCapture(capture.id)}>Reprocessar</button>
        <button className="btn ghost sm" onClick={() => db.captures.delete(capture.id)}>Descartar</button>
        <span className="spacer" />
        <button className="btn primary" disabled={blocks.length > 0} onClick={approve}>Aprovar</button>
      </div>
    </div>
  );
}
