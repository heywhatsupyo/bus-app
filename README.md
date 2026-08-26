# When to Leave

A single-page app that tells you **what time to leave the house** to catch your bus and
arrive somewhere on time, using live Singapore bus arrival data.

You set up a commute once — boarding stop, alighting stop, how long the ride takes —
and every time you open the page it works backwards from your target arrival time and
tells you when to walk out the door.

## Why it works this way

There is no address search and no transfer planning. That is deliberate: full
door-to-door routing needs OneMap's API, whose token can't be embedded safely in a
static page and expires every three days, which would mean running a server.

For a *daily commute* you already know your route and how long the ride takes — better
than any API can estimate. So you supply those once, and the app does the part that
genuinely needs live data: deciding which bus to catch and when to leave.

## Requirements

Node.js 20 or newer, and Python 3 for the local server. **Node 20.19+ is recommended** —
20.11 and below cannot run current ESLint or Vitest 4 (see Known constraints).

## Running it

```bash
npm install
npm start          # serves on http://localhost:8000
```

ES modules are blocked over `file://`, so the page must be served rather than opened
directly from disk.

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Serve the site on port 8000 |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` — type-checks the JS via `checkJs` + JSDoc |
| `npm test` | Vitest, once |
| `npm run test:watch` | Vitest in watch mode |

There is no build step. `index.html` loads `src/*.js` directly.

## How the decision is made

`src/planner.js` is pure, I/O-free, and carries the whole algorithm:

1. Resolve the next occurrence of your target arrival time, skipping inactive days.
2. For each live arrival, compute when that bus would get you to your destination.
3. Discard buses you couldn't physically reach in your walking time.
4. Among those arriving on time, take the **latest** — so you leave as late as is safe.
5. Subtract walking time and your safety buffer to get the leave time.

It returns one of five statuses: `LEAVE_NOW`, `LEAVE_AT`, `TOO_LATE`, `NO_SERVICE`, or
`SCHEDULED` (for a trip on a later day, where live arrivals can't help).

## Data sources

| Source | Used for |
| --- | --- |
| [`data.busrouter.sg`](https://data.busrouter.sg) | stop coordinates and per-service stop sequences |
| [`arrivelah2.busrouter.sg`](https://arrivelah2.busrouter.sg) | live arrival estimates |

Both are community projects by [cheeaun](https://github.com/cheeaun), served with open
CORS. The app caches arrivals for 15 seconds and never polls in a loop — it refetches on
load and when you return to the tab.

## Known constraints

- **Arrival estimates are often timetable-derived, not GPS.** Responses carry a
  `monitored` flag; every result shows a "live GPS" or "scheduled estimate" badge so you
  can judge how much to trust it.
- **Only about three buses ahead are visible.** With a target hours away, the app can
  only recommend the latest bus the API currently knows about.
- **One bus, no transfers.** If no single service links your two stops in the right
  direction, the app says so rather than guessing.
- **Node 20.11 and below** can't run ESLint 10 or Vitest 4 (both need `util.styleText`,
  added in Node 20.19). ESLint is pinned to 9 and Vitest to 3 for this reason.

## Privacy

Commutes are stored in `localStorage` in your own browser. Nothing is uploaded, and
there is no backend or account.
