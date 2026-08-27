import { PALETTE } from "@/lib/game/engine";
import type { Lang } from "@/lib/i18n";

/**
 * The scripted game shown on /how-to-play.
 *
 * A rehearsed performance, not a real session: no room is created, no request
 * is made, nothing is tracked. `DemoPlayer` walks this list, moves a drawn
 * cursor to the element each step names, and patches `DemoState`; `DemoScreens`
 * renders that state with the app's own CSS classes.
 *
 * Two things are deliberately kept out of here. The screens are not the real
 * components — `PlayView` and `HomePage` need a `RoomState`, an identity and a
 * live `run`, and faking all three to drive a cartoon would be a second
 * implementation of the game with none of the safety. And the narration is
 * stored as dictionary keys rather than sentences, so the caption bar follows
 * the language toggle like everything else.
 *
 * The numbers below are consistent with the real engine on purpose: a secret
 * at 36 with markers at 27 and 34 averages to 30.5, which is 5.5 off, which
 * `scoreFor` scores as 3. If the bands ever change, the reveal in the demo
 * should be recomputed rather than left to drift.
 */

export type Screen = "home" | "lobby" | "clue" | "guess" | "watch" | "reveal";

/** Fields the fake cursor can type into. Keys double as cursor targets. */
export type TextField = "code" | "name" | "clue";

export interface Pair {
  ua: string;
  en: string;
}

export function pick(pair: Pair, lang: Lang): string {
  return lang === "ua" ? pair.ua : pair.en;
}

export interface DemoPlayer {
  id: string;
  name: string;
  team: string;
  host?: boolean;
}

export const DEMO_TEAMS: { id: string; name: Pair; color: string }[] = [
  { id: "signal", name: { ua: "Сигнал", en: "Signal" }, color: PALETTE[0] },
  { id: "noise", name: { ua: "Шум", en: "Noise" }, color: PALETTE[1] },
];

export const DEMO_PLAYERS: DemoPlayer[] = [
  { id: "max", name: "Max", team: "signal", host: true },
  { id: "dana", name: "Dana", team: "signal" },
  { id: "lea", name: "Lea", team: "signal" },
  { id: "ira", name: "Ira", team: "noise" },
  { id: "yuri", name: "Yuri", team: "noise" },
  { id: "sam", name: "Sam", team: "noise" },
];

export function demoPlayer(id: string): DemoPlayer {
  return DEMO_PLAYERS.find((p) => p.id === id) ?? DEMO_PLAYERS[0];
}

export function demoTeam(id: string | null) {
  return DEMO_TEAMS.find((tm) => tm.id === id) ?? null;
}

/** The single round the demo plays, and the room around it. */
export const DEMO = {
  code: "R7QK",
  goal: 20,
  target: 36,
  marker: 30.5,
  points: 3,
  poles: {
    l: { ua: "Дешеве задоволення", en: "Guilty pleasure" },
    r: { ua: "Справжнє мистецтво", en: "High art" },
  },
  /** Typed first, refused for containing a number, then erased. */
  clueBad: { ua: "50% караоке", en: "50 percent karaoke" },
  clue: { ua: "Караоке з колегами", en: "Karaoke with colleagues" },
  guesses: [
    { id: "dana", name: "Dana", value: 27 },
    { id: "lea", name: "Lea", value: 34 },
  ],
  bets: [
    { id: "ira", name: "Ira", side: "left" as const, correct: true },
    { id: "yuri", name: "Yuri", side: "right" as const, correct: false },
    { id: "sam", name: "Sam", side: "left" as const, correct: true },
  ],
};

export interface DemoMarker {
  id: string;
  name: string;
  value: number;
}

export interface DemoState {
  screen: Screen;
  /** Whose phone is on screen, and what they are to this round. */
  who: string;
  role: string;
  /** Narration, as a dictionary key. */
  caption: string;
  /** Placeholders for the caption, when it needs them. */
  captionVars?: Record<string, string | number>;

  code: string;
  name: string;
  team: string | null;
  /** Who is in the lobby so far — they arrive one at a time. */
  joined: string[];

  clue: string;
  slider: number;
  locked: boolean;
  /** Guessers who have locked a marker in. */
  done: string[];
  /** Markers a watching team can see. */
  markers: DemoMarker[];
  bet: "left" | "right" | null;

  /** Element being pressed, and the field holding the caret. */
  pressed: string | null;
  focus: string | null;
}

export function initialState(): DemoState {
  return {
    screen: "home",
    who: "dana",
    role: "demoRoleNew",
    caption: "demoJoin2",
    code: "",
    name: "",
    team: null,
    joined: [],
    clue: "",
    slider: 50,
    locked: false,
    done: [],
    markers: [],
    bet: null,
    pressed: null,
    focus: null,
  };
}

export type Step =
  | { do: "screen"; screen: Screen; patch?: Partial<DemoState>; hold?: number }
  | { do: "set"; patch: Partial<DemoState>; hold?: number }
  | { do: "say"; key: string; vars?: Record<string, string | number>; ms?: number }
  | { do: "wait"; ms: number }
  | { do: "move"; to: string; ms?: number }
  | { do: "click"; to: string; patch?: Partial<DemoState>; ms?: number; hold?: number }
  | { do: "type"; into: TextField; text: string; cps?: number; hold?: number }
  | { do: "erase"; into: TextField }
  | { do: "drag"; value: number; hold?: number };

/**
 * Built per language rather than translated at render time, because the typed
 * strings are typed one character at a time and the animation needs to know
 * the whole string up front. Switching language therefore restarts the demo,
 * which is the honest behaviour: the clue being typed is different text.
 */
export function buildScript(lang: Lang): Step[] {
  const marker = (id: string) => {
    const g = DEMO.guesses.find((x) => x.id === id);
    return g ? { id: g.id, name: g.name, value: g.value } : null;
  };
  const dana = marker("dana");
  const lea = marker("lea");
  const both = [dana, lea].filter((m): m is DemoMarker => m !== null);

  return [
    // ---------------- joining ----------------
    //
    // The real home page carries both fields, so joining by code goes straight
    // to the lobby — the separate join screen only appears for someone opening
    // a shared link on a device with no name saved. The demo shows the path
    // most people take rather than adding a screen for the other one.
    { do: "screen", screen: "home", hold: 1400 },
    { do: "type", into: "name", text: "Dana", cps: 7 },
    { do: "say", key: "demoJoin1", ms: 1800 },
    { do: "type", into: "code", text: DEMO.code, cps: 4 },
    { do: "click", to: "join-by-code" },

    // ---------------- lobby ----------------
    {
      do: "screen",
      screen: "lobby",
      // Joining without asking for a team lands you in the smaller one, which
      // is why Dana starts on Noise and has to move.
      patch: { caption: "demoLobby1", joined: ["max", "dana"], team: "noise", focus: null },
      hold: 1600,
    },
    { do: "say", key: "demoJoin3", ms: 3000 },
    { do: "click", to: "team-signal", patch: { team: "signal" }, hold: 1300 },
    { do: "set", patch: { joined: ["max", "dana", "lea"] }, hold: 900 },
    { do: "set", patch: { joined: ["max", "dana", "lea", "ira"] }, hold: 800 },
    { do: "set", patch: { joined: ["max", "dana", "lea", "ira", "yuri", "sam"] }, hold: 1200 },
    { do: "say", key: "demoLobby2", ms: 1800 },
    // The host is a different phone, so the screen changes hands here rather
    // than growing a Start button Dana never had.
    { do: "set", patch: { who: "max", role: "hostBadge" }, hold: 1200 },
    { do: "click", to: "start-game" },

    // ---------------- clue, on the clue-giver's phone ----------------
    {
      do: "screen",
      screen: "clue",
      patch: { caption: "demoClue1", role: "demoRoleClue" },
      hold: 2600,
    },
    { do: "say", key: "demoClue2", ms: 1800 },
    { do: "type", into: "clue", text: pick(DEMO.clueBad, lang), cps: 9 },
    { do: "say", key: "demoClue3", ms: 2600 },
    { do: "erase", into: "clue" },
    { do: "type", into: "clue", text: pick(DEMO.clue, lang), cps: 11 },
    { do: "say", key: "demoClue4", ms: 1500 },
    { do: "click", to: "send-clue" },

    // ---------------- guessing, on a guesser's phone ----------------
    {
      do: "screen",
      screen: "guess",
      patch: {
        caption: "demoGuess1",
        who: "dana",
        role: "demoRoleGuess",
        slider: 50,
        focus: null,
      },
      hold: 2200,
    },
    { do: "say", key: "demoGuess2", ms: 1600 },
    { do: "drag", value: 27, hold: 900 },
    { do: "click", to: "submit-guess", patch: { locked: true, done: ["dana"] }, hold: 1200 },
    { do: "set", patch: { done: ["dana", "lea"] }, hold: 1400 },

    // ---------------- watching, on the other team's phone ----------------
    {
      do: "screen",
      screen: "watch",
      patch: {
        caption: "demoWatch1",
        who: "ira",
        role: "demoRoleWatch",
        markers: dana ? [dana] : [],
        done: ["dana"],
      },
      hold: 2400,
    },
    { do: "set", patch: { markers: both, done: ["dana", "lea"] }, hold: 2000 },
    { do: "say", key: "demoWatch2", ms: 2000 },
    { do: "click", to: "bet-left", patch: { bet: "left" }, hold: 1600 },

    // ---------------- reveal, back on the host's phone ----------------
    // No caption of its own: the one that follows carries placeholders, and
    // setting the key here would flash the raw `{marker}` for a beat.
    {
      do: "screen",
      screen: "reveal",
      patch: { who: "max", role: "hostBadge" },
      hold: 700,
    },
    {
      do: "say",
      key: "demoReveal1",
      vars: { marker: DEMO.marker, target: DEMO.target, points: DEMO.points },
      ms: 3400,
    },
    { do: "say", key: "demoReveal2", ms: 3400 },
    { do: "click", to: "next-round" },
    { do: "say", key: "demoNext", ms: 3000 },
  ];
}
