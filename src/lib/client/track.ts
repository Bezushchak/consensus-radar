"use client";

import { deviceUid } from "./identity";

/**
 * Client-side event capture.
 *
 * Design notes worth keeping, because they are the difference between analytics
 * you can afford and analytics you turn off two weeks later:
 *
 *   Batched, not per-event. Events go into a queue and leave every few seconds,
 *   or on the first page-hide, whichever comes first. One request carrying
 *   twelve events costs the same as one carrying one.
 *
 *   `sendBeacon` on the way out. A `fetch` started during unload is killed with
 *   the page, which is exactly when the most interesting event — "they left
 *   here" — happens. Beacon survives it.
 *
 *   Clicks by delegation. One capture-phase listener finds the nearest
 *   `[data-ev]` ancestor and records that label. Nothing has to remember to
 *   call the tracker, and an unlabelled click is recorded as a bare path so
 *   dead ends still show up.
 *
 *   Cursor movement, deliberately not recorded raw. A mouse emits ~60 events a
 *   second; a ten-minute game is 36,000 rows per player for a question nobody
 *   asked. What is on offer instead, behind NEXT_PUBLIC_TRACK_POINTER=1, is a
 *   coarse heat grid: sample the pointer at 2 Hz into a 12x8 bucket grid and
 *   send the accumulated counts once, on the way out. One row per page view,
 *   and it answers the real question — where attention went — better than a
 *   replay would.
 *
 *   Opt-out honoured. `navigator.doNotTrack` or `cr:no-track` in localStorage
 *   and the module does nothing at all.
 */

const ENDPOINT = "/api/events";
const FLUSH_MS = 4000;
const MAX_QUEUE = 30;
const SESSION_KEY = "cr:session";
const OPT_OUT = "cr:no-track";

type Props = Record<string, string | number | boolean>;

interface Queued {
  name: string;
  path: string;
  roomCode?: string;
  props: Props;
  ts: number;
}

let queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let sessionId = "";
let openedAt = 0;
let roomCode: string | null = null;
const seenOnce = new Set<string>();

// Pointer heat, only ever populated when the flag is on.
const GRID_X = 12;
const GRID_Y = 8;
const heat = new Map<string, number>();
let lastSample = 0;

function optedOut(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (window.localStorage.getItem(OPT_OUT) === "1") return true;
  } catch {
    /* storage blocked — that alone is not an opt-out */
  }
  return navigator.doNotTrack === "1";
}

function pointerTracking(): boolean {
  return process.env.NEXT_PUBLIC_TRACK_POINTER === "1";
}

/** Per tab, not per browser: this is a visit, not a person. */
function session(): string {
  if (sessionId) return sessionId;
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return (sessionId = existing);
  } catch {
    /* fall through to a memory-only id */
  }
  const fresh = randomId();
  try {
    window.sessionStorage.setItem(SESSION_KEY, fresh);
  } catch {
    /* ignore */
  }
  return (sessionId = fresh);
}

function randomId(): string {
  const buf = new Uint8Array(12);
  try {
    crypto.getRandomValues(buf);
  } catch {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** '/room/GSTE' is recorded as '/room/[code]': the path, not the room. */
function path(): string {
  const raw = window.location.pathname;
  return raw.replace(/^\/room\/[^/]+/, "/room/[code]");
}

function device(): "mobile" | "desktop" {
  return window.matchMedia?.("(max-width: 760px)").matches ? "mobile" : "desktop";
}

function lang(): string {
  try {
    return window.localStorage.getItem("cr:lang") === "en" ? "en" : "ua";
  } catch {
    return "ua";
  }
}

/** Records one event. Safe to call from anywhere, including render effects. */
export function track(name: string, props: Props = {}): void {
  if (typeof window === "undefined" || optedOut()) return;

  queue.push({
    name,
    path: path(),
    roomCode: roomCode ?? undefined,
    props,
    ts: Date.now(),
  });

  if (queue.length >= MAX_QUEUE) {
    flush();
    return;
  }
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/**
 * Records an event at most once per session — for the funnel steps, where the
 * question is "did this person get here", not "how many times".
 */
export function trackOnce(name: string, props: Props = {}): void {
  const key = `${name}:${path()}`;
  if (seenOnce.has(key)) return;
  seenOnce.add(key);
  track(name, props);
}

/** Attaches the room code to every later event from this tab. */
export function trackRoom(code: string | null): void {
  roomCode = code ? code.toUpperCase() : null;
}

export function flush(final = false): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;

  const body = JSON.stringify({
    sessionId: session(),
    uid: deviceUid(),
    lang: lang(),
    device: device(),
    events: queue.map((e) => ({
      name: e.name,
      path: e.path,
      roomCode: e.roomCode,
      props: e.props,
      ts: e.ts,
    })),
  });
  queue = [];

  // On the way out, beacon; otherwise a normal keepalive post.
  if (final && navigator.sendBeacon) {
    try {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      return;
    } catch {
      /* fall through to fetch */
    }
  }
  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    /* analytics never surfaces an error to a player */
  });
}

/**
 * Installs the listeners. Idempotent, so every page can call it on mount.
 */
export function startTracking(): void {
  if (started || typeof window === "undefined" || optedOut()) return;
  started = true;
  openedAt = Date.now();
  session();

  // Clicks, by delegation. Capture phase, so a handler that stops propagation
  // does not also hide the click from the report.
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const labelled = target?.closest?.("[data-ev]") as HTMLElement | null;
      const label = labelled?.dataset.ev;
      if (label) {
        track("click", { target: label });
        return;
      }
      // Unlabelled but interactive: still worth knowing something was pressed.
      const control = target?.closest?.("button, a, input, [role='button']");
      if (control) track("click", { target: "(unlabelled)", tag: control.tagName.toLowerCase() });
    },
    { capture: true }
  );

  if (pointerTracking()) {
    const sample = (x: number, y: number) => {
      const now = Date.now();
      if (now - lastSample < 500) return;
      lastSample = now;
      const cx = Math.min(GRID_X - 1, Math.max(0, Math.floor((x / window.innerWidth) * GRID_X)));
      const cy = Math.min(GRID_Y - 1, Math.max(0, Math.floor((y / window.innerHeight) * GRID_Y)));
      const key = `${cx},${cy}`;
      heat.set(key, (heat.get(key) ?? 0) + 1);
    };
    window.addEventListener("pointermove", (e) => sample(e.clientX, e.clientY), { passive: true });
  }

  const leave = () => {
    const seconds = Math.round((Date.now() - openedAt) / 1000);
    // A phone can hide and return several times in one game; each stretch is
    // reported once and the clock restarts, so the median stays honest.
    if (seconds < 1) return;
    openedAt = Date.now();
    track("session_end", { seconds });
    if (pointerTracking() && heat.size > 0) {
      // Only the busiest cells travel: 8 numbers describe a page's attention
      // well enough, and the props cap would drop the rest anyway.
      const top = [...heat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      track("pointer_heat", {
        grid: `${GRID_X}x${GRID_Y}`,
        cells: top.map(([cell, n]) => `${cell}:${n}`).join(" "),
      });
      heat.clear();
    }
    flush(true);
  };

  // pagehide is the one that fires reliably on iOS Safari; visibilitychange
  // covers tab switches, where a phone may never come back.
  window.addEventListener("pagehide", leave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") leave();
  });
}
