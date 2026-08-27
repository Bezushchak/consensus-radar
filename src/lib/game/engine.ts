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

export function leader(teams: Team[]): Team | null {
  if (teams.length === 0) return null;
  return [...teams].sort((a, b) => b.score - a.score)[0];
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
