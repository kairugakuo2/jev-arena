import {
  ACTIONS,
  MOVES,
  previewPosition,
  attackConnects,
  newGame,
  actionProblem,
  decisionState,
  executeAction,
} from "./game.js";
import { chooseRuleAction } from "./rule-ai.js";

const $ = (id) => document.getElementById(id);
let game = newGame();
let mode = "jev";
let selectedMove = "STAY";
let busy = false;
let decision = null;
let pendingState = null;
let actionCount = 0;
let requestController = null;
let generation = 0; // A reset invalidates any older in-flight response.
const labels = { ATTACK: ["⚔", "20 stamina"], DEFEND: ["◇", "+25 stamina"] };
for (const move of MOVES) {
  const button = document.createElement("button");
  button.textContent = {
    STAY: "• Stay",
    LEFT: "← Left",
    RIGHT: "Right →",
    JUMP: "↑ Jump",
  }[move];
  button.dataset.move = move;
  button.className = "movement-button";
  button.addEventListener("click", () => {
    selectedMove = move;
    render();
  });
  $("movements").append(button);
}
for (const combat of ["ATTACK", "DEFEND"]) {
  const button = document.createElement("button");
  button.className = "action-button";
  button.dataset.action = combat;
  button.innerHTML = `<span class="action-icon" aria-hidden="true">${labels[combat][0]}</span><span class="action-name">${combat}</span><span class="action-cost">${labels[combat][1]}</span>`;
  button.addEventListener("click", () =>
    playerTurn(`${selectedMove}_${combat}`),
  );
  $("actions").append(button);
}

function render() {
  for (const actor of ["player", "ai"]) {
    for (const stat of ["health", "stamina"]) {
      $(`${actor}-${stat}`).value = game[actor][stat];
      $(`${actor}-${stat}-text`).textContent = `${game[actor][stat]} / 100`;
    }
    $(`${actor}-position`).textContent =
      `Lane ${game[actor].x + 1} · ${game[actor].y ? "Airborne" : "Grounded"}`;
    const avatar = document.querySelector(`.avatar-${actor}`);
    avatar.dataset.x = game[actor].x;
    avatar.dataset.y = game[actor].y;
    avatar.classList.toggle("guarding", game[actor].defending);
    $(`${actor}-guard`).textContent = game[actor].defending
      ? "◇ Guard active"
      : "Unguarded";
  }
  $("round").textContent = String(game.round).padStart(2, "0");
  $("distance").textContent =
    `${game.distance.toFixed(1)} units · ${Math.abs(game.player.x - game.ai.x) <= 1 ? "Melee range" : "Out of reach"}`;
  $("stage").dataset.distance = "free";
  [...$("distance-pips").children].forEach((pip, index) =>
    pip.classList.toggle("active", index < Math.abs(game.player.x - game.ai.x)),
  );
  $("opponent-name").textContent = mode === "jev" ? "Jev" : "Rule Bot";
  $("opponent-type").textContent = mode === "jev" ? "AI MODEL" : "RULE ENGINE";
  $("jev-mode").setAttribute("aria-pressed", String(mode === "jev"));
  $("rule-mode").setAttribute("aria-pressed", String(mode === "rules"));
  $("jev-mode").disabled = busy;
  $("rule-mode").disabled = busy;
  for (const button of $("actions").children) {
    const problem = actionProblem(
      game,
      "player",
      `${selectedMove}_${button.dataset.action}`,
    );
    button.disabled = Boolean(problem || busy || game.turn !== "player");
    button.title = problem || labels[button.dataset.action][1];
  }
  for (const button of $("movements").children) {
    const move = button.dataset.move;
    const problem = actionProblem(game, "player", `${move}_DEFEND`);
    button.disabled = Boolean(problem || busy || game.turn !== "player");
    button.title =
      problem ||
      (move === "JUMP"
        ? "15 stamina · dodge ground attacks"
        : move === "STAY"
          ? "No movement cost"
          : "5 stamina · one lane");
    button.setAttribute("aria-pressed", String(move === selectedMove));
  }
  $("move-preview").textContent =
    `Selected: ${selectedMove.toLowerCase()} → choose attack or defend to commit.`;
  $("retry").hidden = game.turn !== "ai" || busy || Boolean(game.winner);
  $("retry").textContent =
    mode === "jev" ? "Retry Jev turn ↻" : "Continue with rule-based AI →";
  $("turn-status").textContent = game.winner
    ? game.winner === "draw"
      ? "50 rounds. A draw — start a new battle to compare again."
      : game.winner === "player"
        ? "Victory. You won the battle!"
        : "The gladiator wins. Ready for a rematch?"
    : busy
      ? mode === "jev"
        ? "Jev is evaluating the battle state…"
        : "The rule engine is choosing…"
      : game.turn === "ai"
        ? "AI turn paused. Retry, switch modes, or start a new battle."
        : "Your turn. Choose your next move.";
  $("move-hint").textContent = game.winner
    ? "Start a new battle to try another strategy."
    : attackConnects(previewPosition(game, "player", selectedMove), game.ai)
      ? "Attack will connect. Jump strikes dodge counters; defense punishes ground attacks."
      : "Attack would miss from this position. Reposition and defend to recover.";
}

function renderDecision() {
  $("probabilities").replaceChildren();
  const ordered = [...ACTIONS].sort(
    (a, b) =>
      (decision?.probabilities?.[b] ?? 0) - (decision?.probabilities?.[a] ?? 0),
  );
  for (const action of ordered) {
    const p = decision?.probabilities?.[action];
    const row = document.createElement("div");
    row.className = `prob-row${decision?.action === action ? " selected" : ""}`;
    const label = document.createElement("div");
    label.className = "prob-label";
    const name = document.createElement("span");
    name.textContent = action.replace("_", " + ");
    const value = document.createElement("span");
    value.textContent = p == null ? "—" : `${(p * 100).toFixed(1)}%`;
    label.append(name, value);
    const bar = document.createElement("progress");
    bar.max = 1;
    bar.value = p ?? 0;
    bar.setAttribute(
      "aria-label",
      `${action}: ${p == null ? "not available" : value.textContent}`,
    );
    row.append(label, bar);
    $("probabilities").append(row);
  }
  const source = decision?.source ?? mode;
  $("decision-title").textContent =
    source === "jev" ? "Inside the decision" : "Rules, in plain sight";
  $("decision-note").textContent =
    source === "jev"
      ? "Jev evaluates the state and assigns a probability to each action. Inspect its latest decision below."
      : "A fixed priority list chooses one action. The same state always produces the same choice.";
  $("decision-source").textContent =
    source === "jev" ? "typesafe-ai/jev" : "if / else · deterministic";
  $("decision-round").textContent = decision
    ? `ROUND ${decision.round} · ${source === "jev" ? "JEV" : "RULES"}`
    : "AWAITING TURN";
  $("chosen-action").textContent =
    decision?.action.replace("_", " + ") ?? "Waiting for your move";
  $("decision-timing").textContent = decision
    ? `${Math.round(decision.elapsed)} ms · ${source === "jev" ? "Jev choice" : "Rule match"}`
    : "State → evaluation → action";
  $("probability-explainer").textContent =
    decision?.rule ??
    (decision && !decision.probabilities
      ? "This response omitted probabilities. No distribution has been invented."
      : source === "rules"
        ? "100% marks a rule outcome, not model confidence."
        : "Native choice probabilities, not a chain of thought or your chance of winning. Rounded values may not sum to exactly 100%.");
}

function logAction(actor, message, round, source) {
  $("battle-log").querySelector(".log-empty")?.remove();
  const item = document.createElement("li");
  const badge = document.createElement("span");
  badge.className = "log-round";
  badge.textContent = `ROUND ${String(round).padStart(2, "0")}`;
  const who = document.createElement("span");
  who.className = `log-actor ${actor === "ai" ? "enemy" : ""}`;
  who.textContent =
    actor === "player" ? "YOU" : source === "jev" ? "JEV" : "RULE BOT";
  const text = document.createElement("span");
  text.className = "log-text";
  text.textContent = message;
  item.append(badge, who, text);
  $("battle-log").append(item);
  $("battle-log").scrollTop = $("battle-log").scrollHeight;
  $("log-count").textContent = `${++actionCount} ACTIONS`;
}

function execute(actor, action, source) {
  const round = game.round;
  const result = executeAction(game, actor, action);
  game = result.state;
  logAction(actor, result.message, round, source);
  const avatar = document.querySelector(`.avatar-${actor}`);
  avatar.classList.remove("flash");
  // One frame lets repeated moves restart the small feedback animation.
  requestAnimationFrame(() => avatar.classList.add("flash"));
}

async function playerTurn(action) {
  if (busy || game.turn !== "player" || actionProblem(game, "player", action))
    return;
  execute("player", action);
  render();
  if (!game.winner) {
    pendingState = decisionState(game);
    await aiTurn();
  }
}

async function aiTurn() {
  if (busy || game.winner || game.turn !== "ai" || !pendingState) return;
  const thisGeneration = generation;
  busy = true;
  decision = null;
  $("request-error").hidden = true;
  $("debug-state").textContent = JSON.stringify(pendingState, null, 2);
  $("debug-caption").textContent =
    mode === "jev"
      ? "Exact state submitted to Jev (after your action)."
      : "Exact state passed to the rule engine. No network call.";
  $("debug-question").textContent =
    mode === "jev"
      ? "Request in progress…"
      : "No Jev request in rule-based mode. Read public/rule-ai.js.";
  renderDecision();
  render();
  const started = performance.now();
  const controller = new AbortController();
  requestController = controller;
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    let result;
    if (mode === "rules") result = chooseRuleAction(pendingState);
    else {
      const response = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingState),
        signal: controller.signal,
      });
      result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Jev request failed. Retry this turn.");
    }
    if (generation !== thisGeneration) return;
    if (actionProblem(game, "ai", result.action))
      throw new Error(
        "The decision is not legal in this state. Retry the turn.",
      );
    decision = {
      ...result,
      elapsed: performance.now() - started,
      round: game.round,
    };
    if (result.request) {
      $("debug-state").textContent = JSON.stringify(
        result.request.state,
        null,
        2,
      );
      $("debug-question").textContent = JSON.stringify(
        result.request.questions,
        null,
        2,
      );
    }
    execute("ai", decision.action, decision.source);
    pendingState = null;
    selectedMove = "STAY";
    renderDecision();
  } catch (error) {
    if (generation !== thisGeneration) return;
    $("request-error").textContent =
      error.name === "AbortError"
        ? "The request timed out. Retry the AI turn or switch to Rule-Based AI."
        : error.message;
    $("request-error").hidden = false;
    $("debug-question").textContent =
      "No successful Jev response. The question is defined in jev-ai.js → buildJevRequest().";
    $("chosen-action").textContent = "No action executed";
  } finally {
    clearTimeout(timeout);
    if (generation === thisGeneration) {
      busy = false;
      requestController = null;
      render();
    }
  }
}

function setMode(nextMode) {
  if (busy) return;
  mode = nextMode;
  // Clear old inspection so a rule result cannot be mistaken for a Jev result.
  decision = null;
  $("request-error").hidden = true;
  $("debug-state").textContent = "No decision in this mode yet.";
  $("debug-question").textContent = "No decision in this mode yet.";
  renderDecision();
  render();
}

$("jev-mode").addEventListener("click", () => setMode("jev"));
$("rule-mode").addEventListener("click", () => setMode("rules"));
$("retry").addEventListener("click", aiTurn);
$("reset").addEventListener("click", () => {
  generation += 1;
  requestController?.abort();
  requestController = null;
  game = newGame();
  selectedMove = "STAY";
  busy = false;
  decision = null;
  pendingState = null;
  actionCount = 0;
  $("battle-log").innerHTML =
    '<li class="log-empty">The arena is ready. Your first move starts the battle.</li>';
  $("log-count").textContent = "0 ACTIONS";
  $("request-error").hidden = true;
  $("debug-state").textContent = "No AI turn yet.";
  $("debug-question").textContent = "Available after a successful Jev request.";
  renderDecision();
  render();
});

async function checkConnection() {
  try {
    const response = await fetch("/api/status");
    const status = await response.json();
    $("connection").textContent = status.configured
      ? "● Gateway key configured"
      : "○ Jev needs a key · Rule-Based AI is ready";
  } catch {
    $("connection").textContent = "Server unreachable · start with npm start";
  }
}
render();
renderDecision();
checkConnection();
