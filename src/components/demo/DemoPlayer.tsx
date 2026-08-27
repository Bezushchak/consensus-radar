"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useLang } from "@/components/LangProvider";
import DemoScreens from "./DemoScreens";
import {
  buildScript,
  demoPlayer,
  demoTeam,
  initialState,
  pick,
  type DemoState,
  type Step,
  type TextField,
} from "@/lib/demo/script";

/**
 * Plays the scripted game on /how-to-play: a drawn cursor that moves, presses,
 * types, drags the slider and hands the phone from player to player.
 *
 * Three decisions worth knowing about.
 *
 * The runner is a sequential async loop over the step list rather than a
 * timeline of absolute timestamps. Every step awaits its own duration, so
 * inserting a sentence never shifts everything after it, and "wait for the
 * screen to exist before measuring where its button is" is a line of code
 * instead of a fudge factor.
 *
 * The state lives in a ref with a manual re-render rather than in `useState`.
 * The runner is one long-lived async function, so state read through a closure
 * would be the value captured when the loop started; a ref is always current,
 * which matters for steps like `erase` that begin from whatever is in the box.
 *
 * The cursor is positioned in the stage's own coordinates, measured per step
 * with `getBoundingClientRect`. Nothing is hard-coded, so the demo survives a
 * reflow, a font change or a narrow phone, where a script of pixel positions
 * would drift out of alignment and point at nothing.
 */

interface Cursor {
  x: number;
  y: number;
  /** How long the move to this point should take. Zero while dragging. */
  glide: number;
  down: boolean;
}

export default function DemoPlayer() {
  const { t, lang } = useLang();

  const st = useRef<DemoState>(initialState());
  const cur = useRef<Cursor>({ x: 0, y: 0, glide: 0, down: false });
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const stage = useRef<HTMLDivElement | null>(null);
  const marks = useRef(new Map<string, HTMLElement>());
  const setters = useRef(new Map<string, (el: HTMLElement | null) => void>());

  /**
   * Registers an element the cursor can be sent to. The callback per key is
   * created once and reused, so React attaches each ref a single time instead
   * of detaching and reattaching on every one of the many re-renders a typed
   * sentence causes.
   */
  const mark = useCallback((key: string) => {
    let fn = setters.current.get(key);
    if (!fn) {
      fn = (el: HTMLElement | null) => {
        if (el) marks.current.set(key, el);
        else marks.current.delete(key);
      };
      setters.current.set(key, fn);
    }
    return fn;
  }, []);

  const [runId, setRunId] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // Autoplay, unless the reader has asked the system for less movement — in
  // which case the demo sits on its first screen until they press play.
  useEffect(() => {
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) setPlaying(true);
  }, []);

  useEffect(() => {
    let alive = true;
    const script = buildScript(lang);

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    // Two frames: one for React to commit the new screen, one for the browser
    // to lay it out. Measuring earlier reads the position of the old screen.
    const settle = () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r()))
      );

    const patch = (p: Partial<DemoState>) => {
      st.current = { ...st.current, ...p };
      bump();
    };
    const moveTo = (x: number, y: number, glide: number) => {
      cur.current = { ...cur.current, x, y, glide };
      bump();
    };
    const press = (down: boolean) => {
      cur.current = { ...cur.current, down };
      bump();
    };

    const centerOf = (key: string): { x: number; y: number } | null => {
      const el = marks.current.get(key);
      const box = stage.current;
      if (!el || !box) return null;
      const a = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
    };

    /** Where the slider's thumb sits for a value — the point to grab. */
    const thumbOf = (value: number): { x: number; y: number } | null => {
      const el = marks.current.get("slider");
      const box = stage.current;
      if (!el || !box) return null;
      const a = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const half = 15; // the thumb is 30px wide and cannot leave the track
      const travel = Math.max(0, a.width - half * 2);
      return {
        x: a.left - b.left + half + (travel * value) / 100,
        y: a.top - b.top + a.height / 2,
      };
    };

    const fieldValue = (field: TextField): string =>
      field === "code" ? st.current.code : field === "name" ? st.current.name : st.current.clue;

    // Written out rather than a computed key, so the patch stays a real
    // `Partial<DemoState>` and no cast is needed to satisfy it.
    const setField = (field: TextField, value: string) => {
      if (field === "code") patch({ code: value });
      else if (field === "name") patch({ name: value });
      else patch({ clue: value });
    };

    const perform = async (step: Step): Promise<void> => {
      switch (step.do) {
        case "screen": {
          patch({ ...step.patch, screen: step.screen });
          await settle();
          await sleep(step.hold ?? 500);
          return;
        }
        case "set": {
          patch(step.patch);
          await settle();
          await sleep(step.hold ?? 500);
          return;
        }
        case "say": {
          patch({ caption: step.key, captionVars: step.vars });
          await sleep(step.ms ?? 1400);
          return;
        }
        case "wait": {
          await sleep(step.ms);
          return;
        }
        case "move": {
          const p = centerOf(step.to);
          if (!p) return;
          const ms = step.ms ?? 640;
          moveTo(p.x, p.y, ms);
          await sleep(ms + 60);
          return;
        }
        case "click": {
          await perform({ do: "move", to: step.to, ms: step.ms });
          press(true);
          patch({ pressed: step.to });
          await sleep(160);
          press(false);
          patch({ pressed: null, ...(step.patch ?? {}) });
          await settle();
          await sleep(step.hold ?? 460);
          return;
        }
        case "type": {
          await perform({
            do: "click",
            to: step.into,
            patch: { focus: step.into },
            hold: 160,
          });
          const per = 1000 / (step.cps ?? 12);
          for (let i = 1; i <= step.text.length; i++) {
            if (!alive) return;
            setField(step.into, step.text.slice(0, i));
            await sleep(per);
          }
          await sleep(step.hold ?? 420);
          return;
        }
        case "erase": {
          const text = fieldValue(step.into);
          for (let i = text.length - 1; i >= 0; i--) {
            if (!alive) return;
            setField(step.into, text.slice(0, i));
            await sleep(40);
          }
          await sleep(320);
          return;
        }
        case "drag": {
          const from = st.current.slider;
          const grab = thumbOf(from);
          if (grab) {
            moveTo(grab.x, grab.y, 560);
            await sleep(620);
          }
          press(true);
          // The transition is switched off for the duration: the cursor has to
          // sit exactly on the thumb it is dragging, and an eased move towards
          // each interim value would trail behind it.
          const ticks = 20;
          for (let i = 1; i <= ticks; i++) {
            if (!alive) return;
            const value = Math.round(from + (step.value - from) * (i / ticks));
            patch({ slider: value });
            const p = thumbOf(value);
            if (p) moveTo(p.x, p.y, 0);
            await sleep(32);
          }
          press(false);
          await sleep(step.hold ?? 520);
          return;
        }
      }
    };

    const reset = () => {
      st.current = initialState();
      const box = stage.current;
      cur.current = {
        x: box ? box.clientWidth * 0.66 : 0,
        y: box ? box.clientHeight * 0.94 : 0,
        glide: 0,
        down: false,
      };
      bump();
    };

    void (async () => {
      for (;;) {
        reset();
        await settle();
        for (const step of script) {
          // Paused between steps, not mid-keystroke: stopping halfway through
          // a word would look like a bug rather than a pause.
          while (alive && !playingRef.current) await sleep(120);
          if (!alive) return;
          await perform(step);
          if (!alive) return;
        }
        await sleep(3200);
        if (!alive) return;
      }
    })();

    return () => {
      alive = false;
    };
    // `lang` restarts the run on purpose: the script bakes in the text it types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, lang]);

  const s = st.current;
  const who = demoPlayer(s.who);
  const team = demoTeam(who.team);
  const c = cur.current;

  return (
    <>
      <div className="demo-bar">
        <span className="demo-who">
          <span className="dot" style={{ background: team?.color ?? "#46508a" }} />
          <b>{who.name}</b>
          <span className="mini">
            · {team ? pick(team.name, lang) : ""} · {t(s.role)}
          </span>
        </span>
        {/* Labelled, like every other control in the app: an unlabelled button
            is still counted, but as `(unlabelled)`, which tells nobody
            anything. Here the label answers a real question — whether readers
            watch the demo through or stop it. */}
        <span className="row" style={{ gap: 8 }}>
          <button
            className="btn ghost sm"
            data-ev={playing ? "demo-pause" : "demo-play"}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? `⏸ ${t("demoPause")}` : `▶ ${t("demoPlay")}`}
          </button>
          <button
            className="btn ghost sm"
            data-ev="demo-restart"
            onClick={() => {
              setRunId((n) => n + 1);
              setPlaying(true);
            }}
          >
            ⟲ {t("demoRestart")}
          </button>
        </span>
      </div>

      {/* A performance, not a control surface: nothing in here can be clicked,
          and assistive technology is pointed at the prose below instead. */}
      <div className="demo-stage" ref={stage} aria-hidden="true">
        <div className="demo-screens">
          <DemoScreens s={s} mark={mark} />
        </div>
        <span
          className={`demo-cursor${c.down ? " down" : ""}`}
          style={{
            transform: `translate3d(${c.x}px, ${c.y}px, 0)`,
            transitionDuration: `${c.glide}ms`,
          }}
        >
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path
              d="M5 2 L5 18.5 L9.4 14.2 L12.4 21 L15.4 19.6 L12.4 13 L18.6 13 Z"
              fill="#ffffff"
              stroke="#06121f"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>

      <p className="demo-caption">{t(s.caption, s.captionVars)}</p>
      <p className="stepnote center">{t("demoNotReal")}</p>
    </>
  );
}
