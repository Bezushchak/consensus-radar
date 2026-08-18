"use client";

import type { Identity, RoomState } from "../types";

/** Thin typed wrapper around the backend. All errors surface as ApiCallError. */

export class ApiCallError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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

  const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers ?? {}) }, cache: "no-store" });
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

export function createRoom(payload: CreateRoomPayload) {
  return request<{ state: RoomState; identity: Identity }>("/api/rooms", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function joinRoom(code: string, name: string, teamId?: string) {
  return request<{ state: RoomState; identity: Identity }>(
    `/api/rooms/${encodeURIComponent(code)}/join`,
    { method: "POST", body: JSON.stringify({ name, teamId }) }
  );
}

export function fetchState(code: string) {
  return request<RoomState>(`/api/rooms/${encodeURIComponent(code)}`);
}

export function fetchSecret(code: string, identity: Identity) {
  return request<{ roundId: string; target: number }>(
    `/api/rooms/${encodeURIComponent(code)}/secret`,
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
  | "again"
  | "end"
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
