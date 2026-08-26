/**
 * arrivelah2 client.
 *
 * We keep `duration_ms` (server-relative) rather than the absolute `time` field,
 * so a wrong clock on the user's device cannot skew "arriving in N minutes".
 */

const ARRIVALS_URL = 'https://arrivelah2.busrouter.sg/';

/** Upstream caches for 15s; don't hammer a free community API. */
const CACHE_TTL_MS = 15_000;

/** @type {Map<string, {at: number, arrivals: import('./planner.js').Arrival[]}>} */
const cache = new Map();

/**
 * Flatten one service entry into individual arrivals.
 * `next`/`next2`/`next3` are each nullable, and `subsequent` is observed to
 * duplicate `next2` in live responses, so results are deduped by arrival time.
 * @param {any} service
 * @returns {import('./planner.js').Arrival[]}
 */
export function flattenService(service) {
  const seen = new Set();
  /** @type {import('./planner.js').Arrival[]} */
  const out = [];

  for (const key of ['next', 'next2', 'next3', 'subsequent']) {
    const entry = service[key];
    if (!entry || typeof entry.duration_ms !== 'number') continue;
    // Buses already past the stop report a negative duration; ignore them.
    if (entry.duration_ms < 0) continue;
    if (seen.has(entry.duration_ms)) continue;
    seen.add(entry.duration_ms);
    out.push({
      service: String(service.no),
      durationMs: entry.duration_ms,
      monitored: entry.monitored === 1,
      load: entry.load,
      type: entry.type,
    });
  }
  return out;
}

/**
 * Normalise a full arrivelah2 response into a flat, sorted arrival list.
 * @param {any} payload
 * @returns {import('./planner.js').Arrival[]}
 */
export function normaliseArrivals(payload) {
  /** @type {any[]} */
  const services = Array.isArray(payload?.services) ? payload.services : [];
  return services
    .flatMap(flattenService)
    .sort((/** @type {import('./planner.js').Arrival} */ a, /** @type {import('./planner.js').Arrival} */ b) =>
      a.durationMs - b.durationMs);
}

/**
 * Fetch arrivals for a stop, with a short cache.
 * @param {string} stopCode
 * @param {{now?: number, fetchImpl?: typeof fetch}} [options]
 */
export async function fetchArrivals(stopCode, options = {}) {
  const now = options.now ?? Date.now();
  const doFetch = options.fetchImpl ?? fetch;

  const hit = cache.get(stopCode);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.arrivals;

  const response = await doFetch(`${ARRIVALS_URL}?id=${encodeURIComponent(stopCode)}`);
  if (!response.ok) {
    throw new Error(`Arrivals request failed for stop ${stopCode} (${response.status})`);
  }
  const arrivals = normaliseArrivals(await response.json());
  cache.set(stopCode, { at: now, arrivals });
  return arrivals;
}

export function clearArrivalsCache() {
  cache.clear();
}
