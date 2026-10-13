import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { resumeStuck } from './pipeline';
import { Inbox } from './views/Inbox';
import { Today, Week } from './views/Dashboard';
import { Workspaces } from './views/Workspaces';
import { Search } from './views/Search';
import { Settings } from './views/Settings';
import { requestLock } from './views/LockScreen';
import { bootSync, statusLabel, useSyncStatus } from './views/SyncPanel';

type View = 'inbox' | 'hoje' | 'semana' | 'areas' | 'busca' | 'config';

const NAV: { id: View; label: string; title: string; shape: 'square' | 'circle' | 'tri' }[] = [
  { id: 'inbox', label: 'Inbox', title: '00 · Inbox', shape: 'square' },
  { id: 'hoje', label: 'Hoje', title: '01 · Visão de hoje', shape: 'circle' },
  { id: 'semana', label: 'Semana', title: '01 · Visão da semana', shape: 'square' },
  { id: 'areas', label: 'Áreas', title: '02 · Workspaces', shape: 'tri' },
  { id: 'busca', label: 'Busca', title: 'Modo consulta', shape: 'circle' },
  { id: 'config', label: 'Config', title: 'Configurações', shape: 'square' },
];

function readHash(): { view: View; ws: string | null } {
  const [v, ws] = location.hash.replace(/^#\/?/, '').split('/');
  const view = NAV.some((n) => n.id === v) ? (v as View) : 'inbox';
  return { view, ws: ws || null };
}

/** Texto recebido via Web Share Target (compartilhar → NEXUS no celular). */
function readShared(): string {
  const p = new URLSearchParams(location.search);
  return [p.get('title'), p.get('text'), p.get('url')].filter(Boolean).join('\n');
}

export function App() {
  const [route, setRoute] = useState(readHash);
  const [shared] = useState(readShared);
  const inboxCount = useLiveQuery(() => db.captures.where('status').anyOf('pendente', 'revisao', 'erro').count(), []) ?? 0;

  useEffect(() => {
    resumeStuck();
    bootSync();
    const on = () => setRoute(readHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const go = (view: View, ws?: string | null) => {
    location.hash = `/${view}${ws ? `/${ws}` : ''}`;
  };
  const current = NAV.find((n) => n.id === route.view)!;
  const sync = useSyncStatus();
  const syncInfo = statusLabel(sync);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><i /><i /><i /><i /></span>
          NEXUS
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <div className="view-title">{current.title}</div>
          {sync.state !== 'off' && (
            <button className="sync-dot" title={syncInfo.text} aria-label={syncInfo.text} onClick={() => go('config')}>
              <span className={`dot ${syncInfo.dot}`} />
            </button>
          )}
          <button className="sync-dot" title="Bloquear" aria-label="Bloquear app" onClick={requestLock}>
            <svg width="12" height="14" viewBox="0 0 12 14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="6" width="10" height="7" /><path d="M3 6V4a3 3 0 0 1 6 0v2" /></svg>
          </button>
        </div>
      </header>
      <nav className="nav" aria-label="Principal">
        {NAV.map((n) => (
          <button key={n.id} data-shape={n.shape} aria-current={route.view === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
            <span className="ico" />
            {n.label}
            {n.id === 'inbox' && inboxCount > 0 && <span className="badge">{inboxCount}</span>}
          </button>
        ))}
      </nav>
      <main>
        {route.view === 'inbox' && <Inbox shared={shared} />}
        {route.view === 'hoje' && <Today />}
        {route.view === 'semana' && <Week />}
        {route.view === 'areas' && <Workspaces openId={route.ws} onOpen={(id) => go('areas', id)} />}
        {route.view === 'busca' && <Search />}
        {route.view === 'config' && <Settings />}
      </main>
    </div>
  );
}
