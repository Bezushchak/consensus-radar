"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { useLang } from "@/components/LangProvider";
import { fetchLeaderboard } from "@/lib/client/api";
import { startTracking, trackOnce } from "@/lib/client/track";
import { storedLabels } from "@/lib/scales";

type Board = "teams" | "rounds" | "players" | "scales";
type Period = "all" | "month" | "week";

type Row = Record<string, unknown>;

const s = (v: unknown) => (v === null || v === undefined ? "—" : String(v));
const n = (v: unknown) => (v === null || v === undefined ? "—" : String(v));

export default function LeaderboardPage() {
  const { t, lang } = useLang();
  const [board, setBoard] = useState<Board>("teams");
  const [period, setPeriod] = useState<Period>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLeaderboard(board, period, 50);
      setRows(res.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the leaderboard");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [board, period]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    startTracking();
    trackOnce("leaderboard_open");
  }, []);

  // Rows carry both languages; older rows only have the English pair.
  const poles = (r: Row) => {
    const { left, right } = storedLabels(
      {
        scale_left: s(r.scale_left),
        scale_right: s(r.scale_right),
        scale_left_ua: (r.scale_left_ua as string | null) ?? null,
        scale_right_ua: (r.scale_right_ua as string | null) ?? null,
      },
      lang
    );
    return `${left} ↔ ${right}`;
  };

  const when = (iso: unknown) => {
    if (!iso) return "—";
    const d = new Date(String(iso));
    return d.toLocaleDateString(lang === "ua" ? "uk-UA" : "en-GB", {
      day: "2-digit",
      month: "short",
    });
  };

  return (
    <div className="wrap wide">
      <AppHeader nav="home" />

      <section className="card">
        <h2>🏆 {t("lbTitle")}</h2>
        <p className="sub">{t("lbSub")}</p>

        <div className="tabs">
          {(
            [
              ["teams", t("lbTeams")],
              ["rounds", t("lbRounds")],
              ["players", t("lbPlayers")],
              ["scales", t("lbScales")],
            ] as [Board, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={board === key ? "active" : ""}
              data-ev={`lb-board-${key}`}
              onClick={() => setBoard(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="tabs">
          {(
            [
              ["all", t("periodAll")],
              ["month", t("periodMonth")],
              ["week", t("periodWeek")],
            ] as [Period, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={period === key ? "active" : ""}
              data-ev={`lb-period-${key}`}
              onClick={() => setPeriod(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? <div className="err">{error}</div> : null}

        {loading ? (
          <p className="empty">
            <span className="spin" />
            {t("loading")}
          </p>
        ) : rows.length === 0 ? (
          <p className="empty">{t("lbEmpty")}</p>
        ) : (
          <div className="tablewrap">
            {board === "teams" ? (
              <table className="lb">
                <thead>
                  <tr>
                    <th className="rank">#</th>
                    <th>{t("colTeam")}</th>
                    <th>{t("colScore")}</th>
                    <th>{t("colRounds")}</th>
                    <th>{t("colAvgDist")}</th>
                    <th>{t("colPlayers")}</th>
                    <th>{t("colWhen")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.room_code}-${r.team_name}-${i}`}>
                      <td className="rank">{i + 1}</td>
                      <td>
                        {s(r.team_name)} {r.is_winner ? "👑" : ""}
                        <div className="mini">{s(r.room_code)}</div>
                      </td>
                      <td className="num">{n(r.score)}</td>
                      <td className="num">{n(r.rounds_played)}</td>
                      <td className="num">{n(r.avg_distance)}</td>
                      <td className="mini">
                        {Array.isArray(r.players) ? (r.players as string[]).join(", ") : "—"}
                      </td>
                      <td className="mini">{when(r.finished_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {board === "rounds" ? (
              <table className="lb">
                <thead>
                  <tr>
                    <th className="rank">#</th>
                    <th>{t("colMiss")}</th>
                    <th>{t("colScale")}</th>
                    <th>{t("colClue")}</th>
                    <th>{t("colTeam")}</th>
                    <th>{t("colPlayer")}</th>
                    <th>{t("colWhen")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.revealed_at}-${i}`}>
                      <td className="rank">{i + 1}</td>
                      <td className="num">
                        {n(r.distance)}
                        <div className="mini">
                          {n(r.marker)}% → {n(r.target)}%
                        </div>
                      </td>
                      <td className="mini">{poles(r)}</td>
                      <td>{s(r.clue)}</td>
                      <td>{s(r.team_name)}</td>
                      <td>{s(r.clue_giver_name)}</td>
                      <td className="mini">{when(r.revealed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {board === "players" ? (
              <table className="lb">
                <thead>
                  <tr>
                    <th className="rank">#</th>
                    <th>{t("colPlayer")}</th>
                    <th>{t("colCluePts")}</th>
                    <th>{t("colClues")}</th>
                    <th>{t("colGuessDist")}</th>
                    <th>{t("colGuesses")}</th>
                    <th>{t("colBets")}</th>
                    <th>{t("colScore")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.player_name}-${i}`}>
                      <td className="rank">{i + 1}</td>
                      <td>{s(r.player_name)}</td>
                      <td className="num">{n(r.clue_avg_points)}</td>
                      <td className="num">{n(r.clues_given)}</td>
                      <td className="num">{n(r.guess_avg_distance)}</td>
                      <td className="num">{n(r.guesses_made)}</td>
                      <td className="num">{n(r.bets_won)}</td>
                      <td className="num">{n(r.total_points)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {board === "scales" ? (
              <table className="lb">
                <thead>
                  <tr>
                    <th className="rank">#</th>
                    <th>{t("colScale")}</th>
                    <th>{t("colAvgDist")}</th>
                    <th>{t("colCluePts")}</th>
                    <th>{t("colBullseyes")}</th>
                    <th>{t("colTimes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.scale_key}-${i}`}>
                      <td className="rank">{i + 1}</td>
                      <td>
                        {poles(r)}
                        <div className="mini">{s(r.scale_key)}</div>
                      </td>
                      <td className="num">{n(r.avg_distance)}</td>
                      <td className="num">{n(r.avg_points)}</td>
                      <td className="num">{n(r.bullseyes)}</td>
                      <td className="num">{n(r.times_played)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        )}

        {board === "players" ? <p className="stepnote">{t("lbHint")}</p> : null}
      </section>

      <div className="footer">
        <Link href="/">{t("homeLink")}</Link>
      </div>
    </div>
  );
}
