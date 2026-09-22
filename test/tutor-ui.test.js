import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('Navigator is library-first with accessible tabs, filters, roadmap, random selection, and manual completion', async () => {
  const html = await read('tutor.html');
  assert.match(html, /role="tablist"/);
  assert.match(html, /id="library-tab"[^>]*aria-selected="true"/);
  assert.match(html, /id="custom-tab"/);
  assert.match(html, /id="catalog-search"/);
  assert.match(html, /id="pattern-filter"/);
  assert.match(html, /id="difficulty-filter"/);
  assert.match(html, /id="status-filter"/);
  assert.match(html, /id="continue-problem"/);
  assert.match(html, /id="surprise-problem"/);
  assert.match(html, /id="mark-complete"[^>]*type="checkbox"/);
  assert.match(html, /NeetCode/);
});

test('Navigator client connects library state, preparation stages, and per-language drafts', async () => {
  const app = await read('tutor/library-app.js');
  assert.match(app, /from ['"]\.\/library\.js['"]/);
  assert.match(app, /importing/);
  assert.match(app, /mapping_approaches/);
  assert.match(app, /reviewing_reference/);
  assert.match(app, /saveDraft/);
  assert.match(app, /mark-complete/);
  const css = await read('tutor/styles.css');
  assert.match(css, /\.catalog-results/);
  assert.match(css, /@media\(max-width:680px\)/);
});
