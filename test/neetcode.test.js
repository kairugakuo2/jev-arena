import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NEETCODE_CATALOG, NEETCODE_CATALOG_VERSION } from '../tutor/neetcode-catalog.js';
import { NeetCodeImporter, extractStatement } from '../tutor/neetcode-importer.js';

const fixture = name => readFile(new URL(`./fixtures/neetcode/${name}`, import.meta.url), 'utf8');
const item = {
  slug: 'two-integer-sum', title: 'Two Integer Sum', pattern: 'Arrays & Hashing', difficulty: 'Easy', order: 1,
  questionUrl: 'https://neetcode.io/problems/two-integer-sum', sourceId:'two-integer-sum', code: '0001-two-sum', python: true, javascript: true,
};
const urls = {
  question: 'https://neetcode.io/api/getProblemMetadataFunctionHttp',
  article: 'https://raw.githubusercontent.com/neetcode-gh/leetcode/main/articles/two-integer-sum.md',
  python: 'https://raw.githubusercontent.com/neetcode-gh/leetcode/main/python/0001-two-sum.py',
  javascript: 'https://raw.githubusercontent.com/neetcode-gh/leetcode/main/javascript/0001-two-sum.js',
};

function response(body, type = 'text/plain; charset=utf-8', init = {}) {
  return new Response(body, { ...init, status: init.status || 200, headers: { 'content-type': type, ...init.headers } });
}

async function successfulFetch(overrides = {}) {
  const bodies = {
    [urls.question]: response(await fixture('question.json'), 'application/json; charset=utf-8'),
    [urls.article]: response(await fixture('article.md')),
    [urls.python]: response(await fixture('solution.py')),
    [urls.javascript]: response(await fixture('solution-js.txt')),
    ...overrides,
  };
  return async url => {
    const value = bodies[String(url)];
    if (!value) throw Error(`Unexpected URL ${url}`);
    return typeof value === 'function' ? value() : value.clone();
  };
}

test('bundled NeetCode 150 catalog is normalized, unique, ordered, and safe', () => {
  const supportedPatterns = new Set(['Arrays & Hashing', 'Two Pointers', 'Sliding Window', 'Stack', 'Binary Search',
    'Linked List', 'Trees', 'Tries', 'Heap / Priority Queue', 'Backtracking', 'Graphs', 'Advanced Graphs',
    '1-D Dynamic Programming', '2-D Dynamic Programming', 'Greedy', 'Intervals', 'Math & Geometry', 'Bit Manipulation']);
  assert.match(NEETCODE_CATALOG_VERSION, /^neetcode150-/);
  assert.equal(NEETCODE_CATALOG.length, 150);
  assert.equal(new Set(NEETCODE_CATALOG.map(problem => problem.slug)).size, 150);
  assert.deepEqual(NEETCODE_CATALOG.map(problem => problem.order), Array.from({ length: 150 }, (_, index) => index + 1));
  for (const problem of NEETCODE_CATALOG) {
    assert.match(problem.slug, /^[a-z0-9-]+$/);
    assert.ok(problem.title && problem.pattern && problem.code && problem.sourceId);
    assert.ok(supportedPatterns.has(problem.pattern), `unexpected pattern: ${problem.pattern}`);
    assert.ok(['Easy', 'Medium', 'Hard'].includes(problem.difficulty));
    assert.equal(problem.questionUrl, `https://neetcode.io/problems/${problem.sourceId}`);
    assert.equal(typeof problem.python, 'boolean');
    assert.equal(typeof problem.javascript, 'boolean');
  }
});

test('imports a bounded statement and hidden references from local fixtures', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'jev-neetcode-'));
  const importer = new NeetCodeImporter({ catalog: [item], cacheDir, fetchImpl: await successfulFetch(), now: () => Date.parse('2026-09-22T12:00:00Z') });
  const source = await importer.import('two-integer-sum');
  assert.match(source.statement, /Given an array/);
  assert.match(source.statement, /Exactly one answer exists/);
  assert.doesNotMatch(source.statement, /SECRET_HINT|SECRET_SCRIPT/);
  assert.match(source.referenceMaterial, /hidden reference prose/);
  assert.match(source.referenceMaterial, /class Solution/);
  assert.doesNotMatch(source.referenceMaterial, /SECRET_ARTICLE_CODE/);
  assert.equal(source.coverage.python, true);
  assert.equal(source.coverage.javascript, true);
  assert.match(source.contentHash, /^[a-f0-9]{64}$/);
  assert.match(source.starterCode.python, /class Solution:/);
  assert.match(source.starterCode.javascript, /class Solution/);
  assert.equal((await stat(join(cacheDir, 'two-integer-sum.json'))).mode & 0o777, 0o600);
});

test('legacy static article extraction stops before details and excludes active content', async () => {
  const statement = extractStatement(await fixture('question.html'));
  assert.match(statement,/Given an array/);
  assert.doesNotMatch(statement,/SECRET_HINT|SECRET_SCRIPT|SOLUTION_UI/);
});

test('rejects unknown slugs, foreign redirects, wrong content types, and oversized bodies', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'jev-neetcode-'));
  let calls = 0;
  const unknown = new NeetCodeImporter({ catalog: [item], cacheDir, fetchImpl: async () => { calls++; } });
  await assert.rejects(unknown.import('not-in-catalog'), /catalog/);
  assert.equal(calls, 0);

  const redirected = new NeetCodeImporter({ catalog: [item], cacheDir, fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://example.com/stolen' } }) });
  await assert.rejects(redirected.import(item.slug), /allowlisted/);

  const wrongType = new NeetCodeImporter({ catalog: [item], cacheDir, fetchImpl: await successfulFetch({
    [urls.question]: () => response('{}', 'text/html'),
  }) });
  await assert.rejects(wrongType.import(item.slug), /content type/);

  const oversized = new NeetCodeImporter({ catalog: [item], cacheDir, fetchImpl: await successfulFetch({
    [urls.question]: () => response('x'.repeat(1024 * 1024 + 1), 'application/json'),
  }) });
  await assert.rejects(oversized.import(item.slug), /too large/);

  const malformed = new NeetCodeImporter({ catalog: [item], cacheDir, fetchImpl: await successfulFetch({
    [urls.question]: () => response('{"data":{"description":12}}', 'application/json'),
  }) });
  await assert.rejects(malformed.import(item.slug), /metadata|description/);

  const missingStarter = JSON.parse(await fixture('question.json'));
  delete missingStarter.data.starterCode.python;
  const invalidStarter = new NeetCodeImporter({ catalog:[item], cacheDir, fetchImpl:await successfulFetch({
    [urls.question]: () => response(JSON.stringify(missingStarter), 'application/json'),
  }) });
  await assert.rejects(invalidStarter.import(item.slug), /starter code/);
});

test('aborts a resource that exceeds its timeout', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'jev-neetcode-'));
  const importer = new NeetCodeImporter({
    catalog: [item], cacheDir, timeoutMs: 5,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
  });
  await assert.rejects(importer.import(item.slug), /fetch failed/i);
});

test('uses fresh cache, revalidates after seven days, and falls back to validated stale cache', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'jev-neetcode-'));
  let calls = 0;
  const fetchImpl = await successfulFetch();
  const first = new NeetCodeImporter({ catalog: [item], cacheDir, fetchImpl: async (...args) => { calls++; return fetchImpl(...args); }, now: () => Date.parse('2026-09-01T00:00:00Z') });
  const original = await first.import(item.slug);
  assert.equal(calls, 4);
  await first.import(item.slug);
  assert.equal(calls, 4);

  const stale = new NeetCodeImporter({ catalog: [item], cacheDir, fetchImpl: async () => { throw Error('offline'); }, now: () => Date.parse('2026-09-10T00:00:01Z') });
  const fallback = await stale.import(item.slug);
  assert.equal(fallback.stale, true);
  assert.equal(fallback.contentHash, original.contentHash);

  const cached = JSON.parse(await readFile(join(cacheDir, `${item.slug}.json`), 'utf8'));
  cached.statement = 'tampered';
  await writeFile(join(cacheDir, `${item.slug}.json`), JSON.stringify(cached), { mode: 0o600 });
  await assert.rejects(stale.import(item.slug), /cache|offline/i);
});

test('revalidation sends validators and changed reference content changes the fingerprint', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'jev-neetcode-'));
  const questionJson = await fixture('question.json');
  const initialFetch = await successfulFetch({
    [urls.question]: () => response(questionJson, 'application/json', { headers: { etag: '"question-v1"' } }),
  });
  const initial = await new NeetCodeImporter({ catalog: [item], cacheDir, fetchImpl: initialFetch, now: () => 0 }).import(item.slug);
  let questionHeaders;
  const changedFetch = await successfulFetch({
    [urls.question]: (_url, options) => {
      questionHeaders = options?.headers;
      return new Response(null, { status: 304 });
    },
    [urls.article]: () => response('A changed hidden reference article.'),
  });
  const wrapped = async (url, options) => {
    const entry = {
      [urls.question]: () => {
        questionHeaders = options.headers;
        return new Response(null, { status: 304 });
      },
    }[String(url)];
    return entry ? entry() : changedFetch(url, options);
  };
  const changed = await new NeetCodeImporter({ catalog: [item], cacheDir, fetchImpl: wrapped, now: () => 8 * 24 * 60 * 60 * 1000 }).import(item.slug);
  assert.equal(questionHeaders['if-none-match'], '"question-v1"');
  assert.notEqual(changed.contentHash, initial.contentHash);
});
