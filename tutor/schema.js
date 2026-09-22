import { z } from 'zod';

const text = z.string().min(1).max(4000);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const texts = z.array(text).max(30);
const ids = z.array(id).max(40);
export const graphSchema = z.object({
  title: text,
  concept: z.object({ concepts: texts, constraints: texts, correctness: texts, inputOutput: text }),
  families: z.array(z.object({
    id, name: text, label: z.enum(['brute_force','acceptable','optimal']), description: text,
    time: text, space: text, complexityNotes: text, dataStructures: texts,
    invariantIds: ids, patterns: texts, prerequisites: texts, mistakes: texts,
    terminalRequirements: texts, optimality: text,
  })).min(1).max(20),
  invariants: z.array(z.object({ id, description: text, familyIds: ids })).min(1).max(40),
  nodes: z.array(z.object({ id, description: text, kind: z.enum(['partial','valid','dead_end']), familyIds: ids, observableSignals: texts })).min(1).max(50),
  edges: z.array(z.object({ id, from: ids.min(1), to: id, kind: z.enum(['refinement','optimization','repair','family_switch','regression']), conditions: texts, temporaryBreakage: texts })).max(60),
  failureModes: z.array(z.object({ id, familyIds: ids, layer: z.enum(['algorithm','implementation']), description: text, observableSignals: texts, counterexample: text, repairs: texts })).max(30),
  edgeCases: z.array(z.object({ input: text, expected: text, diagnoses: texts })).min(1).max(20),
  trajectoryIndicators: z.array(z.object({ direction: z.enum(['much_hotter','hotter','neutral_uncertain','colder','much_colder']), layer: z.enum(['algorithm','implementation']), evidence: text, caveats: texts, relatedIds: ids })).min(1).max(40),
  coverage: z.object({ completeness: z.literal('non_exhaustive'), knownGaps: texts, assumptions: texts }),
});
// issues block approval; suggestions are advisory and never trigger a repair.
export const critiqueSchema = z.object({ approved: z.boolean(), issues: texts, suggestions: texts });

export function validateGraph(input) {
  const graph = graphSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(graph)) > 100000) throw Error('Reference graph is too large.');
  const all = [...graph.families, ...graph.invariants, ...graph.nodes, ...graph.edges, ...graph.failureModes];
  const unique = new Set(all.map(item => item.id));
  if (unique.size !== all.length) throw Error('Duplicate graph IDs.');
  const families = new Set(graph.families.map(f => f.id));
  const nodes = new Set(graph.nodes.map(n => n.id));
  const inv = new Map(graph.invariants.map(i => [i.id,i]));
  function references(values, allowed) {
    if (values.some(value => !allowed.has(value))) throw Error('Invalid graph reference.');
  }
  for (const item of [...graph.nodes,...graph.invariants,...graph.failureModes]) references(item.familyIds, families);
  for (const edge of graph.edges) { references(edge.from, nodes); references([edge.to], nodes); }
  for (const indicator of graph.trajectoryIndicators) references(indicator.relatedIds, unique);
  for (const family of graph.families) {
    if (!family.invariantIds.length || family.invariantIds.some(key => !inv.get(key)?.familyIds.includes(family.id))) throw Error('Invalid family invariant reference.');
    if (!graph.nodes.some(node => node.familyIds.includes(family.id))) throw Error('Family has no graph node reference.');
  }
  return graph;
}

export const evaluationSchema = z.object({
  problemId: z.string().regex(/^[a-f0-9]{64}$/), graphVersion: id, sessionId: id,
  language: z.enum(['python','javascript']),
  baselineRevision: z.number().int().nonnegative(), currentRevision: z.number().int().positive(),
  beforeCode: z.string().max(65536), afterCode: z.string().max(65536),
  recentEdits: z.array(z.object({ beforeRevision: z.number().int().nonnegative(), afterRevision: z.number().int().positive(),
    changes: z.array(z.object({ from: z.number().int().nonnegative().max(65536), to: z.number().int().nonnegative().max(65536), insert: z.string().max(65536) })).max(200),
  })).max(5),
});

export function validateEvaluation(input) {
  const body = evaluationSchema.parse(input);
  if (body.currentRevision <= body.baselineRevision) throw Error('Invalid revision order.');
  let previous = body.baselineRevision;
  for (const edit of body.recentEdits) {
    if (edit.beforeRevision < previous || edit.afterRevision <= edit.beforeRevision || edit.afterRevision > body.currentRevision) throw Error('Invalid edit history.');
    if (edit.changes.some(c => c.to < c.from)) throw Error('Invalid change range.');
    previous = edit.afterRevision;
  }
  return body;
}
