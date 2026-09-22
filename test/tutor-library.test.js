import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TutorLocalStore, filterCatalog, groupCatalog, surpriseProblem } from '../public/tutor/library.js';

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

test('catalog search combines pattern and difficulty filters, then groups in catalog order', () => {
  assert.deepEqual(filterCatalog(problems, { query:'sum', pattern:'Arrays & Hashing', difficulty:'Easy' }).map(x => x.slug), ['two-sum']);
  assert.deepEqual(filterCatalog(problems, { query:'', pattern:'all', difficulty:'all' }).map(x => x.slug), ['contains-duplicate','two-sum','three-sum','median']);
  assert.deepEqual(groupCatalog(problems).map(group => [group.pattern, group.problems.map(item => item.order)]), [
    ['Arrays & Hashing',[1,2]], ['Two Pointers',[3]], ['Binary Search',[4]],
  ]);
});

test('surprise selection is uniform over matching candidates and does not alter filters', () => {
  const filters = { query:'sum', pattern:'all', difficulty:'all', status:'all' };
  assert.equal(surpriseProblem(problems, filters, () => 0).slug, 'two-sum');
  assert.equal(surpriseProblem(problems, { ...filters, difficulty:'Easy' }, () => .5).slug, 'two-sum');
  assert.deepEqual(filters, { query:'sum', pattern:'all', difficulty:'all', status:'all' });
});

test('old local progress is discarded while per-language drafts survive', () => {
  const storage = memoryStorage();
  storage.setItem('jev-tutor-library-v1', JSON.stringify({ version:1, progress:{ 'neetcode:two-sum':{ completedAt:'yesterday' } }, drafts:{ 'neetcode:two-sum':{ languages:{ python:'return [0,1]' }, usedAt:1 } } }));
  const store = new TutorLocalStore({ storage, now:() => 2 });
  assert.equal(store.draft('neetcode:two-sum','python'),'return [0,1]');
  assert.equal('progress' in JSON.parse(storage.getItem('jev-tutor-library-v1')), false);
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
