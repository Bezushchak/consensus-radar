/**
 * Pure game rules. No I/O, no Supabase — so the scoring can be reasoned
 * about (and unit-tested) on its own, and the same helpers can be reused
 * by the client for previews.
 */

import { scalesForCategories, type Scale } from "../scales";
import type { BetSide, Player, Team } from "../types";

export const PALETTE = ["#5ee0c5", "#ff7a9c", "#7aa2ff", "#ffcf5c", "#5ee08a", "#c08bff"];

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 6;
export const MAX_PLAYERS = 40;
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
export function pickScale(categories: string[], usedKeys: string[]): Scale {
  const pool = scalesForCategories(categories);
  const fresh = pool.filter((s) => !usedKeys.includes(s.key));
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
 * Next team index that actually has players, starting after `from`.
 * Returns null when no team has anyone.
 */
export function nextTeamIndex(teams: Team[], players: Player[], from: number): number | null {
  for (let step = 1; step <= teams.length; step++) {
    const idx = (from + step) % teams.length;
    if (players.some((p) => p.team_id === teams[idx].id)) return idx;
  }
  return null;
}

export function firstTeamIndexWithPlayers(teams: Team[], players: Player[]): number | null {
  for (let i = 0; i < teams.length; i++) {
    if (players.some((p) => p.team_id === teams[i].id)) return i;
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
// Validation helpers
// ---------------------------------------------------------------------
export function cleanName(raw: unknown, fallback: string): string {
  const s = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  return (s || fallback).slice(0, NAME_MAX_LEN);
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
