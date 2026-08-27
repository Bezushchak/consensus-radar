"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Gauge from "@/components/Gauge";
import { useLang } from "@/components/LangProvider";
import Poles from "@/components/Poles";
import * as api from "@/lib/client/api";
import { track } from "@/lib/client/track";
import { MAX_CLUE_WORDS, clueErrorKey, validateClue, type ClueReason } from "@/lib/game/clue";
import { CLUE_MAX_LEN, clueGiverIsAway, scoreFor } from "@/lib/game/engine";
import type { RunAction } from "./RoomClient";
import type { Identity, LiveGuess, Player, RoomState, Round } from "@/lib/types";

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

  // ---- the active team's markers: only ever fetched by a watching team ----
  //
  // The room state carries who has answered but not what they answered, so the
  // values come from their own endpoint, which refuses the team that is
  // guessing. Refetched on any change to the guess set — including a re-submit,
  // which leaves the row count alone and only moves `submitted_at`.
  const amWatcher = round.phase === "guess" && !amOnActiveTeam;
  const guessSig = useMemo(
    () =>
      guesses
        .map((g) => `${g.player_id}:${g.submitted_at}`)
        .sort()
        .join("|"),
    [guesses]
  );
  const submitted = guesses.length;
  const [watched, setWatched] = useState<LiveGuess[]>([]);
  useEffect(() => {
    if (!amWatcher) {
      setWatched([]);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;

    const load = () => {
      api
        .fetchLiveGuesses(code, identity)
        .then((res) => {
          // A response for the previous round would draw needles belonging to
          // a dial nobody is looking at any more.
          if (cancelled || res.roundId !== round.id) return;
          setWatched(res.guesses);
          // A guess row is written before its value is, so a fetch that lands
          // between the two sees a guesser with no marker. Ask again — twice
          // at most, so a value that is genuinely missing cannot turn into a
          // polling loop.
          if (res.guesses.length < submitted && ++tries <= 2) {
            timer = setTimeout(load, 500);
          }
        })
        .catch(() => {
          if (!cancelled) setWatched([]);
        });
    };
    load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amWatcher, code, identity, round.id, guessSig, submitted]);

  const watchedGhosts = useMemo(
    () => watched.map((g) => ({ value: g.value, label: g.player_name })),
    [watched]
  );
  const watchedValues = useMemo(() => {
    const byPlayer: Record<string, number> = {};
    for (const g of watched) byPlayer[g.player_id] = g.value;
    return byPlayer;
  }, [watched]);

  const [slider, setSlider] = useState(50);
  useEffect(() => setSlider(50), [round.id]);

  // Counted from every device that sees the reveal, so the funnel measures
  // people who got a result rather than rounds that produced one.
  useEffect(() => {
    if (round.phase !== "reveal") return;
    track("round_revealed", {
      round: round.round_no,
      points: round.points ?? 0,
      distance: round.distance ?? -1,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.id, round.phase]);

  const pill = `${t("round")} ${round.round_no} · ${round.team_name}`;

  // The same rule the server enforces in `skipRound`, so the button is only
  // ever offered to someone it will actually work for. Read at render rather
  // than on a timer: every tab refetches the room at least every 15 seconds,
  // which is close enough for a two-minute threshold.
  const maySkip =
    me.is_host ||
    amClueGiver ||
    (round.phase === "clue" && clueGiverIsAway(players, round.clue_giver_id, Date.now()));

  async function skip() {
    if (!window.confirm(t("skipConfirm"))) return;
    const res = await run("skip");
    // Only the device that actually did the skipping counts. Two taps, or the
    // host and the clue-giver pressing together, delete one row between them —
    // and the loser gets the same fresh state back as the winner, so a plain
    // "the call succeeded" check would count one rescue twice and quietly
    // inflate `round_skipped ÷ round_revealed`. A skip always replaces the
    // round, so a different id is the proof that this press is the one.
    if (res && res.round?.id !== round.id) {
      track("round_skipped", { round: round.round_no, phase: round.phase });
    }
  }

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
          onSkip={skip}
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

        {/* The dead end, and the way out of it. Until a clue exists the
            guessers have no control at all, so once the clue-giver has gone
            quiet the escape hatch has to be on their screen — not only on the
            host's, who may well be the person who left. */}
        {maySkip ? (
          <>
            <p className="sub center" style={{ marginTop: 4 }}>
              {t("skipHint")}
            </p>
            <div className="actions">
              <button
                className="btn ghost wide"
                data-ev="skip-round"
                disabled={busy}
                onClick={() => void skip()}
              >
                {t("skipRound")}
              </button>
            </div>
          </>
        ) : null}
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
          <Gauge
            target={amClueGiver ? targetForMe : null}
            marker={amGuesser ? slider : null}
            ghosts={watchedGhosts}
          />
        </div>

        {amWatcher ? <p className="sub center">{t("watchMarkers")}</p> : null}

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
                data-ev={myGuess ? "change-guess" : "submit-guess"}
                disabled={busy}
                onClick={async () => {
                  const res = await run("guess", { value: slider });
                  // The step that separates "was in the room" from "played".
                  if (res) track("guess_locked", { round: round.round_no, changed: Boolean(myGuess) });
                }}
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
                data-ev="bet-left"
                disabled={busy}
                onClick={async () => {
                  const res = await run("bet", { side: "left" });
                  // `markers` is how much of the other team's answer was on
                  // screen when the call was made — the number that says
                  // whether showing the markers changed the bet or just
                  // decorated it.
                  if (res)
                    track("bet_placed", {
                      side: "left",
                      round: round.round_no,
                      markers: watched.length,
                    });
                }}
              >
                {t("betLeft")}
              </button>
              <button
                className={`btn ${myBet?.side === "right" ? "" : "ghost"}`}
                data-ev="bet-right"
                disabled={busy}
                onClick={async () => {
                  const res = await run("bet", { side: "right" });
                  if (res)
                    track("bet_placed", {
                      side: "right",
                      round: round.round_no,
                      markers: watched.length,
                    });
                }}
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
            values={watchedValues}
          />
        )}

        {me.is_host || amClueGiver ? (
          <div className="actions">
            <button
              className="btn ghost wide"
              data-ev="reveal-now"
              disabled={busy}
              onClick={() => void run("reveal")}
            >
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
          <button
            className="btn wide"
            data-ev="next-round"
            disabled={busy}
            onClick={() => void run("next")}
          >
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
  onSkip,
}: {
  round: Round;
  target: number | null;
  pill: string;
  run: RunAction;
  busy: boolean;
  /** Give this scale up. Their own turn, so always theirs to abandon. */
  onSkip: () => void | Promise<void>;
}) {
  const { t } = useLang();
  const [clue, setClue] = useState("");

  useEffect(() => {
    setClue("");
  }, [round.id]);

  // The same validator the server runs, re-run on every keystroke. Live and
  // not on submit, because a player told at the seventh word is editing a
  // phrase while a player told after pressing Send is starting over.
  const check = useMemo(() => validateClue(clue), [clue]);

  // An empty box is not a mistake yet, so that one reason stays silent.
  const problem = check.ok || check.reason === "empty" ? null : clueErrorKey(check);

  // Remember the first rule that got in the way, and report it with the clue
  // that eventually goes out. That is the number that says whether the rules
  // are calibrated or merely annoying, and it costs no extra events.
  const blocked = useRef<ClueReason | null>(null);
  useEffect(() => {
    blocked.current = null;
  }, [round.id]);
  useEffect(() => {
    if (!check.ok && check.reason !== "empty" && !blocked.current) {
      blocked.current = check.reason;
    }
  }, [check]);

  async function send() {
    if (!check.ok) return;
    const res = await run("clue", { clue: check.clue });
    if (res) {
      track("clue_sent", {
        round: round.round_no,
        words: check.words,
        ...(blocked.current ? { blocked: blocked.current } : {}),
      });
    }
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
        <span className={check.words > MAX_CLUE_WORDS ? "count over" : "count"}>
          {t("clueWordCount", { count: check.words, max: MAX_CLUE_WORDS })}
        </span>
      </label>
      <input
        id="clue"
        type="text"
        value={clue}
        maxLength={CLUE_MAX_LEN}
        placeholder={t("cluePlaceholder")}
        onChange={(e) => setClue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void send();
        }}
      />
      <p className="sub" style={{ margin: "8px 0 0" }}>
        {t("clueRules", { max: MAX_CLUE_WORDS })}
      </p>
      {problem ? <div className="err">{t(problem.key, problem.vars)}</div> : null}

      <div className="actions">
        <button
          className="btn wide"
          data-ev="send-clue"
          disabled={busy || !check.ok}
          onClick={send}
        >
          {t("sendClue")}
        </button>
        {/* A scale you cannot clue is worth less than the next one. Cheaper
            than sending a clue you know is bad, and it costs the team nothing. */}
        <button
          className="btn ghost"
          data-ev="skip-round"
          disabled={busy}
          onClick={() => void onSkip()}
        >
          {t("skipRound")}
        </button>
      </div>
    </section>
  );
}

function Progress({
  expected,
  submittedIds,
  label,
  /** Marker per player — passed only for viewers allowed to see them. */
  values,
}: {
  expected: Player[];
  submittedIds: string[];
  label: string;
  values?: Record<string, number>;
}) {
  if (expected.length === 0) return null;
  const done = new Set(submittedIds);
  return (
    <>
      <p className="waiting" style={{ marginBottom: 6 }}>
        {label}
      </p>
      <div className="chiplist" style={{ justifyContent: "center" }}>
        {expected.map((p) => {
          const answered = done.has(p.id);
          const value = values?.[p.id];
          return (
            <span key={p.id} className={`chip${answered ? " done" : ""}`}>
              {answered ? "✓ " : "… "}
              {p.name}
              {value === undefined ? null : (
                <>
                  {" · "}
                  <b>{value}%</b>
                </>
              )}
            </span>
          );
        })}
      </div>
    </>
  );
}
