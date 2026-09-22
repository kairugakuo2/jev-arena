import { createHash } from 'node:crypto';
import { GraphStore } from './graphs.js';
import { evaluateCode } from './models.js';
import { validateEvaluation } from './schema.js';
import { NEETCODE_CATALOG, NEETCODE_CATALOG_VERSION } from './neetcode-catalog.js';
import { NeetCodeImporter } from './neetcode-importer.js';

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function readJson(req, limit = 524288) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(Error('Send JSON.'), { status: 415 });
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += Buffer.byteLength(chunk);
    if (length > limit) throw Object.assign(Error('Request too large.'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(Error('Invalid JSON.'), { status: 400 }); }
}

export function createTutorHandler({ store = new GraphStore(), evaluate = evaluateCode, catalog = NEETCODE_CATALOG, importer = new NeetCodeImporter({ catalog }) } = {}) {
  const jobs = new Map(), sessions = new Set();
  const catalogBySlug = new Map(catalog.map(problem => [problem.slug, problem]));
  let generating = false;
  return async (req, res, path) => {
    if (!path.startsWith('/api/tutor/')) return false;
    try {
      if (req.method === 'GET' && path === '/api/tutor/catalog') {
        json(res,200,{ source:'neetcode', version:NEETCODE_CATALOG_VERSION, problems:catalog }); return true;
      }
      if (req.method === 'POST' && path === '/api/tutor/problems') {
        const input = await readJson(req, 30000);
        if (input?.source === 'neetcode') {
          const problem = typeof input.slug === 'string' ? catalogBySlug.get(input.slug) : null;
          if (!problem) { json(res,400,{ error:'Choose a problem from the NeetCode catalog.' }); return true; }
          const jobId = createHash('sha256').update(`neetcode:${problem.slug}`).digest('hex');
          if (jobs.has(jobId) && !['failed','ready'].includes(jobs.get(jobId).status)) {
            json(res,202,{ problemId:jobId, status:jobs.get(jobId).status }); return true;
          }
          if (generating) { json(res,429,{ error:'Another problem is being prepared. Please wait.' }); return true; }
          generating = true;
          jobs.set(jobId,{ status:'importing' });
          (async () => {
            try {
              const imported = await importer.import(problem.slug);
              const source = { kind:'neetcode', slug:problem.slug, url:imported.url || problem.questionUrl, fetchedAt:imported.fetchedAt, stale:imported.stale,
                starterCode:imported.starterCode };
              const problemId = store.idFor(imported.statement, { referenceMaterial:imported.referenceMaterial });
              try {
                jobs.set(jobId,{ status:'ready', ...store.metadata(await store.get(problemId)), source });
              } catch {
                const metadata = await store.prepare(imported.statement, status => jobs.set(jobId,{ status:status === 'reviewing' ? 'reviewing_reference' : 'mapping_approaches' }),
                  { referenceMaterial:imported.referenceMaterial, source });
                jobs.set(jobId,{ status:'ready', ...metadata });
              }
            } catch {
              jobs.set(jobId,{ status:'failed', error:'NeetCode source import or problem preparation failed. Try again, or use the Custom tab.', source:{ kind:'neetcode', slug:problem.slug, url:problem.questionUrl } });
            } finally { generating = false; }
          })();
          json(res,202,{ problemId:jobId, status:'importing' }); return true;
        }
        if (typeof input?.statement !== 'string' || input.statement.trim().length < 40 || input.statement.length > 20000) {
          json(res,400,{ error: 'Paste the complete problem, including constraints (40–20,000 characters).' }); return true;
        }
        const problemId = store.idFor(input.statement);
        try { json(res,200,{ status:'ready', ...store.metadata(await store.get(problemId)) }); return true; } catch { /* Prepare below. */ }
        if (jobs.has(problemId) && !['failed','ready'].includes(jobs.get(problemId).status)) {
          json(res,202,{ problemId, status: jobs.get(problemId).status }); return true;
        }
        if (generating) { json(res,429,{ error:'Another problem is being prepared. Please wait.' }); return true; }
        if (jobs.size >= 32) jobs.delete(jobs.keys().next().value);
        generating = true;
        jobs.set(problemId,{ status:'generating' });
        store.prepare(input.statement, status => jobs.set(problemId,{ status })).then(metadata => {
          jobs.set(problemId,{ status:'ready', ...metadata });
        }).catch(() => {
          jobs.set(problemId,{ status:'failed', error:'Problem preparation failed or did not pass review. Check Gateway access and the problem statement, then retry.' });
        }).finally(() => { generating = false; });
        json(res,202,{ problemId, status:'generating' }); return true;
      }
      const match = path.match(/^\/api\/tutor\/problems\/([a-f0-9]{64})$/);
      if (req.method === 'GET' && match) {
        const job = jobs.get(match[1]);
        if (job) json(res,200,{ problemId:match[1], ...job });
        else {
          try { json(res,200,{ status:'ready', ...store.metadata(await store.get(match[1])) }); }
          catch { json(res,404,{ error:'Problem not found. Prepare it again.' }); }
        }
        return true;
      }
      if (req.method === 'POST' && path === '/api/tutor/evaluate') {
        const raw = await readJson(req);
        let input;
        try { input = validateEvaluation(raw); }
        catch { json(res,400,{ error:'Invalid code snapshot or edit history.' }); return true; }
        if (sessions.has(input.sessionId) || sessions.size >= 4) {
          json(res,429,{ error:'An evaluation is already running. Please wait.' }); return true;
        }
        sessions.add(input.sessionId);
        try {
          let record;
          try { record = await store.get(input.problemId); }
          catch { json(res,404,{ error:'Prepare this problem before evaluating edits.' }); return true; }
          if (record.graphVersion !== input.graphVersion) {
            json(res,409,{ error:'The solution graph changed. Reopen the problem.' }); return true;
          }
          const started = performance.now();
          const probabilities = await evaluate(record.graph, input);
          const { sessionId, problemId, graphVersion, language, baselineRevision, currentRevision } = input;
          json(res,200,{ sessionId, problemId, graphVersion, language, baselineRevision, currentRevision,
            probabilities, available: probabilities !== null, latencyMs: Math.round(performance.now()-started) });
        } catch {
          json(res,502,{ error:'Jev could not return a reading. Check Gateway access or wait for the next attempt.' });
        } finally { sessions.delete(input.sessionId); }
        return true;
      }
      json(res,404,{ error:'Not found.' });
    } catch (error) {
      json(res,error.status || 500,{ error: error.status ? error.message : 'Tutor request failed.' });
    }
    return true;
  };
}
