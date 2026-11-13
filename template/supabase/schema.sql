-- Tables for one OA app. `__px__` is replaced with the customer's prefix by
-- scripts/oaw-setup.mjs. Safe to run again: every statement is idempotent.
-- Only the service role (Edge Functions) can read or write these tables.

create table if not exists public.__px___config (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.__px___owner (
  id int primary key default 1 check (id = 1),
  line_user_id text,
  bind_hash text,
  bind_expires timestamptz
);
-- Saved by the one-tap connect from the Aprico OA.
alter table public.__px___owner add column if not exists aprico_key text;

create table if not exists public.__px___members (
  line_user_id text primary key,
  member_no bigint generated always as identity unique,
  display_name text not null default '',
  joined_at timestamptz not null default now()
);

create table if not exists public.__px___pending (
  line_user_id text primary key,
  proposal jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.__px___config enable row level security;
alter table public.__px___owner enable row level security;
alter table public.__px___members enable row level security;
alter table public.__px___pending enable row level security;

revoke all on public.__px___config, public.__px___owner, public.__px___members,
  public.__px___pending from public, anon, authenticated;
grant select, insert, update, delete on public.__px___config, public.__px___owner,
  public.__px___members, public.__px___pending to service_role;

-- Chat auto-record: bound groups, raw lines (kept 30 days), and extracted records.
create table if not exists public.__px___groups (
  group_id text primary key,
  bound_at timestamptz not null default now()
);

create table if not exists public.__px___messages (
  id bigint generated always as identity primary key,
  source_id text not null,
  is_owner boolean not null default false,
  text text not null,
  sent_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists __px___messages_pending on public.__px___messages (processed_at, sent_at);

create table if not exists public.__px___records (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('event', 'expense', 'todo', 'life')),
  day date,
  time text not null default '',
  title text not null,
  amount integer,
  created_at timestamptz not null default now()
);

alter table public.__px___groups enable row level security;
alter table public.__px___messages enable row level security;
alter table public.__px___records enable row level security;
revoke all on public.__px___groups, public.__px___messages, public.__px___records
  from public, anon, authenticated;
grant select, insert, update, delete on public.__px___groups, public.__px___messages,
  public.__px___records to service_role;

-- 個人健康 AI 秘書 (health template). The owner is the elder; caregivers are friends of the
-- same OA who were invited and approved. Photos are never stored, only the report text.
create table if not exists public.__px___h_profile (
  id int primary key default 1 check (id = 1),
  consent_at timestamptz,
  share_at timestamptz,
  thresholds jsonb not null default '{}'::jsonb,
  reminders jsonb not null default '[]'::jsonb,
  invite_hash text,
  invite_expires timestamptz
);

create table if not exists public.__px___h_measures (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('bp', 'glucose', 'weight', 'med')),
  v1 numeric,
  v2 numeric,
  v3 numeric,
  tag text not null default '',
  flagged boolean not null default false,
  measured_at timestamptz not null default now()
);
create index if not exists __px___h_measures_recent on public.__px___h_measures (kind, measured_at desc);

create table if not exists public.__px___h_scans (
  id bigint generated always as identity primary key,
  total integer not null,
  report jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.__px___h_events (
  id bigint generated always as identity primary key,
  day date not null,
  time text not null default '',
  title text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists __px___h_events_day on public.__px___h_events (day);

create table if not exists public.__px___h_done (
  day date not null,
  slot int not null,
  done_at timestamptz not null default now(),
  primary key (day, slot)
);

create table if not exists public.__px___h_caregivers (
  line_user_id text primary key,
  display_name text not null default '',
  status text not null default 'pending' check (status in ('pending', 'active')),
  notify jsonb not null default '{"alert": true, "missed": true, "weekly": true}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.__px___h_profile enable row level security;
alter table public.__px___h_measures enable row level security;
alter table public.__px___h_scans enable row level security;
alter table public.__px___h_events enable row level security;
alter table public.__px___h_done enable row level security;
alter table public.__px___h_caregivers enable row level security;
revoke all on public.__px___h_profile, public.__px___h_measures, public.__px___h_scans,
  public.__px___h_events, public.__px___h_done, public.__px___h_caregivers
  from public, anon, authenticated;
grant select, insert, update, delete on public.__px___h_profile, public.__px___h_measures,
  public.__px___h_scans, public.__px___h_events, public.__px___h_done,
  public.__px___h_caregivers to service_role;
