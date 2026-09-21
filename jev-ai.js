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
        instructions: `Choose one complete turn for the AI gladiator: movement plus ATTACK or DEFEND.
The player has already acted. State includes x lane 0–6, y elevation 0 grounded or 1 airborne, health, stamina and guard.
At the START of the acting fighter's turn, its old jump ends and guard expires.
STAY stays in the same lane; LEFT/RIGHT move one lane for 5 stamina; JUMP stays in its lane, elevates to y=1 and costs 15.
An airborne fighter cannot JUMP again on its next turn: it must land for a turn. Fighters cannot share a lane.
Movement costs are paid BEFORE the combat action. ATTACK costs 20 more stamina. DEFEND restores 25 stamina, capped at 100.
Attack hits only within one horizontal lane. Ground attacks MISS an airborne target; jump attacks can hit ground or airborne targets.
Ground attacks deal 24 damage; jump attacks deal 16. Guard reduces either to 6.
A living guarded target counters a grounded attacker for ${RULES.counterDamage} damage, spending ${RULES.counterCost} stamina if available. Jump attacks avoid counters.
Jump/guard lasts through the opponent's next turn. Every action ends your turn. Out-of-range attacks waste their stamina.
The goal is to win using positioning, dodging, and stamina; do not blindly trade attacks.
Choose ONLY a legal combined action: ${legalActions(state, "ai").join(", ")}.
Return the typed choice and probabilities. Do not generate reasoning or prose.`,
        criteria: Object.fromEntries(
          ACTIONS.map((action) => [action, action.replace("_", " then ")]),
        ),
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
