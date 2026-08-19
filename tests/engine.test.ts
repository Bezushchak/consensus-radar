import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_TEAMS,
  MIN_TEAM_SIZE,
  averageMarker,
  betIsCorrect,
  canStartGame,
  cleanClue,
  cleanName,
  cleanUid,
  clampSlider,
  firstTeamIndexWithPlayers,
  generateRoomCode,
  makeTeams,
  nextTeamIndex,
  normalizeCode,
  pickClueGiver,
  pickScale,
  playableTeams,
  randomTarget,
  scoreFor,
  teamSize,
  teamsAtGoal,
  underStaffedTeams,
} from "../src/lib/game/engine";
import { cacheBust } from "../src/lib/client/api";
import { findSeat } from "../src/lib/server/rooms";
import { storedLabels } from "../src/lib/scales";
import { buildRows, foldEvents, type EventRow } from "../src/lib/server/analytics";
import { toMixpanel } from "../src/lib/server/mixpanel";
import { SCALES, scaleByKey, scalesForCategories } from "../src/lib/scales-data";
import { foldPlayerRows, type StatRow } from "../src/lib/server/leaderboard";
import { playerTag } from "../src/lib/player-tag";
import type { Player, Team } from "../src/lib/types";

const player = (over: Partial<Player> & { id: string }): Player => ({
  room_id: "r",
  name: over.id,
  team_id: "t1",
  is_host: false,
  clue_turns: 0,
  player_uid: null,
  joined_at: "2026-01-01T00:00:00.000Z",
  last_seen_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

test("scoring bands match the original game", () => {
  assert.equal(scoreFor(50, 50).pts, 5);
  assert.equal(scoreFor(50, 55).pts, 5);
  assert.equal(scoreFor(50, 56).pts, 3);
  assert.equal(scoreFor(50, 62).pts, 3);
  assert.equal(scoreFor(50, 63).pts, 0);
  assert.equal(scoreFor(50, 90).pts, 0);
  assert.equal(scoreFor(50, 91).pts, -2);
  assert.equal(scoreFor(5, 95).key, "msgOpp");
});

test("scoring is symmetric around the target", () => {
  for (let target = 5; target <= 95; target += 5) {
    for (let d = 0; d <= 40; d += 3) {
      assert.equal(scoreFor(target, target + d).pts, scoreFor(target, target - d).pts);
    }
  }
});

test("team marker is the average of the submitted guesses", () => {
  assert.equal(averageMarker([40, 60]), 50);
  assert.equal(averageMarker([10, 20, 33]), 21);
  assert.equal(averageMarker([]), 50, "no guesses falls back to the middle");
  assert.equal(averageMarker([70]), 70);
});

test("side bets resolve against the averaged marker", () => {
  assert.equal(betIsCorrect(60, 40, "left"), true);
  assert.equal(betIsCorrect(60, 40, "right"), false);
  assert.equal(betIsCorrect(60, 80, "right"), true);
  assert.equal(betIsCorrect(60, 60, "left"), true, "dead centre never loses a bet");
  assert.equal(betIsCorrect(60, 60, "right"), true);
});

test("targets stay inside the playable band", () => {
  for (let i = 0; i < 500; i++) {
    const target = randomTarget();
    assert.ok(target >= 5 && target <= 95, `target out of range: ${target}`);
  }
});

test("room codes are dictatable and unambiguous", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const code = generateRoomCode();
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    seen.add(code);
  }
  assert.ok(seen.size > 300, "codes should not collide constantly");
  assert.equal(normalizeCode(" ab3d "), "AB3D");
  assert.equal(normalizeCode("a-b/3d!"), "AB3D");
});

test("clue-giver rotation prefers whoever has given the fewest clues", () => {
  const team = [
    player({ id: "a", clue_turns: 2, joined_at: "2026-01-01T00:00:01.000Z" }),
    player({ id: "b", clue_turns: 1, joined_at: "2026-01-01T00:00:02.000Z" }),
    player({ id: "c", clue_turns: 1, joined_at: "2026-01-01T00:00:00.500Z" }),
  ];
  assert.equal(pickClueGiver(team)?.id, "c", "ties break on join order");
  assert.equal(pickClueGiver([]), null);
});

test("turn order skips teams with no players", () => {
  const teams: Team[] = [
    { id: "t1", name: "One", color: "#1", score: 0 },
    { id: "t2", name: "Two", color: "#2", score: 0 },
    { id: "t3", name: "Three", color: "#3", score: 0 },
  ];
  const players = [player({ id: "a", team_id: "t1" }), player({ id: "b", team_id: "t3" })];

  assert.equal(nextTeamIndex(teams, players, 0), 2, "t2 is empty, so jump to t3");
  assert.equal(nextTeamIndex(teams, players, 2), 0, "wrap around back to t1");
  assert.equal(firstTeamIndexWithPlayers(teams, players), 0);
  assert.equal(nextTeamIndex(teams, [], 0), null, "nobody left to play");
});

test("a team of one cannot play, because the clue-giver does not guess", () => {
  const teams: Team[] = [
    { id: "t1", name: "One", color: "#1", score: 0 },
    { id: "t2", name: "Two", color: "#2", score: 0 },
  ];
  const seats = (team: string, n: number) =>
    Array.from({ length: n }, (_, i) => player({ id: `${team}-${i}`, team_id: team }));

  const full = [...seats("t1", 2), ...seats("t2", 2)];
  const lopsided = [...seats("t1", 3), ...seats("t2", 1)];
  const oneTeam = seats("t1", 4);

  assert.equal(canStartGame(teams, full), true, "two proper teams can start");
  assert.equal(
    canStartGame(teams, lopsided),
    false,
    "a solo player would sit through a round nobody can answer"
  );
  assert.equal(canStartGame(teams, oneTeam), false, "one team has nobody to play against");
  assert.equal(canStartGame(teams, []), false);

  assert.deepEqual(underStaffedTeams(teams, lopsided).map((t) => t.id), ["t2"]);
  assert.deepEqual(underStaffedTeams(teams, full), [], "nothing to complain about");
  assert.deepEqual(
    underStaffedTeams(teams, oneTeam).map((t) => t.id),
    [],
    "an empty team is not under-staffed, it is just empty"
  );
  assert.deepEqual(playableTeams(teams, lopsided).map((t) => t.id), ["t1"]);
  assert.equal(teamSize(lopsided, "t1"), 3);
  assert.equal(teamSize(lopsided, "nope"), 0);
});

test("turn rotation can be told to skip teams too small to play", () => {
  const teams: Team[] = [
    { id: "t1", name: "One", color: "#1", score: 0 },
    { id: "t2", name: "Two", color: "#2", score: 0 },
    { id: "t3", name: "Three", color: "#3", score: 0 },
  ];
  // t2 lost a player mid-game and is down to one — it must not get the turn.
  const players = [
    player({ id: "a", team_id: "t1" }),
    player({ id: "b", team_id: "t1" }),
    player({ id: "c", team_id: "t2" }),
    player({ id: "d", team_id: "t3" }),
    player({ id: "e", team_id: "t3" }),
  ];

  assert.equal(nextTeamIndex(teams, players, 0, MIN_TEAM_SIZE), 2, "skip the shrunken t2");
  assert.equal(nextTeamIndex(teams, players, 0), 1, "the default still means 'anyone at all'");
  assert.equal(firstTeamIndexWithPlayers(teams, players, MIN_TEAM_SIZE), 0);

  // Everyone but the solo player has gone: nothing is playable, and nextRound
  // is expected to fall back to minSize 1 rather than dead-end the room.
  const stragglers = [player({ id: "c", team_id: "t2" })];
  assert.equal(nextTeamIndex(teams, stragglers, 0, MIN_TEAM_SIZE), null);
  assert.equal(nextTeamIndex(teams, stragglers, 0, 1), 1);
});

test("goal detection only fires when a goal is set", () => {
  const teams: Team[] = [
    { id: "t1", name: "One", color: "#1", score: 21 },
    { id: "t2", name: "Two", color: "#2", score: 8 },
  ];
  assert.deepEqual(teamsAtGoal(teams, 20).map((t) => t.id), ["t1"]);
  assert.deepEqual(teamsAtGoal(teams, 0), [], "endless mode never auto-finishes");
});

test("input sanitising", () => {
  assert.equal(cleanName("   Dmytro   B  ", "fallback"), "Dmytro B");
  assert.equal(cleanName("", "fallback"), "fallback");
  assert.equal(cleanName("x".repeat(80), "f").length, 24);
  assert.equal(cleanClue("  totally   fine  "), "totally fine");
  assert.equal(clampSlider(120), 100);
  assert.equal(clampSlider(-5), 0);
  assert.equal(clampSlider("42"), 42);
  assert.equal(clampSlider("nope"), null);
  assert.equal(clampSlider(null), null);
});

test("device ids are accepted only in the shape the client mints", () => {
  assert.equal(cleanUid("  ABCDEF0123456789  "), "abcdef0123456789");
  assert.equal(cleanUid("a".repeat(32)), "a".repeat(32));
  assert.equal(cleanUid("deadbeef"), null, "too short to be unique");
  assert.equal(cleanUid("f".repeat(65)), null, "too long");
  assert.equal(cleanUid("not-hex-at-all-really"), null);
  assert.equal(cleanUid(""), null);
  assert.equal(cleanUid(undefined), null);
  assert.equal(cleanUid(42), null);
});

test("team construction clamps to the supported range", () => {
  assert.equal(makeTeams([]).length, 2, "always at least two teams");
  assert.equal(makeTeams(new Array(20).fill("x")).length, MAX_TEAMS);
  const teams = makeTeams(["Reds", "Blues", "Greens"]);
  assert.deepEqual(teams.map((t) => t.id), ["t1", "t2", "t3"]);
  assert.deepEqual(teams.map((t) => t.score), [0, 0, 0]);
  assert.equal(new Set(teams.map((t) => t.color)).size, 3, "colours are distinct");
});

test("scale pool respects the chosen categories and avoids repeats", () => {
  assert.ok(scalesForCategories(["analytics"]).every((s) => s.category === "analytics"));
  assert.equal(scalesForCategories(["nonsense"]).length, SCALES.length, "unknown filter falls back to everything");

  const used = SCALES.filter((s) => s.category === "general").map((s) => s.key);
  for (let i = 0; i < 50; i++) {
    assert.ok(!used.includes(pickScale(SCALES, used).key));
  }
  // Pool exhausted -> allowed to reuse rather than crash.
  const all = SCALES.map((s) => s.key);
  assert.ok(all.includes(pickScale(SCALES, all).key));

  // The pool is now passed in, so the engine never reaches for the catalogue
  // itself — an empty pool is a caller bug and says so.
  assert.throws(() => pickScale([], []), /non-empty pool/);

  const onlyAnalytics = scalesForCategories(["analytics"]);
  for (let i = 0; i < 50; i++) {
    assert.equal(pickScale(onlyAnalytics, []).category, "analytics");
  }
});

test("the catalogue is big enough to keep a long night fresh", () => {
  assert.ok(SCALES.length >= 250, `expected 250+ pairs, got ${SCALES.length}`);
  assert.ok(scalesForCategories(["general"]).length >= 150);
  assert.ok(scalesForCategories(["analytics"]).length >= 60);
  assert.equal(scaleByKey("hot_cold")?.r.en, "Cold");
  assert.equal(scaleByKey("no_such_pair"), undefined);
});

test("every scale has both languages and a unique key", () => {
  const keys = new Set<string>();
  for (const s of SCALES) {
    assert.ok(s.key.length > 0);
    assert.match(s.key, /^[a-z0-9_]+$/, `scale key is not seed-safe: ${s.key}`);
    assert.equal(keys.has(s.key), false, `duplicate scale key: ${s.key}`);
    keys.add(s.key);
    for (const lang of ["ua", "en"] as const) {
      assert.ok(s.l[lang]?.length > 0, `${s.key} missing ${lang} left label`);
      assert.ok(s.r[lang]?.length > 0, `${s.key} missing ${lang} right label`);
      assert.notEqual(s.l[lang], s.r[lang], `${s.key} has identical ${lang} poles`);
    }
  }
});

const DEV_A = "aaaa1111aaaa1111aaaa1111aaaa1111";
const DEV_B = "bbbb2222bbbb2222bbbb2222bbbb2222";
const DEV_C = "cccc3333cccc3333cccc3333cccc3333";

const stat = (over: Partial<StatRow> & { player_name: string }): StatRow => ({
  player_uid: null,
  role: "clue",
  distance: 10,
  points: 3,
  scale_key: "hot_cold",
  ...over,
});

test("one device is one player, however many games and however many names", () => {
  // Newest first, the order the query returns.
  const rows: StatRow[] = [
    stat({ player_name: "dima b", player_uid: DEV_A, points: 5, distance: 2 }),
    stat({ player_name: "Dima", player_uid: DEV_A, points: 3, distance: 10 }),
  ];
  const board = foldPlayerRows(rows, 10);
  assert.equal(board.length, 1, "renaming yourself does not create a second player");
  assert.equal(board[0].clues_given, 2);
  assert.equal(board[0].total_points, 8);
  assert.equal(board[0].clue_avg_points, 4);
  assert.equal(board[0].clue_avg_distance, 6);
  assert.equal(board[0].player_name, "dima b", "the most recent name wins");
});

test("games played before device ids fold into the player they belong to", () => {
  const rows: StatRow[] = [
    stat({ player_name: "Dmytro", player_uid: DEV_A, points: 5 }),
    stat({ player_name: "dmytro", player_uid: null, points: 3 }), // legacy row
  ];
  const board = foldPlayerRows(rows, 10);
  assert.equal(board.length, 1, "the same person is not listed twice");
  assert.equal(board[0].total_points, 8);
});

test("a shared name on two devices stays two players", () => {
  const rows: StatRow[] = [
    stat({ player_name: "Sasha", player_uid: DEV_A, points: 5 }),
    stat({ player_name: "Sasha", player_uid: DEV_B, points: 1 }),
  ];
  const board = foldPlayerRows(rows, 10);
  assert.equal(board.length, 2, "telling namesakes apart is what accounts are for");
  assert.deepEqual(board.map((r) => r.total_points), [5, 1]);
});

test("namesakes are labelled so a human can tell which row is which", () => {
  const shared: StatRow[] = [
    stat({ player_name: "Dmytro", player_uid: DEV_A, points: 5 }),
    stat({ player_name: "dmytro", player_uid: DEV_B, points: 1 }),
    stat({ player_name: "Kate", player_uid: DEV_C, points: 3 }),
  ];
  const board = foldPlayerRows(shared, 10);
  const byName = (name: string) => board.filter((r) => r.player_name.toLowerCase() === name);

  const dmytros = byName("dmytro");
  assert.equal(dmytros.length, 2);
  assert.ok(
    dmytros.every((r) => r.ambiguous),
    "a name two devices answer to must be marked ambiguous"
  );
  assert.notEqual(dmytros[0].player_tag, dmytros[1].player_tag, "and they need different tags");

  const kate = byName("kate")[0];
  assert.equal(kate.ambiguous, false, "the only Kate needs no disambiguation");
  assert.equal(kate.player_tag, playerTag(DEV_C), "the tag is still there for 'this is you'");

  // Case and whitespace are not a second person.
  const spaced = foldPlayerRows(
    [
      stat({ player_name: " Ann ", player_uid: DEV_A, points: 5 }),
      stat({ player_name: "ANN", player_uid: DEV_A, points: 1 }),
    ],
    10
  );
  assert.equal(spaced.length, 1);
  assert.equal(spaced[0].ambiguous, false);

  // A legacy row that never had a device id has no tag to show.
  const legacy = foldPlayerRows([stat({ player_name: "Ghost", player_uid: null, points: 2 })], 10);
  assert.equal(legacy[0].player_tag, null);
});

test("the device tag is stable, opaque, and readable out loud", () => {
  const uid = "a".repeat(32);
  assert.equal(playerTag(uid), playerTag(uid), "the same device always gets the same tag");
  assert.match(playerTag(uid)!, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
  assert.equal(playerTag(uid.toUpperCase()), playerTag(uid), "case is not a different device");
  assert.equal(playerTag(null), null);
  assert.equal(playerTag(""), null);

  // It must not be a slice of the id — that would publish the id itself.
  assert.ok(!uid.toUpperCase().startsWith(playerTag(uid)!), "the tag is a hash, not a prefix");

  // Distinct enough for a room full of namesakes.
  const tags = new Set<string>();
  for (let i = 0; i < 500; i++) {
    tags.add(playerTag(i.toString(16).padStart(32, "0"))!);
  }
  assert.ok(tags.size > 480, `500 devices produced only ${tags.size} distinct tags`);
});

test("roles are counted separately and the board is ranked by clue quality", () => {
  const rows: StatRow[] = [
    stat({ player_name: "Ann", player_uid: DEV_A, role: "clue", points: 5, distance: 3 }),
    stat({ player_name: "Ann", player_uid: DEV_A, role: "guess", points: 0, distance: 7 }),
    stat({ player_name: "Ann", player_uid: DEV_A, role: "bet", points: 1, distance: null }),
    stat({ player_name: "Ann", player_uid: DEV_A, role: "bet", points: 0, distance: null }),
    stat({ player_name: "Bob", player_uid: DEV_B, role: "clue", points: 3, distance: 12 }),
  ];
  const [ann, bob] = foldPlayerRows(rows, 10);

  assert.equal(ann.player_name, "Ann", "higher average clue points ranks first");
  assert.equal(ann.clues_given, 1);
  assert.equal(ann.guesses_made, 1, "guessing does not count as giving a clue");
  assert.equal(ann.guess_avg_distance, 7);
  assert.equal(ann.bets_won, 1, "only the winning bet counts");
  assert.equal(ann.total_points, 6, "clue and bet points; guesses score through the team");
  assert.equal(bob.player_name, "Bob");

  assert.equal(foldPlayerRows(rows, 1).length, 1, "the limit is applied after ranking");
});

test("a player with no clues yet still appears, ranked last", () => {
  const rows: StatRow[] = [
    stat({ player_name: "Guesser", player_uid: DEV_A, role: "guess", points: 0, distance: 4 }),
    stat({ player_name: "Cluer", player_uid: DEV_B, role: "clue", points: 0, distance: 40 }),
  ];
  const board = foldPlayerRows(rows, 10);
  assert.deepEqual(board.map((r) => r.player_name), ["Cluer", "Guesser"]);
  assert.equal(board[1].clue_avg_points, null, "no clues means no average, not zero");
  assert.equal(board[1].clues_given, 0);
});

test("rounds are read in the reader's language, with English as the floor", () => {
  const bilingual = {
    scale_left: "Signal",
    scale_right: "Noise",
    scale_left_ua: "Сигнал",
    scale_right_ua: "Шум",
  };
  assert.deepEqual(storedLabels(bilingual, "ua"), { left: "Сигнал", right: "Шум" });
  assert.deepEqual(storedLabels(bilingual, "en"), { left: "Signal", right: "Noise" });

  // Rounds played before the UA columns existed still render.
  const legacy = { scale_left: "Signal", scale_right: "Noise", scale_left_ua: null, scale_right_ua: null };
  assert.deepEqual(storedLabels(legacy, "ua"), { left: "Signal", right: "Noise" });

  // A half-written row is treated as legacy rather than shown half-translated.
  const partial = { ...bilingual, scale_right_ua: null };
  assert.deepEqual(storedLabels(partial, "ua"), { left: "Signal", right: "Noise" });
});

// ---------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------

const round = (n: number) => Math.round(n * 10) / 10;

test("the events endpoint only accepts what it promised to store", () => {
  const now = Date.now();
  const rows = buildRows({
    sessionId: "s1",
    uid: "a".repeat(32),
    lang: "ua",
    device: "mobile",
    events: [
      { name: "app_open", path: "/", ts: now },
      { name: "click", path: "/room/[code]", roomCode: "gste", props: { target: "join-room" }, ts: now },
      // Not on the allowlist: a public write-anything table is the thing to avoid.
      { name: "drop_table", path: "/", ts: now },
      { name: "", ts: now },
    ],
  });

  assert.deepEqual(rows.map((r) => r.name), ["app_open", "click"]);
  assert.equal(rows[1].room_code, "GSTE", "room codes are stored upper-case");
  assert.equal(rows[0].player_uid, "a".repeat(32));
  assert.equal(rows[0].lang, "ua");
  assert.equal(rows[0].device, "mobile");

  // A bad device id is dropped rather than stored as junk, and an unknown
  // language is stored as unknown rather than guessed.
  const loose = buildRows({ sessionId: "s2", uid: "nope", lang: "fr", events: [{ name: "app_open" }] });
  assert.equal(loose[0].player_uid, null);
  assert.equal(loose[0].lang, null);

  assert.throws(() => buildRows({ events: [{ name: "app_open" }] }), /sessionId/);
});

test("event props are clamped so the table stays cheap", () => {
  const many: Record<string, unknown> = { "bad key": 1, nested: { a: 1 }, list: [1, 2] };
  for (let i = 0; i < 12; i++) many[`k${i}`] = i;

  const [row] = buildRows({
    sessionId: "s1",
    events: [{ name: "app_open", props: { ...many, long: "x".repeat(500), pi: 1.23456, on: true } }],
  });

  assert.ok(Object.keys(row.props).length <= 8, "at most eight keys survive");
  assert.equal(row.props["bad key"], undefined);
  assert.equal(row.props.nested, undefined, "no nesting");
  assert.equal(row.props.list, undefined);

  const [numeric] = buildRows({
    sessionId: "s1",
    events: [{ name: "app_open", props: { long: "x".repeat(500), pi: 1.23456, on: true } }],
  });
  assert.equal(String(numeric.props.long).length, 120);
  assert.equal(numeric.props.pi, 1.235);
  assert.equal(numeric.props.on, true);
});

test("a client clock cannot write events into the future or the distant past", () => {
  const now = Date.now();
  const rows = buildRows({
    sessionId: "s1",
    events: [
      { name: "app_open", ts: now + 86400000 },
      { name: "app_open", ts: now - 30 * 86400000 },
      { name: "app_open", ts: "not a number" },
    ],
  });
  for (const row of rows) {
    const drift = Math.abs(new Date(row.ts).getTime() - now);
    assert.ok(drift < 60000, "a hostile timestamp is replaced with the server's");
  }
});

test("conversion, drop-off and the drop-out rate are per session, not per event", () => {
  const ts = new Date().toISOString();
  const ev = (session_id: string, name: string, extra: Record<string, unknown> = {}) => ({
    session_id,
    name,
    room_code: null,
    path: "/",
    props: {},
    ts,
    ...extra,
  });

  const summary = foldEvents(
    [
      // Three sessions open the app; one of them opens it twice.
      ev("a", "app_open"),
      ev("a", "app_open"),
      ev("b", "app_open"),
      ev("c", "app_open"),
      // Two get as far as creating a room.
      ev("a", "create_open"),
      ev("a", "room_created"),
      ev("b", "create_open"),
      ev("b", "room_created"),
      // Only one ever plays a round.
      ev("a", "joined", { room_code: "GSTE" }),
      ev("b", "joined", { room_code: "GSTE" }),
      ev("a", "game_started"),
      ev("a", "clue_sent"),
      ev("a", "guess_locked", { room_code: "GSTE" }),
    ],
    "week"
  );

  assert.equal(summary.sessions, 3);
  assert.equal(summary.events, 13);

  const step = (name: string) => summary.funnel.find((f) => f.step === name)!;
  assert.equal(step("app_open").sessions, 3, "a session counts once however often it fires");
  assert.equal(step("app_open").events, 4);
  assert.equal(step("app_open").conversion, 100);
  assert.equal(step("app_open").dropoff, null, "the first step has nothing to drop from");
  assert.equal(step("create_open").sessions, 2);
  assert.equal(step("create_open").dropoff, round(100 / 3), "one of three did not start creating");
  assert.equal(step("guess_locked").sessions, 1);
  assert.equal(step("guess_locked").conversion, round(100 / 3));
  assert.equal(step("game_finished").sessions, 0);

  // Two of the three sessions opened the app and never locked a guess.
  assert.equal(summary.dropoutRate, round(200 / 3));

  // Both devices joined the room, one of them played.
  assert.deepEqual(summary.rooms, [{ room_code: "GSTE", joined: 2, played: 1, last_seen: ts }]);
});

test("clicks are grouped by control and page, with a session count beside the total", () => {
  const ts = new Date().toISOString();
  const click = (session_id: string, target: string, path: string) => ({
    session_id,
    name: "click",
    room_code: null,
    path,
    props: { target },
    ts,
  });

  const summary = foldEvents(
    [
      click("a", "join-room", "/room/[code]"),
      click("a", "join-room", "/room/[code]"),
      click("b", "join-room", "/room/[code]"),
      click("b", "create-room", "/"),
      // The same label on a different page is a different control.
      click("b", "join-room", "/"),
      { session_id: "c", name: "click", room_code: null, path: "/", props: {}, ts },
    ],
    "day"
  );

  assert.equal(summary.clicks[0].target, "join-room");
  assert.equal(summary.clicks[0].path, "/room/[code]");
  assert.equal(summary.clicks[0].clicks, 3);
  assert.equal(summary.clicks[0].sessions, 2, "three clicks, two people");
  assert.ok(
    summary.clicks.some((c) => c.target === "(unlabelled)"),
    "an unlabelled control still shows up, which is how a missing data-ev gets noticed"
  );
});

test("session length is a median, and nonsense durations are ignored", () => {
  const ts = new Date().toISOString();
  const end = (session_id: string, seconds: unknown) => ({
    session_id,
    name: "session_end",
    room_code: null,
    path: "/",
    props: { seconds },
    ts,
  });

  const summary = foldEvents(
    [end("a", 10), end("b", 30), end("c", 200), end("d", -5), end("e", 999999), end("f", "soon")],
    "all"
  );
  assert.equal(summary.medianSessionSeconds, 30);
  assert.equal(summary.dropoutRate, null, "no app_open means no rate, not zero");
});

// ---------------------------------------------------------------------
// The Mixpanel mirror
// ---------------------------------------------------------------------

const eventRow = (over: Partial<EventRow> = {}): EventRow => ({
  session_id: "sess-1",
  player_uid: "a".repeat(32),
  room_code: "GSTE",
  name: "guess_locked",
  path: "/room/[code]",
  props: { distance: 7 },
  lang: "ua",
  device: "mobile",
  ts: "2026-08-18T17:46:21.000Z",
  ...over,
});

test("events are mirrored to Mixpanel with the identity and time we meant", () => {
  const [event] = toMixpanel([eventRow()], "tok");

  assert.equal(event.event, "guess_locked", "the event name is ours, not renamed");
  assert.equal(event.properties.token, "tok");
  assert.equal(event.properties.distinct_id, "a".repeat(32), "one device is one person");
  assert.equal(event.properties.$device_id, "a".repeat(32));
  assert.equal(event.properties.time, Date.parse("2026-08-18T17:46:21.000Z"), "milliseconds");
  assert.equal(event.properties.ip, "0", "no geolocation from a server IP");
  assert.equal(event.properties.room_code, "GSTE");
  assert.equal(event.properties.path, "/room/[code]", "the room code never rides in the path");
  assert.equal(event.properties.device_type, "mobile", "not $device, which Mixpanel owns");
  assert.equal(event.properties.distance, 7, "our props come through flat");

  // A browser with no storage still produces a usable, non-colliding id.
  const [anon] = toMixpanel([eventRow({ player_uid: null })], "tok");
  assert.equal(anon.properties.distinct_id, "session-sess-1");
});

test("a retried batch cannot double-count, and a stale client cannot hijack it", () => {
  const rows = [eventRow(), eventRow()];
  const [first, second] = toMixpanel(rows, "tok");
  assert.equal(first.properties.$insert_id, second.properties.$insert_id, "same event, same id");
  assert.ok(String(first.properties.$insert_id).length <= 36, "Mixpanel caps $insert_id at 36");

  // Two different events must not collide, or Mixpanel would drop one.
  const [other] = toMixpanel([eventRow({ name: "clue_sent" })], "tok");
  assert.notEqual(other.properties.$insert_id, first.properties.$insert_id);

  // A prop called `token` must not be able to redirect events to another project.
  const [hijack] = toMixpanel(
    [eventRow({ props: { token: "someone-elses", distinct_id: "admin", ip: "8.8.8.8" } })],
    "tok"
  );
  assert.equal(hijack.properties.token, "tok");
  assert.equal(hijack.properties.distinct_id, "a".repeat(32));
  assert.equal(hijack.properties.ip, "0");
});

test("an unparseable timestamp falls back to now rather than to 1970", () => {
  const before = Date.now();
  const [event] = toMixpanel([eventRow({ ts: "not a date" })], "tok");
  const time = Number(event.properties.time);
  assert.ok(time >= before && time <= Date.now() + 1000);
});

// --- the join loop -----------------------------------------------------

test("a device that already has a seat is given it back, not a second one", () => {
  const players = [
    player({ id: "host", name: "Dmytro", player_uid: "a".repeat(32), is_host: true }),
    player({ id: "p2", name: "Anton", player_uid: "b".repeat(32), team_id: "t2" }),
  ];

  assert.equal(findSeat(players, "b".repeat(32))?.id, "p2");
  assert.equal(findSeat(players, "a".repeat(32))?.id, "host");
  // A device nobody has seen gets a new seat, which is the whole point.
  assert.equal(findSeat(players, "c".repeat(32)), null);
});

test("a seat is never claimed by name, or by a missing device id", () => {
  // Rows written before the player_uid column existed carry no device id. Two
  // of them must not collapse into one seat just because both are null, and a
  // caller with no id of its own must not match them either.
  const legacy = [
    player({ id: "p1", name: "Anton", player_uid: null }),
    player({ id: "p2", name: "Anton 2", player_uid: null }),
  ];
  assert.equal(findSeat(legacy, null), null);
  assert.equal(findSeat(legacy, ""), null);
  assert.equal(findSeat(legacy, "d".repeat(32)), null);

  // Same name, different browser: two people, two seats.
  const shared = [player({ id: "p1", name: "Anton", player_uid: "e".repeat(32) })];
  assert.equal(findSeat(shared, "f".repeat(32)), null);
});

test("every read gets a URL no cache has seen before", () => {
  const a = cacheBust("/api/rooms/GSTE");
  const b = cacheBust("/api/rooms/GSTE");

  assert.notEqual(a, b, "two calls in the same millisecond must still differ");
  assert.ok(a.startsWith("/api/rooms/GSTE?_="));
  assert.ok(b.startsWith("/api/rooms/GSTE?_="));

  // An existing query string is extended, not clobbered.
  const withQuery = cacheBust("/api/leaderboard?board=players&period=all");
  assert.ok(withQuery.includes("board=players"));
  assert.ok(withQuery.includes("period=all"));
  assert.equal(withQuery.split("?").length, 2);
  assert.ok(/[?&]_=[0-9a-z]+$/.test(withQuery));
});
