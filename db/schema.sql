-- VLivIn Phase 1 Postgres schema (Supabase compatible).
-- The running server uses the in-memory store; this is the target schema for the
-- Postgres implementation of src/store/store.ts.
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Friend',
  phone text unique,
  apple_sub text unique,
  google_sub text unique,
  city text,
  tz text not null default 'UTC',
  avatar_url text,
  push_token text,
  created_at timestamptz not null default now()
);

create table couples (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null unique references users(id) on delete cascade,
  user_b uuid not null unique references users(id) on delete cascade,
  together_since date,
  meet_date date,
  created_at timestamptz not null default now(),
  check (user_a <> user_b)
);

create table pair_codes (
  code text primary key,
  user_id uuid not null unique references users(id) on delete cascade,
  expires_at timestamptz not null
);

create table moods (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  mood text not null check (mood in ('great','good','meh','low','missing')),
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now()
);
create index moods_couple_created on moods (couple_id, created_at desc);

create table locations (
  user_id uuid primary key references users(id) on delete cascade,
  lat double precision,
  lng double precision,
  updated_at timestamptz,
  sharing_mode text not null default 'off' check (sharing_mode in ('off','always','while_using')),
  paused_until timestamptz
);

create table answers (
  question_id text not null,
  couple_id uuid not null references couples(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  primary key (question_id, couple_id, user_id)
);

create table game_sessions (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  game text not null,
  state jsonb not null,
  turn uuid references users(id),
  score jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create index game_sessions_couple on game_sessions (couple_id, game, updated_at desc);

create table boards (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  strokes jsonb not null default '[]',
  snapshot_url text,
  saved_at timestamptz,
  created_at timestamptz not null default now()
);

create table moi_items (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  type text not null check (type in ('letter','doodle','photo')),
  payload jsonb not null,
  unlock_at timestamptz,
  created_at timestamptz not null default now()
);
create index moi_items_couple on moi_items (couple_id, created_at desc);
