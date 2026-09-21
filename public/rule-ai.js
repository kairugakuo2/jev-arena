import {
  ACTIONS,
  legalActions,
  previewPosition,
  attackConnects,
} from "./game.js";
// Same movement/cost restrictions as Jev; a fixed priority list chooses the turn.
export function chooseRuleAction(state) {
  const legal = legalActions(state, "ai"),
    toward = state.player.x < state.ai.x ? "LEFT" : "RIGHT";
  let action = "STAY_DEFEND",
    rule = "Recover stamina and guard.";
  if (
    legal.includes("JUMP_ATTACK") &&
    attackConnects(previewPosition(state, "ai", "JUMP"), state.player) &&
    (state.player.defending || state.player.y === 1)
  ) {
    action = "JUMP_ATTACK";
    rule = "Jump to reach an airborne opponent or avoid a ground counter.";
  } else {
    const attack = [`${toward}_ATTACK`, "STAY_ATTACK"].find(
      (a) =>
        legal.includes(a) &&
        attackConnects(
          previewPosition(state, "ai", a.split("_")[0]),
          state.player,
        ) &&
        (!state.player.defending || state.player.health <= 6),
    );
    if (attack) {
      action = attack;
      rule = "Move into reach if needed, then strike an exposed opponent.";
    } else if (
      Math.abs(state.ai.x - state.player.x) > 1 &&
      legal.includes(`${toward}_DEFEND`)
    ) {
      action = `${toward}_DEFEND`;
      rule = "Close the gap while guarding and recovering stamina.";
    } else if (
      legal.includes("JUMP_DEFEND") &&
      state.ai.health <= 30 &&
      state.player.y === 0
    ) {
      action = "JUMP_DEFEND";
      rule = "Jump to dodge a ground attack while recovering.";
    }
  }
  return {
    action,
    source: "rules",
    rule,
    probabilities: Object.fromEntries(
      ACTIONS.map((a) => [a, a === action ? 1 : 0]),
    ),
  };
}
