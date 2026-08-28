"use client";

/**
 * The radar dial, ported from the original single-file version.
 * p (0..100) maps to an angle of 180deg (left pole) .. 0deg (right pole).
 */

const W = 540;
const H = 282;
const CX = 270;
const CY = 270;
const R = 235;
const RIN = 120;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}

function ang(p: number): number {
  return 180 - p * 1.8;
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a0 - a1) > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

function arcPathRev(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a0 - a1) > 180 ? 1 : 0;
  return `A ${r} ${r} 0 ${large} 0 ${x1} ${y1}`;
}

function band(lo: number, hi: number, colour: string): string {
  const l = Math.max(0, lo);
  const h = Math.min(100, hi);
  if (h <= l) return "";
  const a0 = ang(l);
  const a1 = ang(h);
  const [ox0, oy0] = polar(CX, CY, R, a0);
  const [ox1, oy1] = polar(CX, CY, R, a1);
  const [ix1, iy1] = polar(CX, CY, RIN, a1);
  const [ix0, iy0] = polar(CX, CY, RIN, a0);
  const large = Math.abs(a0 - a1) > 180 ? 1 : 0;
  return (
    `M ${ox0} ${oy0} A ${R} ${R} 0 ${large} 1 ${ox1} ${oy1} ` +
    `L ${ix1} ${iy1} A ${RIN} ${RIN} 0 ${large} 0 ${ix0} ${iy0} Z|${colour}`
  );
}

export interface GaugeProps {
  /** Secret spot; only pass it when it is meant to be visible. */
  target?: number | null;
  /** The main needle (own slider, or the team's averaged marker). */
  marker?: number | null;
  /** Extra faint needles — used at reveal to show each player's guess. */
  ghosts?: { value: number; label?: string }[];
  /**
   * Where the ghosts average out to — the position the round will actually be
   * scored on.
   *
   * A watching team sees every marker as it lands, and five equally faint
   * needles is a picture with no answer in it: the thing they are betting on is
   * not any one of them, it is the mean, and the mean is the one line that was
   * not drawn. Passing it here rather than through `marker` keeps them
   * distinguishable — this is a derived, still-moving figure, whereas `marker`
   * at the reveal is final.
   */
  average?: number | null;
}

export default function Gauge({
  target = null,
  marker = null,
  ghosts = [],
  average = null,
}: GaugeProps) {
  const ring =
    `${arcPath(CX, CY, R, 180, 0)} L ${polar(CX, CY, RIN, 0).join(" ")} ` +
    `${arcPathRev(CX, CY, RIN, 0, 180)} Z`;

  const bands =
    target !== null
      ? [
          band(target - 12, target - 5, "rgba(94,224,138,.45)"),
          band(target + 5, target + 12, "rgba(94,224,138,.45)"),
          band(target - 5, target + 5, "rgba(255,207,92,.85)"),
        ].filter(Boolean)
      : [];

  const ticks = [];
  for (let p = 0; p <= 100; p += 10) {
    const [x0, y0] = polar(CX, CY, R - 2, ang(p));
    const [x1, y1] = polar(CX, CY, R - 16, ang(p));
    ticks.push(
      <line key={p} x1={x0} y1={y0} x2={x1} y2={y1} stroke="#46508a" strokeWidth={2} />
    );
  }

  const needle = (value: number, colour: string, width: number, base: number) => {
    const [nx, ny] = polar(CX, CY, R - 8, ang(value));
    const [bx, by] = polar(CX, CY, base, ang(value) + 90);
    const [bx2, by2] = polar(CX, CY, base, ang(value) - 90);
    return (
      <g key={`${colour}-${value}-${width}`}>
        <polygon points={`${nx},${ny} ${bx},${by} ${bx2},${by2}`} fill={colour} />
        <line x1={CX} y1={CY} x2={nx} y2={ny} stroke={colour} strokeWidth={width} />
      </g>
    );
  };

  return (
    <svg className="gauge" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Consensus dial">
      <path d={ring} fill="#161d3c" stroke="#2c3566" strokeWidth={1.5} />
      {bands.map((b) => {
        const [d, fill] = b.split("|");
        return <path key={d} d={d} fill={fill} />;
      })}
      {ticks}
      <circle cx={CX} cy={CY} r={RIN} fill="#0c1020" stroke="#2c3566" strokeWidth={1.5} />
      {ghosts.map((g) => needle(g.value, "rgba(255,255,255,.32)", 2, 9))}
      {/* Drawn over the faint ones and under `marker`, which is the order the
          three mean something in: individual answers, the number they add up
          to, and — once the round is over — the position that was scored. The
          rim disc is what makes it findable at a glance on a phone, where a
          needle among needles is just another line. */}
      {average !== null && average !== undefined ? (
        <g>
          {needle(average, "#5ee0c5", 4, 16)}
          <circle
            cx={polar(CX, CY, R - 8, ang(average))[0]}
            cy={polar(CX, CY, R - 8, ang(average))[1]}
            r={11}
            fill="#5ee0c5"
            stroke="#06121f"
            strokeWidth={2.5}
          />
        </g>
      ) : null}
      {marker !== null && marker !== undefined ? needle(marker, "#ffffff", 3, 18) : null}
      <circle cx={CX} cy={CY} r={14} fill="#5ee0c5" />
      <circle cx={CX} cy={CY} r={6} fill="#06121f" />
    </svg>
  );
}
