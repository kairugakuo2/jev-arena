import {
  ACTIONS,
  RULES,
  newGame,
  neutralInput,
  actionInput,
  decisionState,
  stepGame,
  distanceBetween,
  attackConnects,
} from "./game.js";
import { chooseRuleAction } from "./rule-ai.js";
const $ = (id) => document.getElementById(id);
let game = newGame(),
  mode = "jev",
  running = false,
  epoch = 0,
  decision = null;
let held = new Set(),
  aiInput = neutralInput(),
  aiExpires = 0,
  nextDecision = 0,
  inFlight = null,
  failures = 0;
let count = 0,
  lastFrame = performance.now(),
  accumulator = 0,
  lastUi = 0;
// No game state is ever replaced by an API response: only a short-lived control intent.
const STEP = 1 / 60,
  REQUEST_INTERVAL = 500,
  MAX_RESPONSE_AGE = 1200,
  INTENT_LIFETIME = 700;
const keyMap = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "jump",
  KeyW: "jump",
  Space: "jump",
  KeyJ: "attack",
  KeyK: "defend",
  ShiftLeft: "defend",
  ShiftRight: "defend",
};
const bindings = new Map();
function currentInput() {
  const has = (name) => [...held].some((key) => bindings.get(key) === name);
  return {
    move: Number(has("right")) - Number(has("left")),
    jump: has("jump"),
    attack: has("attack"),
    defend: has("defend"),
  };
}
function log(actor, text) {
  $("battle-log").querySelector(".log-empty")?.remove();
  const row = document.createElement("li"),
    time = document.createElement("span"),
    who = document.createElement("span"),
    body = document.createElement("span");
  time.className = "log-round";
  time.textContent = game.elapsed.toFixed(1) + "s";
  who.className = "log-actor " + (actor === "ai" ? "enemy" : "");
  who.textContent =
    actor === "player" ? "You" : mode === "jev" ? "Jev" : "Rule bot";
  body.className = "log-text";
  body.textContent = text;
  row.append(time, who, body);
  $("battle-log").append(row);
  while ($("battle-log").children.length > 80)
    $("battle-log").firstChild.remove();
  $("battle-log").scrollTop = $("battle-log").scrollHeight;
  $("log-count").textContent = `${++count} ${count === 1 ? "event" : "events"}`;
}
function cancelDecision() {
  epoch++;
  inFlight?.abort();
  inFlight = null;
  aiInput = neutralInput();
  aiExpires = 0;
}
function pause() {
  running = false;
  held.clear();
  cancelDecision();
  game.player.defending = false;
  game.ai.defending = false;
  render();
}
function start() {
  if (game.winner) return;
  running = true;
  accumulator = 0;
  lastFrame = performance.now();
  nextDecision = lastFrame;
  render();
}
document.addEventListener("keydown", (event) => {
  if (event.target.closest("input,textarea,select,[contenteditable=true]"))
    return;
  if (event.code === "Escape") {
    event.preventDefault();
    pause();
    return;
  }
  if (event.code === "KeyP" && !event.repeat) {
    running ? pause() : start();
    return;
  }
  if (!keyMap[event.code]) return;
  // Preserve normal Space activation when a UI button has keyboard focus.
  if (event.code === "Space" && event.target.closest("button,summary,a"))
    return;
  event.preventDefault();
  if (running) {
    bindings.set(event.code, keyMap[event.code]);
    held.add(event.code);
  }
});
document.addEventListener("keyup", (event) => held.delete(event.code));
window.addEventListener("blur", pause);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
for (const [control, label, container] of [
  ["left", "Left (A)", "movements"],
  ["right", "Right (D)", "movements"],
  ["jump", "Jump (Space)", "movements"],
  ["attack", "Attack (J)", "actions"],
  ["defend", "Guard (K)", "actions"],
]) {
  const button = document.createElement("button");
  button.textContent = label;
  button.dataset.control = control;
  button.className = "movement-button";
  const token = "pointer-" + control;
  bindings.set(token, control);
  button.addEventListener("pointerdown", (e) => {
    if (!running) return;
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    held.add(token);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    button.addEventListener(name, () => held.delete(token));
  // Keyboard access for the on-screen buttons: Enter/Space holds their control.
  button.addEventListener("keydown", (e) => {
    if ((e.code === "Enter" || e.code === "Space") && running) {
      e.preventDefault();
      held.add(token);
    }
  });
  button.addEventListener("keyup", () => held.delete(token));
  button.addEventListener("blur", () => held.delete(token));
  $(container).append(button);
}
function renderActors() {
  for (const actor of ["player", "ai"]) {
    const f = game[actor],
      avatar = document.querySelector(".avatar-" + actor);
    avatar.style.left = `${8 + (f.x / RULES.width) * 84}%`;
    avatar.style.bottom = `${45 + f.y * 62}px`;
    avatar.classList.toggle("guarding", f.defending);
    avatar.classList.toggle(
      "striking",
      f.cooldown > RULES.attackCooldown - 0.15,
    );
  }
}
function render() {
  for (const actor of ["player", "ai"]) {
    const f = game[actor];
    for (const stat of ["health", "stamina"]) {
      $(actor + "-" + stat).value = f[stat];
      $(actor + "-" + stat + "-text").textContent =
        `${Math.round(f[stat])} / 100`;
    }
    $(actor + "-position").textContent =
      `x ${f.x.toFixed(1)} · ${f.y > 0.05 ? "Airborne" : "Grounded"}`;
    $(actor + "-guard").textContent = f.defending
      ? "Guarding"
      : `Attack ${f.cooldown > 0 ? f.cooldown.toFixed(1) + "s" : "ready"}`;
  }
  $("round").textContent = game.elapsed.toFixed(1) + "s";
  $("distance").textContent =
    `${distanceBetween(game.ai, game.player).toFixed(1)} units · ${attackConnects(game.player, game.ai) ? "In reach" : "Out of reach"}`;
  $("stage").dataset.distance = "realtime";
  $("opponent-name").textContent = mode === "jev" ? "Jev" : "Rule bot";
  $("opponent-type").textContent = mode === "jev" ? "AI model" : "Rule engine";
  $("jev-mode").setAttribute("aria-pressed", String(mode === "jev"));
  $("rule-mode").setAttribute("aria-pressed", String(mode === "rules"));
  $("play").textContent = running ? "Pause" : "Play";
  $("play").disabled = Boolean(game.winner);
  for (const button of document.querySelectorAll("[data-control]"))
    button.disabled = !running || Boolean(game.winner);
  $("turn-status").textContent = game.winner
    ? game.winner === "draw"
      ? "Draw. Start a new battle."
      : game.winner === "player"
        ? "Victory! You won."
        : "The gladiator wins. Try again."
    : !running
      ? "Paused · Press Play. A/D move · Space jump · J attack · K defend"
      : inFlight
        ? "Live combat · Jev is evaluating; keep moving."
        : "Live combat · Move and fight whenever you want.";
  $("move-preview").textContent =
    "Hold A/D or the arrow keys to run. Space jumps. Hold J to attack, K or Shift to guard.";
  $("move-hint").textContent =
    "No turns. Attacks have a 0.65s cooldown. Release guard to regenerate stamina. P / Esc pauses.";
  $("retry").hidden = !failures || !running;
  renderActors();
}
// "LEFT_ATTACK" → "Left + attack"
function moveName(action) {
  const words = action.toLowerCase().split("_").join(" + ");
  return words[0].toUpperCase() + words.slice(1);
}
function renderDecision() {
  $("probabilities").replaceChildren();
  for (const action of [...ACTIONS].sort(
    (a, b) =>
      (decision?.probabilities?.[b] ?? 0) - (decision?.probabilities?.[a] ?? 0),
  )) {
    const p = decision?.probabilities?.[action],
      row = document.createElement("div"),
      label = document.createElement("div"),
      name = document.createElement("span"),
      value = document.createElement("span"),
      bar = document.createElement("progress");
    row.className =
      "prob-row" + (decision?.action === action ? " selected" : "");
    label.className = "prob-label";
    name.textContent = moveName(action);
    value.textContent = p == null ? "—" : (p * 100).toFixed(1) + "%";
    bar.max = 1;
    bar.value = p ?? 0;
    bar.setAttribute("aria-label", name.textContent + " " + value.textContent);
    label.append(name, value);
    row.append(label, bar);
    $("probabilities").append(row);
  }
  $("decision-title").textContent =
    mode === "jev" ? "Live decision stream" : "Live rule engine";
  $("decision-note").textContent =
    "The arena runs continuously. Each decision controls the AI briefly; the next snapshot reflects your latest position.";
  $("decision-source").textContent =
    mode === "jev" ? "typesafe-ai/jev" : "if / else · deterministic";
  $("decision-round").textContent = decision
    ? `Snapshot at ${decision.time.toFixed(1)}s`
    : "Waiting for Play";
  $("chosen-action").textContent =
    (decision ? moveName(decision.action) : "Waiting for Play");
  $("decision-timing").textContent = decision
    ? `${Math.round(decision.latency)} ms · ${decision.applied ? "intent applied" : "stale — ignored"}`
    : "At most 2 requests/sec · one in flight";
  $("probability-explainer").textContent =
    decision?.rule ??
    (mode === "rules"
      ? "100% means a rule match, not model confidence."
      : "Native choice probabilities, not reasoning or victory odds. Missing distributions are shown as —.");
}
async function decide(now) {
  if (!running || game.winner || inFlight || now < nextDecision) return;
  const snapshot = decisionState(game),
    version = epoch,
    started = performance.now(),
    controller = new AbortController();
  inFlight = controller;
  nextDecision = now + (mode === "rules" ? 200 : REQUEST_INTERVAL);
  const timeout = setTimeout(() => controller.abort(), 2500);
  $("debug-state").textContent = JSON.stringify(snapshot, null, 2);
  $("debug-caption").textContent =
    "Exact snapshot at request start. The arena continues moving while this is evaluated.";
  try {
    let result;
    if (mode === "rules") result = chooseRuleAction(snapshot);
    else {
      const response = await fetch("/api/arena/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
        signal: controller.signal,
      });
      result = await response.json();
      if (!response.ok) throw new Error(result.error || "Jev is unavailable.");
    }
    if (epoch !== version || !running || game.winner) return;
    const latency = performance.now() - started,
      applied = latency <= MAX_RESPONSE_AGE;
    if (!ACTIONS.includes(result.action))
      throw new Error("Unknown AI control; response ignored.");
    decision = { ...result, time: snapshot.elapsed, latency, applied };
    if (applied) {
      aiInput = actionInput(result.action);
      aiExpires = performance.now() + INTENT_LIFETIME;
    } else {
      aiInput = neutralInput();
      aiExpires = 0;
    }
    $("debug-question").textContent = result.request
      ? JSON.stringify(result.request.questions, null, 2)
      : "Rule-based control: no Jev request.";
    failures = 0;
    $("request-error").hidden = true;
    renderDecision();
  } catch (error) {
    if (epoch !== version || !running) return;
    aiInput = neutralInput();
    aiExpires = 0;
    failures++;
    nextDecision =
      performance.now() + Math.min(10000, 1000 * 2 ** Math.min(failures, 3));
    $("request-error").textContent =
      (error.name === "AbortError" ? "Jev timed out." : error.message) +
      " Movement stays live. Retrying with a fresh snapshot; you can switch to Rule-Based AI.";
    $("request-error").hidden = false;
  } finally {
    clearTimeout(timeout);
    if (inFlight === controller) inFlight = null;
  }
}
function frame(now) {
  const delta = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  if (running && !game.winner) {
    accumulator += delta;
    while (accumulator >= STEP && !game.winner) {
      const enemy = now < aiExpires ? aiInput : neutralInput();
      for (const event of stepGame(
        game,
        { player: currentInput(), ai: enemy },
        STEP,
      ))
        log(event.actor, event.text);
      accumulator -= STEP;
    }
    renderActors();
    if (game.winner) {
      running = false;
      held.clear();
      cancelDecision();
      render();
    } else void decide(now);
  }
  if (now - lastUi > 100) {
    render();
    lastUi = now;
  }
  requestAnimationFrame(frame);
}
function setMode(next) {
  cancelDecision();
  mode = next;
  decision = null;
  failures = 0;
  nextDecision = performance.now();
  $("request-error").hidden = true;
  $("debug-state").textContent = "Awaiting a fresh snapshot.";
  $("debug-question").textContent = "No request in this mode yet.";
  renderDecision();
  render();
}
$("play").addEventListener("click", () => {
  running ? pause() : start();
  $("play").blur();
});
$("jev-mode").addEventListener("click", () => setMode("jev"));
$("rule-mode").addEventListener("click", () => setMode("rules"));
$("retry").textContent = "Retry with current state";
$("retry").addEventListener("click", () => {
  nextDecision = 0;
  failures = 0;
});
$("reset").addEventListener("click", () => {
  pause();
  game = newGame();
  decision = null;
  failures = 0;
  count = 0;
  accumulator = 0;
  $("battle-log").innerHTML =
    '<li class="log-empty">Press Play to enter the arena.</li>';
  $("log-count").textContent = "0 events";
  $("request-error").hidden = true;
  $("debug-state").textContent = "No decision yet.";
  $("debug-question").textContent = "No request yet.";
  renderDecision();
  render();
});
fetch("/api/status")
  .then((r) => r.json())
  .then((s) => {
    $("connection").textContent = s.configured
      ? "Gateway connected"
      : "No Gateway key (rules work offline)";
    $("connection").classList.toggle("connected", s.configured);
  })
  .catch(() => {
    $("connection").textContent = "Server unreachable";
    $("connection").classList.add("offline");
  });
renderDecision();
render();
requestAnimationFrame(frame);
