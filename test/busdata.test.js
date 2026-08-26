import { describe, expect, it } from 'vitest';
import { loadApp } from './load-app.js';
import servicesFixture from './fixtures/services.json' with { type: 'json' };
import stopsFixture from './fixtures/stops.json' with { type: 'json' };
import arrivalsFixture from './fixtures/arrivals-28009.json' with { type: 'json' };

const {
  distanceMetres,
  nearestStops,
  parseStops,
  searchStops,
  servicesAtStop,
  flattenService,
  normaliseArrivals,
} = await loadApp();

describe('parseStops', () => {
  it('reads lng before lat, as stops.json stores them', () => {
    const stops = parseStops({ '28009': [103.7422, 1.3331, 'Jurong East Int', 'Jurong Gateway Rd'] });
    const stop = stops.get('28009');
    expect(stop.lat).toBeCloseTo(1.3331, 4);
    expect(stop.lng).toBeCloseTo(103.7422, 4);
    expect(stop.name).toBe('Jurong East Int');
  });

  it('parses every stop in the fixture', () => {
    expect(parseStops(stopsFixture).size).toBe(Object.keys(stopsFixture).length);
  });
});

describe('servicesAtStop', () => {
  it('finds every service calling at a stop, in either direction', () => {
    // 143 serves 28009 as the last stop of one direction and the first of the other.
    const found = servicesAtStop(servicesFixture, '28009').map((s) => s.service);
    expect(found).toContain('143');
  });

  it('returns nothing for an unknown stop', () => {
    expect(servicesAtStop(servicesFixture, '00000')).toEqual([]);
  });

  it('sorts service numbers naturally, not as strings', () => {
    const found = servicesAtStop(
      { 9: { name: 'a', routes: [['X']] }, 100: { name: 'b', routes: [['X']] }, 51: { name: 'c', routes: [['X']] } },
      'X',
    ).map((s) => s.service);
    expect(found).toEqual(['9', '51', '100']);
  });

  it('carries the human route name through', () => {
    const [first] = servicesAtStop({ 143: servicesFixture['143'] }, '28009');
    expect(first.name).toBe(servicesFixture['143'].name);
  });

  it('does not double-count a service that serves the stop twice', () => {
    const found = servicesAtStop({ 143: servicesFixture['143'] }, '28009');
    expect(found).toHaveLength(1);
  });
});

describe('searchStops', () => {
  const stops = parseStops(stopsFixture);

  it('ignores queries shorter than two characters', () => {
    expect(searchStops(stops, 'a')).toEqual([]);
  });

  it('finds stops by name, preferring prefix matches', () => {
    const results = searchStops(stops, 'jurong');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name.toLowerCase().startsWith('jurong')).toBe(true);
  });

  it('matches an exact stop code first', () => {
    expect(searchStops(stops, '28009')[0].code).toBe('28009');
  });

  it('respects the result limit', () => {
    expect(searchStops(stops, 'rd', 5).length).toBeLessThanOrEqual(5);
  });
});

describe('distanceMetres / nearestStops', () => {
  it('measures a known short hop plausibly', () => {
    const d = distanceMetres({ lat: 1.3331, lng: 103.7422 }, { lat: 1.3341, lng: 103.7422 });
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(130);
  });

  it('orders stops by increasing distance', () => {
    const near = nearestStops(parseStops(stopsFixture), { lat: 1.3331, lng: 103.7422 }, 5);
    const distances = near.map((s) => s.distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });
});

describe('arrivals normalisation', () => {
  it('dedupes subsequent when it repeats next2', () => {
    const service = {
      no: '143',
      next: { duration_ms: 60_000, monitored: 0 },
      next2: { duration_ms: 600_000, monitored: 0 },
      next3: null,
      subsequent: { duration_ms: 600_000, monitored: 0 },
    };
    expect(flattenService(service).map((a) => a.durationMs)).toEqual([60_000, 600_000]);
  });

  it('tolerates null entries', () => {
    expect(flattenService({ no: '9', next: null, next2: null, next3: null })).toEqual([]);
  });

  it('drops buses that have already passed', () => {
    const out = flattenService({ no: '9', next: { duration_ms: -30_000 }, next2: { duration_ms: 120_000 } });
    expect(out.map((a) => a.durationMs)).toEqual([120_000]);
  });

  it('maps monitored=1 to a live arrival', () => {
    const [live] = flattenService({ no: '9', next: { duration_ms: 1000, monitored: 1 } });
    expect(live.monitored).toBe(true);
  });

  it('flattens and sorts a real captured response', () => {
    const arrivals = normaliseArrivals(arrivalsFixture);
    expect(arrivals.length).toBeGreaterThan(10);
    const durations = arrivals.map((a) => a.durationMs);
    expect(durations).toEqual([...durations].sort((a, b) => a - b));
    expect(arrivals.every((a) => typeof a.service === 'string')).toBe(true);
  });

  it('handles a malformed payload without throwing', () => {
    expect(normaliseArrivals({})).toEqual([]);
    expect(normaliseArrivals(null)).toEqual([]);
  });
});
