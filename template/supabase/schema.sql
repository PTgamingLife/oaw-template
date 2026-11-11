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
