/**
 * Pure game rules. No I/O, no Supabase — so the scoring can be reasoned
 * about (and unit-tested) on its own, and the same helpers can be reused
 * by the client for previews.
 */

import type { Scale } from "../scales";
import type {
  BetSide,
  Phase,
  Player,
  RevealDetailBet,
  RevealDetailGuess,
  Team,
} from "../types";

export const PALETTE = ["#5ee0c5", "#ff7a9c", "#7aa2ff", "#ffcf5c", "#5ee08a", "#c08bff"];

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 6;
export const MAX_PLAYERS = 40;

/**
 * A team needs this many people before it can take a turn.
 *
 * Two, not one, and the reason is structural rather than a matter of taste:
 * the clue-giver does not place a marker. A team of one therefore has a clue
 * and nobody to answer it, so the round has no guessers, cannot auto-reveal,
 * and the only way out is the host pressing "reveal" on an empty round. That
 * is the dead end the lobby now refuses to walk into.
 */
export const MIN_TEAM_SIZE = 2;

/** How many people are sitting in a given team. */
export function teamSize(players: Player[], teamId: string): number {
  return players.filter((p) => p.team_id === teamId).length;
}

/** Teams with enough people to play a round. */
export function playableTeams(teams: Team[], players: Player[], minSize = MIN_TEAM_SIZE): Team[] {
  return teams.filter((t) => teamSize(players, t.id) >= minSize);
}

/** Teams that have someone in them but not enough to play — the blockers. */
export function underStaffedTeams(
  teams: Team[],
  players: Player[],
  minSize = MIN_TEAM_SIZE
): Team[] {
  return teams.filter((t) => {
    const n = teamSize(players, t.id);
    return n > 0 && n < minSize;
  });
}

/**
 * Can this room start? Two playable teams, and nobody stranded in a team too
 * small to play — a stranded player would silently never get a turn.
 */
export function canStartGame(teams: Team[], players: Player[], minSize = MIN_TEAM_SIZE): boolean {
  return (
    playableTeams(teams, players, minSize).length >= MIN_TEAMS &&
    underStaffedTeams(teams, players, minSize).length === 0
  );
}
export const CLUE_MAX_LEN = 120;
export const NAME_MAX_LEN = 24;

/** Room codes: no 0/O/1/I/L to keep them dictatable over a call. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRoomCode(len = 4): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------
// Scoring — same bands as the original single-file game.
// ---------------------------------------------------------------------
export type ScoreKey = "msgBull" | "msgClose" | "msgFar" | "msgOpp";

export function scoreFor(target: number, marker: number): { pts: number; key: ScoreKey } {
  const d = Math.abs(target - marker);
  if (d <= 5) return { pts: 5, key: "msgBull" };
  if (d <= 12) return { pts: 3, key: "msgClose" };
  if (d <= 40) return { pts: 0, key: "msgFar" };
  return { pts: -2, key: "msgOpp" };
}

export const BET_POINTS = 1;

export function betIsCorrect(target: number, marker: number, side: BetSide): boolean {
  if (marker === target) return true; // dead centre: nobody loses the bet
  return side === "left" ? marker < target : marker > target;
}

/**
 * What a watching team scores for its side bet: all of it, or none of it.
 *
 * Unanimity, not a majority. Under the old majority rule a pair could click
 * opposite sides and still collect the point, which made the bet free — you
 * could not lose it, so there was nothing to talk about and nothing to get
 * wrong. Requiring one voice restores the only interesting part: the team has
 * to agree out loud before anybody taps.
 *
 * Abstaining does not block the team. Every bet counted here was placed, so
 * "all of them are right" is the same statement as "they agreed, and on the
 * correct side" — `correct` is derived from one target and one marker, so two
 * bets can only differ if their sides did. Someone who never voted is silent
 * rather than opposed, which is also how the auto-marker treats a silent
 * guesser.
 */
export function teamBetPoints(bets: Array<{ correct: boolean }>): number {
  if (bets.length === 0) return 0;
  return bets.every((b) => b.correct) ? BET_POINTS : 0;
}

/** Where a team's bets currently stand — for the screen, before the reveal. */
export type BetConsensus = "none" | "left" | "right" | "split";

/**
 * Folds the sides a team has picked into the one thing its members need to see.
 *
 * Deliberately says nothing about whether the side is right: the target is
 * secret until the reveal, so the only question this can answer before then is
 * whether the team is speaking with one voice. `split` is the state worth a
 * warning, because it is now worth zero.
 */
export function betConsensus(sides: BetSide[]): BetConsensus {
  if (sides.length === 0) return "none";
  const first = sides[0];
  return sides.every((s) => s === first) ? first : "split";
}

/** The team's marker is the average of everyone who submitted. */
export function averageMarker(values: number[]): number {
  if (values.length === 0) return 50;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

export function randomTarget(): number {
  return Math.floor(Math.random() * 91) + 5; // 5..95, same as the original
}

// ---------------------------------------------------------------------
// Round preparation
// ---------------------------------------------------------------------
/**
 * Deals the next scale from an already-narrowed pool, preferring pairs the
 * room has not seen yet. The pool is passed in rather than looked up so this
 * stays pure — the caller decides whether it came from the database or the
 * built-in catalogue.
 */
export function pickScale(pool: Scale[], usedKeys: string[]): Scale {
  if (pool.length === 0) throw new Error("pickScale needs a non-empty pool");
  const used = new Set(usedKeys);
  const fresh = pool.filter((s) => !used.has(s.key));
  const from = fresh.length > 0 ? fresh : pool;
  return from[Math.floor(Math.random() * from.length)];
}

/**
 * Clue-giver rotation: fewest turns so far wins, ties broken by join order.
 * Returns null when the team has nobody in it.
 */
export function pickClueGiver(teamPlayers: Player[]): Player | null {
  if (teamPlayers.length === 0) return null;
  return [...teamPlayers].sort(
    (a, b) => a.clue_turns - b.clue_turns || a.joined_at.localeCompare(b.joined_at)
  )[0];
}

/**
 * Next team index that can actually play, starting after `from`.
 * Returns null when no team qualifies.
 *
 * `minSize` defaults to 1 — "has anyone at all" — because that is the weakest
 * useful meaning and keeps this honest as a general helper. Live play passes
 * MIN_TEAM_SIZE, so a team that shrinks to one person mid-game is skipped
 * instead of wedging the rotation on a round nobody can answer.
 */
export function nextTeamIndex(
  teams: Team[],
  players: Player[],
  from: number,
  minSize = 1
): number | null {
  for (let step = 1; step <= teams.length; step++) {
    const idx = (from + step) % teams.length;
    if (teamSize(players, teams[idx].id) >= minSize) return idx;
  }
  return null;
}

export function firstTeamIndexWithPlayers(
  teams: Team[],
  players: Player[],
  minSize = 1
): number | null {
  for (let i = 0; i < teams.length; i++) {
    if (teamSize(players, teams[i].id) >= minSize) return i;
  }
  return null;
}

export function teamsAtGoal(teams: Team[], goal: number): Team[] {
  if (goal <= 0) return [];
  return teams.filter((t) => t.score >= goal);
}

/**
 * Average miss per team, keyed by team id. `null` means the team never
 * revealed a round, which is a different thing from having revealed one and
 * missed by nothing.
 */
export type TeamMisses = Record<string, number | null>;

/**
 * The final standings: most points first, and on equal points whoever was
 * closer on average.
 *
 * Points alone cannot name a winner, because a single reveal moves more than
 * one team — the guessing team takes its band, and every watching team that
 * agreed on the right side takes a point along with it. Two teams crossing the
 * goal in the same breath is therefore ordinary rather than freak, and sorting
 * on score alone handed those games to whichever of the tied teams happened to
 * be created first in the lobby. That was never a rule; it was the stability
 * of `Array.sort` leaking into the game.
 *
 * Average miss is the honest separator, and it is already the tie-break the
 * leaderboard's team board applies, so the winner screen and the stored table
 * now agree instead of ordering the same two rows differently. A team with no
 * revealed round has no average and so cannot win a tie on one: it sorts
 * behind every team that does have one, having demonstrated nothing to be
 * closer at. Teams that are genuinely inseparable keep their lobby order,
 * which is arbitrary but at least stable, so the podium and the row written to
 * `game_results` never disagree about who came first.
 */
export function rankTeams(teams: Team[], misses: TeamMisses = {}): Team[] {
  // `??` catches both the explicit null and the team that is missing from the
  // map entirely. Subtracting the two sentinels would give NaN, which `sort`
  // silently reads as zero, so the comparison below is written out instead.
  const miss = (t: Team): number => misses[t.id] ?? Number.POSITIVE_INFINITY;
  return [...teams].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const ma = miss(a);
    const mb = miss(b);
    if (ma === mb) return 0;
    return ma < mb ? -1 : 1;
  });
}

/**
 * The winner. `misses` is optional so that a caller with no round data still
 * gets the old score-only answer rather than a type error, but every caller
 * that can name a champion should pass it.
 */
export function leader(teams: Team[], misses: TeamMisses = {}): Team | null {
  if (teams.length === 0) return null;
  return rankTeams(teams, misses)[0];
}

/**
 * The standings as a phone can order them: score first, and then the winner the
 * server already named lifted to the front of its own score group.
 *
 * A room payload carries no round history, so a client cannot recompute the
 * average-miss tie-break for itself — and does not have to. `finishGame`
 * settled it and wrote the answer into `winner_team_name`, so the winner screen
 * reads that answer back rather than guessing at it. Without this, the podium
 * sorted on score alone and could hand the crown to one team while the headline
 * above it congratulated the other.
 *
 * Matched by name because the name is the only thing the room stores about it.
 * Two teams sharing a name would be ambiguous here, but they are already
 * ambiguous in the headline, on the scoreboard and on the leaderboard, so this
 * loses nothing that was not lost the moment they were named in the lobby.
 */
export function rankTeamsWithWinner(teams: Team[], winnerName: string | null): Team[] {
  return [...teams].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (winnerName === null) return 0;
    return (a.name === winnerName ? 0 : 1) - (b.name === winnerName ? 0 : 1);
  });
}

// ---------------------------------------------------------------------
// Presence — who is still at the table
//
// A room has no logins and no sockets it can trust, so "still here" is a
// judgement made from one timestamp: `last_seen_at`, which every request a
// device makes refreshes. Two things depend on that judgement, and both are
// about a room that cannot move: a host who closed the tab, and a round whose
// clue never arrives.
// ---------------------------------------------------------------------

/**
 * How long a player can go unheard from before the room treats them as gone.
 *
 * Every open tab refetches the room state at least every 15 seconds and that
 * read is what refreshes the stamp, so two minutes is eight missed beats:
 * comfortably longer than a phone waking up, a tunnel, or a slow reload, and
 * short enough that a table is not left waiting on somebody who has gone.
 */
export const AWAY_AFTER_MS = 120_000;

/**
 * Have we heard from this player recently?
 *
 * An unreadable or missing stamp counts as present. The stamp is evidence of
 * being here; its absence is not evidence of being gone, and the cost of the
 * two mistakes is not symmetric — a false "present" leaves things exactly as
 * they are today, a false "away" takes the crown off somebody who is holding
 * their phone.
 */
export function seenRecently(player: Player, now: number, awayAfter = AWAY_AFTER_MS): boolean {
  const stamp = Date.parse(player.last_seen_at || player.joined_at || "");
  if (!Number.isFinite(stamp)) return true;
  return now - stamp < awayAfter;
}

/**
 * Is the room's host gone? True when nobody holds the crown at all, or when
 * the holder has stopped answering.
 *
 * `hostId` is what the room row says; the `is_host` flag on the players is the
 * fallback, because the two are written separately and a crash between the two
 * writes must not leave the room permanently hostless.
 */
export function hostIsAway(
  players: Player[],
  hostId: string | null,
  now: number,
  awayAfter = AWAY_AFTER_MS
): boolean {
  if (players.length === 0) return false; // an empty room has nothing to hand over
  const host = players.find((p) => p.id === hostId) ?? players.find((p) => p.is_host) ?? null;
  if (!host) return true;
  return !seenRecently(host, now, awayAfter);
}

/**
 * Who takes over: whoever has been in the room longest of the people still
 * answering. Deliberately not "whoever asked first" — every device computes
 * this from the same player list and gets the same answer, so the handover
 * needs no coordination and cannot be raced into two hosts.
 *
 * Anyone already flagged `is_host` is excluded, which is what makes this safe
 * to call when the crown is merely stale: the answer is always somebody new.
 */
export function pickNewHost(players: Player[], now: number, awayAfter = AWAY_AFTER_MS): Player | null {
  const here = players.filter((p) => !p.is_host && seenRecently(p, now, awayAfter));
  if (here.length === 0) return null;
  return [...here].sort((a, b) => a.joined_at.localeCompare(b.joined_at))[0];
}

/**
 * Has the round's clue-giver stopped answering?
 *
 * The one seat a round cannot continue without: the guessers have no button to
 * press until a clue exists. A null id counts as away, and so does an id with
 * no matching player — both mean the seat the round is waiting on is empty
 * (`rounds.clue_giver_id` is set to null when the player row is deleted, and a
 * mid-flight read can see the deletion before the null).
 *
 * Note this is only meaningful for players whose device keeps saying hello: the
 * stamp moves on authenticated requests, so the clue-giver — like the host —
 * needs the client heartbeat for a quiet screen to still read as present.
 */
export function clueGiverIsAway(
  players: Player[],
  clueGiverId: string | null,
  now: number,
  awayAfter = AWAY_AFTER_MS
): boolean {
  if (!clueGiverId) return true;
  const giver = players.find((p) => p.id === clueGiverId);
  if (!giver) return true;
  return !seenRecently(giver, now, awayAfter);
}

/**
 * Can this round be abandoned?
 *
 * Yes right up to the reveal, and the two phases before it need it for
 * different reasons. `clue` is the dead end: the guessers cannot act until a
 * clue exists, so a clue-giver who walks away mid-round leaves a screen with
 * no button on it — reveal refuses to score a round with no clue, so without
 * this the only way out is ending the game. `guess` has the reveal button
 * already, and skipping is still the kinder option there: a clue nobody can
 * read is worth zero, and a forced reveal can cost the team two points for
 * guessing on the wrong side of the dial.
 *
 * Once a round is revealed there is nothing to rescue — it is scored, and
 * `next` is the way on.
 */
export function canSkipRound(phase: Phase): boolean {
  return phase !== "reveal";
}

/**
 * May this player drive the round — reveal it, skip it, start the next one?
 *
 * Only the clue-giver, and the reason is that a round belongs to one person at
 * a time. The clue-giver is the only player who knows whether the table has
 * finished talking, and they are the only one for whom revealing early costs
 * something. When the host held the same buttons, four other people watched a
 * round end for reasons they were not part of — and the host is very often on
 * another team, which made it somebody else's turn being ended.
 *
 * The rotation is what makes this fair rather than a privilege: a different
 * person gives the clue every round, so everybody holds the buttons in turn.
 *
 * The exception is the same dead end `canSkipRound` exists for. A clue-giver
 * who closes their tab would otherwise freeze the round permanently, so once
 * they have gone quiet the buttons open to whoever is left — not to the host
 * specifically, who may well be the person who left. A null id, or an id with
 * no matching player, counts as away for the same reason it does in
 * `clueGiverIsAway`: the seat the round is waiting on is empty.
 */
export function mayControlRound(
  round: { clue_giver_id: string | null },
  playerId: string,
  players: Player[],
  now: number,
  awayAfter = AWAY_AFTER_MS
): boolean {
  if (round.clue_giver_id !== null && round.clue_giver_id === playerId) return true;
  return clueGiverIsAway(players, round.clue_giver_id, now, awayAfter);
}

// ---------------------------------------------------------------------
// Phase timers
//
// Two clocks, chosen in the lobby and fixed for the game: one for the
// clue-giver, one for the guessing team. Both default to off, so a room that
// nobody configures plays exactly as it did before timers existed.
//
// The whole design turns on one decision: a phase stores a **deadline**, not a
// remaining duration. Five phones counting their own seconds drift apart and
// expire at five different moments; five phones counting down to the same
// instant agree. It also means a tab that was asleep for the whole phase wakes
// up already knowing it is over, with nothing to reconstruct.
//
// Nothing here reads a clock of its own — `now` is always passed in — which is
// what makes the boundaries testable.
// ---------------------------------------------------------------------

/**
 * What the lobby offers, in seconds. 0 is unlimited and is deliberately first:
 * it is the default, and the picker reads left to right.
 */
export const TIMER_CHOICES = [0, 60, 180, 300] as const;

/** Clamps anything to one of the offered values, falling back to unlimited. */
export function cleanTimerSeconds(raw: unknown): number {
  const n = Math.trunc(typeof raw === "number" ? raw : Number(raw));
  // Widened rather than asserted narrow: `includes` on a readonly tuple wants
  // the literal union, and asserting a `number` into it to ask the question is
  // the wrong way round. NaN falls through to 0 like everything else unknown.
  return (TIMER_CHOICES as readonly number[]).includes(n) ? n : 0;
}

/**
 * The marker a player who ran out of time is credited with.
 *
 * Dead centre, which is the least opinionated thing a slider can say: it is the
 * default position, so it is also what somebody who never touched the dial had
 * in front of them. It can still score — 50 is a bullseye when the secret is
 * near the middle — and that is correct rather than generous: the round is not a
 * punishment, it is an average, and refusing to count the marker would quietly
 * penalise the whole team for one slow phone.
 */
export const AUTO_MARKER = 50;

/** Seconds left drops below this and the UI turns amber and beeps once. */
export const TIMER_WARN_AT = 20;

/** Below this it goes red and beeps faster. The last five seconds. */
export const TIMER_FINAL_AT = 5;

/**
 * How far past the deadline a device waits before asking the server to end the
 * phase.
 *
 * A phone whose clock is a second fast must not be able to cut the phase short
 * for everybody else. The server re-checks the deadline against its own clock
 * anyway and is the real guard; this only stops the pointless request.
 */
export const EXPIRE_GRACE_MS = 1500;

/** Which of the room's two clocks applies to a phase. Reveal is never timed. */
export function phaseSeconds(
  room: { clue_seconds: number; guess_seconds: number },
  phase: Phase
): number {
  if (phase === "clue") return cleanTimerSeconds(room.clue_seconds);
  if (phase === "guess") return cleanTimerSeconds(room.guess_seconds);
  return 0;
}

/**
 * The instant a phase should end, as an ISO string, or null when it is untimed.
 * `from` is the moment the phase started — the server's clock, always.
 */
export function deadlineFor(
  room: { clue_seconds: number; guess_seconds: number },
  phase: Phase,
  from: number
): string | null {
  const seconds = phaseSeconds(room, phase);
  return seconds > 0 ? new Date(from + seconds * 1000).toISOString() : null;
}

/**
 * Whole seconds remaining, or null when there is no clock to read.
 *
 * Rounds up, so a countdown shows "1" for the whole of the last second and
 * reaches 0 exactly when the time is genuinely gone — a floor would display 0
 * for a second while the phase was still live, which is the one number a player
 * would call a bug. Never returns less than 0: how long ago it expired is not
 * something any caller here wants.
 *
 * An unreadable stamp reads as untimed rather than as expired, the same way an
 * unreadable `last_seen_at` reads as present: a shape this code does not
 * recognise must not end somebody's turn.
 */
export function secondsLeft(deadline: string | null | undefined, now: number): number | null {
  if (!deadline) return null;
  const at = Date.parse(deadline);
  if (!Number.isFinite(at)) return null;
  return Math.max(Math.ceil((at - now) / 1000), 0);
}

/** How the countdown should look, and whether it should make a noise. */
export type TimerLevel = "none" | "calm" | "warn" | "final" | "over";

export function timerLevel(left: number | null): TimerLevel {
  if (left === null) return "none";
  if (left <= 0) return "over";
  if (left <= TIMER_FINAL_AT) return "final";
  if (left <= TIMER_WARN_AT) return "warn";
  return "calm";
}

/**
 * Is this device allowed to ask the server to end the phase?
 *
 * Deliberately client-driven, for the same reason the host takeover is a button:
 * there is no per-round job on the server, and adding one would mean a cron that
 * wakes every few seconds for a game nobody is playing. Whichever tab notices
 * first asks; the server claims the phase atomically, so the other four asking
 * in the same second change nothing.
 */
export function mayExpire(
  deadline: string | null | undefined,
  now: number,
  grace = EXPIRE_GRACE_MS
): boolean {
  if (!deadline) return false;
  const at = Date.parse(deadline);
  if (!Number.isFinite(at)) return false;
  return now >= at + grace;
}

/** mm:ss, for the countdown itself. Clamped at zero, never negative. */
export function formatClock(left: number | null): string {
  if (left === null) return "";
  const total = Math.max(Math.trunc(left), 0);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------
// Calibration — how each person did, across a whole game
//
// The scoreboard is a team number by design: a round is won by a group
// agreeing, and rewarding individuals for it would push people to guess
// against their team. But the question everyone asks when the game ends is
// personal — "was I the one dragging us off?" — and the game already knows the
// answer. Every reveal writes `reveal_detail`, which carries each marker and
// how far off it was, so the end-of-game card is a fold over rows that already
// exist. Nothing extra is recorded, and no new column is needed.
// ---------------------------------------------------------------------

export interface Calibration {
  playerId: string;
  name: string;
  /** Markers placed. Rounds spent giving the clue do not count against you. */
  markers: number;
  /** Mean distance from the secret spot, one decimal. Null with no markers. */
  avgError: number | null;
  /** The closest they got all game. Null with no markers. */
  best: number | null;
  /** Markers inside the bullseye band — the same 5 the live scoring uses. */
  bullseyes: number;
  betsPlaced: number;
  betsWon: number;
}

/**
 * What a stored reveal actually is once it comes back out of the database.
 *
 * Typed loosely on purpose. `rounds.reveal_detail` is a jsonb column, so its
 * contents are whatever some past deploy wrote there — not what today's
 * `RevealDetail` interface promises. A shape from an older version of the game
 * must produce a slightly thinner card, never a crash on the winner screen.
 */
export interface StoredReveal {
  guesses?: Array<Partial<RevealDetailGuess> | null> | null;
  bets?: Array<Partial<RevealDetailBet> | null> | null;
}

/** A finite distance, or null. */
function distanceOf(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

/**
 * Folds a game's reveals into one row per person.
 *
 * Ordered most calibrated first, with anyone who never placed a marker last —
 * a player can finish a short game having only given clues and bet, and their
 * missing average must not read as a perfect zero.
 *
 * Players who left mid-game still appear. `reveal_detail` is jsonb rather than
 * foreign keys, so it keeps its own copy of the name and survives the row being
 * deleted. That is the right answer: they played those rounds.
 */
export function foldCalibration(details: Array<StoredReveal | null | undefined>): Calibration[] {
  interface Acc {
    playerId: string;
    name: string;
    sum: number;
    markers: number;
    best: number | null;
    bullseyes: number;
    betsPlaced: number;
    betsWon: number;
  }
  const by = new Map<string, Acc>();

  const seat = (id: string, name: string): Acc => {
    let acc = by.get(id);
    if (!acc) {
      by.set(
        id,
        (acc = {
          playerId: id,
          name,
          sum: 0,
          markers: 0,
          best: null,
          bullseyes: 0,
          betsPlaced: 0,
          betsWon: 0,
        })
      );
    }
    // A later round's spelling wins, which matters when a duplicate name was
    // disambiguated between games.
    if (name) acc.name = name;
    return acc;
  };

  for (const detail of details) {
    if (!detail) continue;

    for (const g of detail.guesses ?? []) {
      if (!g?.player_id) continue;
      const d = distanceOf(g.distance);
      if (d === null) continue;
      const acc = seat(g.player_id, g.player_name ?? "");
      acc.sum += d;
      acc.markers += 1;
      if (acc.best === null || d < acc.best) acc.best = d;
      if (d <= 5) acc.bullseyes += 1;
    }

    for (const b of detail.bets ?? []) {
      if (!b?.player_id) continue;
      const acc = seat(b.player_id, b.player_name ?? "");
      acc.betsPlaced += 1;
      if (b.correct) acc.betsWon += 1;
    }
  }

  return [...by.values()]
    .map((a) => ({
      playerId: a.playerId,
      name: a.name,
      markers: a.markers,
      avgError: a.markers === 0 ? null : Math.round((a.sum / a.markers) * 10) / 10,
      best: a.best === null ? null : Math.round(a.best * 10) / 10,
      bullseyes: a.bullseyes,
      betsPlaced: a.betsPlaced,
      betsWon: a.betsWon,
    }))
    .sort(
      (a, b) =>
        (a.avgError ?? Number.POSITIVE_INFINITY) - (b.avgError ?? Number.POSITIVE_INFINITY) ||
        a.name.localeCompare(b.name)
    );
}

// ---------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------
export function cleanName(raw: unknown, fallback: string): string {
  const s = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  return (s || fallback).slice(0, NAME_MAX_LEN);
}

/**
 * The device id a browser sends so its games can be stitched together on the
 * leaderboard. It is not a credential — it grants nothing on its own — but it
 * is still normalised hard so nothing surprising reaches the database.
 */
export function cleanUid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return /^[0-9a-f]{16,64}$/.test(s) ? s : null;
}

export function cleanClue(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  return s.slice(0, CLUE_MAX_LEN);
}

export function clampSlider(raw: unknown): number | null {
  // Number(null) is 0 and Number("") is 0 — neither is a real submission,
  // so only genuine numbers and numeric strings are accepted here.
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function makeTeams(names: unknown): Team[] {
  const list = Array.isArray(names) ? names : [];
  const teams: Team[] = [];
  for (let i = 0; i < Math.min(Math.max(list.length, MIN_TEAMS), MAX_TEAMS); i++) {
    teams.push({
      id: `t${i + 1}`,
      name: cleanName(list[i], `Team ${i + 1}`),
      color: PALETTE[i % PALETTE.length],
      score: 0,
    });
  }
  return teams;
}
