-- MotionLab friends backend — run once in Supabase Dashboard → SQL Editor.
-- Cloud stores ONLY: email (identity), display name, avatar choice, XP, privacy flag.
-- Videos and reports never leave the user's device.

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

-- prototype-grade policies: the app talks to these tables through its own
-- server routes (identity enforced by Google sign-in there)
create policy "app read profiles"    on profiles    for select using (true);
create policy "app insert profiles"  on profiles    for insert with check (true);
create policy "app update profiles"  on profiles    for update using (true);
create policy "app read friendships"   on friendships for select using (true);
create policy "app insert friendships" on friendships for insert with check (true);
create policy "app update friendships" on friendships for update using (true);
create policy "app delete friendships" on friendships for delete using (true);

-- v2: small data-URL profile photo shown to friends (run this if upgrading)
alter table profiles add column if not exists photo text;
