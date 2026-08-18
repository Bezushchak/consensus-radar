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

`verify` runs the type checker, the 13 unit tests, and a production build. All three must pass. This is the same gate Vercel will run, so if it passes here it will pass there.

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

That one script creates everything: the room, player, round, guess and bet tables; the isolated secret tables; the durable stats tables that outlive rooms; the three leaderboard views; the row-level-security policies; the Realtime publication; and a housekeeping function. It's written to be idempotent, so if you ever change it and re-run the whole thing, nothing breaks.

**1.5** Verify it landed. Open **Table Editor** in the sidebar. You should see these tables: `bets`, `game_results`, `guess_values`, `guesses`, `player_round_stats`, `player_tokens`, `players`, `round_secrets`, `rooms`, `rounds`. If `round_secrets` and `guess_values` show a "no policies" or "RLS enabled, no policies" warning, that is correct and deliberate — that is exactly what keeps the secret target and other people's sliders unreadable from the browser. Don't "fix" it.

**1.6** Collect the three keys. Go to **Project Settings** (gear icon) → **API** and copy:

- **Project URL** — looks like `https://abcdefghijk.supabase.co`
- **anon public** key — a long string starting `eyJ...`
- **service_role secret** key — also starts `eyJ...`, and is marked as secret

The service_role key bypasses every security rule in the database. It belongs only in server-side environment variables. Never paste it into a file that ships to the browser, never prefix it with `NEXT_PUBLIC_`, and never commit it to git.

**1.7** Wire it up locally so you can test before deploying:

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

**1.8** Test it for real:

```bash
npm run dev
```

Open http://localhost:3000/api/health — you want `{"ok":true,"supabase":"reachable"}`. If you get `missing-env`, the file isn't named `.env.local` or the dev server needs restarting. If you get `unreachable`, one of the keys is wrong or truncated.

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

**3.5** Before deploying, expand **Environment Variables** and add all three. For each one, paste the name, paste the value, and click **Add**:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role secret key |

Leave the environment selector on all three of Production, Preview and Development so that preview deployments work too. Watch for trailing spaces or line breaks when pasting the long keys — that's the single most common cause of a deploy that builds fine but can't reach the database.

**3.6** Click **Deploy**. The build takes two or three minutes. When it finishes you get a URL like `https://consensus-radar.vercel.app`.

**3.7** Check the deployment immediately. Open `https://YOUR-APP.vercel.app/api/health` and confirm `{"ok":true,"supabase":"reachable"}`. If it says `missing-env`, the variables were added after the build — go to Settings → Environment Variables, confirm all three, then Deployments → the latest one → **Redeploy**. Environment variables are baked in at build time, so a change always needs a redeploy.

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

## Step 5 — The finishing touches

**A nicer URL.** In Vercel, Settings → Domains lets you rename the project so the free URL becomes something like `consensus-radar-betterme.vercel.app`, or attach a domain you own. A short URL matters here, because people type it on phones.

**Automatic cleanup.** Rooms are throwaway; results are not. Finished games are copied into `game_results` and `player_round_stats` before their room becomes eligible for deletion, so nothing on the leaderboard depends on a room still existing. To keep the tables tidy, go to Supabase → **Integrations → Cron**, create a job on a daily schedule, and have it run:

```sql
select public.purge_stale_rooms();
```

That deletes rooms untouched for more than 24 hours. It's optional — the free tier's 500 MB will hold years of games either way.

**Watch out for the free-tier pause.** Supabase pauses free projects after a week with no activity, and a paused database means the app returns errors. Opening the dashboard or the app resets that clock, so it only bites if you build this and then don't touch it for a fortnight. Restoring a paused project takes one click.

**Rotating a leaked key.** If the service_role key ever ends up somewhere public, go to Supabase → Project Settings → API → Reset service_role key, then update the variable in Vercel and redeploy. Nothing else needs changing.

**Logs when something misbehaves.** Vercel's Deployments → your deployment → **Functions** tab shows the runtime logs from the API routes, which is where any server-side error will surface. Supabase's **Logs → Postgres** shows what the database saw. Between the two you can trace any failed action.

---

## When something is wrong

The build fails on Vercel but `npm run verify` passed locally — check that `package-lock.json` was committed, since Vercel installs from the lockfile.

The page loads but every action errors — almost always the environment variables. Hit `/api/health` first; it tells you whether the problem is missing variables or an unreachable database.

Players don't see each other update — the Realtime websocket is blocked or the publication didn't get created. The app degrades to polling every 2.5 seconds in this case, so the game stays playable but feels sluggish. To confirm the publication exists, run this in the SQL editor:

```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
```

You want `rooms`, `players`, `rounds`, `guesses` and `bets` in the result. If any are missing, re-run `supabase/schema.sql`.

Somebody lost their seat in a room — that's the cost of having no sign-in. Identity lives in the browser's localStorage, so clearing site data, switching browsers, or opening the room in a private window makes you a new player. They can rejoin with the same name; the leaderboard matches players by name, so their stats still merge.
