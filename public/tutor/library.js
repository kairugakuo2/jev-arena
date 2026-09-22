export const LOCAL_STATE_KEY = 'jev-tutor-library-v1';
export const MAX_DRAFT_PROBLEMS = 20;
export const MAX_DRAFT_BYTES = 2 * 1024 * 1024;

const bytes = value => new TextEncoder().encode(value).byteLength;
const progressKey = slug => `neetcode:${slug}`;

export function problemStatus(problem, progress) {
  const value = progress[progressKey(problem.slug)];
  if (value?.completedAt) return 'completed';
  if (value?.attemptedAt) return 'attempted';
  return 'unstarted';
}

export function filterCatalog(problems, filters, progress = {}) {
  const query = (filters.query || '').trim().toLocaleLowerCase();
  return problems.filter(problem => {
    if (query && !`${problem.title} ${problem.pattern}`.toLocaleLowerCase().includes(query)) return false;
    if (filters.pattern && filters.pattern !== 'all' && problem.pattern !== filters.pattern) return false;
    if (filters.difficulty && filters.difficulty !== 'all' && problem.difficulty !== filters.difficulty) return false;
    if (filters.status && filters.status !== 'all' && problemStatus(problem, progress) !== filters.status) return false;
    return true;
  }).sort((a, b) => a.order - b.order);
}

export function groupCatalog(problems) {
  const groups = new Map();
  for (const problem of [...problems].sort((a, b) => a.order - b.order)) {
    if (!groups.has(problem.pattern)) groups.set(problem.pattern, []);
    groups.get(problem.pattern).push(problem);
  }
  return [...groups].map(([pattern, entries]) => ({ pattern, problems: entries }));
}

export function continueProblem(problems, progress = {}) {
  const unfinished = problems.filter(problem => {
    const value = progress[progressKey(problem.slug)];
    return value?.attemptedAt && !value.completedAt;
  }).sort((a, b) => Date.parse(progress[progressKey(b.slug)].attemptedAt) - Date.parse(progress[progressKey(a.slug)].attemptedAt));
  if (unfinished.length) return unfinished[0];
  return [...problems].sort((a, b) => a.order - b.order).find(problem => !progress[progressKey(problem.slug)]?.attemptedAt) || null;
}

export function surpriseProblem(problems, filters, progress = {}, random = Math.random, { includeCompleted = false } = {}) {
  const candidates = filterCatalog(problems, filters, progress).filter(problem => includeCompleted || !progress[progressKey(problem.slug)]?.completedAt);
  if (!candidates.length) return null;
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
}

export class TutorLocalStore {
  constructor({ storage = globalThis.localStorage, now = Date.now } = {}) {
    this.storage = storage;
    this.now = now;
    this.state = { version: 1, progress: {}, drafts: {} };
    try {
      const parsed = JSON.parse(storage.getItem(LOCAL_STATE_KEY));
      if (parsed?.version === 1 && parsed.progress && parsed.drafts) this.state = parsed;
    } catch { /* Private browsing or malformed old state starts cleanly. */ }
  }

  timestamp() { return new Date(this.now()).toISOString(); }
  progress() { return this.state.progress; }

  updateProgress(slug, update) {
    const key = progressKey(slug);
    this.state.progress[key] = { ...(this.state.progress[key] || {}), ...update };
    this.persist();
    return this.state.progress[key];
  }

  open(slug) { return this.updateProgress(slug, { lastOpenedAt:this.timestamp() }); }
  attempt(slug) {
    const current = this.state.progress[progressKey(slug)];
    return current?.attemptedAt ? current : this.updateProgress(slug, { attemptedAt:this.timestamp() });
  }
  complete(slug, completed) {
    const key = progressKey(slug);
    const value = { ...(this.state.progress[key] || {}) };
    if (completed) value.completedAt = this.timestamp();
    else delete value.completedAt;
    this.state.progress[key] = value;
    this.persist();
    return value;
  }

  draft(scope, language) {
    const record = this.state.drafts[scope];
    const code = record?.languages?.[language];
    if (typeof code !== 'string') return null;
    record.usedAt = this.now();
    this.persist();
    return code;
  }

  saveDraft(scope, language, code) {
    if (!scope || !['python', 'javascript'].includes(language) || typeof code !== 'string') return;
    const record = this.state.drafts[scope] || { languages:{}, usedAt:0 };
    record.languages[language] = code;
    record.usedAt = this.now();
    this.state.drafts[scope] = record;
    this.evictDrafts();
    this.persist();
  }

  evictDrafts() {
    const ordered = () => Object.entries(this.state.drafts).sort((a, b) => a[1].usedAt - b[1].usedAt);
    while (Object.keys(this.state.drafts).length > MAX_DRAFT_PROBLEMS || bytes(JSON.stringify(this.state.drafts)) > MAX_DRAFT_BYTES) {
      const oldest = ordered()[0];
      if (!oldest) break;
      delete this.state.drafts[oldest[0]];
    }
  }

  persist() {
    try { this.storage.setItem(LOCAL_STATE_KEY, JSON.stringify(this.state)); }
    catch { /* The editor remains usable when storage is unavailable. */ }
  }
}
