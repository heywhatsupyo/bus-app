/**
 * Pure departure-decision logic. No I/O, no DOM, no clock reads — everything
 * comes in as arguments so this is fully testable.
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
 * @typedef {object} Commute
 * @property {string} id
 * @property {string} label
 * @property {string} boardStop      stop code you board at
 * @property {string} alightStop     stop code you get off at
 * @property {string[]} services     acceptable bus service numbers
 * @property {number} walkToStopMin  home -> boarding stop
 * @property {number} rideMin        time on the bus
 * @property {number} walkFromStopMin alighting stop -> destination
 * @property {number} bufferMin      safety margin
 * @property {string} targetArrivalHHMM
 * @property {number[]} activeDays   0 = Sunday .. 6 = Saturday
 */

/**
 * @typedef {object} Arrival
 * @property {string} service
 * @property {number} durationMs  time until it reaches the boarding stop
 * @property {boolean} monitored   true when backed by live GPS, false when scheduled
 * @property {string} [load]
 * @property {string} [type]
 */

/** @typedef {'LEAVE_NOW'|'LEAVE_AT'|'TOO_LATE'|'NO_SERVICE'|'SCHEDULED'} DepartureStatus */

/**
 * @typedef {object} Candidate
 * @property {string} service
 * @property {boolean} monitored
 * @property {string} [load]
 * @property {number} busAtStop
 * @property {number} arriveAtDest
 * @property {boolean} catchable
 * @property {boolean} onTime
 * @property {number} leaveAt
 */

/**
 * @typedef {object} Decision
 * @property {DepartureStatus} status
 * @property {number} targetTs
 * @property {number|null} leaveAt
 * @property {string|null} leaveAtLabel
 * @property {number|null} minutesUntilLeave
 * @property {Candidate|null} bus
 * @property {Candidate[]} candidates
 * @property {number|null} [minutesLate]
 */

/**
 * Resolve the next occurrence of the commute's target arrival time.
 *
 * Rolls forward when the time has already passed today, or when today is not one
 * of the commute's active days.
 *
 * @param {Commute} commute
 * @param {number} now epoch ms
 * @returns {{targetTs: number, isToday: boolean}}
 */
export function resolveTargetArrival(commute, now) {
  const { hour, minute } = parseHHMM(commute.targetArrivalHHMM);
  const active = commute.activeDays?.length ? commute.activeDays : [0, 1, 2, 3, 4, 5, 6];
  let date = sgtParts(now);

  // Look ahead a full week; a commute always has at least one active day.
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = offset === 0 ? date : addDays(date, offset);
    if (!active.includes(weekdayOf(candidate))) continue;
    const ts = sgtToTimestamp(candidate, hour, minute);
    if (ts > now) return { targetTs: ts, isToday: offset === 0 };
  }
  // Unreachable for a non-empty activeDays, but keep a defined result.
  const fallback = addDays(date, 7);
  return { targetTs: sgtToTimestamp(fallback, hour, minute), isToday: false };
}

/**
 * Total door-to-door time that does not depend on which bus you catch.
 * @param {Commute} commute
 */
function fixedTravelMin(commute) {
  return commute.walkToStopMin + commute.rideMin + commute.walkFromStopMin;
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
  const { targetTs, isToday } = resolveTargetArrival(commute, now);

  // Live arrivals only look a few buses ahead, so they cannot inform a trip on a
  // later day. Fall back to pure arithmetic from the target time.
  if (!isToday) {
    const leaveAt = targetTs - (fixedTravelMin(commute) + commute.bufferMin) * MINUTE_MS;
    return {
      status: /** @type {DepartureStatus} */ ('SCHEDULED'),
      targetTs,
      leaveAt,
      leaveAtLabel: formatHHMM(leaveAt),
      minutesUntilLeave: Math.round((leaveAt - now) / MINUTE_MS),
      bus: null,
      candidates: [],
    };
  }

  const wanted = new Set(commute.services);
  const candidates = arrivals
    .filter((a) => wanted.size === 0 || wanted.has(a.service))
    .map((a) => {
      const busAtStop = now + a.durationMs;
      const arriveAtDest =
        busAtStop + (commute.rideMin + commute.walkFromStopMin) * MINUTE_MS;
      return {
        service: a.service,
        monitored: a.monitored,
        load: a.load,
        busAtStop,
        arriveAtDest,
        // You must physically reach the stop before the bus does.
        catchable: busAtStop >= now + commute.walkToStopMin * MINUTE_MS,
        onTime: arriveAtDest <= targetTs,
        leaveAt: busAtStop - (commute.walkToStopMin + commute.bufferMin) * MINUTE_MS,
      };
    })
    .sort((a, b) => a.busAtStop - b.busAtStop);

  if (candidates.length === 0) {
    return {
      status: /** @type {DepartureStatus} */ ('NO_SERVICE'),
      targetTs,
      leaveAt: null,
      leaveAtLabel: null,
      minutesUntilLeave: null,
      bus: null,
      candidates,
    };
  }

  const viable = candidates.filter((c) => c.catchable && c.onTime);

  if (viable.length === 0) {
    // Nothing gets there in time. Report the best catchable option so the user
    // knows how late they would be, rather than just failing.
    const catchable = candidates.filter((c) => c.catchable);
    const best = catchable.length
      ? catchable.reduce((a, b) => (a.arriveAtDest <= b.arriveAtDest ? a : b))
      : null;
    return {
      status: /** @type {DepartureStatus} */ ('TOO_LATE'),
      targetTs,
      leaveAt: best ? best.leaveAt : null,
      leaveAtLabel: best ? formatHHMM(best.leaveAt) : null,
      minutesUntilLeave: best ? Math.round((best.leaveAt - now) / MINUTE_MS) : null,
      bus: best,
      minutesLate: best ? Math.round((best.arriveAtDest - targetTs) / MINUTE_MS) : null,
      candidates,
    };
  }

  // Leave as late as is still safe: the last bus that arrives on time.
  const chosen = viable.reduce((a, b) => (a.busAtStop >= b.busAtStop ? a : b));
  const urgent = chosen.leaveAt <= now;

  return {
    status: /** @type {DepartureStatus} */ (urgent ? 'LEAVE_NOW' : 'LEAVE_AT'),
    targetTs,
    leaveAt: chosen.leaveAt,
    leaveAtLabel: formatHHMM(chosen.leaveAt),
    minutesUntilLeave: Math.round((chosen.leaveAt - now) / MINUTE_MS),
    bus: chosen,
    candidates,
  };
}
