import { useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type AgendaEvent, type Note, type Prioridade, type Task, type TaskStatus, type Workspace } from '../db';
import { fmtDateTime, fmtTime, fromLocalInput, parseISO, toLocalInput } from '../dates';

export function useWorkspaces(): Workspace[] {
  return useLiveQuery(() => db.workspaces.orderBy('ordem').toArray(), []) ?? [];
}

export function useWsName(): (id: string) => string {
  const ws = useWorkspaces();
  return (id) => ws.find((w) => w.id === id)?.nome ?? '—';
}

export function Section(props: { title: ReactNode; dot?: string; count?: number; children: ReactNode; flush?: boolean; action?: ReactNode }) {
  return (
    <section className="section">
      <header className="section-h">
        {props.dot && <span className={`dot ${props.dot}`} />}
        <span>{props.title}</span>
        {props.count !== undefined && <span className="count">{props.count}</span>}
        {props.action && <span style={{ marginLeft: props.count === undefined ? 'auto' : 8 }}>{props.action}</span>}
      </header>
      <div className={`section-b ${props.flush ? 'flush' : ''}`}>{props.children}</div>
    </section>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export const PRIO_LABEL: Record<Prioridade, string> = { alta: 'ALTA', media: 'MÉDIA', baixa: 'BAIXA' };
export const PRIO_RANK: Record<Prioridade, number> = { alta: 0, media: 1, baixa: 2 };
export const STATUS_LABEL: Record<TaskStatus, string> = { pendente: 'Pendente', 'em-andamento': 'Em andamento', concluido: 'Concluído' };

export function taskColor(t: Task): string {
  if (t.status === 'concluido') return 'green';
  if (t.prioridade === 'alta') return 'red';
  return 'orange';
}

export function isOverdue(t: Task): boolean {
  const d = parseISO(t.prazo);
  return !!d && t.status !== 'concluido' && d.getTime() < Date.now();
}

export function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="tags">
      {tags.map((t) => (
        <span key={t} className="chip">
          {t.startsWith('#') ? t : `#${t}`}
        </span>
      ))}
    </span>
  );
}

export function TaskItem({ task, wsName, onEdit }: { task: Task; wsName?: string; onEdit?: () => void }) {
  const done = task.status === 'concluido';
  const toggle = () => db.tasks.update(task.id, { status: done ? 'pendente' : 'concluido' });
  return (
    <div className={`item ${done ? 'done' : ''}`}>
      <button className={`check ${done ? 'on' : ''}`} onClick={toggle} aria-label={done ? 'Reabrir' : 'Concluir'} />
      <div className="item-main" onClick={onEdit} style={{ cursor: onEdit ? 'pointer' : undefined }}>
        <div className="item-title">{task.descricao}</div>
        <div className="item-meta">
          <span className={`chip ${task.prioridade === 'alta' ? 'red' : task.prioridade === 'media' ? 'orange' : ''}`}>{PRIO_LABEL[task.prioridade]}</span>
          {task.status === 'em-andamento' && <span className="chip orange">EM ANDAMENTO</span>}
          <span className="mono" style={{ color: isOverdue(task) ? 'var(--red)' : undefined }}>
            {fmtDateTime(task.prazo)}
          </span>
          {wsName && <span className="chip ws">{wsName}</span>}
          <span className="mono">{task.origem}</span>
        </div>
      </div>
      <span className={`dot ${taskColor(task)}`} />
    </div>
  );
}

export function EventItem({ ev, wsName, onEdit }: { ev: AgendaEvent; wsName?: string; onEdit?: () => void }) {
  const s = parseISO(ev.inicio);
  const e = parseISO(ev.fim);
  const jira = ev.origem === 'jira';
  return (
    <div className="item" onClick={onEdit} style={{ cursor: onEdit ? 'pointer' : undefined }}>
      <span className={`dot ${jira ? 'orange' : 'blue'}`} />
      <span className="time">
        {s ? fmtTime(s) : '--:--'}
        {e ? ` – ${fmtTime(e)}` : ''}
      </span>
      <div className="item-main">
        <div className="item-title">{ev.titulo}</div>
        <div className="item-meta">
          {wsName && <span className="chip ws">{wsName}</span>}
          <span className="mono">{ev.origem}</span>
        </div>
      </div>
    </div>
  );
}

export function NoteCard({ note, wsName, onEdit }: { note: Note; wsName?: string; onEdit?: () => void }) {
  return (
    <div className="item" onClick={onEdit} style={{ cursor: onEdit ? 'pointer' : undefined }}>
      <span className="dot yellow" />
      <div className="item-main stack" style={{ gap: 8 }}>
        <div className="item-title" style={{ fontWeight: 500 }}>{note.resumo || '(sem resumo)'}</div>
        {note.decisoes.length > 0 && (
          <div>
            <div className="label" style={{ marginBottom: 4 }}>Decisões</div>
            <ul className="plain">
              {note.decisoes.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="item-meta">
          {wsName && <span className="chip ws">{wsName}</span>}
          <span className="mono">{new Date(note.createdAt).toLocaleDateString('pt-BR')}</span>
          {note.participantes.length > 0 && <span>👤 {note.participantes.join(', ')}</span>}
          <Tags tags={note.tags} />
        </div>
      </div>
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet stack" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <div className="view-title" style={{ color: 'var(--text)' }}>{title}</div>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={onClose}>Fechar</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function WorkspaceSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const ws = useWorkspaces();
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {ws.map((w) => (
        <option key={w.id} value={w.id}>
          {w.nome}
        </option>
      ))}
    </select>
  );
}

const splitList = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const splitTags = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

// ---------- Editors ----------

export function TaskEditor({ task, defaultWs, onClose }: { task?: Task; defaultWs: string; onClose: () => void }) {
  const [d, setD] = useState<Task>(
    task ?? { id: uid(), workspaceId: defaultWs, descricao: '', prazo: null, prioridade: 'media', status: 'pendente', origem: 'texto', tags: [], createdAt: Date.now() },
  );
  const [tags, setTags] = useState(d.tags.join(' '));
  const save = async () => {
    if (!d.descricao.trim()) return;
    await db.tasks.put({ ...d, tags: splitTags(tags) });
    onClose();
  };
  return (
    <Sheet title={task ? 'Editar tarefa' : 'Nova tarefa'} onClose={onClose}>
      <div className="field"><label className="label">Descrição</label><input className="input" autoFocus value={d.descricao} onChange={(e) => setD({ ...d, descricao: e.target.value })} /></div>
      <div className="field"><label className="label">Prazo</label><input className="input" type="datetime-local" value={toLocalInput(d.prazo)} onChange={(e) => setD({ ...d, prazo: fromLocalInput(e.target.value) })} /></div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="label">Prioridade</label>
          <select className="select" value={d.prioridade} onChange={(e) => setD({ ...d, prioridade: e.target.value as Prioridade })}>
            <option value="alta">🔴 Alta</option><option value="media">🟠 Média</option><option value="baixa">⚪ Baixa</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="label">Status</label>
          <select className="select" value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as TaskStatus })}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label className="label">Workspace</label><WorkspaceSelect value={d.workspaceId} onChange={(workspaceId) => setD({ ...d, workspaceId })} /></div>
      <div className="field"><label className="label">Tags</label><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#empresa-a #prio/alta" /></div>
      <div className="row">
        {task && <button className="btn danger" onClick={async () => { await db.tasks.delete(task.id); onClose(); }}>Excluir</button>}
        <span className="spacer" />
        <button className="btn primary" onClick={save}>Salvar</button>
      </div>
    </Sheet>
  );
}

export function EventEditor({ ev, defaultWs, onClose }: { ev?: AgendaEvent; defaultWs: string; onClose: () => void }) {
  const [d, setD] = useState<AgendaEvent>(
    ev ?? { id: uid(), workspaceId: defaultWs, titulo: '', inicio: new Date().toISOString(), fim: null, origem: 'texto', tags: [], createdAt: Date.now() },
  );
  const save = async () => {
    if (!d.titulo.trim() || !d.inicio) return;
    await db.events.put(d);
    onClose();
  };
  return (
    <Sheet title={ev ? 'Editar evento' : 'Novo evento'} onClose={onClose}>
      <div className="field"><label className="label">Título</label><input className="input" autoFocus value={d.titulo} onChange={(e) => setD({ ...d, titulo: e.target.value })} /></div>
      <div className="field"><label className="label">Início</label><input className="input" type="datetime-local" value={toLocalInput(d.inicio)} onChange={(e) => setD({ ...d, inicio: fromLocalInput(e.target.value) ?? d.inicio })} /></div>
      <div className="field"><label className="label">Fim</label><input className="input" type="datetime-local" value={toLocalInput(d.fim)} onChange={(e) => setD({ ...d, fim: fromLocalInput(e.target.value) })} /></div>
      <div className="field"><label className="label">Workspace</label><WorkspaceSelect value={d.workspaceId} onChange={(workspaceId) => setD({ ...d, workspaceId })} /></div>
      <div className="row">
        {ev && <button className="btn danger" onClick={async () => { await db.events.delete(ev.id); onClose(); }}>Excluir</button>}
        <span className="spacer" />
        <button className="btn primary" onClick={save}>Salvar</button>
      </div>
    </Sheet>
  );
}

export function NoteEditor({ note, defaultWs, onClose }: { note?: Note; defaultWs: string; onClose: () => void }) {
  const [d, setD] = useState<Note>(note ?? { id: uid(), workspaceId: defaultWs, resumo: '', decisoes: [], participantes: [], tags: [], createdAt: Date.now() });
  const [decisoes, setDecisoes] = useState(d.decisoes.join('\n'));
  const [participantes, setParticipantes] = useState(d.participantes.join(', '));
  const [tags, setTags] = useState(d.tags.join(' '));
  const save = async () => {
    await db.notes.put({ ...d, decisoes: splitList(decisoes), participantes: participantes.split(',').map((x) => x.trim()).filter(Boolean), tags: splitTags(tags) });
    onClose();
  };
  return (
    <Sheet title={note ? 'Editar nota' : 'Nova nota'} onClose={onClose}>
      <div className="field"><label className="label">Resumo</label><textarea className="textarea" autoFocus value={d.resumo} onChange={(e) => setD({ ...d, resumo: e.target.value })} /></div>
      <div className="field"><label className="label">Decisões (uma por linha)</label><textarea className="textarea" style={{ minHeight: 80 }} value={decisoes} onChange={(e) => setDecisoes(e.target.value)} /></div>
      <div className="field"><label className="label">Participantes</label><input className="input" value={participantes} onChange={(e) => setParticipantes(e.target.value)} /></div>
      <div className="field"><label className="label">Workspace</label><WorkspaceSelect value={d.workspaceId} onChange={(workspaceId) => setD({ ...d, workspaceId })} /></div>
      <div className="field"><label className="label">Tags</label><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} /></div>
      <div className="row">
        {note && <button className="btn danger" onClick={async () => { await db.notes.delete(note.id); onClose(); }}>Excluir</button>}
        <span className="spacer" />
        <button className="btn primary" onClick={save}>Salvar</button>
      </div>
    </Sheet>
  );
}
