-- =====================================================================
-- Consensus Radar — Supabase schema
-- Run this whole file once in the Supabase SQL Editor (new project).
-- Safe to re-run: everything is idempotent.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- ROOMS
-- teams is a jsonb array: [{ "id": "t1", "name": "...", "color": "#...",
--                            "score": 0 }, ...]
-- ---------------------------------------------------------------------
create table if not exists public.rooms (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  status            text not null default 'lobby'
                    check (status in ('lobby', 'playing', 'finished')),
  lang              text not null default 'ua' check (lang in ('ua', 'en')),
  categories        text[] not null default array['general', 'analytics'],
  goal              int  not null default 20,          -- 0 = endless
  bets_enabled      boolean not null default true,
  teams             jsonb not null default '[]'::jsonb,
  active_team_index int  not null default 0,
  round_no          int  not null default 0,
  current_round_id  uuid,
  host_player_id    uuid,
  winner_team_name  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  finished_at       timestamptz
);

create index if not exists rooms_code_idx       on public.rooms (code);
create index if not exists rooms_created_at_idx on public.rooms (created_at desc);

-- ---------------------------------------------------------------------
-- PLAYERS  (no auth: a player is a name + a device-local secret token)
-- ---------------------------------------------------------------------
create table if not exists public.players (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete cascade,
  name         text not null,
  team_id      text,
  is_host      boolean not null default false,
  clue_turns   int not null default 0,   -- used to rotate the clue-giver
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists players_room_idx on public.players (room_id);

-- Per-device secret. Kept out of `players` so it is never exposed to the
-- browser through RLS or Realtime payloads.
create table if not exists public.player_tokens (
  player_id uuid primary key references public.players (id) on delete cascade,
  token     text not null
);

create index if not exists player_tokens_token_idx on public.player_tokens (token);

-- ---------------------------------------------------------------------
-- ROUNDS
-- The secret target lives in `round_secrets` (never client-readable).
-- `revealed_target` is only filled in once the round is revealed.
-- ---------------------------------------------------------------------
create table if not exists public.rounds (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms (id) on delete cascade,
  round_no        int not null,
  team_id         text not null,
  team_name       text not null,
  clue_giver_id   uuid references public.players (id) on delete set null,
  clue_giver_name text,
  scale_key       text not null,
  scale_left      text not null,   -- EN label, for readable leaderboards
  scale_right     text not null,
  phase           text not null default 'clue'
                  check (phase in ('clue', 'guess', 'reveal')),
  clue            text,
  marker          numeric,          -- team's averaged guess (0..100)
  distance        numeric,          -- |marker - target|
  points          int,              -- points the active team earned
  revealed_target int,
  reveal_detail   jsonb,            -- per-player guesses + bet outcomes
  created_at      timestamptz not null default now(),
  revealed_at     timestamptz
);

create index if not exists rounds_room_idx     on public.rounds (room_id, round_no);
create index if not exists rounds_revealed_idx on public.rounds (revealed_at desc)
  where revealed_at is not null;

create table if not exists public.round_secrets (
  round_id uuid primary key references public.rounds (id) on delete cascade,
  target   int not null check (target between 0 and 100)
);

-- ---------------------------------------------------------------------
-- GUESSES — the row is public (so everyone sees "3 of 4 submitted"),
-- the actual slider value is hidden until reveal.
-- ---------------------------------------------------------------------
create table if not exists public.guesses (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references public.rounds (id) on delete cascade,
  room_id      uuid not null references public.rooms (id) on delete cascade,
  player_id    uuid not null references public.players (id) on delete cascade,
  player_name  text not null,
  team_id      text not null,
  submitted_at timestamptz not null default now(),
  unique (round_id, player_id)
);

create index if not exists guesses_round_idx on public.guesses (round_id);
create index if not exists guesses_room_idx  on public.guesses (room_id);

create table if not exists public.guess_values (
  guess_id uuid primary key references public.guesses (id) on delete cascade,
  value    int not null check (value between 0 and 100)
);

-- ---------------------------------------------------------------------
-- BETS — non-active teams bet which side of the target the marker landed.
-- ---------------------------------------------------------------------
create table if not exists public.bets (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references public.rounds (id) on delete cascade,
  room_id      uuid not null references public.rooms (id) on delete cascade,
  player_id    uuid not null references public.players (id) on delete cascade,
  player_name  text not null,
  team_id      text not null,
  side         text not null check (side in ('left', 'right')),
  submitted_at timestamptz not null default now(),
  unique (round_id, player_id)
);

create index if not exists bets_round_idx on public.bets (round_id);
create index if not exists bets_room_idx  on public.bets (room_id);

-- ---------------------------------------------------------------------
-- DURABLE RESULTS (survive room deletion) — these feed the leaderboards.
-- ---------------------------------------------------------------------
create table if not exists public.game_results (
  id            uuid primary key default gen_random_uuid(),
  room_code     text not null,
  team_name     text not null,
  score         int  not null,
  rounds_played int  not null,
  avg_distance  numeric,
  is_winner     boolean not null default false,
  player_names  text[] not null default '{}',
  goal          int,
  finished_at   timestamptz not null default now()
);

create index if not exists game_results_score_idx on public.game_results (score desc);
create index if not exists game_results_time_idx  on public.game_results (finished_at desc);

create table if not exists public.player_round_stats (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid,
  room_code   text not null,
  player_name text not null,
  role        text not null check (role in ('clue', 'guess', 'bet')),
  distance    numeric,   -- clue/guess: how far off (0..100)
  points      int,       -- points credited for this contribution
  scale_key   text,
  created_at  timestamptz not null default now()
);

create index if not exists prs_name_idx  on public.player_round_stats (lower(player_name));
create index if not exists prs_scale_idx on public.player_round_stats (scale_key);

-- ---------------------------------------------------------------------
-- LEADERBOARD VIEWS
-- ---------------------------------------------------------------------

-- 1. Best single rounds (hall of fame for near-bullseyes)
create or replace view public.v_best_rounds as
select
  r.id,
  r.room_id,
  r.team_name,
  r.clue_giver_name,
  r.clue,
  r.scale_key,
  r.scale_left,
  r.scale_right,
  r.revealed_target as target,
  r.marker,
  r.distance,
  r.points,
  r.revealed_at
from public.rounds r
where r.revealed_at is not null
  and r.distance is not null
order by r.distance asc, r.revealed_at desc;

-- 2. Player stats, keyed on the lower-cased name (there is no auth, so a
--    name is the identity — see README for the trade-off).
create or replace view public.v_player_stats as
with clue as (
  select lower(player_name) as key,
         max(player_name)   as player_name,
         count(*)           as clues_given,
         avg(distance)      as clue_avg_distance,
         avg(points)        as clue_avg_points,
         sum(points)        as clue_total_points
  from public.player_round_stats
  where role = 'clue'
  group by lower(player_name)
),
guess as (
  select lower(player_name) as key,
         max(player_name)   as player_name,
         count(*)           as guesses_made,
         avg(distance)      as guess_avg_distance
  from public.player_round_stats
  where role = 'guess'
  group by lower(player_name)
)
select
  coalesce(c.key, g.key)                 as key,
  coalesce(c.player_name, g.player_name) as player_name,
  coalesce(c.clues_given, 0)             as clues_given,
  round(c.clue_avg_distance, 1)          as clue_avg_distance,
  round(c.clue_avg_points, 2)            as clue_avg_points,
  coalesce(c.clue_total_points, 0)       as clue_total_points,
  coalesce(g.guesses_made, 0)            as guesses_made,
  round(g.guess_avg_distance, 1)         as guess_avg_distance
from clue c
full outer join guess g on g.key = c.key;

-- 3. Hardest scales
create or replace view public.v_scale_stats as
select
  r.scale_key,
  max(r.scale_left)  as scale_left,
  max(r.scale_right) as scale_right,
  count(*)           as times_played,
  round(avg(r.distance), 1) as avg_distance,
  round(avg(r.points), 2)   as avg_points,
  count(*) filter (where r.points >= 4) as bullseyes
from public.rounds r
where r.revealed_at is not null and r.distance is not null
group by r.scale_key
order by avg(r.distance) desc nulls last;

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Every write goes through the Next.js API routes with the service-role
-- key (which bypasses RLS). The browser only ever reads.
-- ---------------------------------------------------------------------
alter table public.rooms              enable row level security;
alter table public.players            enable row level security;
alter table public.rounds             enable row level security;
alter table public.guesses            enable row level security;
alter table public.bets               enable row level security;
alter table public.game_results       enable row level security;
alter table public.player_round_stats enable row level security;

-- Secrets: RLS on and deliberately NO policies -> unreachable for
-- anon/authenticated, readable only by the service role.
alter table public.round_secrets enable row level security;
alter table public.guess_values  enable row level security;
alter table public.player_tokens enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'rooms', 'players', 'rounds', 'guesses', 'bets',
    'game_results', 'player_round_stats'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_read', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- REALTIME
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['rooms', 'players', 'rounds', 'guesses', 'bets']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Realtime needs the full row for UPDATE payloads.
alter table public.rooms    replica identity full;
alter table public.rounds   replica identity full;
alter table public.players  replica identity full;
alter table public.guesses  replica identity full;
alter table public.bets     replica identity full;

-- ---------------------------------------------------------------------
-- HOUSEKEEPING
-- Rooms are ephemeral; results are not. Call this from a cron job
-- (Supabase Dashboard -> Integrations -> Cron) or just ignore it.
--   select public.purge_stale_rooms();
-- ---------------------------------------------------------------------
create or replace function public.purge_stale_rooms(older_than interval default interval '24 hours')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted int;
begin
  with gone as (
    delete from public.rooms
    where updated_at < now() - older_than
    returning 1
  )
  select count(*) into deleted from gone;
  return deleted;
end $$;

revoke all on function public.purge_stale_rooms(interval) from anon, authenticated;
