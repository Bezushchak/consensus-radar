import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AUTO_MARKER,
  AWAY_AFTER_MS,
  BET_POINTS,
  EXPIRE_GRACE_MS,
  MAX_TEAMS,
  MIN_TEAM_SIZE,
  TIMER_CHOICES,
  TIMER_FINAL_AT,
  TIMER_WARN_AT,
  averageMarker,
  betConsensus,
  betIsCorrect,
  canSkipRound,
  canStartGame,
  cleanClue,
  cleanName,
  cleanTimerSeconds,
  cleanUid,
  clampSlider,
  clueGiverIsAway,
  deadlineFor,
  firstTeamIndexWithPlayers,
  foldCalibration,
  formatClock,
  generateRoomCode,
  hostIsAway,
  leader,
  makeTeams,
  mayControlRound,
  mayExpire,
  nextTeamIndex,
  normalizeCode,
  phaseSeconds,
  pickClueGiver,
  pickNewHost,
  pickScale,
  playableTeams,
  randomTarget,
  rankTeams,
  rankTeamsWithWinner,
  scoreFor,
  secondsLeft,
  seenRecently,
  teamBetPoints,
  teamSize,
  teamsAtGoal,
  timerLevel,
  underStaffedTeams,
  type StoredReveal,
  type TeamMisses,
} from "../src/lib/game/engine";
import {
  MAX_CLUE_WORDS,
  MAX_WORD_LEN,
  clueErrorKey,
  clueTokens,
  countClueWords,
  validateClue,
  type ClueReason,
} from "../src/lib/game/clue";
import { STRINGS, t as translate } from "../src/lib/i18n";
import { cacheBust } from "../src/lib/client/api";
import { findSeat } from "../src/lib/server/rooms";
import { storedLabels } from "../src/lib/scales";
import { buildRows, foldEvents, type EventRow } from "../src/lib/server/analytics";
import { toMixpanel } from "../src/lib/server/mixpanel";
import { SCALES, scaleByKey, scalesForCategories } from "../src/lib/scales-data";
import { foldPlayerRows, type StatRow } from "../src/lib/server/leaderboard";
import { playerTag } from "../src/lib/player-tag";
import {
  DEMO,
  DEMO_PLAYERS,
  DEMO_TEAMS,
  buildScript,
  initialState,
  pick,
} from "../src/lib/demo/script";
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

test("a tie on points is settled by who was closer, not by who joined first", () => {
  // The bug this replaces: `leader` sorted on score alone, and `Array.sort` is
  // stable, so two teams on 12 handed the game to whichever was created first in
  // the lobby. Here t2 is closer and must win from second place in the array.
  const teams: Team[] = [
    { id: "t1", name: "One", color: "#1", score: 12 },
    { id: "t2", name: "Two", color: "#2", score: 12 },
    { id: "t3", name: "Three", color: "#3", score: 5 },
  ];
  const misses: TeamMisses = { t1: 18.4, t2: 9.1, t3: 6.0 };

  assert.equal(leader(teams, misses)?.id, "t2", "closer on average, so the game is theirs");
  assert.deepEqual(
    rankTeams(teams, misses).map((t) => t.id),
    ["t2", "t1", "t3"],
    "and t3 stays last: a better average does not buy points"
  );

  // Only exactly one champion is ever recorded, which is what `is_winner` needs.
  const top = leader(teams, misses);
  assert.deepEqual(
    teams.filter((t) => t.id === top?.id).length,
    1,
    "the stored result marks one winner, never two"
  );
});

test("a team with nothing to show cannot win a tie on it", () => {
  // A team can end a game on points it took entirely from side bets, having
  // never revealed a round of its own. It has no average, and an absent average
  // must not read as a perfect one — otherwise the team that never played would
  // outrank the team that did.
  const teams: Team[] = [
    { id: "t1", name: "Played", color: "#1", score: 12 },
    { id: "t2", name: "Betted", color: "#2", score: 12 },
  ];
  assert.equal(leader(teams, { t1: 22.5, t2: null })?.id, "t1");
  assert.equal(
    leader(teams, { t1: 22.5 })?.id,
    "t1",
    "missing from the map means the same as null"
  );

  // Two teams that are inseparable keep the order they were given, so the
  // podium, the scoreboard and the stored row cannot disagree with each other.
  assert.deepEqual(
    rankTeams(teams, { t1: null, t2: null }).map((t) => t.id),
    ["t1", "t2"],
    "no average anywhere: stable, not NaN-shuffled"
  );
  assert.deepEqual(
    rankTeams(teams).map((t) => t.id),
    ["t1", "t2"],
    "and no map at all is the old score-only answer"
  );
});

test("the winner screen orders the tie the way the server decided it", () => {
  // The room payload has no round history, so the podium cannot recompute the
  // average-miss tie-break. It reads back the name the server stored instead —
  // otherwise the crown on the steps contradicts the headline above them.
  const teams: Team[] = [
    { id: "t1", name: "One", color: "#1", score: 12 },
    { id: "t2", name: "Two", color: "#2", score: 12 },
    { id: "t3", name: "Three", color: "#3", score: 5 },
  ];
  assert.deepEqual(
    rankTeamsWithWinner(teams, "Two").map((t) => t.id),
    ["t2", "t1", "t3"],
    "the named champion leads its score group"
  );
  assert.deepEqual(
    rankTeamsWithWinner(teams, "Three").map((t) => t.id),
    ["t1", "t2", "t3"],
    "but a name cannot lift a team over a team with more points"
  );
  assert.deepEqual(
    rankTeamsWithWinner(teams, null).map((t) => t.id),
    ["t1", "t2", "t3"],
    "an unfinished room has no champion and just sorts on score"
  );
  assert.deepEqual(
    rankTeamsWithWinner(teams, "Nobody").map((t) => t.id),
    ["t1", "t2", "t3"],
    "a name matching no team leaves the order alone"
  );
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

// ---- clue rules ----------------------------------------------------------

/** Asserts a clue is rejected and hands back why, narrowed. */
function clueFail(text: string): { reason: ClueReason; word: string | null } {
  const check = validateClue(text);
  if (check.ok) throw new Error(`expected ${JSON.stringify(text)} to be rejected, it passed`);
  return { reason: check.reason, word: check.word };
}

/** Asserts a clue passes and hands back the text that would be stored. */
function clueOk(text: string): string {
  const check = validateClue(text);
  if (!check.ok) throw new Error(`expected ${JSON.stringify(text)} to pass, got ${check.reason}`);
  return check.clue;
}

test("a number is a number however it is written", () => {
  // Digits, and digits welded into a word.
  assert.equal(clueFail("level 5").reason, "digits");
  assert.equal(clueFail("level5").reason, "digits");
  // Not only ASCII: fractions and the Roman numeral characters live in the
  // wider Unicode number categories, which is why the test is \p{N} and not
  // \p{Nd}. The code point is spelled out so the intent survives a paste —
  // U+2169 is ROMAN NUMERAL TEN, not the letter X.
  assert.equal(clueFail("½ way there").reason, "digits");
  assert.equal(clueFail(`${String.fromCodePoint(0x2169)} marks it`).reason, "digits");

  // Spelled out, both languages, including inflected Ukrainian.
  assert.deepEqual(clueFail("forty degrees"), { reason: "numberWord", word: "forty" });
  assert.deepEqual(clueFail("halfway up"), { reason: "numberWord", word: "halfway" });
  assert.deepEqual(clueFail("другий раз"), { reason: "numberWord", word: "другий" });
  assert.equal(clueFail("п'ятдесят відсотків").word, "п'ятдесят");

  // And a number word hiding inside a glued token is reported as a number,
  // which is the more useful of the two things wrong with it.
  assert.deepEqual(clueFail("halfthewaydown"), { reason: "numberWord", word: "half" });

  // The collisions the word lists are built around: "друг" is a friend, not a
  // second, and "п'ятниця" is Friday, not a five.
  clueOk("друг сказав");
  clueOk("п'ятниця ввечері");
  clueOk("майже посередині");
  clueOk("very warm indeed");
});

test("welding numerals together or blurring them does not hide them", () => {
  // The hole this closes. The glue check only looks at tokens of twelve
  // characters or more, and the Ukrainian stems do nothing for English, so every
  // one of these used to pass: nine characters, one token, no digits.
  for (const glued of [
    "fiftyfive",
    "thirtytwo",
    "sixtyfour",
    "onehundred",
    "twentyfirst",
    "fiftypercent",
  ]) {
    assert.deepEqual(
      clueFail(glued),
      { reason: "numberWord", word: glued },
      `${glued} is a number written without the space`
    );
  }

  // Ukrainian had half the hole: a stem catches "п'ятдесятп'ять", which starts
  // with п'ят, but the same stem is useless when the stem-shaped half is the
  // tail. Hence the nominatives in NUMBER_WORDS.
  assert.equal(clueFail("сорокп'ять").reason, "numberWord");
  assert.equal(clueFail("стодвадцять").reason, "numberWord");

  // A number made vague is still a number, in words and in decades.
  assert.equal(clueFail("fiftyish").reason, "numberWord");
  assert.equal(clueFail("fiftyodd").reason, "numberWord");
  assert.equal(clueFail("twentysomething").reason, "numberWord");
  assert.equal(clueFail("in his fifties").reason, "numberWord");
  assert.equal(clueFail("сотня людей").word, "сотня");
  assert.equal(clueFail("півсотні кроків").word, "півсотні");

  // And the whole reason the rule is "the entire token decomposes" rather than
  // "the token starts with a number": every one of these is a real word that
  // begins with one, and rejecting them would be far worse than missing an
  // evasion. The -ish and -odd words are here for the same reason — the tail is
  // stripped, but what is left still has to be a number, and fin, pun and Brit
  // are not.
  for (const real of [
    "tenacious", "tenor", "tension", "tensile", "onerous", "someone", "twofold",
    "halfhearted", "finish", "punish", "British",
    "разом", "стонога", "тризуб", "сорока", "стосунок", "одночасно",
    "південь", "північ", "півень", "сьомга",
  ]) {
    clueOk(real);
  }
});

test("the word cap counts meaning, not grammar", () => {
  // Six words that carry meaning, with articles and prepositions on top.
  assert.equal(countClueWords("the cold and the wet of a grey damp miserable evening"), 6);
  clueOk("the cold and the wet of a grey damp miserable evening");

  // Seven does not fit.
  assert.equal(clueFail("cold wet grey damp miserable evening again").reason, "tooManyWords");

  // Nor does stuffing the box with free words to get around the cap.
  assert.equal(clueFail(new Array(13).fill("the").join(" ")).reason, "tooManyWords");

  // Whitespace is collapsed before anything is counted, and the cleaned text
  // is what would be stored.
  assert.equal(clueOk("  totally   fine  "), "totally fine");
  assert.equal(clueFail("   ").reason, "empty");
});

test("punctuation between words does not hide them", () => {
  // No rule per character: a separator is anything that is not a letter, so
  // every one of these is four words, decided without any guessing.
  const want = ["so", "like", "this", "word"];
  assert.deepEqual(clueTokens("so-like-this-word"), want);
  assert.deepEqual(clueTokens("so.like.this.word"), want);
  assert.deepEqual(clueTokens("so_like_this_word"), want);
  assert.deepEqual(clueTokens("so/like/this/word"), want);
  assert.deepEqual(clueTokens("So — Like … This! Word?"), want);

  // Apostrophes are part of a word, though, or Ukrainian numerals would stop
  // matching the moment a phone substituted a curly one.
  assert.deepEqual(clueTokens("п’ять"), ["п'ять"]);
  assert.deepEqual(clueTokens("don't"), ["don't"]);
});

test("words glued together are caught, long real words are not", () => {
  assert.deepEqual(clueFail("solikethisword"), { reason: "gluedWord", word: "solikethisword" });
  assert.equal(clueFail("thisisthewordyouwant").reason, "gluedWord");
  assert.equal(clueFail("дужедалековгору").reason, "gluedWord");

  // Zero-width characters are invisible to the guessers, so they are stripped
  // rather than treated as separators — otherwise the screen would read as one
  // word while the counter said four.
  const zeroWidth = String.fromCharCode(0x200b);
  assert.equal(clueFail(`so${zeroWidth}likethisword`).reason, "gluedWord");

  // The whole point: real words are longer than the glued one and still pass,
  // because they do not decompose into common short words at all.
  clueOk("responsibility");
  clueOk("characteristic");
  clueOk("відповідальність");
  clueOk("непередбачуваність");
  // And the handful of real words that do decompose are named explicitly.
  clueOk("nevertheless");

  // A token no language has is rejected on length alone.
  assert.equal(clueFail("x".repeat(MAX_WORD_LEN + 1)).reason, "longWord");
  clueOk("x".repeat(MAX_WORD_LEN));
});

test("every clue rejection can actually be shown to the player", () => {
  const reasons: ClueReason[] = [
    "empty",
    "digits",
    "numberWord",
    "longWord",
    "gluedWord",
    "tooManyWords",
  ];

  for (const reason of reasons) {
    const { key, vars } = clueErrorKey({ ok: false, reason, word: "solikethisword", words: 9 });
    assert.ok(STRINGS[key], `${reason} maps to "${key}", which is not in the dictionary`);
    for (const lang of ["ua", "en"] as const) {
      const out = translate(lang, key, vars);
      assert.ok(out.length > 0, `${key} is empty in ${lang}`);
      assert.ok(!/\{\w+\}/.test(out), `${key} in ${lang} left a placeholder unfilled: ${out}`);
    }
  }

  // The two strings the composer fills in itself, same check.
  for (const key of ["clueRules", "clueWordCount"]) {
    for (const lang of ["ua", "en"] as const) {
      const out = translate(lang, key, { count: 3, max: MAX_CLUE_WORDS });
      assert.ok(!/\{\w+\}/.test(out), `${key} in ${lang} left a placeholder unfilled: ${out}`);
    }
  }
});

/**
 * The three strings that had no caller for a while.
 *
 * `leaveBtn` and `calibEmpty` both sat in the dictionary translated and unused —
 * the leave action was reachable only by hand at the API, and the calibration
 * card treated "the read failed" and "no round was revealed" as one state, so
 * the message for the second could never be chosen. Both now have exactly one
 * caller, and this is what notices if a later edit takes it away again: a key
 * that renders as its own name is a key nothing renders.
 */
test("leaving and the empty calibration card can both be spoken", () => {
  for (const key of ["leaveBtn", "leaveConfirm", "calibEmpty"]) {
    assert.ok(STRINGS[key], `${key} is used by the room screens but not in the dictionary`);
    for (const lang of ["ua", "en"] as const) {
      const out = translate(lang, key, {});
      assert.ok(out.length > 0, `${key} is empty in ${lang}`);
      assert.ok(out !== key, `${key} in ${lang} rendered as its own key`);
      assert.ok(!/\{\w+\}/.test(out), `${key} in ${lang} left a placeholder unfilled: ${out}`);
    }
  }

  // The confirm is the only one of the three that has to read as a question:
  // it is put to somebody mid-round, and a statement with an OK button under it
  // is how people leave a game they meant to stay in.
  for (const lang of ["ua", "en"] as const) {
    assert.ok(
      translate(lang, "leaveConfirm", {}).includes("?"),
      `leaveConfirm in ${lang} is not phrased as a question`
    );
  }
});

// --------------------------------------------------------------------------
// The scripted demo on /how-to-play.
//
// The player itself is a DOM animation and out of reach here, but the thing it
// performs is a plain list of steps and a table of numbers, and those are the
// part that can lie. A demo that teaches a rule the app no longer has is worse
// than no demo, because it is believed.
// --------------------------------------------------------------------------

test("the demo's arithmetic is the arithmetic the engine would do", () => {
  // Two guesses at 27 and 34 average to 30.5, and 30.5 against a secret at 36
  // is 5.5 off, which the bands score as 3. All three numbers are written down
  // in the script so the reveal can render before the round is "played"; this
  // is what stops them drifting away from the functions that produce them.
  assert.equal(averageMarker(DEMO.guesses.map((g) => g.value)), DEMO.marker);
  assert.equal(scoreFor(DEMO.target, DEMO.marker).pts, DEMO.points);

  // And the tick or cross beside each bettor's name at the reveal.
  for (const b of DEMO.bets) {
    assert.equal(
      b.correct,
      betIsCorrect(DEMO.target, DEMO.marker, b.side),
      `${b.name} bet ${b.side}, and the demo shows that as ${b.correct ? "right" : "wrong"}`
    );
  }

  // The bettors are all on one team, so the demo's own bets have to survive the
  // unanimity rule the narration claims they satisfy. This was a 2-1 split back
  // when a majority paid; the narration says they scored, so under the current
  // rule a split here would teach a rule the game does not have.
  assert.equal(
    betConsensus(DEMO.bets.map((b) => b.side)),
    "left",
    "the demo's bettors have to agree, because the reveal tells the viewer they scored"
  );
  assert.equal(
    teamBetPoints(DEMO.bets),
    BET_POINTS,
    "and agreeing on the correct side is what earns the point the card shows"
  );

  // The room code is one the real join box would accept unchanged, and avoids
  // the characters the generator leaves out because they are read wrong aloud.
  assert.equal(DEMO.code, normalizeCode(DEMO.code));
  assert.equal(DEMO.code.length, 4);
  for (const ch of DEMO.code) {
    assert.ok(!"ILO01".includes(ch), `the demo code contains ${ch}, which no real code uses`);
  }
});

test("the clue the demo refuses is one the app really refuses", () => {
  // The rejection shown on screen is `validateClue` running on the typed text,
  // not a caption asserting a rule. Both languages, because the script types a
  // different sentence in each.
  for (const lang of ["ua", "en"] as const) {
    const bad = validateClue(pick(DEMO.clueBad, lang));
    assert.equal(bad.ok, false, `${lang}: the first clue is meant to be rejected`);
    assert.equal(bad.ok ? null : bad.reason, "digits", `${lang}: rejected for the wrong reason`);

    const good = validateClue(pick(DEMO.clue, lang));
    assert.equal(
      good.ok,
      true,
      `${lang}: the replacement clue is meant to pass, and did not: ${
        good.ok ? "" : good.reason
      }`
    );
    assert.ok(good.words <= MAX_CLUE_WORDS);
  }
});

test("the demo's cast is a room the real engine would let start", () => {
  const teams: Team[] = DEMO_TEAMS.map((tm) => ({
    id: tm.id,
    name: pick(tm.name, "en"),
    color: tm.color,
    score: 0,
  }));
  const players = DEMO_PLAYERS.map((p) =>
    player({ id: p.id, name: p.name, team_id: p.team, is_host: p.host === true })
  );

  assert.ok(
    canStartGame(teams, players),
    "the demo shows a Start button on a room the real check would block"
  );
  assert.equal(playableTeams(teams, players).length, DEMO_TEAMS.length);
  assert.equal(underStaffedTeams(teams, players).length, 0);
  assert.equal(players.filter((p) => p.is_host).length, 1, "exactly one host");

  // Who guesses and who bets is not decoration: the clue-giver's team guesses
  // and the other team bets, and nobody does both. The count under the gauge
  // is `DEMO.guesses.length`, so a name in the wrong list would show a total
  // that never fills.
  const giving = DEMO_TEAMS[0].id;
  for (const g of DEMO.guesses) {
    const p = DEMO_PLAYERS.find((x) => x.id === g.id);
    assert.ok(p, `${g.id} guesses but is not in the cast`);
    assert.equal(p?.team, giving, `${g.name} guesses for a team they are not on`);
    assert.ok(p?.host !== true, `${g.name} gives the clue and also guesses`);
  }
  for (const b of DEMO.bets) {
    const p = DEMO_PLAYERS.find((x) => x.id === b.id);
    assert.ok(p, `${b.id} bets but is not in the cast`);
    assert.notEqual(p?.team, giving, `${b.name} bets on their own team's marker`);
  }
});

test("every word the demo narrates exists in both languages", () => {
  // Walked the way the player walks it, because a caption set by a `screen` or
  // `set` patch keeps whatever placeholders the previous `say` supplied. That
  // is precisely the bug this guards: a key with a `{marker}` in it, reached by
  // a step that carries no marker, flashes the raw braces at the reader.
  for (const lang of ["ua", "en"] as const) {
    const start = initialState();
    let caption = start.caption;
    let role = start.role;
    let vars: Record<string, string | number> | undefined;

    const check = (key: string) => {
      assert.ok(STRINGS[key], `the demo says "${key}", which is not in the dictionary`);
      const out = translate(lang, key, vars);
      assert.ok(out.length > 0, `${key} is empty in ${lang}`);
      assert.ok(!/\{\w+\}/.test(out), `${key} in ${lang} left a placeholder unfilled: ${out}`);
    };

    check(caption);
    check(role);

    for (const step of buildScript(lang)) {
      if (step.do === "say") {
        caption = step.key;
        vars = step.vars;
      } else if (step.do === "screen" || step.do === "set" || step.do === "click") {
        if (step.patch?.caption) caption = step.patch.caption;
        if (step.patch?.role) role = step.patch.role;
      } else {
        continue;
      }
      check(caption);
      check(role);
    }
  }

  // The chrome around the stage, and the prose underneath it. Not reachable by
  // walking the script, and new in the same change, so listed by hand.
  const around = [
    "howToTitle",
    "howToSub",
    "howToRulesTitle",
    "howToSetupRules",
    "howToGoal",
    "howToClueRules",
    "howToBetsRules",
    "demoPlay",
    "demoPause",
    "demoRestart",
    "demoNotReal",
    "demoHostNote",
  ];
  for (const key of around) {
    assert.ok(STRINGS[key], `${key} is on the how-to page but not in the dictionary`);
    for (const lang of ["ua", "en"] as const) {
      const out = translate(lang, key, { max: MAX_CLUE_WORDS });
      assert.ok(out.length > 0, `${key} is empty in ${lang}`);
      assert.ok(!/\{\w+\}/.test(out), `${key} in ${lang} left a placeholder unfilled: ${out}`);
    }
  }
});

test("the demo cursor is only ever sent to an element that exists", () => {
  // The one failure that looks like nothing: rename a button in `DemoScreens`
  // and the script keeps naming the old key, `centerOf` returns null, and the
  // cursor silently stops moving while the screens carry on changing. Read out
  // of the source rather than rendered, because there is no DOM here.
  const source = readFileSync(
    join(process.cwd(), "src/components/demo/DemoScreens.tsx"),
    "utf8"
  );

  const registered = new Set<string>();
  for (const m of source.matchAll(/mark\("([^"]+)"\)/g)) registered.add(m[1]);

  // Two families register from a prop rather than a literal, so they cannot be
  // read straight out of the source. Each is pinned to the shape it registers
  // through, so a refactor fails here loudly instead of leaving a stale list.
  assert.match(
    source,
    /`team-\$\{tm\.id\}`/,
    "the team buttons no longer register as `team-${tm.id}` — update this test"
  );
  for (const tm of DEMO_TEAMS) registered.add(`team-${tm.id}`);

  assert.match(
    source,
    /ref=\{mark\(id\)\}/,
    "the text boxes no longer register under their own id — update this test"
  );
  for (const m of source.matchAll(/<Field\s+id="([^"]+)"/g)) registered.add(m[1]);

  assert.ok(registered.size > 8, "found almost nothing registered — the regexes have rotted");

  for (const lang of ["ua", "en"] as const) {
    for (const step of buildScript(lang)) {
      const target =
        step.do === "click" || step.do === "move"
          ? step.to
          : step.do === "type"
            ? step.into
            : step.do === "erase"
              ? step.into
              : step.do === "drag"
                ? "slider"
                : null;
      if (target === null) continue;
      assert.ok(
        registered.has(target),
        `the demo aims at "${target}", which no screen registers`
      );
    }
  }
});

// ---------------------------------------------------------------------
// Rescuing a room that has stopped moving
//
// These four predicates decide when the app is allowed to say somebody has
// gone. They are pure for exactly this reason: getting them wrong is invisible
// in production in the worst possible direction — a threshold that fires too
// early shows a takeover notice in every ordinary room, and one that never
// fires leaves a table looking at a dial with no button on it.
// ---------------------------------------------------------------------

const NOW = Date.parse("2026-01-01T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("a quiet phone eventually reads as away, and a missing stamp never does", () => {
  assert.equal(AWAY_AFTER_MS, 120_000, "two minutes is what the README and the UI promise");
  const seen = (ms: number) => player({ id: "p", last_seen_at: ago(ms) });

  assert.equal(seenRecently(seen(30_000), NOW), true);
  assert.equal(seenRecently(seen(AWAY_AFTER_MS - 1), NOW), true);
  assert.equal(seenRecently(seen(AWAY_AFTER_MS), NOW), false, "the threshold is exclusive");
  assert.equal(seenRecently(seen(600_000), NOW), false);

  // The asymmetry is the point. A stamp is evidence of being here; its absence
  // is not evidence of being gone, and the two mistakes do not cost the same —
  // a false "present" leaves the room exactly as it is today, a false "away"
  // takes the crown off somebody holding their phone.
  assert.equal(seenRecently(player({ id: "p", last_seen_at: "", joined_at: "" }), NOW), true);
  assert.equal(seenRecently(player({ id: "p", last_seen_at: "junk", joined_at: "" }), NOW), true);

  // No stamp of their own falls back to when they joined, which is the shape a
  // row inserted before the column existed has.
  assert.equal(
    seenRecently(player({ id: "p", last_seen_at: "", joined_at: ago(600_000) }), NOW),
    false
  );
});

test("a room notices when the crown has stopped answering", () => {
  const host = player({ id: "h", is_host: true, last_seen_at: ago(30_000) });
  const quiet = player({ id: "h", is_host: true, last_seen_at: ago(600_000) });
  const guest = player({ id: "g", last_seen_at: ago(30_000) });

  assert.equal(hostIsAway([host, guest], "h", NOW), false);
  assert.equal(hostIsAway([quiet, guest], "h", NOW), true);

  // The room row points at a player who is not in it any more, which is what a
  // leave looks like from here. Nobody holds the crown, so it is up for grabs.
  assert.equal(hostIsAway([guest], "h", NOW), true);
  assert.equal(hostIsAway([guest], null, NOW), true);

  // `rooms.host_player_id` and `players.is_host` are written separately, so a
  // crash between the two must not leave a room permanently hostless: the flag
  // is the fallback, and a room with a present host is not hostless.
  assert.equal(hostIsAway([host, guest], null, NOW), false, "the is_host flag stands in");

  // An empty room has nobody to hand anything to, and a notice there would
  // greet the first person who arrives.
  assert.equal(hostIsAway([], "h", NOW), false);
});

test("the crown goes to whoever has been here longest, not whoever asked first", () => {
  const roster = [
    player({ id: "old", is_host: true, joined_at: ago(3_600_000), last_seen_at: ago(600_000) }),
    player({ id: "late", joined_at: ago(1_800_000), last_seen_at: ago(30_000) }),
    player({ id: "early", joined_at: ago(3_000_000), last_seen_at: ago(30_000) }),
    player({ id: "afk", joined_at: ago(3_500_000), last_seen_at: ago(600_000) }),
  ];

  // Every device computes this from the same roster and gets the same answer,
  // which is what makes the handover need no coordination and stops it being
  // raced into two hosts. `afk` joined earliest of the three, and is skipped.
  assert.equal(pickNewHost(roster, NOW)?.id, "early");
  assert.equal(
    pickNewHost([...roster].reverse(), NOW)?.id,
    "early",
    "the order the roster arrives in cannot change the answer"
  );

  // The old host is excluded by their own flag, which is what makes this safe
  // to call while the crown is merely stale: the answer is always somebody new.
  assert.notEqual(pickNewHost(roster, NOW)?.id, "old");

  // Nobody left who is still answering, so there is nothing to offer.
  assert.equal(pickNewHost([roster[0], roster[3]], NOW), null);
  assert.equal(pickNewHost([], NOW), null);
});

test("the one seat a round cannot continue without", () => {
  const giver = player({ id: "cg", last_seen_at: ago(30_000) });
  const quiet = player({ id: "cg", last_seen_at: ago(600_000) });

  assert.equal(clueGiverIsAway([giver], "cg", NOW), false);
  assert.equal(clueGiverIsAway([quiet], "cg", NOW), true);

  // Both of these mean the same thing: the seat the round is waiting on is
  // empty. `rounds.clue_giver_id` is nulled when the player row goes, and a
  // mid-flight read can see the deletion before it sees the null.
  assert.equal(clueGiverIsAway([giver], null, NOW), true);
  assert.equal(clueGiverIsAway([giver], "somebody-else", NOW), true);

  // Deliberately not the same answer as `hostIsAway` gives for an empty room.
  // A room with nobody in it has no host to replace, but a round with no
  // clue-giver is stuck whether or not anybody is left to notice.
  assert.equal(clueGiverIsAway([], "cg", NOW), true);
});

test("a round can be rescued right up to the reveal, and not after", () => {
  assert.equal(canSkipRound("clue"), true, "the dead end — the guessers have no button yet");
  assert.equal(canSkipRound("guess"), true, "kinder than a reveal that can cost two points");
  assert.equal(canSkipRound("reveal"), false, "already scored; `next` is the way on");
});

test("the round's buttons belong to its clue-giver, and to nobody else", () => {
  const giver = player({ id: "cg", last_seen_at: ago(30_000) });
  const host = player({ id: "h", is_host: true, team_id: "t2", last_seen_at: ago(30_000) });
  const mate = player({ id: "m", last_seen_at: ago(30_000) });
  const roster = [giver, host, mate];
  const round = { clue_giver_id: "cg" };

  assert.equal(mayControlRound(round, "cg", roster, NOW), true, "their own turn to end");

  // The two that used to be able to and now cannot. The host is the interesting
  // one: they are usually on another team, so their button ended somebody
  // else's turn for reasons that team was not part of.
  assert.equal(mayControlRound(round, "h", roster, NOW), false, "the host holds no round");
  assert.equal(mayControlRound(round, "m", roster, NOW), false, "nor does a teammate");

  // The escape hatch, and note who it opens to: anybody. Not the host — the
  // host may well be the person who walked away.
  const gone = [player({ id: "cg", last_seen_at: ago(600_000) }), host, mate];
  assert.equal(mayControlRound(round, "m", gone, NOW), true, "a quiet clue-giver frees the round");
  assert.equal(mayControlRound(round, "h", gone, NOW), true);

  // Same dead end, two other shapes it arrives in: the id was nulled when the
  // player row went, or the row is gone and the null has not landed yet.
  assert.equal(mayControlRound({ clue_giver_id: null }, "m", roster, NOW), true);
  assert.equal(mayControlRound({ clue_giver_id: "ghost" }, "m", roster, NOW), true);

  // A clue-giver whose own id is null must not match on `null === null`: that
  // would hand the round to one arbitrary player instead of to everybody, and
  // the branch order in `mayControlRound` is the only thing preventing it.
  assert.equal(
    mayControlRound({ clue_giver_id: null }, "cg", roster, NOW),
    true,
    "still true, but because the seat is empty rather than because they hold it"
  );
});

test("a side bet pays only if the whole team called the same side", () => {
  assert.equal(teamBetPoints([{ correct: true }, { correct: true }]), BET_POINTS);
  assert.equal(teamBetPoints([{ correct: true }]), BET_POINTS, "a team of one still agrees");

  // The bug this rule exists for: one player clicks left, the other right, and
  // under a majority rule the point could not be lost. A bet you cannot lose is
  // not a bet, so there was nothing to discuss and nothing to get wrong.
  assert.equal(teamBetPoints([{ correct: true }, { correct: false }]), 0, "split pays nothing");
  assert.equal(teamBetPoints([{ correct: false }, { correct: false }]), 0);

  // Abstaining is silence, not opposition: only bets actually placed are passed
  // in, so two people who agree are not punished for a third who never voted.
  // Same treatment the auto-marker gives a guesser who never moved the slider.
  assert.equal(teamBetPoints([]), 0, "nobody bet, so there is nothing to pay");
});

test("what a betting team sees about itself before the reveal", () => {
  // Deliberately says nothing about being right — the target is still secret,
  // so the only question answerable before the reveal is whether they agree.
  assert.equal(betConsensus([]), "none");
  assert.equal(betConsensus(["left"]), "left");
  assert.equal(betConsensus(["right", "right", "right"]), "right");
  assert.equal(betConsensus(["left", "right"]), "split", "the state worth a warning");
  assert.equal(betConsensus(["right", "right", "left"]), "split");
});

test("the end-of-game card is a fold over reveals the table has already seen", () => {
  const reveal = (
    guesses: Array<[string, string, number]>,
    bets: Array<[string, string, boolean]> = []
  ): StoredReveal => ({
    guesses: guesses.map(([player_id, player_name, distance]) => ({
      player_id,
      player_name,
      value: 50,
      distance,
    })),
    bets: bets.map(([player_id, player_name, correct]) => ({
      player_id,
      player_name,
      team_id: "t1",
      side: "left" as const,
      correct,
    })),
  });

  const rows = foldCalibration([
    reveal(
      [
        ["a", "Ada", 2],
        ["b", "Bo", 20],
      ],
      [["c", "Cy", true]]
    ),
    reveal(
      [
        ["a", "Ada", 5],
        ["b", "Bo", 10],
      ],
      [["c", "Cy", false]]
    ),
  ]);

  const by = (id: string) => rows.find((r) => r.playerId === id)!;

  assert.equal(by("a").markers, 2);
  assert.equal(by("a").avgError, 3.5);
  assert.equal(by("a").best, 2);
  assert.equal(by("a").bullseyes, 2, "5 is inside the band, the same 5 the live scoring uses");
  assert.equal(by("b").avgError, 15);
  assert.equal(by("b").best, 10);
  assert.equal(by("b").bullseyes, 0);
  assert.equal(by("c").betsPlaced, 2);
  assert.equal(by("c").betsWon, 1);

  // Most calibrated first, and anybody who never placed a marker goes last
  // rather than reading as a perfect zero. A round spent giving the clue simply
  // leaves no marker behind, so it cannot count against an average.
  assert.deepEqual(
    rows.map((r) => r.playerId),
    ["a", "b", "c"]
  );
  assert.equal(by("c").markers, 0);
  assert.equal(by("c").avgError, null);
  assert.equal(by("c").best, null);

  assert.deepEqual(foldCalibration([]), [], "no revealed rounds is an empty card, not a zeroed one");
});

test("a reveal written by an older deploy makes a thinner card, not a crash", () => {
  // `rounds.reveal_detail` is jsonb, so what comes back out is whatever some
  // past deploy wrote in rather than what today's interface promises. The
  // winner screen is the payoff and is the worst place for a legacy shape to
  // surface, so every field here is treated as untrusted.
  const rows = foldCalibration([
    null,
    undefined,
    {},
    { guesses: null, bets: null },
    { guesses: [null, {}, { player_name: "no id at all" }] },
    { guesses: [{ player_id: "a", player_name: "Ada" }] }, // distance never written
    { guesses: [{ player_id: "a", player_name: "Ada", distance: "7" as unknown as number }] },
    { guesses: [{ player_id: "a", player_name: "Ada", distance: -4 }] },
    { bets: [{ player_id: "b", correct: true }] },
  ]);

  const ada = rows.find((r) => r.playerId === "a")!;
  assert.equal(ada.markers, 2, "the two readable distances count; the unwritten one does not");
  assert.equal(ada.avgError, 5.5, "a stringified number is a number");
  assert.equal(ada.best, 4, "and a negative distance is still a distance");

  const bo = rows.find((r) => r.playerId === "b")!;
  assert.equal(bo.name, "", "no name in the blob is an empty name, which the card draws as a dash");
  assert.equal(bo.betsWon, 1);

  assert.equal(rows.length, 2, "an entry with no player id is not a player");
});

test("the rescue hatches are stored, counted, and visible on the dashboard", () => {
  // The failure this is here for is a silent one: an event the client fires but
  // the ingest allowlist drops is a button nobody can prove anybody pressed.
  const stored = buildRows({
    sessionId: "s1",
    events: [
      { name: "round_skipped", path: "/room/[code]", props: { round: 3, phase: "clue" }, ts: Date.now() },
      { name: "host_claimed", path: "/room/[code]", ts: Date.now() },
    ],
  });
  assert.deepEqual(
    stored.map((r) => r.name),
    ["round_skipped", "host_claimed"]
  );
  assert.deepEqual(stored[0].props, { round: 3, phase: "clue" });

  // And they reach the report. The funnel table can only draw its nine ordered
  // steps, so without the side list these would be recorded, mirrored to
  // Mixpanel, and invisible in the app's own dashboard — which is the first
  // place anybody looks.
  const ts = new Date().toISOString();
  const ev = (session_id: string, name: string) => ({
    session_id,
    name,
    room_code: null,
    path: "/room/[code]",
    props: {},
    ts,
  });

  const summary = foldEvents(
    [
      ev("a", "round_skipped"),
      ev("a", "round_skipped"),
      ev("b", "round_skipped"),
      ev("b", "host_claimed"),
      ev("a", "click"),
      ev("a", "pointer_heat"),
    ],
    "week"
  );

  const side = (name: string) => summary.side.find((s) => s.name === name);
  assert.equal(side("round_skipped")?.events, 3);
  assert.equal(side("round_skipped")?.sessions, 2, "three skips, two people");
  assert.equal(side("host_claimed")?.events, 1);
  assert.equal(summary.side[0].name, "round_skipped", "busiest first");

  // `click` has a better table of its own and `pointer_heat` is a payload
  // rather than a count, so neither belongs in this list.
  assert.equal(side("click"), undefined);
  assert.equal(side("pointer_heat"), undefined);

  // Everything else on the allowlist is present at zero rather than absent, so
  // an event that has never fired reads as zero instead of going missing.
  assert.equal(side("howto_open")?.events, 0);
  assert.equal(side("bet_placed")?.events, 0);
  assert.equal(side("session_end")?.events, 0);
});

// ---------------------------------------------------------------------
// The two phase clocks
//
// Every boundary below is a moment where somebody either keeps their turn or
// loses it, so each one is pinned to a number rather than described. Nothing in
// this part of the engine reads a clock of its own — `now` is a parameter
// everywhere — which is the entire reason the boundaries can be tested at all.
// ---------------------------------------------------------------------

/** A room with the two limits set, in seconds. */
const timed = (clue: number, guess: number) => ({ clue_seconds: clue, guess_seconds: guess });

/**
 * What `select("*")` hands back on a database where `supabase/schema.sql` has
 * not been re-run: the columns are simply absent. Cast because the parameter
 * types promise numbers and the database does not.
 */
const unmigrated = { clue_seconds: undefined, guess_seconds: undefined } as unknown as {
  clue_seconds: number;
  guess_seconds: number;
};

/** An ISO stamp `ms` milliseconds away from the frozen `NOW`. */
const at = (ms: number) => new Date(NOW + ms).toISOString();

test("a room can only store a limit the lobby actually offers", () => {
  assert.equal(TIMER_CHOICES[0], 0, "unlimited is first, because it is the default");
  for (const s of TIMER_CHOICES) assert.equal(cleanTimerSeconds(s), s);

  // A `<select>` hands back strings, so this is the ordinary path in, not an
  // edge case at it.
  assert.equal(cleanTimerSeconds("180"), 180);

  // Everything unrecognised becomes "no clock". Clamped rather than rejected on
  // purpose: unlimited is the only wrong answer that cannot strand a table
  // waiting on a deadline nobody in the room chose.
  for (const junk of [90, 45, -60, 1e9, NaN, Infinity, null, undefined, "", "soon", {}, []]) {
    assert.equal(cleanTimerSeconds(junk), 0, `${String(junk)} should read as unlimited`);
  }
});

test("each phase reads its own clock, and the reveal reads none", () => {
  const room = timed(60, 300);
  assert.equal(phaseSeconds(room, "clue"), 60);
  assert.equal(phaseSeconds(room, "guess"), 300);
  assert.equal(phaseSeconds(room, "reveal"), 0, "the result card is never on a timer");

  // Two clocks and not one is the whole point of the pair: writing a clue from a
  // blank page and moving a slider you are already looking at are not the same
  // job, so a single shared limit would be either cruel or no limit at all.
  assert.equal(phaseSeconds(timed(0, 60), "clue"), 0, "off for one phase, on for the other");
  assert.equal(phaseSeconds(timed(0, 60), "guess"), 60);

  // An un-migrated database plays exactly as every room played before timers
  // existed. This is the degradation the whole feature is built around.
  assert.equal(phaseSeconds(unmigrated, "clue"), 0);
  assert.equal(phaseSeconds(unmigrated, "guess"), 0);
});

test("a phase stores the instant it ends, not the time it has left", () => {
  const room = timed(60, 300);

  // An instant, so five phones that disagree about what time it is still agree
  // about when the phase is over — and a tab that slept through the whole thing
  // wakes up already knowing, with nothing to reconstruct.
  assert.equal(deadlineFor(room, "clue", NOW), at(60_000));
  assert.equal(deadlineFor(room, "guess", NOW), at(300_000));

  // Null is the "no clock" signal the whole way down: the column stays null, the
  // countdown renders nothing at all, and `mayExpire` refuses.
  assert.equal(deadlineFor(room, "reveal", NOW), null);
  assert.equal(deadlineFor(timed(0, 0), "clue", NOW), null);
  assert.equal(deadlineFor(unmigrated, "clue", NOW), null);

  // Round trip. The second half is the regression that would hurt most: a
  // deadline that reads as gone the moment it is written would end every single
  // round at zero, in every room that switched a clock on.
  assert.equal(secondsLeft(deadlineFor(room, "clue", NOW), NOW), 60);
  assert.equal(mayExpire(deadlineFor(room, "clue", NOW), NOW), false);
});

test("the countdown rounds up, so a zero on screen means the time is really gone", () => {
  assert.equal(secondsLeft(at(60_000), NOW), 60);
  assert.equal(secondsLeft(at(59_001), NOW), 60, "still inside the sixtieth second");
  assert.equal(secondsLeft(at(59_000), NOW), 59);
  assert.equal(secondsLeft(at(1), NOW), 1, "a flooring version would show 0 here, mid-turn");
  assert.equal(secondsLeft(at(0), NOW), 0);

  // How long ago it ran out is nobody's business here: the bar would run past
  // its own end and the clock would read "-0:03".
  assert.equal(secondsLeft(at(-5_000), NOW), 0);
  assert.equal(secondsLeft(at(-86_400_000), NOW), 0);

  // No clock and an unreadable clock give the same answer, and it is the safe
  // one — a stamp this code cannot parse must not be allowed to end somebody's
  // turn. The same asymmetry `seenRecently` uses, for the same reason.
  assert.equal(secondsLeft(null, NOW), null);
  assert.equal(secondsLeft(undefined, NOW), null);
  assert.equal(secondsLeft("", NOW), null);
  assert.equal(secondsLeft("tomorrow", NOW), null);
});

test("the level is what turns the screen amber and makes the phone beep", () => {
  assert.equal(TIMER_WARN_AT, 20, "the amber threshold the CSS and the alarm both assume");
  assert.equal(TIMER_FINAL_AT, 5);

  assert.equal(timerLevel(null), "none", "an unlimited room draws no clock at all");
  assert.equal(timerLevel(300), "calm");
  assert.equal(timerLevel(21), "calm");
  assert.equal(timerLevel(20), "warn", "the thresholds are inclusive");
  assert.equal(timerLevel(6), "warn");
  assert.equal(timerLevel(5), "final");
  assert.equal(timerLevel(1), "final");
  assert.equal(timerLevel(0), "over");

  // Unreachable through `secondsLeft`, which clamps. Pinned anyway, because
  // "over" is the only answer here that does not put a negative number and a
  // fresh alarm in front of a player every 250 ms.
  assert.equal(timerLevel(-3), "over");
});

test("a phone whose clock runs fast cannot cut the phase short", () => {
  assert.equal(EXPIRE_GRACE_MS, 1_500);

  assert.equal(mayExpire(at(1_000), NOW), false, "there is still time on the clock");
  assert.equal(mayExpire(at(0), NOW), false, "the deadline on its own is not enough");
  assert.equal(mayExpire(at(-EXPIRE_GRACE_MS + 1), NOW), false);
  assert.equal(mayExpire(at(-EXPIRE_GRACE_MS), NOW), true);
  assert.equal(mayExpire(at(-60_000), NOW), true, "a tab that woke up late asks straight away");

  // Nothing to expire is never expirable, and neither is a stamp this code
  // cannot read. Either mistake would have every device in every unlimited room
  // asking the server to end a phase that has no end.
  assert.equal(mayExpire(null, NOW), false);
  assert.equal(mayExpire(undefined, NOW), false);
  assert.equal(mayExpire("", NOW), false);
  assert.equal(mayExpire("later", NOW), false);

  // The grace is a parameter rather than a constant read inside the function, so
  // the boundary itself can be tested instead of inferred from 1500. Both the
  // countdown and `expireRound` use the default.
  assert.equal(mayExpire(at(0), NOW, 0), true);
  assert.equal(mayExpire(at(1), NOW, 0), false);
});

test("the clock reads mm:ss and never reads negative", () => {
  assert.equal(formatClock(null), "", "nothing to draw, rather than '0:00' in an untimed room");
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(5), "0:05", "the seconds are always two digits");
  assert.equal(formatClock(59), "0:59");
  assert.equal(formatClock(60), "1:00");
  assert.equal(formatClock(65), "1:05");
  assert.equal(formatClock(300), "5:00", "the longest limit the lobby offers");
  assert.equal(formatClock(3_600), "60:00", "minutes are not wrapped into hours");
  assert.equal(formatClock(-3), "0:00");
  assert.equal(formatClock(9.7), "0:09", "truncated, to match what `secondsLeft` hands over");
});

test("running out of time submits the middle, and the middle can still score", () => {
  assert.equal(AUTO_MARKER, 50, "the dial's own default — what a silent player was looking at");
  assert.equal(clampSlider(AUTO_MARKER), AUTO_MARKER, "a legal marker, not a sentinel value");
  assert.equal(averageMarker([]), AUTO_MARKER, "the same middle the reveal already fell back to");

  // Filled in rather than left out, which is the kind half of the rule: a team
  // of three does not have its average dragged into a corner because one phone
  // was slow, it has one ordinary marker added at dead centre.
  assert.equal(averageMarker([40, 60, AUTO_MARKER]), 50);

  // And it is a real attempt, not a forfeit. With the secret near the middle an
  // auto-marker is a bullseye, which is correct rather than generous: a round is
  // an average of a team, not a punishment for one person's connection.
  assert.equal(scoreFor(50, AUTO_MARKER).pts, 5);
  assert.equal(scoreFor(95, AUTO_MARKER).pts, -2, "and near an edge it costs, like any miss");
});

test("a clue nobody wrote leaves a round on the board and nothing on the card", () => {
  // The host chose "record it as 0" over discarding the round, so a timed-out
  // clue is revealed rather than deleted: the round number stands, it counts in
  // `rounds_played`, and the table can see why it scored nothing. What it must
  // not do is invent an attempt — nobody aimed at anything, so no marker and no
  // `player_round_stats` row exists, and the end-of-game card has to fold a
  // reveal with two empty lists in it without turning that into a zero average.
  const timedOutClue = {
    guesses: [],
    bets: [],
    team_points: { t1: 0, t2: 0 },
    timed_out: "clue",
  };
  const realRound = {
    guesses: [{ player_id: "a", player_name: "Ada", value: 48, distance: 4 }],
    bets: [],
  };

  const rows = foldCalibration([timedOutClue, realRound, timedOutClue]);
  assert.equal(rows.length, 1, "two timed-out rounds add nobody to the card");

  const ada = rows[0];
  assert.equal(ada.markers, 1, "one round was played, so one marker is counted");
  assert.equal(ada.avgError, 4, "and the empty rounds do not average into it");
  assert.equal(ada.best, 4);
});

test("a phase clock running out is counted the same way a skip is", () => {
  // Same silent failure as the rescue hatches: an event the client fires but the
  // ingest allowlist drops is a rule nobody can prove ever fired.
  const stored = buildRows({
    sessionId: "s1",
    events: [
      {
        name: "timer_expired",
        path: "/room/[code]",
        props: { round: 4, phase: "clue" },
        ts: Date.now(),
      },
    ],
  });
  assert.deepEqual(
    stored.map((r) => r.name),
    ["timer_expired"],
    "timer_expired is not on the analytics allowlist"
  );
  assert.deepEqual(stored[0].props, { round: 4, phase: "clue" }, "the phase is the useful half");

  const ts = new Date().toISOString();
  const ev = (session_id: string, name: string) => ({
    session_id,
    name,
    room_code: null,
    path: "/room/[code]",
    props: {},
    ts,
  });
  const summary = foldEvents([ev("a", "timer_expired"), ev("b", "timer_expired")], "week");
  const side = summary.side.find((s) => s.name === "timer_expired");
  assert.equal(side?.events, 2);
  assert.equal(side?.sessions, 2);

  // And it has a plain-English label on the dashboard, which is a separate file
  // and therefore a separate way to forget. Read out of the source because the
  // map is local to a client component.
  const page = readFileSync(join(process.cwd(), "src/app/analytics/page.tsx"), "utf8");
  assert.match(page, /timer_expired:\s*"/, "the dashboard has no label for timer_expired");
});
