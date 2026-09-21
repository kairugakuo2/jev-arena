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
        instructions: `Choose exactly one best action for the AI gladiator to win a turn-based duel.
The player has already acted. The AI acts now, then the player acts next.
Health and stamina are capped at ${RULES.maxHealth}. Distance is shared (1 close, 2 medium, 3 far).
ATTACK costs ${RULES.attackCost} stamina and deals ${RULES.damage} damage at distance 1 only.
Against a defending opponent it deals ${RULES.guardedDamage} damage.
DEFEND restores ${RULES.defendRecovery} stamina and guards against the opponent's next turn.
An actor's old guard expires when that actor takes its next action.
APPROACH/RETREAT change distance by one within 1–3 and restore ${RULES.moveRecovery} stamina.
HEAL consumes one potion and restores ${RULES.healing} health, capped at 100.
Choose ONLY a currently legal action: ${legalActions(state, "ai").join(", ")}.
Prefer survival and useful damage; avoid wasting a potion or attacking a guard when another action is better.
Return the typed choice with its probability distribution. Do not generate reasoning or prose.`,
        criteria: {
          ATTACK: "Strike the player at close range, spending stamina.",
          DEFEND: "Reduce incoming damage and recover stamina.",
          APPROACH: "Move closer to get into attack range.",
          RETREAT: "Move farther away to avoid a close-range attack.",
          HEAL: "Consume a potion to recover health.",
        },
      },
    },
  };
}

export function validateDecision(answer, state) {
  if (answer?.type !== "choice" || !ACTIONS.includes(answer.choice)) {
    throw new Error("Jev returned an unknown action. Retry this turn.");
  }
  if (!legalActions(state, "ai").includes(answer.choice)) {
    throw new Error(
      `Jev chose an unavailable action (${answer.choice}). Retry this turn.`,
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
      "Jev returned an invalid probability distribution. Retry this turn.",
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
      abortSignal: AbortSignal.timeout(20000),
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
