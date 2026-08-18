/**
 * Backend service layer. Everything that touches the database lives here;
 * the route handlers in src/app/api are thin wrappers around these calls.
 */

import { admin } from "../supabase/admin";
import {
  BET_POINTS,
  MAX_PLAYERS,
  averageMarker,
  betIsCorrect,
  cleanClue,
  cleanName,
  cleanUid,
  clampSlider,
  firstTeamIndexWithPlayers,
  generateRoomCode,
  leader,
  makeTeams,
  nextTeamIndex,
  pickClueGiver,
  pickScale,
  randomTarget,
  randomToken,
  scoreFor,
  teamsAtGoal,
} from "../game/engine";
import { scalePool } from "./scales";
import type {
  BetRow,
  BetSide,
  GuessRow,
  Identity,
  Lang,
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

  return { room, players: publicPlayers, round, guesses, bets };
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
  if (players.length >= MAX_PLAYERS) throw new ApiError(409, "This room is full");

  const wanted = typeof teamId === "string" ? teamId : null;
  const team =
    room.teams.find((t) => t.id === wanted) ?? smallestTeam(room.teams, players) ?? room.teams[0];

  const cleaned = cleanName(name, `Player ${players.length + 1}`);
  const identity = await insertPlayer(
    room,
    uniqueName(cleaned, players),
    team.id,
    false,
    cleanUid(uid)
  );

  return { state: await getState(room.code), identity };
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
  patch: { categories?: unknown; goal?: unknown; betsEnabled?: unknown; lang?: unknown; teamNames?: unknown }
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

  const players = await getPlayers(room.id);
  const staffed = room.teams.filter((t) => players.some((p) => p.team_id === t.id));
  if (staffed.length < 2) {
    throw new ApiError(400, "At least two teams need a player before the game can start");
  }

  const first = firstTeamIndexWithPlayers(room.teams, players) ?? 0;
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
    },
    ["scale_left_ua", "scale_right_ua"]
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

export async function submitClue(code: string, playerId: string, token: string, clue: unknown) {
  const { room, player } = await authenticate(code, playerId, token);
  const round = await requireCurrentRound(room);
  if (round.clue_giver_id !== player.id) throw new ApiError(403, "You are not the clue-giver");
  if (round.phase !== "clue") throw new ApiError(409, "The clue was already given");

  const text = cleanClue(clue);
  if (text.length < 1) throw new ApiError(400, "The clue cannot be empty");
  if (/\d/.test(text)) throw new ApiError(400, "No numbers in the clue — that's the whole game!");

  const { error } = await admin()
    .from("rounds")
    .update({ clue: text, phase: "guess" })
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

/** Scores the round, updates the scoreboard, persists stats. Idempotent. */
async function revealRound(room: Room, round: Round): Promise<void> {
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
  for (const t of room.teams) teamPoints[t.id] = 0;
  teamPoints[round.team_id] = pts;

  for (const t of room.teams) {
    if (t.id === round.team_id) continue;
    const mine = detailBets.filter((b) => b.team_id === t.id);
    if (mine.length === 0) continue;
    const right = mine.filter((b) => b.correct).length;
    if (right * 2 > mine.length) teamPoints[t.id] += BET_POINTS;
  }

  const teams = room.teams.map((t) => ({ ...t, score: t.score + (teamPoints[t.id] ?? 0) }));
  const detail: RevealDetail = { guesses: detailGuesses, bets: detailBets, team_points: teamPoints };

  const { error: roundErr } = await admin()
    .from("rounds")
    .update({
      marker,
      distance,
      points: pts,
      revealed_target: target,
      reveal_detail: detail,
      revealed_at: new Date().toISOString(),
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

  const players = await getPlayers(room.id);
  const next = nextTeamIndex(room.teams, players, room.active_team_index);
  if (next === null) throw new ApiError(409, "No team has any players left");

  const { error } = await admin()
    .from("rooms")
    .update({ active_team_index: next, updated_at: new Date().toISOString() })
    .eq("id", room.id);
  if (error) throw new ApiError(500, error.message);

  await openRound(await getRoom(code));
  return getState(code);
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

  const rows = teams.map((t) => {
    const mine = (rounds ?? []).filter((r: { team_id: string }) => r.team_id === t.id);
    const distances = mine
      .map((r: { distance: number | null }) => r.distance)
      .filter((d: number | null): d is number => d !== null);
    const avg =
      distances.length > 0
        ? Math.round((distances.reduce((a, b) => a + b, 0) / distances.length) * 10) / 10
        : null;
    return {
      room_code: room.code,
      team_name: t.name,
      score: t.score,
      rounds_played: mine.length,
      avg_distance: avg,
      is_winner: top ? t.id === top.id : false,
      player_names: players.filter((p) => p.team_id === t.id).map((p) => p.name),
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

export async function leaveRoom(code: string, playerId: string, token: string) {
  const { room, player } = await authenticate(code, playerId, token);
  await admin().from("players").delete().eq("id", player.id);

  if (player.is_host) {
    const rest = await getPlayers(room.id);
    if (rest.length > 0) {
      await admin().from("players").update({ is_host: true }).eq("id", rest[0].id);
      await admin().from("rooms").update({ host_player_id: rest[0].id }).eq("id", room.id);
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
