/**
 * A short, stable, meaningless label for a device id.
 *
 * The leaderboard has a readability problem that no amount of aggregation
 * fixes: grouping by device id is already correct, so two different people who
 * both typed "Dmytro" are correctly two rows — but they are two rows with the
 * same label, and nobody looking at the table can tell which one is theirs.
 *
 * So each group gets a four-character tag derived from its device id. It is
 * shown only when a name is claimed by more than one group, because a tag on a
 * name nobody else uses is noise.
 *
 * Two properties matter and both are deliberate:
 *
 *   - It is a one-way hash, not a prefix of the id. Prefixes leak the actual
 *     id into every browser that opens the leaderboard; a hash leaks nothing
 *     while still being the same tag every time.
 *   - It is pure and shared, so the browser can hash its OWN device id and find
 *     its own row without the server ever telling it which row that is.
 *
 * Four characters over a 32-symbol alphabet is about a million possibilities.
 * That is not collision-proof and does not need to be: it only has to separate
 * the handful of people in one office who picked the same first name.
 */

/** No 0/O/1/I/L — the same reasoning as room codes: these get read aloud. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TAG_LEN = 4;

/**
 * FNV-1a, 32-bit. Chosen because it is six lines, needs no crypto API (so it
 * runs identically on the server and in an old mobile browser), and this is a
 * display label, not a security boundary.
 */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function playerTag(uid: string | null | undefined): string | null {
  if (!uid) return null;
  // Salted so the tag cannot be reversed by hashing a candidate id and
  // comparing — the salt is public, it just removes the free rainbow table.
  let h = fnv1a(`consensus-radar:${uid.trim().toLowerCase()}`);
  let out = "";
  for (let i = 0; i < TAG_LEN; i++) {
    out += ALPHABET[h % ALPHABET.length];
    h = Math.floor(h / ALPHABET.length) || fnv1a(out);
  }
  return out;
}
