import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'parse5';
import { NEETCODE_CATALOG } from './neetcode-catalog.js';

const ALLOWED_HOSTS = new Set(['neetcode.io', 'raw.githubusercontent.com']);
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STATEMENT_BYTES = 20 * 1024;
const MAX_REFERENCE_BYTES = 128 * 1024;
const LIMITS = Object.freeze({ question: 1024 * 1024, article: 256 * 1024, python: 128 * 1024, javascript: 128 * 1024 });
const EXPECTED_TYPES = Object.freeze({ question: ['application/json'], article: ['text/plain', 'text/markdown'], python: ['text/plain'], javascript: ['text/plain', 'application/javascript'] });
const BLOCK_TAGS = new Set(['address', 'article', 'blockquote', 'br', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ol', 'p', 'pre', 'section', 'table', 'tr', 'ul']);
const SKIP_TAGS = new Set(['script', 'style', 'svg', 'template']);

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function allowedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password) {
    throw Error('Source URL is not allowlisted.');
  }
  return url;
}

function findArticle(node) {
  if (node?.tagName === 'main') {
    const classes = (node.attrs?.find(attribute => attribute.name === 'class')?.value || '').split(/\s+/);
    if (['my-article-component-container', 'neeter-article-content', 'neeter-article-plain'].every(name => classes.includes(name))) return node;
  }
  for (const child of node?.childNodes || []) {
    const found = findArticle(child);
    if (found) return found;
  }
  return null;
}

function collectVisibleText(node, output, state) {
  if (state.done || node?.tagName === 'details') { state.done = true; return; }
  if (SKIP_TAGS.has(node?.tagName)) return;
  if (node?.nodeName === '#text') output.push(node.value);
  for (const child of node?.childNodes || []) collectVisibleText(child, output, state);
  if (BLOCK_TAGS.has(node?.tagName)) output.push('\n');
}

export function extractStatement(html) {
  const article = findArticle(parse(html));
  if (!article) throw Error('NeetCode question article was not found.');
  const output = [];
  const state = { done: false };
  for (const child of article.childNodes || []) collectVisibleText(child, output, state);
  const statement = output.join(' ').replace(/[ \t]+/g, ' ').replace(/ *\n+ */g, '\n').trim();
  if (byteLength(statement) < 40) throw Error('NeetCode question article was incomplete.');
  if (byteLength(statement) > MAX_STATEMENT_BYTES) throw Error('Normalized question statement is too large.');
  return statement;
}

export function extractDescription(body, expectedId) {
  let metadata;
  try { metadata = JSON.parse(body)?.data; } catch { throw Error('NeetCode problem metadata was malformed.'); }
  if (metadata?.id !== expectedId || typeof metadata.description !== 'string') throw Error('NeetCode problem metadata or description was invalid.');
  const visible = metadata.description.split(/<details\b/i,1)[0]
    .replace(/```[^\n]*\n?/g,'\n').replace(/```/g,'\n')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g,'$1').replace(/[*_]{1,3}/g,'').replace(/`([^`]*)`/g,'$1');
  const document = parse(`<main class="my-article-component-container neeter-article-content neeter-article-plain">${visible}</main>`);
  const article = findArticle(document), output = [], state = { done:false };
  for (const child of article?.childNodes || []) collectVisibleText(child,output,state);
  const statement = output.join(' ').replace(/[ \t]+/g,' ').replace(/ *\n+ */g,'\n').trim();
  if (byteLength(statement) < 40) throw Error('NeetCode problem description was incomplete.');
  if (byteLength(statement) > MAX_STATEMENT_BYTES) throw Error('Normalized question statement is too large.');
  return statement;
}

function extractStarterCode(body, problem) {
  let data;
  try { data = JSON.parse(body)?.data; } catch { throw Error('NeetCode starter code was malformed.'); }
  if (data?.id !== problem.sourceId || !data.starterCode || typeof data.starterCode !== 'object') throw Error('NeetCode starter code was unavailable.');
  const code = {};
  for (const language of ['python', 'javascript']) {
    if (!problem[language]) continue;
    const value = data.starterCode[language];
    if (typeof value !== 'string' || !value.trim() || byteLength(value) > 16 * 1024) throw Error(`NeetCode ${language} starter code was invalid.`);
    code[language] = value;
  }
  return code;
}

export function extractArticleProse(markdown) {
  return markdown.replace(/```[\s\S]*?```/g,'\n').replace(/^::[^\n]*$/gm,'').replace(/<[^>]+>/g,' ')
    .replace(/[ \t]+/g,' ').replace(/ *\n{3,} */g,'\n\n').trim();
}

function sourceUrls(problem) {
  const base = 'https://raw.githubusercontent.com/neetcode-gh/leetcode/main';
  return {
    question: 'https://neetcode.io/api/getProblemMetadataFunctionHttp',
    article: `${base}/articles/${problem.sourceId}.md`,
    ...(problem.python ? { python: `${base}/python/${problem.code}.py` } : {}),
    ...(problem.javascript ? { javascript: `${base}/javascript/${problem.code}.js` } : {}),
  };
}

function validateCache(record, problem) {
  if (!record || record.version !== 2 || record.slug !== problem.slug || record.sourceId !== problem.sourceId || record.url !== problem.questionUrl) throw Error('Invalid source cache.');
  if (typeof record.fetchedAt !== 'string' || !Number.isFinite(Date.parse(record.fetchedAt))) throw Error('Invalid source cache timestamp.');
  if (typeof record.statement !== 'string' || byteLength(record.statement) > MAX_STATEMENT_BYTES) throw Error('Invalid source cache statement.');
  if (typeof record.referenceMaterial !== 'string' || byteLength(record.referenceMaterial) > MAX_REFERENCE_BYTES) throw Error('Invalid source cache reference.');
  if (record.hashes?.statement !== hash(record.statement) || record.hashes?.reference !== hash(record.referenceMaterial)) throw Error('Invalid source cache hashes.');
  const contentHash = hash(JSON.stringify([record.statement, record.hashes.reference, record.coverage]));
  if (contentHash !== record.contentHash) throw Error('Invalid source cache fingerprint.');
  extractStarterCode(record.resources?.question?.body, problem);
  return record;
}

function publicSource(record, problem, stale = false) {
  return {
    slug: record.slug, url: record.url, fetchedAt: record.fetchedAt, stale,
    statement: record.statement, referenceMaterial: record.referenceMaterial,
    coverage: record.coverage, contentHash: record.contentHash,
    starterCode: extractStarterCode(record.resources.question.body, problem),
  };
}

export class NeetCodeImporter {
  constructor({
    catalog = NEETCODE_CATALOG,
    cacheDir = new URL('../.cache/tutor/sources/', import.meta.url).pathname,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    timeoutMs = 10_000,
  } = {}) {
    this.catalog = new Map(catalog.map(problem => [problem.slug, problem]));
    Object.assign(this, { cacheDir, fetchImpl, now, timeoutMs });
  }

  async import(slug, onPreview = () => {}) {
    const problem = this.catalog.get(slug);
    if (!problem) throw Error('Problem slug is not in the NeetCode catalog.');
    let cached;
    try { cached = validateCache(JSON.parse(await readFile(join(this.cacheDir, `${slug}.json`), 'utf8')), problem); }
    catch { cached = null; }
    let previewed = false;
    const preview = source => {
      previewed = true;
      onPreview({ slug:source.slug, url:source.url, fetchedAt:source.fetchedAt,
        stale:source.stale, statement:source.statement, starterCode:source.starterCode });
    };
    if (cached && this.now() - Date.parse(cached.fetchedAt) <= MAX_AGE_MS) {
      const source = publicSource(cached, problem); preview(source); return source;
    }
    try {
      const record = await this.fetchSource(problem, cached, preview);
      await this.writeCache(record);
      return publicSource(record, problem);
    } catch (error) {
      if (cached && !previewed) { const source = publicSource(cached, problem, true); preview(source); return source; }
      throw error;
    }
  }

  async fetchSource(problem, cached, onPreview) {
    const urls = sourceUrls(problem);
    const resources = {};
    resources.question = await this.fetchResource('question', urls.question, cached?.resources?.question, problem);
    const statement = extractDescription(resources.question.body,problem.sourceId);
    const starterCode = extractStarterCode(resources.question.body, problem);
    const fetchedAt = new Date(this.now()).toISOString();
    onPreview?.({ slug:problem.slug, url:problem.questionUrl, fetchedAt, stale:false, statement, starterCode });
    // Optional reference downloads never hold up the question or starter code.
    await Promise.all(Object.entries(urls).filter(([kind]) => kind !== 'question').map(async ([kind, url]) => {
      try { resources[kind] = await this.fetchResource(kind, url, cached?.resources?.[kind], problem); }
      catch (error) {
        if (error.code === 'SOURCE_POLICY') throw error;
        resources[kind] = null;
      }
    }));
    const references = [];
    const coverage = { article: false, python: false, javascript: false };
    for (const kind of ['python', 'javascript', 'article']) {
      const resource = resources[kind];
      if (!resource) continue;
      const label = kind === 'article' ? 'NeetCode article prose' : `${kind} reference solution`;
      const body = kind === 'article' ? extractArticleProse(resource.body) : resource.body.trim();
      if (!body) continue;
      const section = `## ${label}\n${body}\n`;
      if (byteLength(references.join('\n') + section) <= MAX_REFERENCE_BYTES) {
        references.push(section);
        coverage[kind] = true;
      }
    }
    const referenceMaterial = references.join('\n');
    const hashes = { statement: hash(statement), reference: hash(referenceMaterial) };
    return {
      version: 2, slug: problem.slug, sourceId:problem.sourceId, url: problem.questionUrl, fetchedAt,
      statement, referenceMaterial, coverage, hashes,
      contentHash: hash(JSON.stringify([statement, hashes.reference, coverage])),
      sourceUrls: urls,
      resources,
    };
  }

  async fetchResource(kind, initialUrl, cached, problem) {
    let url = allowedUrl(initialUrl);
    const headers = {};
    if (kind === 'question') headers['content-type'] = 'application/json';
    if (cached?.etag) headers['if-none-match'] = cached.etag;
    if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified;
    for (let redirects = 0; redirects <= 2; redirects++) {
      const result = await this.fetchOnce(kind, url, headers, cached, problem, redirects);
      if (result.redirect) { url = result.redirect; continue; }
      return result.resource;
    }
    throw Error('Source redirect failed.');
  }

  // A referenced timer (unlike AbortSignal.timeout) keeps the process alive until
  // the abort fires, and covers both the request and the body download.
  async fetchOnce(kind, url, headers, cached, problem, redirects) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Source request timed out.', 'TimeoutError')), this.timeoutMs);
    try {
      let response;
      const request = { redirect:'manual', headers, signal:controller.signal,
        ...(kind === 'question' ? { method:'POST', body:JSON.stringify({ data:{ problemId:problem.sourceId } }) } : {}) };
      try { response = await this.fetchImpl(url, request); }
      catch (error) { throw Error(`Source fetch failed: ${error.message}`); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === 2) throw Error('Source redirected too many times.');
        try { return { redirect:allowedUrl(new URL(response.headers.get('location') || '', url)) }; }
        catch (error) { error.code = 'SOURCE_POLICY'; throw error; }
      }
      if (response.status === 304 && cached?.body) return { resource:cached };
      if (!response.ok) throw Error(`Source returned HTTP ${response.status}.`);
      const type = (response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
      if (!EXPECTED_TYPES[kind].includes(type)) throw Error(`Unexpected source content type for ${kind}.`);
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > LIMITS[kind]) throw Error(`${kind} source is too large.`);
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body || []) {
        const value = Buffer.from(chunk);
        length += value.length;
        if (length > LIMITS[kind]) throw Error(`${kind} source is too large.`);
        chunks.push(value);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      return { resource:{ url: String(url), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), hash: hash(body), body } };
    } finally { clearTimeout(timer); }
  }

  async writeCache(record) {
    await mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
    const target = join(this.cacheDir, `${record.slug}.json`);
    const temporary = join(this.cacheDir, `.${record.slug}.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await rename(temporary, target);
    await chmod(target, 0o600);
  }
}
