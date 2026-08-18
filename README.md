# Consensus Radar

A Wavelength-style calibration game for teams. One player sees a hidden spot on a dial and describes it with a clue; their teammates each place their own marker on their own phone, and the server averages those markers into the team's answer. Everyone else bets on which side of the secret the team will land.

The original prototype was a single HTML file. This repository is the deployable version of it: a Next.js app with a real backend, persistent rooms, and a leaderboard. The prototype is kept at `legacy/consensus-radar.html` as an offline single-file fallback — it still works by double-clicking, needs no server, and shares no code with the app.

## What you need

- Node 18.18 or newer
- A free Supabase project (Postgres + Realtime)
- A Vercel account for hosting (optional for local play)

## Setting up Supabase

Create a project at supabase.com, then open the SQL editor and run two files, in this order.

`supabase/schema.sql` first. It creates the room and round tables, the isolated secret tables, the durable stats tables, the scale catalogue table, the three leaderboard views, the row-level-security policies, and the Realtime publication. The script is idempotent — `create table if not exists` for tables and an explicit `alter table ... add column if not exists` block for columns added after the first release — so running it again on a project that already has data is safe and is how you pick up schema changes.

`supabase/scales-seed.sql` second. It fills the `scales` table with the 262 bilingual pairs. It upserts on the key, so re-running it is safe too, with one caveat: it resets the labels of any pair you edited in the dashboard back to the wording in the repository.

Both files run as a single transaction, which is worth knowing when one fails: the Supabase SQL editor wraps a whole script in `begin`/`commit`, so a single failing statement rolls back everything above it. An error like `42P01: relation "public.scales" does not exist` while running the seed therefore means `schema.sql` did not complete, not that the seed is wrong. Fix `schema.sql`, run it until it reports success, and then run the seed. `GET /api/health` names any table or column that is still missing, so it is the fastest way to check the database matches the code.

Then copy `.env.example` to `.env.local` and fill in the three values from Settings → API:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
SUPABASE_SERVICE_ROLE_KEY=<service_role secret key>
```

Four more variables are optional. `ANALYTICS_TOKEN` locks the analytics API behind a shared secret and `NEXT_PUBLIC_TRACK_POINTER=1` turns on the sampled pointer heat grid; `MIXPANEL_TOKEN` and `MIXPANEL_HOST` mirror events to Mixpanel. All four are described under Analytics below.

The service-role key must never get a `NEXT_PUBLIC_` prefix. It is used only inside API route handlers, where it never reaches the browser. The anon key is public by design and is used for one thing only: opening the Realtime websocket.

## Running locally

```
npm install
npm run dev
```

Open http://localhost:3000, create a room, and join the same room code from a phone on the same network (use your machine's LAN address) to see the own-device flow properly.

`npm run verify` runs the full gate: `tsc --noEmit`, the unit tests, and a production build. Run it before every deploy.

## Deploying to Vercel

Import the repository in Vercel; the framework is detected automatically and no build settings need changing. Add the same three environment variables under Settings → Environment Variables for Production, Preview, and Development, then deploy. `GET /api/health` is a cheap liveness check that confirms the app can reach Supabase; it also reports which scale catalogue is live, so `"scales":"builtin"` is the sign that the seed file never got run.

The app pins Node 22 through `engines` in `package.json`, which is the version it is tested and built against. Vercel warns when its project setting disagrees and then honours `engines` anyway, so the warning is cosmetic; setting Settings → General → Node.js Version to 22.x silences it.

Rooms are ephemeral, so nothing needs migrating between deploys. Nothing expires on its own, though: a room lives until something deletes it, and the only thing that does is `select purge_stale_rooms();`, which removes rooms untouched for more than 24 hours. Schedule it as a daily cron job in Supabase if you want that; finished games are already copied into the durable stats tables before their room is eligible for purging, so the leaderboard never depends on a room still existing. `select purge_old_events();` is the same idea for analytics rows, with a 90-day default.

## How the game works

The host creates a room, picks the team names, the scale categories (general or analytics), the target score, and whether side bets are on. Players join with the four-character room code and pick a team. Two teams need at least one player each before the game can start; a team with only one player has nobody to guess, since the clue-giver doesn't place a marker, so the lobby warns about that.

Each round picks a scale that hasn't been used yet in that room and a secret target between 5 and 95. The catalogue holds 262 pairs — about 180 general and 82 analytics — so a long evening never repeats itself. The clue-giver on the active team is whoever has given the fewest clues so far, ties broken by join order. They see the target; nobody else does. They write a clue with no digits in it. Their teammates then each drag their own slider and lock it in. Once everyone who can act has acted the round reveals automatically, and the host or clue-giver can force the reveal early.

Scoring is the prototype's, unchanged. The team's marker is the mean of the submitted guesses. Within 5 points of the target is a bullseye worth 5, within 12 is 3, within 40 is 0, and further than that is −2. Each other team gets +1 when the majority of its players called the correct side. Play continues until a team reaches the target score, or forever in endless mode.

## How the secret stays secret

Going own-device means the target has to survive being on the same page as the players who mustn't see it. Three things make that work.

The hidden values live in their own tables — `round_secrets`, `guess_values`, `player_tokens` — which have row-level security enabled and no policies at all. That combination makes them unreachable by the anon and authenticated roles; only the service role, which exists solely inside the API routes, can read them. The clue-giver gets the target through `GET /api/rooms/:code/secret`, which checks server-side that the requester really is this round's clue-giver.

The public `guesses` and `bets` rows carry only who has acted, never what they chose, so the Realtime payloads are safe to broadcast. Individual slider values and bet sides are folded into the round's `reveal_detail` at reveal time and only then become visible.

Realtime itself is treated as a doorbell rather than a data source. A change on any watched table triggers a debounced refetch of `GET /api/rooms/:code`, which recomputes what each requester is allowed to see. The client never derives state from a websocket payload, so there is exactly one authoritative version of the game and no way for a client to drift or spoof its way forward. Polling backs this up at 2.5-second intervals when the websocket is down and 15 seconds when it is up, plus an immediate refetch when a tab regains focus.

## The scale catalogue

The 262 pairs are authored once, in TypeScript, and used three ways. `src/lib/scales-data.ts` is the single source: 180 general pairs grouped by theme and 82 analytics ones, each a `[key, uaLeft, uaRight, enLeft, enRight]` tuple. `npm run scales:sql` regenerates `supabase/scales-seed.sql` from that file, so the SQL is never hand-edited and cannot drift. At runtime `src/lib/server/scales.ts` reads the enabled rows out of Postgres, caches them for five minutes, and falls back to the TypeScript list if the table is empty or the query fails — a missing seed makes the game blander, not broken.

Living in the database is what makes the catalogue editable without a deploy: adding a pair in the Table Editor puts it in play within five minutes, and setting `enabled = false` retires one without touching the stats it already produced. Round rows store the exact wording they were dealt, in both languages, so rewording or retiring a pair never rewrites history.

Keeping 262 pairs out of the browser bundle took a little care. `src/lib/scales.ts` holds only types and pure helpers, `pickScale` takes a pool rather than reaching for the catalogue itself, and the client reads pole labels off the round row through `storedLabels`. The catalogue is therefore server-only — the production build has no scale text in `static/`, only in the server chunks — and the client needs no dictionary at all.

## Identity without accounts

There is no sign-in, and there are two separate ideas of "who you are".

Joining a room mints a `{playerId, token}` pair. The token is stored in localStorage and sent as `x-player-id` and `x-player-token` headers on every action, where it is checked against `player_tokens`. This is the credential: it authorises moves, and it belongs to one room.

Alongside it, each browser mints a `cr:player-uid` once — 32 random hex characters — and keeps it for every future game. It is not a credential and grants no access to anything, so leaking it does nothing; its only job is to make "Dmytro" one row on the leaderboard instead of one row per game. It travels with room creation and joining, is stored on `players`, and is copied onto every `player_round_stats` row at reveal time.

The trade-offs are worth stating plainly. A different browser, a private window, or cleared site data is a different player. Anyone who plays on this browser plays as this id. And two different people who share a name on two devices stay two rows — telling them apart needs a real account, which is exactly what this game is designed not to require.

Games played before the id existed still count. `player_round_stats` rows with no id group by lower-cased name, and a name-only group is folded into the device group that answers to the same name, so a returning player is not listed twice. The SQL view `v_player_stats` mirrors the simpler half of that rule — `group by coalesce(player_uid, lower(player_name))` — for ad-hoc queries in the SQL editor; the API does the fold.

That fold is also the honest limit of all this. A browser that cannot keep storage has no id, so typing somebody else's name lands in their row — which is what the leaderboard did for everybody before, and is the price of keeping the old scores. The ids themselves never reach another player's browser (room state blanks them out), but they aren't a security boundary and nothing here would survive somebody who actively wanted to game it. For a party game among colleagues that seemed like the right place to stop; a real fix is accounts, which is the one thing this game refuses to ask for.

The device id earns its keep a second way: it makes joining a room idempotent. One device gets one seat, so a second `POST /api/rooms/:code/join` from the same browser hands back the seat it already owns with a fresh token rather than inserting another player. Their name and their team survive, because the rest of the table already knows them by both. `supabase/dedupe-players.sql` adds a partial unique index on `(room_id, player_uid)` that enforces this in the database as well, since the application is not the last word on it.

That matters more than it sounds. Retrying a join is completely normal — the network eats the answer, a tab loses its storage, somebody just reloads — and until this was idempotent every retry created a real new player. One phone that kept landing back on the join screen put eleven copies of the same person in one lobby, each named a little more absurdly than the last: `Anton 3`, `Anton 3 2`, `Anton 3 2 2`. The suffix is `uniqueName()` doing exactly what it was told.

## Reading the room state, and one iOS trap

The client treats Supabase Realtime as a doorbell rather than a data feed: any change to the room's tables triggers a debounced refetch of `GET /api/rooms/:code`, which is the single authoritative answer. A poll runs underneath as a safety net — every 2.5 s while the websocket is down, every 15 s once it is up — plus a refetch whenever the tab becomes visible, because phones sleep aggressively.

All of which is useless if the phone answers the fetch out of its own cache, and this is a real thing mobile Safari does. Every read is therefore given a URL nothing has seen before (`?_=<timestamp><counter>`, see `cacheBust` in `src/lib/client/api.ts`) on top of the `no-store` on both the request and the response. A URL that is new cannot be in any cache — not Safari's, not a proxy's, not a CDN's.

This was not theoretical. Because the room state is a plain GET, a phone could hold the response captured the instant the room was created — one player, the host — and re-serve it to every poll forever. The player never appeared in their own room, so the join screen came back, so they joined again, and the room filled up with ghosts. The tell was that `GET /api/rooms/:code/me` stayed correct throughout: it carries the identity headers, so it was never a cache candidate. When the server insists you are in a room whose state does not list you, suspect the transport, not the database.

## Analytics

The leaderboard answers "who plays well". Analytics answers a different question: how many people who open the app end up playing, and where the rest stop. `/analytics` is the dashboard, `analytics_events` is the table, and both are entirely self-hosted — no third-party script, no cookie banner to add.

Every event is a row in `analytics_events`: a `session_id` (random per browser tab), the device id the leaderboard already groups by, the room code where one applies, the event name, the normalised path (`/room/[code]`, never the real code), a small `props` object, language, and whether the device is mobile or desktop. Nine of those names are the funnel, in order: `app_open`, `create_open`, `room_created`, `joined`, `game_started`, `clue_sent`, `guess_locked`, `round_revealed`, `game_finished`. The rest are useful but never gate a step: `join_open`, `leaderboard_open`, `lang_switched`, `bet_placed`, `click`, `pointer_heat`, `error_shown`, `session_end`.

Conversion is the share of step 1 that reached a step. Drop-off is the share of the previous step that never arrived, which is the column that tells you where to look. The drop-out rate is the one headline number: sessions that opened the app and never locked a guess. Median session length comes from `session_end`, which fires with the seconds spent on the page.

Clicks are labelled rather than guessed. Every control worth counting carries a `data-ev` attribute, one delegated capture-phase listener reads the nearest one, and anything clickable without a label is counted as `(unlabelled)` — which is how a missing label gets noticed instead of silently disappearing. Mouse movement is deliberately *not* recorded as a trail: a raw `mousemove` stream is roughly sixty events a second, about thirty-six thousand rows for a ten-minute player, and it is the one signal here that would genuinely identify somebody. Instead the client keeps a 12×8 grid, samples the pointer twice a second, and sends one `pointer_heat` event per page view with the cell counts. It is off unless `NEXT_PUBLIC_TRACK_POINTER=1` is set.

The client side is a queue, not a request per event: `src/lib/client/track.ts` batches for four seconds or thirty events, posts to `POST /api/events`, and flushes through `navigator.sendBeacon` when the page goes away. The endpoint always answers 204 — `sendBeacon` has nobody to listen — and a write failure is logged and dropped, because analytics is not allowed to break a game. On the way in, the server drops any event name not on the allowlist, clamps `props` to eight shallow keys of 120 characters, and replaces a timestamp that claims to be from the future or from last week. `analytics_events` has RLS enabled and no policies, exactly like the secret tables, so nothing in a browser can read it back.

Reading it takes two routes and one page. `GET /api/analytics?period=day|week|month|all` returns the whole summary as JSON; `/analytics` renders it — the KPI tiles, the funnel with conversion and drop-off, the click table, and per-room joined-versus-played. Set `ANALYTICS_TOKEN` and the API requires it as an `x-analytics-key` header, which the page forwards from `?key=…` in its own URL; leave it unset and both are open, which is fine for a party game and not fine for anything else. The SQL views `v_funnel`, `v_dropoff`, `v_clicks` and `v_room_dropoff` answer the same questions in the Supabase editor for anything the page doesn't show.

### Mixpanel

Setting `MIXPANEL_TOKEN` mirrors every event to Mixpanel as well, which buys the reports that would be tedious to build here: funnels with arbitrary step ordering and conversion windows, retention, flows, and breakdowns by any property. Supabase stays the source of truth and `/analytics` keeps working either way; Mixpanel is a second reader.

The mirror runs server-side, inside `POST /api/events`, rather than through Mixpanel's browser SDK. Three reasons. The app's own instrumentation already funnels every `track()` call through that endpoint, so nothing needs re-labelling. Requests to our own origin are never dropped by an ad blocker, while a meaningful share of browsers block Mixpanel's domain outright — and analytics that are quietly wrong are worse than none. And nothing extra ships to a phone on mobile data. The cost of that choice is Session Replay, which needs the browser SDK to record the DOM; if it ever becomes worth ~30 KB and the blocked-request problem, `mixpanel-browser` can be added alongside without touching the server path.

`src/lib/server/mixpanel.ts` holds it. `toMixpanel` is a pure mapping and is the part under test: `distinct_id` is the device id, so one person is one user across games, with `session-<id>` as the fallback for a browser that cannot keep storage; `$device_id` mirrors it so Mixpanel's simplified ID merge treats the player as an anonymous device, which is what they are — there are no accounts. `$insert_id` is a hash of the event, so a re-sent batch de-duplicates instead of inflating the funnel. `ip` is pinned to `"0"` because we never collect the player's IP and letting Mixpanel resolve one from a Vercel region would invent a location for everybody. Props named `token`, `distinct_id` or `ip` are stripped, so a stale client cannot redirect events to another project.

Two details cause almost every "it's set up but nothing appears". The data region: an EU project — the URL says `eu.mixpanel.com` — must be sent to `https://api-eu.mixpanel.com`, and the US host answers `200` while discarding the data, so `MIXPANEL_HOST` defaults to the EU one here. And the token has to exist in the environment that is actually running: locally that is `.env.local`, in production it is Vercel, and environment variables are baked at build time, so adding one needs a redeploy. `npm run mixpanel:test` sends a single `mixpanel_probe` event through the real code path to check both, and `GET /api/health` reports `"mixpanel":"on"` or `"off"`.

What is deliberately not collected: no IP address, no user agent, no cursor trail, no names, no clue text, no cross-site anything. A session id is per tab and expires with it, and the device id grants no access to anything. `localStorage.setItem("cr:no-track", "1")` or a browser's Do Not Track setting turns the whole thing off for that browser.

## The leaderboard

Four boards, each filterable by all time, 30 days, or 7 days: team accuracy per finished game, the best single rounds, per-player clue-giving and guessing stats, and the scales that teams miss by the most. They read from `game_results` and `player_round_stats`, which are written when a game finishes and are independent of the rooms, so results outlive the rooms that produced them.

## Layout

`src/app` holds the pages and the API route handlers. `src/lib/game/engine.ts` is the pure rules — scoring, averaging, bet resolution, rotation, target and code generation, input sanitising — and has no I/O, which is why it is the part under test. `src/lib/server` is the backend service layer that owns every write, including `scales.ts`, the cached database-backed pool. `src/lib/server/analytics.ts` is the event ingest and the report, `src/lib/server/mixpanel.ts` the Mixpanel mirror, and `src/lib/server/schema-check.ts` what lets `/api/health` name a missing table. `src/lib/client` is the sync hook, the fetch wrappers, the localStorage identity, and `track.ts`, the batching event queue. `src/lib/scales.ts` is types and pure helpers; `src/lib/scales-data.ts` is the 262-pair catalogue, keyed by stable identifiers so labels can be reworded without orphaning old stats. `src/lib/i18n.ts` is a flat UA/EN dictionary shared by both sides. `scripts/gen-scales-sql.ts` generates the seed. `supabase/schema.sql` is the whole database and `supabase/scales-seed.sql` its catalogue.

`tests/engine.test.ts` covers the rules with `node:test` run through `tsx`: scoring bands and their symmetry around the target, marker averaging, bet resolution including the dead-centre case, target range, room-code format and collision rate, clue-giver rotation, turn order skipping empty teams, goal detection, input sanitising, device-id validation, team construction limits, scale-pool filtering and exhaustion, catalogue size and per-category minimums, the completeness and seed-safety of every scale in both languages, and the language fallback for rounds stored before the Ukrainian columns existed.

Analytics is tested the same way, because the numbers a dashboard shows are worth being sure of: `buildRows` is pinned on the allowlist, the props clamp, and the timestamp guard, and `foldEvents` on the four things that are easy to get wrong — a session counted once however often it fires, conversion and drop-off against the right denominators, a drop-out rate that is null rather than zero when nothing has happened, and clicks grouped per control *and* page with a distinct-session count beside the raw total. `toMixpanel` is pinned on the identity mapping, the millisecond timestamp, the de-duplication id, and the fact that a hostile prop cannot overwrite the project token.

The leaderboard's grouping is the other thing worth testing, because it is the only place where "who is this person" is decided. `foldPlayerRows` is exported as a pure function for exactly that reason, and the tests pin down the four cases that matter: one device across several games and several names is one row, a legacy name-only row folds into the device that answers to the same name, two devices sharing a name stay two rows, and the three roles are counted and ranked separately.
