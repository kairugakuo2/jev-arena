// Pure combat rules: no DOM, no API, no randomness. Shared with the server.
export const ACTIONS = ["ATTACK", "DEFEND", "APPROACH", "RETREAT", "HEAL"];
export const RULES = {
  maxHealth: 100,
  maxStamina: 100,
  attackCost: 20,
  damage: 24,
  guardedDamage: 6,
  defendRecovery: 25,
  moveRecovery: 10,
  healing: 30,
  maxDistance: 3,
  maxRounds: 50,
};

export function newGame() {
  const fighter = () => ({
    health: 100,
    stamina: 100,
    potions: 1,
    defending: false,
  });
  return {
    player: fighter(),
    ai: fighter(),
    distance: 2,
    round: 1,
    turn: "player",
    previous_player_action: null,
    previous_ai_action: null,
    winner: null,
  };
}

export function actionProblem(state, actor, action) {
  const fighter = state[actor];
  if (!ACTIONS.includes(action)) return "Unknown action.";
  if (state.winner) return "The battle has ended.";
  if (action === "ATTACK" && state.distance !== 1)
    return "Approach to distance 1 first.";
  if (action === "ATTACK" && fighter.stamina < RULES.attackCost)
    return "Requires 20 stamina.";
  if (action === "APPROACH" && state.distance === 1)
    return "Already at close range.";
  if (action === "RETREAT" && state.distance === RULES.maxDistance)
    return "Already at maximum distance.";
  if (action === "HEAL" && !fighter.potions) return "No potions left.";
  if (action === "HEAL" && fighter.health === RULES.maxHealth)
    return "Health is already full.";
  return null;
}

export function legalActions(state, actor) {
  return ACTIONS.filter((action) => !actionProblem(state, actor, action));
}

// Snapshot taken AFTER the player's move, immediately before the AI acts.
export function decisionState(state) {
  return {
    ai: { ...state.ai },
    player: { ...state.player },
    distance: state.distance,
    previous_player_action: state.previous_player_action,
    previous_ai_action: state.previous_ai_action,
  };
}

export function executeAction(state, actor, action) {
  if (state.turn !== actor) throw new Error("It is not this fighter’s turn.");
  const problem = actionProblem(state, actor, action);
  if (problem) throw new Error(problem);
  const next = structuredClone(state);
  const fighter = next[actor];
  const target = next[actor === "player" ? "ai" : "player"];
  const name = actor === "player" ? "You" : "Gladiator";
  // Guard protects against one opposing turn, then expires at your next action.
  fighter.defending = false;
  let message;
  if (action === "ATTACK") {
    const damage = target.defending ? RULES.guardedDamage : RULES.damage;
    fighter.stamina -= RULES.attackCost;
    target.health = Math.max(0, target.health - damage);
    message = `${name} attack for ${damage} damage${target.defending ? " (guarded)" : ""}. −20 stamina.`;
  } else if (action === "DEFEND") {
    fighter.defending = true;
    const recovered = Math.min(
      RULES.defendRecovery,
      RULES.maxStamina - fighter.stamina,
    );
    fighter.stamina += recovered;
    message = `${name} defend. +${recovered} stamina; next incoming attack deals only 6 damage.`;
  } else if (action === "HEAL") {
    const healed = Math.min(RULES.healing, RULES.maxHealth - fighter.health);
    fighter.health += healed;
    fighter.potions -= 1;
    message = `${name} heal for ${healed} HP. Potion consumed.`;
  } else {
    next.distance += action === "APPROACH" ? -1 : 1;
    const recovered = Math.min(
      RULES.moveRecovery,
      RULES.maxStamina - fighter.stamina,
    );
    fighter.stamina += recovered;
    message = `${name} ${action.toLowerCase()}. Distance ${next.distance}; +${recovered} stamina.`;
  }
  next[`previous_${actor}_action`] = action;
  if (target.health === 0) next.winner = actor;
  next.turn = actor === "player" ? "ai" : "player";
  if (actor === "ai") {
    if (next.round === RULES.maxRounds && !next.winner) next.winner = "draw";
    else if (!next.winner) next.round += 1;
  }
  return { state: next, message };
}
