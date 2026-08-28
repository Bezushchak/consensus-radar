# Mixpanel: the whole tool, and the reports to build in it

`ANALYTICS.md` says *what* is measured and *which* numbers are worth reporting.
This document is the other half: what Mixpanel can actually do, and the exact
configuration for each report, in the order worth building them.

The project is close to empty today, so treat this as set-up rather than
analysis. Every recipe below is written so it can be built now and read later.

## Step zero: give it something to draw

An empty report and a broken report look identical, so make one real game before
believing anything.

Open the app on a laptop and on a phone — two different devices, because one
browser is one `distinct_id` and a funnel needs a host and a guest to be
different people. Create a room on the laptop, join from the phone, put two
people in each of two teams (the rule since `MIN_TEAM_SIZE`), and play until
somebody wins. That single game emits every funnel event at least once.

Then check **Data → Events** in the left sidebar. Events arrive within a minute.
If nothing shows up, stop here and work through the verification order at the
end of `ANALYTICS.md` — no report is worth configuring against a dead pipe.

## What each part of Mixpanel is for

Reports are created from **+ Create New** in the top-left. There are four core
report types and they are all on the free plan.

| Report | The question it answers | What it is for here |
| --- | --- | --- |
| **Insights** | How much, how often, what is the average | Points per round, rounds per game, what people choose in the create form. The general-purpose one. |
| **Funnels** | Where do people stop | The only report that measures whether a group gets into a game at all. The most valuable one for this product. |
| **Retention** | Do they come back | Weak here by construction — see the identity caveat — but the repeat-play version is meaningful. |
| **Flows** | What do they do instead | Where a stuck room goes. Useful for reading a funnel drop-off after the funnel has told you which step is bleeding. |

Three supporting things that are not reports:

**Boards** are where saved reports live; every saved report belongs to one.
Note the plan limit: on a free plan each user can save **five** reports total, so
the build order below matters — the first five are the five to keep.

**Lexicon** (Data → Lexicon) is the dictionary: display names, descriptions, and
the ability to hide events. Worth twenty minutes because `guess_locked` means
nothing to anyone but you, and because `pointer_heat` should be hidden from the
event picker so it stops appearing in every dropdown.

**Users / Cohorts** is a saved group of devices — "played more than one game",
"only ever created a room and never started one". Cohorts can be used as a
filter or a breakdown in any report, which is how a funnel becomes a comparison
between two kinds of player.

### The five words the UI assumes you know

A **metric** is a **measurement** of a **behavior**. The behavior is the event or
sequence; the measurement is how to count it — total events, unique users,
conversion rate, or *aggregate property*, which is what you pick to average a
number like `points`. A **breakdown** splits the result by a property. A
**filter** narrows it: *global* filters apply to the whole report, *inline*
filters (the `…` beside one event) apply to that event only. The distinction
matters in funnels, where inline filters change who enters and global filters
throw away finished conversions.

## Set up once, before the reports

**Project timezone.** Default is UTC. Set it to Europe/Kyiv in project settings,
otherwise "today" ends at 3am and every daily number is cut in the wrong place.

**Lexicon.** Give the nine funnel events readable display names, describe the
two traps in the description field where they will be read (`round_revealed`
fires once per watching device; `session_end` fires per page-hide), and hide
`pointer_heat` and `mixpanel_probe`. Tag the funnel events with one tag so the
event picker can filter to just them, and tag `round_skipped`, `host_claimed` and
`timer_expired` with a second one — they are failure signals rather than features,
and grouping them keeps a reader from reading a rescue as a milestone. Put the
population caveat in `timer_expired`'s description too, because it is the one
that will otherwise be misread first: **it can only fire in a room that chose a
phase clock**, and unlimited is the default.

**Two boards.** "Activation" and "Game quality". Reports are saved into boards,
and deciding this first stops the reports piling up in one list.

## The reports, in build order

Each recipe is: what to configure, how to read it, and the trap.

### 1 — Host funnel

The number one thing this product can fail at is a group that never starts
playing. This is the report that sees it.

- **Type:** Funnels
- **Steps:** `app_open` → `create_open` → `room_created` → `game_started` →
  `clue_sent` → `game_finished`
- **Conversion window:** 2 hours. A game is played in one sitting; the 7-day
  default would count a room created on Monday and a game started on Thursday as
  one success.
- **Counting method:** Totals, not the default Uniques. Uniques lets a device
  enter the funnel only once in the whole date range, which for a game people
  play repeatedly measures "did your first ever attempt work". Totals measures
  each attempt, which is the question.
- **Ordering:** specific order (the default).
- **Breakdown:** `device_type`.

**Read it as:** `app_open → create_open` is whether the front page makes the
offer clearly — a loss here is a landing-page problem, not a game problem.
`create_open → room_created` should be nearly lossless; if it is not, cross-check
`error_shown` where `where = create`. **`room_created → game_started` is the
number to care about** — a group with a room that never plays. `game_started →
clue_sent` is whether the first clue-giver understood their job.

**Trap:** leave **Optimized Re-entry** off to begin with. Off, the funnel judges
each attempt on its own and answers "did this attempt work". On, a host who
failed and immediately retried counts as converted, which answers "did they
eventually get a game going". Both are worth knowing; they are not the same
number, and only one of them tells you the first try is broken.

### 2 — Guest funnel

Build it separately. A single funnel silently drops half the population, because
the host never emits `joined` and a guest never emits `room_created`.

- **Type:** Funnels
- **Steps:** `join_open` → `joined` → `guess_locked` → `game_finished`
- **Conversion window:** 2 hours. **Counting method:** Totals.
- **Breakdown:** `device_type`, then `players` on `join_open`.

**Start at `join_open`, not `app_open`.** A guest who taps a shared link lands on
`/room/CODE` and never sees the front page, so they never emit `app_open` — a
funnel starting there would quietly measure only the guests who typed the code in
by hand.

**Read it as:** `join_open → joined` is the seat-taking step, and the one that
broke before. Breaking it down by `players` — how many people were already in the
room when this person arrived — separates "first to arrive and unsure" from
"joining a room that is visibly filling up".

### 3 — Setup time

- **Type:** Funnels, same steps as the host funnel
- **Measurement:** Time to Convert → Median
- **Step selection:** `app_open` → `clue_sent`

The single best summary of friction: how long a room full of people spends not
playing. One number, and it goes down when the product gets better. Use median
rather than average — one abandoned tab left open for an hour ruins a mean.

### 4 — The error queue

- **Type:** Insights
- **Metric:** `error_shown`, Total Events
- **Breakdown:** `where`, then `message`
- **Chart:** bar

Check this before any other report, because everything else is downstream of it.
It is a free bug report queue ordered by how many people hit each one, and the
messages are the real strings the app showed on someone's phone.

### 5 — Round quality

- **Type:** Insights, four metrics on one chart
- `round_revealed` → Aggregate Property → Average of `points`
- `round_revealed` filtered to `points = 5` → Total Events (bullseyes)
- `round_revealed` filtered to `points = -2` → Total Events (wrong side)
- `round_revealed` filtered to **`distance >= 0`** → Average of `distance`

**Read it as:** average points near 5 means the game is too easy; near 0 means
clues are not landing. A rising wrong-side rate usually means confusing scale
pairs rather than bad players.

**Trap:** the `distance >= 0` filter is not optional. `-1` is the sentinel for
"unknown" and it will drag the mean below zero. And every count on this event is
inflated, because it fires once per device watching the reveal — the averages are
unbiased, the counts are not. For a true round count use Supabase.

### 6 — What people choose

- **Type:** Insights
- **Metric:** `room_created`, Unique Users
- **Breakdown:** `cats`, then repeat for `goal`, `bets`, `teams`
- **Chart:** pie

Four small reports, or one report whose breakdown you change. Each one retires an
argument about defaults: whether the analytics-team scales get used at all,
whether the longer goals are ever chosen, whether opt-in side bets get turned on,
whether anyone plays with more than two teams. Cross `goal` with `game_finished`
to see whether the long games actually finish.

### 7 — Dead ends and dead controls

- **Type:** Insights
- **Metric:** `click`, Total Events
- **Breakdown:** `target`, then a second breakdown on `path`
- **Chart:** table

Every labelled control is captured by one delegated listener, so this table is
complete without anyone remembering to instrument a button. Three rows to look at
specifically: `copy-link` as a share of `room_created` is the share rate — whether
codes travel by link or get read out loud; `reveal-now` and `skip-round` are the
two ways a stuck round gets unstuck, so together they are how often rounds stall
at all; and `(unlabelled)` is people pressing things that were never meant to be
pressed, which is where the confusion is. `skip-round` and `claim-host` have
proper events of their own — see report 10, which is the better place to read
them.

### 8 — Repeat play

- **Type:** Insights
- **Metric:** `game_started` (or `joined`), Unique Users, weekly
- Plus the same event with Aggregate Property → Frequency per user

More honest than a retention curve here. A tool used once is a curiosity; used
weekly, it is a ritual. Build the Retention report too — born on `room_created`
or `joined`, returning on `app_open`, weekly — but read it as a floor: one person
on a laptop and a phone is two users, and a returning player who switched devices
reads as churn.

### 9 — Mobile versus desktop

Not a separate report. Add `device_type` as a breakdown on the host funnel and
leave it there. The two roles are physically different devices — the host is on a
laptop, everyone else is on a phone — so any step where mobile converts
noticeably worse is a mobile layout bug, and this is the highest-value slice
available in the whole project.

### 10 — The rescue hatches

Three events exist only because a room can fail to move on its own, and each is
read as a ratio against the thing that should have happened instead. Formulas
make it one chart rather than two numbers divided by hand.

- **Type:** Insights, with the formula editor (`Σ`)
- **Metric A:** `round_skipped`, Total Events. **Metric B:** `round_revealed`,
  Total Events.
- **Formula:** `A/B`
- **Breakdown:** `phase` on `round_skipped`
- Second chart, same shape: A = `host_claimed` Total Events, B = `room_created`
  Total Events, `A/B`. Both of those fire exactly once per event, so that ratio
  is a true rate.
- Third chart: A = `timer_expired` Total Events, B = `round_revealed` Total
  Events, `A/B`, broken down by `phase` — **and filtered**, which the other two
  are not. Add a cohort filter of sessions that did `game_started` where
  `clue_sec > 0`, or the denominator includes every game that had no clock and
  could not possibly have expired. Unlimited is the default, so unfiltered this
  chart understates by however much of your traffic never touched the setting.

**Mind the units on the first chart.** `round_skipped` fires once per skipped
round, but `round_revealed` fires once per *watching device*, so `A/B` is not the
share of rounds that got skipped — it is that share divided by the average number
of people at the table. Neither metric type fixes this: Unique Sessions on B
counts tabs that saw at least one reveal, which is players rather than rounds, so
it swaps one wrong denominator for another. Use it as a **trend line** — the shape
over weeks is exactly right, and that is the question — and multiply by your
usual table size if you want a rough absolute. There is no per-round unique
identifier in the events to do better, and adding one is not worth a column.

**Read it as:** `round_skipped ÷ round_revealed` is how often a scale or a
clue-giver defeats a table, and the `phase` breakdown says which fix. `phase =
clue` is a round given up before a clue existed — the clue-giver walked away, or
looked at the pair and had nothing — so a persistent number points at the scale
pool, and the pairs to suspect are the ones the Scales board already flags as
hardest. `phase = guess` is rarer and worse: markers were down and the round was
still abandoned, meaning the host threw away points rather than reveal them.

`host_claimed ÷ room_created` is how often the person who opened the room walked
away from it. A small number is noise — a laptop that slept while its owner read
a scale out loud, and somebody impatient. A large one means hosting is landing on
whoever clicked first, and the fix is fewer host-only controls rather than a
faster takeover.

`timer_expired ÷ round_revealed`, within timed rooms, is how often a table cannot
finish a phase under its own steam. `phase = clue` climbing means the limit is too
tight for a blank page, or the pair was unclueable — read it beside
`round_skipped.phase = clue`, since a clock now catches some of what used to
become a skip, and a fall in one with a rise in the other is the same problem
wearing a different hat rather than an improvement. `phase = guess` is a different
complaint: markers were expected and did not arrive, which is usually people not
noticing it was their turn rather than people unable to decide. Worth a glance at
`clue_sec` and `guess_sec` as a breakdown on `game_started` too — that tells you
which limits hosts actually pick, and a limit nobody chooses is one to drop from
the picker.

**Trap:** the two matching click labels are `skip-round` and `claim-host`, and
`skip-round` is on two different buttons — the clue-giver's own give-up and the
guessers' escape hatch once the clue-giver goes quiet. `click` merges them; only
`round_skipped.phase` tells them apart. Cross-check a suspicious `host_claimed`
against `session_end` on the same device: a host who never hid their tab and was
still dethroned is a heartbeat bug, not a person leaving. `timer_expired` has no
click label to cross-check against at all, because nobody presses anything —
which is exactly why it needed to be an event.

### 11 — Does anybody read past the podium

- **Type:** Insights, with the formula editor (`Σ`)
- **Metric A:** `lb_row_open`, Total Events. **Metric B:** `leaderboard_open`,
  Unique Users.
- **Formula:** `A/B` — cards opened per visit
- **Breakdown:** `board`, then a second chart broken down by `rank`

The leaderboard is the one page whose whole job is to be looked at, so the only
question worth asking of it is whether looking goes anywhere. `A/B` is cards
opened per visit: below about one, the podium is the entire product and the table
under it is decoration; above two or three, people are comparing entries and the
table is doing real work.

The `rank` breakdown is the sharper half. `lb_row_open` fires with the displayed
rank, so ranks 1–3 are the podium and 4-plus is somebody who scrolled and went
hunting — usually for their own row. If that tail is empty, the fifty rows the
API returns are fifty rows nobody reads, and the limit could come down. The
`board` breakdown answers the other half: **Rounds** is the only board whose card
draws a dial, so if it leads by a wide margin the picture is what people came
for, and if it trails, the dial is not worth the pixels.

**Mind the units**, same trap as report 10 from the other direction: A is total
events and B is unique users on purpose, because "per visit" is the question.
Making both Total Events would divide by the number of times a tab re-opened the
page, and making both Unique Users would throw away the count that matters.

**Matching click labels**, for report 7: `lb-podium-1` / `-2` / `-3` are the three
steps, `lb-detail-close` and `lb-detail-done` are the two ways out of a card (the
✕ and the button — a lopsided split says one of them is hard to find), and
`winner-leaderboard` is the link out of the end-of-game screen, which is the only
path from finishing a game to looking at the board. Table rows are not labelled
controls, so `click` does not see them at all — `lb_row_open` is the only thing
that counts a row.

### 12 — Does the starting idea get used

- **Type:** Insights, with the formula editor (`Σ`)
- **Metric A:** `hint_opened`, Total Events. **Metric B:** `clue_sent`, Total
  Events, with an **inline filter** `hint` is set.
- **Formula:** `A/B` — the share of offered ideas that were opened
- **Breakdown:** `band`, then a second chart broken down by `scale`

The hint catalogue is 2,620 written lines that cost money to generate, and this is
the one report that says whether they were worth it. `A/B` is the share of
clue-givers who, given a pre-written idea one tap away, took it: near zero and the
catalogue is dead weight, near one and the blank box was harder than anyone
admitted.

**The inline filter on B is the whole report.** `clue_sent` carries `hint` only in
a round that had an idea to offer, so filtering on "`hint` is set" makes the
denominator *rounds where the button existed*. Without the filter, B is every
clue ever written and the ratio measures how much of the catalogue is seeded, not
whether anybody wants it — the same number falls if you add scales and rises if
you generate more hints, in both cases while player behaviour is unchanged.

The `band` breakdown is the interesting half. `hint_opened` sends which fifth of
the dial the target was in, and the shape is a prediction worth testing: the two
end bands should be the easiest to clue unaided and band 2 — genuinely in
between, pulled neither way — the hardest. If opens pile up in the middle, the
game's difficulty is not the scales, it is the centre of every scale, and that is
an argument for writing better middle hints rather than more pairs. A `band` of
`-1` means the secret had not arrived when the button was tapped; it should be
absent, and if it is not, the clue screen is rendering the ask before the fetch
lands.

`scale` makes this the only Mixpanel report with a per-pair breakdown of any kind
(see *what is deliberately not available*, below). Read it as which pairs
*intimidate* people, not which ones they get wrong — those are different lists,
and only the first one is in Mixpanel.

**Trap:** this report cannot distinguish "nobody wanted the hint" from "no hint
was there to want", unless the filter is on. If the chart is flat zero, check
`hint_rows` on `/api/health` before concluding anything about players — a
deployment that never loaded `supabase/scale-hints-seed.sql` produces exactly this
picture, correctly.

**The harder question — does the hint make the clue worse — is a cohort
comparison, not a breakdown.** Whether hinted rounds land closer lives across two
events (`hint` on `clue_sent`, `distance` on `round_revealed`), so: filter
`clue_sent` to `hint` is `true` → View Users → save as a cohort, then run report 5
with that cohort as a breakdown. Mind what that measures — a cohort is devices,
not rounds, so it compares people who ever used a hint against people who never
did, which is a coarser thing than comparing the rounds themselves. It is enough
to notice a large effect and not enough to argue about a small one.

**If you are on the free plan and can only keep five:** the host funnel, the guest
funnel, the error queue, round quality, and setup time. Configuration, clicks and
the rescue-hatch ratios can be rebuilt in a minute when a specific question comes
up — and the last of those is on the app's own `/analytics` page permanently, in
the **Other events** table directly under the funnel, which is the cheapest place
to keep half an eye on it.

## Techniques worth knowing about

The things that are not obvious from the report picker, each with a use here.

**Formulas** (Insights → the `Σ` / formula button) let one report divide one
metric by another. Completion rate is `A/B` with A = `game_finished` unique users
and B = `game_started` unique users — a real ratio in one chart instead of two
numbers you divide by hand.

**Custom events** are a saved union of several events, so "did anything at all in
a game" can be one behavior. **Custom properties** are computed expressions over
existing properties, which is how a `words` count becomes a "short / medium /
long clue" bucket without a code change.

**Cohorts and View Users.** Click any point on any chart → View Users → save as a
cohort. "Devices that created a room and never started a game" is the most useful
cohort here; used as a funnel breakdown it shows what that group did differently.

**Compare to past** (and "Percent Change over Baseline") turns any report into a
before-and-after, which is how you check whether the two-per-team rule actually
moved `room_created → game_started`. Do this before and after any release worth
arguing about.

**Find interesting segments**, at the bottom of a funnel or retention chart,
searches every property for segments that convert unusually well or badly and
mails you the statistically significant ones. Cheap, and it finds things nobody
thought to break down by.

**View as Flow.** Click a funnel step → View as Flow to see what the people who
dropped off did instead. This is the "why" that a funnel cannot give you.

**Exclusion steps** ("Exclude users who did…" under Advanced) build a funnel that
disqualifies anyone who did something in between. Excluding `error_shown` between
`room_created` and `game_started` splits the drop-off into "hit a visible error"
and "just gave up", which are different problems.

**Any Order and Hold Property Constant** (also under Advanced). Any Order for
steps whose sequence is not meaningful. Hold Property Constant on `room_code`
forces every step of a funnel to come from the *same room* — otherwise a person
who created room A and started game B counts as a conversion. Worth turning on
once you have more than a handful of rooms.

**Saved behaviors** let the host funnel be reused as a single step inside an
Insights report, so it can be plotted next to an unrelated metric.

**First-time filter** on any event restricts it to the first time that device ever
did it — the closest thing available to "new player" without accounts.

**Typecasting** matters if a number arrives as a string. Ours are sent as real
numbers, except `cats`, which is deliberately a string like `general+analytics`.

**Caching.** Results are cached — a report on a short date range for up to
12 hours. When a number looks stale, use the `…` menu → Refresh Data rather than
concluding the pipeline is broken.

### What is deliberately not available

**Country and city breakdowns are empty**, and that is correct: `ip` is pinned to
`"0"` so Mixpanel cannot resolve a location from a Vercel region and invent one
for every player.

**Session Replay** needs Mixpanel's browser SDK. The mirror runs server-side on
purpose — ad blockers do not touch our own origin, and a meaningful share of
browsers block Mixpanel's domain outright. Replay would cost that plus ~30 KB on
every phone.

**Group Analytics** keyed on `room_code` would make "the room" a unit of analysis
rather than the device, which fits this product unusually well. It needs a paid
plan and a `$group_key` on every event.

**Experiments / A-B testing** needs a flag system the app does not have.

## Before adding a report, check it is answerable

Three questions look answerable and are not, all for the same reason: the two
halves are on separate events, and Mixpanel cannot join two events on a round.
*Do shorter clues score better* — `words` is on `clue_sent`, `points` is on
`round_revealed`. *Does the pre-written idea make the clue better* — `hint` is on
`clue_sent`, `distance` is on `round_revealed`; the cohort trick in report 12 is a
per-device approximation of a per-round question, which is why it is written up as
a comparison to notice something with rather than a number to quote. *Which
scales are hardest* — `hint_opened` is the only event carrying a scale key, and it
fires when somebody asks for help, not when a round is scored, so it ranks
intimidating pairs and not missed ones.

All three are answerable in Supabase today — `v_scale_stats` and the Scales
leaderboard — and `ANALYTICS.md` Part 3 lists what a code change would need to
move them into Mixpanel. Do not build a creative report to work around a missing
event; add the event or use the database.
