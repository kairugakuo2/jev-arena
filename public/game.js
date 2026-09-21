// Fixed-step real-time mechanics. No DOM or network. Both fighters use identical rules.
export const ACTIONS = [
  "IDLE",
  "LEFT",
  "RIGHT",
  "JUMP",
  "ATTACK",
  "DEFEND",
  "LEFT_ATTACK",
  "RIGHT_ATTACK",
  "LEFT_DEFEND",
  "RIGHT_DEFEND",
  "JUMP_ATTACK",
  "JUMP_DEFEND",
];
export const RULES = {
  width: 10,
  speed: 3.4,
  gravity: 18,
  jumpSpeed: 8,
  jumpCost: 12,
  attackCost: 18,
  damage: 16,
  guardedDamage: 4,
  counterDamage: 6,
  counterCost: 8,
  attackCooldown: 0.65,
  reach: 1.25,
  verticalReach: 0.8,
  maxSeconds: 180,
};
export function newGame() {
  const fighter = (x) => ({
    health: 100,
    stamina: 100,
    x,
    y: 0,
    vy: 0,
    vx: 0,
    defending: false,
    cooldown: 0,
    jumpHeld: false,
  });
  return {
    player: fighter(2),
    ai: fighter(8),
    elapsed: 0,
    winner: null,
    previous_player_action: null,
    previous_ai_action: null,
  };
}
export const neutralInput = () => ({
  move: 0,
  jump: false,
  attack: false,
  defend: false,
});
export function actionInput(action) {
  const input = neutralInput();
  if (action.includes("LEFT")) input.move = -1;
  if (action.includes("RIGHT")) input.move = 1;
  input.jump = action.includes("JUMP");
  input.attack = action.includes("ATTACK");
  input.defend = action.includes("DEFEND");
  return input;
}
export function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export function attackConnects(a, b) {
  return (
    Math.abs(a.x - b.x) <= RULES.reach &&
    Math.abs(a.y - b.y) <= RULES.verticalReach
  );
}
export function decisionState(state) {
  const snapshot = (f) =>
    Object.fromEntries(
      ["health", "stamina", "x", "y", "vx", "vy", "defending", "cooldown"].map(
        (k) => [k, typeof f[k] === "number" ? Number(f[k].toFixed(4)) : f[k]],
      ),
    );
  const ai = snapshot(state.ai),
    player = snapshot(state.player);
  return {
    ai,
    player,
    distance: distanceBetween(ai, player),
    elapsed: Number(state.elapsed.toFixed(3)),
    previous_player_action: state.previous_player_action,
    previous_ai_action: state.previous_ai_action,
  };
}
export function legalActions(state, actor) {
  if (state.winner || state[actor].health <= 0) return [];
  const f = state[actor];
  return ACTIONS.filter(
    (a) =>
      !(a.includes("JUMP") && (f.y > 0.01 || f.stamina < RULES.jumpCost)) &&
      !(
        a.includes("ATTACK") &&
        (f.cooldown > 0 ||
          f.stamina <
            RULES.attackCost + (a.includes("JUMP") ? RULES.jumpCost : 0))
      ) &&
      !(a.includes("LEFT") && f.x <= 0.35) &&
      !(a.includes("RIGHT") && f.x >= RULES.width - 0.35),
  );
}
function describeInput(i) {
  if (i.jump)
    return i.attack ? "JUMP_ATTACK" : i.defend ? "JUMP_DEFEND" : "JUMP";
  const move = i.move < 0 ? "LEFT" : i.move > 0 ? "RIGHT" : "";
  return i.attack
    ? move
      ? move + "_ATTACK"
      : "ATTACK"
    : i.defend
      ? move
        ? move + "_DEFEND"
        : "DEFEND"
      : move || "IDLE";
}
// Mutates the supplied world once per fixed step. Returns only discrete combat events.
export function stepGame(state, inputs, dt) {
  if (state.winner) return [];
  dt = Math.max(0, Math.min(dt, 1 / 30));
  state.elapsed += dt;
  const events = [];
  for (const actor of ["player", "ai"]) {
    const f = state[actor],
      i = inputs[actor] || neutralInput();
    f.cooldown = Math.max(0, f.cooldown - dt);
    f.defending = Boolean(i.defend && !i.attack && f.stamina > 0);
    f.stamina = Math.min(
      100,
      Math.max(0, f.stamina + (f.defending ? -8 : 12) * dt),
    );
    if (f.stamina === 0) f.defending = false;
    if (i.jump && !f.jumpHeld && f.y === 0 && f.stamina >= RULES.jumpCost) {
      f.vy = RULES.jumpSpeed;
      f.stamina -= RULES.jumpCost;
      events.push({ actor, text: "Jumped." });
    }
    f.jumpHeld = Boolean(i.jump);
    f.vx = Math.sign(i.move) * (f.defending ? RULES.speed * 0.5 : RULES.speed);
    f.x = Math.min(RULES.width - 0.35, Math.max(0.35, f.x + f.vx * dt));
    f.vy -= RULES.gravity * dt;
    f.y = Math.max(0, f.y + f.vy * dt);
    if (f.y === 0) f.vy = 0;
    state["previous_" + actor + "_action"] = describeInput(i);
  }
  // Deliberately no body collision: fighters can run past/jump over each other.
  // Both attacks resolve from the same post-movement snapshot, so simultaneous KOs can draw.
  const damage = { player: 0, ai: 0 };
  for (const actor of ["player", "ai"]) {
    const targetName = actor === "player" ? "ai" : "player",
      f = state[actor],
      target = state[targetName],
      i = inputs[actor] || neutralInput();
    if (!i.attack || f.cooldown > 0 || f.stamina < RULES.attackCost) continue;
    f.stamina -= RULES.attackCost;
    f.cooldown = RULES.attackCooldown;
    f.defending = false;
    if (!attackConnects(f, target)) {
      events.push({ actor, text: "Attack missed — out of reach." });
      continue;
    }
    const hit = target.defending ? RULES.guardedDamage : RULES.damage;
    damage[targetName] += hit;
    let text = `Attack hit for ${hit}${target.defending ? " (guarded)" : ""}.`;
    if (target.defending && target.stamina >= RULES.counterCost) {
      target.stamina -= RULES.counterCost;
      damage[actor] += RULES.counterDamage;
      text += ` Countered for ${RULES.counterDamage}.`;
    }
    events.push({ actor, text });
  }
  for (const actor of ["player", "ai"])
    state[actor].health = Math.max(0, state[actor].health - damage[actor]);
  if (state.ai.health === 0 && state.player.health === 0) state.winner = "draw";
  else if (state.ai.health === 0) state.winner = "player";
  else if (state.player.health === 0) state.winner = "ai";
  else if (state.elapsed >= RULES.maxSeconds) state.winner = "draw";
  return events;
}
