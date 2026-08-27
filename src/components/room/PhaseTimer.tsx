"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/components/LangProvider";
import { alarmFinal, alarmOver, alarmWarn } from "@/lib/client/alarm";
import {
  formatClock,
  mayExpire,
  secondsLeft,
  timerLevel,
  type TimerLevel,
} from "@/lib/game/engine";

/**
 * Four times a second. Fast enough that the digits never look stuck between
 * seconds, slow enough to be free — and it is the same interval whether the
 * clock reads five minutes or five seconds, because a countdown that changes
 * its own cadence is a countdown you cannot trust.
 */
const TICK_MS = 250;

/**
 * The phase countdown.
 *
 * Reads a deadline the server chose, not a duration this device started, so
 * every phone at the table shows the same number even though their clocks
 * disagree — `skewMs` is the correction, measured on every state read.
 *
 * It also does the expiring. Any device may call it: the countdown is public,
 * everyone watches the same instant arrive, and the alternative — only the
 * player on the clock, or only the host — puts the escape route in the hands of
 * whoever is most likely to have walked away. Every device fires within a
 * second of the others and the server settles it with an atomic claim, so the
 * duplicates cost one refused request each and nothing else.
 *
 * Nothing renders at all when the room has no clock, which is the default.
 */
export default function PhaseTimer({
  deadline,
  total,
  skewMs,
  label,
  onClock,
  onExpire,
}: {
  /** The instant the phase ends, as the server wrote it. Null = no clock. */
  deadline: string | null;
  /** The full length of this phase, in seconds — the bar needs a denominator. */
  total: number;
  /** Server clock minus this device's clock, in milliseconds. */
  skewMs: number;
  label: string;
  /**
   * Whether this device is the one that still has to act. Only it makes a
   * noise: a beep on every phone in the room turns a warning into a stampede,
   * and the four people who have already moved cannot do anything about it.
   */
  onClock: boolean;
  onExpire: () => void;
}) {
  const { t } = useLang();
  const [left, setLeft] = useState<number | null>(null);

  // Held in a ref so a caller that rebuilds the callback every render — which
  // is every caller — does not restart the interval and reset the tick.
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  }, [onExpire]);

  // Which deadline this device has already reported, so it reports each one
  // once. Keyed on the instant itself rather than on the round or the phase:
  // the deadline is rewritten whenever either changes, so it is the finest key
  // available and the cheapest to compare.
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!deadline) {
      setLeft(null);
      return;
    }
    const tick = () => {
      const now = Date.now() + skewMs;
      setLeft(secondsLeft(deadline, now));
      // The grace window is why this lives in the tick rather than in an effect
      // watching the seconds: the clock sits at 0 for a second and a half before
      // the phase may legitimately end, and `left` stops changing during it, so
      // an effect keyed on `left` would never run again and the round would hang
      // at zero.
      if (firedFor.current !== deadline && mayExpire(deadline, now)) {
        firedFor.current = deadline;
        expire.current();
      }
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [deadline, skewMs]);

  const level = timerLevel(left);

  // ---- the noise ----
  //
  // One tone on the way into the warning band, one per second in the last five,
  // and a lower pair when it runs out. The bands come from the engine so the
  // colour and the sound can never disagree about what "nearly out" means.
  const was = useRef<TimerLevel>("none");
  const beeped = useRef<number | null>(null);
  useEffect(() => {
    const previous = was.current;
    was.current = level;
    if (!onClock) {
      beeped.current = null;
      return;
    }
    if (level === "warn") {
      if (previous !== "warn") alarmWarn();
    } else if (level === "final") {
      if (left !== null && beeped.current !== left) {
        beeped.current = left;
        alarmFinal();
      }
    } else if (level === "over") {
      if (previous !== "over") alarmOver();
    }
  }, [level, left, onClock]);

  if (left === null) return null;

  const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;

  return (
    <div className={`timer ${level}`}>
      <div className="timer-head">
        <span className="timer-label">{label}</span>
        {/*
          Deliberately not an aria-live region. A screen reader announcing every
          second would talk over the clue and drown out everything else on the
          screen; the number is readable on demand, and the alarm is the part
          that is meant to interrupt.
        */}
        <span className="timer-clock">{formatClock(left)}</span>
      </div>
      <div className="timer-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      {onClock && (level === "final" || level === "over") ? (
        <div className="timer-hurry">{t("timerHurry")}</div>
      ) : null}
    </div>
  );
}
