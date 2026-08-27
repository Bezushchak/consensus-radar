"use client";

import { deviceUid } from "./identity";
import type { Calibration } from "../game/engine";
import type { Identity, LiveGuess, RoomState } from "../types";

/** Thin typed wrapper around the backend. All errors surface as ApiCallError. */

export class ApiCallError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Makes a GET URL unique.
 *
 * The server already answers `Cache-Control: no-store` and the fetch already
 * asks for `cache: "no-store"`, and on a desktop browser that is the end of it.
 * Mobile Safari is the exception: after a page restore it will happily re-serve
 * a GET from its own memory cache and ignore both. That is not a cosmetic
 * problem here — the room state is a GET, so a phone could sit on the snapshot
 * taken the moment the room was created (one player, the host) forever. Every
 * poll returned the same stale body, the player never appeared in their own
 * room, and tapping Join again just added another row.
 *
 * A URL nothing has seen before cannot be in any cache, anywhere: not Safari's,
 * not a corporate proxy's, not a CDN's. The counter is there so two calls in
 * the same millisecond still differ.
 */
let nonce = 0;
export function cacheBust(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}_=${Date.now().toString(36)}${(nonce++).toString(36)}`;
}

async function request<T>(
  path: string,
  init?: RequestInit & { identity?: Identity | null }
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init?.identity) {
    headers["x-player-id"] = init.identity.playerId;
    headers["x-player-token"] = init.identity.token;
  }

  // Reads only: a POST is never served from a cache, and keeping its URL clean
  // keeps the server logs readable.
  const isRead = (init?.method ?? "GET").toUpperCase() === "GET";
  if (isRead) {
    headers["Cache-Control"] = "no-cache";
    headers["Pragma"] = "no-cache";
  }
  const url = isRead ? cacheBust(path) : path;

  const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) }, cache: "no-store" });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiCallError(res.status, message);
  }
  return data as T;
}

export interface CreateRoomPayload {
  hostName: string;
  teamNames: string[];
  categories: string[];
  goal: number;
  betsEnabled: boolean;
  lang: string;
}

// Both entry points attach this browser's device id, so the leaderboard can
// recognise a returning player. Callers do not have to think about it.

export function createRoom(payload: CreateRoomPayload) {
  return request<{ state: RoomState; identity: Identity }>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ ...payload, uid: deviceUid() }),
  });
}

export function joinRoom(code: string, name: string, teamId?: string) {
  return request<{ state: RoomState; identity: Identity }>(
    `/api/rooms/${encodeURIComponent(code)}/join`,
    { method: "POST", body: JSON.stringify({ name, teamId, uid: deviceUid() }) }
  );
}

export function fetchState(code: string) {
  return request<RoomState>(`/api/rooms/${encodeURIComponent(code)}`);
}

/**
 * Per-player calibration for the game in this room. Read once, on the winner
 * screen — deliberately not part of the polled room state.
 */
export function fetchSummary(code: string) {
  return request<{ code: string; rounds: number; players: Calibration[] }>(
    `/api/rooms/${encodeURIComponent(code)}/summary`
  );
}

/** Throws ApiCallError(401) when the seat is genuinely gone. */
export function verifyMembership(code: string, identity: Identity) {
  return request<{ ok: true; playerId: string; name: string }>(
    `/api/rooms/${encodeURIComponent(code)}/me`,
    { identity }
  );
}

export function fetchSecret(code: string, identity: Identity) {
  return request<{ roundId: string; target: number }>(
    `/api/rooms/${encodeURIComponent(code)}/secret`,
    { identity }
  );
}

/** The active team's markers, for a watching team. 403 for the active team. */
export function fetchLiveGuesses(code: string, identity: Identity) {
  return request<{ roundId: string; guesses: LiveGuess[] }>(
    `/api/rooms/${encodeURIComponent(code)}/watch`,
    { identity }
  );
}

export type RoomAction =
  | "team"
  | "settings"
  | "start"
  | "clue"
  | "guess"
  | "bet"
  | "reveal"
  | "next"
  | "skip"
  | "again"
  | "end"
  | "host"
  | "leave";

export function act(
  code: string,
  action: RoomAction,
  identity: Identity,
  body: Record<string, unknown> = {}
) {
  return request<RoomState>(
    `/api/rooms/${encodeURIComponent(code)}/actions/${action}`,
    { method: "POST", identity, body: JSON.stringify(body) }
  );
}

export function fetchLeaderboard(board: string, period: string, limit = 25) {
  const qs = new URLSearchParams({ board, period, limit: String(limit) });
  return request<{ board: string; period: string; rows: Record<string, unknown>[] }>(
    `/api/leaderboard?${qs}`
  );
}
