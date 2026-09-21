// Pure combat rules shared by the browser and server. No randomness or API calls.
export const MOVES = ["STAY", "LEFT", "RIGHT", "JUMP"];
export const ACTIONS = MOVES.flatMap((move) =>
  ["ATTACK", "DEFEND"].map((action) => `${move}_${action}`),
);
export const RULES = {
  maxHealth: 100,
  maxStamina: 100,
  attackCost: 20,
  damage: 24,
  jumpDamage: 16,
  guardedDamage: 6,
  counterDamage: 12,
  counterCost: 10,
  defendRecovery: 25,
  moveCost: 5,
  jumpCost: 15,
  arenaWidth: 7,
  maxRounds: 50,
};
export function splitAction(action) {
  const [move, combat] = String(action).split("_");
  return { move, combat };
}
export function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export function newGame() {
  const fighter = (x) => ({
    health: 100,
    stamina: 100,
    x,
    y: 0,
    defending: false,
  });
  return {
    player: fighter(1),
    ai: fighter(5),
    distance: 4,
    round: 1,
    turn: "player",
    previous_player_action: null,
    previous_ai_action: null,
    winner: null,
  };
}
export function movementCost(move) {
  return move === "JUMP"
    ? RULES.jumpCost
    : move === "STAY"
      ? 0
      : RULES.moveCost;
}
// Land at the start of the next turn. Jump has a one-turn cooldown.
export function previewPosition(state, actor, move) {
  const f = state[actor];
  return {
    x: f.x + (move === "LEFT" ? -1 : move === "RIGHT" ? 1 : 0),
    y: move === "JUMP" ? 1 : 0,
  };
}
export function actionProblem(state, actor, action) {
  if (!ACTIONS.includes(action)) return "Unknown action.";
  if (state.winner) return "The battle has ended.";
  const { move, combat } = splitAction(action),
    f = state[actor],
    target = state[actor === "player" ? "ai" : "player"],
    position = previewPosition(state, actor, move);
  if (position.x < 0 || position.x >= RULES.arenaWidth)
    return "The edge of the arena blocks this move.";
  if (position.x === target.x) return "The opponent occupies that lane.";
  if (move === "JUMP" && f.y === 1)
    return "Land for one turn before jumping again.";
  const cost =
    movementCost(move) + (combat === "ATTACK" ? RULES.attackCost : 0);
  if (f.stamina < cost) return `Requires ${cost} stamina before recovery.`;
  return null;
}
export function legalActions(state, actor) {
  return ACTIONS.filter((a) => !actionProblem(state, actor, a));
}
export function decisionState(state) {
  return {
    ai: { ...state.ai },
    player: { ...state.player },
    distance: distanceBetween(state.ai, state.player),
    previous_player_action: state.previous_player_action,
    previous_ai_action: state.previous_ai_action,
  };
}
export function attackConnects(attacker, target) {
  // Jump attacks reach downward. Ground attacks cannot hit an airborne fighter.
  return (
    Math.abs(attacker.x - target.x) <= 1 && (attacker.y === 1 || target.y === 0)
  );
}
export function executeAction(state, actor, action) {
  if (state.turn !== actor) throw new Error("It is not this fighter's turn.");
  const problem = actionProblem(state, actor, action);
  if (problem) throw new Error(problem);
  const next = structuredClone(state),
    fighter = next[actor],
    opponent = actor === "player" ? "ai" : "player",
    target = next[opponent],
    { move, combat } = splitAction(action);
  Object.assign(fighter, previewPosition(state, actor, move));
  fighter.stamina -= movementCost(move);
  fighter.defending = combat === "DEFEND";
  const name = actor === "player" ? "You" : "Gladiator";
  let message = `${name}: ${move.toLowerCase()} + ${combat.toLowerCase()}. `;
  if (combat === "DEFEND") {
    const recovery = Math.min(RULES.defendRecovery, 100 - fighter.stamina);
    fighter.stamina += recovery;
    message += `Guard up; recovered ${recovery} stamina.`;
  } else {
    fighter.stamina -= RULES.attackCost;
    if (!attackConnects(fighter, target))
      message +=
        target.y > fighter.y && Math.abs(fighter.x - target.x) <= 1
          ? "Miss — the opponent is airborne."
          : "Miss — out of reach.";
    else {
      const damage = target.defending
        ? RULES.guardedDamage
        : fighter.y
          ? RULES.jumpDamage
          : RULES.damage;
      target.health = Math.max(0, target.health - damage);
      message += `${damage} damage${target.defending ? " against a guard" : ""}.`;
      if (
        target.health > 0 &&
        target.defending &&
        fighter.y === 0 &&
        target.stamina >= RULES.counterCost
      ) {
        target.stamina -= RULES.counterCost;
        fighter.health = Math.max(0, fighter.health - RULES.counterDamage);
        message += ` Countered for ${RULES.counterDamage}; defender spends ${RULES.counterCost} stamina.`;
      }
    }
  }
  next.distance = distanceBetween(next.ai, next.player);
  next[`previous_${actor}_action`] = action;
  if (target.health === 0) next.winner = actor;
  else if (fighter.health === 0) next.winner = opponent;
  next.turn = opponent;
  if (actor === "ai") {
    if (next.round === RULES.maxRounds && !next.winner) next.winner = "draw";
    else if (!next.winner) next.round++;
  }
  return { state: next, message };
}
