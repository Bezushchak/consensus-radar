"use client";

import Gauge from "@/components/Gauge";
import { useLang } from "@/components/LangProvider";
import {
  DEMO,
  DEMO_TEAMS,
  demoPlayer,
  demoTeam,
  pick,
  type DemoState,
  type TextField,
} from "@/lib/demo/script";
import { MAX_CLUE_WORDS, clueErrorKey, validateClue } from "@/lib/game/clue";
import { scoreFor } from "@/lib/game/engine";

/**
 * The screens the scripted demo plays through — mock-ups of the real ones.
 *
 * Deliberately not the real components. `PlayView` and `HomePage` need a live
 * `RoomState`, an identity, a `run` that talks to the API and tracking calls
 * that would pollute the funnel; faking all of that to drive an animation
 * would be a second implementation of the game with none of its safety.
 *
 * What keeps this honest instead is the CSS. Every class here is the app's own
 * global class, so the mock cannot quietly diverge in looks, and the pieces
 * that are pure — `Gauge`, `validateClue`, `scoreFor` — are the real ones, so
 * the dial, the live word count, the rejection message and the score shown are
 * computed rather than drawn.
 *
 * Nothing in here is interactive: the stage sets `pointer-events: none` and
 * marks itself `aria-hidden`, and the page carries the same rules in prose
 * underneath for anyone who is not watching an animation.
 */

type Mark = (key: string) => (el: HTMLElement | null) => void;

export default function DemoScreens({ s, mark }: { s: DemoState; mark: Mark }) {
  const { t, lang } = useLang();

  const poleL = pick(DEMO.poles.l, lang);
  const poleR = pick(DEMO.poles.r, lang);

  const btn = (key: string, extra = "") =>
    `btn${extra ? ` ${extra}` : ""}${s.pressed === key ? " pressed" : ""}`;

  // Dana is the one who moves between teams, so her team comes from the demo
  // state; everybody else sits where the cast list puts them.
  const teamOf = (id: string) => (id === "dana" ? (s.team ?? "noise") : demoPlayer(id).team);

  // ---------------------------------------------------------------- home
  if (s.screen === "home") {
    return (
      <>
        <section className="card">
          <h2>{t("homeTitle")}</h2>
          <p className="sub">{t("homeSub")}</p>

          <label className="fl">{t("yourName")}</label>
          <Field id="name" s={s} mark={mark} placeholder={t("namePlaceholder")} />
        </section>

        <section className="card">
          <h2>{t("joinTitle")}</h2>
          <p className="sub">
            {lang === "ua"
              ? "Попросіть у хоста код із чотирьох символів."
              : "Ask the host for the four-character code."}
          </p>

          <label className="fl">{t("codeLabel")}</label>
          <Field id="code" s={s} mark={mark} className="code" placeholder="XXXX" />

          <div className="actions">
            <button
              ref={mark("join-by-code")}
              className={btn("join-by-code", "wide")}
              tabIndex={-1}
            >
              {t("joinBtn")}
            </button>
          </div>

          <p className="stepnote">{t("demoHostNote")}</p>
        </section>
      </>
    );
  }

  // ---------------------------------------------------------------- lobby
  if (s.screen === "lobby") {
    const host = s.who === "max";
    return (
      <>
        <section className="card">
          <div className="roomcode">
            <div className="code">{DEMO.code}</div>
            <div className="hint">{t("shareHint")}</div>
          </div>
        </section>

        <section className="card">
          <h3>{t("pickTeam")}</h3>
          <div className="teampick">
            {DEMO_TEAMS.map((tm) => {
              const key = `team-${tm.id}`;
              const here = s.joined.filter((id) => teamOf(id) === tm.id).length;
              const mine = teamOf(s.who) === tm.id;
              return (
                <button
                  key={tm.id}
                  ref={mark(key)}
                  tabIndex={-1}
                  className={`${mine ? "sel" : ""}${s.pressed === key ? " pressed" : ""}`}
                >
                  <span className="dot" style={{ background: tm.color }} />
                  {pick(tm.name, lang)}
                  <span className="mini">({here})</span>
                </button>
              );
            })}
          </div>

          <h3 style={{ marginTop: 22 }}>
            {t("playersIn")} · {s.joined.length}
          </h3>
          <div className="chiplist">
            {s.joined.map((id) => {
              const p = demoPlayer(id);
              const tm = demoTeam(teamOf(id));
              return (
                <span key={id} className={`chip${id === s.who ? " me" : ""}`}>
                  <span className="dot" style={{ background: tm?.color ?? "#46508a" }} />
                  {p.name}
                  {p.host ? <span className="mini">· {t("hostBadge")}</span> : null}
                </span>
              );
            })}
          </div>
        </section>

        {host ? (
          <section className="card">
            <h3>{t("settingsTitle")}</h3>
            <p className="sub" style={{ margin: "6px 0 0" }}>
              {t("targetLabel")}: <b>{DEMO.goal}</b> · {t("demoBetsOn")}
            </p>
            <div className="actions">
              <button ref={mark("start-game")} className={btn("start-game", "wide")} tabIndex={-1}>
                {t("startBtn")}
              </button>
            </div>
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

  // ---------------------------------------------------------------- clue
  if (s.screen === "clue") {
    // The real validator, on the demo's typing. The rejection the script shows
    // off is therefore the app's own rule rather than a caption claiming it.
    const check = validateClue(s.clue);
    const problem = check.ok || check.reason === "empty" ? null : clueErrorKey(check);
    return (
      <section className="card">
        <div className="turninfo">
          <span className="pill gold">
            {t("round")} 1 · {pick(DEMO_TEAMS[0].name, lang)}
          </span>
          <span className="pill">{t("youGiveClue")}</span>
        </div>
        <h2 className="center">{t("clueTitle")}</h2>
        <p className="sub center">{t("clueSub")}</p>

        <Poles l={poleL} r={poleR} />
        <div className="gaugewrap">
          <Gauge target={DEMO.target} />
        </div>

        <div className="secret">
          <div>{t("targetIs")}</div>
          <b>{DEMO.target}%</b>
        </div>

        <label className="fl">
          {t("clueLabel")}
          <span className={check.words > MAX_CLUE_WORDS ? "count over" : "count"}>
            {t("clueWordCount", { count: check.words, max: MAX_CLUE_WORDS })}
          </span>
        </label>
        <Field id="clue" s={s} mark={mark} placeholder={t("cluePlaceholder")} />
        <p className="sub" style={{ margin: "8px 0 0" }}>
          {t("clueRules", { max: MAX_CLUE_WORDS })}
        </p>
        {problem ? <div className="err">{t(problem.key, problem.vars)}</div> : null}

        <div className="actions">
          <button
            ref={mark("send-clue")}
            className={btn("send-clue", "wide")}
            disabled={!check.ok}
            tabIndex={-1}
          >
            {t("sendClue")}
          </button>
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------- guessing
  if (s.screen === "guess") {
    return (
      <section className="card">
        <div className="turninfo">
          <span className="pill">
            {t("round")} 1 · {pick(DEMO_TEAMS[0].name, lang)}
          </span>
          <span className="pill good">{t("guessTitle")}</span>
        </div>

        <h2 className="center">{t("guessTitle")}</h2>

        <div className="cluebox">
          <div className="lbl">{t("clueLabel")}</div>
          <div className="txt">{pick(DEMO.clue, lang)}</div>
        </div>

        <Poles l={poleL} r={poleR} />
        <div className="gaugewrap">
          <Gauge marker={s.slider} />
        </div>

        <p className="sub center" style={{ marginTop: 14 }}>
          {t("guessSub")}
        </p>
        <input
          ref={mark("slider")}
          type="range"
          min={0}
          max={100}
          step={1}
          value={s.slider}
          onChange={() => undefined}
          className="slider"
          tabIndex={-1}
        />
        <div className="big-target">
          {t("marker")}: {s.slider}%
        </div>
        {s.locked ? <div className="ok">{t("guessLocked", { value: s.slider })}</div> : null}
        <div className="actions">
          <button
            ref={mark("submit-guess")}
            className={btn("submit-guess", "wide")}
            tabIndex={-1}
          >
            {s.locked ? t("changeGuess") : t("submitGuess")}
          </button>
        </div>

        <Progress s={s} />
      </section>
    );
  }

  // ---------------------------------------------------------------- watching
  if (s.screen === "watch") {
    return (
      <section className="card">
        <div className="turninfo">
          <span className="pill">
            {t("round")} 1 · {pick(DEMO_TEAMS[0].name, lang)}
          </span>
        </div>

        <h2 className="center">
          {t("watchingTitle", { team: pick(DEMO_TEAMS[0].name, lang) })}
        </h2>

        <div className="cluebox">
          <div className="lbl">{t("clueLabel")}</div>
          <div className="txt">{pick(DEMO.clue, lang)}</div>
        </div>

        <Poles l={poleL} r={poleR} />
        <div className="gaugewrap">
          <Gauge ghosts={s.markers.map((m) => ({ value: m.value, label: m.name }))} />
        </div>

        <p className="sub center">{t("watchMarkers")}</p>

        <h3 className="center" style={{ marginTop: 20 }}>
          {t("betTitle")}
        </h3>
        <p className="sub center">{t("betSub")}</p>
        <div className="betrow">
          <button
            ref={mark("bet-left")}
            className={btn("bet-left", s.bet === "left" ? "" : "ghost")}
            tabIndex={-1}
          >
            {t("betLeft")}
          </button>
          <button
            ref={mark("bet-right")}
            className={btn("bet-right", s.bet === "right" ? "" : "ghost")}
            tabIndex={-1}
          >
            {t("betRight")}
          </button>
        </div>
        {s.bet ? (
          <div className="ok">
            {t("betPlaced", { side: t(s.bet === "left" ? "sideLeft" : "sideRight") })}
          </div>
        ) : null}

        <Progress s={s} />
      </section>
    );
  }

  // ---------------------------------------------------------------- reveal
  const score = scoreFor(DEMO.target, DEMO.marker);
  return (
    <section className="card">
      <div className="turninfo">
        <span className="pill">
          {t("round")} 1 · {pick(DEMO_TEAMS[0].name, lang)}
        </span>
        <span className="pill gold">{t("revealTitle")}</span>
      </div>

      <div className="cluebox">
        <div className="lbl">{t("clueLabel")}</div>
        <div className="txt">{pick(DEMO.clue, lang)}</div>
      </div>

      <Poles l={poleL} r={poleR} />
      <div className="gaugewrap">
        <Gauge
          target={DEMO.target}
          marker={DEMO.marker}
          ghosts={DEMO.guesses.map((g) => ({ value: g.value, label: g.name }))}
        />
      </div>

      <div className="reveal-points">+{score.pts}</div>
      <div className="reveal-msg">
        {t(score.key)} · {t("secretWas")} {DEMO.target}% · {t("markerWas")} {DEMO.marker}%
      </div>

      <h3 className="center" style={{ marginTop: 22 }}>
        {t("individualGuesses")}
      </h3>
      <div className="chiplist" style={{ justifyContent: "center" }}>
        {DEMO.guesses.map((g) => (
          <span key={g.id} className="chip">
            {g.name}: <b>{g.value}%</b>{" "}
            <span className="mini">
              ({lang === "ua" ? "похибка" : "off by"} {Math.abs(DEMO.target - g.value)})
            </span>
          </span>
        ))}
      </div>

      <h3 className="center" style={{ marginTop: 18 }}>
        {t("betResults")}
      </h3>
      <div className="chiplist" style={{ justifyContent: "center" }}>
        {DEMO.bets.map((b) => (
          <span key={b.id} className={`chip${b.correct ? " done" : ""}`}>
            {b.name} · {t(b.side === "left" ? "sideLeft" : "sideRight")} ·{" "}
            {b.correct ? `✓ ${t("betRight2")}` : `✕ ${t("betWrong")}`}
          </span>
        ))}
      </div>

      <div className="actions">
        <button ref={mark("next-round")} className={btn("next-round", "wide")} tabIndex={-1}>
          {t("nextBtn")}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------

/**
 * A text box being typed into by nobody. A `div` rather than an `input`: the
 * value changes on a timer with no user behind it, which a controlled input
 * would either warn about or have to be told to ignore, and a div can carry a
 * caret that blinks where the script is typing.
 */
function Field({
  id,
  s,
  mark,
  placeholder,
  className,
}: {
  id: TextField;
  s: DemoState;
  mark: Mark;
  placeholder: string;
  className?: string;
}) {
  const value = id === "code" ? s.code : id === "name" ? s.name : s.clue;
  const focused = s.focus === id;
  return (
    <div
      ref={mark(id)}
      className={`fakeinput${className ? ` ${className}` : ""}${focused ? " focus" : ""}`}
    >
      {value === "" && !focused ? <span className="ph">{placeholder}</span> : value}
      {focused ? <i className="caret" /> : null}
    </div>
  );
}

function Poles({ l, r }: { l: string; r: string }) {
  return (
    <>
      <div className="scaleLabel">
        {l} &nbsp;↔&nbsp; {r}
      </div>
      <div className="poles">
        <div className="pole l">{l}</div>
        <div className="pole r">{r}</div>
      </div>
    </>
  );
}

/**
 * Who has locked a marker in. The values appear next to the names only on the
 * watching team's phone, which is exactly the rule the real game enforces from
 * the server.
 */
function Progress({ s }: { s: DemoState }) {
  const { t } = useLang();
  const shown = s.screen === "watch" ? s.markers : [];
  return (
    <>
      <p className="waiting" style={{ marginBottom: 6 }}>
        {t("submittedCount", { done: s.done.length, total: DEMO.guesses.length })}
      </p>
      <div className="chiplist" style={{ justifyContent: "center" }}>
        {DEMO.guesses.map((g) => {
          const answered = s.done.includes(g.id);
          const value = shown.find((m) => m.id === g.id)?.value;
          return (
            <span key={g.id} className={`chip${answered ? " done" : ""}`}>
              {answered ? "✓ " : "… "}
              {g.name}
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
