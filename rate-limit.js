// Demo rate limits for the paid Gateway calls. Three layers per bucket:
//   visitor: a random id each browser keeps (fair share for people on one Wi-Fi)
//   ip:      a looser cap so rotating visitor ids from one network still stops
//   daily:   one global cap per UTC day that bounds total cost
// All counts live in memory; a restart resets them, which is fine for a demo.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const DEFAULT_LIMITS = {
  arena: { visitor: 600, ip: 3000, daily: 8000 },
  evaluate: { visitor: 600, ip: 3000, daily: 8000 },
  prepare: { visitor: 15, ip: 60, daily: 150 },
};

const LABELS = { arena: 'Jev moves', evaluate: 'Navigator readings', prepare: 'new problem setups' };
const VISITOR_ID = /^[a-f0-9-]{16,64}$/i;

// Env overrides such as RATE_ARENA_VISITOR=100 or RATE_PREPARE_DAILY=50.
export function limitsFromEnv(env = process.env) {
  const limits = structuredClone(DEFAULT_LIMITS);
  for (const [bucket, scopes] of Object.entries(limits)) {
    for (const scope of Object.keys(scopes)) {
      const value = Number(env[`RATE_${bucket.toUpperCase()}_${scope.toUpperCase()}`]);
      if (Number.isInteger(value) && value >= 0) scopes[scope] = value;
    }
  }
  return limits;
}

// Who is asking. Behind a proxy (TRUST_PROXY=1) the first X-Forwarded-For entry
// is the client as the proxy saw it; otherwise use the socket address.
export function clientIdentity(req, { trustProxy = false } = {}) {
  const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  const ip = forwarded || req.socket?.remoteAddress || 'unknown';
  const header = String(req.headers['x-jev-visitor'] || '');
  const visitor = VISITOR_ID.test(header) ? header.toLowerCase() : `ip:${ip}`;
  return { ip, visitor };
}

export class RateLimiter {
  constructor({ limits = DEFAULT_LIMITS, now = Date.now } = {}) {
    Object.assign(this, { limits, now });
    this.windows = new Map();
    this.sweptAt = now();
  }

  // Each layer is a fixed window: hourly for visitor/ip, UTC day for the global cap.
  windowsFor(bucket, identity) {
    const time = this.now();
    return [
      { scope: 'visitor', key: `${bucket}|v|${identity.visitor}`, limit: this.limits[bucket].visitor, start: null, span: HOUR },
      { scope: 'ip', key: `${bucket}|i|${identity.ip}`, limit: this.limits[bucket].ip, start: null, span: HOUR },
      { scope: 'daily', key: `${bucket}|d`, limit: this.limits[bucket].daily, start: Math.floor(time / DAY) * DAY, span: DAY },
    ].map(layer => {
      const saved = this.windows.get(layer.key);
      const start = layer.start ?? (saved && time < saved.start + layer.span ? saved.start : time);
      const count = saved && saved.start === start ? saved.count : 0;
      return { ...layer, start, count };
    });
  }

  check(bucket, identity) {
    const time = this.now();
    for (const layer of this.windowsFor(bucket, identity)) {
      if (layer.count >= layer.limit) {
        return { ok: false, bucket, scope: layer.scope, retryAfter: Math.max(1, Math.ceil((layer.start + layer.span - time) / 1000)) };
      }
    }
    return { ok: true, bucket };
  }

  // Counts one call if every layer has room. A refused call is not counted.
  take(bucket, identity) {
    const result = this.check(bucket, identity);
    if (!result.ok) return result;
    for (const layer of this.windowsFor(bucket, identity)) this.windows.set(layer.key, { start: layer.start, count: layer.count + 1 });
    this.sweep();
    return result;
  }

  // Drop expired windows now and then so memory stays bounded.
  sweep() {
    const time = this.now();
    if (time - this.sweptAt < 60 * 1000 && this.windows.size < 50000) return;
    this.sweptAt = time;
    for (const [key, saved] of this.windows) {
      if (time >= saved.start + (key.endsWith('|d') ? DAY : HOUR)) this.windows.delete(key);
    }
  }
}

export function limitMessage({ bucket, scope, retryAfter }) {
  const label = LABELS[bucket] || 'AI requests';
  if (scope === 'daily') return `This demo has used up today's ${label}. Try again tomorrow, or run Jev Lab locally with your own key.`;
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return `You've hit this demo's hourly limit for ${label}. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

export function sendLimited(res, result) {
  res.writeHead(429, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': String(result.retryAfter) });
  res.end(JSON.stringify({ error: limitMessage(result), limited: true, retryAfter: result.retryAfter }));
}
