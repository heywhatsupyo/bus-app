/**
 * DOM rendering. Kept separate from planner.js so the decision logic stays
 * testable without a browser.
 */

import { formatHHMM } from './time.js';

/**
 * Human wording for each planner status.
 * @type {Record<import('./planner.js').DepartureStatus, string>}
 */
const STATUS_TEXT = {
  LEAVE_NOW: 'Leave now',
  LEAVE_AT: 'Leave at',
  TOO_LATE: "You'll be late",
  NO_SERVICE: 'No buses running',
  SCHEDULED: 'Next trip',
};

/**
 * @param {number} minutes
 * @returns {string}
 */
function describeMinutes(minutes) {
  if (minutes <= 0) return 'now';
  if (minutes === 1) return 'in 1 minute';
  if (minutes < 60) return `in ${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

/**
 * Render the headline banner for one commute.
 * @param {object} params
 * @param {import('./planner.js').Commute} params.commute
 * @param {import('./planner.js').Decision} params.decision
 * @param {{name: string}} [params.boardStopInfo]
 * @returns {HTMLElement}
 */
export function renderDecision({ commute, decision, boardStopInfo }) {
  const el = document.createElement('article');
  el.className = `decision decision--${decision.status.toLowerCase()}`;

  const heading = document.createElement('h2');
  heading.className = 'decision__label';
  heading.textContent = commute.label;
  el.append(heading);

  const headline = document.createElement('p');
  headline.className = 'decision__headline';

  if (decision.status === 'LEAVE_NOW') {
    headline.textContent = 'Leave now';
  } else if (decision.leaveAtLabel) {
    headline.textContent = `${STATUS_TEXT[decision.status]} ${decision.leaveAtLabel}`;
  } else {
    headline.textContent = STATUS_TEXT[decision.status];
  }
  el.append(headline);

  const detail = document.createElement('p');
  detail.className = 'decision__detail';

  if (decision.status === 'NO_SERVICE') {
    detail.textContent = `Nothing scheduled from ${
      boardStopInfo?.name ?? commute.boardStop
    } for service ${commute.services.join(', ')} right now.`;
  } else if (decision.status === 'TOO_LATE') {
    detail.textContent = decision.bus
      ? `Best option is bus ${decision.bus.service} at ${formatHHMM(
          decision.bus.busAtStop,
        )}, arriving ${formatHHMM(decision.bus.arriveAtDest)} — about ${
          decision.minutesLate
        } min after your ${commute.targetArrivalHHMM} target.`
      : `The next bus arrives too soon to walk there in ${commute.walkToStopMin} min.`;
  } else if (decision.status === 'SCHEDULED') {
    detail.textContent = `Not today — next run is ${describeMinutes(
      decision.minutesUntilLeave ?? 0,
    )}, based on your saved travel times rather than live arrivals.`;
  } else if (decision.bus) {
    detail.textContent = `Catch bus ${decision.bus.service} at ${formatHHMM(
      decision.bus.busAtStop,
    )} from ${boardStopInfo?.name ?? commute.boardStop}. Arrives about ${formatHHMM(
      decision.bus.arriveAtDest,
    )}, target ${commute.targetArrivalHHMM}.`;
  }
  el.append(detail);

  if (decision.minutesUntilLeave !== null && decision.status !== 'NO_SERVICE') {
    const countdown = document.createElement('p');
    countdown.className = 'decision__countdown';
    countdown.dataset.leaveAt = String(decision.leaveAt ?? '');
    countdown.textContent = describeMinutes(decision.minutesUntilLeave);
    el.append(countdown);
  }

  if (decision.bus) {
    const badge = document.createElement('span');
    badge.className = `badge badge--${decision.bus.monitored ? 'live' : 'scheduled'}`;
    // Most arrivelah2 responses are schedule-derived, so be explicit about it.
    badge.textContent = decision.bus.monitored ? 'live GPS' : 'scheduled estimate';
    badge.title = decision.bus.monitored
      ? 'Backed by a live vehicle position'
      : 'Operator timetable estimate, not a tracked bus';
    el.append(badge);
  }

  if (decision.candidates?.length > 1) {
    const list = document.createElement('ul');
    list.className = 'decision__alternatives';
    for (const candidate of decision.candidates.slice(0, 5)) {
      const item = document.createElement('li');
      const flags = [];
      if (!candidate.catchable) flags.push('too soon to reach');
      else if (!candidate.onTime) flags.push('arrives late');
      item.textContent = `${candidate.service} · ${formatHHMM(candidate.busAtStop)}${
        flags.length ? ` (${flags.join(', ')})` : ''
      }`;
      if (candidate === decision.bus) item.className = 'is-chosen';
      list.append(item);
    }
    el.append(list);
  }

  return el;
}

/**
 * Update countdown text in place, without refetching arrivals.
 * @param {HTMLElement} root
 * @param {number} [now]
 */
export function tickCountdowns(root, now = Date.now()) {
  const nodes = /** @type {NodeListOf<HTMLElement>} */ (
    root.querySelectorAll('.decision__countdown')
  );
  for (const node of nodes) {
    const leaveAt = Number(node.dataset.leaveAt);
    if (!Number.isFinite(leaveAt) || leaveAt === 0) continue;
    node.textContent = describeMinutes(Math.round((leaveAt - now) / 60000));
  }
}

/**
 * Fire a system notification, but only if permission was already granted.
 * Never prompts on page load.
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
      ? `Bus ${decision.bus.service} at ${formatHHMM(decision.bus.busAtStop)}`
      : 'Time to go',
    tag: `commute-${commute.id}`,
  });
  return true;
}

export { describeMinutes };
