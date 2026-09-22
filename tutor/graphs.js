import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { validateGraph, critiqueSchema } from './schema.js';
import { MAP_MODEL, generateGraph, critiqueGraph } from './models.js';
import { PROMPT_VERSION } from './prompts.js';

export class GraphStore {
  constructor({ cacheDir = new URL('../.cache/tutor/', import.meta.url).pathname, generate = generateGraph, critique = critiqueGraph } = {}) {
    Object.assign(this, { cacheDir, generate, critique });
    this.pending = new Map();
  }

  idFor(statement, { referenceMaterial = '', referenceHash = referenceMaterial ? createHash('sha256').update(referenceMaterial).digest('hex') : '' } = {}) {
    return createHash('sha256').update(JSON.stringify([statement.trim(), referenceHash, MAP_MODEL, PROMPT_VERSION])).digest('hex');
  }

  metadata(record) {
    return { problemId: record.problemId, graphVersion: record.graphVersion, title: record.graph.title,
      statement: record.statement, constraints: record.graph.concept.constraints, model: record.model, createdAt: record.createdAt,
      ...(record.source ? { source: record.source } : {}) };
  }

  async get(problemId) {
    if (!/^[a-f0-9]{64}$/.test(problemId)) throw Error('Invalid problem ID.');
    const record = JSON.parse(await readFile(join(this.cacheDir, `${problemId}.json`), 'utf8'));
    if (record.problemId !== problemId || this.idFor(record.statement, { referenceHash: record.referenceHash || '' }) !== problemId || record.promptVersion !== PROMPT_VERSION
      || !record.review?.approved || record.review.issues?.length) throw Error('Graph cache requires regeneration.');
    record.graph = validateGraph(record.graph);
    return record;
  }

  async prepare(statement, onProgress = () => {}, { referenceMaterial = '', source = null } = {}) {
    statement = statement.trim();
    if (statement.length < 40 || statement.length > 20000) throw Error('Paste a complete problem statement (40–20,000 characters).');
    const referenceHash = referenceMaterial ? createHash('sha256').update(referenceMaterial).digest('hex') : '';
    const id = this.idFor(statement, { referenceHash });
    if (this.pending.has(id)) return this.pending.get(id);
    const work = this.build(statement, id, onProgress, { referenceMaterial, referenceHash, source });
    this.pending.set(id, work);
    try { return await work; } finally { this.pending.delete(id); }
  }

  async build(statement, problemId, onProgress, { referenceMaterial, referenceHash, source }) {
    try { return this.metadata(await this.get(problemId)); } catch { /* Missing/invalid cache must be reviewed again. */ }
    let previous, issues = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      onProgress(attempt ? 'repairing' : 'generating');
      const generated = await this.generate({ statement, referenceMaterial, previous, issues });
      try { previous = validateGraph(generated); }
      catch (error) {
        previous = generated;
        issues = [error.message.slice(0, 3000)];
        continue;
      }
      onProgress('reviewing');
      const review = critiqueSchema.parse(await this.critique({ statement, referenceMaterial, graph: previous }));
      if (!review.approved || review.issues.length) { issues = review.issues.length ? review.issues : ['Review did not approve the graph.']; continue; }
      const record = { problemId, graphVersion: PROMPT_VERSION, model: MAP_MODEL, promptVersion: PROMPT_VERSION,
        createdAt: new Date().toISOString(), statement, referenceHash, ...(source ? { source } : {}), graph: previous, review };
      await mkdir(this.cacheDir, { recursive: true });
      const temporary = join(this.cacheDir, `${problemId}.${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
      await rename(temporary, join(this.cacheDir, `${problemId}.json`));
      return this.metadata(record);
    }
    throw Error('The solution graph did not pass review after one repair. Try again with a clearer problem statement.');
  }
}
