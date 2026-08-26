# Leave Now

A single-page app that answers one question: **when do I leave the house to catch my
bus?**

Save a commute — the stop you walk to, the buses you take, how long the walk is, and the
time you usually go. Open the page and it shows a countdown, using live Singapore
arrival data.

You can save as many commutes as you like at different times. A morning one and an
evening one are independent; the app shows whichever is closest to its time.

## Why it's this narrow

There is no destination, no arrival target and no journey planning. Earlier versions had
all three, and none of it earned its place: door-to-door routing needs OneMap, whose
token can't be embedded safely in a static page and expires every three days — which
would mean running a server.

Getting to the stop on time is the part that actually needs live data, and the part you
can't eyeball from a timetable. So that's all this does.

## Requirements

Node.js 20 or newer, and Python 3 for the local server. **Node 20.19+ is recommended** —
20.11 and below cannot run current ESLint or Vitest (see Known constraints).

## Running it

```bash
npm install
npm start          # http://localhost:8000
```

ES modules are blocked over `file://`, so the page has to be served rather than opened
from disk.

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Serve the site on port 8000 |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` — type-checks the JS via `checkJs` + JSDoc |
| `npm test` | Vitest, once |
| `npm run test:watch` | Vitest in watch mode |

No build step. `index.html` loads `src/*.js` directly.

## How the decision is made

`src/planner.js` holds the whole algorithm and is pure — no I/O, no DOM, no clock reads:

1. Is this commute near its usual time? Live buses only matter from 45 minutes before
   until 60 minutes after. Outside that, the next bus at the stop is not the bus you
   are catching.
2. Among the buses you'd board, drop any arriving sooner than your walk takes — you
   can't reach them.
3. Take the soonest one you can still make.
4. Leave time = that bus, minus the walk, minus your buffer.

Four statuses: `LEAVE_NOW`, `LEAVE_AT`, `NO_SERVICE`, and `SCHEDULED` (outside the
window, where the answer is arithmetic rather than live data).

## Alerts

The page shows the countdown whenever it is open. "Enable alerts" additionally grants
system notifications, so a `LEAVE_NOW` surfaces outside the tab — but only while the
page is open. There is no backend and no service worker, so nothing fires when the page
is closed.

## Data sources

| Source | Used for |
| --- | --- |
| [`data.busrouter.sg`](https://data.busrouter.sg) | stop coordinates and which buses call where |
| [`arrivelah2.busrouter.sg`](https://arrivelah2.busrouter.sg) | live arrival estimates |

Both are community projects by [cheeaun](https://github.com/cheeaun), served with open
CORS. Arrivals are cached for 15 seconds, requested only for commutes inside their active
window, and refetched on load or when you return to the tab — never in a poll loop.

## Known constraints

- **Estimates are often timetable-derived, not GPS.** Responses carry a `monitored`
  flag; every card shows "Live tracking" or "Timetable estimate" so you can judge it.
- **Only about three buses ahead are visible** per service.
- **Node 20.11 and below** can't run ESLint 10 or Vitest 4 (both need `util.styleText`,
  added in Node 20.19). ESLint is pinned to 9 and Vitest to 3 for that reason.

## Privacy

Commutes live in `localStorage` in your browser. Nothing is uploaded; there is no
backend and no account.
