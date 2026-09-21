import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS,
  newGame,
  neutralInput,
  stepGame,
  decisionState,
  actionInput,
  legalActions,
} from "../public/arena/game.js";
import { chooseRuleAction } from "../public/arena/rule-ai.js";
import { validateState } from "../server.js";
import { validateDecision, buildJevRequest } from "../jev-ai.js";
import { experimental_evaluate as evaluate } from "ai";
import { Experimental_EvaluationMockModelV4 } from "ai/test";
const tick = (s, p = {}, a = {}) =>
  stepGame(
    s,
    { player: { ...neutralInput(), ...p }, ai: { ...neutralInput(), ...a } },
    1 / 60,
  );
function near() {
  const s = newGame();
  s.player.x = 4;
  s.ai.x = 5;
  return s;
}
test("both fighters run simultaneously without a turn or commitment", () => {
  const s = newGame();
  for (let i = 0; i < 60; i++) tick(s, { move: 1 }, { move: -1 });
  assert.ok(s.player.x > 5);
  assert.ok(s.ai.x < 5);
  assert.equal(s.elapsed.toFixed(1), "1.0");
  assert.ok(!("turn" in s));
});
test("continuous movement stops at arena boundaries", () => {
  const s = newGame();
  for (let i = 0; i < 600; i++) tick(s, { move: -1 }, { move: 1 });
  assert.equal(s.player.x, 0.35);
  assert.equal(s.ai.x, 9.65);
});
test("jump moves immediately, permits aerial steering and lands automatically", () => {
  const s = newGame();
  tick(s, { jump: true });
  assert.ok(s.player.y > 0);
  assert.ok(s.player.stamina < 90);
  for (let i = 0; i < 20; i++) tick(s, { move: 1, jump: true });
  assert.ok(s.player.y > 1);
  assert.ok(s.player.x > 3);
  for (let i = 0; i < 100; i++) tick(s, { jump: true });
  assert.equal(s.player.y, 0, "holding jump must not autojump");
  tick(s, {});
  tick(s, { jump: true });
  assert.ok(s.player.y > 0);
});
test("attacks use live horizontal and vertical positions; misses cost stamina", () => {
  const far = newGame();
  tick(far, { attack: true });
  assert.equal(far.ai.health, 100);
  assert.ok(far.player.stamina < 83);
  const close = near();
  tick(close, { attack: true });
  assert.equal(close.ai.health, 84);
  const airborne = near();
  airborne.ai.y = 1.5;
  tick(airborne, { attack: true });
  assert.equal(airborne.ai.health, 100);
});
test("held attack obeys cooldown rather than firing every frame", () => {
  const s = near();
  tick(s, { attack: true });
  for (let i = 0; i < 30; i++) tick(s, { attack: true });
  assert.equal(s.ai.health, 84);
  for (let i = 0; i < 11; i++) tick(s, { attack: true });
  assert.equal(s.ai.health, 68);
});
test("guard reduces hit damage, counters and slows running", () => {
  const s = near();
  tick(s, { attack: true }, { defend: true });
  assert.equal(s.ai.health, 96);
  assert.equal(s.player.health, 94);
  const moving = newGame();
  tick(moving, { move: 1 }, { move: 1, defend: true });
  assert.ok(Math.abs((moving.player.x - 2) / 2 - (moving.ai.x - 8)) < 1e-6);
});
test("guard depletes resources; release recovers; zero stamina cannot jump or attack", () => {
  const s = newGame();
  for (let i = 0; i < 60; i++) tick(s, { defend: true });
  assert.ok(s.player.stamina < 93);
  for (let i = 0; i < 60; i++) tick(s);
  assert.equal(s.player.stamina, 100);
  s.player.stamina = 0;
  tick(s, { attack: true, jump: true });
  assert.equal(s.player.y, 0);
  assert.equal(s.player.cooldown, 0);
});
test("simultaneous lethal attacks draw instead of awarding frame-order advantage", () => {
  const s = near();
  s.player.health = 16;
  s.ai.health = 16;
  tick(s, { attack: true }, { attack: true });
  assert.equal(s.winner, "draw");
  const before = structuredClone(s);
  tick(s, { move: 1 });
  assert.deepEqual(s, before);
});
test("time limit draws and enormous frame gaps are capped", () => {
  const s = newGame();
  stepGame(s, { player: neutralInput(), ai: neutralInput() }, 1000);
  assert.ok(s.elapsed <= 1 / 30);
  s.elapsed = 180;
  tick(s);
  assert.equal(s.winner, "draw");
});
test("rule AI supplies a valid continuous control intent in a full fight", () => {
  const s = newGame();
  let ai = neutralInput();
  for (let i = 0; i < 10801 && !s.winner; i++) {
    if (i % 12 === 0) {
      const a = chooseRuleAction(s).action;
      assert.ok(legalActions(s, "ai").includes(a));
      ai = actionInput(a);
    }
    tick(s, { move: s.player.x < s.ai.x ? 1 : -1, attack: true }, ai);
    for (const f of [s.ai, s.player])
      assert.ok(
        f.stamina >= 0 && f.stamina <= 100 && f.health >= 0 && f.y >= 0,
      );
  }
  assert.ok(s.winner);
});
test("snapshot includes velocities and cooldowns and validates floats without forwarding extras", () => {
  const s = newGame();
  tick(s, { move: 1, jump: true });
  const snapshot = decisionState(s);
  assert.ok(snapshot.player.vx > 0);
  assert.ok(snapshot.player.vy > 0);
  assert.deepEqual(validateState({ ...snapshot, extra: "ignore" }), snapshot);
  snapshot.player.x = Infinity;
  assert.throws(() => validateState(snapshot));
  const bad = decisionState(newGame());
  bad.distance = NaN;
  assert.throws(() => validateState(bad));
});
test("SDK choice schema supports realtime controls and preserves probabilities", async () => {
  const state = decisionState(newGame()),
    request = buildJevRequest(state);
  const probabilities = Object.fromEntries(
    ACTIONS.map((a) => [a, a === "LEFT" ? 1 : 0]),
  );
  const model = new Experimental_EvaluationMockModelV4({
    doEvaluate: async () => ({
      answers: { action: { type: "choice", choice: "LEFT", probabilities } },
      warnings: [],
    }),
  });
  const r = await evaluate({ ...request, model });
  assert.equal(validateDecision(r.answers.action, state).action, "LEFT");
  assert.deepEqual(
    validateDecision(r.answers.action, state).probabilities,
    probabilities,
  );
  assert.throws(() =>
    validateDecision({ type: "choice", choice: "TELEPORT" }, state),
  );
  assert.equal(
    validateDecision({ type: "choice", choice: "IDLE" }, state).probabilities,
    null,
  );
});
