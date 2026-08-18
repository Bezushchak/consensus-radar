"use client";

import { scaleLabels } from "@/lib/scales";
import { useLang } from "./LangProvider";
import type { Round } from "@/lib/types";

/** The two ends of the current scale, in the reader's own language. */
export default function Poles({ round, withHeading = true }: { round: Round; withHeading?: boolean }) {
  const { lang } = useLang();
  const { left, right } = scaleLabels(round.scale_key, lang, {
    left: round.scale_left,
    right: round.scale_right,
  });

  return (
    <>
      {withHeading ? (
        <div className="scaleLabel">
          {left} &nbsp;↔&nbsp; {right}
        </div>
      ) : null}
      <div className="poles">
        <div className="pole l">{left}</div>
        <div className="pole r">{right}</div>
      </div>
    </>
  );
}
