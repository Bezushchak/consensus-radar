"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/components/LangProvider";
import Podium from "@/components/leaderboard/Podium";
import type { LbEntry } from "@/components/leaderboard/types";
import Scoreboard from "@/components/Scoreboard";
import * as api from "@/lib/client/api";
import { track } from "@/lib/client/track";
import { rankTeamsWithWinner, type Calibration } from "@/lib/game/engine";
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
  /**
   * Ordered by score, with the tie settled the way the server settled it: on
   * equal points the champion it named in `winner_team_name` comes first. Sorting
   * on score alone here used to let the crown on the podium disagree with the
   * headline directly above it, since two teams reaching the goal in the same
   * reveal is ordinary rather than rare.
   */
  const ranked = useMemo(
    () => rankTeamsWithWinner(room.teams, room.winner_team_name),
    [room.teams, room.winner_team_name]
  );
  const top = ranked[0];

  /**
   * The final standings, on steps — the same component the leaderboard opens
   * with, because this is the same moment: a result worth looking at rather than
   * a table worth reading. Non-interactive here (no `onPick`): everything a
   * step could open is already further down this very page.
   */
  const podium = useMemo<LbEntry[]>(
    () =>
      ranked.slice(0, 3).map((team, i) => {
        const roster = players.filter((p) => p.team_id === team.id).map((p) => p.name);
        return {
          key: team.id,
          rank: i + 1,
          title: team.name,
          subtitle: roster.join(", ") || null,
          headline: String(team.score),
          headlineLabel: t("pts"),
          crown: i === 0,
          mine: me.team_id !== null && team.id === me.team_id,
        };
      }),
    [ranked, players, me.team_id, t]
  );

  // The last step of the funnel: a game that actually reached an end.
  useEffect(() => {
    track("game_finished", { rounds: room.round_no, score: top?.score ?? 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  /**
   * Read once, on arrival — in three states rather than two.
   *
   * `null` is still reading. An array is an answer, and an *empty* array is a
   * real answer: a game ended before any round was revealed has nothing
   * personal to show, and saying so is better than a card that silently is not
   * there. `"failed"` is a read that never arrived, and that one stays quiet on
   * purpose — the winner screen is the payoff, and it must not carry an error
   * message about a nice-to-have table.
   *
   * The two used to collapse into `[]` together, which is precisely why nothing
   * could be said about the empty case: the broken case has to be silent, so
   * the empty case was silent too.
   */
  const [calib, setCalib] = useState<Calibration[] | "failed" | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .fetchSummary(room.code)
      .then((res) => {
        if (!cancelled) setCalib(res.players);
      })
      .catch(() => {
        if (!cancelled) setCalib("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [room.code, room.id]);

  // Narrowed once here so the markup below asks two plain questions instead of
  // three. `[]` is truthy, which is what lets "read, and empty" be its own
  // branch without a second flag.
  const rows = calib === "failed" ? null : calib;

  return (
    <section className="card winner">
      <div className="crown">👑</div>
      <h2>{t("winnerTitle", { team: room.winner_team_name ?? top?.name ?? "" })}</h2>
      <p className="sub">{t("winnerSub")}</p>

      <Podium entries={podium} youLabel={t("lbYou")} />

      {/* `ranked`, not `room.teams` with `sorted` — the board's own sort knows
          only about score, and would put two tied teams in lobby order while the
          podium above it put them in the server's order. */}
      <Scoreboard teams={ranked} players={players} myTeamId={me.team_id} />

      <div className="ok" style={{ textAlign: "center" }}>
        {t("resultsSaved")}
      </div>

      {/* The personal read on a deliberately team-scored game. Sorted by
          average error, so the top row is whoever was easiest to tune into —
          which is a nicer thing to be told than a rank by points would be. */}
      {rows && rows.length > 0 ? (
        <>
          <h3 style={{ marginTop: 26 }}>{t("calibTitle")}</h3>
          <p className="sub" style={{ marginTop: 0 }}>
            {t("calibSub")}
          </p>
          <div className="tablewrap">
            <table className="lb">
              <thead>
                <tr>
                  <th className="rank">#</th>
                  <th>{t("colPlayer")}</th>
                  <th>{t("calibAvg")}</th>
                  <th>{t("calibBest")}</th>
                  <th>{t("calibBulls")}</th>
                  <th>{t("calibBets")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={p.playerId} className={p.playerId === me.id ? "mine" : ""}>
                    <td className="rank">{p.markers === 0 ? "–" : i + 1}</td>
                    <td>
                      {p.name || "—"}
                      {p.playerId === me.id ? <span className="mini"> · {t("lbYou")}</span> : null}
                    </td>
                    <td className="num">
                      {p.avgError === null ? (
                        <span className="mini">{t("calibNoMarkers")}</span>
                      ) : (
                        p.avgError
                      )}
                    </td>
                    <td className="num">{p.best === null ? "–" : p.best}</td>
                    <td className="num">{p.bullseyes}</td>
                    <td className="num">
                      {p.betsPlaced === 0 ? "–" : `${p.betsWon}/${p.betsPlaced}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : rows ? (
        <p className="sub" style={{ textAlign: "center", marginTop: 26 }}>
          {t("calibEmpty")}
        </p>
      ) : null}

      <div className="actions" style={{ justifyContent: "center" }}>
        {me.is_host ? (
          <button className="btn" data-ev="play-again" onClick={() => void run("again")} disabled={busy}>
            {t("playAgain")}
          </button>
        ) : null}
        <Link className="btn ghost" data-ev="winner-leaderboard" href="/leaderboard">
          🏆 {t("leaderboardLink")}
        </Link>
      </div>
    </section>
  );
}
