/**
 * One leaderboard row, flattened.
 *
 * The four boards answer four different questions — best team run, closest
 * round, sharpest player, cruellest scale — and each has its own columns. What
 * they have in common is the shape of an *entry*: a rank, something to call it,
 * one number it is sorted by, and a handful of secondary figures. Normalising
 * to that shape is what lets one podium and one detail card serve all four,
 * instead of four of each.
 *
 * The normalisers live in the page, because they need the translator and the
 * reader's language. This file is only the contract between them and the two
 * components that render it.
 */

/** One secondary figure in the detail card. */
export interface LbStat {
  label: string;
  value: string;
  /**
   * A line under the value, for the numbers that do not speak for themselves —
   * a distance of 4 is excellent and a distance of 40 is a miss, which nobody
   * reading a column called "off by" knows on sight.
   */
  hint?: string | null;
}

export interface LbEntry {
  /** Stable across re-sorts; used as the React key. */
  key: string;
  /** 1-based, as displayed. */
  rank: number;
  title: string;
  subtitle?: string | null;
  /** The one number the board is ranked by, already formatted. */
  headline: string;
  headlineLabel: string;
  /**
   * Optional because a podium never reads them: the end-of-game screen builds
   * entries for the three steps and nothing else, since everything a step could
   * open is already further down that page. Only an entry that can be opened
   * needs stats, and only the leaderboard's entries can be opened.
   */
  stats?: LbStat[];
  /**
   * What goes in the podium disc. Initials are computed from the title when
   * this is absent, which is right for people and team names and wrong for a
   * board whose title is a pair of poles — those pass an emoji instead.
   */
  face?: string | null;
  /** Won the game it belongs to: earns a crown rather than initials. */
  crown?: boolean;
  /** Belongs to the device that is looking. */
  mine?: boolean;
  /**
   * The rounds board only: the dial that round was actually scored on, so the
   * detail card can show the miss instead of stating it. Both values are 0..100.
   */
  dial?: { target: number; marker: number } | null;
  /** Scale ends, for the dial's captions. */
  poles?: { left: string; right: string } | null;
}
