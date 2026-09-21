// SERVER ONLY. Never import this module into the browser.
import { experimental_evaluate as evaluate } from "ai";
import { ACTIONS, RULES, legalActions } from "./public/game.js";

export function buildJevRequest(state) {
  return {
    model: "typesafe-ai/jev",
    state,
    questions: {
      action: {
        type: "choice",
        instructions: `Control the AI fighter in a continuous real-time 2D duel. There are NO turns.
The supplied state is a snapshot; the player keeps moving while you decide. Choose a short control intent lasting at most 0.7 seconds.
Coordinates: x within 0.35–9.65, y is height above floor, vx/vy are velocities in units/second. Fighters can pass through each other.
LEFT/RIGHT run at ${RULES.speed} units/second. Movement is free. JUMP launches upward only when grounded, costs ${RULES.jumpCost} stamina; gravity lands automatically.
ATTACK swings immediately if off cooldown, and can repeat every ${RULES.attackCooldown}s while held, costing ${RULES.attackCost} stamina.
Hit requires horizontal separation <= ${RULES.reach} and vertical separation <= ${RULES.verticalReach}; otherwise it misses.
Every hit deals ${RULES.damage}; a guarding target takes ${RULES.guardedDamage} and counters for ${RULES.counterDamage} if it can spend ${RULES.counterCost} stamina.
DEFEND holds guard, halves running speed, drains 8 stamina/second. Releasing guard regenerates 12 stamina/second. Resources cap at 100.
Combined actions apply movement/jump and attack/defend together. IDLE releases all controls to recover stamina.
Anticipate motion from velocities. Close distance before attacking; retreat to recover; jump to evade.
Currently available actions: ${legalActions(state, "ai").join(", ")}.
Choose one of them. Return typed choice and native probabilities only, no reasoning or prose.`,
        criteria: Object.fromEntries(
          ACTIONS.map((action) => [action, action.replace("_", " then ")]),
        ),
      },
    },
  };
}

export function validateDecision(answer, state) {
  if (answer?.type !== "choice" || !ACTIONS.includes(answer.choice)) {
    throw new Error(
      "Jev returned an unknown action. A fresh snapshot will be tried.",
    );
  }
  if (!legalActions(state, "ai").includes(answer.choice)) {
    throw new Error(
      `Jev chose an unavailable action (${answer.choice}). A fresh snapshot will be tried.`,
    );
  }
  // Missing probabilities are not zero probabilities: never invent a distribution.
  if (answer.probabilities == null)
    return { action: answer.choice, probabilities: null };
  const probabilities = Object.fromEntries(
    ACTIONS.map((action) => [action, answer.probabilities[action]]),
  );
  const values = Object.values(probabilities);
  const sum = values.reduce((total, n) => total + n, 0);
  if (
    values.some(
      (n) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1,
    ) ||
    Math.abs(sum - 1) > 0.02
  ) {
    throw new Error(
      "Jev returned an invalid probability distribution. A fresh snapshot will be tried.",
    );
  }
  return { action: answer.choice, probabilities };
}

export async function chooseJevAction(state) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      "Add AI_GATEWAY_API_KEY to .env and restart the server, or select Rule-Based AI.",
    );
  }
  const request = buildJevRequest(state);
  let result;
  try {
    // THE JEV CALL: the SDK reads AI_GATEWAY_API_KEY on the server automatically.
    result = await evaluate({
      ...request,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(2000),
    });
  } catch (error) {
    // Never send raw provider errors, headers, or credentials to the browser.
    if (
      error?.statusCode === 403 &&
      /credit card|customer_verification_required/i.test(String(error.message))
    ) {
      throw new Error(
        "Vercel requires a payment card on this team before AI Gateway can serve Jev. Add it in your Vercel AI Gateway dashboard, then retry; Rule-Based AI works now.",
      );
    }
    if (error?.statusCode === 401 || error?.statusCode === 403) {
      throw new Error(
        "AI Gateway rejected the credentials. Check your server-side key and model access.",
      );
    }
    if (error?.statusCode === 429)
      throw new Error(
        "AI Gateway is rate limited or out of credits. Check your account, then retry.",
      );
    throw new Error(
      "Jev could not respond within the request. Check connectivity and Gateway access, then retry.",
    );
  }
  return { ...validateDecision(result.answers?.action, state), source: "jev" };
}
