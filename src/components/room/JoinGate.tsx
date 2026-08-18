"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { useLang } from "@/components/LangProvider";
import * as api from "@/lib/client/api";
import { rememberedName, saveIdentity } from "@/lib/client/identity";
import { startTracking, track, trackOnce, trackRoom } from "@/lib/client/track";
import type { Identity, RoomState } from "@/lib/types";

/** Shown when this device has no identity for the room yet. */
export default function JoinGate({
  code,
  state,
  notice,
  onJoined,
}: {
  code: string;
  state: RoomState;
  /** Anything the room owner needs to know before trying again. */
  notice?: string | null;
  onJoined: (identity: Identity, joinedState: RoomState) => void;
}) {
  const { t, lang } = useLang();
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(rememberedName());
    startTracking();
    trackRoom(code);
    trackOnce("join_open", { players: state.players.length });
  }, [code, state.players.length]);

  const inProgress = state.room.status !== "lobby";

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const { identity, state: joined } = await api.joinRoom(code, name, teamId ?? undefined);
      saveIdentity(identity);
      track("joined", { from: "gate", picked_team: teamId !== null });
      onJoined(identity, joined);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not join";
      setError(message);
      // The message that appears on the phone also lands in the events table,
      // which is how a failure nobody screenshots still gets noticed.
      track("error_shown", { where: "join-gate", message });
    } finally {
      // Always release the button. Leaving it spinning was how a failed
      // hand-off turned into a screen that never came back.
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <AppHeader nav="home" />

      <section className="card center-narrow">
        <div className="roomcode">
          <div className="code">{state.room.code}</div>
          <div className="hint">
            {state.players.length}{" "}
            {lang === "ua" ? "гравців у кімнаті" : state.players.length === 1 ? "player in the room" : "players in the room"}
          </div>
        </div>

        <label className="fl" htmlFor="join-name">
          {t("yourName")}
        </label>
        <input
          id="join-name"
          type="text"
          value={name}
          maxLength={24}
          placeholder={t("namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void join();
          }}
        />

        <label className="fl">{t("pickTeam")}</label>
        <div className="teampick">
          {state.room.teams.map((team) => {
            const count = state.players.filter((p) => p.team_id === team.id).length;
            return (
              <button
                key={team.id}
                className={teamId === team.id ? "sel" : ""}
                data-ev="pick-team"
                onClick={() => setTeamId(team.id)}
              >
                <span className="dot" style={{ background: team.color }} />
                {team.name}
                <span className="mini">({count})</span>
              </button>
            );
          })}
        </div>

        {inProgress ? (
          <div className="ok">
            {lang === "ua"
              ? "Гра вже почалася — ви приєднаєтесь і зможете грати з наступного раунду."
              : "The game is already running — you'll join in and play from the next round."}
          </div>
        ) : null}

        {error ?? notice ? <div className="err">{error ?? notice}</div> : null}

        <div className="actions">
          <button className="btn wide" data-ev="join-room" onClick={join} disabled={busy}>
            {busy ? t("loading") : t("joinBtn")}
          </button>
        </div>

        <p className="stepnote">
          <Link href="/">{t("homeLink")}</Link>
        </p>
      </section>
    </div>
  );
}
