"use client";

import { useLang } from "./LangProvider";
import type { Player, Team } from "@/lib/types";

interface Props {
  teams: Team[];
  players: Player[];
  activeTeamId?: string | null;
  sorted?: boolean;
  showRoster?: boolean;
  myTeamId?: string | null;
}

export default function Scoreboard({
  teams,
  players,
  activeTeamId = null,
  sorted = false,
  showRoster = true,
  myTeamId = null,
}: Props) {
  const { t } = useLang();
  const list = sorted ? [...teams].sort((a, b) => b.score - a.score) : teams;

  return (
    <div className="scoreboard">
      {list.map((team) => {
        const roster = players.filter((p) => p.team_id === team.id);
        return (
          <div key={team.id} className={`team${activeTeamId === team.id ? " active" : ""}`}>
            <div className="nm">
              <span className="dot" style={{ background: team.color }} />
              {team.name}
              {myTeamId === team.id ? " ·" : ""}
            </div>
            <div className="sc">
              {team.score} <small>{t("pts")}</small>
            </div>
            {showRoster && roster.length > 0 ? (
              <div className="roster">{roster.map((p) => p.name).join(", ")}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
