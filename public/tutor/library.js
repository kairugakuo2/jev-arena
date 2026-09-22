export const LOCAL_STATE_KEY = 'jev-tutor-library-v1';
export const MAX_DRAFT_PROBLEMS = 20;
export const MAX_DRAFT_BYTES = 2 * 1024 * 1024;

const bytes = value => new TextEncoder().encode(value).byteLength;
export function filterCatalog(problems, filters) {
  const query = (filters.query || '').trim().toLocaleLowerCase();
  return problems.filter(problem => {
    if (query && !`${problem.title} ${problem.pattern}`.toLocaleLowerCase().includes(query)) return false;
    if (filters.pattern && filters.pattern !== 'all' && problem.pattern !== filters.pattern) return false;
    if (filters.difficulty && filters.difficulty !== 'all' && problem.difficulty !== filters.difficulty) return false;
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

export function surpriseProblem(problems, filters, random = Math.random) {
  const candidates = filterCatalog(problems, filters);
  if (!candidates.length) return null;
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
}

export class TutorLocalStore {
  constructor({ storage = globalThis.localStorage, now = Date.now } = {}) {
    this.storage = storage;
    this.now = now;
    this.state = { version: 2, drafts: {} };
    try {
      const parsed = JSON.parse(storage.getItem(LOCAL_STATE_KEY));
      if ([1,2].includes(parsed?.version) && parsed.drafts && typeof parsed.drafts === 'object') {
        this.state.drafts = parsed.drafts;
        if (parsed.version === 1 || parsed.progress) this.persist();
      }
    } catch { /* Private browsing or malformed old state starts cleanly. */ }
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
