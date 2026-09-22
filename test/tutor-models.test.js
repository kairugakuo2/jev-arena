import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateGraph, validateEvaluation } from '../tutor/schema.js';
import { GraphStore } from '../tutor/graphs.js';
import { buildNavigatorRequest, validateProbabilities } from '../tutor/models.js';
import { experimental_evaluate as evaluate } from 'ai';
import { Experimental_EvaluationMockModelV4 } from 'ai/test';
import { graphFixture, evaluationFixture, statement } from './fixtures/tutor.js';

test('graph validation rejects broken references, duplicate IDs and disconnected family invariants', () => {
  assert.equal(validateGraph(graphFixture()).families.length, 2);
  const missing = graphFixture(); missing.edges[0].to = 'missing'; assert.throws(() => validateGraph(missing), /reference/i);
  const dup = graphFixture(); dup.nodes[1].id = 'enumerate'; assert.throws(() => validateGraph(dup), /duplicate/i);
  const invalid = graphFixture(); invalid.families[0].invariantIds = ['prior']; assert.throws(() => validateGraph(invalid), /invariant/i);
});

test('edit validation preserves indentation but rejects oversized, unordered and impossible revisions', () => {
  const body = evaluationFixture();
  assert.equal(validateEvaluation(body).afterCode, body.afterCode);
  assert.throws(() => validateEvaluation({ ...body, currentRevision: 0 }));
  assert.throws(() => validateEvaluation({ ...body, afterCode: 'x'.repeat(65537) }));
  assert.throws(() => validateEvaluation({ ...body, recentEdits: [{ beforeRevision: 8, afterRevision: 9, changes: [] }] }));
  assert.throws(() => validateEvaluation({ ...body, language: 'shell' }));
  assert.throws(() => validateEvaluation({ ...body, afterCode: '😀'.repeat(16_385) }));
});

test('schema rejects oversized edit history while compacted evaluation fits transport limit', () => {
  const code = '\n'.repeat(65_536);
  const compact = {
    ...evaluationFixture(),
    beforeCode: code,
    afterCode: code,
    recentEdits: [{
      beforeRevision: 0,
      afterRevision: 1,
      changes: [{ from: 0, to: 65_536, insert: code }],
    }],
  };
  const oversizedHistory = {
    ...compact,
    currentRevision: 5,
    recentEdits: Array.from({ length: 5 }, (_, index) => ({
      beforeRevision: index,
      afterRevision: index + 1,
      changes: [{ from: 0, to: 65_536, insert: code }],
    })),
  };
  assert.throws(() => validateEvaluation(oversizedHistory));
  assert.doesNotThrow(() => validateEvaluation(compact));
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < 512 * 1024);
});

test('independent review repairs once, rechecks, caches, and keeps reference context private', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'jev-graph-test-'));
  let generations = 0, reviews = 0;
  const store = new GraphStore({ cacheDir,
    generate: async ({ issues }) => { generations++; if (generations === 2) assert.ok(issues.length); return graphFixture(); },
    critique: async () => (++reviews === 1 ? { approved: false, issues: ['Check duplicate inputs'], suggestions: [] } : { approved: true, issues: [], suggestions: ['Tighten wording'] }),
  });
  const [a,b] = await Promise.all([store.prepare(statement), store.prepare(statement)]);
  assert.equal(a.problemId, b.problemId);
  assert.equal(generations, 2); assert.equal(reviews, 2);
  assert.equal(a.graph, undefined); assert.equal(a.families, undefined);
  assert.equal((await store.get(a.problemId)).graph.families.length, 2);
  const stored = JSON.parse(await readFile(join(cacheDir, `${a.problemId}.json`), 'utf8'));
  assert.equal(stored.review.approved, true);
  const restarted = new GraphStore({ cacheDir, generate: () => { throw Error('should use cache'); } });
  assert.equal((await restarted.prepare(statement)).problemId, a.problemId);
});

test('imported references enrich graph preparation, affect identity, and remain out of metadata', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'jev-reference-test-'));
  const calls = [];
  const store = new GraphStore({ cacheDir,
    generate: async input => { calls.push(['generate', input]); return graphFixture(); },
    critique: async input => { calls.push(['critique', input]); return { approved: true, issues: [], suggestions: [] }; },
  });
  const source = { kind: 'neetcode', slug: 'two-integer-sum', url: 'https://neetcode.io/problems/two-integer-sum', fetchedAt: '2026-09-22T00:00:00.000Z', stale: false };
  const referenceMaterial = 'PRIVATE REFERENCE SOLUTION';
  const customId = store.idFor(statement);
  const importedId = store.idFor(statement, { referenceMaterial });
  assert.notEqual(importedId, customId);
  const metadata = await store.prepare(statement, () => {}, { referenceMaterial, source });
  assert.equal(metadata.problemId, importedId);
  assert.equal(calls[0][1].referenceMaterial, referenceMaterial);
  assert.equal(calls[1][1].referenceMaterial, referenceMaterial);
  assert.deepEqual(metadata.source, source);
  assert.equal(metadata.referenceMaterial, undefined);
  assert.doesNotMatch(JSON.stringify(metadata), /PRIVATE REFERENCE/);
});

test('rejected repaired graphs never become active or reach the disk cache', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'jev-rejected-test-'));
  let count = 0;
  const store = new GraphStore({ cacheDir, generate: async () => { count++; return graphFixture(); }, critique: async () => ({ approved: false, issues: ['Incorrect invariant'], suggestions: [] }) });
  await assert.rejects(store.prepare(statement), /review/i);
  assert.equal(count, 2);
});

test('Jev uses a native binary choice and missing probabilities remain unavailable', async () => {
  const request = buildNavigatorRequest(graphFixture(), evaluationFixture());
  assert.deepEqual(Object.keys(request.questions.direction.criteria), ['hotter','colder']);
  const result = await evaluate({ ...request, model: new Experimental_EvaluationMockModelV4({ doEvaluate: async () => ({ answers: { direction: { type: 'choice', choice: 'hotter', probabilities: { hotter: .78, colder: .22 } } }, warnings: [] }) }) });
  assert.deepEqual(validateProbabilities(result.answers.direction), { hotter: .78, colder: .22 });
  assert.equal(validateProbabilities({ type: 'choice', choice: 'hotter' }), null);
  assert.throws(() => validateProbabilities({ type: 'choice', choice: 'hotter', probabilities: { hotter: 1, colder: 1 } }));
});
