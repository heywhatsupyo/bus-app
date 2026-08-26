/**
 * DOM rendering. Kept separate from planner.js so the decision logic stays
 * testable without a browser.
 */

import { formatHHMM, sgtParts } from './time.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Short label for each status, shown as a pill on the card.
 * @type {Record<import('./planner.js').DepartureStatus, string>}
 */
const STATUS_PILL = {
  LEAVE_NOW: 'Go now',
  LEAVE_AT: 'Upcoming',
  NO_SERVICE: 'No bus',
  SCHEDULED: 'Later',
};

/**
 * @param {number} minutes
 * @returns {string}
 */
function describeMinutes(minutes) {
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * "Tomorrow 08:00", "Saturday 09:30", or just "08:00" for later today.
 * @param {number} ts
 * @param {number} now
 */
function describeWhen(ts, now) {
  const a = sgtParts(now);
  const b = sgtParts(ts);
  if (a.day === b.day && a.month === b.month) return formatHHMM(ts);
  const oneDay = 24 * 60 * 60 * 1000;
  if (ts - now < oneDay * 1.5) return `Tomorrow ${formatHHMM(ts)}`;
  return `${DAY_NAMES[b.weekday]} ${formatHHMM(ts)}`;
}

/** @param {string} tag @param {string} [className] @param {string} [text] */
function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Render one commute card.
 *
 * @param {object} params
 * @param {import('./planner.js').Commute} params.commute
 * @param {import('./planner.js').Decision} params.decision
 * @param {number} params.now
 * @param {{name: string, road: string}} [params.boardStopInfo]
 * @returns {HTMLElement}
 */
export function renderDecision({ commute, decision, now, boardStopInfo }) {
  const card = make('article', `card card--${decision.status.toLowerCase()}`);

  /* --- header --- */
  const head = make('header', 'card__head');
  head.append(make('h3', 'card__title', commute.label));
  head.append(make('span', 'pill', STATUS_PILL[decision.status]));
  card.append(head);

  /* --- the number you actually read --- */
  const hero = make('div', 'hero');

  if (decision.status === 'LEAVE_NOW') {
    hero.append(make('span', 'hero__now', 'Leave now'));
  } else if (decision.status === 'NO_SERVICE') {
    hero.append(make('span', 'hero__none', 'No bus'));
  } else if (decision.minutesUntilLeave !== null) {
    const value = make('span', 'hero__value');
    value.dataset.leaveAt = String(decision.leaveAt ?? '');
    value.textContent = describeMinutes(decision.minutesUntilLeave);
    hero.append(value);
    hero.append(make('span', 'hero__caption', `Leave at ${decision.leaveAtLabel}`));
  }
  card.append(hero);

  /* --- supporting detail --- */
  const stopName = boardStopInfo?.name ?? commute.boardStop;

  if (decision.bus) {
    const line = make('p', 'detail');
    line.append(make('strong', 'route', decision.bus.service));
    line.append(
      document.createTextNode(
        ` reaches ${stopName} at ${formatHHMM(decision.bus.busAtStop)}`,
      ),
    );
    card.append(line);

    const badge = make(
      'span',
      `badge badge--${decision.bus.monitored ? 'live' : 'sched'}`,
      decision.bus.monitored ? 'Live tracking' : 'Timetable estimate',
    );
    badge.title = decision.bus.monitored
      ? 'Backed by a live vehicle position'
      : 'Operator timetable estimate, not a tracked bus';
    card.append(badge);
  } else if (decision.status === 'NO_SERVICE') {
    card.append(
      make(
        'p',
        'detail',
        `Nothing you can still reach at ${stopName}. Buses within ${commute.walkToStopMin} min are too soon to walk to.`,
      ),
    );
  } else if (decision.status === 'SCHEDULED' && decision.nextRunTs) {
    card.append(
      make(
        'p',
        'detail',
        `Next run ${describeWhen(decision.nextRunTs, now)} from ${stopName}. Live buses appear closer to the time.`,
      ),
    );
  }

  /* --- following buses --- */
  const later = decision.candidates.filter((c) => c.catchable && c !== decision.bus);
  if (later.length > 0) {
    const row = make('p', 'then');
    row.append(make('span', 'then__label', 'Then'));
    row.append(
      document.createTextNode(
        later
          .slice(0, 3)
          .map((c) => `${c.service} · ${formatHHMM(c.busAtStop)}`)
          .join('   '),
      ),
    );
    card.append(row);
  }

  /* --- actions --- */
  const actions = make('div', 'card__actions');
  const remove = /** @type {HTMLButtonElement} */ (
    make('button', 'link-btn link-btn--danger', 'Delete')
  );
  remove.type = 'button';
  remove.dataset.action = 'delete';
  remove.dataset.id = commute.id;
  actions.append(remove);
  card.append(actions);

  return card;
}

/**
 * Update countdown text in place, without refetching arrivals.
 * @param {HTMLElement} root
 * @param {number} [now]
 */
export function tickCountdowns(root, now = Date.now()) {
  const nodes = /** @type {NodeListOf<HTMLElement>} */ (
    root.querySelectorAll('.hero__value')
  );
  for (const node of nodes) {
    const leaveAt = Number(node.dataset.leaveAt);
    if (!Number.isFinite(leaveAt) || leaveAt === 0) continue;
    node.textContent = describeMinutes(Math.round((leaveAt - now) / 60000));
  }
}

/**
 * Fire a system notification, but only if permission is already granted.
 * Never prompts as a side effect of loading the page.
 * @param {import('./planner.js').Decision} decision
 * @param {import('./planner.js').Commute} commute
 */
export function maybeNotify(decision, commute) {
  if (decision.status !== 'LEAVE_NOW') return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return false;
  }
  new Notification(`Leave now — ${commute.label}`, {
    body: decision.bus
      ? `Bus ${decision.bus.service} reaches your stop at ${formatHHMM(decision.bus.busAtStop)}`
      : 'Time to head for the bus stop',
    tag: `commute-${commute.id}`,
  });
  return true;
}

export { describeMinutes, describeWhen };
