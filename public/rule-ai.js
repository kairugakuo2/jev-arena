import { ACTIONS, RULES, legalActions } from "./game.js";
// Decides a short-lived control intent, without owning the physics clock.
export function chooseRuleAction(state) {
  const legal = legalActions(state, "ai"),
    dx = state.player.x - state.ai.x;
  let action = "IDLE",
    rule = "Recover stamina.";
  if (Math.abs(dx) > RULES.reach * 0.8) {
    action = dx < 0 ? "LEFT" : "RIGHT";
    rule = "Run toward attack range.";
  } else if (state.ai.stamina < 25) {
    action = dx < 0 ? "RIGHT" : "LEFT";
    rule = "Back away to recover stamina.";
  } else if (state.player.defending && legal.includes("JUMP_ATTACK")) {
    action = "JUMP_ATTACK";
    rule = "Jump and attack against a guard.";
  } else if (legal.includes("ATTACK")) {
    action = "ATTACK";
    rule = "Strike when in range and off cooldown.";
  } else if (state.player.cooldown < 0.2 && state.ai.stamina > 15) {
    action = "DEFEND";
    rule = "Guard against the next strike.";
  }
  if (!legal.includes(action)) action = "IDLE";
  return {
    action,
    source: "rules",
    rule,
    probabilities: Object.fromEntries(
      ACTIONS.map((a) => [a, a === action ? 1 : 0]),
    ),
  };
}
