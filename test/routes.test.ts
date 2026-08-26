import { describe, expect, it } from 'vitest';
import { findRoute, stopNames, type Route } from '../src/routes.js';

const routes: Route[] = [
  { id: '96', name: 'Jurong East - Bedok', stops: [{ id: '28009', name: 'Jurong East Int' }] },
  { id: '174', name: 'Boon Lay - Bukit Merah', stops: [] },
];

describe('findRoute', () => {
  it('returns the route with a matching id', () => {
    expect(findRoute(routes, '174')?.name).toBe('Boon Lay - Bukit Merah');
  });

  it('returns undefined when nothing matches', () => {
    expect(findRoute(routes, 'nope')).toBeUndefined();
  });
});

describe('stopNames', () => {
  it('lists stop names in order', () => {
    expect(stopNames(routes[0]!)).toEqual(['Jurong East Int']);
  });

  it('returns an empty array for a route with no stops', () => {
    expect(stopNames(routes[1]!)).toEqual([]);
  });
});
