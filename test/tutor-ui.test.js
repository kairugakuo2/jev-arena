import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('Navigator is library-first with accessible tabs and filters but no roadmap or progress controls', async () => {
  const html = await read('tutor.html');
  assert.match(html, /role="tablist"/);
  assert.match(html, /id="library-tab"[^>]*aria-selected="true"/);
  assert.match(html, /id="custom-tab"/);
  assert.match(html, /id="catalog-search"/);
  assert.match(html, /id="pattern-filter"/);
  assert.match(html, /id="difficulty-filter"/);
  assert.doesNotMatch(html, /id="status-filter"|id="continue-problem"|id="mark-complete"/);
  assert.match(html, /id="surprise-problem"/);
  assert.match(html, /id="editor"[^>]*aria-busy="true"/);
  assert.match(html, /NeetCode/);
});

test('Navigator client connects library state, preparation stages, and per-language drafts', async () => {
  const app = await read('tutor/library-app.js');
  assert.match(app, /from ['"]\.\/library\.js['"]/);
  assert.match(app, /importing/);
  assert.match(app, /mapping_approaches/);
  assert.match(app, /reviewing_reference/);
  assert.match(app, /saveDraft/);
  assert.doesNotMatch(app, /continueProblem|mark-complete|\.attempt\(/);
  const css = await read('tutor/styles.css');
  assert.match(css, /\.catalog-results/);
  assert.match(css, /@media\(max-width:680px\)/);
});
