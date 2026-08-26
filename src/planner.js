/**
 * Pure departure-decision logic. No I/O, no DOM, no clock reads — everything
 * arrives as an argument so this is fully testable.
 *
 * The question is deliberately narrow: given the next buses at my stop, when do
 * I need to walk out the door? There is no destination and no arrival target.
 */

import {
  MINUTE_MS,
  addDays,
  formatHHMM,
  parseHHMM,
  sgtParts,
  sgtToTimestamp,
  weekdayOf,
} from './time.js';

/**
 * How long before the intended departure a commute starts showing live buses,
 * and how long after it keeps doing so.
 */
export const ACTIVE_LEAD_MIN = 45;
export const ACTIVE_TRAIL_MIN = 60;

/**
 * @typedef {object} Commute
 * @property {string} id
 * @property {string} label
 * @property {string} boardStop      stop code you walk to
 * @property {string[]} services     buses you are willing to take
 * @property {number} walkToStopMin  door to stop
 * @property {number} bufferMin      safety margin
 * @property {string} departAfterHHMM  when you intend to catch a bus
 * @property {number[]} activeDays   0 = Sunday .. 6 = Saturday
 */

/**
 * @typedef {object} Arrival
 * @property {string} service
 * @property {number} durationMs  time until it reaches the stop
 * @property {boolean} monitored  true when backed by live GPS, false when scheduled
 * @property {string} [load]
 * @property {string} [type]
 */

/** @typedef {'LEAVE_NOW'|'LEAVE_AT'|'NO_SERVICE'|'SCHEDULED'} DepartureStatus */

/**
 * @typedef {object} Candidate
 * @property {string} service
 * @property {boolean} monitored
 * @property {string} [load]
 * @property {number} busAtStop
 * @property {boolean} catchable
 * @property {number} leaveAt
 */

/**
 * @typedef {object} Decision
 * @property {DepartureStatus} status
 * @property {number|null} leaveAt
 * @property {string|null} leaveAtLabel
 * @property {number|null} minutesUntilLeave
 * @property {Candidate|null} bus
 * @property {Candidate[]} candidates
 * @property {boolean} live  true when the answer came from real arrivals
 * @property {number} [nextRunTs]
 */

const allDays = [0, 1, 2, 3, 4, 5, 6];

/** @param {Commute} commute */
function daysOf(commute) {
  return commute.activeDays?.length ? commute.activeDays : allDays;
}

/**
 * The next time this commute comes around, at or after `now`.
 * @param {Commute} commute
 * @param {number} now
 */
export function nextRun(commute, now) {
  const { hour, minute } = parseHHMM(commute.departAfterHHMM);
  const days = daysOf(commute);
  const today = sgtParts(now);

  for (let offset = 0; offset < 8; offset += 1) {
    const date = offset === 0 ? today : addDays(today, offset);
    if (!days.includes(weekdayOf(date))) continue;
    const ts = sgtToTimestamp(date, hour, minute);
    if (ts > now) return ts;
  }
  return sgtToTimestamp(addDays(today, 7), hour, minute);
}

/**
 * Is this commute close enough to its departure time to show live buses?
 * @param {Commute} commute
 * @param {number} now
 */
export function isActiveNow(commute, now) {
  const { hour, minute } = parseHHMM(commute.departAfterHHMM);
  const today = sgtParts(now);
  if (!daysOf(commute).includes(today.weekday)) return false;

  const departTs = sgtToTimestamp(today, hour, minute);
  return (
    now >= departTs - ACTIVE_LEAD_MIN * MINUTE_MS &&
    now <= departTs + ACTIVE_TRAIL_MIN * MINUTE_MS
  );
}

/**
 * Decide when to leave the house.
 *
 * @param {object} input
 * @param {Commute} input.commute
 * @param {Arrival[]} input.arrivals arrivals at the boarding stop
 * @param {number} input.now epoch ms
 * @returns {Decision}
 */
export function decideDeparture({ commute, arrivals, now }) {
  const lead = (commute.walkToStopMin + commute.bufferMin) * MINUTE_MS;

  // Outside the active window, live arrivals are irrelevant — the next bus now
  // is not the bus you are catching. Fall back to plain arithmetic.
  if (!isActiveNow(commute, now)) {
    const runTs = nextRun(commute, now);
    const leaveAt = runTs - lead;
    return {
      status: 'SCHEDULED',
      leaveAt,
      leaveAtLabel: formatHHMM(leaveAt),
      minutesUntilLeave: Math.round((leaveAt - now) / MINUTE_MS),
      bus: null,
      candidates: [],
      live: false,
      nextRunTs: runTs,
    };
  }

  const wanted = new Set(commute.services);
  const candidates = arrivals
    .filter((a) => wanted.size === 0 || wanted.has(a.service))
    .map((a) => {
      const busAtStop = now + a.durationMs;
      return {
        service: a.service,
        monitored: a.monitored,
        load: a.load,
        busAtStop,
        // You have to physically reach the stop before the bus does.
        catchable: busAtStop >= now + commute.walkToStopMin * MINUTE_MS,
        leaveAt: busAtStop - lead,
      };
    })
    .sort((a, b) => a.busAtStop - b.busAtStop);

  const catchable = candidates.filter((c) => c.catchable);

  if (catchable.length === 0) {
    return {
      status: 'NO_SERVICE',
      leaveAt: null,
      leaveAtLabel: null,
      minutesUntilLeave: null,
      bus: null,
      candidates,
      live: true,
    };
  }

  // The soonest bus you can still make.
  const chosen = catchable[0];
  return {
    status: chosen.leaveAt <= now ? 'LEAVE_NOW' : 'LEAVE_AT',
    leaveAt: chosen.leaveAt,
    leaveAtLabel: formatHHMM(chosen.leaveAt),
    minutesUntilLeave: Math.round((chosen.leaveAt - now) / MINUTE_MS),
    bus: chosen,
    candidates,
    live: true,
  };
}
