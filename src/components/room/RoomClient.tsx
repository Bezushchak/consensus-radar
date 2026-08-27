"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { useLang } from "@/components/LangProvider";
import Scoreboard from "@/components/Scoreboard";
import JoinGate from "./JoinGate";
import Lobby from "./Lobby";
import PlayView from "./PlayView";
import Winner from "./Winner";
import * as api from "@/lib/client/api";
import { clearIdentity, loadIdentity } from "@/lib/client/identity";
import { startTracking, trackRoom } from "@/lib/client/track";
import { useRoom } from "@/lib/client/useRoom";
import type { Identity, RoomState } from "@/lib/types";

export type RunAction = (
  action: api.RoomAction,
  body?: Record<string, unknown>
) => Promise<RoomState | null>;

export default function RoomClient({ code }: { code: string }) {
  const { t, lang } = useLang();
  const { state, error, live, issuedAt, refresh, adoptState } = useRoom(code);

  const [identity, setIdentity] = useState<Identity | null>(null);
  const [ready, setReady] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [seatNotice, setSeatNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // When the current identity was adopted. Room state fetched before this
  // moment predates our join and legitimately has no row for us yet.
  const adoptedAt = useRef(0);

  const adoptIdentity = useCallback((next: Identity | null) => {
    adoptedAt.current = Date.now();
    setIdentity(next);
  }, []);

  useEffect(() => {
    adoptIdentity(loadIdentity(code));
    setReady(true);
  }, [code, adoptIdentity]);

  // Instrument the room page itself, not just the screens that lead into it.
  // `JoinGate` used to be the only thing here that started tracking, which was
  // fine for a first visit and wrong for every later one: a player who already
  // has a seat never sees the gate, so a reload — and phones reload a lot —
  // produced a tab with no click listener, no `session_end`, and `room_code`
  // null on everything it did send. Both calls are idempotent, so doing it here
  // covers the reload without double-counting the first visit.
  useEffect(() => {
    startTracking();
    trackRoom(code);
  }, [code]);

  /** Runs a mutation and adopts the state the server hands back. */
  const run = useCallback<RunAction>(
    async (action, body = {}) => {
      if (!identity) return null;
      setBusy(true);
      setActionError(null);
      try {
        const next = await api.act(code, action, identity, body);
        if (next && typeof next === "object" && "room" in next) adoptState(next);
        else await refresh();
        return next;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Something went wrong";
        if (e instanceof api.ApiCallError && e.status === 401) {
          clearIdentity(code);
          setIdentity(null);
        }
        setActionError(message);
        await refresh();
        return null;
      } finally {
        setBusy(false);
      }
    },
    [code, identity, refresh, adoptState]
  );

  const me = useMemo(
    () => (identity && state ? state.players.find((p) => p.id === identity.playerId) ?? null : null),
    [identity, state]
  );

  // The device holds an identity but the room state has no row for it. That is
  // ambiguous — the seat may be gone (room reset or purged), or this response
  // may simply predate the join — so the server is asked instead of guessed
  // at. Guessing is what produced the join loop: one stale fetch threw away a
  // good identity, the join screen came back, the player joined again, and the
  // whole thing went round for as long as they were willing to tap.
  const recheck = useRef(0);
  useEffect(() => {
    if (!ready || !identity || !state || me) return;
    if (issuedAt <= adoptedAt.current) return;

    let cancelled = false;
    void (async () => {
      try {
        await api.verifyMembership(code, identity);
        if (cancelled) return;
        // Still a member: the state we hold is behind, not wrong. Refetch a
        // few times, then say so rather than spinning silently.
        if (++recheck.current <= 4) {
          await refresh();
        } else {
          setSeatNotice(
            lang === "ua"
              ? "Сервер підтверджує, що ви в кімнаті, але її стан вас не показує. Оновіть сторінку; якщо не допомогло — перевірте /api/health."
              : "The server says you are in this room but its state does not show you. Reload the page; if that does not help, check /api/health."
          );
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof api.ApiCallError && e.status === 401) {
          clearIdentity(code);
          setIdentity(null);
        } else {
          setSeatNotice(e instanceof Error ? e.message : "Could not verify your seat");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, identity, state, me, issuedAt, code, refresh, lang]);

  // A resolved seat clears the suspicion.
  useEffect(() => {
    if (me) {
      recheck.current = 0;
      setSeatNotice(null);
    }
  }, [me]);

  if (!ready || (!state && !error)) {
    return (
      <div className="wrap">
        <AppHeader nav="home" />
        <section className="card center">
          <p className="sub" style={{ margin: 0 }}>
            <span className="spin" />
            {t("loading")}
          </p>
        </section>
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="wrap">
        <AppHeader nav="home" />
        <section className="card center">
          <h2>{code}</h2>
          <div className="err">{error}</div>
          <div className="actions" style={{ justifyContent: "center" }}>
            <button className="btn ghost" onClick={() => void refresh()}>
              {t("retry")}
            </button>
            <Link className="btn" href="/">
              {t("homeLink")}
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (!state) return null;

  if (!identity || !me) {
    return (
      <JoinGate
        code={code}
        state={state}
        notice={seatNotice}
        onJoined={(id, joinedState) => {
          // Adopt the state the join call returned, so `me` resolves on this
          // very render instead of waiting for the next fetch.
          adoptState(joinedState);
          adoptIdentity(id);
          void refresh();
        }}
      />
    );
  }

  const { room, players, round } = state;
  const activeTeam = room.teams[room.active_team_index] ?? null;

  return (
    <div className="wrap">
      <AppHeader nav="leaderboard" />

      {room.status === "lobby" ? (
        <Lobby code={code} state={state} me={me} run={run} busy={busy} />
      ) : null}

      {room.status === "playing" && round ? (
        <PlayView
          code={code}
          state={state}
          me={me}
          identity={identity}
          round={round}
          run={run}
          busy={busy}
        />
      ) : null}

      {room.status === "finished" ? (
        <Winner state={state} me={me} run={run} busy={busy} />
      ) : null}

      {actionError ? <div className="err">{actionError}</div> : null}

      {room.status === "playing" ? (
        <section className="card">
          <h3>{t("scoresTitle")}</h3>
          <Scoreboard
            teams={room.teams}
            players={players}
            activeTeamId={activeTeam?.id ?? null}
            myTeamId={me.team_id}
          />
          {me.is_host ? (
            <div className="actions">
              <button className="btn ghost sm" onClick={() => void run("end")} disabled={busy}>
                {t("endGame")}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="footer">
        {lang === "ua" ? "Кімната" : "Room"} {room.code} ·{" "}
        {live ? (lang === "ua" ? "живе оновлення" : "live updates") : lang === "ua" ? "опитування" : "polling"}{" "}
        · <Link href="/leaderboard">{t("leaderboardLink")}</Link>
      </div>
    </div>
  );
}
