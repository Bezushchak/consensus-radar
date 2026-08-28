"use client";

import type { LbEntry } from "./types";

/**
 * The top three, on steps.
 *
 * Why a podium and not just the first three rows of the table: a table is a
 * list of equals, and the whole point of a leaderboard is that the top of it is
 * not. The three heights, the medals and the one big number per step say
 * "these are the ones that mattered" before anybody reads a word — which is the
 * job the first screen of a leaderboard has.
 *
 * Second-first-third, left to right, the way an actual podium stands. It reads
 * as a shape rather than as a sequence, so the eye lands on the middle. With
 * fewer than three entries the order stays plain first-then-second, because a
 * two-item podium arranged 2-1 leaves a hole where third place should be and
 * looks broken rather than sparse.
 */

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Two letters for the disc. One word gives its first two letters, two words
 * give their initials — the usual avatar convention, and it survives Cyrillic
 * because it never assumes a Latin alphabet.
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase();
  return (parts[0][0] + parts[1][0]).toLocaleUpperCase();
}

export interface PodiumProps {
  entries: LbEntry[];
  /**
   * Omit to render the steps as plain blocks.
   *
   * The end-of-game screen wants the same picture with nothing behind it —
   * everything a team's step could open is already on that page — and a step
   * that looks pressable but does nothing is worse than one that does not.
   */
  onPick?: (entry: LbEntry) => void;
  /** Shown under the steps: "tap for the full stats". */
  hint?: string;
  youLabel: string;
  /** Prefix for the click labels, so two podiums do not share a metric. */
  evPrefix?: string;
}

export default function Podium({
  entries,
  onPick,
  hint,
  youLabel,
  evPrefix = "lb-podium",
}: PodiumProps) {
  const top = entries.slice(0, 3);
  if (top.length === 0) return null;

  const order = top.length === 3 ? [top[1], top[0], top[2]] : top;

  return (
    <>
      {/* The count is on the container rather than inferred with :has(), so a
          board with one or two finished games centres its steps instead of
          leaving a gap where the missing ones would stand. */}
      <div className={`podium n${top.length}`}>
        {order.map((e) => {
          const inner = (
            <>
              <span className="medal" aria-hidden="true">
                {MEDALS[e.rank - 1] ?? e.rank}
              </span>
              <span className="face" aria-hidden="true">
                {e.face ?? (e.crown ? "👑" : initials(e.title))}
              </span>
              <span className="who">{e.title}</span>
              {e.subtitle ? <span className="podsub">{e.subtitle}</span> : null}
              {e.mine ? <span className="podyou">{youLabel}</span> : null}
              <span className="step">
                <b>{e.headline}</b>
                <span className="steplabel">{e.headlineLabel}</span>
              </span>
            </>
          );
          const cls = `pod p${e.rank}${e.mine ? " mine" : ""}`;

          return onPick ? (
            <button
              key={e.key}
              type="button"
              className={cls}
              onClick={() => onPick(e)}
              data-ev={`${evPrefix}-${e.rank}`}
              aria-label={`${e.rank}. ${e.title} — ${e.headline} ${e.headlineLabel}`}
            >
              {inner}
            </button>
          ) : (
            <div key={e.key} className={`${cls} flat`}>
              {inner}
            </div>
          );
        })}
      </div>
      {hint ? <p className="sub center podhint">{hint}</p> : null}
    </>
  );
}
