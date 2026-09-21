import { ACTIONS } from "./game.js";

// A transparent priority list, not a model. 100% means a deterministic rule.
export function chooseRuleAction(state) {
  let action, rule;
  if (state.ai.health < 25 && state.ai.potions > 0) {
    action = "HEAL";
    rule = "Health < 25 and a potion remains → HEAL.";
  } else if (state.distance > 1) {
    action = "APPROACH";
    rule = "Distance > 1 → APPROACH.";
  } else if (state.ai.stamina >= 20) {
    action = "ATTACK";
    rule = "In range with at least 20 stamina → ATTACK.";
  } else {
    action = "DEFEND";
    rule = "Insufficient stamina → DEFEND to recover.";
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
