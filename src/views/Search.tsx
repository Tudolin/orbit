import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type AgendaEvent, type Note, type Task } from '../db';
import { Empty, EventEditor, EventItem, NoteCard, NoteEditor, Section, TaskEditor, TaskItem, useNoteWsName, useWorkspaces, useWsName } from '../components/ui';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Modo Consulta — busca global em tarefas, eventos e notas do Segundo Cérebro. */
export function Search() {
  const [q, setQ] = useState('');
  const [ws, setWs] = useState('');
  const workspaces = useWorkspaces();
  const wsName = useWsName();
  const noteWsName = useNoteWsName();
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) ?? [];
  const events = useLiveQuery(() => db.events.toArray(), []) ?? [];
  const notes = useLiveQuery(() => db.notes.toArray(), []) ?? [];
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editEv, setEditEv] = useState<AgendaEvent | null>(null);
  const [editNote, setEditNote] = useState<Note | null>(null);

  // Termos com "#" casam tags; os demais casam texto, nome do workspace e tags. Todos precisam casar (AND).
  const terms = useMemo(() => norm(q).split(/\s+/).filter(Boolean), [q]);
  const matches = (text: string, tags: string[], wsId: string, wsIds?: string[]) => {
    if (ws && wsId !== ws && !wsIds?.includes(ws)) return false;
    if (!terms.length) return !!ws;
    const hay = norm(`${text} ${wsName(wsId)} ${tags.join(' ')}`);
    const tagHay = tags.map((t) => norm(t.startsWith('#') ? t : `#${t}`));
    return terms.every((t) => (t.startsWith('#') ? tagHay.some((h) => h.includes(t)) || norm('#' + wsName(wsId).replace(/\s+/g, '-')).includes(t) : hay.includes(t)));
  };

  const rNotes = notes.filter((n) => matches(`${n.titulo ?? ''} ${n.resumo} ${n.decisoes.join(' ')} ${n.participantes.join(' ')}`, n.tags, n.workspaceIds?.[0] ?? n.workspaceId, n.workspaceIds)).sort((a, b) => b.createdAt - a.createdAt);
  const rTasks = tasks.filter((t) => matches(`${t.descricao} ${t.origem}`, t.tags, t.workspaceId));
  const rEvents = events.filter((e) => matches(`${e.titulo} ${e.origem}`, e.tags, e.workspaceId));
  const total = rNotes.length + rTasks.length + rEvents.length;
  const active = terms.length > 0 || !!ws;

  const allTags = useMemo(() => {
    const m = new Map<string, number>();
    [...notes, ...tasks].forEach((x) => x.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
  }, [notes, tasks]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <input className="input" type="search" autoFocus placeholder="🔍 Buscar por palavra-chave ou #tag…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="row" style={{ gap: 6 }}>
        <button className={`chip ${ws === '' ? 'ws' : ''}`} style={{ background: ws === '' ? 'var(--surface-2)' : 'transparent', cursor: 'pointer' }} onClick={() => setWs('')}>Todos</button>
        {workspaces.map((w) => (
          <button key={w.id} className="chip" style={{ cursor: 'pointer', color: ws === w.id ? 'var(--bg)' : undefined, background: ws === w.id ? 'var(--text)' : 'transparent' }} onClick={() => setWs(ws === w.id ? '' : w.id)}>
            {w.nome}
          </button>
        ))}
      </div>
      {!active && allTags.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="label">Tags frequentes</div>
          <div className="tags">
            {allTags.map((t) => (
              <button key={t} className="chip" style={{ cursor: 'pointer', background: 'transparent' }} onClick={() => setQ(t.startsWith('#') ? t : `#${t}`)}>{t.startsWith('#') ? t : `#${t}`}</button>
            ))}
          </div>
        </div>
      )}

      {active && (
        <>
          <div className="view-title">🔍 Resultado da busca: {q || wsName(ws)} · {total}</div>
          <Section title="🧠 Segundo Cérebro" dot="yellow" count={rNotes.length} flush>
            {rNotes.length === 0 ? <Empty>Nenhuma nota.</Empty> : rNotes.map((n) => <NoteCard key={n.id} note={n} wsName={noteWsName(n)} onEdit={() => setEditNote(n)} />)}
          </Section>
          <Section title="✅ Tarefas" dot="orange" count={rTasks.length} flush>
            {rTasks.length === 0 ? <Empty>Nenhuma tarefa.</Empty> : rTasks.map((t) => <TaskItem key={t.id} task={t} wsName={wsName(t.workspaceId)} onEdit={() => setEditTask(t)} />)}
          </Section>
          <Section title="📅 Eventos" dot="blue" count={rEvents.length} flush>
            {rEvents.length === 0 ? <Empty>Nenhum evento.</Empty> : rEvents.map((e) => <EventItem key={e.id} ev={e} wsName={wsName(e.workspaceId)} onEdit={() => setEditEv(e)} />)}
          </Section>
        </>
      )}

      {editTask && <TaskEditor task={editTask} defaultWs={editTask.workspaceId} onClose={() => setEditTask(null)} />}
      {editEv && <EventEditor ev={editEv} defaultWs={editEv.workspaceId} onClose={() => setEditEv(null)} />}
      {editNote && <NoteEditor note={editNote} defaultWs={editNote.workspaceId} onClose={() => setEditNote(null)} />}
    </div>
  );
}
