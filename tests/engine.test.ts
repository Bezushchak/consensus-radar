import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_TEAMS,
  averageMarker,
  betIsCorrect,
  cleanClue,
  cleanName,
  clampSlider,
  firstTeamIndexWithPlayers,
  generateRoomCode,
  makeTeams,
  nextTeamIndex,
  normalizeCode,
  pickClueGiver,
  pickScale,
  randomTarget,
  scoreFor,
  teamsAtGoal,
} from "../src/lib/game/engine";
import { SCALES, scaleLabels, scalesForCategories } from "../src/lib/scales";
import type { Player, Team } from "../src/lib/types";

const player = (over: Partial<Player> & { id: string }): Player => ({
  room_id: "r",
  name: over.id,
  team_id: "t1",
  is_host: false,
  clue_turns: 0,
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
    assert.ok(!used.includes(pickScale(["general", "analytics"], used).key));
  }
  // Pool exhausted -> allowed to reuse rather than crash.
  const all = SCALES.map((s) => s.key);
  assert.ok(all.includes(pickScale(["general", "analytics"], all).key));
});

test("every scale has both languages and a unique key", () => {
  const keys = new Set<string>();
  for (const s of SCALES) {
    assert.ok(s.key.length > 0);
    assert.equal(keys.has(s.key), false, `duplicate scale key: ${s.key}`);
    keys.add(s.key);
    for (const lang of ["ua", "en"] as const) {
      assert.ok(s.l[lang]?.length > 0, `${s.key} missing ${lang} left label`);
      assert.ok(s.r[lang]?.length > 0, `${s.key} missing ${lang} right label`);
    }
  }
  assert.deepEqual(scaleLabels("signal_noise", "en"), { left: "Signal", right: "Noise" });
  assert.deepEqual(
    scaleLabels("removed_scale", "en", { left: "L", right: "R" }),
    { left: "L", right: "R" },
    "retired scales fall back to the labels stored on the round"
  );
});
