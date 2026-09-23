import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, clientIdentity, limitsFromEnv, limitMessage, DEFAULT_LIMITS } from '../rate-limit.js';

const limits = { arena: { visitor: 2, ip: 3, daily: 5 }, evaluate: { visitor: 1, ip: 1, daily: 1 }, prepare: { visitor: 1, ip: 1, daily: 1 } };
const id = (visitor, ip = '1.1.1.1') => ({ visitor, ip });

test('per-visitor limit refuses without counting, then resets after an hour', () => {
  let time = Date.parse('2026-09-22T10:00:00Z');
  const limiter = new RateLimiter({ limits, now: () => time });
  assert.equal(limiter.take('arena', id('a')).ok, true);
  assert.equal(limiter.take('arena', id('a')).ok, true);
  const refused = limiter.take('arena', id('a'));
  assert.deepEqual([refused.ok, refused.scope], [false, 'visitor']);
  assert.ok(refused.retryAfter > 3500 && refused.retryAfter <= 3600);
  time += 60 * 60 * 1000;
  assert.equal(limiter.take('arena', id('a')).ok, true);
});

test('shared IP gets a looser cap and the daily cap covers everyone', () => {
  let time = Date.parse('2026-09-22T10:00:00Z');
  const limiter = new RateLimiter({ limits, now: () => time });
  // Three visitors on one network: the IP layer stops the fourth call.
  assert.equal(limiter.take('arena', id('a')).ok, true);
  assert.equal(limiter.take('arena', id('b')).ok, true);
  assert.equal(limiter.take('arena', id('c')).ok, true);
  assert.equal(limiter.take('arena', id('d')).scope, 'ip');
  // Other networks share the global daily cap of 5.
  assert.equal(limiter.take('arena', id('e', '2.2.2.2')).ok, true);
  assert.equal(limiter.take('arena', id('f', '3.3.3.3')).ok, true);
  const daily = limiter.take('arena', id('g', '4.4.4.4'));
  assert.equal(daily.scope, 'daily');
  assert.match(limitMessage(daily), /today's Jev moves/);
  // Buckets are independent, and the day resets at UTC midnight.
  assert.equal(limiter.take('evaluate', id('a')).ok, true);
  time = Date.parse('2026-09-23T00:00:01Z');
  assert.equal(limiter.take('arena', id('g', '4.4.4.4')).ok, true);
});

test('expired windows are swept so memory stays bounded', () => {
  let time = Date.parse('2026-09-22T10:00:00Z');
  const limiter = new RateLimiter({ limits: DEFAULT_LIMITS, now: () => time });
  for (let i = 0; i < 50; i++) limiter.take('arena', id(`visitor-${i}`, `10.0.0.${i}`));
  assert.ok(limiter.windows.size > 100);
  time += 25 * 60 * 60 * 1000;
  limiter.take('arena', id('late'));
  assert.equal(limiter.windows.size, 3);
});

test('client identity trusts X-Forwarded-For only behind a proxy and validates visitor ids', () => {
  const visitor = '3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c';
  const req = { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'x-jev-visitor': visitor }, socket: { remoteAddress: '10.0.0.1' } };
  assert.deepEqual(clientIdentity(req, { trustProxy: true }), { ip: '203.0.113.9', visitor });
  assert.equal(clientIdentity(req).ip, '10.0.0.1');
  const bogus = { headers: { 'x-jev-visitor': '<script>' }, socket: { remoteAddress: '10.0.0.2' } };
  assert.equal(clientIdentity(bogus).visitor, 'ip:10.0.0.2');
});

test('limits can be tuned from the environment', () => {
  const tuned = limitsFromEnv({ RATE_ARENA_VISITOR: '50', RATE_PREPARE_DAILY: '0', RATE_EVALUATE_IP: 'lots' });
  assert.equal(tuned.arena.visitor, 50);
  assert.equal(tuned.prepare.daily, 0);
  assert.equal(tuned.evaluate.ip, DEFAULT_LIMITS.evaluate.ip);
  assert.match(limitMessage({ bucket: 'evaluate', scope: 'visitor', retryAfter: 61 }), /2 minutes/);
});
