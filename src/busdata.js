/**
 * Static bus data from data.busrouter.sg (stops and route sequences).
 * Both files are immutable day-to-day and served with a 24h cache header.
 */

const BASE_URL = 'https://data.busrouter.sg/v1';

/**
 * @typedef {object} Stop
 * @property {string} code
 * @property {number} lat
 * @property {number} lng
 * @property {string} name
 * @property {string} road
 */

/**
 * stops.json stores each stop as [lng, lat, name, road] — note lng comes first.
 * @param {Record<string, [number, number, string, string]>} raw
 * @returns {Map<string, Stop>}
 */
export function parseStops(raw) {
  const stops = new Map();
  for (const [code, value] of Object.entries(raw)) {
    const [lng, lat, name, road] = value;
    stops.set(code, { code, lat, lng, name, road });
  }
  return stops;
}

/**
 * Find every service that calls at `boardStop` and later at `alightStop` within
 * the same direction. Direction matters: a service may serve both stops but only
 * in the wrong order.
 *
 * @param {Record<string, {name: string, routes: string[][]}>} services
 * @param {string} boardStop
 * @param {string} alightStop
 * @returns {{service: string, direction: number, stopsBetween: number}[]}
 */
export function findServicesBetween(services, boardStop, alightStop) {
  if (boardStop === alightStop) return [];
  /** @type {{service: string, direction: number, stopsBetween: number}[]} */
  const matches = [];

  for (const [no, definition] of Object.entries(services)) {
    const routes = definition.routes ?? [];
    for (let direction = 0; direction < routes.length; direction += 1) {
      const sequence = routes[direction];
      const from = sequence.indexOf(boardStop);
      if (from === -1) continue;
      // Search after the boarding index so the direction of travel is respected.
      const to = sequence.indexOf(alightStop, from + 1);
      if (to === -1) continue;
      matches.push({ service: no, direction, stopsBetween: to - from });
      break; // one direction per service is enough
    }
  }

  return matches.sort(
    (a, b) => a.stopsBetween - b.stopsBetween || a.service.localeCompare(b.service),
  );
}

/**
 * Rank stops by how well they match a free-text query (name or road).
 * @param {Map<string, Stop>} stops
 * @param {string} query
 * @param {number} [limit]
 * @returns {Stop[]}
 */
export function searchStops(stops, query, limit = 20) {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  /** @type {{stop: Stop, score: number}[]} */
  const scored = [];
  for (const stop of stops.values()) {
    const name = stop.name.toLowerCase();
    const road = stop.road.toLowerCase();
    let score = -1;
    if (stop.code === needle) score = 0;
    else if (name.startsWith(needle)) score = 1;
    else if (name.includes(needle)) score = 2;
    else if (road.startsWith(needle)) score = 3;
    else if (road.includes(needle)) score = 4;
    if (score >= 0) scored.push({ stop, score });
  }

  scored.sort((a, b) => a.score - b.score || a.stop.name.localeCompare(b.stop.name));
  return scored.slice(0, limit).map((entry) => entry.stop);
}

/**
 * Straight-line distance in metres. Good enough for ordering nearby stops.
 * @param {{lat: number, lng: number}} a
 * @param {{lat: number, lng: number}} b
 */
export function distanceMetres(a, b) {
  const R = 6_371_000;
  /** @param {number} deg */
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Stops nearest to a coordinate.
 * @param {Map<string, Stop>} stops
 * @param {{lat: number, lng: number}} origin
 * @param {number} [limit]
 */
export function nearestStops(stops, origin, limit = 10) {
  return [...stops.values()]
    .map((stop) => ({ ...stop, distance: Math.round(distanceMetres(origin, stop)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

/**
 * @typedef {{stops: Map<string, Stop>, services: Record<string, {name: string, routes: string[][]}>}} BusData
 */

/** @type {Promise<BusData>|null} */
let staticDataPromise = null;

/**
 * Load stops and services, caching the parsed result in memory.
 * @param {{fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<BusData>}
 */
export function loadBusData(options = {}) {
  if (staticDataPromise) return staticDataPromise;
  const doFetch = options.fetchImpl ?? fetch;

  staticDataPromise = (async () => {
    const [stopsRes, servicesRes] = await Promise.all([
      doFetch(`${BASE_URL}/stops.json`),
      doFetch(`${BASE_URL}/services.json`),
    ]);
    if (!stopsRes.ok || !servicesRes.ok) {
      throw new Error('Could not load bus data from data.busrouter.sg');
    }
    const [stopsRaw, services] = await Promise.all([stopsRes.json(), servicesRes.json()]);
    return { stops: parseStops(stopsRaw), services };
  })().catch((error) => {
    staticDataPromise = null; // allow a retry
    throw error;
  });

  return staticDataPromise;
}
