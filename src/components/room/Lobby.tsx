"use client";

import { useState } from "react";
import { useLang } from "@/components/LangProvider";
import { track } from "@/lib/client/track";
import {
  MIN_TEAM_SIZE,
  TIMER_CHOICES,
  canStartGame,
  cleanTimerSeconds,
  playableTeams,
  underStaffedTeams,
} from "@/lib/game/engine";
import type { RunAction } from "./RoomClient";
import type { Player, RoomState } from "@/lib/types";

export default function Lobby({
  code,
  state,
  me,
  run,
  busy,
}: {
  code: string;
  state: RoomState;
  me: Player;
  run: RunAction;
  busy: boolean;
}) {
  const { t, lang } = useLang();
  const { room, players } = state;

  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [goal, setGoal] = useState(room.goal);
  const [bets, setBets] = useState(room.bets_enabled);
  const [general, setGeneral] = useState(room.categories.includes("general"));
  const [analytics, setAnalytics] = useState(room.categories.includes("analytics"));
  // Cleaned on the way in as well as on the way out. A room created before the
  // columns existed comes back with these undefined, and the picker has to show
  // something — "no clock" is both the truth and the safe default.
  const [clueSeconds, setClueSeconds] = useState(() => cleanTimerSeconds(room.clue_seconds));
  const [guessSeconds, setGuessSeconds] = useState(() => cleanTimerSeconds(room.guess_seconds));

  // Same rule the server enforces in startGame, evaluated here so the Start
  // button is simply unavailable instead of the host pressing it and being
  // refused. Both come from engine.ts, so they cannot drift apart.
  const playable = playableTeams(room.teams, players);
  const soloTeams = underStaffedTeams(room.teams, players);
  const canStart = canStartGame(room.teams, players);

  async function copyLink() {
    const url = `${window.location.origin}/room/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt(lang === "ua" ? "Скопіюйте посилання:" : "Copy this link:", url);
    }
  }

  async function saveSettings() {
    const categories = [general ? "general" : null, analytics ? "analytics" : null].filter(
      (c): c is string => c !== null
    );
    const res = await run("settings", {
      categories,
      goal,
      betsEnabled: bets,
      clueSeconds,
      guessSeconds,
    });
    if (res) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    }
  }

  return (
    <>
      <section className="card">
        <div className="roomcode">
          <div className="code">{room.code}</div>
          <div className="hint">{t("shareHint")}</div>
        </div>
        <div className="actions" style={{ justifyContent: "center" }}>
          <button className="btn ghost sm" data-ev="copy-link" onClick={copyLink}>
            {copied ? t("copied") : `🔗 ${t("copy")}`}
          </button>
        </div>
      </section>

      <section className="card">
        <h3>{t("pickTeam")}</h3>
        <div className="teampick">
          {room.teams.map((team) => {
            const n = players.filter((p) => p.team_id === team.id).length;
            return (
              <button
                key={team.id}
                className={me.team_id === team.id ? "sel" : ""}
                data-ev="switch-team"
                disabled={busy}
                onClick={() => void run("team", { teamId: team.id })}
              >
                <span className="dot" style={{ background: team.color }} />
                {team.name}
                {/* Showing the shortfall, not just the headcount, so it is
                    obvious which team to walk towards. */}
                <span className="mini">
                  ({n}
                  {n > 0 && n < MIN_TEAM_SIZE ? `/${MIN_TEAM_SIZE}` : ""})
                </span>
              </button>
            );
          })}
        </div>

        <h3 style={{ marginTop: 22 }}>
          {t("playersIn")} · {players.length}
        </h3>
        <div className="chiplist">
          {players.map((p) => {
            const team = room.teams.find((tm) => tm.id === p.team_id);
            return (
              <span key={p.id} className={`chip${p.id === me.id ? " me" : ""}`}>
                <span className="dot" style={{ background: team?.color ?? "#46508a" }} />
                {p.name}
                {p.is_host ? <span className="mini">· {t("hostBadge")}</span> : null}
              </span>
            );
          })}
        </div>
      </section>

      {me.is_host ? (
        <section className="card">
          <h3>{t("settingsTitle")}</h3>

          <label className="fl">{t("catLabel")}</label>
          <div className="toggleline">
            <label className="chk">
              <input type="checkbox" checked={general} onChange={(e) => setGeneral(e.target.checked)} />
              <span>{t("catGeneral")}</span>
            </label>
            <label className="chk">
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
              />
              <span>{t("catAnalytics")}</span>
            </label>
          </div>

          <label className="fl" htmlFor="lobby-goal">
            {t("targetLabel")}
          </label>
          <select id="lobby-goal" value={goal} onChange={(e) => setGoal(Number(e.target.value))}>
            <option value={15}>15</option>
            <option value={20}>20</option>
            <option value={25}>25</option>
            <option value={30}>30</option>
            <option value={0}>{t("endless")}</option>
          </select>

          <div className="toggleline">
            <label className="chk">
              <input type="checkbox" checked={bets} onChange={(e) => setBets(e.target.checked)} />
              <span>{t("betsLabel")}</span>
            </label>
          </div>

          {/* Two clocks and not one. The two jobs are nothing alike: writing a
              clue is a blank page, and moving a slider you are already looking
              at is a decision — so a single limit is either cruel to the
              clue-giver or no limit at all for the guessers. Both default to
              unlimited, which is exactly how every room played before this
              existed. */}
          <label className="fl">{t("timersLabel")}</label>
          <p className="sub" style={{ margin: "0 0 10px" }}>
            {t("timersSub")}
          </p>
          <div className="timerpick">
            <div>
              <label className="fl" htmlFor="lobby-clue-timer">
                {t("clueTimerLabel")}
              </label>
              <select
                id="lobby-clue-timer"
                value={clueSeconds}
                onChange={(e) => setClueSeconds(cleanTimerSeconds(e.target.value))}
              >
                {TIMER_CHOICES.map((s) => (
                  <option key={s} value={s}>
                    {s === 0 ? t("timerOff") : t("timerMin", { n: s / 60 })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="fl" htmlFor="lobby-guess-timer">
                {t("guessTimerLabel")}
              </label>
              <select
                id="lobby-guess-timer"
                value={guessSeconds}
                onChange={(e) => setGuessSeconds(cleanTimerSeconds(e.target.value))}
              >
                {TIMER_CHOICES.map((s) => (
                  <option key={s} value={s}>
                    {s === 0 ? t("timerOff") : t("timerMin", { n: s / 60 })}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {clueSeconds > 0 || guessSeconds > 0 ? (
            <p className="stepnote">{t("timerRules")}</p>
          ) : null}

          {saved ? <div className="ok">{t("settingsSaved")}</div> : null}

          <div className="actions">
            <button className="btn ghost" data-ev="save-settings" onClick={saveSettings} disabled={busy}>
              {t("saveSettings")}
            </button>
            <button
              className="btn"
              style={{ flex: 1 }}
              data-ev="start-game"
              onClick={async () => {
                const res = await run("start");
                // The two limits ride along on the one event that fires once per
                // game, from the saved room rather than from the pickers — a
                // host who moved a picker without pressing Save is playing with
                // the old value, and this has to say what the room does. It is
                // what makes `timer_expired` divisible: without knowing which
                // games had a clock, the only available denominator mixes rooms
                // that could not possibly have expired into the ratio.
                if (res)
                  track("game_started", {
                    players: players.length,
                    teams: playable.length,
                    clue_sec: cleanTimerSeconds(room.clue_seconds),
                    guess_sec: cleanTimerSeconds(room.guess_seconds),
                  });
              }}
              disabled={busy || !canStart}
            >
              {t("startBtn")}
            </button>
          </div>
          {soloTeams.length > 0 ? (
            <p className="stepnote">
              ⚠️ {t("soloTeamWarn")} {soloTeams.map((tm) => tm.name).join(", ")}
            </p>
          ) : !canStart ? (
            <p className="stepnote">{t("needTwoTeams")}</p>
          ) : null}
        </section>
      ) : (
        <section className="card center">
          <p className="sub" style={{ margin: 0 }}>
            <span className="spin" />
            {t("waitingHost")}
          </p>
        </section>
      )}
    </>
  );
}
