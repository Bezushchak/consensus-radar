import { NextResponse } from "next/server";
import { normalizeCode } from "../game/engine";
import { ApiError } from "./rooms";

export const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function fail(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
  }
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const isConfig = /Supabase is not configured/i.test(message);
  console.error("[consensus-radar]", error);
  return NextResponse.json({ error: message }, { status: isConfig ? 503 : 500, headers: NO_STORE });
}

/** Wraps a handler so every thrown ApiError becomes a clean JSON response. */
export async function guard(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(error);
  }
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * A device identifies itself with the id + token it got when joining.
 * Sent as headers so the values never end up in a URL or a log line.
 */
export function credentials(req: Request): { playerId: string; token: string } {
  return {
    playerId: req.headers.get("x-player-id") ?? "",
    token: req.headers.get("x-player-token") ?? "",
  };
}

export function requireCode(raw: string): string {
  const code = normalizeCode(raw ?? "");
  if (code.length < 4) throw new ApiError(400, "Invalid room code");
  return code;
}
