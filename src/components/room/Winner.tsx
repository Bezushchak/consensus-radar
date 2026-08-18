"use client";

import Link from "next/link";
import { useLang } from "@/components/LangProvider";
import Scoreboard from "@/components/Scoreboard";
import type { RunAction } from "./RoomClient";
import type { Player, RoomState } from "@/lib/types";

export default function Winner({
  state,
  me,
  run,
  busy,
}: {
  state: RoomState;
  me: Player;
  run: RunAction;
  busy: boolean;
}) {
  const { t } = useLang();
  const { room, players } = state;
  const top = [...room.teams].sort((a, b) => b.score - a.score)[0];

  return (
    <section className="card winner">
      <div className="crown">👑</div>
      <h2>{t("winnerTitle", { team: room.winner_team_name ?? top?.name ?? "" })}</h2>
      <p className="sub">{t("winnerSub")}</p>

      <Scoreboard teams={room.teams} players={players} sorted />

      <div className="ok" style={{ textAlign: "center" }}>
        {t("resultsSaved")}
      </div>

      <div className="actions" style={{ justifyContent: "center" }}>
        {me.is_host ? (
          <button className="btn" onClick={() => void run("again")} disabled={busy}>
            {t("playAgain")}
          </button>
        ) : null}
        <Link className="btn ghost" href="/leaderboard">
          🏆 {t("leaderboardLink")}
        </Link>
      </div>
    </section>
  );
}
