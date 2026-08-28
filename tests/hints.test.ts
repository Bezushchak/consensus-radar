/**
 * The clue hints: the band arithmetic, the rules every hint obeys, and the one
 * property that would be a bug rather than a blemish — that a hint reaches
 * nobody but the clue-giver.
 *
 * Two of these tests read source files instead of calling functions. That is on
 * purpose. A hint names one fifth of the dial, so a guesser who can read it
 * knows the answer to within twenty points, and the way that leak would happen
 * is not a wrong return value — it is an `import` somebody adds in six months
 * because the hint was convenient to have in the room payload. There is nothing
 * to call that would catch it, so the import itself is what gets asserted.
 *
 * Kept in its own file rather than added to `engine.test.ts` because it is the
 * only test that reaches outside `src` — into `scripts/` and `data/` — and a
 * reader looking for "where is the hint catalogue checked" should find a file
 * named after it.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { HINT_BANDS, bandOf, bandRange, pickHint, type HintText } from "../src/lib/game/hint";
import { STRINGS, t as translate } from "../src/lib/i18n";
import { SCALES } from "../src/lib/scales-data";
import {
  MAX_HINT_CHARS,
  SEED_FILE,
  checkHint,
  checkHintFile,
  loadHintFile,
} from "../scripts/hint-file";
import {
  freshQuirks,
  negotiate,
  pickOpenAIModel,
  providerOf,
  usableChatModels,
} from "../scripts/model-choice";

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), "utf8");

test("the dial is cut into bands with no gap and no overlap", () => {
  // Every point a player can be given must land in exactly one band, and that
  // band's stated bounds must actually contain it. Checked over the whole dial
  // rather than at the seams, because the cost of being wrong is a hint that
  // describes the wrong fifth of the scale and nobody ever finding out why the
  // team keeps missing.
  for (let target = 0; target <= 100; target++) {
    const band = bandOf(target);
    const { min, max } = bandRange(band);
    assert.ok(band >= 0 && band < HINT_BANDS, `${target} landed in band ${band}`);
    assert.ok(
      target >= min && target <= max,
      `${target} is in band ${band}, which claims to cover ${min}-${max}`
    );
  }

  // The seams, written out, so a change to the band width fails here with the
  // old numbers in the message rather than somewhere further downstream.
  assert.equal(bandOf(0), 0);
  assert.equal(bandOf(19), 0);
  assert.equal(bandOf(20), 1);
  assert.equal(bandOf(39), 1);
  assert.equal(bandOf(40), 2);
  assert.equal(bandOf(59), 2);
  assert.equal(bandOf(60), 3);
  assert.equal(bandOf(79), 3);
  assert.equal(bandOf(80), 4);
  assert.equal(bandOf(100), 4);

  // Contiguous, and the top band is the one that swallows the extra point:
  // 100 is a legal target, so the last band is a point wider than the rest.
  for (let band = 1; band < HINT_BANDS; band++) {
    assert.equal(bandRange(band).min, bandRange(band - 1).max + 1, `band ${band} leaves a gap`);
  }
  assert.equal(bandRange(0).min, 0);
  assert.equal(bandRange(HINT_BANDS - 1).max, 100);
});

test("a target off the dial, or between two points, still lands in a band", () => {
  // `bandOf` clamps rather than throwing. A hint is decoration: whatever a
  // caller hands it, the answer is a band, because the alternative is a round
  // that fails to open over a suggestion nobody asked for.
  assert.equal(bandOf(-40), 0);
  assert.equal(bandOf(1000), 4);
  assert.equal(bandOf(Number.NaN), 0);

  // Rounded first, so a fractional target is banded as the number the players
  // would see on screen and not as the one underneath it.
  assert.equal(bandOf(59.4), 2);
  assert.equal(bandOf(59.6), 3);

  // Same for the reverse direction: an impossible band index is clamped into
  // the range instead of returning bounds nothing can satisfy.
  assert.deepEqual(bandRange(-3), bandRange(0));
  assert.deepEqual(bandRange(99), bandRange(HINT_BANDS - 1));
});

test("one round shows one hint, however many times the screen asks for it", () => {
  const ideas: HintText[] = [
    { ua: "перша", en: "first" },
    { ua: "друга", en: "second" },
  ];

  // The clue screen polls, and the clue-giver can open and close the line. If
  // the pick were random the suggestion would change under them mid-round,
  // which reads as a bug and is one. The round id is the seed for exactly this.
  const once = pickHint(ideas, "round-abc");
  for (let i = 0; i < 20; i++) assert.equal(pickHint(ideas, "round-abc"), once);

  // But it is the *seed* doing the work, not the first slot winning every time.
  // Derived rather than measured: the low bit of FNV-1a is the parity of the low
  // bits of its input, so a set of seeds this size cannot all land on one side.
  const spread = new Set<string>();
  for (let i = 0; i < 32; i++) spread.add(pickHint(ideas, `s${i}`)?.en ?? "none");
  assert.equal(spread.size, 2, "the seed is not reaching the choice");

  // Nothing written for this band is the normal case, not an error case.
  assert.equal(pickHint([], "round-abc"), null);

  // One variant is what the catalogue actually holds today, and it must be
  // returned without consulting the seed at all.
  const only: HintText[] = [{ ua: "єдина", en: "only" }];
  assert.equal(pickHint(only, "round-abc"), only[0]);
  assert.equal(pickHint(only, "round-xyz"), only[0]);
});

test("every hint in the catalogue is a clue the game would accept", () => {
  const file = loadHintFile();
  const pairs = Object.keys(file.hints);

  // A loader that quietly returned nothing would make every assertion below
  // vacuously true, which is the one way this test could lie.
  assert.ok(pairs.length > 0, "data/scale-hints.json has no hints — this test would prove nothing");

  // The whole file through the same gate the SQL compiler uses, which is the
  // real `validateClue` and not a description of it: all five bands in both
  // languages, no number in any form, no pole label echoed back, five different
  // ideas, nothing longer than a glance.
  const problems = checkHintFile(file, SCALES);
  assert.deepEqual(
    problems,
    [],
    `data/scale-hints.json would be rejected by npm run hints:sql:\n  ${problems.join("\n  ")}`
  );

  // Every hint is also a clue somebody may send verbatim, so the count is worth
  // stating: a pair is written for both languages and all bands, or not at all.
  for (const key of pairs) {
    const entry = file.hints[key];
    assert.equal(entry.ua.length, HINT_BANDS, `${key} has the wrong number of Ukrainian hints`);
    assert.equal(entry.en.length, HINT_BANDS, `${key} has the wrong number of English hints`);
  }
});

test("the hint rules reject what they are there to reject", () => {
  const poles = ["Very hot", "Very cold"];

  // A number in any form. This is the rule the whole feature hangs on: the
  // suggestion is a candidate clue, and a clue with a number in it is refused
  // by the input box in front of the player.
  assert.ok(checkHint("forty degrees outside"));
  assert.ok(checkHint("сорок кроків звідси"));
  assert.ok(checkHint("half of the way"));
  assert.ok(checkHint("a level5 alarm"));

  // Either pole label, which tells the clue-giver only what their own screen
  // already says. Compared token by token, so a word that merely starts the
  // same way is untouched.
  assert.match(String(checkHint("hot tea in a mug", poles)), /pole label/);
  assert.equal(checkHint("hotel lobby carpet", poles), null);

  // Degree without an image: rule two wearing a hat. Asked without poles on
  // purpose — "very" is half of this scale's own labels, so with them the pole
  // rule would answer first and this rule would never be the one under test.
  assert.match(String(checkHint("very slightly more")), /how much/);

  // Length, and the empty string, both before anything cleverer runs.
  assert.match(String(checkHint("x".repeat(MAX_HINT_CHARS + 1))), /too long/);
  assert.equal(checkHint("   "), "empty");

  // And the shape of a hint that is fine, in both languages, so the rules
  // cannot be tightened into rejecting everything without this failing.
  assert.equal(checkHint("molten lava", poles), null);
  assert.equal(checkHint("кубики льоду в морозилці", poles), null);
});

test("the clue screen's two lines are in the dictionary", () => {
  for (const key of ["hintAsk", "hintCaveat"]) {
    assert.ok(STRINGS[key], `${key} is used by the clue screen but not in the dictionary`);
    for (const lang of ["ua", "en"] as const) {
      const out = translate(lang, key, {});
      assert.ok(out.length > 0, `${key} is empty in ${lang}`);
      assert.ok(out !== key, `${key} in ${lang} rendered as its own key`);
      assert.ok(!/\{\w+\}/.test(out), `${key} in ${lang} left a placeholder unfilled: ${out}`);
    }
  }

  // The keys are untyped, so a typo in the component renders the raw key on
  // screen and nothing anywhere fails. Read out of the source because there is
  // no DOM here.
  const play = read("src/components/room/PlayView.tsx");
  assert.match(play, /t\("hintAsk"\)/, "the clue screen no longer asks for hintAsk");
  assert.match(play, /t\("hintCaveat"\)/, "the clue screen no longer shows hintCaveat");
});

test("no client-side file can reach the hint catalogue", () => {
  // The leak that matters. A hint names one fifth of the dial, so anything that
  // imports it into a client component puts the answer in the JavaScript bundle
  // for the whole room to read. `src/lib/game/hint.ts` is deliberately not on
  // this list: it is pure band arithmetic and the client needs it.
  const forbidden = /server\/hints|scale-hints/;
  const offenders: string[] = [];

  for (const dir of ["src/components", "src/lib/client"]) {
    for (const path of sourceFiles(dir)) {
      if (forbidden.test(code(read(path)))) offenders.push(path);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these files ship to the browser and mention the hint catalogue:\n  ${offenders.join("\n  ")}`
  );

  // The other half of the same fence: the authoring file is data, read by
  // scripts, and never imported by the app at all — not even on the server.
  for (const path of sourceFiles("src")) {
    assert.doesNotMatch(
      code(read(path)),
      /data\/scale-hints/,
      `${path} imports the authoring JSON; the app reads the table instead`
    );
  }
});

test("the hint travels on the one endpoint that checks who is asking", () => {
  // Exactly two callers, listed rather than counted, so adding a third is a
  // decision somebody has to make here first.
  const allowed = ["src/lib/server/rooms.ts", "src/app/api/health/route.ts"];
  const callers = sourceFiles("src").filter(
    (path) =>
      path !== "src/lib/server/hints.ts" &&
      /server\/hints|from "\.\/hints"/.test(code(read(path)))
  );
  assert.deepEqual(callers.sort(), allowed.sort());

  const rooms = read("src/lib/server/rooms.ts");

  // One call, and it is inside the function that has already refused everybody
  // except the round's clue-giver.
  const calls = [...rooms.matchAll(/hintFor\(/g)].length;
  assert.equal(calls, 1, `hintFor is called ${calls} times in rooms.ts; it may be called once`);
  assert.match(
    slice(rooms, "export async function getSecretTarget"),
    /hintFor\(/,
    "the hint is no longer read inside getSecretTarget"
  );

  // And it is absent from the payload that is built once and handed to
  // everybody, which is where it would be least visible and most damaging.
  // Case-sensitive: this file also has a `MIGRATION_HINT` about a missing
  // column, which is not the kind of hint anyone can score points with.
  assert.doesNotMatch(
    slice(rooms, "export async function getState"),
    /hintFor|hint:/,
    "getState serves a hint; the room state goes to every player, guessers included"
  );
  assert.doesNotMatch(
    slice(read("src/lib/types.ts"), "export interface RoomState {", "\n}"),
    /hint/i,
    "RoomState has a hint field; that payload is not per-viewer"
  );

  // The door it does use, stated positively, so this test fails if the feature
  // is quietly removed rather than only if it is quietly widened.
  assert.match(read("src/lib/client/api.ts"), /hint: HintText \| null/);
  assert.match(read("src/app/api/rooms/[code]/secret/route.ts"), /getSecretTarget/);
});

test("the generated seed matches the catalogue it was generated from", () => {
  // The seed is optional and is not in the repo until somebody runs the
  // compiler, so its absence is not a failure. Its being stale would be: the
  // database would hold hints that no longer exist in the file anybody edits.
  if (!existsSync(SEED_FILE)) return;

  const sql = readFileSync(SEED_FILE, "utf8");
  const file = loadHintFile();
  const keys = Object.keys(file.hints);

  const rows = [...sql.matchAll(/^ {2}\('/gm)].length;
  assert.equal(
    rows,
    keys.length * HINT_BANDS * 2,
    "supabase/scale-hints-seed.sql is out of date — re-run npm run hints:sql"
  );

  for (const key of keys) {
    assert.ok(sql.includes(`('${key}',`), `${key} has hints but is missing from the seed`);
  }
  assert.match(sql, /GENERATED FILE/, "the seed lost the header that says not to edit it");
});

test("a model name picks its own provider, and an unfamiliar one abstains", () => {
  // This is what makes `--model` enough on its own. Getting it wrong sends a
  // Claude model name to OpenAI with an OpenAI key, which is a 404 on every one
  // of 262 pairs, so the mapping is worth pinning down rather than eyeballing.
  assert.equal(providerOf("claude-sonnet-5"), "anthropic");
  assert.equal(providerOf("claude-opus-5"), "anthropic");
  assert.equal(providerOf("gpt-5.2"), "openai");
  assert.equal(providerOf("gpt-4o-mini"), "openai");
  assert.equal(providerOf("o3"), "openai");
  assert.equal(providerOf("chatgpt-4o-latest"), "openai");
  assert.equal(providerOf("GPT-5"), "openai", "the flag is typed by hand, so case cannot matter");

  // Abstaining is the important half: a name this file has never heard of must
  // fall through to "whichever key exists" rather than guess a provider and
  // spend the run against the wrong API.
  assert.equal(providerOf("llama-3-70b"), null);
  assert.equal(providerOf("mistral-large"), null);
  assert.equal(providerOf(""), null);
  assert.equal(providerOf(null), null);
});

test("the OpenAI model is chosen out of what the key can actually see", () => {
  // An exact preferred id wins outright.
  assert.equal(pickOpenAIModel(["gpt-4o", "gpt-4.1", "gpt-5.2"]), "gpt-5.2");

  // With no exact id, the newest dated variant of the best name — fixed-width
  // dates sort into date order, which is the whole reason this is a plain sort.
  assert.equal(
    pickOpenAIModel(["gpt-5.2-2026-01-11", "gpt-5.2-2026-03-04", "gpt-4o"]),
    "gpt-5.2-2026-03-04"
  );

  // A small model loses to a bigger older one, because half of this catalogue is
  // Ukrainian and that is where the small models fall down…
  assert.equal(pickOpenAIModel(["gpt-5.2-mini", "gpt-5.2-nano", "gpt-4o"]), "gpt-4o");

  // …but wins against nothing at all, so a key that only has the small models
  // still runs instead of refusing to start.
  assert.equal(pickOpenAIModel(["gpt-5.2-mini"]), "gpt-5.2-mini");

  // Ids that answer a different question are not candidates, however new.
  assert.equal(pickOpenAIModel(["gpt-4o-audio-preview", "gpt-image-1"]), null);
  assert.equal(pickOpenAIModel(["text-embedding-3-large", "whisper-1"]), null);
  assert.equal(pickOpenAIModel([]), null);

  // A reasoning-only key declines to be chosen for, and that is deliberate: a
  // reasoning model bills its thinking against the reply cap and can come back
  // empty. It still has to appear in `usableChatModels`, because that list is
  // what the error message prints so `--model` can be aimed.
  assert.equal(pickOpenAIModel(["o3", "o4-mini"]), null);
  assert.deepEqual(usableChatModels(["o3", "o4-mini", "text-embedding-3-large"]), [
    "o3",
    "o4-mini",
  ]);
});

test("the OpenAI envelope is corrected at most once per field", () => {
  const q = freshQuirks("openai");
  assert.equal(q.tokenParam, "max_completion_tokens");
  assert.equal(q.json, true);

  // The rename, as the API reports it.
  assert.equal(
    negotiate("Unsupported parameter: 'max_completion_tokens' is not supported.", q),
    "max_completion_tokens"
  );
  assert.equal(q.tokenParam, "max_tokens");

  // And the anti-loop property: once swapped, the advice pointing the other way
  // must not swap it back. `ask` retries on every non-null return, so a
  // negotiation that could flip twice would retry until the budget ran out.
  assert.equal(negotiate("Use 'max_completion_tokens' instead of 'max_tokens'.", q), null);
  assert.equal(q.tokenParam, "max_tokens");

  // JSON mode is a convenience and is given up the same way, also once.
  const noJson = "response_format of type json_object is not supported";
  assert.equal(negotiate(noJson, q), "response_format");
  assert.equal(q.json, false);
  assert.equal(negotiate(noJson, q), null);

  // A 400 about anything else is not this function's business — the caller turns
  // a null into a fatal error rather than retrying a request that cannot work.
  const unrelated = "Invalid value for 'temperature': must be <= 2";
  assert.equal(negotiate(unrelated, freshQuirks("openai")), null);

  // Anthropic sends neither field, so there is nothing to give up.
  const a = freshQuirks("anthropic");
  assert.equal(a.json, false);
  assert.equal(negotiate("response_format is not supported", a), null);
});

/**
 * Source with its comments removed.
 *
 * The rules below are about imports, and prose that talks *about* an import must
 * not trip them — `src/lib/game/hint.ts` explains in its own header where the
 * server read lives, and a file explaining the fence is not a hole in it.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Every .ts/.tsx file under a directory of the repo, as repo-relative paths. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * One declaration out of a source file: from `start` to the next thing that
 * looks like the end of it. Crude on purpose — the alternative is a parser, and
 * what these assertions need is only "is this word inside this function".
 */
function slice(source: string, start: string, end = "\nexport "): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `the source no longer contains ${start}`);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to === -1 ? undefined : to);
}
