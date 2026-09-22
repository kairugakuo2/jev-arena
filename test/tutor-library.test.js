import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TutorLocalStore, filterCatalog, groupCatalog, continueProblem, surpriseProblem } from '../public/tutor/library.js';

const problems = [
  { slug:'contains-duplicate', title:'Contains Duplicate', pattern:'Arrays & Hashing', difficulty:'Easy', order:1 },
  { slug:'two-sum', title:'Two Sum', pattern:'Arrays & Hashing', difficulty:'Easy', order:2 },
  { slug:'three-sum', title:'3Sum', pattern:'Two Pointers', difficulty:'Medium', order:3 },
  { slug:'median', title:'Median of Two Sorted Arrays', pattern:'Binary Search', difficulty:'Hard', order:4 },
];

function memoryStorage() {
  const values = new Map();
  return { getItem:key => values.get(key) ?? null, setItem:(key,value) => values.set(key,value), values };
}

test('catalog search combines pattern, difficulty, and local status filters, then groups in roadmap order', () => {
  const progress = {
    'neetcode:contains-duplicate': { attemptedAt:'2026-01-01T00:00:00.000Z' },
    'neetcode:two-sum': { attemptedAt:'2026-01-01T00:00:00.000Z', completedAt:'2026-01-02T00:00:00.000Z' },
  };
  assert.deepEqual(filterCatalog(problems, { query:'sum', pattern:'Arrays & Hashing', difficulty:'Easy', status:'completed' }, progress).map(x => x.slug), ['two-sum']);
  assert.deepEqual(filterCatalog(problems, { query:'', pattern:'all', difficulty:'all', status:'unstarted' }, progress).map(x => x.slug), ['three-sum','median']);
  assert.deepEqual(groupCatalog(problems).map(group => [group.pattern, group.problems.map(item => item.order)]), [
    ['Arrays & Hashing',[1,2]], ['Two Pointers',[3]], ['Binary Search',[4]],
  ]);
});

test('roadmap continues the most recently attempted unfinished problem, then the first unstarted problem', () => {
  const progress = {
    'neetcode:contains-duplicate': { attemptedAt:'2026-01-01T00:00:00.000Z', lastOpenedAt:'2026-01-03T00:00:00.000Z' },
    'neetcode:three-sum': { attemptedAt:'2026-01-05T00:00:00.000Z', lastOpenedAt:'2026-01-05T00:00:00.000Z' },
  };
  assert.equal(continueProblem(problems, progress).slug, 'three-sum');
  progress['neetcode:three-sum'].completedAt = '2026-01-06T00:00:00.000Z';
  progress['neetcode:contains-duplicate'].completedAt = '2026-01-06T00:00:00.000Z';
  assert.equal(continueProblem(problems, progress).slug, 'two-sum');
});

test('surprise selection is uniform over matching unfinished candidates and does not alter filters', () => {
  const filters = { query:'sum', pattern:'all', difficulty:'all', status:'all' };
  const progress = { 'neetcode:two-sum': { completedAt:'2026-01-01T00:00:00.000Z' } };
  assert.equal(surpriseProblem(problems, filters, progress, () => 0).slug, 'three-sum');
  assert.equal(surpriseProblem(problems, { ...filters, difficulty:'Easy' }, progress, () => .5), null);
  assert.deepEqual(filters, { query:'sum', pattern:'all', difficulty:'all', status:'all' });
  assert.equal(surpriseProblem(problems, { ...filters, difficulty:'Easy' }, progress, () => 0, { includeCompleted:true }).slug, 'two-sum');
});

test('local progress is versioned and manual completion is independent from Jev readings', () => {
  const storage = memoryStorage();
  let now = Date.parse('2026-01-01T00:00:00Z');
  const store = new TutorLocalStore({ storage, now:() => now });
  store.open('two-sum');
  store.attempt('two-sum');
  store.attempt('two-sum');
  now += 1000;
  store.complete('two-sum', true);
  assert.deepEqual(store.progress()['neetcode:two-sum'], {
    lastOpenedAt:'2026-01-01T00:00:00.000Z', attemptedAt:'2026-01-01T00:00:00.000Z', completedAt:'2026-01-01T00:00:01.000Z',
  });
  store.complete('two-sum', false);
  assert.equal(store.progress()['neetcode:two-sum'].completedAt, undefined);
  const persisted = JSON.parse(storage.getItem('jev-tutor-library-v1'));
  assert.equal(persisted.version, 1);
});

test('drafts restore per language and evict least-recently-used problem records at 20 or 2 MiB', () => {
  const storage = memoryStorage();
  let now = 0;
  const store = new TutorLocalStore({ storage, now:() => ++now });
  store.saveDraft('neetcode:two-sum', 'python', 'print("py")');
  store.saveDraft('neetcode:two-sum', 'javascript', 'console.log("js")');
  assert.equal(store.draft('neetcode:two-sum', 'python'), 'print("py")');
  assert.equal(store.draft('neetcode:two-sum', 'javascript'), 'console.log("js")');
  for (let index = 0; index < 21; index++) store.saveDraft(`neetcode:p-${index}`, 'python', `${index}`);
  assert.equal(store.draft('neetcode:two-sum', 'python'), null);
  assert.equal(Object.keys(JSON.parse(storage.getItem('jev-tutor-library-v1')).drafts).length, 20);

  const budgetStore = new TutorLocalStore({ storage:memoryStorage(), now:() => ++now });
  for (let index = 0; index < 20; index++) budgetStore.saveDraft(`neetcode:large-${index}`, 'python', 'x'.repeat(120 * 1024));
  const saved = JSON.parse(budgetStore.storage.getItem('jev-tutor-library-v1'));
  assert.ok(Buffer.byteLength(JSON.stringify(saved.drafts)) <= 2 * 1024 * 1024);
});
