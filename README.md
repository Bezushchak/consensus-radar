# Consensus Radar

A Wavelength-style calibration game for teams. One player sees a hidden spot on a dial and describes it with a clue; their teammates each place their own marker on their own phone, and the server averages those markers into the team's answer. Everyone else bets on which side of the secret the team will land.

The original prototype was a single HTML file. This repository is the deployable version of it: a Next.js app with a real backend, persistent rooms, and a leaderboard. The prototype is kept at `legacy/consensus-radar.html` as an offline single-file fallback — it still works by double-clicking, needs no server, and shares no code with the app.

## What you need

- Node 18.18 or newer
- A free Supabase project (Postgres + Realtime)
- A Vercel account for hosting (optional for local play)

## Setting up Supabase

Create a project at supabase.com, then open the SQL editor and run the whole of `supabase/schema.sql`. The script is idempotent, so re-running it after a schema change is safe. It creates the room and round tables, the isolated secret tables, the durable stats tables, the three leaderboard views, the row-level-security policies, and the Realtime publication.

Then copy `.env.example` to `.env.local` and fill in the three values from Settings → API:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
SUPABASE_SERVICE_ROLE_KEY=<service_role secret key>
```

The service-role key must never get a `NEXT_PUBLIC_` prefix. It is used only inside API route handlers, where it never reaches the browser. The anon key is public by design and is used for one thing only: opening the Realtime websocket.

## Running locally

```
npm install
npm run dev
```

Open http://localhost:3000, create a room, and join the same room code from a phone on the same network (use your machine's LAN address) to see the own-device flow properly.

`npm run verify` runs the full gate: `tsc --noEmit`, the unit tests, and a production build. Run it before every deploy.

## Deploying to Vercel

Import the repository in Vercel; the framework is detected automatically and no build settings need changing. Add the same three environment variables under Settings → Environment Variables for Production, Preview, and Development, then deploy. `GET /api/health` is a cheap liveness check that confirms the app can reach Supabase.

Rooms are ephemeral, so nothing needs migrating between deploys. If you want stale rooms cleaned up automatically, schedule `select purge_stale_rooms();` as a cron job in Supabase; finished games are already copied into the durable stats tables before their room is eligible for purging.

## How the game works

The host creates a room, picks the team names, the scale categories (general or analytics), the target score, and whether side bets are on. Players join with the four-character room code and pick a team. Two teams need at least one player each before the game can start; a team with only one player has nobody to guess, since the clue-giver doesn't place a marker, so the lobby warns about that.

Each round picks a scale that hasn't been used yet and a secret target between 5 and 95. The clue-giver on the active team is whoever has given the fewest clues so far, ties broken by join order. They see the target; nobody else does. They write a clue with no digits in it. Their teammates then each drag their own slider and lock it in. Once everyone who can act has acted the round reveals automatically, and the host or clue-giver can force the reveal early.

Scoring is the prototype's, unchanged. The team's marker is the mean of the submitted guesses. Within 5 points of the target is a bullseye worth 5, within 12 is 3, within 40 is 0, and further than that is −2. Each other team gets +1 when the majority of its players called the correct side. Play continues until a team reaches the target score, or forever in endless mode.

## How the secret stays secret

Going own-device means the target has to survive being on the same page as the players who mustn't see it. Three things make that work.

The hidden values live in their own tables — `round_secrets`, `guess_values`, `player_tokens` — which have row-level security enabled and no policies at all. That combination makes them unreachable by the anon and authenticated roles; only the service role, which exists solely inside the API routes, can read them. The clue-giver gets the target through `GET /api/rooms/:code/secret`, which checks server-side that the requester really is this round's clue-giver.

The public `guesses` and `bets` rows carry only who has acted, never what they chose, so the Realtime payloads are safe to broadcast. Individual slider values and bet sides are folded into the round's `reveal_detail` at reveal time and only then become visible.

Realtime itself is treated as a doorbell rather than a data source. A change on any watched table triggers a debounced refetch of `GET /api/rooms/:code`, which recomputes what each requester is allowed to see. The client never derives state from a websocket payload, so there is exactly one authoritative version of the game and no way for a client to drift or spoof its way forward. Polling backs this up at 2.5-second intervals when the websocket is down and 15 seconds when it is up, plus an immediate refetch when a tab regains focus.

## Identity without accounts

There is no sign-in. Joining a room mints a `{playerId, token}` pair; the token is stored in the browser's localStorage and sent as `x-player-id` and `x-player-token` headers on every action, where it is checked against `player_tokens`. Clearing site data or switching browsers means losing the seat, which is the trade-off for zero-friction joining.

The same trade-off shapes the leaderboard: players are matched by name, so two people who both type "Dima" merge into one row, and one person who types "Dima" on Monday and "dima b" on Tuesday becomes two. The leaderboard page says as much.

## The leaderboard

Four boards, each filterable by all time, 30 days, or 7 days: team accuracy per finished game, the best single rounds, per-player clue-giving and guessing stats, and the scales that teams miss by the most. They read from `game_results` and `player_round_stats`, which are written when a game finishes and are independent of the rooms, so results outlive the rooms that produced them.

## Layout

`src/app` holds the pages and the API route handlers. `src/lib/game/engine.ts` is the pure rules — scoring, averaging, bet resolution, rotation, target and code generation, input sanitising — and has no I/O, which is why it is the part under test. `src/lib/server` is the backend service layer that owns every write. `src/lib/client` is the sync hook and the fetch wrappers. `src/lib/scales.ts` holds the 26 scales, keyed by stable identifiers so labels can be reworded without orphaning old stats. `src/lib/i18n.ts` is a flat UA/EN dictionary shared by both sides. `supabase/schema.sql` is the whole database.

`tests/engine.test.ts` covers the rules with `node:test` run through `tsx`: scoring bands and their symmetry around the target, marker averaging, bet resolution including the dead-centre case, target range, room-code format and collision rate, clue-giver rotation, turn order skipping empty teams, goal detection, input sanitising, team construction limits, scale-pool exhaustion, and the completeness of every scale in both languages.
