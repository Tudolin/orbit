import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type AgendaEvent, type Task } from '../db';
import { addDays, fmtDate, fmtDayLong, isoWeek, parseISO, sameDay, startOfDay, startOfWeek, WEEKDAYS } from '../dates';
import { Empty, EventEditor, EventItem, PRIO_RANK, Section, TaskEditor, TaskItem, useWorkspaces, useWsName } from '../components/ui';

function useAll() {
  const events = useLiveQuery(() => db.events.toArray(), []) ?? [];
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) ?? [];
  return { events, tasks };
}

const byStart = (a: AgendaEvent, b: AgendaEvent) => (parseISO(a.inicio)?.getTime() ?? 0) - (parseISO(b.inicio)?.getTime() ?? 0);
const byPrio = (a: Task, b: Task) =>
  PRIO_RANK[a.prioridade] - PRIO_RANK[b.prioridade] || (parseISO(a.prazo)?.getTime() ?? Infinity) - (parseISO(b.prazo)?.getTime() ?? Infinity);

/** Modelo 2 — Visão Diária Consolidada. */
export function Today() {
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const { events, tasks } = useAll();
  const wsName = useWsName();
  const ws = useWorkspaces();
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editEv, setEditEv] = useState<AgendaEvent | null>(null);
  const isToday = sameDay(day, new Date());
  const end = addDays(day, 1);

  const dayEvents = events.filter((e) => { const d = parseISO(e.inicio); return d && sameDay(d, day); }).sort(byStart);
  // Tarefas do dia: vencem hoje, ou atrasadas (só na visão de hoje), ou concluídas que venciam hoje.
  const dayTasks = tasks
    .filter((t) => {
      const d = parseISO(t.prazo);
      if (!d) return false;
      if (d >= day && d < end) return true;
      return isToday && d < day && t.status !== 'concluido';
    })
    .sort((a, b) => Number(a.status === 'concluido') - Number(b.status === 'concluido') || byPrio(a, b));
  const critical = dayTasks.filter((t) => t.prioridade === 'alta' && t.status !== 'concluido');
  const noDeadline = isToday ? tasks.filter((t) => !t.prazo && t.status === 'em-andamento').sort(byPrio) : [];
  const doneCount = dayTasks.filter((t) => t.status === 'concluido').length;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row">
        <button className="btn icon" onClick={() => setDay(addDays(day, -1))} aria-label="Dia anterior">←</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div className="view-title">Dashboard diário</div>
          <div className="big" style={{ fontSize: 16 }}>{isToday ? 'HOJE · ' : ''}{fmtDayLong(day)}</div>
        </div>
        <button className="btn icon" onClick={() => setDay(addDays(day, 1))} aria-label="Próximo dia">→</button>
      </div>
      {!isToday && <button className="btn sm" onClick={() => setDay(startOfDay(new Date()))}>Voltar para hoje</button>}

      <div className="grid grid-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Stat n={dayEvents.length} label="Eventos" color="blue" />
        <Stat n={dayTasks.length - doneCount} label="Pendentes" color="orange" />
        <Stat n={doneCount} label="Concluídas" color="green" />
      </div>

      <Section title="⚡ Prioridades máximas" dot="red" count={critical.length} flush>
        {critical.length === 0 ? <Empty>Nada crítico para {isToday ? 'hoje' : 'este dia'}.</Empty> : critical.map((t) => <TaskItem key={t.id} task={t} wsName={wsName(t.workspaceId)} onEdit={() => setEditTask(t)} />)}
      </Section>

      <div className="grid grid-2" style={{ background: 'transparent', border: 0, gap: 16 }}>
        <Section title="🕒 Linha do tempo" dot="blue" count={dayEvents.length} flush>
          {dayEvents.length === 0 ? <Empty>Sem compromissos.</Empty> : dayEvents.map((e) => <EventItem key={e.id} ev={e} wsName={wsName(e.workspaceId)} onEdit={() => setEditEv(e)} />)}
        </Section>
        <Section title="✅ Entregas do dia" dot="orange" count={dayTasks.length} flush>
          {dayTasks.length === 0 ? <Empty>Nenhuma tarefa com prazo neste dia.</Empty> : dayTasks.map((t) => <TaskItem key={t.id} task={t} wsName={wsName(t.workspaceId)} onEdit={() => setEditTask(t)} />)}
        </Section>
      </div>

      {noDeadline.length > 0 && (
        <Section title="Em andamento sem prazo" dot="orange" count={noDeadline.length} flush>
          {noDeadline.map((t) => <TaskItem key={t.id} task={t} wsName={wsName(t.workspaceId)} onEdit={() => setEditTask(t)} />)}
        </Section>
      )}

      {editTask && <TaskEditor task={editTask} defaultWs={ws[0]?.id ?? ''} onClose={() => setEditTask(null)} />}
      {editEv && <EventEditor ev={editEv} defaultWs={ws[0]?.id ?? ''} onClose={() => setEditEv(null)} />}
    </div>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div style={{ padding: '12px 14px' }}>
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><span className={`dot ${color}`} /><span className="view-title" style={{ fontSize: 10, letterSpacing: '0.08em' }}>{label}</span></div>
      <div className="big mono" style={{ marginTop: 4 }}>{n}</div>
    </div>
  );
}

/** Modelo 3 — Visão Semanal Modular (matriz workspace × dia). */
export function Week() {
  const [start, setStart] = useState(() => startOfWeek(new Date()));
  const [sel, setSel] = useState<{ ws: string; day: number } | null>(null);
  const { events, tasks } = useAll();
  const workspaces = useWorkspaces();
  const wsName = useWsName();
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editEv, setEditEv] = useState<AgendaEvent | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const end = addDays(start, 7);
  const today = new Date();

  const inWeek = <T,>(items: T[], get: (x: T) => string | null) =>
    items.filter((x) => { const d = parseISO(get(x)); return d && d >= start && d < end; });
  const wEvents = inWeek(events, (e) => e.inicio);
  const wTasks = inWeek(tasks, (t) => t.prazo);

  const cell = (wsId: string, day: Date) => ({
    ev: wEvents.filter((e) => e.workspaceId === wsId && sameDay(parseISO(e.inicio)!, day)).sort(byStart),
    tk: wTasks.filter((t) => t.workspaceId === wsId && sameDay(parseISO(t.prazo)!, day)).sort(byPrio),
  });

  const selCell = sel ? cell(sel.ws, days[sel.day]) : null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row">
        <button className="btn icon" onClick={() => { setStart(addDays(start, -7)); setSel(null); }} aria-label="Semana anterior">←</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div className="view-title">Dashboard semanal</div>
          <div className="big" style={{ fontSize: 16 }}>SEMANA {String(isoWeek(start)).padStart(2, '0')}/{start.getFullYear()} · {fmtDate(start)}–{fmtDate(addDays(start, 6))}</div>
        </div>
        <button className="btn icon" onClick={() => { setStart(addDays(start, 7)); setSel(null); }} aria-label="Próxima semana">→</button>
      </div>

      <div className="row hint" style={{ gap: 14 }}>
        <span className="row" style={{ gap: 4 }}><span className="dot blue" /> eventos</span>
        <span className="row" style={{ gap: 4 }}><span className="dot orange" /> entregas</span>
        <span className="row" style={{ gap: 4 }}><span className="dot red" /> alta prioridade</span>
      </div>

      <div className="week-scroll">
      <div className="week">
        <div className="wh" />
        {days.map((d, i) => (
          <div key={i} className={`wh ${sameDay(d, today) ? 'today' : ''}`}>{WEEKDAYS[i]}<br />{d.getDate()}</div>
        ))}
        {workspaces.map((w) => (
          <Row key={w.id}>
            <div className="wl">{w.nome}</div>
            {days.map((d, i) => {
              const { ev, tk } = cell(w.id, d);
              const high = tk.filter((t) => t.prioridade === 'alta' && t.status !== 'concluido').length;
              const total = ev.length + tk.length;
              const heat = total === 0 ? '' : total < 2 ? 'heat-1' : total < 4 ? 'heat-2' : 'heat-3';
              const isSel = sel?.ws === w.id && sel.day === i;
              return (
                <div key={i} className={`cell ${heat} ${isSel ? 'sel' : ''}`} onClick={() => setSel(isSel ? null : { ws: w.id, day: i })}>
                  {ev.length > 0 && <span className="n"><span className="dot blue" />{ev.length}</span>}
                  {tk.length - high > 0 && <span className="n"><span className="dot orange" />{tk.length - high}</span>}
                  {high > 0 && <span className="n"><span className="dot red" />{high}</span>}
                </div>
              );
            })}
          </Row>
        ))}
      </div>
      </div>

      {sel && selCell && (
        <Section title={`${wsName(sel.ws)} · ${WEEKDAYS[sel.day]} ${fmtDate(days[sel.day])}`} flush>
          {selCell.ev.length + selCell.tk.length === 0 && <Empty>Nada neste dia.</Empty>}
          {selCell.ev.map((e) => <EventItem key={e.id} ev={e} onEdit={() => setEditEv(e)} />)}
          {selCell.tk.map((t) => <TaskItem key={t.id} task={t} onEdit={() => setEditTask(t)} />)}
        </Section>
      )}

      <Section title="📂 Entregas-chave por workspace" dot="orange" flush>
        {workspaces.map((w) => {
          const key = wTasks.filter((t) => t.workspaceId === w.id && t.status !== 'concluido').sort(byPrio).slice(0, 3);
          const done = wTasks.filter((t) => t.workspaceId === w.id && t.status === 'concluido').length;
          return (
            <div key={w.id} className="item">
              <div className="item-main">
                <div className="row"><b>{w.nome}</b><span className="spacer" />{done > 0 && <span className="chip green">{done} OK</span>}</div>
                {key.length === 0 ? (
                  <div className="hint" style={{ marginTop: 4 }}>Sem entregas pendentes na semana.</div>
                ) : (
                  <ul className="plain" style={{ marginTop: 6 }}>
                    {key.map((t) => (
                      <li key={t.id} onClick={() => setEditTask(t)} style={{ cursor: 'pointer' }}>
                        {t.prioridade === 'alta' ? '🔴 ' : ''}{t.descricao} <span className="mono muted" style={{ fontSize: 12 }}>{fmtDate(parseISO(t.prazo)!)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </Section>

      {editTask && <TaskEditor task={editTask} defaultWs={workspaces[0]?.id ?? ''} onClose={() => setEditTask(null)} />}
      {editEv && <EventEditor ev={editEv} defaultWs={workspaces[0]?.id ?? ''} onClose={() => setEditEv(null)} />}
    </div>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => <>{children}</>;
