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
