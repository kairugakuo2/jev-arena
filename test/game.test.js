import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newGame,
  executeAction,
  decisionState,
  legalActions,
  ACTIONS,
  distanceBetween,
} from "../public/game.js";
import { chooseRuleAction } from "../public/rule-ai.js";
import { buildJevRequest, validateDecision } from "../jev-ai.js";
import { validateState } from "../server.js";
import { experimental_evaluate as evaluate } from "ai";
import { Experimental_EvaluationMockModelV4 } from "ai/test";

function closeGame() {
  const s = newGame();
  s.player.x = 2;
  s.ai.x = 3;
  s.distance = 1;
  return s;
}
test("movement and combat are one turn, resources and source stay intact", () => {
  const s = newGame(),
    n = executeAction(s, "player", "RIGHT_DEFEND").state;
  assert.equal(n.player.x, 2);
  assert.equal(n.player.defending, true);
  assert.equal(n.player.stamina, 100);
  assert.equal(n.turn, "ai");
  assert.equal(s.player.x, 1);
});
test("walls, occupied lanes, jump cooldown and total costs are enforced", () => {
  const s = closeGame();
  assert.ok(!legalActions(s, "player").includes("RIGHT_ATTACK"));
  s.player.x = 0;
  assert.ok(!legalActions(s, "player").includes("LEFT_DEFEND"));
  s.player.stamina = 34;
  assert.ok(!legalActions(s, "player").includes("JUMP_ATTACK"));
  s.player.stamina = 35;
  assert.ok(legalActions(s, "player").includes("JUMP_ATTACK"));
  s.player.y = 1;
  assert.ok(!legalActions(s, "player").includes("JUMP_DEFEND"));
});
test("attack miss still costs stamina and never damages a far opponent", () => {
  const n = executeAction(newGame(), "player", "STAY_ATTACK").state;
  assert.equal(n.player.stamina, 80);
  assert.equal(n.ai.health, 100);
});
test("movement is resolved before range check; ground damage is fixed", () => {
  const s = newGame();
  s.player.x = 2;
  s.ai.x = 4;
  const n = executeAction(s, "player", "RIGHT_ATTACK").state;
  assert.equal(n.ai.health, 76);
  assert.equal(n.player.stamina, 75);
  assert.equal(n.distance, 1);
});
test("jump dodges ground attacks, lands next turn, and avoids repeated jumps", () => {
  let s = closeGame();
  s = executeAction(s, "player", "JUMP_DEFEND").state;
  s = executeAction(s, "ai", "STAY_ATTACK").state;
  assert.equal(s.player.health, 100);
  assert.equal(s.player.y, 1);
  assert.throws(() => executeAction(s, "player", "JUMP_ATTACK"), /Land/);
  s = executeAction(s, "player", "STAY_DEFEND").state;
  assert.equal(s.player.y, 0);
  assert.ok(legalActions(s, "player").includes("JUMP_ATTACK"));
});
test("jump attack hits downward or airborne for 16 damage", () => {
  for (const height of [0, 1]) {
    const s = closeGame();
    s.ai.y = height;
    const n = executeAction(s, "player", "JUMP_ATTACK").state;
    assert.equal(n.ai.health, 84);
    assert.equal(n.player.stamina, 65);
  }
});
test("defense counters ground attackers but not jump strikes", () => {
  const s = closeGame();
  s.ai.defending = true;
  const ground = executeAction(s, "player", "STAY_ATTACK").state;
  assert.equal(ground.ai.health, 94);
  assert.equal(ground.player.health, 88);
  assert.equal(ground.ai.stamina, 90);
  const air = executeAction(s, "player", "JUMP_ATTACK").state;
  assert.equal(air.ai.health, 94);
  assert.equal(air.player.health, 100);
  s.ai.stamina = 9;
  assert.equal(
    executeAction(s, "player", "STAY_ATTACK").state.player.health,
    100,
  );
});
test("guard expires on the owners next action and counters can end a battle", () => {
  const s = closeGame();
  s.player.defending = true;
  assert.equal(
    executeAction(s, "player", "STAY_ATTACK").state.player.defending,
    false,
  );
  s.ai.defending = true;
  s.player.health = 8;
  assert.equal(executeAction(s, "player", "STAY_ATTACK").state.winner, "ai");
  s.ai.health = 6;
  const n = executeAction(s, "player", "STAY_ATTACK").state;
  assert.equal(n.winner, "player");
  assert.equal(n.player.health, 8);
  assert.deepEqual(legalActions(n, "ai"), []);
});
test("defensive play can overcome a first hit without random damage", () => {
  let s = closeGame();
  s = executeAction(s, "player", "STAY_ATTACK").state;
  s = executeAction(s, "ai", "STAY_DEFEND").state;
  while (!s.winner) {
    s = executeAction(
      s,
      "player",
      s.player.stamina >= 20 ? "STAY_ATTACK" : "STAY_DEFEND",
    ).state;
    if (!s.winner) s = executeAction(s, "ai", "STAY_DEFEND").state;
  }
  assert.equal(s.winner, "ai");
});
test("rule bot always chooses legal actions and resource bounds hold in a full game", () => {
  let s = newGame();
  while (!s.winner) {
    const swapped = { ...s, ai: s.player, player: s.ai };
    const p = chooseRuleAction(swapped).action;
    assert.ok(legalActions(s, "player").includes(p));
    s = executeAction(s, "player", p).state;
    if (!s.winner) {
      const a = chooseRuleAction(s).action;
      assert.ok(legalActions(s, "ai").includes(a));
      s = executeAction(s, "ai", a).state;
    }
    for (const f of [s.ai, s.player]) {
      assert.ok(f.health >= 0 && f.health <= 100);
      assert.ok(f.stamina >= 0 && f.stamina <= 100);
      assert.ok(f.x >= 0 && f.x < 7);
    }
  }
  assert.ok(["player", "ai", "draw"].includes(s.winner));
});
test("server validates positions and geometric distance, rejects forged state", () => {
  const s = decisionState(newGame());
  assert.deepEqual(validateState({ ...s, extra: "ignored" }), s);
  s.ai.y = 1;
  s.distance = distanceBetween(s.ai, s.player);
  assert.deepEqual(validateState(s), s);
  s.distance = 1;
  assert.throws(() => validateState(s), /distance/);
  s.ai.x = 7;
  assert.throws(() => validateState(s), /fighter/);
});
test("Jev receives all eight combinations and actual coordinates; SDK preserves probabilities", async () => {
  const s = decisionState(newGame()),
    request = buildJevRequest(s);
  assert.equal(ACTIONS.length, 8);
  assert.deepEqual(request.state, s);
  assert.deepEqual(Object.keys(request.questions.action.criteria), ACTIONS);
  const probabilities = Object.fromEntries(
    ACTIONS.map((a) => [a, a === "LEFT_DEFEND" ? 1 : 0]),
  );
  const model = new Experimental_EvaluationMockModelV4({
    doEvaluate: async () => ({
      answers: {
        action: { type: "choice", choice: "LEFT_DEFEND", probabilities },
      },
      warnings: [],
    }),
  });
  const r = await evaluate({ ...request, model });
  assert.equal(validateDecision(r.answers.action, s).action, "LEFT_DEFEND");
  assert.deepEqual(
    validateDecision(r.answers.action, s).probabilities,
    probabilities,
  );
  assert.throws(
    () => validateDecision({ type: "choice", choice: "HEAL" }, s),
    /unknown/,
  );
  s.ai.x = 0;
  assert.throws(
    () => validateDecision({ type: "choice", choice: "LEFT_DEFEND" }, s),
    /unavailable/,
  );
  assert.equal(
    validateDecision({ type: "choice", choice: "STAY_DEFEND" }, s)
      .probabilities,
    null,
  );
});
