/**
 * Backend service layer. Everything that touches the database lives here;
 * the route handlers in src/app/api are thin wrappers around these calls.
 */

import { admin } from "../supabase/admin";
import {
  AUTO_MARKER,
  BET_POINTS,
  MAX_PLAYERS,
  MIN_TEAMS,
  MIN_TEAM_SIZE,
  averageMarker,
  betIsCorrect,
  canSkipRound,
  cleanName,
  cleanTimerSeconds,
  cleanUid,
  clampSlider,
  clueGiverIsAway,
  deadlineFor,
  firstTeamIndexWithPlayers,
  foldCalibration,
  generateRoomCode,
  hostIsAway,
  leader,
  makeTeams,
  mayExpire,
  nextTeamIndex,
  pickClueGiver,
  pickNewHost,
  pickScale,
  playableTeams,
  randomTarget,
  randomToken,
  scoreFor,
  teamsAtGoal,
  underStaffedTeams,
  type Calibration,
  type StoredReveal,
} from "../game/engine";
import { clueErrorKey, validateClue } from "../game/clue";
import { t } from "../i18n";
import { scalePool } from "./scales";
import type {
  BetRow,
  BetSide,
  GuessRow,
  Identity,
  Lang,
  LiveGuess,
  Phase,
  Player,
  RevealDetail,
  Room,
  RoomState,
  Round,
  Team,
} from "../types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const CATEGORIES = ["general", "analytics"] as const;
const GOALS = [0, 15, 20, 25, 30];

const MIGRATION_HINT =
  "the database is missing part of supabase/schema.sql — run that file in the Supabase SQL editor";

/**
 * Insert that survives a database the latest schema.sql has not been run
 * against yet.
 *
 * PostgREST answers an unknown column with PGRST204 and names it in the
 * message. The columns listed in `optional` hold no rules — a device id for
 * grouping stats, a second language for the pole labels — so dropping one and
 * retrying is strictly better than refusing to let anybody into the room. The
 * warning in the log says what to run to get the column back.
 */
async function insertTolerant<T>(
  table: string,
  row: Record<string, unknown>,
  optional: string[]
): Promise<T> {
  let payload: Record<string, unknown> = { ...row };

  for (let attempt = 0; attempt <= optional.length; attempt++) {
    const { data, error } = await admin().from(table).insert(payload).select("*").maybeSingle();
    if (!error) return data as T;

    const missing = optional.find((col) => col in payload && namesMissingColumn(error, col));
    if (!missing) throw new ApiError(500, describe(error.message));

    console.warn(`[schema] public.${table}.${missing} is missing — ${MIGRATION_HINT}`);
    const next = { ...payload };
    delete next[missing];
    payload = next;
  }

  throw new ApiError(500, describe("insert failed"));
}

function namesMissingColumn(error: { code?: string; message: string }, column: string): boolean {
  return (
    (error.code === "PGRST204" || /schema cache|does not exist/i.test(error.message)) &&
    error.message.includes(column)
  );
}

/** Turns a bare Postgres complaint into one that says what to do about it. */
function describe(message: string): string {
  return /schema cache|does not exist|42P01|42703/i.test(message)
    ? `${message} — ${MIGRATION_HINT}`
    : message;
}

/**
 * A `phase_deadline` patch that stays silent on a database without the column.
 *
 * `insertTolerant` covers inserts by retrying; an UPDATE has no such second
 * chance, and naming a column PostgREST has never heard of fails the whole
 * statement — which would mean an un-migrated database could no longer take a
 * clue. So the field is only named when it has something to say: a real
 * deadline to set, or a stale one to clear. On a database without the column
 * the room reads back with no timer settings and the round with no deadline, so
 * both are false and the update goes out exactly as it did before timers
 * existed. Clearing matters as much as setting: a room that times the clue but
 * not the guess must have the old instant wiped on the way through, or the
 * guessers inherit a deadline that has already passed.
 */
function deadlinePatch(
  round: Pick<Round, "phase_deadline">,
  next: string | null
): { phase_deadline?: string | null } {
  const current = round.phase_deadline ?? null;
  return next === null && current === null ? {} : { phase_deadline: next };
}

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

export async function getRoom(code: string): Promise<Room> {
  const { data, error } = await admin().from("rooms").select("*").eq("code", code).maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, "Room not found");
  return data as Room;
}

export async function getPlayers(roomId: string): Promise<Player[]> {
  const { data, error } = await admin()
    .from("players")
    .select("*")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });
  if (error) throw new ApiError(500, error.message);
  return (data ?? []) as Player[];
}

async function getRound(roundId: string | null): Promise<Round | null> {
  if (!roundId) return null;
  const { data, error } = await admin().from("rounds").select("*").eq("id", roundId).maybeSingle();
  if (error) throw new ApiError(500, error.message);
  return (data as Round) ?? null;
}

export async function getState(code: string): Promise<RoomState> {
  const room = await getRoom(code);
  const [players, round] = await Promise.all([getPlayers(room.id), getRound(room.current_round_id)]);

  let guesses: GuessRow[] = [];
  let bets: BetRow[] = [];

  if (round) {
    const [g, b] = await Promise.all([
      admin().from("guesses").select("*").eq("round_id", round.id),
      admin().from("bets").select("*").eq("round_id", round.id),
    ]);
    if (g.error) throw new ApiError(500, g.error.message);
    if (b.error) throw new ApiError(500, b.error.message);
    guesses = (g.data ?? []) as GuessRow[];
    bets = (b.data ?? []) as BetRow[];
  }

  // Device ids are for grouping stats, not for showing to the table. They are
  // not credentials, but there is no reason for one player's browser to learn
  // another's, so they never leave the server.
  const publicPlayers = players.map((p) => ({ ...p, player_uid: null }));

  // The server's clock travels with the payload so the countdown can correct
  // for a phone that is wrong. Cheap — it is read here, not queried — and it is
  // the difference between a timer that agrees across a table and one that fires
  // early on whichever device has the worst clock.
  return {
    room,
    players: publicPlayers,
    round,
    guesses,
    bets,
    now: new Date().toISOString(),
  };
}

/**
 * Per-player calibration for the game just finished.
 *
 * Its own endpoint rather than part of `getState`, because every open tab
 * refetches the state every fifteen seconds and this is read once, on the
 * winner screen. Folding it in would buy a nicer client at the cost of an extra
 * query on every poll of every game.
 *
 * No credentials: the reveal detail this is built from was shown to the whole
 * table, round by round, as it happened. Nothing here is new information.
 *
 * Scoped by `room_id`, which is also what scopes it to *this* game — `playAgain`
 * deletes the room's rounds, so a rematch starts from an empty fold rather than
 * inheriting the last game's averages.
 */
export async function roomSummary(code: string): Promise<{
  code: string;
  rounds: number;
  players: Calibration[];
}> {
  const room = await getRoom(code);
  const { data, error } = await admin()
    .from("rounds")
    .select("reveal_detail")
    .eq("room_id", room.id)
    .not("reveal_detail", "is", null)
    .order("round_no", { ascending: true });
  if (error) throw new ApiError(500, error.message);

  const details = (data ?? []).map((r) => (r as { reveal_detail: StoredReveal | null }).reveal_detail);
  return { code: room.code, rounds: details.length, players: foldCalibration(details) };
}

/** Validates the device token and returns the room + the player it belongs to. */
export async function authenticate(
  code: string,
  playerId: string,
  token: string
): Promise<{ room: Room; player: Player }> {
  if (!playerId || !token) throw new ApiError(401, "Missing player credentials");

  const room = await getRoom(code);

  const { data: player, error } = await admin()
    .from("players")
    .select("*")
    .eq("id", playerId)
    .eq("room_id", room.id)
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!player) throw new ApiError(401, "You are not in this room");

  const { data: tok } = await admin()
    .from("player_tokens")
    .select("token")
    .eq("player_id", playerId)
    .maybeSingle();
  if (!tok || tok.token !== token) throw new ApiError(401, "Invalid player token");

  await admin()
    .from("players")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", playerId);

  return { room, player: player as Player };
}

/**
 * "Am I still in this room?"
 *
 * The one question a client must not answer for itself. A room state with no
 * row for me can mean two very different things — the join never landed, or
 * the response was already on the wire when it did — and only the server can
 * tell them apart. Asking cost us a bug once: the client guessed, guessed
 * wrong, threw away a perfectly good identity, and bounced the player back to
 * the join screen in a loop.
 */
export async function membership(code: string, playerId: string, token: string) {
  const { player } = await authenticate(code, playerId, token);
  return { ok: true, playerId: player.id, name: player.name, teamId: player.team_id };
}

// ---------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------

export interface CreateRoomInput {
  hostName?: unknown;
  teamNames?: unknown;
  categories?: unknown;
  goal?: unknown;
  betsEnabled?: unknown;
  lang?: unknown;
  uid?: unknown;
}

export async function createRoom(input: CreateRoomInput): Promise<{ state: RoomState; identity: Identity }> {
  const teams = makeTeams(input.teamNames);

  const rawCats = Array.isArray(input.categories) ? input.categories : [];
  const categories = CATEGORIES.filter((c) => rawCats.includes(c));
  if (categories.length === 0) categories.push(...CATEGORIES);

  const goalNum = Number(input.goal);
  const goal = GOALS.includes(goalNum) ? goalNum : 20;
  const lang: Lang = input.lang === "en" ? "en" : "ua";

  // Retry on the (unlikely) code collision.
  let room: Room | null = null;
  for (let attempt = 0; attempt < 8 && !room; attempt++) {
    const code = generateRoomCode(attempt < 5 ? 4 : 5);
    const { data, error } = await admin()
      .from("rooms")
      .insert({
        code,
        status: "lobby",
        lang,
        categories,
        goal,
        bets_enabled: input.betsEnabled !== false,
        teams,
        active_team_index: 0,
        round_no: 0,
      })
      .select("*")
      .maybeSingle();

    if (error) {
      if (error.code === "23505" || /duplicate key/i.test(error.message)) continue;
      throw new ApiError(500, error.message);
    }
    room = data as Room;
  }
  if (!room) throw new ApiError(500, "Could not allocate a room code, please retry");

  const identity = await insertPlayer(
    room,
    cleanName(input.hostName, "Host"),
    teams[0].id,
    true,
    cleanUid(input.uid)
  );
  await admin().from("rooms").update({ host_player_id: identity.playerId }).eq("id", room.id);

  return { state: await getState(room.code), identity };
}

async function insertPlayer(
  room: Room,
  name: string,
  teamId: string | null,
  isHost: boolean,
  uid: string | null
): Promise<Identity> {
  const player = await insertTolerant<Player>(
    "players",
    { room_id: room.id, name, player_uid: uid, team_id: teamId, is_host: isHost },
    ["player_uid"]
  );

  const token = randomToken();
  const { error: tokErr } = await admin()
    .from("player_tokens")
    .insert({ player_id: player.id, token });
  if (tokErr) throw new ApiError(500, tokErr.message);

  await touch(room.id);
  return { roomCode: room.code, playerId: player.id, token, name: player.name };
}

export async function joinRoom(
  code: string,
  name: unknown,
  teamId: unknown,
  uid: unknown
): Promise<{ state: RoomState; identity: Identity }> {
  const room = await getRoom(code);
  if (room.status === "finished") throw new ApiError(409, "This game has already finished");

  const players = await getPlayers(room.id);
  const wanted = typeof teamId === "string" ? teamId : null;
  const device = cleanUid(uid);

  // One device gets one seat per room. Joining twice from the same browser is
  // not a second player, it is the same person trying again — because the
  // network dropped the first answer, or because the tab lost its identity, or
  // because they simply reloaded. Handing back the seat they already own is the
  // difference between that being a non-event and it being the bug that filled
  // a lobby with eleven copies of the same person, each with another " 2"
  // stapled to their name.
  const seat = findSeat(players, device);
  if (seat) return { state: await getState(room.code), identity: await reissue(room, seat, wanted) };

  if (players.length >= MAX_PLAYERS) throw new ApiError(409, "This room is full");

  const team =
    room.teams.find((t) => t.id === wanted) ?? smallestTeam(room.teams, players) ?? room.teams[0];

  const cleaned = cleanName(name, `Player ${players.length + 1}`);
  const identity = await insertPlayer(room, uniqueName(cleaned, players), team.id, false, device);

  return { state: await getState(room.code), identity };
}

/**
 * The seat this device already holds in the room, if any.
 *
 * Only the device id can answer this. A name cannot: two people called Anton
 * are two players, and letting a name claim a seat would let anyone take over
 * anyone else's by typing it. A database that predates the `player_uid` column
 * has no device ids to match, so this finds nothing and the caller falls back
 * to creating a seat — the old behaviour, which is the right one there.
 */
export function findSeat(players: Player[], uid: string | null): Player | null {
  if (!uid) return null;
  return players.find((p) => p.player_uid === uid) ?? null;
}

/**
 * Re-admits a player to the seat they already own: a new token (the old one is
 * on a device that has lost it, or is the same device asking again), and the
 * team they asked for if the lobby is still open. The name is deliberately not
 * touched — the rest of the table already knows them by it.
 */
async function reissue(room: Room, player: Player, wantedTeam: string | null): Promise<Identity> {
  const token = randomToken();
  const { error } = await admin()
    .from("player_tokens")
    .upsert({ player_id: player.id, token }, { onConflict: "player_id" });
  if (error) throw new ApiError(500, error.message);

  const team =
    room.status === "lobby" && wantedTeam ? room.teams.find((t) => t.id === wantedTeam) : undefined;

  const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
  if (team && team.id !== player.team_id) patch.team_id = team.id;
  await admin().from("players").update(patch).eq("id", player.id);

  await touch(room.id);
  return { roomCode: room.code, playerId: player.id, token, name: player.name };
}

function uniqueName(name: string, players: Player[]): string {
  const taken = new Set(players.map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 50; i++) {
    const candidate = `${name} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${name} ${Date.now() % 1000}`;
}

function smallestTeam(teams: Team[], players: Player[]): Team | null {
  if (teams.length === 0) return null;
  const counts = teams.map((t) => players.filter((p) => p.team_id === t.id).length);
  let best = 0;
  for (let i = 1; i < teams.length; i++) if (counts[i] < counts[best]) best = i;
  return teams[best];
}

export async function switchTeam(code: string, playerId: string, token: string, teamId: unknown) {
  const { room, player } = await authenticate(code, playerId, token);
  if (room.status !== "lobby") throw new ApiError(409, "Teams are locked once the game starts");

  const team = room.teams.find((t) => t.id === teamId);
  if (!team) throw new ApiError(400, "Unknown team");

  await admin().from("players").update({ team_id: team.id }).eq("id", player.id);
  await touch(room.id);
  return getState(code);
}

export async function updateSettings(
  code: string,
  playerId: string,
  token: string,
  patch: {
    categories?: unknown;
    goal?: unknown;
    betsEnabled?: unknown;
    lang?: unknown;
    teamNames?: unknown;
    clueSeconds?: unknown;
    guessSeconds?: unknown;
  }
) {
  const { room, player } = await authenticate(code, playerId, token);
  requireHost(room, player);
  if (room.status !== "lobby") throw new ApiError(409, "Settings are locked once the game starts");

  const update: Record<string, unknown> = {};

  if (patch.categories !== undefined) {
    const raw = Array.isArray(patch.categories) ? patch.categories : [];
    const cats = CATEGORIES.filter((c) => raw.includes(c));
    update.categories = cats.length > 0 ? cats : [...CATEGORIES];
  }
  if (patch.goal !== undefined) {
    const g = Number(patch.goal);
    update.goal = GOALS.includes(g) ? g : room.goal;
  }
  if (patch.betsEnabled !== undefined) update.bets_enabled = patch.betsEnabled !== false;
  if (patch.lang !== undefined) update.lang = patch.lang === "en" ? "en" : "ua";

  // Clamped to the offered set rather than validated: anything unrecognised
  // becomes "no clock", which is the only wrong answer that cannot strand a
  // table waiting on a deadline it never asked for. The clamp lives here and not
  // in a check constraint because the column had to be addable to a live table.
  if (patch.clueSeconds !== undefined) update.clue_seconds = cleanTimerSeconds(patch.clueSeconds);
  if (patch.guessSeconds !== undefined) update.guess_seconds = cleanTimerSeconds(patch.guessSeconds);

  if (patch.teamNames !== undefined && Array.isArray(patch.teamNames)) {
    const names = patch.teamNames as unknown[];
    update.teams = room.teams.map((t, i) => ({
      ...t,
      name: names[i] !== undefined ? cleanName(names[i], t.name) : t.name,
    }));
  }

  if (Object.keys(update).length > 0) {
    update.updated_at = new Date().toISOString();
    const { error } = await admin().from("rooms").update(update).eq("id", room.id);
    if (error) throw new ApiError(500, error.message);
  }
  return getState(code);
}

export async function startGame(code: string, playerId: string, token: string) {
  const { room, player } = await authenticate(code, playerId, token);
  requireHost(room, player);
  if (room.status === "playing") return getState(code);
  if (room.status === "finished") throw new ApiError(409, "Game already finished");

  // The lobby disables the Start button under the same rule, so reaching this
  // means a stale client or a direct API call. Both get a specific message
  // rather than a generic 400, because the fix is different in each case.
  const players = await getPlayers(room.id);
  const playable = playableTeams(room.teams, players, MIN_TEAM_SIZE);
  const short = underStaffedTeams(room.teams, players, MIN_TEAM_SIZE);
  if (short.length > 0) {
    throw new ApiError(
      400,
      `Every team needs at least ${MIN_TEAM_SIZE} players — the clue-giver does not guess. ` +
        `Too small: ${short.map((t) => t.name).join(", ")}`
    );
  }
  if (playable.length < MIN_TEAMS) {
    throw new ApiError(
      400,
      `At least ${MIN_TEAMS} teams need ${MIN_TEAM_SIZE} players each before the game can start`
    );
  }

  const first = firstTeamIndexWithPlayers(room.teams, players, MIN_TEAM_SIZE) ?? 0;
  await admin()
    .from("rooms")
    .update({
      status: "playing",
      active_team_index: first,
      round_no: 0,
      teams: room.teams.map((t) => ({ ...t, score: 0 })),
      winner_team_name: null,
      finished_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", room.id);

  await openRound(await getRoom(code));
  return getState(code);
}

/** Creates the next round for whichever team is currently active. */
async function openRound(room: Room): Promise<Round> {
  const players = await getPlayers(room.id);
  const team = room.teams[room.active_team_index];
  if (!team) throw new ApiError(500, "Active team is missing");

  const teamPlayers = players.filter((p) => p.team_id === team.id);
  const giver = pickClueGiver(teamPlayers);
  if (!giver) throw new ApiError(409, "The active team has no players");

  const [{ data: used }, pool] = await Promise.all([
    admin().from("rounds").select("scale_key").eq("room_id", room.id),
    scalePool(room.categories),
  ]);
  const usedKeys = (used ?? []).map((r: { scale_key: string }) => r.scale_key);
  const scale = pickScale(pool, usedKeys);

  const roundNo = room.round_no + 1;
  const round = await insertTolerant<Round>(
    "rounds",
    {
      room_id: room.id,
      round_no: roundNo,
      team_id: team.id,
      team_name: team.name,
      clue_giver_id: giver.id,
      clue_giver_name: giver.name,
      scale_key: scale.key,
      // Both languages are copied onto the round: the pair can later be
      // reworded or retired without changing how this game reads.
      scale_left: scale.l.en,
      scale_right: scale.r.en,
      scale_left_ua: scale.l.ua,
      scale_right_ua: scale.r.ua,
      phase: "clue",
      // The clue clock starts the moment the round exists, not when the
      // clue-giver first looks at it: there is no "opened the screen" event to
      // hang it on, and a deadline that waited for one would never arrive on a
      // phone that stayed in a pocket — which is the case the clock is for.
      // Null when the room has no clue limit, which is the default.
      phase_deadline: deadlineFor(room, "clue", Date.now()),
    },
    ["scale_left_ua", "scale_right_ua", "phase_deadline"]
  );

  const { error: secretErr } = await admin()
    .from("round_secrets")
    .insert({ round_id: round.id, target: randomTarget() });
  if (secretErr) throw new ApiError(500, secretErr.message);

  await admin().from("players").update({ clue_turns: giver.clue_turns + 1 }).eq("id", giver.id);

  const { error: roomErr } = await admin()
    .from("rooms")
    .update({ current_round_id: round.id, round_no: roundNo, updated_at: new Date().toISOString() })
    .eq("id", room.id);
  if (roomErr) throw new ApiError(500, roomErr.message);

  return round;
}

// ---------------------------------------------------------------------
// Round play
// ---------------------------------------------------------------------

/** Only the clue-giver of the current round may read the target. */
export async function getSecretTarget(code: string, playerId: string, token: string) {
  const { room, player } = await authenticate(code, playerId, token);
  const round = await getRound(room.current_round_id);
  if (!round) throw new ApiError(409, "No round in progress");
  if (round.clue_giver_id !== player.id) {
    throw new ApiError(403, "Only the clue-giver can see the secret spot");
  }

  const { data, error } = await admin()
    .from("round_secrets")
    .select("target")
    .eq("round_id", round.id)
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(500, "Round secret is missing");

  return { roundId: round.id, target: data.target as number };
}

/**
 * The active team's markers while the round is still open, for a player who is
 * entitled to watch them.
 *
 * Who that is, and why:
 *
 *   - the other teams, yes. They have to bet on which side of the marker the
 *     secret sits, and in the board game they can see exactly where the dial
 *     was left before they call it. Hiding the markers made that bet a coin
 *     flip; showing them makes it a judgement.
 *   - the active team, no — not even the clue-giver. Each guesser placing a
 *     marker without seeing their teammates' is the whole mechanic: the score
 *     comes from the average, so a guesser who can see the others would anchor
 *     on them and the round would measure agreement instead of calibration.
 *
 * Served from its own endpoint, like the secret target, rather than added to
 * `RoomState`. The room state is one payload built once and handed to
 * everybody, so anything only some players may see cannot live in it; the
 * values stay in `guess_values`, which `getState` never reads.
 */
export async function getLiveGuesses(
  code: string,
  playerId: string,
  token: string
): Promise<{ roundId: string; guesses: LiveGuess[] }> {
  const { room, player } = await authenticate(code, playerId, token);
  const round = await requireCurrentRound(room);
  if (round.phase !== "guess") throw new ApiError(409, "The round is not taking guesses");
  if (player.team_id === round.team_id) {
    throw new ApiError(403, "Your own team's markers stay hidden until the reveal");
  }

  const { data: rows, error } = await admin()
    .from("guesses")
    .select("id, player_id, player_name, submitted_at")
    .eq("round_id", round.id)
    .eq("team_id", round.team_id)
    .order("submitted_at", { ascending: true });
  if (error) throw new ApiError(500, error.message);

  const ids = (rows ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) return { roundId: round.id, guesses: [] };

  const { data: vals, error: valErr } = await admin()
    .from("guess_values")
    .select("guess_id, value")
    .in("guess_id", ids);
  if (valErr) throw new ApiError(500, valErr.message);

  const byGuess = new Map<string, number>();
  for (const v of (vals ?? []) as { guess_id: string; value: number }[]) {
    byGuess.set(v.guess_id, v.value);
  }

  // A guess row with no value is a half-finished write, not a marker at zero,
  // so it is dropped rather than drawn in the wrong place.
  const guesses = (rows ?? [])
    .map((r: { id: string; player_id: string; player_name: string }) => {
      const value = byGuess.get(r.id);
      return value === undefined
        ? null
        : { player_id: r.player_id, player_name: r.player_name, value };
    })
    .filter((g): g is LiveGuess => g !== null);

  return { roundId: round.id, guesses };
}

export async function submitClue(code: string, playerId: string, token: string, clue: unknown) {
  const { room, player } = await authenticate(code, playerId, token);
  const round = await requireCurrentRound(room);
  if (round.clue_giver_id !== player.id) throw new ApiError(403, "You are not the clue-giver");
  if (round.phase !== "clue") throw new ApiError(409, "The clue was already given");

  // The same validator the input box runs, so a player who gets past the form
  // — an old tab, a replayed request, a hand-rolled call — meets exactly the
  // rule they were shown rather than a looser one. Rendered in the room's
  // language because that is the only language this response has.
  const check = validateClue(clue);
  if (!check.ok) {
    const { key, vars } = clueErrorKey(check);
    throw new ApiError(400, t(room.lang, key, vars));
  }
  const text = check.clue;

  const { error } = await admin()
    .from("rounds")
    .update({
      clue: text,
      phase: "guess",
      // The guess clock starts now, not when the round opened: the guessers
      // could not have begun before the clue existed, and a deadline measured
      // from the round's birth would hand a slow clue-giver's leftovers — or
      // nothing at all — to the people who had no way to act sooner.
      ...deadlinePatch(round, deadlineFor(room, "guess", Date.now())),
    })
    .eq("id", round.id)
    .eq("phase", "clue");
  if (error) throw new ApiError(500, error.message);

  await touch(room.id);
  return getState(code);
}

export async function submitGuess(code: string, playerId: string, token: string, value: unknown) {
  const { room, player } = await authenticate(code, playerId, token);
  const round = await requireCurrentRound(room);
  if (round.phase !== "guess") throw new ApiError(409, "Not accepting guesses right now");
  if (player.team_id !== round.team_id) throw new ApiError(403, "Only the active team guesses");
  if (player.id === round.clue_giver_id) throw new ApiError(403, "The clue-giver does not guess");

  const v = clampSlider(value);
  if (v === null) throw new ApiError(400, "Invalid marker position");

  const { data: guess, error } = await admin()
    .from("guesses")
    .upsert(
      {
        round_id: round.id,
        room_id: room.id,
        player_id: player.id,
        player_name: player.name,
        team_id: player.team_id,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "round_id,player_id" }
    )
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);

  const { error: valErr } = await admin()
    .from("guess_values")
    .upsert({ guess_id: (guess as { id: string }).id, value: v }, { onConflict: "guess_id" });
  if (valErr) throw new ApiError(500, valErr.message);

  await touch(room.id);
  await maybeAutoReveal(room, round);
  return getState(code);
}

export async function submitBet(code: string, playerId: string, token: string, side: unknown) {
  const { room, player } = await authenticate(code, playerId, token);
  if (!room.bets_enabled) throw new ApiError(409, "Side bets are disabled in this room");
  const round = await requireCurrentRound(room);
  if (round.phase !== "guess") throw new ApiError(409, "Not accepting bets right now");
  if (player.team_id === round.team_id) throw new ApiError(403, "The guessing team cannot bet");
  if (side !== "left" && side !== "right") throw new ApiError(400, "Bet must be left or right");

  const { error } = await admin().from("bets").upsert(
    {
      round_id: round.id,
      room_id: room.id,
      player_id: player.id,
      player_name: player.name,
      team_id: player.team_id,
      side,
      submitted_at: new Date().toISOString(),
    },
    { onConflict: "round_id,player_id" }
  );
  if (error) throw new ApiError(500, error.message);

  await touch(room.id);
  await maybeAutoReveal(room, round);
  return getState(code);
}

/** Reveals as soon as everyone who can act has acted. */
async function maybeAutoReveal(room: Room, round: Round): Promise<void> {
  const players = await getPlayers(room.id);

  const guessers = players.filter((p) => p.team_id === round.team_id && p.id !== round.clue_giver_id);
  const bettors = room.bets_enabled
    ? players.filter((p) => p.team_id && p.team_id !== round.team_id)
    : [];

  const [{ data: gs }, { data: bs }] = await Promise.all([
    admin().from("guesses").select("player_id").eq("round_id", round.id),
    admin().from("bets").select("player_id").eq("round_id", round.id),
  ]);

  const guessed = new Set((gs ?? []).map((g: { player_id: string }) => g.player_id));
  const bet = new Set((bs ?? []).map((b: { player_id: string }) => b.player_id));

  const allGuessed = guessers.length > 0 && guessers.every((p) => guessed.has(p.id));
  const allBet = bettors.every((p) => bet.has(p.id));

  if (allGuessed && allBet) await revealRound(room, round);
}

/**
 * Force the reveal (host button) — used when someone is idle, or when the
 * active team is a single player who is also the clue-giver.
 */
export async function forceReveal(code: string, playerId: string, token: string) {
  const { room, player } = await authenticate(code, playerId, token);
  const round = await requireCurrentRound(room);
  const mayReveal = player.is_host || player.id === round.clue_giver_id;
  if (!mayReveal) throw new ApiError(403, "Only the host or the clue-giver can reveal");
  if (round.phase === "clue") throw new ApiError(409, "The clue has not been given yet");
  if (round.phase === "reveal") return getState(code);

  await revealRound(room, round);
  return getState(code);
}

/**
 * Scores the round, updates the scoreboard, persists stats. Idempotent.
 *
 * `timedOut` only annotates: it is recorded in the detail so the reveal card can
 * say that some of the markers were placed by the clock rather than by people,
 * and it changes nothing about how the round is scored. That is the whole point
 * of filling the missing markers in — the round is played out, not written off.
 */
async function revealRound(room: Room, round: Round, timedOut?: Phase): Promise<void> {
  // Claim the reveal: only one concurrent request wins this update.
  const { data: claimed, error: claimErr } = await admin()
    .from("rounds")
    .update({ phase: "reveal" })
    .eq("id", round.id)
    .eq("phase", "guess")
    .select("id")
    .maybeSingle();
  if (claimErr) throw new ApiError(500, claimErr.message);
  if (!claimed) return; // someone else already revealed it

  const { data: secret } = await admin()
    .from("round_secrets")
    .select("target")
    .eq("round_id", round.id)
    .maybeSingle();
  const target = (secret?.target as number | undefined) ?? 50;

  const { data: guessRows } = await admin()
    .from("guesses")
    .select("id, player_id, player_name, team_id")
    .eq("round_id", round.id);
  const ids = (guessRows ?? []).map((g: { id: string }) => g.id);

  const { data: valueRows } = ids.length
    ? await admin().from("guess_values").select("guess_id, value").in("guess_id", ids)
    : { data: [] as { guess_id: string; value: number }[] };

  const valueByGuess = new Map(
    (valueRows ?? []).map((v: { guess_id: string; value: number }) => [v.guess_id, v.value])
  );

  const detailGuesses = (guessRows ?? [])
    .map((g: { id: string; player_id: string; player_name: string }) => {
      const value = valueByGuess.get(g.id);
      if (value === undefined) return null;
      return {
        player_id: g.player_id,
        player_name: g.player_name,
        value,
        distance: Math.abs(target - value),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.distance - b.distance);

  const marker = averageMarker(detailGuesses.map((g) => g.value));
  const { pts } = scoreFor(target, marker);
  const distance = Math.round(Math.abs(target - marker) * 10) / 10;

  // Side bets
  const { data: betRows } = await admin()
    .from("bets")
    .select("player_id, player_name, team_id, side")
    .eq("round_id", round.id);

  const detailBets = (betRows ?? []).map(
    (b: { player_id: string; player_name: string; team_id: string; side: BetSide }) => ({
      player_id: b.player_id,
      player_name: b.player_name,
      team_id: b.team_id,
      side: b.side,
      correct: betIsCorrect(target, marker, b.side),
    })
  );

  // Points per team: active team gets the band score; other teams get one
  // point if the majority of their players called the side correctly.
  const teamPoints: Record<string, number> = {};
  for (const team of room.teams) teamPoints[team.id] = 0;
  teamPoints[round.team_id] = pts;

  for (const team of room.teams) {
    if (team.id === round.team_id) continue;
    const mine = detailBets.filter((b) => b.team_id === team.id);
    if (mine.length === 0) continue;
    const right = mine.filter((b) => b.correct).length;
    if (right * 2 > mine.length) teamPoints[team.id] += BET_POINTS;
  }

  const teams = room.teams.map((team) => ({
    ...team,
    score: team.score + (teamPoints[team.id] ?? 0),
  }));
  const detail: RevealDetail = {
    guesses: detailGuesses,
    bets: detailBets,
    team_points: teamPoints,
    // Spread rather than set to undefined: this row is serialised to jsonb, and
    // an explicit `"timed_out": null` on every ordinary round would be a field
    // the reveal card has to learn to ignore.
    ...(timedOut ? { timed_out: timedOut } : {}),
  };

  const { error: roundErr } = await admin()
    .from("rounds")
    .update({
      marker,
      distance,
      points: pts,
      revealed_target: target,
      reveal_detail: detail,
      revealed_at: new Date().toISOString(),
      // The reveal is never timed, so the clock goes away here rather than
      // being left to count into the negative behind the result card.
      ...deadlinePatch(round, null),
    })
    .eq("id", round.id);
  if (roundErr) throw new ApiError(500, roundErr.message);

  // Durable per-player stats (these outlive the room). Each row carries the
  // device id as well as the name, so the leaderboard can recognise a
  // returning player instead of treating every game as a new stranger.
  const roster = await getPlayers(room.id);
  const uidOf = new Map(roster.map((p) => [p.id, p.player_uid ?? null]));

  const stats: Record<string, unknown>[] = [];
  if (round.clue_giver_name) {
    stats.push({
      round_id: round.id,
      room_code: room.code,
      player_name: round.clue_giver_name,
      player_uid: round.clue_giver_id ? uidOf.get(round.clue_giver_id) ?? null : null,
      role: "clue",
      distance,
      points: pts,
      scale_key: round.scale_key,
    });
  }
  for (const g of detailGuesses) {
    stats.push({
      round_id: round.id,
      room_code: room.code,
      player_name: g.player_name,
      player_uid: uidOf.get(g.player_id) ?? null,
      role: "guess",
      distance: g.distance,
      points: scoreFor(target, g.value).pts,
      scale_key: round.scale_key,
    });
  }
  for (const b of detailBets) {
    stats.push({
      round_id: round.id,
      room_code: room.code,
      player_name: b.player_name,
      player_uid: uidOf.get(b.player_id) ?? null,
      role: "bet",
      distance: null,
      points: b.correct ? BET_POINTS : 0,
      scale_key: round.scale_key,
    });
  }
  if (stats.length > 0) {
    const { error: statErr } = await admin().from("player_round_stats").insert(stats);
    // Stats are a nice-to-have; a reveal must never fail because of them. On a
    // database without the device-id column, write the rows without it.
    if (statErr && namesMissingColumn(statErr, "player_uid")) {
      console.warn(`[schema] public.player_round_stats.player_uid is missing — ${MIGRATION_HINT}`);
      const stripped = stats.map(({ player_uid: _drop, ...rest }) => rest);
      await admin().from("player_round_stats").insert(stripped);
    } else if (statErr) {
      console.error("[consensus-radar] stats insert failed", statErr.message);
    }
  }

  const reached = teamsAtGoal(teams, room.goal);
  if (reached.length > 0) {
    await finishGame({ ...room, teams }, teams);
  } else {
    const { error } = await admin()
      .from("rooms")
      .update({ teams, updated_at: new Date().toISOString() })
      .eq("id", room.id);
    if (error) throw new ApiError(500, error.message);
  }
}

export async function nextRound(code: string, playerId: string, token: string) {
  const { room, player } = await authenticate(code, playerId, token);
  if (room.status === "finished") return getState(code);

  const round = await requireCurrentRound(room);
  if (round.phase !== "reveal") throw new ApiError(409, "The current round is not finished");

  const mayAdvance = player.is_host || player.id === round.clue_giver_id;
  if (!mayAdvance) throw new ApiError(403, "Only the host or the clue-giver can start the next round");

  const next = nextPlayableTeam(room, await getPlayers(room.id));

  const { error } = await admin()
    .from("rooms")
    .update({ active_team_index: next, updated_at: new Date().toISOString() })
    .eq("id", room.id);
  if (error) throw new ApiError(500, error.message);

  await openRound(await getRoom(code));
  return getState(code);
}

/**
 * Abandon the round in progress and deal a fresh one to the next team.
 *
 * The rescue hatch for the one state the game cannot play its way out of: the
 * clue never arrives. Reveal refuses a round with no clue (correctly — there is
 * nothing to score), so before this existed the only way past a clue-giver who
 * had closed their tab was for the host to end the game, which throws away the
 * scoreboard and writes a result nobody played for.
 *
 * The scoreboard is deliberately untouched: nothing about this round is scored,
 * for either the guessing team or the bettors. The round row is deleted rather
 * than kept as a blank, so it never lands in `game_results.rounds_played`, the
 * hardest-scales view, or a player's average.
 */
export async function skipRound(code: string, playerId: string, token: string) {
  const { room, player } = await authenticate(code, playerId, token);
  if (room.status !== "playing") throw new ApiError(409, "No game in progress");

  const round = await requireCurrentRound(room);
  if (!canSkipRound(round.phase)) {
    throw new ApiError(409, "This round is already revealed — start the next one instead");
  }

  // Who may. The host and the clue-giver always, as with reveal and next —
  // plus, in the clue phase only, anybody in the room once the clue-giver has
  // gone quiet. That last clause is what actually unsticks the dead end: the
  // people staring at the empty dial are usually neither the host nor the
  // clue-giver, and it is safe precisely there, because before a clue exists
  // the round holds nothing worth protecting. In the guess phase markers are
  // already down, so it stays with the host — who has `reveal` as the gentler
  // option anyway.
  const players = await getPlayers(room.id);
  const maySkip =
    player.is_host ||
    player.id === round.clue_giver_id ||
    (round.phase === "clue" && clueGiverIsAway(players, round.clue_giver_id, Date.now()));
  if (!maySkip) throw new ApiError(403, "Only the host or the clue-giver can skip the round");

  // Chosen before anything is destroyed, so a room where no team can play is
  // refused with its round intact rather than left with none.
  const next = nextPlayableTeam(room, players);

  // Claimed by deleting, the way the reveal is claimed by updating: two taps,
  // or the host and the clue-giver pressing together, delete one row between
  // them and only the winner opens the replacement. Guesses, bets and the
  // secret go with it — every one of them is `on delete cascade`.
  const { data: claimed, error: delErr } = await admin()
    .from("rounds")
    .delete()
    .eq("id", round.id)
    .in("phase", ["clue", "guess"])
    .select("id")
    .maybeSingle();
  if (delErr) throw new ApiError(500, describe(delErr.message));
  if (!claimed) return getState(code);

  // The round number goes back with the round, so the replacement is a second
  // attempt at round 4 rather than a gap in the count — `openRound` reads
  // `round_no` off the room and adds one.
  const { error } = await admin()
    .from("rooms")
    .update({
      active_team_index: next,
      current_round_id: null,
      round_no: Math.max(round.round_no - 1, 0),
      updated_at: new Date().toISOString(),
    })
    .eq("id", room.id);
  if (error) throw new ApiError(500, error.message);

  await openRound(await getRoom(code));
  return getState(code);
}

/**
 * The clock ran out. Called by whichever device notices first.
 *
 * Open to any player in the room on purpose. The countdown is public — everyone
 * watches the same instant arrive — and gating this on the host would mean a
 * room whose host has a locked phone sits at 0:00 forever, which is the exact
 * situation the clock exists to end. Nothing is trusted from the caller: the
 * deadline is re-read from the database and re-checked against the server's own
 * clock, so a device with a fast clock, an old tab or a hand-rolled request
 * cannot cut a phase short. Every device in the room will call this within a
 * second of each other; the atomic claim means one does the work and the rest
 * are handed the resulting state, exactly as with skip.
 *
 * The two phases end in deliberately different ways, because what is lost is
 * different. In the guess phase the round is playable — the clue is down, people
 * simply have not all moved — so the missing markers are filled in at dead
 * centre and the round scores normally. In the clue phase there is nothing to
 * aim at, so the round is revealed for nothing: no markers, no points, and the
 * turn moves on. Revealed rather than deleted, which is what separates this from
 * `skipRound`: a clue-giver who lets the clock run out costs their team a
 * counted round, whereas a skip is a rescue and is meant to leave no trace.
 */
export async function expireRound(code: string, playerId: string, token: string) {
  const { room } = await authenticate(code, playerId, token);
  if (room.status !== "playing") return getState(code);

  const round = await requireCurrentRound(room);
  const deadline = round.phase_deadline;

  // The server's clock decides, with the same grace the clients allow
  // themselves. Anything early is not an error — a phone a second or two ahead
  // is normal — it is simply not time yet.
  if (!mayExpire(deadline, Date.now())) return getState(code);

  if (round.phase === "guess") {
    // Claimed by taking the deadline away: whoever nulls it first owns the
    // expiry, and the callers a moment behind match no row and do nothing. The
    // phase is left alone until the markers are in, so a player who submits for
    // real in that sliver still lands a genuine marker instead of hitting a
    // round that has already moved on.
    const { data: claimed, error: claimErr } = await admin()
      .from("rounds")
      .update({ phase_deadline: null })
      .eq("id", round.id)
      .eq("phase", "guess")
      .eq("phase_deadline", deadline)
      .select("id")
      .maybeSingle();
    if (claimErr) throw new ApiError(500, describe(claimErr.message));
    if (!claimed) return getState(code);

    await fillMissingGuesses(room, round);
    // Reveals through the ordinary path, so the score, the side bets, the
    // durable stats and the goal check all behave as they would have if
    // everybody had moved in time — which is the point of filling the markers
    // in rather than scoring the round as a loss.
    await revealRound(room, { ...round, phase_deadline: null }, "guess");
    return getState(code);
  }

  if (round.phase === "clue") {
    await revealTimedOutClue(room, round, deadline);
    return getState(code);
  }

  return getState(code);
}

/**
 * Puts a marker at dead centre for every guesser who never moved one.
 *
 * Centre rather than a miss: 50 is a real answer that can score, and on a scale
 * whose secret happens to sit near the middle it will. That is the intended
 * feel — the clock costs you the chance to think, not the round. Written with
 * ON CONFLICT DO NOTHING so a marker that landed for real in the same instant
 * is never overwritten by the automatic one.
 */
async function fillMissingGuesses(room: Room, round: Round): Promise<void> {
  const players = await getPlayers(room.id);
  const guessers = players.filter(
    (p) => p.team_id === round.team_id && p.id !== round.clue_giver_id
  );
  if (guessers.length === 0) return;

  const { data: existing, error: readErr } = await admin()
    .from("guesses")
    .select("player_id")
    .eq("round_id", round.id);
  if (readErr) throw new ApiError(500, describe(readErr.message));

  const already = new Set((existing ?? []).map((g: { player_id: string }) => g.player_id));
  const missing = guessers.filter((p) => !already.has(p.id));
  if (missing.length === 0) return;

  const now = new Date().toISOString();
  const { data: inserted, error: insErr } = await admin()
    .from("guesses")
    .upsert(
      missing.map((p) => ({
        round_id: round.id,
        room_id: room.id,
        player_id: p.id,
        player_name: p.name,
        team_id: p.team_id,
        submitted_at: now,
      })),
      { onConflict: "round_id,player_id", ignoreDuplicates: true }
    )
    .select("id");
  if (insErr) throw new ApiError(500, describe(insErr.message));

  const rows = (inserted ?? []) as { id: string }[];
  if (rows.length === 0) return;

  // The value lives in its own table, unreadable by the watching teams. A guess
  // row with no value is dropped at reveal rather than drawn at zero, so this
  // write is what makes the automatic markers count at all.
  const { error: valErr } = await admin()
    .from("guess_values")
    .upsert(
      rows.map((r) => ({ guess_id: r.id, value: AUTO_MARKER })),
      { onConflict: "guess_id" }
    );
  if (valErr) throw new ApiError(500, describe(valErr.message));
}

/**
 * Reveals a round whose clue never arrived, scoring nothing.
 *
 * Its own path rather than a flag through `revealRound`, which refuses a round
 * with no clue and is right to: there is no marker, no average and no distance,
 * so every number it computes would be invented. What is written instead is a
 * round that plainly says what happened — zero points for everybody and
 * `timed_out: "clue"` in the detail, which is what the reveal card reads to
 * explain itself.
 *
 * No `player_round_stats` rows are written. The scoreboard consequence is the
 * penalty; the personal stats measure how close people aim, and nobody aimed at
 * anything here, so a row would only drag an average around with a number that
 * describes no attempt.
 */
async function revealTimedOutClue(
  room: Room,
  round: Round,
  deadline: string | null
): Promise<void> {
  // Claimed straight into the reveal, unlike the guess branch: here the phase
  // itself is the door that has to shut, because `submitClue` only accepts a
  // round still in `clue` and a clue arriving after this point would be scored
  // against a round that has already been written off.
  const { data: claimed, error: claimErr } = await admin()
    .from("rounds")
    .update({ phase: "reveal", phase_deadline: null })
    .eq("id", round.id)
    .eq("phase", "clue")
    .eq("phase_deadline", deadline)
    .select("id")
    .maybeSingle();
  if (claimErr) throw new ApiError(500, describe(claimErr.message));
  if (!claimed) return;

  const { data: secret } = await admin()
    .from("round_secrets")
    .select("target")
    .eq("round_id", round.id)
    .maybeSingle();

  const teamPoints: Record<string, number> = {};
  for (const team of room.teams) teamPoints[team.id] = 0;

  const detail: RevealDetail = {
    guesses: [],
    bets: [],
    team_points: teamPoints,
    timed_out: "clue",
  };

  const { error } = await admin()
    .from("rounds")
    .update({
      marker: null,
      distance: null,
      points: 0,
      // The secret is shown anyway. The round is over and nobody can act on it,
      // and seeing where it sat is the only thing the table gets out of a turn
      // that went nowhere.
      revealed_target: (secret?.target as number | undefined) ?? null,
      reveal_detail: detail,
      revealed_at: new Date().toISOString(),
    })
    .eq("id", round.id);
  if (error) throw new ApiError(500, describe(error.message));

  // The scoreboard is untouched — no team gained or lost — but the room has to
  // look changed, or the pollers will not come back for the reveal.
  await touch(room.id);
}

/**
 * The next team that can take a turn.
 *
 * Prefers a team that can actually play a round. People leave mid-game, and a
 * team down to one person has a clue-giver and no guessers — handing it the
 * turn would stall the room until someone force-revealed an empty round.
 * Falling back to any non-empty team is deliberate: a stalled round that can be
 * revealed or skipped is still better than a room that cannot advance at all.
 *
 * Pure, and takes the roster rather than reading it, so a caller that already
 * has the players decides the turn from the same snapshot it decided everything
 * else from.
 */
function nextPlayableTeam(room: Room, players: Player[]): number {
  const next =
    nextTeamIndex(room.teams, players, room.active_team_index, MIN_TEAM_SIZE) ??
    nextTeamIndex(room.teams, players, room.active_team_index, 1);
  if (next === null) throw new ApiError(409, "No team has any players left");
  return next;
}

export async function endGame(code: string, playerId: string, token: string) {
  const { room, player } = await authenticate(code, playerId, token);
  requireHost(room, player);
  if (room.status === "finished") return getState(code);
  await finishGame(room, room.teams);
  return getState(code);
}

/** Writes the durable game_results rows and closes the room. */
async function finishGame(room: Room, teams: Team[]): Promise<void> {
  const top = leader(teams);
  const players = await getPlayers(room.id);

  const { data: rounds } = await admin()
    .from("rounds")
    .select("team_id, distance, revealed_at")
    .eq("room_id", room.id)
    .not("revealed_at", "is", null);

  const rows = teams.map((team) => {
    const mine = (rounds ?? []).filter((r: { team_id: string }) => r.team_id === team.id);
    const distances = mine
      .map((r: { distance: number | null }) => r.distance)
      .filter((d: number | null): d is number => d !== null);
    const avg =
      distances.length > 0
        ? Math.round((distances.reduce((a, b) => a + b, 0) / distances.length) * 10) / 10
        : null;
    return {
      room_code: room.code,
      team_name: team.name,
      score: team.score,
      rounds_played: mine.length,
      avg_distance: avg,
      is_winner: top ? team.id === top.id : false,
      player_names: players.filter((p) => p.team_id === team.id).map((p) => p.name),
      goal: room.goal,
    };
  });

  const playedRows = rows.filter((r) => r.rounds_played > 0);
  if (playedRows.length > 0) {
    const { error } = await admin().from("game_results").insert(playedRows);
    if (error) throw new ApiError(500, error.message);
  }

  const { error } = await admin()
    .from("rooms")
    .update({
      teams,
      status: "finished",
      winner_team_name: top?.name ?? null,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", room.id);
  if (error) throw new ApiError(500, error.message);
}

/** Host restarts with the same players and teams. */
export async function playAgain(code: string, playerId: string, token: string) {
  const { room, player } = await authenticate(code, playerId, token);
  requireHost(room, player);

  // Never while a game is running. This deletes every round and zeroes every
  // score, and the button that reaches it lives on the winner screen — so the
  // only ways to arrive here mid-game are a tab left open on a game that has
  // since been restarted, or a direct call. Both of them meant the previous
  // game, and both would silently throw away the one in progress.
  if (room.status === "playing") {
    throw new ApiError(409, "A game is in progress — end it before starting a new one");
  }

  await admin().from("players").update({ clue_turns: 0 }).eq("room_id", room.id);
  await admin().from("rounds").delete().eq("room_id", room.id);

  const { error } = await admin()
    .from("rooms")
    .update({
      status: "lobby",
      teams: room.teams.map((t) => ({ ...t, score: 0 })),
      round_no: 0,
      current_round_id: null,
      winner_team_name: null,
      finished_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", room.id);
  if (error) throw new ApiError(500, error.message);

  return getState(code);
}

/**
 * Take over hosting from a host who has stopped answering.
 *
 * There is no other way out of one particular dead room: the host closes the
 * tab in the lobby, and start, settings and end are all host-only. Everyone
 * else can see each other, and nobody can begin.
 *
 * Deliberately a button somebody presses rather than something the server does
 * on a timer. `last_seen_at` only moves when a device makes a request, so a
 * quiet host and an absent one look alike from here — but a player who can see
 * that nothing is happening knows the difference, and the room is theirs to
 * rescue. `AWAY_AFTER_MS` is what stops it being a way to snatch the crown
 * from someone mid-sentence.
 */
export async function claimHost(code: string, playerId: string, token: string) {
  const { room, player } = await authenticate(code, playerId, token);
  if (player.is_host) return getState(code);

  const players = await getPlayers(room.id);
  if (!hostIsAway(players, room.host_player_id, Date.now())) {
    throw new ApiError(409, "The host is still here");
  }

  // Claimed atomically on the room row: whoever moves the crown gets the row
  // back, and a second claimant reads null and stops. Two people pressing
  // together therefore cannot leave the room with two hosts, or none.
  const claim = admin()
    .from("rooms")
    .update({ host_player_id: player.id, updated_at: new Date().toISOString() })
    .eq("id", room.id);
  const { data: claimed, error: claimErr } = await (
    room.host_player_id === null
      ? claim.is("host_player_id", null)
      : claim.eq("host_player_id", room.host_player_id)
  )
    .select("id")
    .maybeSingle();
  if (claimErr) throw new ApiError(500, claimErr.message);
  if (!claimed) return getState(code);

  // New crown first, old ones after: a moment with two hosts is harmless,
  // a moment with none is another stuck room.
  await admin().from("players").update({ is_host: true }).eq("id", player.id);
  await admin()
    .from("players")
    .update({ is_host: false })
    .eq("room_id", room.id)
    .neq("id", player.id);

  return getState(code);
}

export async function leaveRoom(code: string, playerId: string, token: string) {
  const { room, player } = await authenticate(code, playerId, token);
  await admin().from("players").delete().eq("id", player.id);

  if (player.is_host) {
    const rest = await getPlayers(room.id);
    // The longest-present player who is still answering, and the plain join
    // order only if none of them is. A crown handed to another closed tab
    // leaves the room exactly as stuck as it was.
    const heir = pickNewHost(rest, Date.now()) ?? (rest.length > 0 ? rest[0] : null);
    if (heir) {
      await admin().from("players").update({ is_host: true }).eq("id", heir.id);
      await admin().from("rooms").update({ host_player_id: heir.id }).eq("id", room.id);
    }
  }

  // A leave can be the event that finishes the round: the person who had not
  // guessed yet is the one who left. Nothing else would notice — no guess and
  // no bet is coming — so the round would sit on "waiting for 1 more" until
  // somebody forced it by hand.
  //
  // Never at the cost of the leave itself, though. The row is already deleted
  // by this point, so the player has left whatever happens next; a failure
  // here leaves a round that can still be revealed or skipped, and reporting
  // it as a failed leave would only confuse the person who left.
  if (room.status === "playing" && room.current_round_id) {
    try {
      const round = await getRound(room.current_round_id);
      if (round && round.phase === "guess") await maybeAutoReveal(room, round);
    } catch (e) {
      console.warn("[rooms] leave could not settle the round:", e);
    }
  }

  await touch(room.id);
  return { ok: true };
}

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

async function requireCurrentRound(room: Room): Promise<Round> {
  const round = await getRound(room.current_round_id);
  if (!round) throw new ApiError(409, "No round in progress");
  return round;
}

function requireHost(room: Room, player: Player): void {
  if (!player.is_host) throw new ApiError(403, "Only the host can do that");
}

async function touch(roomId: string): Promise<void> {
  await admin().from("rooms").update({ updated_at: new Date().toISOString() }).eq("id", roomId);
}
