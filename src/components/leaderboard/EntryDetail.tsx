"use client";

import { useEffect, useRef } from "react";
import Gauge from "@/components/Gauge";
import type { LbEntry } from "./types";

/**
 * One leaderboard entry, opened.
 *
 * A leaderboard table has to fit on a phone, so every board drops columns it
 * actually has — a player's average miss, a round's marker and target, the
 * names on a team. This is where they go: tap a row, get everything that row
 * knows, laid out as figures rather than as a wider table.
 *
 * A sheet over the page rather than a route. The list is the context — you look
 * at one entry to compare it with the ones around it — and navigating away
 * loses the scroll position, the board and the period you had chosen. Escape,
 * the backdrop and the button all close it, and focus moves in on open, so it
 * is dismissible the three ways people expect.
 */

export interface EntryDetailProps {
  entry: LbEntry;
  onClose: () => void;
  closeLabel: string;
  rankLabel: string;
  youLabel: string;
  /** Captions for the dial, when the entry has one. */
  targetLabel: string;
  markerLabel: string;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function EntryDetail({
  entry,
  onClose,
  closeLabel,
  rankLabel,
  youLabel,
  targetLabel,
  markerLabel,
}: EntryDetailProps) {
  const sheet = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll under the sheet on a phone, where a
    // stray drag otherwise moves the list instead of the card.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheet.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const dial = entry.dial ?? null;
  const stats = entry.stats ?? [];

  return (
    <div className="lbmodal" onClick={onClose}>
      <div
        className="lbsheet"
        role="dialog"
        aria-modal="true"
        aria-label={entry.title}
        tabIndex={-1}
        ref={sheet}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="lbhead">
          <span className={`lbrank r${entry.rank}`}>
            {MEDALS[entry.rank - 1] ?? `#${entry.rank}`}
          </span>
          <div className="lbwho">
            <h3>
              {entry.title}
              {entry.crown ? " 👑" : ""}
            </h3>
            {entry.subtitle ? <div className="mini">{entry.subtitle}</div> : null}
            <div className="mini">
              {rankLabel}
              {entry.mine ? ` · ${youLabel}` : ""}
            </div>
          </div>
          <button
            type="button"
            className="lbx"
            onClick={onClose}
            aria-label={closeLabel}
            data-ev="lb-detail-close"
          >
            ✕
          </button>
        </div>

        <div className="lbheadline">
          <b>{entry.headline}</b>
          <span>{entry.headlineLabel}</span>
        </div>

        {dial ? (
          <>
            <div className="gaugewrap">
              <Gauge target={dial.target} marker={dial.marker} />
            </div>
            {entry.poles ? (
              <div className="poles">
                <div className="pole l">{entry.poles.left}</div>
                <div className="pole r">{entry.poles.right}</div>
              </div>
            ) : null}
            <p className="sub center">
              {markerLabel} {dial.marker}% · {targetLabel} {dial.target}%
            </p>
          </>
        ) : null}

        {stats.length > 0 ? (
          <div className="kpis lbstats">
            {stats.map((st) => (
              <div className="kpi" key={st.label}>
                <div className="kpinum">{st.value}</div>
                <div className="kpilabel">{st.label}</div>
                {st.hint ? <div className="mini">{st.hint}</div> : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="actions">
          <button
            type="button"
            className="btn ghost wide"
            onClick={onClose}
            data-ev="lb-detail-done"
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
