-- =====================================================================
-- One-off cleanup: collapse duplicate seats, then make them impossible.
--
-- Run this ONCE, in the Supabase SQL Editor, after deploying the release
-- that made joining idempotent per device. It is deliberately NOT part of
-- schema.sql: schema.sql runs as a single transaction and is meant to be
-- safe to re-run forever, and the unique index at the bottom of this file
-- cannot be created while the duplicate rows it forbids still exist.
--
-- What went wrong, so the numbers below make sense: a phone could sit on a
-- cached copy of the room state that predated its own join. It never found
-- itself in the room, showed the join screen again, and every tap on Join
-- inserted another player row — "Anton 3", "Anton 3 2", "Anton 3 2 2" — all
-- from the same browser. Those extra rows are the ghosts.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Look before you delete. One row per device that holds more than one
--    seat in the same room, newest name last.
-- ---------------------------------------------------------------------
select
  r.code                       as room,
  p.player_uid,
  count(*)                     as seats,
  min(p.joined_at)             as first_join,
  array_agg(p.name order by p.joined_at) as names
from public.players p
join public.rooms r on r.id = p.room_id
where p.player_uid is not null
group by r.code, p.player_uid
having count(*) > 1
order by count(*) desc;

-- ---------------------------------------------------------------------
-- 2. Delete the ghosts.
--
-- The seat kept is the FIRST one the device took: it holds the name the
-- rest of the table already knows, it is the one the host's screen has been
-- showing all along, and for a host it is the row `rooms.host_player_id`
-- points at. Deleting a player cascades to their token, guesses and bets,
-- which is what we want — the ghosts never played a round.
-- ---------------------------------------------------------------------
with ranked as (
  select
    id,
    row_number() over (
      partition by room_id, player_uid
      order by joined_at, id
    ) as seat_no
  from public.players
  where player_uid is not null
)
delete from public.players
where id in (select id from ranked where seat_no > 1);

-- ---------------------------------------------------------------------
-- 3. Make it structurally impossible from here on.
--
-- The application no longer creates a second seat for a device that already
-- has one, but the application is not the last word — this is. The index is
-- partial because a null device id is not a duplicate of anything: rows
-- written before the player_uid column existed all have null, and two
-- different people who both cleared their storage are two players.
-- ---------------------------------------------------------------------
create unique index if not exists players_one_seat_per_device_idx
  on public.players (room_id, player_uid)
  where player_uid is not null;

-- ---------------------------------------------------------------------
-- 4. Confirm. Both queries should come back empty.
-- ---------------------------------------------------------------------
select r.code, p.player_uid, count(*)
from public.players p
join public.rooms r on r.id = p.room_id
where p.player_uid is not null
group by r.code, p.player_uid
having count(*) > 1;

-- A host row must still exist for every room that named one.
select r.code, r.host_player_id
from public.rooms r
where r.host_player_id is not null
  and not exists (select 1 from public.players p where p.id = r.host_player_id);
