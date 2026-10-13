-- NEXUS — esquema de sincronização. Rode uma vez no SQL Editor do Supabase.

create table if not exists public.nexus_records (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  tbl text not null,
  id text not null,
  data jsonb,
  deleted boolean not null default false,
  client_updated_at bigint not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, tbl, id)
);

-- Tabelas aceitas (recriada para permitir novas tabelas em atualizações do app).
alter table public.nexus_records drop constraint if exists nexus_records_tbl_check;
alter table public.nexus_records add constraint nexus_records_tbl_check
  check (tbl in ('workspaces', 'captures', 'events', 'tasks', 'notes', 'vault'));

create index if not exists nexus_records_pull on public.nexus_records (user_id, updated_at);

-- Cada usuário só enxerga e altera os próprios registros.
alter table public.nexus_records enable row level security;
drop policy if exists "nexus own rows" on public.nexus_records;
create policy "nexus own rows" on public.nexus_records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Last-write-wins: uma versão mais antiga (client_updated_at menor) nunca sobrescreve a atual.
-- updated_at é sempre o relógio do servidor, usado como cursor de pull.
create or replace function public.nexus_lww() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.client_updated_at < old.client_updated_at then
    return null;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists nexus_lww on public.nexus_records;
create trigger nexus_lww before insert or update on public.nexus_records
  for each row execute function public.nexus_lww();

-- Realtime: avisa os outros aparelhos quando algo muda.
do $$ begin
  alter publication supabase_realtime add table public.nexus_records;
exception when duplicate_object then null;
end $$;
