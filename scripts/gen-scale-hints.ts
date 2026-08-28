/**
 * Writes data/scale-hints.json — five clue ideas per scale pair, per language.
 *
 *   npm run hints:gen                        every pair that has none yet
 *   npm run hints:gen -- --limit=10           stop after ten pairs (a cost cap)
 *   npm run hints:gen -- --only=hot_cold,fast_slow
 *   npm run hints:gen -- --force              rewrite pairs that already have hints
 *   npm run hints:gen -- --model=claude-opus-5   or --model=gpt-5.2
 *   npm run hints:gen -- --provider=openai    only needed if both keys are set
 *   npm run hints:gen -- --jobs=2             fewer requests in flight
 *
 * Needs ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.local (or the environment).
 * Whichever one is there picks the provider; `--provider` settles a tie, and a
 * `--model` whose name gives it away ("claude-…", "gpt-…") picks for itself.
 * This is the one script in the repo that spends money, so it defaults to the
 * cheap thing: only pairs with no hints at all, and `--limit` exists so a first
 * run can be ten pairs rather than two hundred and sixty-two.
 *
 * Three properties matter more than anything else here.
 *
 * The first is that nothing illegal can survive a run. Every string is put
 * through `checkEntry` — which calls the game's *actual* clue validator, not a
 * description of it — before it is accepted, and a rejected reply is sent back
 * with the reasons quoted so the next attempt is aimed rather than hopeful.
 * A pair that cannot be written legally is reported and left absent, because a
 * hint the player types in and watches the input box refuse in red is worse
 * than a clue screen with no hint on it.
 *
 * The second is that a run is resumable. The file is saved after every single
 * pair, so a crash, a rate limit or a closed laptop costs one pair and not the
 * afternoon; the next run skips whatever is already there. This is also why the
 * script writes JSON and never SQL: generating hints and changing the database
 * are two separate decisions, and the second one is `npm run hints:sql`.
 *
 * The third is that the provider does not show up in the output. Both are asked
 * the same question, in the same system prompt, and both answers go through the
 * same `checkEntry`, so `data/scale-hints.json` does not depend on who wrote it
 * — the `model` line records that as provenance and nothing downstream reads it.
 * The two APIs disagree about enough small things (the auth header, where the
 * text sits in the reply, what the token cap is called) that those differences
 * are confined to two places and no others: `ask` and its three helpers here,
 * which build and read the request, and `./model-choice`, which holds the parts
 * that are pure enough to test — provider from model name, model from what the
 * key can see, and what to do about a rejected parameter.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { MAX_CLUE_WORDS } from "../src/lib/game/clue";
import { HINT_BANDS, bandRange } from "../src/lib/game/hint";
import type { Scale } from "../src/lib/scales";
import { SCALES } from "../src/lib/scales-data";
import {
  HINT_FILE,
  MAX_HINT_CHARS,
  checkEntry,
  loadHintFile,
  saveHintFile,
  type HintEntry,
  type HintFileShape,
} from "./hint-file";
import {
  freshQuirks,
  negotiate,
  pickOpenAIModel,
  providerOf,
  usableChatModels,
  type Provider,
  type Quirks,
} from "./model-choice";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = "claude-sonnet-5";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

/**
 * The reply cap. Five lines in two languages is about three hundred tokens, so
 * both numbers are slack — but OpenAI's reasoning models bill thinking against
 * this same cap and return nothing at all when it runs out, which is why the
 * OpenAI figure is the larger of the two. An unused cap costs nothing.
 */
const MAX_TOKENS: Record<Provider, number> = { anthropic: 900, openai: 2000 };

/**
 * Everything a request needs, resolved once before the first pair goes out.
 *
 * `quirks` is mutable and shared by every worker on purpose: if this model turns
 * out to reject `max_completion_tokens`, that is true of the next two hundred
 * pairs too, and learning it once is the difference between one wasted request
 * and one per pair.
 */
interface Client {
  provider: Provider;
  key: string;
  model: string;
  quirks: Quirks;
}

/** Attempts per pair, including the first. Attempts after it carry the rejections. */
const ATTEMPTS = 3;
/** Retries for 429 and 5xx, which say "later" rather than "no". */
const HTTP_RETRIES = 4;
const BACKOFF_MS = 1500;
/** Pairs in flight. Low enough not to trip the rate limit on a fresh key. */
const DEFAULT_JOBS = 4;

/**
 * A failure that will repeat identically on every remaining pair — a bad key, a
 * model name that does not exist. Separated from ordinary failures so the run
 * stops instead of asking the same broken question two hundred more times.
 */
class Fatal extends Error {}

interface Args {
  model: string | null;
  provider: Provider | null;
  jobs: number;
  limit: number | null;
  only: string[] | null;
  force: boolean;
}

async function main(): Promise<void> {
  // Env files first: `readArgs` falls back to HINT_MODEL and HINT_PROVIDER, and
  // reading those before .env.local has been loaded would silently ignore them.
  const envFiles = loadEnvFiles();
  const args = readArgs();

  const client = await resolveClient(args, envFiles);

  const file = loadHintFile();
  const queue = pickPairs(file, args);

  if (queue.length === 0) {
    console.log(
      args.force || args.only
        ? "Nothing matched — check --only against the keys in src/lib/scales-data.ts."
        : `All ${Object.keys(file.hints).length} pair(s) in ${rel(HINT_FILE)} already have hints. ` +
            "Use --force to rewrite them."
    );
    return;
  }

  console.log(
    `${queue.length} pair(s) to write with ${client.model}, ${args.jobs} at a time.\n` +
      `Saving after each one, so this is safe to interrupt.\n`
  );

  const failures: string[] = [];
  let written = 0;

  // A box rather than a plain `let` so that the check after the workers have
  // finished sees the assignment: narrowing of a bare local does not follow a
  // value out of a closure, and a property read after an await does.
  const stop: { fatal: Fatal | null } = { fatal: null };

  let cursor = 0;
  const next = (): Scale | null => (cursor < queue.length ? queue[cursor++] : null);

  const worker = async (): Promise<void> => {
    for (let scale = next(); scale && !stop.fatal; scale = next()) {
      let outcome: HintEntry | string;
      try {
        outcome = await writePair(scale, client);
      } catch (err) {
        if (err instanceof Fatal) {
          stop.fatal = err;
          return;
        }
        throw err;
      }

      if (typeof outcome === "string") {
        failures.push(`${scale.key}: ${outcome}`);
        console.log(`  x  ${scale.key} — ${outcome}`);
        continue;
      }

      // Written before the next request goes out, not at the end of the run.
      file.hints[scale.key] = outcome;
      file.generated = new Date().toISOString().slice(0, 10);
      file.model = creditModel(file.model, client.model);
      saveHintFile(file);

      written++;
      console.log(
        `  ok ${scale.key}  (${written + failures.length}/${queue.length})  ` +
          `${outcome.en[0]} … ${outcome.en[HINT_BANDS - 1]}`
      );
    }
  };

  await Promise.allSettled(
    Array.from({ length: Math.min(args.jobs, queue.length) }, () => worker())
  );

  console.log(`\nWrote ${written} pair(s) to ${rel(HINT_FILE)}.`);

  if (stop.fatal) {
    console.error(
      `\nStopped early — ${stop.fatal.message}\n` +
        "Everything written so far is saved; fix that and run again to continue."
    );
    process.exit(1);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} pair(s) could not be written legally:\n`);
    for (const line of failures) console.error(`  ${line}`);
    console.error(
      "\nThese pairs simply have no hints, which the game treats as normal — the clue\n" +
        "screen shows one line less. Re-run to try them again, or hand-write them into\n" +
        `${rel(HINT_FILE)}; either way the strings are re-checked by npm run hints:sql.`
    );
  }

  console.log("\nNext: npm run hints:sql, then load supabase/scale-hints-seed.sql.");
}

/**
 * One pair, or the reason it could not be done.
 *
 * The retry is the whole point of the loop: a first reply that breaks a rule
 * usually breaks one, in one band, and quoting the validator's own sentence back
 * is enough to fix it. Asking again with the same prompt would not be.
 */
async function writePair(scale: Scale, client: Client): Promise<HintEntry | string> {
  let complaints: string[] = [];
  let previous: HintEntry | null = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const prompt =
      attempt === 1 ? firstPrompt(scale) : retryPrompt(scale, previous, complaints);

    let raw: string;
    try {
      raw = await ask(prompt, client);
    } catch (err) {
      if (err instanceof Fatal) throw err;
      return `the API said: ${(err as Error).message}`;
    }

    const parsed = parseEntry(raw);
    if (typeof parsed === "string") {
      complaints = [parsed];
      previous = null;
      continue;
    }

    const problems = checkEntry(scale.key, parsed, scale);
    if (problems.length === 0) return parsed;

    complaints = problems;
    previous = parsed;
  }

  const shown = complaints.slice(0, 3).join(" | ");
  return `still illegal after ${ATTEMPTS} attempts — ${shown}`;
}

const SYSTEM = `You write the "starting idea" line for a Wavelength-style team game.

How the game works: a hidden target sits somewhere on a scale between two
opposite labels. One player — the clue-giver — can see where the target is and
says one short clue. The rest of the team then guess, from the clue alone, where
on that scale the clue points. Your job is to give the clue-giver a candidate
clue for one region of the scale, so that a player staring at an empty box has
somewhere to start.

So every line you write is a clue the player may well type in word for word. It
has to pass the game's own validator, and these rules are that validator:

1. NO NUMBERS, in any form at all. No digits. No numbers spelled out ("forty",
   "сорок"). No numbers welded into a word ("level5", "fiftyfive"). No vague
   numbers ("fiftyish", "in his forties"). No percentages, no ordinals, no
   fractions, and not the words "half", "halfway", "пів" or "половина". A line
   with a number in it is rejected by the game, and a rejected suggestion is
   worse than no suggestion at all.
2. At most ${MAX_CLUE_WORDS} words that carry meaning. Articles, prepositions and
   plain conjunctions do not count, but keep it short anyway: three or four words
   is the good length.
3. At most ${MAX_HINT_CHARS} characters.
4. Never use either pole label, or an obvious inflection of one. "quite hot" on a
   hot/cold scale tells the clue-giver nothing they cannot already read off their
   own screen.
5. A concrete image, never a degree. "very slightly" and "майже зовсім" say how
   much and not what, which is rule 4 wearing a hat. Name a thing, a moment or a
   situation the whole room can picture.
6. The five lines for one scale must be five genuinely different ideas, and they
   must sit in order along the scale.
7. Write the Ukrainian as a Ukrainian speaker would say it and the English as an
   English speaker would. They are two answers to the same question, not one
   answer translated — an idiom that only works in one language belongs in that
   language only.

Reply with the JSON object only. No prose, no code fence, no explanation.`;

/** The bands, described in words, so nothing in the ask leaks a number into the answer. */
function bandBrief(scale: Scale): string {
  const shape = [
    "squarely at the first end, about as far as the scale goes",
    "clearly toward the first end, but not the extreme",
    "genuinely in between, pulled neither way",
    "clearly toward the second end, but not the extreme",
    "squarely at the second end, about as far as the scale goes",
  ];
  return Array.from({ length: HINT_BANDS }, (_, b) => {
    const { min, max } = bandRange(b);
    return `  [${b}] ${min}-${max}: ${shape[b]}`;
  }).join("\n");
}

function firstPrompt(scale: Scale): string {
  return `Scale pair "${scale.key}":

  first end  (the low end)  — English: ${scale.l.en}   Ukrainian: ${scale.l.ua}
  second end (the high end) — English: ${scale.r.en}   Ukrainian: ${scale.r.ua}

The scale is cut into ${HINT_BANDS} bands. Write one line for each:

${bandBrief(scale)}

Aim at the middle of each band, not its edge. Guesses land close or they do not,
and a line that reads as the very edge of its band costs the team points that the
same idea, centred, would have won.

Those band bounds are for you. They must not appear in what you write.

Answer exactly this shape, in this order, replacing each slot:

{"ua": ["<band 0>", "<band 1>", "<band 2>", "<band 3>", "<band 4>"], "en": ["<band 0>", "<band 1>", "<band 2>", "<band 3>", "<band 4>"]}`;
}

function retryPrompt(
  scale: Scale,
  previous: HintEntry | null,
  complaints: string[]
): string {
  const attempt = previous
    ? `Your answer was:\n\n${JSON.stringify({ ua: previous.ua, en: previous.en })}\n\n`
    : "";

  return `${firstPrompt(scale)}

---

That was asked once already and the answer was rejected.

${attempt}The game's validator said:

${complaints.map((c) => `  - ${c}`).join("\n")}

Fix exactly those lines and keep the rest. Answer with the whole object again.`;
}

/**
 * The model's reply as an entry, or why it could not be read.
 *
 * Deliberately forgiving about the wrapping — a stray sentence or a code fence
 * around good JSON is not worth a retry — and completely unforgiving about the
 * contents, which `checkEntry` then re-checks from scratch.
 */
function parseEntry(raw: string): HintEntry | string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return `no JSON object in the reply: "${oneLine(raw)}"`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    return `the reply is not valid JSON (${(err as Error).message})`;
  }
  if (!parsed || typeof parsed !== "object") return "the reply is not an object";

  const entry: HintEntry = { ua: [], en: [] };
  for (const lang of ["ua", "en"] as const) {
    const list = (parsed as Record<string, unknown>)[lang];
    if (!Array.isArray(list)) return `the reply has no "${lang}" array`;
    // Length is not checked here on purpose: `checkEntry` says "expected 5, got
    // 4" in the same sentence shape as every other problem, and that sentence is
    // what goes into the retry.
    entry[lang] = list.map((item) => String(item ?? "").trim());
  }
  return entry;
}

/** One request. Retries the answers that mean "later"; raises `Fatal` for the rest. */
async function ask(prompt: string, client: Client): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(client.provider === "openai" ? OPENAI_URL : ANTHROPIC_URL, {
        method: "POST",
        headers: authHeaders(client),
        body: JSON.stringify(requestBody(prompt, client)),
      });
    } catch (err) {
      if (attempt >= HTTP_RETRIES) throw new Error(`no answer: ${(err as Error).message}`);
      await sleep(BACKOFF_MS * 2 ** attempt);
      continue;
    }

    if (res.ok) return readReply(await res.json(), client);

    const detail = oneLine(await res.text().catch(() => ""));

    // A 400 naming a parameter this script sent is the one 400 worth retrying:
    // the model is fine and the envelope was wrong, so drop or rename the field
    // and ask again. `negotiate` writes the answer into the shared quirks, so
    // this costs one request per run rather than one per pair.
    if (res.status === 400 && client.provider === "openai") {
      const dropped = negotiate(detail, client.quirks);
      if (dropped) {
        console.error(`  ! ${client.model} rejected ${dropped} — retrying without it`);
        continue;
      }
    }

    // 401 and 403 are the key; 400 and 404 are the request itself, which in
    // practice means a model name that does not exist. None of them improve on a
    // retry, and none of them are pair-specific.
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
      throw new Fatal(`HTTP ${res.status}: ${detail}`);
    }

    if (attempt >= HTTP_RETRIES) throw new Error(`HTTP ${res.status}: ${detail}`);
    await sleep(retryAfterMs(res) ?? BACKOFF_MS * 2 ** attempt);
  }
}

function authHeaders(client: Client): Record<string, string> {
  return client.provider === "openai"
    ? { "content-type": "application/json", authorization: `Bearer ${client.key}` }
    : {
        "content-type": "application/json",
        "x-api-key": client.key,
        "anthropic-version": ANTHROPIC_VERSION,
      };
}

/**
 * The same question in two envelopes. Anthropic takes the system prompt as its
 * own field; OpenAI takes it as the first message — and takes a JSON-mode flag,
 * which is worth asking for even though `parseEntry` already digs an object out
 * of prose, because a reply that cannot contain a stray sentence cannot spend a
 * retry on one.
 */
function requestBody(prompt: string, client: Client): Record<string, unknown> {
  if (client.provider === "anthropic") {
    return {
      model: client.model,
      max_tokens: MAX_TOKENS.anthropic,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    };
  }

  const body: Record<string, unknown> = {
    model: client.model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ],
    [client.quirks.tokenParam]: MAX_TOKENS.openai,
  };
  if (client.quirks.json) body.response_format = { type: "json_object" };
  return body;
}

/** The text out of whichever shape came back. */
function readReply(payload: unknown, client: Client): string {
  if (client.provider === "anthropic") {
    const body = payload as { content?: Array<{ type?: string; text?: string }> };
    return (body.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
  }

  const body = payload as {
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  };
  const choice = (body.choices ?? [])[0];
  const text = choice?.message?.content ?? "";

  // A reasoning model can spend the whole cap on thinking and return an empty
  // string with `finish_reason: "length"`. That is not this pair's fault and it
  // will happen on every other pair too, so it stops the run rather than
  // counting as one failure among two hundred.
  if (!text.trim() && choice?.finish_reason === "length") {
    throw new Fatal(
      `${client.model} used its entire ${MAX_TOKENS.openai}-token budget without answering, ` +
        "which is what a reasoning model does here. Pick a chat model with --model."
    );
  }
  return text;
}

/** Honours the server's own advice on when to come back, when it gives any. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) * 1000 : null;
}

/**
 * Which API, with which key, writing with which model — decided once, out loud.
 *
 * The order is: what you asked for, then what the model name implies, then
 * whichever key exists. That last one is the common case and the reason there is
 * no required flag: one key in `.env.local` is enough to run the script, and a
 * second key is the only situation where anything has to be said.
 */
async function resolveClient(args: Args, envFiles: string[]): Promise<Client> {
  const keys: Record<Provider, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };

  const provider =
    args.provider ??
    providerOf(args.model) ??
    (keys.anthropic ? "anthropic" : keys.openai ? "openai" : null);

  if (!provider) {
    const looked = envFiles.length > 0 ? envFiles.join(", ") : "none found";
    console.error(
      "No API key. This script needs one of ANTHROPIC_API_KEY or OPENAI_API_KEY.\n\n" +
        `Add one to .env.local in the project root — read: ${looked}\n\n` +
        "  ANTHROPIC_API_KEY=sk-ant-...      # console.anthropic.com → API keys\n" +
        "  OPENAI_API_KEY=sk-...             # platform.openai.com → API keys\n\n" +
        "Either is fine: the two are asked the same question and both answers are\n" +
        "checked by the game's own clue validator. This is the only thing in the repo\n" +
        "that uses a key at all; the running game never calls a model."
    );
    process.exit(1);
  }

  const key = keys[provider];
  if (!key) {
    const other: Provider = provider === "openai" ? "anthropic" : "openai";
    console.error(
      `${envKey(provider)} is not set, but ${envKey(other)} is.\n` +
        (args.provider
          ? `Drop --provider=${provider} to use it, or add the missing key.`
          : `The model name asks for ${provider}. Pass a ${other} model with --model, or add the missing key.`)
    );
    process.exit(1);
  }

  return {
    provider,
    key,
    model: args.model ?? (await defaultModel(provider, key)),
    quirks: freshQuirks(provider),
  };
}

/** The model when none was named: fixed for Anthropic, discovered for OpenAI. */
async function defaultModel(provider: Provider, key: string): Promise<string> {
  try {
    const model = provider === "anthropic" ? ANTHROPIC_MODEL : await bestOpenAIModel(key);
    console.log(`Using ${model} — override with --model.\n`);
    return model;
  } catch (err) {
    // A key that cannot list models cannot write hints either, and nothing has
    // been spent or saved at this point, so the run stops here with the API's own
    // sentence rather than turning it into two hundred identical failures.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const envKey = (provider: Provider): string =>
  provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";

/**
 * The best chat model this particular key can see.
 *
 * One request, before any pair goes out, so that a key without access to the
 * preferred model fails here with a list of what it does have rather than on
 * pair one with a bare 404. The choosing itself is `pickOpenAIModel`, which is
 * pure and tested; this function is only the request and the error message.
 */
async function bestOpenAIModel(key: string): Promise<string> {
  let ids: string[];
  try {
    const res = await fetch(OPENAI_MODELS_URL, { headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) {
      throw new Fatal(
        `Could not list models: HTTP ${res.status} ${oneLine(await res.text().catch(() => ""))}\n` +
          "A key that cannot read /v1/models cannot write hints either."
      );
    }
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    ids = (body.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  } catch (err) {
    if (err instanceof Fatal) throw err;
    throw new Fatal(`Could not reach the OpenAI API: ${(err as Error).message}`);
  }

  const chosen = pickOpenAIModel(ids);
  if (chosen) return chosen;

  throw new Fatal(
    "None of the models this script knows about are on your key. Name one with --model.\n" +
      `The key can see: ${usableChatModels(ids).slice(0, 12).join(", ") || "no chat models at all"}`
  );
}

function pickPairs(file: HintFileShape, args: Args): Scale[] {
  const wanted = args.only ? new Set(args.only) : null;

  if (wanted) {
    const known = new Set(SCALES.map((s) => s.key));
    for (const key of wanted) {
      if (!known.has(key)) console.error(`  ! --only names "${key}", which is not a scale key`);
    }
  }

  const queue = SCALES.filter((scale) => {
    if (wanted) return wanted.has(scale.key);
    if (args.force) return true;
    return !file.hints[scale.key];
  });

  return args.limit === null ? queue : queue.slice(0, args.limit);
}

/**
 * The `model` line is provenance, so a later regeneration can be compared with
 * what it replaced. A file that is part hand-written and part generated says so,
 * rather than crediting the model with somebody else's sentences.
 */
function creditModel(existing: string | undefined, model: string): string {
  if (!existing) return model;
  const parts = existing.split("+").map((p) => p.trim()).filter(Boolean);
  return parts.includes(model) ? existing : [...parts, model].join(" + ");
}

function readArgs(): Args {
  const argv = process.argv.slice(2);

  const value = (name: string): string | null => {
    const inline = argv.find((a) => a.startsWith(`--${name}=`));
    if (inline) return inline.slice(name.length + 3);
    const at = argv.indexOf(`--${name}`);
    const next = at >= 0 ? argv[at + 1] : undefined;
    return next && !next.startsWith("--") ? next : null;
  };

  const count = (name: string, fallback: number): number => {
    const raw = value(name);
    if (raw === null) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      console.error(`--${name} must be a whole number of at least one, got "${raw}"`);
      process.exit(1);
    }
    return n;
  };

  const only = value("only");

  // Narrowed through a conditional rather than checked in place: `value()`
  // returns `string`, and `!== "openai"` does not narrow a `string` to a literal
  // union, so the assignment to `Args.provider` needs the comparison to be the
  // thing that produces the type.
  const asked = value("provider") ?? process.env.HINT_PROVIDER ?? null;
  const provider: Provider | null =
    asked === "openai" || asked === "anthropic" ? asked : null;

  if (asked !== null && provider === null) {
    console.error(`--provider must be "openai" or "anthropic", got "${asked}"`);
    process.exit(1);
  }

  return {
    model: value("model") ?? process.env.HINT_MODEL ?? null,
    provider,
    jobs: count("jobs", DEFAULT_JOBS),
    limit: value("limit") === null ? null : count("limit", 0),
    only: only === null ? null : only.split(",").map((k) => k.trim()).filter(Boolean),
    force: argv.includes("--force"),
  };
}

/**
 * Minimal env-file reader: this script runs outside Next, which would otherwise
 * load these for you. Same order Next uses, most specific first, and the same
 * first-writer-wins rule — a value in .env.local beats the same key in .env.
 *
 * Returns the files it found, so a "not set" message can say where it looked.
 */
function loadEnvFiles(): string[] {
  const found: string[] = [];

  for (const file of [".env.local", ".env.development.local", ".env.development", ".env"]) {
    let text: string;
    try {
      text = readFileSync(resolve(process.cwd(), file), "utf8");
    } catch {
      continue; // Already-exported variables are fine too.
    }
    found.push(file);

    for (const line of text.split("\n")) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      if (process.env[key]) continue;
      process.env[key] = raw.replace(/^["']|["']$/g, "");
    }
  }

  return found;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** For quoting a reply or an error body into one line of log. */
const oneLine = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
};

const rel = (path: string): string => path.replace(`${process.cwd()}/`, "");

void main();
