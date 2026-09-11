-- MotionLab friends backend — run once in Supabase Dashboard → SQL Editor.
-- Identity/social profile plus a private account data snapshot.

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null default '',
  avatar text not null default 'tennis',
  xp int not null default 0,
  is_private boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references profiles(id) on delete cascade,
  addressee uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  unique (requester, addressee)
);

alter table profiles enable row level security;
alter table friendships enable row level security;

-- v3 routes use the server-only service role. Remove the old prototype public
-- policies so possessing the browser anon key cannot enumerate or edit users.
drop policy if exists "app read profiles" on profiles;
drop policy if exists "app insert profiles" on profiles;
drop policy if exists "app update profiles" on profiles;
drop policy if exists "app read friendships" on friendships;
drop policy if exists "app insert friendships" on friendships;
drop policy if exists "app update friendships" on friendships;
drop policy if exists "app delete friendships" on friendships;

-- v2: small data-URL profile photo shown to friends (run this if upgrading)
alter table profiles add column if not exists photo text;

-- v3: account-owned training data. There are deliberately NO anon/authenticated
-- policies on this table. Only the app server's SUPABASE_SERVICE_ROLE_KEY may
-- read or write it after verifying the caller's email/session.
create table if not exists account_data (
  profile_id uuid primary key references profiles(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table account_data enable row level security;
