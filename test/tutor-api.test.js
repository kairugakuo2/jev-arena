import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createTutorHandler } from '../tutor/routes.js';
import { NEETCODE_CATALOG_VERSION } from '../tutor/neetcode-catalog.js';
import { evaluationFixture, graphFixture, statement } from './fixtures/tutor.js';

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

test('catalog returns safe metadata only', async () => {
  const catalog = [{ slug:'two-integer-sum', title:'Two Integer Sum', pattern:'Arrays & Hashing', difficulty:'Easy', order:1,
    questionUrl:'https://neetcode.io/problems/two-integer-sum', code:'0001-two-sum', python:true, javascript:true }];
  const handler = createTutorHandler({ catalog, store: {} });
  const response = await call(handler, 'GET', '/api/tutor/catalog');
  assert.equal(response.status, 200);
  assert.equal(response.body.source, 'neetcode');
  assert.equal(response.body.version, NEETCODE_CATALOG_VERSION);
  assert.deepEqual(response.body.problems, catalog);
  assert.equal(response.body.referenceMaterial, undefined);
});

test('NeetCode preparation imports privately, reports stages, and returns sanitized source metadata', async () => {
  const safeSource = { kind:'neetcode', slug:'two-integer-sum', url:'https://neetcode.io/problems/two-integer-sum', fetchedAt:'2026-09-22T00:00:00.000Z', stale:false,
    starterCode:{ python:'class Solution:\n    def twoSum(self, nums, target):\n        ', javascript:'class Solution { twoSum(nums, target) {} }' },
    display:[{ type:'p', runs:[{ text:'Visible ' }, { text:'statement', code:true }] }] };
  const finalId = 'b'.repeat(64);
  const stages = [];
  const store = {
    idFor: (_statement, options) => { assert.match(options.referenceMaterial, /PRIVATE/); return finalId; },
    get: async () => { throw Error('missing'); },
    prepare: async (_statement, onProgress, options) => {
      assert.match(options.referenceMaterial, /PRIVATE/);
      assert.deepEqual(options.source, safeSource);
      onProgress('generating'); onProgress('reviewing');
      return { problemId:finalId, graphVersion:'v1', title:'Two Sum', statement:'Visible statement', source:safeSource };
    },
  };
  const importer = { import: async slug => {
    assert.equal(slug, 'two-integer-sum');
    return { statement:'Visible statement', referenceMaterial:'PRIVATE HIDDEN SOLUTION', coverage:{ python:true }, contentHash:'c'.repeat(64), ...safeSource };
  } };
  const handler = createTutorHandler({ store, importer, catalog: [{ slug:'two-integer-sum' }] });
  const started = await call(handler, 'POST', '/api/tutor/problems', { source:'neetcode', slug:'two-integer-sum' });
  assert.equal(started.status, 202);
  assert.equal(started.body.status, 'importing');
  await new Promise(resolve => setImmediate(resolve));
  const ready = await call(handler, 'GET', `/api/tutor/problems/${started.body.problemId}`);
  stages.push(ready.body.status);
  assert.equal(ready.body.status, 'ready');
  assert.equal(ready.body.problemId, finalId);
  assert.deepEqual(ready.body.source, safeSource);
  assert.match(ready.body.source.starterCode.python, /def twoSum/);
  assert.equal(ready.body.source.display[0].runs[1].text, 'statement');
  assert.equal(ready.body.graph, undefined);
  assert.equal(ready.body.referenceMaterial, undefined);
  assert.doesNotMatch(JSON.stringify(ready.body), /PRIVATE/);
});

test('custom preparation remains compatible and imported failures are attributed without leaking causes', async () => {
  const customId = 'c'.repeat(64);
  const store = {
    idFor: () => customId,
    get: async () => { throw Error('missing'); },
    prepare: async () => ({ problemId:customId, graphVersion:'v1', title:'Custom', statement }),
  };
  const custom = createTutorHandler({ store, importer: { import: async () => { throw Error('secret upstream body'); } }, catalog: [{ slug:'two-integer-sum', questionUrl:'https://neetcode.io/problems/two-integer-sum' }] });
  const customResponse = await call(custom, 'POST', '/api/tutor/problems', { statement });
  assert.equal(customResponse.status, 202);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await call(custom, 'GET', `/api/tutor/problems/${customId}`)).body.status, 'ready');

  const failed = await call(custom, 'POST', '/api/tutor/problems', { source:'neetcode', slug:'two-integer-sum' });
  await new Promise(resolve => setImmediate(resolve));
  const failure = await call(custom, 'GET', `/api/tutor/problems/${failed.body.problemId}`);
  assert.equal(failure.body.status, 'failed');
  assert.equal(failure.body.source.url, 'https://neetcode.io/problems/two-integer-sum');
  assert.doesNotMatch(JSON.stringify(failure.body), /secret upstream/);
});

test('question preview is available before references/maps and survives a sanitized feedback failure', async () => {
  let finishImport;
  const imported = new Promise(resolve => { finishImport = resolve; });
  const safe = { statement:'Visible question', starterCode:{python:'class Solution: pass'}, url:'https://neetcode.io/problems/a' };
  const handler = createTutorHandler({ catalog:[{slug:'a',title:'A',questionUrl:safe.url}],
    importer:{ import:async (_slug,preview) => { preview({...safe,referenceMaterial:'PRIVATE'}); await imported; return {...safe,referenceMaterial:'PRIVATE'}; } },
    store:{idFor:()=> 'a'.repeat(64), get:async()=>{throw Error('missing');}, prepare:async()=>{throw Error('SECRET');}} });
  const start = await call(handler,'POST','/api/tutor/problems',{source:'neetcode',slug:'a'});
  const path = `/api/tutor/problems/${start.body.problemId}`;
  const preview = (await call(handler,'GET',path)).body;
  assert.equal(preview.status,'importing');
  assert.equal(preview.preview.statement,safe.statement);
  assert.deepEqual(preview.preview.source.starterCode,safe.starterCode);
  assert.doesNotMatch(JSON.stringify(preview),/PRIVATE|referenceMaterial/);
  finishImport(); await new Promise(resolve=>setImmediate(resolve));
  const failed = (await call(handler,'GET',path)).body;
  assert.equal(failed.status,'failed');
  assert.deepEqual(failed.preview,preview.preview);
  assert.doesNotMatch(JSON.stringify(failed),/PRIVATE|SECRET/);
});

test('uncached graphs queue serially, deduplicate, and never block cached problems', async () => {
  const first = 'First question with enough detail to be a valid custom statement.';
  const second = 'Second question with enough detail to be a valid custom statement.';
  const cached = 'Cached question with enough detail to be a valid custom statement.';
  const ids = new Map([[first,'a'.repeat(64)],[second,'b'.repeat(64)],[cached,'c'.repeat(64)]]);
  const pending = [];
  const handler = createTutorHandler({ store:{ idFor:s=>ids.get(s),
    get:async id=>{if(id===ids.get(cached))return {problemId:id}; throw Error('missing');}, metadata:r=>r,
    prepare:(s,progress)=>{progress('generating');return new Promise(resolve=>pending.push(()=>resolve({problemId:ids.get(s)})));} } });
  await call(handler,'POST','/api/tutor/problems',{statement:first});
  const queued = await call(handler,'POST','/api/tutor/problems',{statement:second});
  assert.equal(queued.status,202); assert.equal(queued.body.preview.statement,second);
  await call(handler,'POST','/api/tutor/problems',{statement:second});
  assert.equal(pending.length,1);
  assert.equal((await call(handler,'GET',`/api/tutor/problems/${ids.get(second)}`)).body.status,'queued');
  assert.equal((await call(handler,'POST','/api/tutor/problems',{statement:cached})).status,200);
  pending[0](); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,2);
  pending[1](); await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await call(handler,'GET',`/api/tutor/problems/${ids.get(second)}`)).body.status,'ready');
});

async function callWithHeaders(handler, method, path, data) {
  const request = Readable.from([Buffer.from(JSON.stringify(data ?? {}))]);
  Object.assign(request, { method, headers: { 'content-type': 'application/json' } });
  const response = { writeHead(status, headers = {}) { this.status = status; this.headers = headers; }, end(body) { this.body = JSON.parse(body); } };
  await handler(request, response, path);
  return response;
}

test('demo limits refuse extra readings and new problems with Retry-After, before any model call', async () => {
  const { RateLimiter } = await import('../rate-limit.js');
  const limiter = new RateLimiter({ limits: { arena: { visitor: 9, ip: 9, daily: 9 }, evaluate: { visitor: 1, ip: 9, daily: 9 }, prepare: { visitor: 1, ip: 9, daily: 9 } } });
  let evaluations = 0, preparations = 0;
  const handler = createTutorHandler({ limiter, identify: () => ({ ip: '1.1.1.1', visitor: 'v' }),
    store: { get: async () => record, idFor: () => 'e'.repeat(64), metadata: () => ({ problemId: 'e'.repeat(64), graphVersion: 'v1' }),
      prepare: async () => { preparations++; return new Promise(() => {}); } },
    evaluate: async () => { evaluations++; return { hotter: .6, colder: .4 }; } });
  assert.equal((await callWithHeaders(handler, 'POST', '/api/tutor/evaluate', evaluationFixture())).status, 200);
  const limited = await callWithHeaders(handler, 'POST', '/api/tutor/evaluate', { ...evaluationFixture(), sessionId: 'other-session' });
  assert.equal(limited.status, 429);
  assert.match(limited.headers['Retry-After'], /^\d+$/);
  assert.match(limited.body.error, /hourly limit for Navigator readings/);
  assert.equal(evaluations, 1);

  // A problem whose map is already cached is free and doesn't use the allowance.
  const cached = await callWithHeaders(handler, 'POST', '/api/tutor/problems', { statement });
  assert.equal(cached.status, 200);
  const uncached = createTutorHandler({ limiter, identify: () => ({ ip: '1.1.1.1', visitor: 'v' }),
    store: { get: async () => { throw Error('missing'); }, idFor: text => String(text.length).padStart(64, 'f'), prepare: async () => { preparations++; return new Promise(() => {}); } } });
  assert.equal((await callWithHeaders(uncached, 'POST', '/api/tutor/problems', { statement })).status, 202);
  const refused = await callWithHeaders(uncached, 'POST', '/api/tutor/problems', { statement: statement + ' (variant)' });
  assert.equal(refused.status, 429);
  assert.match(refused.body.error, /new problem setups/);
  assert.equal(preparations, 1);
});
