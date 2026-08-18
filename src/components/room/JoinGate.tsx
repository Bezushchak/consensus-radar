"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { useLang } from "@/components/LangProvider";
import * as api from "@/lib/client/api";
import { rememberedName, saveIdentity } from "@/lib/client/identity";
import type { Identity, RoomState } from "@/lib/types";

/** Shown when this device has no identity for the room yet. */
export default function JoinGate({
  code,
  state,
  onJoined,
}: {
  code: string;
  state: RoomState;
  onJoined: (identity: Identity) => void;
}) {
  const { t, lang } = useLang();
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(rememberedName()), []);

  const inProgress = state.room.status !== "lobby";

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const { identity } = await api.joinRoom(code, name, teamId ?? undefined);
      saveIdentity(identity);
      onJoined(identity);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join");
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

        {error ? <div className="err">{error}</div> : null}

        <div className="actions">
          <button className="btn wide" onClick={join} disabled={busy}>
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
