"use client";

import { useEffect, useMemo, useState } from "react";
import Gauge from "@/components/Gauge";
import { useLang } from "@/components/LangProvider";
import Poles from "@/components/Poles";
import * as api from "@/lib/client/api";
import { scoreFor } from "@/lib/game/engine";
import type { RunAction } from "./RoomClient";
import type { Identity, Player, RoomState, Round } from "@/lib/types";

export default function PlayView({
  code,
  state,
  me,
  identity,
  round,
  run,
  busy,
}: {
  code: string;
  state: RoomState;
  me: Player;
  identity: Identity;
  round: Round;
  run: RunAction;
  busy: boolean;
}) {
  const { t, lang } = useLang();
  const { room, players, guesses, bets } = state;

  const amClueGiver = round.clue_giver_id === me.id;
  const amOnActiveTeam = me.team_id === round.team_id;
  const amGuesser = amOnActiveTeam && !amClueGiver;

  // ---- the secret target: only ever fetched by the clue-giver ----
  const [secret, setSecret] = useState<{ roundId: string; target: number } | null>(null);
  useEffect(() => {
    if (!amClueGiver) {
      setSecret(null);
      return;
    }
    let cancelled = false;
    api
      .fetchSecret(code, identity)
      .then((s) => {
        if (!cancelled) setSecret(s);
      })
      .catch(() => {
        if (!cancelled) setSecret(null);
      });
    return () => {
      cancelled = true;
    };
  }, [amClueGiver, code, identity, round.id]);

  const targetForMe =
    round.phase === "reveal"
      ? round.revealed_target
      : secret && secret.roundId === round.id
        ? secret.target
        : null;

  // ---- progress ----
  const expectedGuessers = players.filter(
    (p) => p.team_id === round.team_id && p.id !== round.clue_giver_id
  );
  const myGuess = guesses.find((g) => g.player_id === me.id) ?? null;
  const myBet = bets.find((b) => b.player_id === me.id) ?? null;

  const [slider, setSlider] = useState(50);
  useEffect(() => setSlider(50), [round.id]);

  const pill = `${t("round")} ${round.round_no} · ${round.team_name}`;

  const detail = round.reveal_detail;
  const ghosts = useMemo(
    () => (detail?.guesses ?? []).map((g) => ({ value: g.value, label: g.player_name })),
    [detail]
  );

  // =================================================================
  // CLUE PHASE
  // =================================================================
  if (round.phase === "clue") {
    if (amClueGiver) {
      return (
        <ClueComposer
          round={round}
          target={targetForMe}
          pill={pill}
          run={run}
          busy={busy}
        />
      );
    }
    return (
      <section className="card">
        <div className="turninfo">
          <span className="pill">{pill}</span>
        </div>
        <h2 className="center">
          {t("clueGiverIs", { name: round.clue_giver_name ?? "?", team: round.team_name })}
        </h2>
        <Poles round={round} />
        <div className="gaugewrap">
          <Gauge />
        </div>
        <p className="waiting">
          <span className="spin" />
          {t("waitClue", { name: round.clue_giver_name ?? "?" })}
        </p>
      </section>
    );
  }

  // =================================================================
  // GUESS PHASE
  // =================================================================
  if (round.phase === "guess") {
    return (
      <section className="card">
        <div className="turninfo">
          <span className="pill">{pill}</span>
          {amGuesser ? <span className="pill good">{t("guessTitle")}</span> : null}
          {amClueGiver ? <span className="pill gold">{t("youGiveClue")}</span> : null}
        </div>

        <h2 className="center">
          {amGuesser ? t("guessTitle") : t("watchingTitle", { team: round.team_name })}
        </h2>

        <div className="cluebox">
          <div className="lbl">{t("clueLabel")}</div>
          <div className="txt">{round.clue}</div>
        </div>

        <Poles round={round} />
        <div className="gaugewrap">
          <Gauge target={amClueGiver ? targetForMe : null} marker={amGuesser ? slider : null} />
        </div>

        {amGuesser ? (
          <>
            <p className="sub center" style={{ marginTop: 14 }}>
              {t("guessSub")}
            </p>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={slider}
              className="slider"
              onChange={(e) => setSlider(Number(e.target.value))}
            />
            <div className="big-target">
              {t("marker")}: {slider}%
            </div>
            {myGuess ? <div className="ok">{t("guessLocked", { value: slider })}</div> : null}
            <div className="actions">
              <button
                className="btn wide"
                disabled={busy}
                onClick={() => void run("guess", { value: slider })}
              >
                {myGuess ? t("changeGuess") : t("submitGuess")}
              </button>
            </div>
          </>
        ) : null}

        {!amOnActiveTeam && room.bets_enabled ? (
          <>
            <h3 className="center" style={{ marginTop: 20 }}>
              {t("betTitle")}
            </h3>
            <p className="sub center">{t("betSub")}</p>
            <div className="betrow">
              <button
                className={`btn ${myBet?.side === "left" ? "" : "ghost"}`}
                disabled={busy}
                onClick={() => void run("bet", { side: "left" })}
              >
                {t("betLeft")}
              </button>
              <button
                className={`btn ${myBet?.side === "right" ? "" : "ghost"}`}
                disabled={busy}
                onClick={() => void run("bet", { side: "right" })}
              >
                {t("betRight")}
              </button>
            </div>
            {myBet ? (
              <div className="ok">
                {t("betPlaced", { side: t(myBet.side === "left" ? "sideLeft" : "sideRight") })}
              </div>
            ) : null}
          </>
        ) : null}

        {expectedGuessers.length === 0 ? (
          <div className="err">{t("noGuessers")}</div>
        ) : (
          <Progress
            expected={expectedGuessers}
            submittedIds={guesses.map((g) => g.player_id)}
            label={t("submittedCount", {
              done: guesses.length,
              total: expectedGuessers.length,
            })}
          />
        )}

        {me.is_host || amClueGiver ? (
          <div className="actions">
            <button className="btn ghost wide" disabled={busy} onClick={() => void run("reveal")}>
              {t("revealNow")}
            </button>
          </div>
        ) : (
          <p className="waiting">
            <span className="spin" />
            {t("waitingOthers")}
          </p>
        )}
      </section>
    );
  }

  // =================================================================
  // REVEAL PHASE
  // =================================================================
  const pts = round.points ?? 0;
  const msgKey =
    round.revealed_target !== null && round.marker !== null
      ? scoreFor(round.revealed_target, round.marker).key
      : "msgFar";

  const myTeamBetPoints = detail?.team_points?.[me.team_id ?? ""] ?? 0;

  return (
    <section className="card">
      <div className="turninfo">
        <span className="pill">{pill}</span>
        <span className="pill gold">{t("revealTitle")}</span>
      </div>

      <div className="cluebox">
        <div className="lbl">{t("clueLabel")}</div>
        <div className="txt">{round.clue}</div>
      </div>

      <Poles round={round} />
      <div className="gaugewrap">
        <Gauge target={round.revealed_target} marker={round.marker} ghosts={ghosts} />
      </div>

      <div className="reveal-points">
        {pts > 0 ? "+" : ""}
        {pts}
      </div>
      <div className="reveal-msg">
        {t(msgKey)} · {t("secretWas")} {round.revealed_target}% · {t("markerWas")} {round.marker}%
      </div>

      {detail && detail.guesses.length > 0 ? (
        <>
          <h3 className="center" style={{ marginTop: 22 }}>
            {t("individualGuesses")}
          </h3>
          <div className="chiplist" style={{ justifyContent: "center" }}>
            {detail.guesses.map((g) => (
              <span key={g.player_id} className="chip">
                {g.player_name}: <b>{g.value}%</b>{" "}
                <span className="mini">
                  ({lang === "ua" ? "похибка" : "off by"} {Math.round(g.distance)})
                </span>
              </span>
            ))}
          </div>
        </>
      ) : null}

      {detail && detail.bets.length > 0 ? (
        <>
          <h3 className="center" style={{ marginTop: 18 }}>
            {t("betResults")}
          </h3>
          <div className="chiplist" style={{ justifyContent: "center" }}>
            {detail.bets.map((b) => (
              <span key={b.player_id} className={`chip${b.correct ? " done" : ""}`}>
                {b.player_name} · {t(b.side === "left" ? "sideLeft" : "sideRight")} ·{" "}
                {b.correct ? `✓ ${t("betRight2")}` : `✕ ${t("betWrong")}`}
              </span>
            ))}
          </div>
          {!amOnActiveTeam && myTeamBetPoints > 0 ? (
            <div className="ok" style={{ textAlign: "center" }}>
              +{myTeamBetPoints} {t("pts")}
            </div>
          ) : null}
        </>
      ) : null}

      {me.is_host || amClueGiver ? (
        <div className="actions">
          <button className="btn wide" disabled={busy} onClick={() => void run("next")}>
            {t("nextBtn")}
          </button>
        </div>
      ) : (
        <p className="waiting">
          <span className="spin" />
          {t("waitNext")}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------

function ClueComposer({
  round,
  target,
  pill,
  run,
  busy,
}: {
  round: Round;
  target: number | null;
  pill: string;
  run: RunAction;
  busy: boolean;
}) {
  const { t } = useLang();
  const [clue, setClue] = useState("");
  const [warn, setWarn] = useState<string | null>(null);

  useEffect(() => {
    setClue("");
    setWarn(null);
  }, [round.id]);

  async function send() {
    const text = clue.trim();
    if (!text) return;
    if (/\d/.test(text)) {
      setWarn(t("noNumbers"));
      return;
    }
    setWarn(null);
    await run("clue", { clue: text });
  }

  return (
    <section className="card">
      <div className="turninfo">
        <span className="pill gold">{pill}</span>
        <span className="pill">{t("youGiveClue")}</span>
      </div>
      <h2 className="center">{t("clueTitle")}</h2>
      <p className="sub center">{t("clueSub")}</p>

      <Poles round={round} />
      <div className="gaugewrap">
        <Gauge target={target} />
      </div>

      <div className="secret">
        <div>{t("targetIs")}</div>
        <b>{target === null ? "…" : `${target}%`}</b>
      </div>

      <label className="fl" htmlFor="clue">
        {t("clueLabel")}
      </label>
      <input
        id="clue"
        type="text"
        value={clue}
        maxLength={120}
        placeholder={t("cluePlaceholder")}
        onChange={(e) => setClue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void send();
        }}
      />
      {warn ? <div className="err">{warn}</div> : null}

      <div className="actions">
        <button className="btn wide" disabled={busy || clue.trim().length === 0} onClick={send}>
          {t("sendClue")}
        </button>
      </div>
    </section>
  );
}

function Progress({
  expected,
  submittedIds,
  label,
}: {
  expected: Player[];
  submittedIds: string[];
  label: string;
}) {
  if (expected.length === 0) return null;
  const done = new Set(submittedIds);
  return (
    <>
      <p className="waiting" style={{ marginBottom: 6 }}>
        {label}
      </p>
      <div className="chiplist" style={{ justifyContent: "center" }}>
        {expected.map((p) => (
          <span key={p.id} className={`chip${done.has(p.id) ? " done" : ""}`}>
            {done.has(p.id) ? "✓ " : "… "}
            {p.name}
          </span>
        ))}
      </div>
    </>
  );
}
