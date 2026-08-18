"use client";

import type { Identity, Lang } from "../types";

/**
 * There is no auth: a device remembers who it is with a token issued at join
 * time. localStorage is the whole "session store".
 */

const key = (code: string) => `cr:identity:${code.toUpperCase()}`;
const LAST = "cr:last-room";
const LANG = "cr:lang";
const NAME = "cr:name";
const UID = "cr:player-uid";

function safeGet(k: string): string | null {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
}

function safeSet(k: string, v: string): void {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* private mode — the game still works, it just won't survive a reload */
  }
}

export function saveIdentity(id: Identity): void {
  safeSet(key(id.roomCode), JSON.stringify(id));
  safeSet(LAST, id.roomCode.toUpperCase());
  safeSet(NAME, id.name);
}

export function loadIdentity(code: string): Identity | null {
  const raw = safeGet(key(code));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Identity;
    return parsed?.playerId && parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

export function clearIdentity(code: string): void {
  try {
    window.localStorage.removeItem(key(code));
  } catch {
    /* ignore */
  }
}

/**
 * This browser's long-lived id, minted once and kept for every future game.
 *
 * It is what makes "Dmytro" on the leaderboard one person across games instead
 * of one row per game — no email, no password, nothing to remember. The cost
 * of that convenience: a different browser or a cleared storage is a different
 * player, and anyone who uses this browser plays as this id. It grants no
 * access to anything, so leaking it does nothing; the per-room `token` is the
 * value that actually authorises moves.
 */
export function deviceUid(): string {
  const existing = safeGet(UID);
  if (existing && /^[0-9a-f]{32}$/.test(existing)) return existing;

  const fresh = randomHex(16);
  safeSet(UID, fresh);
  return fresh;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  try {
    crypto.getRandomValues(buf);
  } catch {
    // Ancient or locked-down browser: uniqueness is all this needs.
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function lastRoom(): string | null {
  return safeGet(LAST);
}

export function rememberedName(): string {
  return safeGet(NAME) ?? "";
}

export function loadLang(): Lang {
  return safeGet(LANG) === "en" ? "en" : "ua";
}

export function saveLang(lang: Lang): void {
  safeSet(LANG, lang);
}
