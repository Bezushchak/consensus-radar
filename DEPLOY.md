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

`verify` runs the type checker, the 68 unit tests, and a production build. All three must pass. This is the same gate Vercel will run, so if it passes here it will pass there.

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

**1.4** Open `supabase/schema.sql` from this project, copy the entire file, paste it into the editor, and click **Run** (or ⌘↵). It takes a second or two.

That one script creates everything: the room, player, round, guess and bet tables; the isolated secret tables; the durable stats tables that outlive rooms; the scale catalogue table; the analytics events table; the leaderboard and analytics views; the row-level-security policies; the Realtime publication; and two housekeeping functions. It's written to be idempotent, so if you ever change it and re-run the whole thing, nothing breaks.

**Do not move on until you have read the table it prints.** The file ends with a summary row, precisely so that "it seemed to work" is not a judgement call:

| tables | views | scales_rows | tables_ok | views_ok | realtime | next_step |
|---|---|---|---|---|---|---|
| 12 | 7 | 0 | true | true | true | now run supabase/scales-seed.sql |

`tables_ok` and `views_ok` must both be `true`. `realtime` may come back `false` on some projects, where the role you are running as isn't allowed to modify the `supabase_realtime` publication; that is survivable — the app polls every 2.5 seconds instead, and the game plays fine, just less snappily.

If instead you get a red error, **nothing at all was applied.** The SQL editor runs a whole script inside one transaction, so one failing statement rolls back every statement above it; there is no half-applied state. Fix what the error names and run the file again. This matters because of how it shows up next: if `schema.sql` failed and you go on to the seed anyway, the seed fails with `ERROR: 42P01: relation "public.scales" does not exist`. That error names the seed, but the cause is the script before it — the seed is trying to fill a table that was never created.

**If you already ran an earlier version of this file, run it again now.** Postgres skips `create table if not exists` for a table that already exists, which would leave the newer columns missing, so the script has an explicit migration block that adds them one by one — `scales`, `analytics_events`, `players.player_uid`, `player_round_stats.player_uid`, the Ukrainian label columns on `rounds`, and the three phase-clock columns (`rooms.clue_seconds`, `rooms.guess_seconds`, `rounds.phase_deadline`). Re-running is the only way to get them, and it touches none of your existing data.

The clock columns are the newest of those, and worth a sentence because the symptom of skipping them is so quiet: the game plays exactly as it always did, but the lobby's two timer pickers refuse to save. Every limit reads as unlimited, no countdown is ever drawn, and nothing else about the room changes — the feature is absent rather than broken. If saving settings shows you an error mentioning `clue_seconds`, that is this, and the fix is to run `schema.sql` again.

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

The rest are optional and can wait until you've read Steps 5 to 7:

| Name | Value | What it does |
|---|---|---|
| `ANALYTICS_TOKEN` | any long random string | Requires that string to read `/api/analytics` and `/analytics`. Without it, both are open to anyone with the URL. |
| `CRON_SECRET` | any long random string | Switches on the nightly housekeeping job. Without it `/api/cron/cleanup` refuses every request, including Vercel's own. See Step 7. |
| `NEXT_PUBLIC_TRACK_POINTER` | `1` | Turns on the sampled pointer heat grid. Off by default. |
| `MIXPANEL_TOKEN` | your Mixpanel project token | Mirrors every event to Mixpanel too. See Step 6. |
| `MIXPANEL_HOST` | `https://api-eu.mixpanel.com` | Only needed if your Mixpanel project is US-hosted, in which case set `https://api.mixpanel.com`. |

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

Check these ten things, which together exercise everything that could go wrong across devices:

1. Both names appear in the lobby on both phones within a second or two.
2. Each phone is on a different team, and Start Game becomes clickable only once two teams have someone in them.
3. Only the clue-giver's phone shows the secret percentage. Look at the other phones and confirm the number is genuinely absent.
4. When a guesser locks their marker, the other phones see their name tick over to done without showing the value they chose.
5. At reveal, everybody sees the same target, the same averaged marker, and the per-player breakdown.
6. **Whose buttons these are.** Reveal, Skip and Next belong to the round's clue-giver and to nobody else — including the host, who is usually on the other team. Look at every other phone during a round and confirm those buttons are genuinely not on the screen, not merely greyed out; the phones that owe nothing show a waiting line instead. Then play a second round and confirm the buttons have moved to a different person, because the clue-giver rotates.
7. **The side bet needs the whole team.** With at least two people on a watching team, have them deliberately tap opposite sides: both phones show a warning that the team is split, and at reveal that team scores nothing for the bet. Play the next round with both tapping the same correct side and the team gets its point. While they are deciding, the dial should show each guess as a faint needle *and* one bright teal needle with a disc on it — that bright one is the average the bet is actually settled against, and the percentage under the dial should match it and move as more markers land.
8. **The escape hatches, which need a phone to actually go quiet.** On the clue-giver's turn, have them press Skip this round: nothing is scored, the turn passes to the other team, and the round number does not advance. Then close the clue-giver's tab entirely and wait two minutes on the other phone — a Skip button should appear there too, because the people staring at an empty dial are the ones who need it. Same test for hosting: close the host's tab, wait two minutes, and the other phone should offer to take over as host. Both waits are real; the threshold is two minutes and the host and clue-giver report in every 45 seconds, so nothing appears sooner.
9. **The clocks, which are the one feature that needs the schema re-run.** In the lobby, set the clue timer to 1 min and the guess timer to 1 min, press Save settings, and confirm it says saved rather than showing an error — an error naming `clue_seconds` means step 1.4 was skipped or run from an older copy of the file. Then start a round and let the clue timer run out without writing anything: the round reveals with no clue and zero points for that team, the secret is shown, and Next passes the turn. Play the next round properly and this time let the *guess* timer run out on one phone while the other locks a marker normally — the silent phone is credited with 50, the round reveals, and the average sits between the two. Watch the clue-giver's phone for the last twenty seconds: the countdown goes amber, then red for the final five, and only that phone beeps and buzzes. The phones that owe nothing stay silent, which is the point.
10. **The end of the game.** Play to the target score and check the winner screen opens with a three-step podium — the winner raised in the middle, gold, silver and bronze steps, your own team outlined — above the scoreboard, and that the steps are not pressable there. Then check it shows the per-player table under the scoreboard — average error, best, bullseyes, bets — with your own row highlighted. Somebody who only ever gave clues appears at the bottom with "clues only" rather than a zero. A round lost to the clue clock leaves no marker in anybody's average, so it does not appear as a miss for the people who never got to guess.

There is no player limit in the code. Practically, a room works comfortably up to about twenty people across four teams; beyond that the lobby list gets unwieldy long before anything technical strains.

Then play one game all the way to the target score and open `/leaderboard`. If the finished game shows up there, the whole chain — rooms, rounds, scoring, and the durable stats tables — is working end to end.

Three things to check on that page, because it is the one screen assembled entirely from the durable tables. The top three of whichever board you are on stand on a podium and the table underneath starts at rank 4 — if a name appears in both places, the podium and the table have fallen out of step. Every step and every row opens a card with the columns the table had to drop to fit on a phone; on the **Rounds** board that card draws the actual dial, so the needle should sit where the miss says it should. And switching board or period closes any open card, because the ranks it was describing have just been reshuffled.

---

## Step 5 — Read the analytics

The app records its own usage. Nothing to install, no third-party script, no cookie banner: the events go into your own Supabase table and the dashboard reads them back.

**5.1** Open `https://YOUR-APP.vercel.app/analytics`. If you've played one game it already has something to say; if the page is empty, check that `analytics_events` exists (`/api/health` will tell you) and that you aren't opted out in this browser.

**5.2** Read it in this order.

The four tiles first: **sessions** (one browser tab counts once), **events**, **drop-out** — the share of people who opened the app and never locked a single guess, which is the one number to watch — and **median session**, how long a tab stayed open.

Then the funnel, which is the same nine steps every player walks: opened the app → started the create form → created a room → joined → started the game → sent a clue → locked a guess → completed a round → finished a game. **Conversion** is the share of step 1 that got this far. **Drop-off** is the share of the *previous* step that never arrived, and the largest number in that column is the thing to fix next. A big drop between "created a room" and "joined" means people can't get their friends in; a big drop between "joined" and "locked a guess" means the game itself is losing them.

Then **Other events**, which is everything the app records that isn't a step in that walk. Most of it is context — who opened the leaderboard, who switched language — but two rows are the ones to actually watch, because they only happen when a room has stopped moving. `round_skipped` next to `round_revealed` is how often a scale or a clue-giver defeats a table. `host_claimed` next to `room_created` is how often the person who opened the room walked away from it. If either ratio climbs, the fix is upstream of the button: a better scale pool, a clearer clue screen, fewer host-only controls.

Then the click table, which is literally who clicked what, per control per page, with the number of distinct sessions beside the raw count. A control that shows as `(unlabelled)` is one nobody labelled in the code yet — worth noticing rather than hiding.

Then the rooms table: how many devices joined each room versus how many actually played a round. This is the per-room version of the drop-out rate and it is usually the most actionable thing on the page, because it separates "nobody came" from "people came and bounced".

If you'd rather read all this in Mixpanel, Step 6 mirrors the same events there. The two are not alternatives — the app sends to both.

**5.3** Lock it down, if you care. Generate a random string, add it in Vercel as `ANALYTICS_TOKEN`, redeploy, and from then on the dashboard needs `https://YOUR-APP.vercel.app/analytics?key=YOUR-TOKEN`. Without the variable set, anyone who guesses the URL can read the numbers. There's nothing personal in there, but "how many people played" is still your business.

**5.4** Optional: pointer heat. Set `NEXT_PUBLIC_TRACK_POINTER=1` and each page view sends one event holding a 12×8 grid of where the cursor spent time. Cursor *trails* are deliberately not recorded — sixty events a second per player is both a bill and a way of identifying somebody — so this is a coarse heat map, not a replay, and it only tells you which region of the screen people hover. Leave it off unless you have a specific layout question.

**5.5** Keep the table small. Analytics rows are cheap but not free, and events older than a quarter are not answering any question you still have. **This is already handled** by the nightly job in Step 7 — the same run that clears out stale rooms also deletes events older than 90 days, so if you set `CRON_SECRET` there is nothing to do here.

If you'd rather run it from Supabase instead, or want a different window, the function is yours to call directly in Supabase → Integrations → Cron:

```sql
select public.purge_old_events(interval '30 days');
```

It is safe to have both: the second run finds nothing left to delete and returns `0`.

**What is not collected**, so you can say so if anyone asks: no IP addresses, no user agents, no names, no clue text, no cursor trails, and nothing that leaves your Supabase project. A session id is random and dies with the tab. The device id is the same non-credential id the leaderboard uses and grants access to nothing. Anyone can opt out for their browser by running `localStorage.setItem("cr:no-track", "1")` in the console, and a browser sending Do Not Track is skipped automatically.

---

## Step 6 — Mixpanel (optional, and click-by-click)

Step 5 is your own dashboard: the funnel, the drop-off, the clicks. Mixpanel gives you the reports that would be a lot of work to build by hand — funnels you can reorder without a deploy, retention, flows, and breakdowns by any property. The app mirrors its events to Mixpanel so both work at once, and your Supabase table stays the source of truth.

Note before you start: **it's `npm`, not `pip`.** Mixpanel's docs default to their Python SDK, which is for a Python backend; this app is TypeScript. And there's nothing to install at all here — the integration is one HTTP call, already written, in `src/lib/server/mixpanel.ts`. All you do is provide the token.

### 6.1 — Get the token (Mixpanel UI)

In the screenshot you sent, the **gear icon at the bottom left** of the sidebar is what you want.

1. Click the **gear icon** (bottom-left, next to the bell).
2. Choose **Project Settings**.
3. Find the **Access Keys** section. The first field is **Project Token** — a 32-character string.
4. Copy it.

That token is write-only. It can send events to your project and cannot read anything out of it, which is why it's safe to hand around and why it lives in an ordinary environment variable rather than a secret store. If you ever want a fresh one, the same screen has the option.

Also note the URL of your project. Yours reads `eu.mixpanel.com`, which means EU data residency — that matters in 6.2 and is the single most common reason a correct-looking setup shows nothing.

### 6.2 — Point the app at it

Locally, add one line to whichever env file you already keep — `.env` and `.env.local` are both read, and the test script below reads them in the same order Next does:

```
MIXPANEL_TOKEN=your-project-token
```

Nothing else. The app already defaults to the EU ingestion host, `https://api-eu.mixpanel.com`, which is right for your project. (If you ever move to a US-hosted project, add `MIXPANEL_HOST=https://api.mixpanel.com`. Sending EU data to the US host gets you a cheerful `200` and no data — worth knowing, because it looks exactly like a broken token.)

Then prove the connection before doing anything else:

```bash
npm run mixpanel:test
```

That sends one event called `mixpanel_probe` through the same code the app uses. It either says *Accepted by Mixpanel* or tells you which of the three usual causes it hit. If it says `MIXPANEL_TOKEN is not set`, the line it prints tells you which env files it actually found — check the token is in one of them and has no quotes around it.

To make it live in production, add `MIXPANEL_TOKEN` in Vercel → Settings → Environment Variables for Production, Preview and Development, then **redeploy** — variables are baked in at build time, so an existing deployment will not pick it up. Confirm with `/api/health`, which now reports `"mixpanel":"on"`.

### 6.3 — Confirm events are arriving (Mixpanel UI)

1. Left sidebar → **Data** (the database icon) → **Events**.
2. Wait up to a minute and reload. You're looking for `mixpanel_probe` from the test above, and after a game for `app_open`, `room_created`, `joined`, `guess_locked` and friends.
3. The **No Events Detected** badge on the Home page clears itself once data lands.

Once that works you can ignore the "Connect your data" card and the "Invite an engineer" card on Home entirely — those are onboarding prompts for people who haven't wired anything up yet. You have.

### 6.4 — Build the two reports actually worth having

Nothing needs configuring for events to arrive, but reports don't create themselves. These two are the ones to make.

**The funnel.** Click **+ Create New** (top left) → **Funnels**. Add these steps in order, typing each event name into the step field:

```
app_open  →  room_created  →  joined  →  game_started  →  guess_locked  →  game_finished
```

Set the conversion window (top right of the report) to something like **1 day** — a party game is played in one sitting, and a 30-day window would count a room created last week as converted by a game today. Save it with **Save** in the top right and give it a name like "Play funnel". The step-to-step percentages are the same idea as the drop-off column on your own `/analytics` page; this one you can reorder and re-window without touching the code.

**The click breakdown.** **+ Create New** → **Insights**. Set the event to **click**, then use **Breakdown** and choose the property **target**. That gives you a bar per control — `create-room`, `join-room`, `submit-guess`, `send-clue` and so on. Add a second breakdown by `path` if you want to separate the same label on different pages.

Optional but cheap: **Retention** (do people come back for a second game — pick `app_open` as both the birth and return event) and **Flows** (what people actually do after `joined`, in the order they do it).

### 6.5 — Two settings worth fixing now

**Timezone.** Gear icon → Project Settings → **Timezone**. Set it to Kyiv. Reports bucket by day in the project's timezone, so leaving it on UTC quietly splits your evening games across two days.

**Lexicon.** Left sidebar → Data → **Lexicon**. This is where you can give each event a plain-language description — "player locked their slider" for `guess_locked` — so the next person reading a report doesn't have to guess. Purely for humans; nothing breaks without it.

### 6.6 — What Mixpanel will *not* show you

**Session Replay** is in your sidebar and it will stay empty. Recording a session means capturing the page's DOM as the person uses it, which only Mixpanel's in-browser SDK can do, and this integration deliberately sends events from the server instead. That choice buys three things: one set of labels for both dashboards, no ~30 KB of extra JavaScript on a phone, and — the real reason — events that ad blockers can't drop, since the browser only ever talks to our own domain. If replay later matters more than those, the browser SDK can be added alongside without changing the server path.

**Users with names.** There are no accounts, so a Mixpanel "user" is a browser: the same device id the leaderboard groups by. Two devices are two users even for the same human. That's the same trade-off described under Identity without accounts, and it's the price of a game nobody has to sign in to.

---

## Step 7 — The finishing touches

**A nicer URL.** In Vercel, Settings → Domains lets you rename the project so the free URL becomes something like `consensus-radar-betterme.vercel.app`, or attach a domain you own. A short URL matters here, because people type it on phones.

**Do rooms expire?** Yes, once you set one variable. Nothing in the game itself ever deletes a room — a room you create today would otherwise still be there next month, still answering to the same four-character code — so the app ships a nightly housekeeping job instead. It's already wired: `vercel.json` schedules `GET /api/cron/cleanup` at 04:00 UTC every day, and Vercel picks that file up on deploy with nothing to configure in the dashboard.

The one thing you have to do is give it the secret, because that route holds the service-role key and an open URL there would be an unauthenticated delete-everything button. Generate a long random string, add it in Vercel → Settings → Environment Variables as `CRON_SECRET` for Production, and redeploy. Vercel then sends it as `Authorization: Bearer <secret>` on every cron invocation, and the route checks it. **Leave the variable unset and the route refuses everything with a 503** — closed by default, so a deploy that forgets the secret loses the cleanup rather than exposing it.

Check it by hand once, replacing both placeholders:

```bash
curl -s -H "Authorization: Bearer YOUR-CRON-SECRET" \
  https://YOUR-APP.vercel.app/api/cron/cleanup
```

You want `{"ok":true,"rooms":{"deleted":N},"events":{"deleted":M}}`. Zeroes are a pass — it means there was nothing old enough to remove. A `401` means the secret in the header doesn't match the one in Vercel; a `503` means the variable isn't in the running environment, which usually means it was added after the last build. If either half reports `{"error":"..."}` instead of a count, the named function is missing from your database: run `supabase/schema.sql` again. The two deletions are deliberately independent, so one missing function never costs you the other.

**What it deletes**: rooms whose last activity — any join, clue, guess or reveal — was more than 48 hours ago, and analytics events older than 90 days. The room cutoff is measured from `updated_at`, not from creation, so a game that has been running for eight hours is safe.

**What it will not touch**: `game_results` and `player_round_stats`, ever. Finished games are copied there the moment the winner screen appears, so purging a room never costs you a leaderboard entry. Rooms are throwaway; results are not.

Both rules live in `supabase/schema.sql` as `security definer` functions with `execute` revoked from `anon` and `authenticated` — the route only calls them. If you want different windows, change the intervals in `src/app/api/cron/cleanup/route.ts`, or call the functions from Supabase → Integrations → Cron yourself: `select public.purge_stale_rooms(interval '7 days');`.

Nothing breaks if you skip all of this — the free tier's 500 MB will hold years of games. It's worth doing for one reason that has nothing to do with storage: room codes are only four characters, so codes get recycled sooner when old rooms linger, and a stale room answering to a code somebody just read out loud is a confusing way to lose ten minutes.

**Watch out for the free-tier pause.** Supabase pauses free projects after a week with no activity, and a paused database means the app returns errors. Opening the dashboard or the app resets that clock, so it only bites if you build this and then don't touch it for a fortnight. Restoring a paused project takes one click.

**Rotating a leaked key.** If the service_role key ever ends up somewhere public, go to Supabase → Project Settings → API → Reset service_role key, then update the variable in Vercel and redeploy. Nothing else needs changing.

**Logs when something misbehaves.** Vercel's Deployments → your deployment → **Functions** tab shows the runtime logs from the API routes, which is where any server-side error will surface. Supabase's **Logs → Postgres** shows what the database saw. Between the two you can trace any failed action.

---

## When something is wrong

The build fails on Vercel but `npm run verify` passed locally — check that `package-lock.json` was committed, since Vercel installs from the lockfile.

The page loads but every action errors — almost always the environment variables. Hit `/api/health` first; it tells you whether the problem is missing variables, an unreachable database, or a database that is reachable but missing tables and columns.

Joining fails, or a join succeeds and then bounces straight back to the join screen — check `/api/health` and look at `schema.missing`. This is what a half-applied `schema.sql` looks like from the outside: the code writes a column the database doesn't have, the insert fails, and the player never appears in the room state. The app is built to survive it — it drops the unknown column, logs `[schema] …`, and lets the game continue with the leaderboard grouping degraded — but the real fix is to run `supabase/schema.sql` again until it reports success. `/api/rooms/CODE/me` is the other useful probe: it answers `{"ok":true,...}` if the server still recognises your seat, which means the problem is in reading the room state rather than in your identity.

The seed fails with `ERROR: 42P01: relation "public.scales" does not exist` — `schema.sql` never completed, so there is no `scales` table for the seed to fill. Nothing in this error is about the seed. The SQL editor runs each script in one transaction, so a failure anywhere in `schema.sql` leaves the database with none of it, not part of it.

Fix it in this order. Open a **New query**, paste `supabase/schema.sql` on its own, run it, and read the summary table it prints at the end: `tables_ok` and `views_ok` must be `true`. Only then run `supabase/scales-seed.sql` in a second query. If `schema.sql` itself errors, the message names the statement that broke — that is the thing to fix, and it is worth pasting somewhere you can read it in full rather than working from the truncated line the editor shows. Two harmless-looking causes worth ruling out first: pasting only part of the file (it is ~600 lines, so check the last line you pasted is the closing summary `select`), and running it against the wrong project when you have more than one open.

`schema.sql` fails with `ERROR: 42P16: cannot change name of view column "target" to "scale_left_ua"` — fixed in the same release; if you still see it, you are running an older copy of `supabase/schema.sql`, so `git pull` and paste it again. The cause is a Postgres rule worth knowing: `create or replace view` may only *append* columns. It cannot rename one or slot a new one into the middle. A project created before the Ukrainian scale columns existed has a `v_best_rounds` whose ninth column is `target`, while the current definition puts `scale_left_ua` there — so the replace is rejected, and because the editor runs the file as one transaction, that single line takes all 600 down with it. `schema.sql` now drops all seven views immediately before recreating them, which sidesteps the entire class of problem. Views hold no data, so nothing is lost by rebuilding them.

Players don't see each other update — the Realtime websocket is blocked or the publication didn't get created. The app degrades to polling every 2.5 seconds in this case, so the game stays playable but feels sluggish. To confirm the publication exists, run this in the SQL editor:

```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
```

You want `rooms`, `players`, `rounds`, `guesses` and `bets` in the result. If any are missing, re-run `supabase/schema.sql`.

**I got dropped from the room, and the lobby is full of copies of me** (`Anton 3`, `Anton 3 2`, `Anton 3 2 2`, …) — this was a real bug, fixed in the release that added `supabase/dedupe-players.sql`. Two things caused it together, and both are now closed.

The first was the phone's own cache. The room state is a plain `GET`, and mobile Safari will re-serve a `GET` from its memory cache regardless of `no-store`. A phone could sit on the response captured the moment the room was created — one player, the host — and hand that same body to every poll for the rest of the evening. The player never appeared in their own room, so the join screen came back. Every read now carries a `?_=…` parameter that makes the URL unique, which no cache can match. The diagnostic tell, if you ever see this shape again: `/api/rooms/CODE/me` answers `{"ok":true,…}` while the room state doesn't list you. That combination means the transport, not the database — `/me` sends identity headers, so it is never cached.

The second was that joining wasn't idempotent, so each retry created a genuine new player row and `uniqueName()` politely appended another number. One device now gets one seat per room: a repeat join returns the seat it already holds, with its original name and team and a fresh token.

To clean up rooms that already have ghosts, open `supabase/dedupe-players.sql` in the SQL editor and run it **once**. It shows you the affected devices first, then keeps the earliest seat per device and deletes the rest, then adds a partial unique index on `(room_id, player_uid)` so the database refuses a second seat even if the application ever regresses. It is safe to re-run and it leaves pre-`player_uid` rows (device id `null`) alone. Don't move it into `schema.sql`: that file runs as one transaction, and the index cannot be created while the duplicates it forbids still exist.

Somebody lost their seat in a room, with no duplicates involved — that's the cost of having no sign-in. Identity lives in the browser's localStorage, so clearing site data, switching browsers, or opening the room in a private window makes you a new player. They can rejoin with the same name; if the browser kept its device id they get their original seat back, and if it didn't they come in as a new player.

The same person shows up twice on the player leaderboard — check whether it's two browsers. Each browser mints its own permanent player id, and that id is what groups a person's rounds across games; the same human on a laptop and a phone is two ids and therefore two rows. Games played before this existed fall back to matching on name, and a name-only entry gets folded into the device entry that answers to the same name, so the usual cause is genuinely two devices. Merging them would need real accounts, which this game deliberately doesn't have.

Every round shows the same handful of scales — the seed didn't run. Check `/api/health`; `"scales":"builtin"` means the app is using the compiled-in fallback list rather than your table. Run `supabase/scales-seed.sql` and reload; no redeploy needed.

The analytics page is empty after people have played — three things to check in order. `/api/health` will say if `analytics_events` is missing. The period selector defaults to seven days, so try All time. And events are batched for a few seconds before being sent, so a tab that was closed instantly may have flushed nothing at all; if the table has rows but the page shows none, that's the period, not the pipeline.

`/api/analytics` returns 401 — `ANALYTICS_TOKEN` is set, so the page needs the key in its URL: `/analytics?key=YOUR-TOKEN`. To call the API directly, send it as an `x-analytics-key` header.

Old rooms are piling up and the cron never seems to run — check the three things in that order. Vercel → your project → **Cron Jobs** should list `/api/cron/cleanup` daily; if the tab is empty, `vercel.json` wasn't in the deploy, so confirm it was committed and push again. If the job is listed but every run shows a 503, `CRON_SECRET` isn't in the production environment — add it and **redeploy**, since a variable added after a build is not in that build. If runs return 200 but the counts are always zero and rooms plainly are old, then `purge_stale_rooms` measures from `updated_at`, so check whether something is still touching those rooms; a `{"error":...}` in place of a count instead means the function isn't in the database and `supabase/schema.sql` needs re-running.

The takeover notice appears in a room where the host is sitting right there — that means the host's device stopped reporting in. `last_seen_at` only moves on authenticated requests, and an idle screen makes none, so the host and the current clue-giver send a deliberate heartbeat every 45 seconds while their tab is visible. A phone that has been locked or backgrounded stops beating on purpose, which is the behaviour you want: a host in somebody's pocket genuinely is away. If it happens on an awake, foreground tab, look in Vercel's function logs for failing `POST /api/rooms/CODE/me` calls.

Mixpanel shows nothing, in this order. Does `/api/health` say `"mixpanel":"on"`? If it says `off`, the token isn't in that environment — locally check `.env` or `.env.local` (both are read), in production check Vercel and remember that adding a variable needs a redeploy. Then run `npm run mixpanel:test`, which reports the actual rejection reason rather than leaving you guessing. If the probe is accepted but real events don't appear, check the Vercel function logs for lines beginning `[mixpanel]`. And if everything claims success and the project is still empty, you're almost certainly sending to the wrong data region: an `eu.mixpanel.com` project needs `https://api-eu.mixpanel.com`, and the US host accepts the request and drops it.

A scale you added in the dashboard doesn't appear — the server caches the catalogue for five minutes. Wait it out, or redeploy to clear it immediately. If it still doesn't appear, check that `enabled` is true and that all four label columns are filled; rows with a missing label are skipped rather than shown half-empty.
