import { generateText, Output, experimental_evaluate as evaluate } from 'ai';
import { graphSchema, critiqueSchema } from './schema.js';
import { MAPMAKER_PROMPT, CRITIC_PROMPT, NAVIGATOR_PROMPT } from './prompts.js';
import { validProbabilities } from '../public/tutor/scheduler.js';

export const MAP_MODEL = process.env.TUTOR_MAP_MODEL || 'openai/gpt-5-mini';

function requireKey() {
  if (!process.env.AI_GATEWAY_API_KEY) throw Error('Add AI_GATEWAY_API_KEY to .env and restart the server.');
}

export async function generateGraph({ statement, referenceMaterial, previous, issues = [] }) {
  requireKey();
  const { output } = await generateText({ model: MAP_MODEL, system: MAPMAKER_PROMPT,
    prompt: JSON.stringify({ problem: statement, ...(referenceMaterial ? { referenceMaterial } : {}), ...(previous ? { previousGraph: previous } : {}), repairIssues: issues }),
    output: Output.object({ schema: graphSchema }), maxOutputTokens: 16000, maxRetries: 0,
    abortSignal: AbortSignal.timeout(180000),
  });
  return output;
}

export async function critiqueGraph({ statement, referenceMaterial, graph }) {
  requireKey();
  const { output } = await generateText({ model: MAP_MODEL, system: CRITIC_PROMPT,
    prompt: JSON.stringify({ problem: statement, ...(referenceMaterial ? { referenceMaterial } : {}), graph }), output: Output.object({ schema: critiqueSchema }),
    maxOutputTokens: 4000, maxRetries: 0, abortSignal: AbortSignal.timeout(120000),
  });
  return output;
}

export function buildNavigatorRequest(graph, input) {
  return { model: 'typesafe-ai/jev', state: { solutionGraph: graph, ...input }, questions: {
    direction: { type: 'choice', instructions: NAVIGATOR_PROMPT,
      criteria: { hotter: 'Evidence of algorithmic progress relative to the baseline.', colder: 'Evidence of algorithmic regression relative to the baseline.' } },
  } };
}

export function validateProbabilities(answer) {
  if (answer?.type !== 'choice' || !['hotter','colder'].includes(answer.choice)) throw Error('Invalid direction response.');
  if (answer.probabilities == null) return null;
  const p = { hotter: answer.probabilities.hotter, colder: answer.probabilities.colder };
  if (!validProbabilities(p)) throw Error('Invalid direction probabilities.');
  return p;
}

export async function evaluateCode(graph, input) {
  requireKey();
  const result = await evaluate({ ...buildNavigatorRequest(graph, input), maxRetries: 0, abortSignal: AbortSignal.timeout(2300) });
  return validateProbabilities(result.answers?.direction);
}
