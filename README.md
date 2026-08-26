# When to Leave

A single-file web app that answers one question: **when do I leave the house to catch my
bus?**

Save a commute — the stop you walk to, the buses you take, how long the walk is, and the
time you usually go. Open the page and it shows a countdown, using live Singapore
arrival data.

You can save as many commutes as you like at different times. A morning one and an
evening one are independent; the app shows whichever is currently alerting.

**Live:** https://heywhatsupyo.github.io/bus-app/

## One file

The whole app is `index.html` — markup, styles and logic inline, no build step and no
dependencies at runtime. Publish it by copying that one file anywhere, or open it
directly from disk.

There is a caveat to opening it from disk: the app fetches bus data over HTTPS, and some
browsers refuse cross-origin requests from `file://` pages regardless of CORS headers.
If the page loads but no bus data appears, serve it instead (`npm start`) or use the
hosted link above.

## Why it's this narrow

There is no destination, no arrival target and no journey planning. Earlier versions had
all three and none earned its place: door-to-door routing needs OneMap, whose token
can't be embedded safely in a static page and expires every three days — which would
mean running a server.

Getting to the stop on time is the part that actually needs live data, and the part you
can't eyeball from a timetable. So that's all this does.

## Development

```bash
npm install
npm start          # http://localhost:8000
npm test           # 39 tests
npm run lint
```

### How the tests reach the code

The logic lives inline in `index.html`, so `test/load-app.js` extracts the inline
`<script type="module">`, evaluates it as a data URL in Node, and reads the functions the
page exposes on `globalThis.LeaveNow`. That keeps `index.html` the single source of
truth — no build step and no duplicated copy of the logic to drift out of sync.

Trade-off of going single-file: `tsc --noEmit` type-checking is gone, since there are no
longer any `.js` files for it to read. The tests are the remaining safety net, which is
why they cover the awkward cases — timezone independence, buses too soon to walk to,
duplicate arrival entries, and rolling to the next active day.

## How the decision is made

1. Has this commute's alert time arrived? Alerts begin **at** the time you set and run
   for 90 minutes. Before then the app stays quiet — which bus you catch depends on
   live arrivals, so there is genuinely nothing to say yet.
2. Among the buses you'd board, drop any arriving sooner than your walk takes — you
   can't reach them.
3. Take the soonest one you can still make.
4. Leave time = that bus, minus the walk, minus your buffer.

Four statuses: `LEAVE_NOW`, `LEAVE_AT`, `NO_SERVICE`, and `SCHEDULED` (before the window
opens, where the card shows when alerts start and nothing more).

### What "start alerting me at" means

It is **not** a target boarding time — the app never promises to put you on a bus at that
moment. It is when the app starts watching. Set 08:00 and from 08:00 it shows the next
bus you can actually catch, whatever time that turns out to be, for 90 minutes.

Deliberately, no leave time is shown before the window opens. An earlier version
displayed one, computed as the alert time minus your walk, which quietly implied you
board at exactly that time — two different meanings for one field depending on when you
looked.

## Alerts

The page shows a countdown whenever it's open. "Enable alerts" additionally grants system
notifications, so a `LEAVE_NOW` surfaces outside the tab — but only while the page is
open. There is no backend and no service worker, so nothing fires when it's closed.

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
