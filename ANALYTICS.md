# Analytics: what can be measured, and how

Every `track()` call in the app goes to `POST /api/events`, which writes a row to
`analytics_events` in Supabase and, when `MIXPANEL_TOKEN` is set, mirrors the same
row to Mixpanel. So Mixpanel and the built-in `/analytics` page see identical
data; nothing is instrumented for one and not the other.

This document is deliberately limited to events the code actually sends. Where a
metric would be useful but the event does not exist, it is in the last section
instead of being described as if it worked — a report on an event nothing emits
draws a flat line, and a flat line reads as "nobody does this" rather than
"nobody measured this".

## Part 1 — What is being collected

### Properties on every event

Set by the server in `src/lib/server/mixpanel.ts`, so they are always present and
always trustworthy:

| Property | Meaning |
| --- | --- |
| `distinct_id`, `$device_id` | The browser's device id — a person, approximately. See Identity below. |
| `session_id` | Random per browser tab, from `sessionStorage`. A visit, not a person. |
| `path` | Page, with the room code stripped: `/room/GSTE` is recorded as `/room/[code]`. |
| `room_code` | The room, once the player is in one. Set by the room page on mount, so it survives a reload — it used to be set only by the join gate, which a returning player never sees. |
| `lang` | `ua` or `en`, as chosen in the UI. |
| `device_type` | `mobile` or `desktop`, decided by a 760px media query. Not `$device`, which Mixpanel parses from a user agent we never send. |
| `source` | Always `consensus-radar`. |
| `time` | The client's own timestamp, rejected and replaced if it is more than a minute in the future or a day in the past. |

There is no IP, no user agent, and no geography: `ip` is pinned to `"0"` on
purpose, because resolving a location from a Vercel region would invent one for
everybody. **Country and city breakdowns in Mixpanel will be empty, and that is
correct rather than broken.**

### The events

Nine funnel events, in the order a player meets them:

| Event | Fires when | Fires on | Props |
| --- | --- | --- | --- |
| `app_open` | The front page mounts | every device | `resume` — was there a room to return to |
| `create_open` | The host form is focused or touched | host | — |
| `room_created` | The room exists | host | `teams`, `goal`, `bets`, `cats` (`general+analytics`) |
| `joined` | A player takes a seat | that player | `from` (`home` / `gate`), `resumed`, `picked_team` |
| `game_started` | The host presses Start | host | `players`, `teams` (teams with enough people to play), `clue_sec`, `guess_sec` (the two phase limits as saved, `0` for unlimited) |
| `clue_sent` | A clue-giver submits | the clue-giver only | `round`, `words` (words that count, free ones excluded), `blocked` — present only if a clue rule stopped them on the way |
| `guess_locked` | A player locks a marker | that guesser only | `round`, `changed` — was an earlier marker replaced |
| `round_revealed` | The reveal appears | **every device watching** | `round`, `points`, `distance` (`-1` when unknown) |
| `game_finished` | The winner screen appears | every device | `rounds`, `score` |

And thirteen that are useful but never gate a later step:

| Event | Props | Note |
| --- | --- | --- |
| `join_open` | `players` | Saw the join screen. May or may not join. |
| `leaderboard_open` | — | Once per session per page. |
| `lb_row_open` | `board`, `rank` | Opened one leaderboard entry — a podium step or a table row, both of which open the same card. Fires every time, not once per session, because the interesting figure is how many entries one visit opens. `board` is `teams` / `rounds` / `players` / `scales`; `rank` is the displayed rank, so `1`–`3` is somebody reading the podium and `4`+ is somebody who went looking. |
| `howto_open` | — | Opened `/how-to-play`. Once per session. Not a funnel step on purpose: reading the rules is not on the way to playing, so a step nobody has to take would read as a 90% drop-off. |
| `lang_switched` | `to` | |
| `bet_placed` | `side`, `round`, `markers` | Only when side bets are enabled for the room. `markers` is how many of the guessing team's markers were on screen when the call was made. |
| `round_skipped` | `round`, `phase` | Somebody gave up on a round rather than scoring it. Once per skipped round: both rescues are claimed atomically, and the loser of a simultaneous press is handed the same fresh state back rather than an error, so the device checks the state came back *changed* before counting — a plain "the call worked" would report one rescue twice. `phase` says whether the clue had arrived yet — `clue` is a clue-giver who never delivered, `guess` is a table that could not read one. |
| `host_claimed` | — | Somebody took the crown from a host who had gone quiet for two minutes. Once per takeover, on the device that is holding the crown afterwards and was not holding it before. |
| `timer_expired` | `round`, `phase` | A phase clock ran out. Once per expiry: every device in the room notices the same instant and asks, the server claims the phase atomically, and the losers are handed the same fresh state rather than an error — so the device counts it only if the state came back with a different phase or round. `phase` is the useful half: `clue` is a clue-giver who ran out of time to write, `guess` is a guesser who ran out of time to answer. Can only fire in a room whose host chose a clock; see the ratio caveat in Part 2. |
| `click` | `target`, `tag` | `target` is the control's `data-ev` label; see below. |
| `error_shown` | `where`, `message` | `where` is `create`, `join-home` or `join-gate`. |
| `session_end` | `seconds` | Fires on every page-hide, not once per visit. |
| `pointer_heat` | `grid`, `cells` | Only when `NEXT_PUBLIC_TRACK_POINTER=1`. |

`round_skipped`, `host_claimed` and `timer_expired` are worth treating
differently from the rest of that list. None of them is a feature anybody set out
to use — two are the escape hatches from a room that has stopped moving and the
third is a phase nobody finished in time — so every one of them is a small report
that something upstream failed. They are the subject of their own section in
Part 2.

Clicks are captured by one delegated listener, so every labelled control is
already measured without anyone remembering to instrument it. The labels that
exist, by screen: `resume-room`, `create-room`, `join-by-code` on the front page;
`pick-team`, `join-room` on the join gate; `copy-link`, `switch-team`,
`save-settings`, `start-game` in the lobby; `claim-host` on any screen once the
host has gone quiet; `send-clue`, `submit-guess`, `change-guess`, `bet-left`,
`bet-right`, `reveal-now`, `skip-round`, `next-round` in play;
`play-again`, `winner-leaderboard` on the winner screen; `lb-board-<teams |
rounds | players | scales>` and `lb-period-<all | week | month>` on the
leaderboard; and `demo-play`, `demo-pause`, `demo-restart` on the tutorial,
which is how you tell somebody who watched the demo through from somebody who
stopped it. The guess button reports `submit-guess` the first time and
`change-guess` when a marker is being replaced, which is the same information
`guess_locked.changed` carries and a useful cross-check on it. An unlabelled but
interactive click is recorded as `(unlabelled)` with its tag name, so dead ends
still surface.

### Identity, and what it costs

`distinct_id` is the device id from `localStorage` — the same id the leaderboard
groups by. It grants no access to anything; the per-room token is what authorises
moves. Three consequences worth holding in mind before quoting any user count:

One person on a laptop and a phone is **two** users. Two people sharing one
browser are **one**. A cleared browser, a new incognito window, or a browser that
refuses storage produces a new id — and in the storage-refused case the fallback
is `session-<id>`, which cannot be recognised again at all.

This is the price of having no sign-up, and it is the right trade for a game
people open once during a stand-up. It does mean retention numbers are a floor,
not a measurement: a real returning player who switched devices reads as churn.

### Two more collection facts that change how numbers should be read

`round_revealed` fires **once per device that sees the reveal**, not once per
round, because the question it was built for is "how many people got a result".
So its event count is roughly rounds × players present. Its *properties* are
still unbiased for averages — every device in a round reports the same `points`
and `distance` — but any count is inflated. For "how many rounds were played",
use unique sessions, or the `rounds` table in Supabase, which has exactly one row
per round.

`session_end` fires on every page-hide, and a phone hides and returns several
times in one game. Each stretch is reported separately and the clock restarts, so
`seconds` is time in one continuous stretch of attention, not total time in the
game. That is arguably the more honest number, but it is not session length and
should not be labelled as such.

## Part 2 — The metrics worth reporting

For the click-by-click configuration of each report named below — report type,
steps, conversion window, counting method, breakdown — plus a tour of the parts of
Mixpanel that are not obvious from the report picker, see `MIXPANEL-REPORTS.md`.
This part says which numbers matter; that document says how to build them.

### Activation: does a group get into a game at all

This is the most valuable thing to watch, because the failure mode of a
same-room multiplayer game is not churn, it is a group that never gets started.

**Build two funnels, not one.** The host and the guests walk different paths, and
a single funnel silently drops whichever half it does not describe — the host
never emits `joined`, and a guest never emits `room_created`.

Host funnel (Mixpanel → Funnels, "in this order", 1-day window):
`app_open` → `create_open` → `room_created` → `game_started` → `clue_sent` →
`round_revealed` → `game_finished`.

Guest funnel: `join_open` → `joined` → `guess_locked` → `round_revealed`. It
starts at `join_open` and not at `app_open` on purpose: a guest who taps a shared
link lands on `/room/CODE` and never sees the front page, so they never emit
`app_open`, and a funnel that begins there would quietly measure only the guests
who typed the code in by hand. How guests arrive is a separate question, answered
by `joined` broken down by `from` — `gate` for a link, `home` for a typed code,
and undefined on a resumed seat, which sends `resumed` instead.

Read the host funnel as product decisions:

- `app_open → create_open` is whether the front page makes the offer clearly. A
  low number is a landing-page problem, not a game problem.
- `create_open → room_created` is form friction. This step should be nearly
  lossless; if it is not, something in the create form is confusing or broken —
  cross-check against `error_shown` with `where = create`.
- `room_created → game_started` is **the number to care about**. It is the gap
  where a group has a room and does not manage to start playing: people cannot
  join, the two-per-team rule is not understood, or the host is waiting. Breaking
  it down by `device_type` separates "the host's laptop" from "everyone's phone".
- `game_started → clue_sent` is whether the first clue-giver understood their
  job. A loss here is a rules-explanation problem.
- `round_revealed → game_finished` is whether games end or are abandoned.

Mixpanel shows median time-to-convert per funnel step. **Time from `app_open` to
the first `clue_sent`** is the single best summary of setup friction: it is how
long a room full of people spends not playing.

### The core loop: is the game any good once it starts

| Metric | How | Watch out |
| --- | --- | --- |
| Rounds per game | Insights → `game_finished`, aggregate property `rounds`, average and distribution | Only counts finished games, so it is biased upward. |
| Completion rate | `game_finished` unique users ÷ `game_started` unique users | Under-counts: a satisfying game abandoned at the goal still reads as a failure. |
| Players per game | Insights → `game_started`, breakdown by `players` | Post-`MIN_TEAM_SIZE` this should never be below 4. If it is, a stale client is still deployed. |
| Marker changed before locking | `guess_locked` where `changed = true`, as a share of all | A proxy for how much thought the dial invites. Very low is worth a look — it can mean people cannot tell the control is draggable. |
| Side-bet adoption | `bet_placed` unique users ÷ `game_started` unique users, filtered to rooms where `room_created.bets = true` | Answers whether an optional feature earns its complexity. |
| Do watchers wait for the markers | Insights → `bet_placed`, breakdown by `markers` | `markers` is how many of the guessing team's markers were visible when the bet was placed. A pile-up at `0` means people bet before looking, so showing the markers is decoration rather than information — the fix would be UI, not the endpoint. |
| Attention per stretch | Insights → `session_end`, median of `seconds` | Per hide, not per session. See above. |

### Game quality: are the scales and the scoring right

| Metric | How | Watch out |
| --- | --- | --- |
| Average points per round | Insights → `round_revealed`, average of `points` | Unbiased despite the per-device firing. If it sits near 5, the game is too easy; near 0, the clues are not landing. |
| Bullseye rate | `round_revealed` where `points = 5`, over all `round_revealed` | |
| Wrong-side rate | `round_revealed` where `points = -2` | A rising number here usually means confusing scale pairs, not bad players. |
| Average miss | Insights → `round_revealed`, average of `distance`, **filtered to `distance >= 0`** | `-1` is the "unknown" sentinel and will drag the mean down if it is not excluded. |
| Are the clue rules too strict | Insights → `clue_sent`, total events, breakdown by `blocked` | An absent `blocked` means the clue went out on the first attempt, which is what most of them should be. One reason dominating is a rule players do not understand rather than a rule that is working — `gluedWord` in particular, since it is the only rule decided by a heuristic. |
| Clue length | Insights → `clue_sent`, average of `words` | Counts words that carry meaning; articles and prepositions are excluded, so this is not the length of the string. |
| Do longer clues score better | Not answerable in Mixpanel | `words` is on `clue_sent` and `points` is on `round_revealed`; correlating them needs them on one event. See Part 3. |
| Which scales are hardest | Not answerable in Mixpanel | No event carries `scale_key`. Use the leaderboard's Scales board or `v_scale_stats` in Supabase, which have this exactly. See Part 3. |

### Configuration: what people actually choose

Every one of these is a breakdown of `room_created`, and each one retires an
argument about defaults:

`cats` — whether the analytics-team scales get used at all, or whether the
general set is what everyone picks. `goal` — which game length people choose, and
crossed with `game_finished` whether the longer targets ever get reached.
`bets` — whether side bets are turned on when they are opt-in. `teams` — whether
anyone plays with more than two teams.

### Reach and friction

Breakdown by `device_type` on the whole host funnel is the highest-value slice
available, because the two roles are physically different devices: the host is
usually on a laptop and everyone else is on a phone. Any step where mobile
converts noticeably worse is a mobile layout bug.

Breakdown by `lang` tells you which dictionary to keep polished. `lang_switched`
with `to` tells you whether the default is wrong.

`howto_open` as a share of `app_open` is how often the front page fails to
explain itself. It is not a number to minimise — somebody reading the rules
before hosting is a good outcome — but the pair worth watching is `howto_open`
against `room_created` in the same session: people who read the tutorial and
then start a game mean it is doing its job, and a session that opens the
tutorial and stops there means the game looks like too much work. `click` where
`target = demo-restart` says a step needs watching twice, which is the closest
thing here to "this rule is not clear".

`error_shown`, broken down by `where` and then `message`, is a free bug report
queue ordered by how many people hit it. This should be checked before any other
report, because everything else is downstream of it.

`click` where `target = copy-link`, as a share of `room_created`, is the share
rate — whether the room code gets distributed by link or read out loud.

`click` where `target = reveal-now` is the host forcing a reveal, which mostly
happens when a round is stuck. It should be rare now that a team cannot be left
with nobody to guess; if it is not, something else is stalling rounds.

### The rescue hatches: how often the room stops moving

Three events exist only because a room can fail to move on its own, and all
three are best read as a ratio against the thing that was supposed to happen
instead. None is on the `/analytics` funnel, because none is a step anybody is
meant to reach — they have their own **Other events** table on that page,
directly under the funnel, for exactly this comparison.

**`round_skipped` ÷ `round_revealed`** is how often a scale or a clue-giver
defeats a table — as a trend rather than as a rate. Watch the units: the
numerator is one per skipped round, the denominator one per *watching device*, so
the quotient is the real share divided by the average table size. Comparing this
week's figure to last week's is exactly right; quoting it as "3% of rounds get
skipped" is not. Break it down by `phase`, because the two halves have different
fixes. `phase = clue` is a round abandoned before a clue existed: either the
clue-giver walked away, or they looked at the pair and had nothing — so a
persistent number here points at the scale pool, and the pairs to suspect are
the ones the Scales board on `/leaderboard` already flags as hardest. `phase =
guess` is rarer and worse: markers were down and the round was still given up,
which means the host chose to throw away points rather than reveal them.

**`host_claimed` ÷ `room_created`** is how often the person who opened the room
walked away from it. Some of this is healthy — a laptop that went to sleep while
its owner read a scale out loud, and somebody impatient — so a small number is
noise. A large one means hosting is being handed to whoever happened to click
first, and the fix is upstream of the button: fewer host-only controls, not a
faster takeover. Cross-check against `session_end` on the host's device; a host
who never hid the tab and was still dethroned is a heartbeat bug, not a person
leaving.

**`timer_expired`, which needs a denominator of its own.** This is the one ratio
in this section that cannot be taken against all revealed rounds, and the reason
is not units but population: the event can only fire in a room whose host chose a
clock, so mixing in the unlimited rooms — which are the default, and therefore
most of them — silently divides by a number that includes every game where
expiry was impossible. `game_started` carries `clue_sec` and `guess_sec` for
exactly this reason. In Mixpanel, filter the whole report to sessions with
`game_started` where `clue_sec > 0`, and the figure becomes readable; in the
Supabase editor the same thing is a join from `analytics_events` to the room's
saved settings. Break it down by `phase`, which is where the fixes diverge.
`phase = clue` climbing means either the limit is too tight for a blank page or
the pair was unclueable — the same suspicion `round_skipped.phase = clue` raises,
and the two are worth reading together, since a clock now catches some of what
used to become a skip. `phase = guess` is a different problem entirely: markers
were expected and did not arrive, which usually means people did not notice it
was their turn rather than that they could not decide. And unlike the other two,
this one has no click label to cross-check against, because nobody presses
anything — which is precisely why the event has to exist.

All three fire on the acting device only, so their event and session counts
agree — unlike `round_revealed`, which fires everywhere. The matching click
labels are `skip-round` and `claim-host`; note that `skip-round` is on two
different buttons (the clue-giver's own give-up, and the guessers' escape hatch
once the clue-giver goes quiet), so `click` merges them and only
`round_skipped.phase` tells them apart.

### Retention

Mixpanel → Retention, born on `room_created` or `joined`, returning on
`app_open`, weekly. Interpret it as a floor, for the identity reasons above. The
more meaningful version for a team game is **repeat play**: distinct users with
two or more `game_started` or `joined` events in a week. A tool used once is a
curiosity; used weekly, it is a ritual.

## Part 3 — What would need a new event

Each of these is a real gap, not an oversight to be worked around with a
creative report.

**One event per round rather than one per device.** `round_revealed` cannot count
rounds. The fix is a server-side event emitted once when a round is scored, in
`revealRound()` in `src/lib/server/rooms.ts` — which is also the natural place to
attach the things the client does not know.

**`scale_key` on the round events.** Without it, "which prompts are hard" and
"which prompts should be retired" are unanswerable in Mixpanel. They *are*
answerable in Supabase today (`v_scale_stats`, and the Scales leaderboard), so
this is only worth adding if the analysis should live in Mixpanel. Note that
`scale_key` is a stable identifier, so adding it does not leak the wording and
survives rewording.

**Clue length joined to outcome.** Putting `words` on the round-scored event
alongside `points` makes "do short clues work better" a single breakdown. As
separate events it needs a join Mixpanel will not do.

**Explicit abandonment.** There is no `game_abandoned`. It is currently inferred
as `game_started` minus `game_finished`, which cannot distinguish "gave up
confused" from "played happily and stopped at a good moment" — a difference worth
a lot. A `leave` action already exists in the API; emitting an event from it, with
the round number, would separate the two. `round_skipped` is the nearest thing
that exists and it is not a substitute: it says a *round* was abandoned by
somebody who was still in the room and still playing, which is close to the
opposite signal.

**Team composition changes.** `click` with `target = switch-team` is a usable
proxy for people shuffling teams in the lobby, but it does not say what they
switched to or whether the room ended up balanced.

**Anything about a specific person's skill.** Deliberately absent from Mixpanel.
Per-player accuracy lives in `player_round_stats` and surfaces on the leaderboard,
where it is a game feature that players opted into by playing. Mirroring it into a
product-analytics tool turns an in-game score into a profile, which is a different
thing and needs a different decision.

## Verifying the data before trusting a report

In order, because each step makes the next one meaningful:

`GET /api/health` reports `"mixpanel":"on"` or `"off"`. Off means
`MIXPANEL_TOKEN` is not in the running environment — and Vercel bakes environment
variables at build time, so adding one requires a redeploy, not just a save.

`npm run mixpanel:test` sends a single `mixpanel_probe` event through the real
code path. If it succeeds and Mixpanel shows nothing, the cause is almost always
data residency: an EU project must receive events at `https://api-eu.mixpanel.com`,
and the US host answers `200` while discarding them.

The `/analytics` page reads the same rows straight from Supabase. If a number
disagrees with Mixpanel, that page is the tiebreaker — Supabase is the source of
truth and Mixpanel is a second reader.

Finally, `navigator.doNotTrack` and a `cr:no-track` flag in `localStorage` both
disable collection entirely for that browser. Those players are invisible in
every report, which is the intended behaviour and a reason absolute counts should
be read as a lower bound.
