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
-- Owner PIN (hash only) and the last ownership reset applied from the Aprico build center.
alter table public.__px___owner add column if not exists pin_hash text;
alter table public.__px___owner add column if not exists pin_fails int not null default 0;
alter table public.__px___owner add column if not exists pin_wait_until timestamptz;
alter table public.__px___owner add column if not exists pin_ok_until timestamptz;
alter table public.__px___owner add column if not exists reset_nonce text;
-- Cross-account links: this app's key pair (the private key never leaves this database).
alter table public.__px___owner add column if not exists link_key jsonb;
alter table public.__px___owner add column if not exists link_pulled_at timestamptz;

-- Messages received from linked accounts, kept 30 days for 「加入今晚整理」.
create table if not exists public.__px___link_inbox (
  id uuid primary key,
  from_label text not null,
  kind text not null,
  text text not null,
  saved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.__px___link_inbox enable row level security;
revoke all on public.__px___link_inbox from public, anon, authenticated;
grant select, insert, update, delete on public.__px___link_inbox to service_role;

-- 光球: slots 1–3 are the owner's orbs, 4 is a hidden orb received from a 領航者 account.
create table if not exists public.__px___orbs (
  slot int primary key check (slot between 1 and 4),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.__px___orbs enable row level security;
revoke all on public.__px___orbs from public, anon, authenticated;
grant select, insert, update, delete on public.__px___orbs to service_role;

-- Timed jobs (定時推播 / 提醒 / 統計截止 / 每晚整理) run from this database: pg_cron calls
-- __px___tick, which makes a one-use token and posts it to this app's {px}-digest function.
do $$ begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
exception when others then
  raise notice 'oaw: timed jobs unavailable (%). Orbs still work; scheduled pieces will not fire.', sqlerrm;
end $$;

create table if not exists public.__px___ticks (
  token_hash text primary key,
  job text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.__px___ticks enable row level security;
revoke all on public.__px___ticks from public, anon, authenticated;
grant select, delete on public.__px___ticks to service_role;

create or replace function public.__px___tick(job text, url text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare k text; request bigint;
begin
  delete from public.__px___ticks where created_at < now() - interval '1 day';
  k := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.__px___ticks (token_hash, job, expires_at)
    values (encode(sha256(convert_to(k, 'UTF8')), 'hex'), job, now() + interval '120 seconds');
  select net.http_post(
    url := url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-oaw-tick', k),
    body := jsonb_build_object('job', job), timeout_milliseconds := 120000) into request;
  return request;
end;
$$;
revoke all on function public.__px___tick(text, text) from public, anon, authenticated;

-- Replace this app's cron jobs with the given list. Only daily "m h * * *" entries that call
-- this app's own function are accepted.
create or replace function public.__px___cron_sync(jobs jsonb, url text)
returns int language plpgsql security definer set search_path = '' as $$
declare j jsonb; n int := 0;
begin
  if url !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/__px__-digest$' then
    raise exception 'bad url';
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname like '__px__-orb-%';
  for j in select * from jsonb_array_elements(jobs) loop
    if (j->>'name') !~ '^[a-z0-9-]{1,40}$' or (j->>'cron') !~ '^[0-5]?[0-9] ([01]?[0-9]|2[0-3]) \* \* \*$' then
      raise exception 'bad job';
    end if;
    perform cron.schedule('__px__-orb-' || (j->>'name'), j->>'cron',
      format('select public.__px___tick(%L, %L)', j->>'name', url));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.__px___cron_sync(jsonb, text) from public, anon, authenticated;
grant execute on function public.__px___cron_sync(jsonb, text) to service_role;

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
-- Groups: LINE group name (owner can rename), and which chat each record came from.
alter table public.__px___groups add column if not exists name text not null default '';
alter table public.__px___records add column if not exists source_id text;
create index if not exists __px___records_source on public.__px___records (source_id, kind, day);
-- Who said each line (LINE user id), for 統計.
alter table public.__px___messages add column if not exists sender text;
create index if not exists __px___messages_source on public.__px___messages (source_id, sent_at);
-- Group AI: call word, AI calls per group per day, owner announcements per day.
alter table public.__px___owner add column if not exists group_wake text not null default '小秘';
alter table public.__px___owner add column if not exists group_daily int not null default 30;
alter table public.__px___owner add column if not exists group_send_daily int not null default 20;

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
-- What the elder receives (reminders / events / weekly); missing keys mean on.
alter table public.__px___h_profile add column if not exists notify jsonb not null default '{}'::jsonb;

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
