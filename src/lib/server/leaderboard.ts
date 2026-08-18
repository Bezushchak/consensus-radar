/**
 * Leaderboard queries. Four boards:
 *   teams   — best team runs (finished games)
 *   rounds  — closest single rounds ever
 *   players — per-person clue-giving and guessing accuracy
 *   scales  — which prompts teams miss the most
 *
 * Aggregation happens in JS rather than in the SQL views so that the same
 * code path can serve "all time" and "last 7 days". The views in
 * supabase/schema.sql mirror this logic for ad-hoc queries in the SQL editor.
 */

import { admin } from "../supabase/admin";
import { ApiError } from "./rooms";

export type Board = "teams" | "rounds" | "players" | "scales";
export type Period = "all" | "week" | "month";

const MAX_ROWS = 5000;

function since(period: Period): string | null {
  if (period === "all") return null;
  const days = period === "week" ? 7 : 30;
  return new Date(Date.now() - days * 86400000).toISOString();
}

export interface TeamRow {
  team_name: string;
  score: number;
  rounds_played: number;
  avg_distance: number | null;
  is_winner: boolean;
  players: string[];
  room_code: string;
  finished_at: string;
}

export interface RoundRow {
  team_name: string;
  clue_giver_name: string | null;
  clue: string | null;
  scale_left: string;
  scale_right: string;
  scale_left_ua: string | null;
  scale_right_ua: string | null;
  target: number | null;
  marker: number | null;
  distance: number | null;
  points: number | null;
  revealed_at: string | null;
}

export interface PlayerRow {
  player_name: string;
  clues_given: number;
  clue_avg_points: number | null;
  clue_avg_distance: number | null;
  guesses_made: number;
  guess_avg_distance: number | null;
  bets_won: number;
  total_points: number;
}

export interface ScaleRow {
  scale_key: string;
  scale_left: string;
  scale_right: string;
  scale_left_ua: string | null;
  scale_right_ua: string | null;
  times_played: number;
  avg_distance: number | null;
  avg_points: number | null;
  bullseyes: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function teamsBoard(period: Period, limit: number): Promise<TeamRow[]> {
  let q = admin()
    .from("game_results")
    .select("room_code, team_name, score, rounds_played, avg_distance, is_winner, player_names, finished_at")
    .order("score", { ascending: false })
    .order("avg_distance", { ascending: true, nullsFirst: false })
    .limit(limit);

  const from = since(period);
  if (from) q = q.gte("finished_at", from);

  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    team_name: String(r.team_name),
    score: Number(r.score),
    rounds_played: Number(r.rounds_played),
    avg_distance: r.avg_distance === null ? null : Number(r.avg_distance),
    is_winner: Boolean(r.is_winner),
    players: (r.player_names as string[] | null) ?? [],
    room_code: String(r.room_code),
    finished_at: String(r.finished_at),
  }));
}

export async function roundsBoard(period: Period, limit: number): Promise<RoundRow[]> {
  let q = admin()
    .from("rounds")
    .select(
      "team_name, clue_giver_name, clue, scale_left, scale_right, scale_left_ua, scale_right_ua, revealed_target, marker, distance, points, revealed_at"
    )
    .not("revealed_at", "is", null)
    .not("distance", "is", null)
    .order("distance", { ascending: true })
    .order("revealed_at", { ascending: false })
    .limit(limit);

  const from = since(period);
  if (from) q = q.gte("revealed_at", from);

  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    team_name: String(r.team_name),
    clue_giver_name: (r.clue_giver_name as string | null) ?? null,
    clue: (r.clue as string | null) ?? null,
    scale_left: String(r.scale_left),
    scale_right: String(r.scale_right),
    scale_left_ua: (r.scale_left_ua as string | null) ?? null,
    scale_right_ua: (r.scale_right_ua as string | null) ?? null,
    target: r.revealed_target === null ? null : Number(r.revealed_target),
    marker: r.marker === null ? null : Number(r.marker),
    distance: r.distance === null ? null : Number(r.distance),
    points: r.points === null ? null : Number(r.points),
    revealed_at: (r.revealed_at as string | null) ?? null,
  }));
}

export interface StatRow {
  player_name: string;
  player_uid: string | null;
  role: "clue" | "guess" | "bet";
  distance: number | null;
  points: number | null;
  scale_key: string | null;
}

/**
 * Per-person accuracy.
 *
 * Identity without accounts, in two steps. A row written by a browser that
 * knows its device id groups by that id, so the same person is one entry
 * however many games and however many rooms. Rows without one — games played
 * before device ids existed, or a browser that cannot keep storage — fall back
 * to grouping by lower-cased name, and are folded into a device group that
 * answers to the same name, so a returning player is not listed twice.
 *
 * What this deliberately does not do is merge two different people who share a
 * name across devices. Telling those apart needs a real account, and the whole
 * point of this game is that nobody has to make one.
 */
export async function playersBoard(period: Period, limit: number): Promise<PlayerRow[]> {
  let q = admin()
    .from("player_round_stats")
    .select("player_name, player_uid, role, distance, points, scale_key")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  const from = since(period);
  if (from) q = q.gte("created_at", from);

  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);

  return foldPlayerRows((data ?? []) as StatRow[], limit);
}

/**
 * The grouping half of `playersBoard`, kept pure so it can be tested without a
 * database. Rows must arrive newest first.
 */
export function foldPlayerRows(rows: StatRow[], limit: number): PlayerRow[] {
  const nameOf = (row: StatRow) => row.player_name.trim().toLowerCase();

  // Newest rows come first, so the first device id seen for a name is the one
  // that name most recently belonged to.
  const uidByName = new Map<string, string>();
  for (const row of rows) {
    if (!row.player_uid) continue;
    const name = nameOf(row);
    if (!uidByName.has(name)) uidByName.set(name, row.player_uid);
  }

  interface Acc {
    name: string;
    clueDist: number[];
    cluePts: number[];
    guessDist: number[];
    betsWon: number;
    total: number;
  }
  const acc = new Map<string, Acc>();

  for (const row of rows) {
    const key = row.player_uid ?? uidByName.get(nameOf(row)) ?? nameOf(row);
    let a = acc.get(key);
    if (!a) {
      a = { name: row.player_name, clueDist: [], cluePts: [], guessDist: [], betsWon: 0, total: 0 };
      acc.set(key, a);
    }
    const pts = row.points ?? 0;
    if (row.role === "clue") {
      if (row.distance !== null) a.clueDist.push(Number(row.distance));
      a.cluePts.push(pts);
      a.total += pts;
    } else if (row.role === "guess") {
      if (row.distance !== null) a.guessDist.push(Number(row.distance));
    } else {
      if (pts > 0) a.betsWon += 1;
      a.total += pts;
    }
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  return [...acc.values()]
    .map((a) => ({
      player_name: a.name,
      clues_given: a.cluePts.length,
      clue_avg_points: a.cluePts.length ? r2(avg(a.cluePts)!) : null,
      clue_avg_distance: a.clueDist.length ? r1(avg(a.clueDist)!) : null,
      guesses_made: a.guessDist.length,
      guess_avg_distance: a.guessDist.length ? r1(avg(a.guessDist)!) : null,
      bets_won: a.betsWon,
      total_points: a.total,
    }))
    .sort(
      (a, b) =>
        (b.clue_avg_points ?? -99) - (a.clue_avg_points ?? -99) ||
        b.clues_given - a.clues_given ||
        (a.guess_avg_distance ?? 999) - (b.guess_avg_distance ?? 999)
    )
    .slice(0, limit);
}

export async function scalesBoard(period: Period, limit: number): Promise<ScaleRow[]> {
  let q = admin()
    .from("rounds")
    .select("scale_key, scale_left, scale_right, scale_left_ua, scale_right_ua, distance, points, revealed_at")
    .not("revealed_at", "is", null)
    .not("distance", "is", null)
    .order("revealed_at", { ascending: false })
    .limit(MAX_ROWS);

  const from = since(period);
  if (from) q = q.gte("revealed_at", from);

  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);

  interface Acc {
    key: string;
    left: string;
    right: string;
    leftUa: string | null;
    rightUa: string | null;
    dist: number[];
    pts: number[];
    bullseyes: number;
  }
  const acc = new Map<string, Acc>();

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const key = String(row.scale_key);
    let a = acc.get(key);
    if (!a) {
      // Rows arrive newest first, so a reworded pair is labelled the way it
      // was worded most recently.
      a = {
        key,
        left: String(row.scale_left),
        right: String(row.scale_right),
        leftUa: (row.scale_left_ua as string | null) ?? null,
        rightUa: (row.scale_right_ua as string | null) ?? null,
        dist: [],
        pts: [],
        bullseyes: 0,
      };
      acc.set(key, a);
    }
    a.dist.push(Number(row.distance));
    const p = row.points === null ? 0 : Number(row.points);
    a.pts.push(p);
    if (p >= 4) a.bullseyes += 1;
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  return [...acc.values()]
    .map((a) => ({
      scale_key: a.key,
      scale_left: a.left,
      scale_right: a.right,
      scale_left_ua: a.leftUa,
      scale_right_ua: a.rightUa,
      times_played: a.dist.length,
      avg_distance: a.dist.length ? r1(avg(a.dist)!) : null,
      avg_points: a.pts.length ? r2(avg(a.pts)!) : null,
      bullseyes: a.bullseyes,
    }))
    .sort((a, b) => (b.avg_distance ?? 0) - (a.avg_distance ?? 0) || b.times_played - a.times_played)
    .slice(0, limit);
}

export async function loadBoard(board: Board, period: Period, limit = 25) {
  switch (board) {
    case "teams":
      return { board, period, rows: await teamsBoard(period, limit) };
    case "rounds":
      return { board, period, rows: await roundsBoard(period, limit) };
    case "players":
      return { board, period, rows: await playersBoard(period, limit) };
    case "scales":
      return { board, period, rows: await scalesBoard(period, limit) };
    default:
      throw new ApiError(400, "Unknown board");
  }
}
