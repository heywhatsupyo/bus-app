import { describe, expect, it } from 'vitest';
import { decideDeparture, resolveTargetArrival } from '../src/planner.js';
import { MINUTE_MS, sgtToTimestamp } from '../src/time.js';

/** 2026-08-26 is a Wednesday. */
const WED = { year: 2026, month: 8, day: 26 };
const at = (hour, minute) => sgtToTimestamp(WED, hour, minute);

/** @returns {import('../src/planner.js').Commute} */
function commute(overrides = {}) {
  return {
    id: 'c1',
    label: 'To work',
    boardStop: '28009',
    alightStop: '52009',
    services: ['143'],
    walkToStopMin: 6,
    rideMin: 34,
    walkFromStopMin: 4,
    bufferMin: 3,
    targetArrivalHHMM: '09:00',
    activeDays: [1, 2, 3, 4, 5],
    ...overrides,
  };
}

/** Arrival that reaches the boarding stop `min` minutes from now. */
const bus = (service, min, monitored = false) => ({
  service,
  durationMs: min * MINUTE_MS,
  monitored,
});

describe('resolveTargetArrival', () => {
  it('uses today when the target is still ahead', () => {
    const { targetTs, isToday } = resolveTargetArrival(commute(), at(7, 0));
    expect(isToday).toBe(true);
    expect(targetTs).toBe(at(9, 0));
  });

  it('rolls to the next active day once the target has passed', () => {
    const { targetTs, isToday } = resolveTargetArrival(commute(), at(9, 30));
    expect(isToday).toBe(false);
    // Thursday 27th, still a weekday.
    expect(targetTs).toBe(sgtToTimestamp({ ...WED, day: 27 }, 9, 0));
  });

  it('skips inactive days', () => {
    // Weekend-only commute, evaluated on a Wednesday -> next Saturday the 29th.
    const { targetTs } = resolveTargetArrival(
      commute({ activeDays: [0, 6] }),
      at(7, 0),
    );
    expect(targetTs).toBe(sgtToTimestamp({ ...WED, day: 29 }, 9, 0));
  });

  it('treats an empty activeDays list as every day', () => {
    const { isToday } = resolveTargetArrival(commute({ activeDays: [] }), at(7, 0));
    expect(isToday).toBe(true);
  });
});

describe('decideDeparture', () => {
  it('picks the latest bus that still arrives on time', () => {
    const now = at(7, 30);
    // Ride+walk = 38 min. To arrive by 09:00 the bus must reach the stop by 08:22,
    // i.e. within 52 minutes of 07:30.
    const result = decideDeparture({
      commute: commute(),
      arrivals: [bus('143', 10), bus('143', 30), bus('143', 50), bus('143', 60)],
      now,
    });

    expect(result.status).toBe('LEAVE_AT');
    expect(result.bus.busAtStop).toBe(at(8, 20)); // the 50-minute bus
    // leave = bus - walkToStop(6) - buffer(3)
    expect(result.leaveAtLabel).toBe('08:11');
    expect(result.minutesUntilLeave).toBe(41);
  });

  it('flags LEAVE_NOW when the leave time has already arrived', () => {
    const result = decideDeparture({
      commute: commute(),
      arrivals: [bus('143', 8)],
      now: at(7, 30),
    });
    // leave = 07:38 - 9 min = 07:29, one minute in the past.
    expect(result.status).toBe('LEAVE_NOW');
    expect(result.minutesUntilLeave).toBe(-1);
  });

  it('ignores buses that cannot physically be caught', () => {
    // Walk is 6 min, so a bus 3 min away is unreachable.
    const result = decideDeparture({
      commute: commute(),
      arrivals: [bus('143', 3)],
      now: at(7, 30),
    });
    expect(result.status).toBe('TOO_LATE');
    expect(result.bus).toBeNull();
  });

  it('reports how late the best option is when nothing arrives on time', () => {
    const result = decideDeparture({
      commute: commute(),
      arrivals: [bus('143', 60)], // reaches stop 08:30, arrives 09:08
      now: at(7, 30),
    });
    expect(result.status).toBe('TOO_LATE');
    expect(result.minutesLate).toBe(8);
    expect(result.bus.service).toBe('143');
  });

  it('returns NO_SERVICE when there are no arrivals', () => {
    const result = decideDeparture({ commute: commute(), arrivals: [], now: at(7, 30) });
    expect(result.status).toBe('NO_SERVICE');
    expect(result.leaveAt).toBeNull();
  });

  it('returns NO_SERVICE when no arrival matches the chosen services', () => {
    const result = decideDeparture({
      commute: commute({ services: ['143'] }),
      arrivals: [bus('105', 20), bus('51', 25)],
      now: at(7, 30),
    });
    expect(result.status).toBe('NO_SERVICE');
  });

  it('considers every accepted service, not just the first', () => {
    const result = decideDeparture({
      commute: commute({ services: ['143', '105'] }),
      arrivals: [bus('143', 20), bus('105', 45)],
      now: at(7, 30),
    });
    expect(result.bus.service).toBe('105');
  });

  it('falls back to arithmetic for a trip on a later day', () => {
    const result = decideDeparture({
      commute: commute(),
      arrivals: [bus('143', 10)],
      now: at(22, 0),
    });
    expect(result.status).toBe('SCHEDULED');
    expect(result.bus).toBeNull();
    // 09:00 minus 44 min travel (6 + 34 + 4) minus the 3 min buffer.
    expect(result.leaveAtLabel).toBe('08:13');
  });

  it('is unaffected by the device timezone', () => {
    const original = process.env.TZ;
    const run = () =>
      decideDeparture({
        commute: commute(),
        arrivals: [bus('143', 50)],
        now: at(7, 30),
      }).leaveAtLabel;

    process.env.TZ = 'UTC';
    const utc = run();
    process.env.TZ = 'America/New_York';
    const ny = run();
    process.env.TZ = original;

    expect(utc).toBe('08:11');
    expect(ny).toBe(utc);
  });
});
