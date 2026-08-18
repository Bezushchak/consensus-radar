# Deploying Consensus Radar, step by step

Follow this top to bottom. Supabase comes before Vercel because Vercel needs the Supabase keys during setup. Total time is about 25 minutes, and everything used here is on free tiers.

Throughout, `PROJECT` means the folder this file is in: `~/Desktop/Consensus Radar/Consensus Radar`.

---

## Step 0 — Clean up and check the machine

I tried to create the git repository for you, but the sandbox I run in can't delete files inside your folder, so it left a broken `.git` directory behind. Remove it before you start, otherwise `git init` will fail with a lock error:

```bash
cd ~/Desktop/"Consensus Radar"/"Consensus Radar"
rm -rf .git
```

Now confirm Node is new enough. You need 18.18 or later; 20 or 22 is better:

```bash
node -v
```

If that prints nothing or something older, install Node 22 from nodejs.org (or `brew install node`).

Then install the dependencies and run the full check so you know the code is sound before any cloud is involved:

```bash
npm install
npm run verify
```

`verify` runs the type checker, the 27 unit tests, and a production build. All three must pass. This is the same gate Vercel will run, so if it passes here it will pass there.

---

## Step 1 — Create the Supabase project and database

This is the part that makes multi-device play possible. Every player's phone talks to the same Postgres database through your API routes, which is how one person's slider ends up on everybody else's screen.

**1.1** Go to https://supabase.com and sign in with GitHub (that saves you an account later).

**1.2** Click **New project**. Fill in:

- **Name**: `consensus-radar`
- **Database password**: click Generate, then save it in your password manager. You won't need it for this app, but you'll need it if you ever connect a SQL client directly.
- **Region**: pick the one closest to the people who'll play — `Central EU (Frankfurt)` for a Kyiv-based team.
- **Plan**: Free.

Click **Create new project** and wait about two minutes for it to provision.

**1.3** When it's ready, open **SQL Editor** in the left sidebar and click **New query**.

**1.4** Open `supabase/schema.sql` from this project, copy the entire file, paste it into the editor, and click **Run** (or ⌘↵). It should finish in a second or two and report success.

That one script creates everything: the room, player, round, guess and bet tables; the isolated secret tables; the durable stats tables that outlive rooms; the scale catalogue table; the analytics events table; the leaderboard and analytics views; the row-level-security policies; the Realtime publication; and two housekeeping functions. It's written to be idempotent, so if you ever change it and re-run the whole thing, nothing breaks.

**Watch the result line, and don't move on until it says success.** The SQL editor runs a whole script inside one transaction, so a single failing statement rolls back everything above it — the file either lands completely or not at all. That is worth knowing because of what it looks like later: if `schema.sql` fails and you go on to the seed, the seed fails with `ERROR: 42P01: relation "public.scales" does not exist`, and joins in the app start failing too, because none of the tables and columns the code expects are there. The error names the seed, but the cause is the script before it.

**If you already ran an earlier version of this file, run it again now.** Postgres skips `create table if not exists` for a table that already exists, which would leave the newer columns missing, so the script has an explicit migration block that adds them one by one — `scales`, `analytics_events`, `players.player_uid`, `player_round_stats.player_uid`, and the Ukrainian label columns on `rounds`. Re-running is the only way to get them, and it touches none of your existing data.

**1.5** Now load the scale catalogue. Click **New query** again, open `supabase/scales-seed.sql`, copy the whole file, paste, and **Run**. It inserts 262 bilingual pairs and finishes with a count you can eyeball: you want 262 rows, 180 general and 82 analytics.

This file upserts on the pair's key, so re-running it is safe. The one thing to know: it resets the wording of every pair back to what's in the repository, so if you edit labels in the dashboard, don't re-run it afterwards.

Once seeded, the catalogue is yours to edit without touching the code. **Table Editor → scales** lets you add a pair (give it a lower-case key with underscores and fill all four label columns) or retire one by setting `enabled` to false. Changes go live within five minutes — that's the server-side cache — and retiring a pair leaves the stats it already produced intact, because each round stores the wording it was dealt.

**1.6** Verify it landed. Open **Table Editor** in the sidebar. You should see these tables: `analytics_events`, `bets`, `game_results`, `guess_values`, `guesses`, `player_round_stats`, `player_tokens`, `players`, `round_secrets`, `rooms`, `rounds`, `scales`. If `round_secrets`, `guess_values`, `player_tokens` and `analytics_events` show a "no policies" or "RLS enabled, no policies" warning, that is correct and deliberate — that is exactly what keeps the secret target, other people's sliders, and the event log unreadable from the browser. Don't "fix" it.

**1.7** Collect the three keys. Go to **Project Settings** (gear icon) → **API** and copy:

- **Project URL** — looks like `https://abcdefghijk.supabase.co`
- **anon public** key — a long string starting `eyJ...`
- **service_role secret** key — also starts `eyJ...`, and is marked as secret

The service_role key bypasses every security rule in the database. It belongs only in server-side environment variables. Never paste it into a file that ships to the browser, never prefix it with `NEXT_PUBLIC_`, and never commit it to git.

**1.8** Wire it up locally so you can test before deploying:

```bash
cd ~/Desktop/"Consensus Radar"/"Consensus Radar"
cp .env.example .env.local
```

Open `.env.local` in a text editor and paste your three values in:

```
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

`.env.local` is already in `.gitignore`, so it will never be committed.

**1.9** Test it for real:

```bash
npm run dev
```

Open http://localhost:3000/api/health — you want `"ok":true`, `"supabase":"reachable"`, `"scales":"db"`, `"scaleCount":262`, and `"schema":{"ok":true,"missing":[]}`.

Read the `schema` part carefully, because it is the one that tells you whether step 1.4 really finished. It compares the live database against what this build writes to, and lists what is absent by name — `"table scales"`, `"players.player_uid"`, `"table analytics_events"`, and so on. Anything in that list means `schema.sql` did not complete, the route answers 503 instead of 200, and the fix is always the same: run `supabase/schema.sql` again and watch it succeed.

If you get `missing-env`, the file isn't named `.env.local` or the dev server needs restarting. If you get `unreachable`, one of the keys is wrong or truncated. If `scales` says `"builtin"`, step 1.5 didn't take: the app is falling back to the copy of the catalogue compiled into the code, so the game still works, but your dashboard edits won't show up.

Then open http://localhost:3000, create a room, and open the same room URL in a second browser window (or an incognito one — each window needs its own localStorage to count as a separate player). Join with a different name, put the two players on two different teams, and start a game. You should see the clue-giver's view on one side and the waiting view on the other, updating live.

Stop the dev server with `Ctrl+C` when you're satisfied.

---

## Step 2 — Push to GitHub

**2.1** Create the repository on GitHub. Go to https://github.com/new and set:

- **Repository name**: `consensus-radar`
- **Visibility**: Private is fine — Vercel works with private repos on the free plan.
- Leave "Add a README", "Add .gitignore" and "Choose a license" all **unchecked**. This project already has those files, and pre-adding them creates a conflict you'd have to merge.

Click **Create repository**. GitHub will show you a "push an existing repository" snippet — you'll use it in a moment.

**2.2** Initialise the local repository and make the first commit:

```bash
cd ~/Desktop/"Consensus Radar"/"Consensus Radar"
git init -b main
git add -A
git status
```

Read that `git status` output before committing. You should see roughly 40 files. What you must **not** see is `.env.local`, `node_modules/`, or `.next/`. If any of those appear, stop and check that `.gitignore` is present in the folder.

Then commit:

```bash
git commit -m "Consensus Radar: Next.js + Supabase multiplayer rooms and leaderboard"
```

If git complains that it doesn't know who you are, set your identity once and repeat the commit:

```bash
git config --global user.name "Dmytro Bezushchak"
git config --global user.email "dmytro.bezushchak@betterme.world"
```

**2.3** Connect it to GitHub and push. Replace `YOUR-USERNAME` with your GitHub handle:

```bash
git remote add origin https://github.com/YOUR-USERNAME/consensus-radar.git
git push -u origin main
```

If it asks for a password, GitHub no longer accepts account passwords over HTTPS. Either install the GitHub CLI (`brew install gh`, then `gh auth login`) and push again, or create a personal access token at Settings → Developer settings → Personal access tokens → Fine-grained tokens with Contents: Read and write, and paste that token as the password.

**2.4** Reload the repository page on GitHub. You should see `src/`, `supabase/`, `tests/`, `legacy/`, and the README rendered below the file list.

---

## Step 3 — Deploy on Vercel

**3.1** Go to https://vercel.com and sign up with **Continue with GitHub**. Signing in this way is what lets Vercel see your repositories.

**3.2** On the dashboard click **Add New → Project**.

**3.3** Find `consensus-radar` in the repository list and click **Import**. If it isn't listed, click **Adjust GitHub App Permissions** and grant Vercel access to that repository specifically.

**3.4** On the configuration screen, leave everything as detected. Framework Preset should read **Next.js**; build command, output directory and install command should all stay on their defaults. This project needs no custom build settings.

One warning you will see in the build log, and can ignore: *Due to `"engines": { "node": "22.x" }` in your package.json file, the Node.js Version defined in your Project Settings ("24.x") will not apply.* That is Vercel telling you it is doing the right thing — the app is tested and built on Node 22, `engines` says so, and `engines` wins. If you'd rather not see it, set Settings → General → **Node.js Version** to 22.x so the two agree. Don't fix it the other way round by deleting `engines`: that hands your runtime version over to whatever Vercel defaults to next.

**3.5** Before deploying, expand **Environment Variables** and add all three. For each one, paste the name, paste the value, and click **Add**:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role secret key |

Two more are optional and can wait until you've read Step 6:

| Name | Value | What it does |
|---|---|---|
| `ANALYTICS_TOKEN` | any long random string | Requires that string to read `/api/analytics` and `/analytics`. Without it, both are open to anyone with the URL. |
| `NEXT_PUBLIC_TRACK_POINTER` | `1` | Turns on the sampled pointer heat grid. Off by default. |

Leave the environment selector on all three of Production, Preview and Development so that preview deployments work too. Watch for trailing spaces or line breaks when pasting the long keys — that's the single most common cause of a deploy that builds fine but can't reach the database.

**3.6** Click **Deploy**. The build takes two or three minutes. When it finishes you get a URL like `https://consensus-radar.vercel.app`.

**3.7** Check the deployment immediately. Open `https://YOUR-APP.vercel.app/api/health` and confirm `"ok":true` with an empty `schema.missing` list. If it says `missing-env`, the variables were added after the build — go to Settings → Environment Variables, confirm all three, then Deployments → the latest one → **Redeploy**. Environment variables are baked in at build time, so a change always needs a redeploy.

**3.8** From now on, deploying means pushing:

```bash
git add -A
git commit -m "what changed"
git push
```

Vercel builds every push to `main` and promotes it to production automatically. Pushes to any other branch get their own preview URL, which is a safe place to try changes out.

---

## Step 4 — Prove it works with real people

Open the production URL on your phone, create a room, and read the four-character code out loud to somebody sitting near you (or send them the link with the Copy button). Have them open the same URL on their own phone, enter the code, and pick a team.

Check these five things, which together exercise everything that could go wrong across devices:

1. Both names appear in the lobby on both phones within a second or two.
2. Each phone is on a different team, and Start Game becomes clickable only once two teams have someone in them.
3. Only the clue-giver's phone shows the secret percentage. Look at the other phones and confirm the number is genuinely absent.
4. When a guesser locks their marker, the other phones see their name tick over to done without showing the value they chose.
5. At reveal, everybody sees the same target, the same averaged marker, and the per-player breakdown.

There is no player limit in the code. Practically, a room works comfortably up to about twenty people across four teams; beyond that the lobby list gets unwieldy long before anything technical strains.

Then play one game all the way to the target score and open `/leaderboard`. If the finished game shows up there, the whole chain — rooms, rounds, scoring, and the durable stats tables — is working end to end.

---

## Step 5 — Read the analytics

The app records its own usage. Nothing to install, no third-party script, no cookie banner: the events go into your own Supabase table and the dashboard reads them back.

**5.1** Open `https://YOUR-APP.vercel.app/analytics`. If you've played one game it already has something to say; if the page is empty, check that `analytics_events` exists (`/api/health` will tell you) and that you aren't opted out in this browser.

**5.2** Read it in this order.

The four tiles first: **sessions** (one browser tab counts once), **events**, **drop-out** — the share of people who opened the app and never locked a single guess, which is the one number to watch — and **median session**, how long a tab stayed open.

Then the funnel, which is the same nine steps every player walks: opened the app → started the create form → created a room → joined → started the game → sent a clue → locked a guess → completed a round → finished a game. **Conversion** is the share of step 1 that got this far. **Drop-off** is the share of the *previous* step that never arrived, and the largest number in that column is the thing to fix next. A big drop between "created a room" and "joined" means people can't get their friends in; a big drop between "joined" and "locked a guess" means the game itself is losing them.

Then the click table, which is literally who clicked what, per control per page, with the number of distinct sessions beside the raw count. A control that shows as `(unlabelled)` is one nobody labelled in the code yet — worth noticing rather than hiding.

Then the rooms table: how many devices joined each room versus how many actually played a round. This is the per-room version of the drop-out rate and it is usually the most actionable thing on the page, because it separates "nobody came" from "people came and bounced".

**5.3** Lock it down, if you care. Generate a random string, add it in Vercel as `ANALYTICS_TOKEN`, redeploy, and from then on the dashboard needs `https://YOUR-APP.vercel.app/analytics?key=YOUR-TOKEN`. Without the variable set, anyone who guesses the URL can read the numbers. There's nothing personal in there, but "how many people played" is still your business.

**5.4** Optional: pointer heat. Set `NEXT_PUBLIC_TRACK_POINTER=1` and each page view sends one event holding a 12×8 grid of where the cursor spent time. Cursor *trails* are deliberately not recorded — sixty events a second per player is both a bill and a way of identifying somebody — so this is a coarse heat map, not a replay, and it only tells you which region of the screen people hover. Leave it off unless you have a specific layout question.

**5.5** Keep the table small. Analytics rows are cheap but not free, so add a second daily cron job in Supabase → Integrations → Cron running:

```sql
select public.purge_old_events();
```

That deletes events older than 90 days. Pass an interval if you want a different window: `select public.purge_old_events(interval '30 days');`.

**What is not collected**, so you can say so if anyone asks: no IP addresses, no user agents, no names, no clue text, no cursor trails, and nothing that leaves your Supabase project. A session id is random and dies with the tab. The device id is the same non-credential id the leaderboard uses and grants access to nothing. Anyone can opt out for their browser by running `localStorage.setItem("cr:no-track", "1")` in the console, and a browser sending Do Not Track is skipped automatically.

---

## Step 6 — The finishing touches

**A nicer URL.** In Vercel, Settings → Domains lets you rename the project so the free URL becomes something like `consensus-radar-betterme.vercel.app`, or attach a domain you own. A short URL matters here, because people type it on phones.

**Do rooms expire?** Not on their own. A room you create today will still be there next month, still joinable with the same four-character code, unless something deletes it. Nothing in the app deletes rooms; the only thing that does is a function you have to schedule yourself:

```sql
select public.purge_stale_rooms();
```

Go to Supabase → **Integrations → Cron** and create a job on a daily schedule running exactly that. It deletes rooms whose last activity — any join, clue, guess or reveal — was more than 24 hours ago, and leaves everything more recent alone. If you want a different window, pass one: `select public.purge_stale_rooms(interval '7 days');`.

It's optional in the sense that nothing breaks without it; the free tier's 500 MB will hold years of games. It's worth doing anyway for one reason: room codes are only four characters, so codes get reused sooner when old rooms linger, and a stale room answering to a code somebody reads out loud is confusing.

Rooms are throwaway; results are not. Finished games are copied into `game_results` and `player_round_stats` before their room becomes eligible for deletion, so purging never costs you a leaderboard entry.

**Watch out for the free-tier pause.** Supabase pauses free projects after a week with no activity, and a paused database means the app returns errors. Opening the dashboard or the app resets that clock, so it only bites if you build this and then don't touch it for a fortnight. Restoring a paused project takes one click.

**Rotating a leaked key.** If the service_role key ever ends up somewhere public, go to Supabase → Project Settings → API → Reset service_role key, then update the variable in Vercel and redeploy. Nothing else needs changing.

**Logs when something misbehaves.** Vercel's Deployments → your deployment → **Functions** tab shows the runtime logs from the API routes, which is where any server-side error will surface. Supabase's **Logs → Postgres** shows what the database saw. Between the two you can trace any failed action.

---

## When something is wrong

The build fails on Vercel but `npm run verify` passed locally — check that `package-lock.json` was committed, since Vercel installs from the lockfile.

The page loads but every action errors — almost always the environment variables. Hit `/api/health` first; it tells you whether the problem is missing variables, an unreachable database, or a database that is reachable but missing tables and columns.

Joining fails, or a join succeeds and then bounces straight back to the join screen — check `/api/health` and look at `schema.missing`. This is what a half-applied `schema.sql` looks like from the outside: the code writes a column the database doesn't have, the insert fails, and the player never appears in the room state. The app is built to survive it — it drops the unknown column, logs `[schema] …`, and lets the game continue with the leaderboard grouping degraded — but the real fix is to run `supabase/schema.sql` again until it reports success. `/api/rooms/CODE/me` is the other useful probe: it answers `{"ok":true,...}` if the server still recognises your seat, which means the problem is in reading the room state rather than in your identity.

The seed fails with `ERROR: 42P01: relation "public.scales" does not exist` — `schema.sql` never completed. The SQL editor runs each script in one transaction, so a failure anywhere in that file leaves the database with none of it. Run `supabase/schema.sql` on its own, confirm it says success, then run the seed.

Players don't see each other update — the Realtime websocket is blocked or the publication didn't get created. The app degrades to polling every 2.5 seconds in this case, so the game stays playable but feels sluggish. To confirm the publication exists, run this in the SQL editor:

```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
```

You want `rooms`, `players`, `rounds`, `guesses` and `bets` in the result. If any are missing, re-run `supabase/schema.sql`.

Somebody lost their seat in a room — that's the cost of having no sign-in. Identity lives in the browser's localStorage, so clearing site data, switching browsers, or opening the room in a private window makes you a new player. They can rejoin with the same name and keep playing.

The same person shows up twice on the player leaderboard — check whether it's two browsers. Each browser mints its own permanent player id, and that id is what groups a person's rounds across games; the same human on a laptop and a phone is two ids and therefore two rows. Games played before this existed fall back to matching on name, and a name-only entry gets folded into the device entry that answers to the same name, so the usual cause is genuinely two devices. Merging them would need real accounts, which this game deliberately doesn't have.

Every round shows the same handful of scales — the seed didn't run. Check `/api/health`; `"scales":"builtin"` means the app is using the compiled-in fallback list rather than your table. Run `supabase/scales-seed.sql` and reload; no redeploy needed.

The analytics page is empty after people have played — three things to check in order. `/api/health` will say if `analytics_events` is missing. The period selector defaults to seven days, so try All time. And events are batched for a few seconds before being sent, so a tab that was closed instantly may have flushed nothing at all; if the table has rows but the page shows none, that's the period, not the pipeline.

`/api/analytics` returns 401 — `ANALYTICS_TOKEN` is set, so the page needs the key in its URL: `/analytics?key=YOUR-TOKEN`. To call the API directly, send it as an `x-analytics-key` header.

A scale you added in the dashboard doesn't appear — the server caches the catalogue for five minutes. Wait it out, or redeploy to clear it immediately. If it still doesn't appear, check that `enabled` is true and that all four label columns are filled; rows with a missing label are skipped rather than shown half-empty.
