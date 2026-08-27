"use client";

/**
 * The noise the clock makes.
 *
 * Synthesised rather than played from a file, on purpose. An audio asset would
 * be a network request that fails exactly when it matters — on the hotel wifi,
 * in the middle of a round — and it would have to be decoded before the first
 * beep, so the first warning of the game would arrive late or not at all. Two
 * oscillators and an envelope cost nothing, load nothing, and sound the same on
 * every device.
 *
 * Everything here is best-effort by design. A phone with the ringer off, a
 * browser with no `AudioContext`, a laptop that has never been tapped and so
 * will not start one, a desktop with no vibration motor: all of those are
 * normal, and none of them is allowed to throw. The countdown is on screen in
 * amber and red as well, so the sound is a courtesy and never the only warning.
 */

let ctx: AudioContext | null = null;
let failed = false;

/**
 * The one shared audio context, created on first use.
 *
 * Lazily, because a context created at import time on iOS starts suspended and
 * stays that way — Safari only lets one begin inside a user gesture, and by the
 * time a round is running the player has tapped Join or Start, so the first
 * beep is asked for on the far side of a real interaction.
 */
function context(): AudioContext | null {
  if (failed) return null;
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    failed = true;
    return null;
  }
  try {
    ctx = new Ctor();
  } catch {
    failed = true;
    return null;
  }
  return ctx;
}

export interface BeepOptions {
  /** Hertz. Higher reads as more urgent, which is the whole vocabulary here. */
  freq?: number;
  /** Milliseconds. */
  ms?: number;
  /** Peak amplitude, 0–1. Kept low: this plays in a room full of people. */
  gain?: number;
}

/** One short tone. Silent, never throwing, wherever it cannot be played. */
export function beep({ freq = 880, ms = 140, gain = 0.14 }: BeepOptions = {}): void {
  const ac = context();
  if (!ac) return;

  try {
    // A context that was created before the first tap needs waking. Fires and
    // forgets: if it resumes after this beep, the next one is audible, and one
    // missed tone matters less than a blocked render.
    if (ac.state === "suspended") void ac.resume();

    const at = ac.currentTime;
    const seconds = Math.max(ms, 20) / 1000;

    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, at);

    // An envelope rather than a bare on/off. A square edge on a sine wave
    // clicks, and a click is what a broken speaker sounds like.
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(gain, at + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

    osc.connect(amp);
    amp.connect(ac.destination);
    osc.start(at);
    osc.stop(at + seconds + 0.02);
  } catch {
    // A device that will not make a noise is not a broken game.
  }
}

/** Two tones, the second lower — the sound of something having run out. */
export function beepTwice(opts: BeepOptions = {}): void {
  const freq = opts.freq ?? 880;
  beep({ ...opts, freq });
  // `beep` guards itself, but the timer does not: this module is imported by a
  // component, so it is evaluated during the server render, and an exported
  // function that assumes `window` is one refactor away from being called there.
  if (typeof window === "undefined") return;
  window.setTimeout(() => beep({ ...opts, freq: Math.round(freq * 0.75) }), 170);
}

/**
 * Vibration, where there is a motor for it.
 *
 * Typed through a local interface rather than off `navigator` directly: the
 * Vibration API is not in every DOM typing, and a cast to an intersection with
 * the real `Navigator` produces a signature nothing can call cleanly. Desktop
 * browsers and iOS Safari have no `vibrate` at all, which is why the guard is a
 * runtime check and not just a type.
 */
interface Vibrating {
  vibrate?: (pattern: number | number[]) => boolean;
}

export function buzz(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as unknown as Vibrating;
  if (typeof nav.vibrate !== "function") return;
  try {
    nav.vibrate(pattern);
  } catch {
    // Chrome refuses vibration without a prior gesture on the page. Nothing to
    // do about it and nothing worth telling anybody.
  }
}

/**
 * The three sounds the countdown can make, named after what they mean rather
 * than what they are, so the component asking for one does not have to hold an
 * opinion about frequencies.
 */
export function alarmWarn(): void {
  beep({ freq: 784, ms: 150 });
  buzz(120);
}

export function alarmFinal(): void {
  beep({ freq: 1046, ms: 110, gain: 0.16 });
  buzz(70);
}

export function alarmOver(): void {
  beepTwice({ freq: 523, ms: 220, gain: 0.18 });
  buzz([90, 70, 160]);
}
