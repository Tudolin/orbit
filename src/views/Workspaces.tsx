import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteWorkspace, moveWorkspace, uid, type AgendaEvent, type Note, type Task, type TaskStatus } from '../db';
import { parseISO } from '../dates';
import { Empty, EventEditor, EventItem, NoteCard, NoteEditor, PRIO_RANK, Section, Sheet, STATUS_LABEL, TaskEditor, TaskItem, useWorkspaces } from '../components/ui';

export function Workspaces({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const workspaces = useWorkspaces();
  const counts = useLiveQuery(async () => {
    const tasks = await db.tasks.where('status').notEqual('concluido').toArray();
    const m: Record<string, number> = {};
    tasks.forEach((t) => (m[t.workspaceId] = (m[t.workspaceId] ?? 0) + 1));
    return m;
  }, []) ?? {};
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; nome: string } | null>(null);

  const current = workspaces.find((w) => w.id === openId);
  if (current) return <WorkspaceDetail id={current.id} nome={current.nome} onBack={() => onOpen(null)} />;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Section title="Workspaces" count={workspaces.length} flush action={<button className="btn sm" onClick={() => setCreating(true)}>+ Novo</button>}>
        {workspaces.length === 0 && <Empty>Crie seu primeiro workspace.</Empty>}
        {workspaces.map((w, i) => (
          <div key={w.id} className="item" style={{ alignItems: 'center' }}>
            <span className="dot" style={{ background: 'var(--text)' }} />
            <div className="item-main" style={{ cursor: 'pointer' }} onClick={() => onOpen(w.id)}>
              <div className="item-title">{w.nome}</div>
              <div className="item-meta"><span className="mono">{counts[w.id] ?? 0} tarefas abertas</span></div>
            </div>
            <button className="btn ghost sm" disabled={i === 0} onClick={() => moveWorkspace(w.id, -1)} aria-label="Mover para cima">↑</button>
            <button className="btn ghost sm" disabled={i === workspaces.length - 1} onClick={() => moveWorkspace(w.id, 1)} aria-label="Mover para baixo">↓</button>
            <button className="btn ghost sm" onClick={() => setRenaming({ id: w.id, nome: w.nome })}>Editar</button>
          </div>
        ))}
      </Section>
      {creating && (
        <NameSheet title="Novo workspace" initial="" onClose={() => setCreating(false)} onSave={(nome) => db.workspaces.add({ id: uid(), nome, ordem: workspaces.length, createdAt: Date.now() })} />
      )}
      {renaming && (
        <NameSheet
          title="Editar workspace"
          initial={renaming.nome}
          onClose={() => setRenaming(null)}
          onSave={(nome) => db.workspaces.update(renaming.id, { nome })}
          onDelete={() => deleteWorkspace(renaming.id)}
        />
      )}
    </div>
  );
}

function NameSheet(props: { title: string; initial: string; onClose: () => void; onSave: (nome: string) => unknown; onDelete?: () => unknown }) {
  const [nome, setNome] = useState(props.initial);
  const [confirm, setConfirm] = useState(false);
  return (
    <Sheet title={props.title} onClose={props.onClose}>
      <div className="field">
        <label className="label">Nome</label>
        <input className="input" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={async (e) => { if (e.key === 'Enter' && nome.trim()) { await props.onSave(nome.trim()); props.onClose(); } }} />
      </div>
      {confirm && <div className="error">Excluir apaga também todos os eventos, tarefas e notas deste workspace. Toque de novo para confirmar.</div>}
      <div className="row">
        {props.onDelete && (
          <button className="btn danger" onClick={async () => { if (!confirm) return setConfirm(true); await props.onDelete!(); props.onClose(); }}>
            {confirm ? 'Confirmar exclusão' : 'Excluir'}
          </button>
        )}
        <span className="spacer" />
        <button className="btn primary" disabled={!nome.trim()} onClick={async () => { await props.onSave(nome.trim()); props.onClose(); }}>Salvar</button>
      </div>
    </Sheet>
  );
}

type Tab = 'agenda' | 'kanban' | 'cerebro';

function WorkspaceDetail({ id, nome, onBack }: { id: string; nome: string; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('kanban');
  const events = useLiveQuery(() => db.events.where('workspaceId').equals(id).toArray(), [id]) ?? [];
  const tasks = useLiveQuery(() => db.tasks.where('workspaceId').equals(id).toArray(), [id]) ?? [];
  const notes = useLiveQuery(() => db.notes.where('workspaceId').equals(id).reverse().sortBy('createdAt'), [id]) ?? [];
  const [editTask, setEditTask] = useState<Task | null | 'new'>(null);
  const [editEv, setEditEv] = useState<AgendaEvent | null | 'new'>(null);
  const [editNote, setEditNote] = useState<Note | null | 'new'>(null);
  const [showPast, setShowPast] = useState(false);

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const sortedEv = [...events].sort((a, b) => (parseISO(a.inicio)?.getTime() ?? 0) - (parseISO(b.inicio)?.getTime() ?? 0));
  const upcoming = sortedEv.filter((e) => (parseISO(e.fim ?? e.inicio) ?? now) >= now);
  const past = sortedEv.filter((e) => (parseISO(e.fim ?? e.inicio) ?? now) < now).reverse();
  const deadlines = tasks.filter((t) => t.prazo && t.status !== 'concluido').sort((a, b) => parseISO(a.prazo)!.getTime() - parseISO(b.prazo)!.getTime());

  const cols: { status: TaskStatus; dot: string }[] = [
    { status: 'pendente', dot: 'red' },
    { status: 'em-andamento', dot: 'orange' },
    { status: 'concluido', dot: 'green' },
  ];
  const order: TaskStatus[] = ['pendente', 'em-andamento', 'concluido'];
  const move = (t: Task, d: -1 | 1) => db.tasks.update(t.id, { status: order[order.indexOf(t.status) + d] });

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row">
        <button className="btn icon" onClick={onBack} aria-label="Voltar">←</button>
        <div>
          <div className="view-title">Workspace</div>
          <div className="big">{nome}</div>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {([['agenda', '📅 Agenda'], ['kanban', '✅ Kanban'], ['cerebro', '🧠 Cérebro']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'agenda' && (
        <>
          <Section title="Próximos eventos" dot="blue" count={upcoming.length} flush action={<button className="btn sm" onClick={() => setEditEv('new')}>+ Evento</button>}>
            {upcoming.length === 0 ? <Empty>Nenhum evento futuro.</Empty> : upcoming.map((e) => <DatedEvent key={e.id} ev={e} onEdit={() => setEditEv(e)} />)}
          </Section>
          <Section title="Prazos" dot="red" count={deadlines.length} flush>
            {deadlines.length === 0 ? <Empty>Sem prazos abertos.</Empty> : deadlines.map((t) => <TaskItem key={t.id} task={t} onEdit={() => setEditTask(t)} />)}
          </Section>
          {past.length > 0 && (
            <button className="btn ghost sm" onClick={() => setShowPast(!showPast)}>{showPast ? 'Ocultar' : 'Mostrar'} {past.length} eventos passados</button>
          )}
          {showPast && <Section title="Passados" flush>{past.map((e) => <DatedEvent key={e.id} ev={e} onEdit={() => setEditEv(e)} />)}</Section>}
        </>
      )}

      {tab === 'kanban' && (
        <>
          <button className="btn" onClick={() => setEditTask('new')}>+ Nova tarefa</button>
          <div className="kanban">
            {cols.map((c) => {
              const list = tasks
                .filter((t) => t.status === c.status)
                .sort((a, b) => PRIO_RANK[a.prioridade] - PRIO_RANK[b.prioridade] || (parseISO(a.prazo)?.getTime() ?? Infinity) - (parseISO(b.prazo)?.getTime() ?? Infinity));
              return (
                <div key={c.status} className="col">
                  <div className="section-h"><span className={`dot ${c.dot}`} />{STATUS_LABEL[c.status]}<span className="count">{list.length}</span></div>
                  {list.length === 0 && <Empty>—</Empty>}
                  {list.map((t) => (
                    <div key={t.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <TaskItem task={t} onEdit={() => setEditTask(t)} />
                      <div className="row" style={{ padding: '0 14px 10px', justifyContent: 'flex-end' }}>
                        {c.status !== 'pendente' && <button className="btn sm" onClick={() => move(t, -1)}>← {STATUS_LABEL[order[order.indexOf(c.status) - 1]]}</button>}
                        {c.status !== 'concluido' && <button className="btn sm" onClick={() => move(t, 1)}>{STATUS_LABEL[order[order.indexOf(c.status) + 1]]} →</button>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === 'cerebro' && (
        <Section title="Base de conhecimento" dot="yellow" count={notes.length} flush action={<button className="btn sm" onClick={() => setEditNote('new')}>+ Nota</button>}>
          {notes.length === 0 ? <Empty>Sem notas. Capturas processadas alimentam esta base.</Empty> : notes.map((n) => <NoteCard key={n.id} note={n} onEdit={() => setEditNote(n)} />)}
        </Section>
      )}

      {editTask && <TaskEditor task={editTask === 'new' ? undefined : editTask} defaultWs={id} onClose={() => setEditTask(null)} />}
      {editEv && <EventEditor ev={editEv === 'new' ? undefined : editEv} defaultWs={id} onClose={() => setEditEv(null)} />}
      {editNote && <NoteEditor note={editNote === 'new' ? undefined : editNote} defaultWs={id} onClose={() => setEditNote(null)} />}
    </div>
  );
}

function DatedEvent({ ev, onEdit }: { ev: AgendaEvent; onEdit: () => void }) {
  const d = parseISO(ev.inicio);
  return (
    <div>
      <div className="hint mono" style={{ padding: '8px 14px 0' }}>{d ? d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) : ''}</div>
      <EventItem ev={ev} onEdit={onEdit} />
    </div>
  );
}
