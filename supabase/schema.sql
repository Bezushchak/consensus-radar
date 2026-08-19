-- =====================================================================
-- Consensus Radar — Supabase schema
-- Run this whole file once in the Supabase SQL Editor (new project).
-- Safe to re-run: everything is idempotent.
-- =====================================================================

-- pgcrypto is already installed on every Supabase project, and `gen_random_uuid()`
-- has been core Postgres since 13 either way. It is requested here only so this
-- file also works on a plain Postgres — and wrapped, because on a managed
-- database the role running this may not be allowed to create extensions, and an
-- error here would roll back the entire script (see the note below).
do $$
begin
  create extension if not exists "pgcrypto";
exception when insufficient_privilege or feature_not_supported then
  raise notice 'pgcrypto not created (%). Fine: gen_random_uuid() is core since PG13.', sqlerrm;
end $$;

-- =====================================================================
-- READ THIS IF THE SCRIPT FAILS
-- The Supabase SQL editor runs this whole file as ONE transaction, so a
-- failure on any line rolls back every line. There is no such thing as a
-- half-applied run: either the summary at the very bottom appears, or
-- nothing at all happened. Fix the error it reports and run it again.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SCALES — the catalogue of polar pairs the game deals from.
--
-- Seeded by supabase/scales-seed.sql (generated from src/lib/scales-data.ts),
-- but editable from the dashboard: add a row and the next round can draw it,
-- no deploy needed. `enabled = false` retires a pair while keeping every
-- statistic that references its key.
--
-- Both languages are stored here AND copied onto each round, so rewording a
-- pair never rewrites how an old game reads.
-- ---------------------------------------------------------------------
create table if not exists public.scales (
  key        text primary key,
  category   text not null check (category in ('general', 'analytics')),
  left_ua    text not null,
  right_ua   text not null,
  left_en    text not null,
  right_en   text not null,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists scales_pool_idx on public.scales (category) where enabled;

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
-- `player_uid` is the browser's own long-lived id (localStorage). It is not a
-- credential and proves nothing on its own — it exists so the leaderboard can
-- tell "Dmytro playing his fourth game" from "a different Dmytro".
create table if not exists public.players (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete cascade,
  name         text not null,
  player_uid   text,
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
  -- Both languages are frozen onto the round, so a reworded or retired scale
  -- never changes how a finished game reads. EN also keeps the leaderboards
  -- readable for everyone.
  scale_key       text not null,
  scale_left      text not null,
  scale_right     text not null,
  scale_left_ua   text,
  scale_right_ua  text,
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
  player_uid  text,      -- device id; null for games played before it existed
  role        text not null check (role in ('clue', 'guess', 'bet')),
  distance    numeric,   -- clue/guess: how far off (0..100)
  points      int,       -- points credited for this contribution
  scale_key   text,
  created_at  timestamptz not null default now()
);

create index if not exists prs_name_idx  on public.player_round_stats (lower(player_name));
create index if not exists prs_scale_idx on public.player_round_stats (scale_key);

-- ---------------------------------------------------------------------
-- PRODUCT ANALYTICS
-- One append-only table for every tracked event. Deliberately dumb: the
-- server writes rows, nothing updates them, and every question (conversion,
-- drop-off, what got clicked) is a query over this one table.
--
-- What is NOT here, on purpose: no IP address, no user agent string, no
-- cursor path replay. `session_id` is a random per-tab id and `player_uid`
-- is the same non-credential device id the leaderboard groups by, so the
-- table can answer "how many people" without identifying anybody.
-- ---------------------------------------------------------------------
create table if not exists public.analytics_events (
  id         bigserial primary key,
  session_id text not null,             -- random per tab, minted client-side
  player_uid text,                      -- device id, when the browser has one
  room_code  text,
  name       text not null,             -- allowlisted on the server
  path       text,                      -- '/', '/room/[code]', '/leaderboard'
  props      jsonb not null default '{}'::jsonb,
  lang       text,
  device     text,                      -- 'mobile' | 'desktop'
  ts         timestamptz not null default now()
);

create index if not exists ae_ts_idx      on public.analytics_events (ts desc);
create index if not exists ae_name_ts_idx on public.analytics_events (name, ts desc);
create index if not exists ae_session_idx on public.analytics_events (session_id);
create index if not exists ae_room_idx    on public.analytics_events (room_code)
  where room_code is not null;

-- ---------------------------------------------------------------------
-- COLUMNS ADDED AFTER THE FIRST RELEASE
-- `create table if not exists` above leaves an existing table alone, so any
-- column added later has to be spelled out here as well. Both forms are
-- idempotent, which keeps this one file safe to run against a fresh project
-- and against one created by an earlier release.
--
-- Everything that depends on these columns — indexes, views — has to come
-- after this block, not next to its table above, or the script dies on the
-- old project it is meant to migrate.
-- ---------------------------------------------------------------------
alter table public.players            add column if not exists player_uid     text;
alter table public.player_round_stats add column if not exists player_uid     text;
alter table public.rounds             add column if not exists scale_left_ua  text;
alter table public.rounds             add column if not exists scale_right_ua text;

create index if not exists prs_uid_idx on public.player_round_stats (player_uid)
  where player_uid is not null;

-- ---------------------------------------------------------------------
-- LEADERBOARD VIEWS
--
-- These are dropped before they are created, and the reason is worth
-- knowing: `create or replace view` may only APPEND columns. It cannot
-- reorder them or rename one, so on a project that already has an older
-- version of a view, inserting a column in the middle fails with
--   42P16: cannot change name of view column "target" to "scale_left_ua"
-- and — because the editor runs this file as one transaction — takes the
-- entire script down with it. Dropping first sidesteps the whole class of
-- problem. Views hold no data, so there is nothing to lose by rebuilding
-- them; `cascade` is safe here because nothing in this schema depends on a
-- view. Every one of them is recreated below, in this same transaction.
-- ---------------------------------------------------------------------
drop view if exists public.v_best_rounds   cascade;
drop view if exists public.v_player_stats  cascade;
drop view if exists public.v_scale_stats   cascade;
drop view if exists public.v_funnel        cascade;
drop view if exists public.v_dropoff       cascade;
drop view if exists public.v_clicks        cascade;
drop view if exists public.v_room_dropoff  cascade;

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
  r.scale_left_ua,
  r.scale_right_ua,
  r.revealed_target as target,
  r.marker,
  r.distance,
  r.points,
  r.revealed_at
from public.rounds r
where r.revealed_at is not null
  and r.distance is not null
order by r.distance asc, r.revealed_at desc;

-- 2. Player stats, keyed on the device id when there is one and on the
--    lower-cased name otherwise (rows written before device ids existed).
--    There is still no auth: see README for what that buys and costs.
--
--    /api/leaderboard does one thing more than this view — it also folds a
--    legacy name-only group into a device group that answers to the same name,
--    so a returning player is not listed twice. That merge needs a second pass
--    over the rows, which is why the API aggregates in JS and this view exists
--    for ad-hoc queries in the SQL editor.
create or replace view public.v_player_stats as
with clue as (
  select coalesce(player_uid, lower(player_name)) as key,
         max(player_name)   as player_name,
         count(*)           as clues_given,
         avg(distance)      as clue_avg_distance,
         avg(points)        as clue_avg_points,
         sum(points)        as clue_total_points
  from public.player_round_stats
  where role = 'clue'
  group by coalesce(player_uid, lower(player_name))
),
guess as (
  select coalesce(player_uid, lower(player_name)) as key,
         max(player_name)   as player_name,
         count(*)           as guesses_made,
         avg(distance)      as guess_avg_distance
  from public.player_round_stats
  where role = 'guess'
  group by coalesce(player_uid, lower(player_name))
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
  max(r.scale_left)     as scale_left,
  max(r.scale_right)    as scale_right,
  max(r.scale_left_ua)  as scale_left_ua,
  max(r.scale_right_ua) as scale_right_ua,
  count(*)           as times_played,
  round(avg(r.distance), 1) as avg_distance,
  round(avg(r.points), 2)   as avg_points,
  count(*) filter (where r.points >= 4) as bullseyes
from public.rounds r
where r.revealed_at is not null and r.distance is not null
group by r.scale_key
order by avg(r.distance) desc nulls last;

-- ---------------------------------------------------------------------
-- ANALYTICS VIEWS
-- The /analytics page computes the same numbers in JS so it can honour the
-- date filter; these exist for ad-hoc questions in the SQL editor.
-- ---------------------------------------------------------------------

-- The funnel, one row per step, ordered the way a player meets them.
create or replace view public.v_funnel as
with steps(step_no, name) as (
  values (1, 'app_open'), (2, 'create_open'),   (3, 'room_created'),
         (4, 'joined'),   (5, 'game_started'),  (6, 'clue_sent'),
         (7, 'guess_locked'), (8, 'round_revealed'), (9, 'game_finished')
)
select
  s.step_no,
  s.name,
  count(distinct e.session_id) as sessions,
  count(e.id)                  as events
from steps s
left join public.analytics_events e on e.name = s.name
group by s.step_no, s.name
order by s.step_no;

-- Where sessions stop. `dropped` is how many got this far and no further.
create or replace view public.v_dropoff as
with f as (select * from public.v_funnel)
select
  f.step_no,
  f.name,
  f.sessions,
  f.sessions - coalesce(lead(f.sessions) over (order by f.step_no), 0) as dropped,
  case when f.sessions = 0 then null else round(
    100.0 * (f.sessions - coalesce(lead(f.sessions) over (order by f.step_no), 0))
          / f.sessions, 1) end as drop_pct
from f;

-- What people actually click. `props->>'target'` is the data-ev label.
create or replace view public.v_clicks as
select
  coalesce(props->>'target', '(unlabelled)') as target,
  path,
  count(*)                    as clicks,
  count(distinct session_id)  as sessions
from public.analytics_events
where name = 'click'
group by 1, 2
order by clicks desc;

-- Per-room drop-off: joined the lobby but never locked a guess.
create or replace view public.v_room_dropoff as
select
  room_code,
  count(distinct session_id) filter (where name = 'joined')       as joined,
  count(distinct session_id) filter (where name = 'guess_locked') as played,
  min(ts) as first_seen,
  max(ts) as last_seen
from public.analytics_events
where room_code is not null
group by room_code
order by min(ts) desc;

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Every write goes through the Next.js API routes with the service-role
-- key (which bypasses RLS). The browser only ever reads.
-- ---------------------------------------------------------------------
alter table public.scales             enable row level security;
alter table public.rooms              enable row level security;
alter table public.players            enable row level security;
alter table public.rounds             enable row level security;
alter table public.guesses            enable row level security;
alter table public.bets               enable row level security;
alter table public.game_results       enable row level security;
alter table public.player_round_stats enable row level security;

-- Secrets: RLS on and deliberately NO policies -> unreachable for
-- anon/authenticated, readable only by the service role.
--
-- `analytics_events` is in this group for a different reason: it is nobody's
-- business but the host's. The browser writes to it through POST /api/events
-- (service role, server side) and can never read a single row back.
alter table public.round_secrets    enable row level security;
alter table public.guess_values     enable row level security;
alter table public.player_tokens    enable row level security;
alter table public.analytics_events enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'scales', 'rooms', 'players', 'rounds', 'guesses', 'bets',
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
-- Realtime is an optimisation, not a requirement: without it the client falls
-- back to polling every 2.5 seconds and the game is fully playable, just less
-- snappy. That is why this whole section refuses to fail. On some projects the
-- `supabase_realtime` publication is owned by a role the SQL editor is not, and
-- an unguarded `alter publication` there would roll back all 500 lines above it
-- over a feature nobody would have missed.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
exception when insufficient_privilege then
  raise notice 'Could not create the supabase_realtime publication (%).', sqlerrm;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['rooms', 'players', 'rounds', 'guesses', 'bets']
  loop
    begin
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    exception when insufficient_privilege or undefined_object then
      raise notice 'Realtime not enabled for public.% (%) — the game falls back to polling.', t, sqlerrm;
    end;
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

-- Analytics rows are the one thing here that grows without bound. Keeping a
-- quarter is plenty for "is this game landing"; schedule this next to the
-- room purge if you want it bounded:
--   select public.purge_old_events();
create or replace function public.purge_old_events(older_than interval default interval '90 days')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted int;
begin
  with gone as (
    delete from public.analytics_events
    where ts < now() - older_than
    returning 1
  )
  select count(*) into deleted from gone;
  return deleted;
end $$;

revoke all on function public.purge_old_events(interval) from anon, authenticated;

-- ---------------------------------------------------------------------
-- DID IT WORK?
-- The SQL editor shows only the last statement's result, and "Success. No
-- rows returned" looks identical whether this file did everything or was
-- rolled back before it started. So the file ends by answering the question
-- out loud. Every `ok` column must read true; `realtime` may read false on a
-- project where the publication could not be touched, and that is survivable
-- — the game polls instead.
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_tables  where schemaname = 'public')             as tables,
  (select count(*) from pg_views   where schemaname = 'public')             as views,
  (select count(*) from public.scales)                                      as scales_rows,
  (select count(*) = 12 from pg_tables where schemaname = 'public'
     and tablename in ('scales','rooms','players','player_tokens','rounds',
                       'round_secrets','guesses','guess_values','bets',
                       'game_results','player_round_stats','analytics_events')) as tables_ok,
  (select count(*) = 7 from pg_views where schemaname = 'public'
     and viewname in ('v_best_rounds','v_player_stats','v_scale_stats','v_funnel',
                      'v_dropoff','v_clicks','v_room_dropoff'))             as views_ok,
  (select count(*) = 5 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename in ('rooms','players','rounds','guesses','bets'))      as realtime,
  case when (select count(*) from public.scales) = 0
       then 'now run supabase/scales-seed.sql'
       else 'schema and seed both in place' end                             as next_step;
