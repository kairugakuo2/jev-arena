import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createTutorHandler } from '../tutor/routes.js';
import { evaluationFixture, graphFixture } from './fixtures/tutor.js';

async function call(handler, method, path, data, headers = { 'content-type': 'application/json' }) {
  const request = Readable.from([Buffer.from(typeof data === 'string' ? data : JSON.stringify(data ?? {}))]);
  Object.assign(request, { method, headers });
  const response = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  const handled = await handler(request, response, path);
  return { handled, status: response.status, body: response.body };
}
const record = { graphVersion: 'v1', graph: graphFixture() };

test('tutor endpoint returns native probabilities and revision metadata without solution graph or code', async () => {
  const handler = createTutorHandler({ store: { get: async () => record }, evaluate: async () => ({ hotter: .81, colder: .19 }) });
  const response = await call(handler, 'POST', '/api/tutor/evaluate', evaluationFixture());
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.probabilities, { hotter: .81, colder: .19 });
  assert.equal(response.body.currentRevision, 1);
  assert.equal(response.body.graph, undefined); assert.equal(response.body.beforeCode, undefined);
});

test('tutor validates content, payload bounds and graph version before any model call', async () => {
  let calls = 0;
  const handler = createTutorHandler({ store: { get: async () => record }, evaluate: async () => { calls++; } });
  assert.equal((await call(handler,'POST','/api/tutor/evaluate','{')).status,400);
  assert.equal((await call(handler,'POST','/api/tutor/evaluate',{}, {})).status,415);
  assert.equal((await call(handler,'POST','/api/tutor/evaluate','x'.repeat(524289))).status,413);
  assert.equal((await call(handler,'POST','/api/tutor/evaluate',{ ...evaluationFixture(), graphVersion: 'other' })).status,409);
  assert.equal(calls,0);
});

test('overlapping requests in a session are rejected without blocking another session', async () => {
  const pending = [];
  const handler = createTutorHandler({ store: { get: async () => record }, evaluate: () => new Promise(resolve => pending.push(resolve)) });
  const first = call(handler,'POST','/api/tutor/evaluate',evaluationFixture());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await call(handler,'POST','/api/tutor/evaluate',evaluationFixture())).status,429);
  const other = call(handler,'POST','/api/tutor/evaluate',{ ...evaluationFixture(), sessionId: 'session-other' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length,2);
  pending.forEach(resolve => resolve({ hotter:.5,colder:.5 }));
  assert.equal((await first).status,200); assert.equal((await other).status,200);
});

test('provider errors are sanitized and missing probabilities are explicitly unavailable', async () => {
  const handler = createTutorHandler({ store: { get: async () => record }, evaluate: async () => { throw Error('secret-token provider body'); } });
  const response = await call(handler,'POST','/api/tutor/evaluate',evaluationFixture());
  assert.equal(response.status,502); assert.doesNotMatch(JSON.stringify(response.body),/secret-token/);
  const missing = createTutorHandler({ store: { get: async () => record }, evaluate: async () => null });
  const r = await call(missing,'POST','/api/tutor/evaluate',evaluationFixture());
  assert.equal(r.body.probabilities,null); assert.equal(r.body.available,false);
});
