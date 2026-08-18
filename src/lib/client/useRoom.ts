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

  const inFlight = useRef(false);
  const queued = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  // Monotonic request numbering, so a slow response can never overwrite state
  // that is already newer than it.
  const seq = useRef(0);
  const applied = useRef(0);

  /** Adopt state we were handed directly (a join or an action response). */
  const adoptState = useCallback((next: RoomState) => {
    applied.current = ++seq.current;
    setState(next);
    setError(null);
    setIssuedAt(Date.now());
  }, []);

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
      if (mounted.current && mySeq >= applied.current) {
        applied.current = mySeq;
        setState(next);
        setError(null);
        setIssuedAt(requestedAt);
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
  }, [code]);

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

  return { state, error, live, issuedAt, refresh, adoptState };
}
