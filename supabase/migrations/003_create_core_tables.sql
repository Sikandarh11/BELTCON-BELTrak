-- BAGS
create table if not exists public.bags (
  id text primary key,
  bhs_uid text not null,
  iata_code text not null,
  epc text,
  flight text not null,
  is_suspect boolean not null default true,
  status text not null default 'IDENTIFIED'
    check (status in (
      'IDENTIFIED','TAGGED','IN_ARRIVAL_HALL','AT_EXIT','ALARMED',
      'UNDER_RECHECK','RESOLVED','MISSING','ESCAPE_ALERT','ESCALATED'
    )),
  current_zone text not null default 'TAGGING_STATION',
  created_at timestamptz default now()
);

-- ALARMS
create table if not exists public.alarms (
  id text primary key,
  bag_id text not null references public.bags(id) on delete cascade,
  zone text not null,
  triggered_at timestamptz not null default now(),
  acknowledged_by text,
  outcome text not null default 'OPEN'
    check (outcome in (
      'OPEN','UNDER_INVESTIGATION','CLEARED','NOT_CLEARED',
      'DUTY_COLLECTED','PROHIBITED_ITEM_SEIZED','ESCALATED','SUPPRESSED'
    ))
);

-- RFID_EVENTS
create table if not exists public.rfid_events (
  id text primary key,
  epc text not null,
  reader_id text not null,
  zone text not null,
  event_type text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  read_count integer not null default 1,
  rssi integer not null default -45
);

-- RESOLUTIONS
create table if not exists public.resolutions (
  id text primary key,
  bag_id text not null references public.bags(id) on delete cascade,
  officer_id text not null,
  action text not null
    check (action in (
      'CLEARED','NOT_CLEARED','DUTY_COLLECTED',
      'PROHIBITED_ITEM_SEIZED','ESCALATED'
    )),
  resolved_at timestamptz not null default now()
);

-- READERS
create table if not exists public.readers (
  id text primary key,
  name text not null,
  model text not null,
  zone text not null,
  ip text not null,
  status text not null default 'ONLINE'
    check (status in ('ONLINE','DEGRADED','OFFLINE')),
  read_rate integer not null default 95
);

-- Enable RLS on all tables
alter table public.bags enable row level security;
alter table public.alarms enable row level security;
alter table public.rfid_events enable row level security;
alter table public.resolutions enable row level security;
alter table public.readers enable row level security;

-- Policies: authenticated users can read all, write all
-- (In production, restrict writes by role — for now keep it simple)
create policy "auth_read_bags" on public.bags for select using (auth.uid() is not null);
create policy "auth_write_bags" on public.bags for insert with check (auth.uid() is not null);
create policy "auth_update_bags" on public.bags for update using (auth.uid() is not null);

create policy "auth_read_alarms" on public.alarms for select using (auth.uid() is not null);
create policy "auth_write_alarms" on public.alarms for insert with check (auth.uid() is not null);
create policy "auth_update_alarms" on public.alarms for update using (auth.uid() is not null);

create policy "auth_read_events" on public.rfid_events for select using (auth.uid() is not null);
create policy "auth_write_events" on public.rfid_events for insert with check (auth.uid() is not null);
create policy "auth_update_events" on public.rfid_events for update using (auth.uid() is not null);

create policy "auth_read_resolutions" on public.resolutions for select using (auth.uid() is not null);
create policy "auth_write_resolutions" on public.resolutions for insert with check (auth.uid() is not null);

create policy "auth_read_readers" on public.readers for select using (auth.uid() is not null);
create policy "auth_write_readers" on public.readers for insert with check (auth.uid() is not null);
create policy "auth_update_readers" on public.readers for update using (auth.uid() is not null);

-- Indexes for common queries
create index if not exists idx_alarms_bag_id on public.alarms(bag_id);
create index if not exists idx_alarms_outcome on public.alarms(outcome);
create index if not exists idx_events_epc on public.rfid_events(epc);
create index if not exists idx_bags_status on public.bags(status);
