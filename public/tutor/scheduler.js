export function smoothPosition(current, target, seconds) {
  return current + (target - current) * (1 - Math.exp(-Math.max(0, seconds) / 0.35));
}

export function validProbabilities(p) {
  return p && [p.hotter, p.colder].every(n => Number.isFinite(n) && n >= 0 && n <= 1)
    && Math.abs(p.hotter + p.colder - 1) <= 0.02;
}

// The editor, request clock, and animation clock never own each other's state.
export class TutorScheduler {
  constructor({ request, onReading = () => {}, onStatus = () => {}, onMetrics = () => {},
    now = () => performance.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
    Object.assign(this, { request, onReading, onStatus, onMetrics, now, setTimer, clearTimer });
    this.generation = 0;
    this.inFlight = false;
    this.lastStart = -Infinity;
    this.paused = false;
  }

  reset(context, initialCode = '') {
    this.clearTimer(this.timer);
    this.generation++;
    this.context = context;
    this.baseline = { revision: 0, code: initialCode };
    this.latest = { revision: 0, code: initialCode };
    this.edits = [];
    this.firstPending = null;
    this.lastEdit = this.now();
    this.lastDisplayed = 0;
    this.failures = 0;
    this.retryAfter = 0;
    this.onStatus({ state: context ? 'ready' : 'inactive' });
  }

  edit(code, changes = []) {
    if (!this.context || code === this.latest.code) return;
    const beforeRevision = this.latest.revision;
    this.latest = { revision: beforeRevision + 1, code };
    this.lastEdit = this.now();
    this.firstPending ??= this.lastEdit;
    this.edits.push({ beforeRevision, afterRevision: this.latest.revision, changes });
    this.edits = this.edits.slice(-5);
    this.status('updating');
    this.schedule();
  }

  status(state, extra = {}) {
    this.onStatus({ state, revision: this.latest.revision, evaluatedRevision: this.baseline.revision, ...extra });
  }

  setPaused(paused) {
    this.paused = paused;
    this.clearTimer(this.timer);
    if (!paused) this.schedule();
  }

  schedule() {
    this.clearTimer(this.timer);
    if (!this.context || this.paused || this.inFlight || this.firstPending === null) return;
    const due = Math.max(Math.min(this.lastEdit + 300, this.firstPending + 1000), this.lastStart + 750, this.retryAfter);
    this.timer = this.setTimer(() => this.send(), Math.max(0, due - this.now()));
  }

  async send() {
    if (this.inFlight || this.paused || !this.context || this.firstPending === null) return;
    const epoch = this.generation;
    const snapshot = { ...this.latest };
    const sentAt = this.now(), editedAt = this.lastEdit;
    const body = structuredClone({ ...this.context, baselineRevision: this.baseline.revision,
      currentRevision: snapshot.revision, beforeCode: this.baseline.code, afterCode: snapshot.code,
      recentEdits: this.edits.filter(e => e.afterRevision > this.baseline.revision) });
    this.inFlight = true;
    this.lastStart = sentAt;
    this.firstPending = null;
    this.status('analyzing');
    try {
      const result = await this.request(body);
      if (epoch !== this.generation) return;
      if (['sessionId', 'problemId', 'graphVersion', 'language', 'currentRevision', 'baselineRevision']
        .some(key => result[key] !== body[key])) throw new Error('Mismatched evaluation response.');
      if (!validProbabilities(result.probabilities)) throw new Error('Probabilities unavailable.');
      this.baseline = snapshot;
      this.failures = 0;
      this.retryAfter = 0;
      const latencyMs = this.now() - sentAt;
      this.onMetrics({ latencyMs, editToResultMs: this.now() - editedAt, revision: snapshot.revision });
      if (latencyMs < 2500 && snapshot.revision > this.lastDisplayed) {
        this.lastDisplayed = snapshot.revision;
        this.onReading({ ...result, latencyMs, editToResultMs: this.now() - editedAt });
        this.status(this.latest.revision > snapshot.revision ? 'updating' : 'watching');
      } else this.status('delayed');
    } catch (error) {
      if (epoch !== this.generation) return;
      this.failures++;
      this.retryAfter = this.now() + Math.min(8000, 1000 * 2 ** (this.failures - 1));
      this.firstPending ??= this.now();
      this.status('unavailable', { message: error.message });
    } finally {
      this.inFlight = false;
      this.schedule();
    }
  }

  dispose() {
    this.reset(null);
    this.paused = true;
  }
}
