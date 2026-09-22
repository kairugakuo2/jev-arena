import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TutorScheduler, smoothPosition } from '../public/tutor/scheduler.js';

function harness() {
  let time = 0, next = 0;
  const timers = new Map(), calls = [], readings = [], statuses = [];
  const scheduler = new TutorScheduler({
    now: () => time,
    setTimer: (fn, delay) => { const id = ++next; timers.set(id, { at: time + delay, fn }); return id; },
    clearTimer: (id) => timers.delete(id),
    request: (body) => new Promise((resolve, reject) => calls.push({ body, resolve, reject, at: time })),
    onReading: (value) => readings.push(value),
    onStatus: (value) => statuses.push(value),
  });
  scheduler.reset({ problemId: 'problem', graphVersion: 'v1', language: 'python', sessionId: 'session-one' }, 'start');
  async function advance(ms) {
    await Promise.resolve(); await Promise.resolve();
    const end = time + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
      if (!due) break;
      time = due[1].at; timers.delete(due[0]); due[1].fn();
      await Promise.resolve(); await Promise.resolve();
    }
    time = end;
    await Promise.resolve(); await Promise.resolve();
  }
  async function resolve(index, hotter = 0.8) {
    const c = calls[index];
    c.resolve({ ...c.body, probabilities: { hotter, colder: 1 - hotter } });
    await advance(0);
  }
  return { scheduler, calls, readings, statuses, advance, resolve };
}

test('a pause sends an immutable snapshot, recent results still apply during newer typing', async () => {
  const h = harness();
  h.scheduler.edit('first', [{ from: 0, to: 5, insert: 'first' }]);
  await h.advance(299); assert.equal(h.calls.length, 0);
  await h.advance(1); assert.equal(h.calls.length, 1);
  h.scheduler.edit('second');
  assert.equal(h.calls[0].body.afterCode, 'first');
  await h.advance(400); await h.resolve(0);
  assert.equal(h.readings.length, 1);
  await h.advance(350);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].body.beforeCode, 'first');
  assert.equal(h.calls[1].body.afterCode, 'second');
  assert.ok(h.calls[1].at - h.calls[0].at >= 750);
});

test('continuous typing cannot starve evaluation and only newest pending document is sent', async () => {
  const h = harness();
  h.scheduler.edit('0');
  for (let i = 1; i <= 10; i++) { await h.advance(100); h.scheduler.edit(String(i)); }
  assert.equal(h.calls.length, 1);
  for (let i = 11; i <= 30; i++) { await h.advance(100); h.scheduler.edit(String(i)); }
  assert.equal(h.calls.length, 1);
  await h.resolve(0);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].body.afterCode, '30');
  assert.ok(h.calls[1].body.recentEdits.length <= 5);
});

test('responses from old sessions and snapshots at least 2.5 seconds old never move meter', async () => {
  const h = harness();
  h.scheduler.edit('old'); await h.advance(300);
  h.scheduler.reset({ problemId: 'other', graphVersion: 'v2', language: 'javascript', sessionId: 'new' }, '');
  h.scheduler.edit('new code'); await h.advance(1000);
  assert.equal(h.calls.length, 1);
  await h.resolve(0); assert.equal(h.readings.length, 0);
  assert.equal(h.calls.length, 2);
  await h.advance(2500); await h.resolve(1);
  assert.equal(h.readings.length, 0);
});

test('network failures preserve baseline, retry with backoff, and send newest code', async () => {
  const h = harness();
  h.scheduler.edit('one'); await h.advance(300);
  h.calls[0].reject(new Error('offline')); await h.advance(0);
  h.scheduler.edit('two'); await h.advance(999);
  assert.equal(h.calls.length, 1);
  await h.advance(1); assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].body.beforeCode, 'start');
  assert.equal(h.calls[1].body.afterCode, 'two');
  await h.resolve(1);
  await h.advance(10000); assert.equal(h.calls.length, 2, 'no polling unchanged code');
});

test('missing probabilities never become a synthetic neutral reading', async () => {
  const h = harness(); h.scheduler.edit('one'); await h.advance(300);
  h.calls[0].resolve({ ...h.calls[0].body, probabilities: null }); await h.advance(0);
  assert.equal(h.readings.length, 0);
  assert.ok(h.statuses.some(s => s.state === 'unavailable'));
});

test('smoothing never overshoots, reverses immediately, and is independent of frame rate', () => {
  let x = 20, y = 20;
  for (let i = 0; i < 60; i++) { x = smoothPosition(x, 90, 1 / 60); assert.ok(x >= 20 && x <= 90); }
  for (let i = 0; i < 144; i++) y = smoothPosition(y, 90, 1 / 144);
  assert.ok(Math.abs(x-y) < 1e-9);
  assert.ok(smoothPosition(x, 5, 1 / 60) < x);
  assert.ok(Math.abs(smoothPosition(0, 100, 0.8) - 90) < 1);
});

test('default browser timer functions are never called with the scheduler as their receiver', () => {
  const original = globalThis.clearTimeout;
  globalThis.clearTimeout = function () { assert.ok(!(this instanceof TutorScheduler), 'illegal browser timer receiver'); };
  try {
    const scheduler = new TutorScheduler({ request: async () => ({}) });
    assert.doesNotThrow(() => scheduler.reset(null));
  } finally { globalThis.clearTimeout = original; }
});
