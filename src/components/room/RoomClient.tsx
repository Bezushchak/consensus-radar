"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { useLang } from "@/components/LangProvider";
import Scoreboard from "@/components/Scoreboard";
import JoinGate from "./JoinGate";
import Lobby from "./Lobby";
import PlayView from "./PlayView";
import Winner from "./Winner";
import * as api from "@/lib/client/api";
import { clearIdentity, loadIdentity } from "@/lib/client/identity";
import { useRoom } from "@/lib/client/useRoom";
import type { Identity, RoomState } from "@/lib/types";

export type RunAction = (
  action: api.RoomAction,
  body?: Record<string, unknown>
) => Promise<RoomState | null>;

export default function RoomClient({ code }: { code: string }) {
  const { t, lang } = useLang();
  const { state, error, live, refresh, setState } = useRoom(code);

  const [identity, setIdentity] = useState<Identity | null>(null);
  const [ready, setReady] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setIdentity(loadIdentity(code));
    setReady(true);
  }, [code]);

  /** Runs a mutation and adopts the state the server hands back. */
  const run = useCallback<RunAction>(
    async (action, body = {}) => {
      if (!identity) return null;
      setBusy(true);
      setActionError(null);
      try {
        const next = await api.act(code, action, identity, body);
        if (next && typeof next === "object" && "room" in next) setState(next);
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
    [code, identity, refresh, setState]
  );

  const me = useMemo(
    () => (identity && state ? state.players.find((p) => p.id === identity.playerId) ?? null : null),
    [identity, state]
  );

  // The device thinks it is in this room but the server disagrees (room was
  // reset or purged) — drop the stale identity and let them join again.
  useEffect(() => {
    if (ready && identity && state && !me) {
      clearIdentity(code);
      setIdentity(null);
    }
  }, [ready, identity, state, me, code]);

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
        onJoined={(id) => {
          setIdentity(id);
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
