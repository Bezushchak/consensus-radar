"use client";

import { storedLabels } from "@/lib/scales";
import { useLang } from "./LangProvider";
import type { Round } from "@/lib/types";

/**
 * The two ends of the current scale, in the reader's own language.
 *
 * The labels come off the round itself rather than out of a dictionary in the
 * bundle: the catalogue lives in the database now, and a round remembers the
 * exact wording it was dealt.
 */
export default function Poles({ round, withHeading = true }: { round: Round; withHeading?: boolean }) {
  const { lang } = useLang();
  const { left, right } = storedLabels(round, lang);

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
