/**
 * Which API to call, which model to name, and what to do when the API complains
 * about the envelope — the three decisions in the hint generator that are pure.
 *
 * They live here rather than in `gen-scale-hints.ts` for one blunt reason: that
 * file ends in `void main()`, so importing it runs it, which puts everything
 * inside it out of reach of a test. These three are the parts most worth
 * testing, because they decide where a two-hundred-and-sixty-two-request run
 * points and a wrong turn costs money rather than a red test.
 *
 * Nothing here touches the network, the filesystem or the clock.
 */

export type Provider = "anthropic" | "openai";

/**
 * The provider a model name gives away, when it gives one away.
 *
 * Deliberately a prefix test on the family name and not a list of models: a list
 * would be wrong within a quarter, and the point of the flag is that the user
 * knows a model this file has never heard of. `null` means "the name says
 * nothing", which is the caller's cue to fall back to whichever key exists.
 */
export function providerOf(model: string | null): Provider | null {
  if (!model) return null;
  if (/^claude/i.test(model)) return "anthropic";
  if (/^(gpt|chatgpt|o\d)/i.test(model)) return "openai";
  return null;
}

/**
 * What to reach for on an OpenAI key, best first, matched against the models the
 * key can actually see rather than assumed to exist.
 *
 * Hardcoding one name would be a guess with a shelf life: chat models get
 * renamed and retired faster than this repo gets touched, and a 404 on the first
 * pair reads like a broken script rather than a stale constant.
 */
export const OPENAI_PREFERENCE = ["gpt-5.2", "gpt-5.1", "gpt-5", "gpt-4.1", "gpt-4o"];

/** Ids that answer a different question entirely — audio, images, embeddings. */
export const OPENAI_NOT_CHAT =
  /audio|realtime|transcribe|tts|image|embedding|moderation|codex|davinci|babbage/;

/** The ids from `/v1/models` that could plausibly answer a chat request. */
export function usableChatModels(ids: string[]): string[] {
  return ids.filter(
    (id) => (id.startsWith("gpt-") || /^o\d/.test(id)) && !OPENAI_NOT_CHAT.test(id)
  );
}

/**
 * The best model in a list of ids, or null if the list has nothing known in it.
 *
 * Two passes. `-mini` and `-nano` are skipped on the first, because writing
 * idiomatic Ukrainian is what the small models are worst at and this catalogue is
 * half Ukrainian; they are allowed on the second, so a key that only has the
 * small models still runs rather than refusing to work at all.
 *
 * Within one preferred name, an exact id wins over a dated one, and the dated
 * ones are sorted so the newest wins — "gpt-5.2-2026-03-01" sorts after
 * "gpt-5.2-2026-01-01" because a fixed-width date sorts lexicographically. That
 * is also why a suffix like "-chat-latest" beats a date: letters sort after
 * digits, and a "latest" alias is the better default of the two.
 */
export function pickOpenAIModel(ids: string[]): string | null {
  const usable = usableChatModels(ids);

  const pick = (allow: (id: string) => boolean): string | null => {
    for (const wanted of OPENAI_PREFERENCE) {
      if (usable.includes(wanted) && allow(wanted)) return wanted;
      const dated = usable.filter((id) => id.startsWith(`${wanted}-`) && allow(id)).sort();
      if (dated.length > 0) return dated[dated.length - 1];
    }
    return null;
  };

  return pick((id) => !/mini|nano/.test(id)) ?? pick(() => true);
}

/**
 * The two things about an OpenAI request this script is willing to be wrong
 * about, and correct on the fly.
 */
export interface Quirks {
  /** OpenAI renamed this parameter; older models still only know the old name. */
  tokenParam: "max_completion_tokens" | "max_tokens";
  /** Whether to ask for JSON mode. Dropped if the model says it cannot. */
  json: boolean;
}

/** The envelope to start with. Anthropic ignores both fields. */
export function freshQuirks(provider: Provider): Quirks {
  return { tokenParam: "max_completion_tokens", json: provider === "openai" };
}

/**
 * Adjust the envelope in response to the API's own complaint, once.
 *
 * Both fields are optional to the job — the token cap has two accepted names
 * depending on the model's vintage, and JSON mode is a convenience — so a 400
 * naming one of them is worth one more request. Mutates `quirks` and returns
 * what it changed, or null when the 400 is about something this script cannot
 * fix, which is a real bad request and fatal.
 */
export function negotiate(detail: string, quirks: Quirks): string | null {
  // Note the substring: "max_completion_tokens" does not contain "max_tokens",
  // so testing for the name actually sent cannot match the advice OpenAI gives in
  // the opposite case ("use max_completion_tokens instead"), and the swap can
  // only ever run one way round — which is what stops the retry from looping.
  if (quirks.tokenParam === "max_completion_tokens" && detail.includes("max_completion_tokens")) {
    quirks.tokenParam = "max_tokens";
    return "max_completion_tokens";
  }
  if (quirks.json && detail.includes("response_format")) {
    quirks.json = false;
    return "response_format";
  }
  return null;
}
