import type { Lang } from "./scales";

export type { Lang, Category } from "./scales";

export type RoomStatus = "lobby" | "playing" | "finished";
export type Phase = "clue" | "guess" | "reveal";
export type BetSide = "left" | "right";

export interface Team {
  id: string;
  name: string;
  color: string;
  score: number;
}

export interface Room {
  id: string;
  code: string;
  status: RoomStatus;
  lang: Lang;
  categories: string[];
  goal: number;
  bets_enabled: boolean;
  teams: Team[];
  active_team_index: number;
  round_no: number;
  current_round_id: string | null;
  host_player_id: string | null;
  winner_team_name: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface Player {
  id: string;
  room_id: string;
  name: string;
  /** The browser's own long-lived id, used to join up games on the leaderboard. */
  player_uid: string | null;
  team_id: string | null;
  is_host: boolean;
  clue_turns: number;
  joined_at: string;
  last_seen_at: string;
}

export interface RevealDetailGuess {
  player_id: string;
  player_name: string;
  value: number;
  distance: number;
}

export interface RevealDetailBet {
  player_id: string;
  player_name: string;
  team_id: string;
  side: BetSide;
  correct: boolean;
}

export interface RevealDetail {
  guesses: RevealDetailGuess[];
  bets: RevealDetailBet[];
  team_points: Record<string, number>;
}

export interface Round {
  id: string;
  room_id: string;
  round_no: number;
  team_id: string;
  team_name: string;
  clue_giver_id: string | null;
  clue_giver_name: string | null;
  scale_key: string;
  /** English labels, frozen at deal time. */
  scale_left: string;
  scale_right: string;
  /** Ukrainian labels — null on rounds played before they were recorded. */
  scale_left_ua: string | null;
  scale_right_ua: string | null;
  phase: Phase;
  clue: string | null;
  marker: number | null;
  distance: number | null;
  points: number | null;
  revealed_target: number | null;
  reveal_detail: RevealDetail | null;
  created_at: string;
  revealed_at: string | null;
}

/**
 * One active-team marker, as shown to a player who is allowed to watch it
 * before the reveal — the other teams, who have to bet on which side of it the
 * secret sits. Served by its own endpoint rather than folded into `RoomState`,
 * because the room state is one payload for everybody and this is not
 * something everybody may see.
 */
export interface LiveGuess {
  player_id: string;
  player_name: string;
  value: number;
}

/** Public progress row — the slider value itself stays server-side. */
export interface GuessRow {
  id: string;
  round_id: string;
  player_id: string;
  player_name: string;
  team_id: string;
  submitted_at: string;
}

export interface BetRow {
  id: string;
  round_id: string;
  player_id: string;
  player_name: string;
  team_id: string;
  side: BetSide;
  submitted_at: string;
}

/** What the /api/rooms/[code] endpoint returns. */
export interface RoomState {
  room: Room;
  players: Player[];
  round: Round | null;
  guesses: GuessRow[];
  bets: BetRow[];
}

/** Stored in localStorage so a device can prove who it is without auth. */
export interface Identity {
  roomCode: string;
  playerId: string;
  token: string;
  name: string;
}
