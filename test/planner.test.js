import { describe, expect, it } from 'vitest';
import {
  ACTIVE_LEAD_MIN,
  decideDeparture,
  isActiveNow,
  nextRun,
} from '../src/planner.js';
import { MINUTE_MS, sgtToTimestamp } from '../src/time.js';

/** 2026-08-26 is a Wednesday. */
const WED = { year: 2026, month: 8, day: 26 };
const at = (hour, minute) => sgtToTimestamp(WED, hour, minute);
const on = (day, hour, minute) => sgtToTimestamp({ ...WED, day }, hour, minute);

/** @returns {import('../src/planner.js').Commute} */
function commute(overrides = {}) {
  return {
    id: 'c1',
    label: 'Morning to work',
    boardStop: '28009',
    services: ['143'],
    walkToStopMin: 6,
    bufferMin: 3,
    departAfterHHMM: '08:00',
    activeDays: [1, 2, 3, 4, 5],
    ...overrides,
  };
}

/** A bus that reaches the stop `min` minutes from now. */
const bus = (service, min, monitored = false) => ({
  service,
  durationMs: min * MINUTE_MS,
  monitored,
});

describe('nextRun', () => {
  it('returns today when the time is still ahead', () => {
    expect(nextRun(commute(), at(7, 0))).toBe(at(8, 0));
  });

  it('rolls to the next active day once the time has passed', () => {
    expect(nextRun(commute(), at(9, 0))).toBe(on(27, 8, 0));
  });

  it('skips inactive days', () => {
    // Weekend-only, evaluated on a Wednesday -> Saturday the 29th.
    expect(nextRun(commute({ activeDays: [0, 6] }), at(7, 0))).toBe(on(29, 8, 0));
  });

  it('treats an empty day list as every day', () => {
    expect(nextRun(commute({ activeDays: [] }), at(7, 0))).toBe(at(8, 0));
  });
});

describe('isActiveNow', () => {
  it('is active shortly before the departure time', () => {
    expect(isActiveNow(commute(), at(7, 30))).toBe(true);
  });

  it('is active shortly after the departure time', () => {
    expect(isActiveNow(commute(), at(8, 30))).toBe(true);
  });

  it('is inactive well before the window opens', () => {
    expect(isActiveNow(commute(), at(6, 0))).toBe(false);
  });

  it('is inactive well after the window closes', () => {
    expect(isActiveNow(commute(), at(10, 0))).toBe(false);
  });

  it('is inactive on a day the commute does not run', () => {
    // Saturday the 29th, weekday-only commute.
    expect(isActiveNow(commute(), on(29, 8, 0))).toBe(false);
  });

  it('opens exactly at the lead boundary', () => {
    expect(isActiveNow(commute(), at(8, 0) - ACTIVE_LEAD_MIN * MINUTE_MS)).toBe(true);
  });
});

describe('decideDeparture', () => {
  it('picks the soonest catchable bus and subtracts walk and buffer', () => {
    const result = decideDeparture({
      commute: commute(),
      arrivals: [bus('143', 20), bus('143', 35)],
      now: at(7, 40),
    });
    expect(result.status).toBe('LEAVE_AT');
    expect(result.bus.busAtStop).toBe(at(8, 0));
    // 08:00 minus 6 min walk minus 3 min buffer.
    expect(result.leaveAtLabel).toBe('07:51');
    expect(result.minutesUntilLeave).toBe(11);
    expect(result.live).toBe(true);
  });

  it('says leave now once the leave time has arrived', () => {
    const result = decideDeparture({
      commute: commute(),
      arrivals: [bus('143', 8)],
      now: at(7, 55),
    });
    // Bus at 08:03, leave time 07:54 — one minute ago.
    expect(result.status).toBe('LEAVE_NOW');
    expect(result.minutesUntilLeave).toBe(-1);
  });

  it('skips buses that arrive sooner than the walk takes', () => {
    const result = decideDeparture({
      commute: commute(),
      arrivals: [bus('143', 3), bus('143', 25)],
      now: at(7, 40),
    });
    expect(result.bus.busAtStop).toBe(at(8, 5));
    expect(result.candidates[0].catchable).toBe(false);
  });

  it('reports NO_SERVICE when nothing can be caught', () => {
    const result = decideDeparture({
      commute: commute(),
      arrivals: [bus('143', 2)],
      now: at(7, 40),
    });
    expect(result.status).toBe('NO_SERVICE');
    expect(result.bus).toBeNull();
  });

  it('reports NO_SERVICE when no bus matches the chosen services', () => {
    const result = decideDeparture({
      commute: commute({ services: ['143'] }),
      arrivals: [bus('105', 20)],
      now: at(7, 40),
    });
    expect(result.status).toBe('NO_SERVICE');
  });

  it('accepts any listed service, not just the first', () => {
    const result = decideDeparture({
      commute: commute({ services: ['143', '105'] }),
      arrivals: [bus('105', 15), bus('143', 25)],
      now: at(7, 40),
    });
    expect(result.bus.service).toBe('105');
  });

  it('ignores live arrivals outside the active window', () => {
    const result = decideDeparture({
      commute: commute(),
      arrivals: [bus('143', 5)],
      now: at(5, 0),
    });
    expect(result.status).toBe('SCHEDULED');
    expect(result.live).toBe(false);
    expect(result.bus).toBeNull();
    // 08:00 minus 9 min of walk and buffer.
    expect(result.leaveAtLabel).toBe('07:51');
  });

  it('schedules the next active day after the window closes', () => {
    const result = decideDeparture({
      commute: commute(),
      arrivals: [],
      now: at(12, 0),
    });
    expect(result.status).toBe('SCHEDULED');
    expect(result.nextRunTs).toBe(on(27, 8, 0));
  });

  it('keeps every candidate for display, catchable or not', () => {
    const result = decideDeparture({
      commute: commute(),
      arrivals: [bus('143', 1), bus('143', 20), bus('143', 40)],
      now: at(7, 40),
    });
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((c) => c.catchable)).toEqual([false, true, true]);
  });

  it('is unaffected by the device timezone', () => {
    const original = process.env.TZ;
    const run = () =>
      decideDeparture({
        commute: commute(),
        arrivals: [bus('143', 20)],
        now: at(7, 40),
      }).leaveAtLabel;

    process.env.TZ = 'UTC';
    const utc = run();
    process.env.TZ = 'America/New_York';
    const ny = run();
    process.env.TZ = original;

    expect(utc).toBe('07:51');
    expect(ny).toBe(utc);
  });
});
