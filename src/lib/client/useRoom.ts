"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { fetchState } from "./api";
import { browserSupabase } from "../supabase/browser";
import type { RoomState } from "../types";

/**
 * Keeps one room in sync.
 *
 * Supabase Realtime is used purely as a "something changed" doorbell: on any
 * insert/update in the room's tables we refetch the authoritative state from
 * /api. That keeps a single source of truth on the server and means the
 * client never has to reimplement the game rules. A slow poll runs as a
 * safety net in case the websocket cannot be established.
 */
export function useRoom(code: string) {
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  // When the request that produced the state we currently hold was *issued*.
  // Callers need this to tell "state that reflects what I just did" apart from
  // "state that was already on the wire before I did it".
  const [issuedAt, setIssuedAt] = useState(0);

  // How far this device's clock is behind the server's, in milliseconds.
  //
  // Phone clocks are wrong by minutes more often than anyone expects, and the
  // phase countdown is computed from an instant the server chose — so a device
  // that trusted its own `Date.now()` would show a different number from
  // everybody else at the table and expire the phase at the wrong moment.
  //
  // Measured against the moment the response *arrived* rather than the moment
  // it was asked for, which deliberately leans one way: the reply was written
  // before it landed, so this reads the server as very slightly earlier than it
  // really is, and the countdown runs a fraction of a second long. Long is the
  // safe direction — the server re-checks the deadline against its own clock
  // and rejects anything early, so a client that fires late is corrected by
  // waiting, while one that fires early is corrected by being refused.
  const [skewMs, setSkewMs] = useState(0);

  const inFlight = useRef(false);
  const queued = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  // Monotonic request numbering, so a slow response can never overwrite state
  // that is already newer than it.
  const seq = useRef(0);
  const applied = useRef(0);

  /**
   * Reads the offset out of a payload, if it carries one.
   *
   * `now` is absent from a response served by a deployment older than the
   * timers, and unparseable if something upstream mangles it. Either way the
   * answer is to leave the offset alone rather than to reset it to zero: a
   * stale-but-measured offset is closer to the truth than pretending the
   * device's clock is right.
   */
  const readSkew = useCallback((next: RoomState, arrivedAt: number) => {
    const serverNow = Date.parse(next.now ?? "");
    if (Number.isFinite(serverNow)) setSkewMs(serverNow - arrivedAt);
  }, []);

  /** Adopt state we were handed directly (a join or an action response). */
  const adoptState = useCallback(
    (next: RoomState) => {
      applied.current = ++seq.current;
      setState(next);
      setError(null);
      setIssuedAt(Date.now());
      readSkew(next, Date.now());
    },
    [readSkew]
  );

  const refresh = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    const mySeq = ++seq.current;
    const requestedAt = Date.now();
    try {
      const next = await fetchState(code);
      const arrivedAt = Date.now();
      if (mounted.current && mySeq >= applied.current) {
        applied.current = mySeq;
        setState(next);
        setError(null);
        setIssuedAt(requestedAt);
        readSkew(next, arrivedAt);
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Could not load the room");
    } finally {
      inFlight.current = false;
      if (queued.current) {
        queued.current = false;
        void refresh();
      }
    }
  }, [code, readSkew]);

  /** Collapse bursts of realtime events into one refetch. */
  const nudge = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(), 120);
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  const roomId = state?.room.id ?? null;

  useEffect(() => {
    if (!roomId) return;
    const supabase = browserSupabase();
    if (!supabase) return;

    let channel: RealtimeChannel | null = supabase.channel(`room:${roomId}`);

    const on = (table: string, filter: string) => {
      channel = channel!.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter },
        () => nudge()
      );
    };

    on("rooms", `id=eq.${roomId}`);
    on("players", `room_id=eq.${roomId}`);
    on("rounds", `room_id=eq.${roomId}`);
    on("guesses", `room_id=eq.${roomId}`);
    on("bets", `room_id=eq.${roomId}`);

    channel!.subscribe((status) => {
      if (!mounted.current) return;
      setLive(status === "SUBSCRIBED");
    });

    return () => {
      setLive(false);
      void supabase.removeChannel(channel!);
    };
  }, [roomId, nudge]);

  // Safety net: poll fast while the websocket is down, slowly when it is up.
  useEffect(() => {
    const every = live ? 15000 : 2500;
    const id = setInterval(() => void refresh(), every);
    return () => clearInterval(id);
  }, [live, refresh]);

  // Refetch when the tab comes back into focus (phones aggressively sleep).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  return { state, error, live, issuedAt, skewMs, refresh, adoptState };
}
