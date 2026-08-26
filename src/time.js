/**
 * Singapore time helpers.
 *
 * Singapore is permanently UTC+08:00 and has observed no DST since 1935, so a
 * fixed offset is safe here and avoids depending on the device's timezone.
 */

export const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;

/** @typedef {{year: number, month: number, day: number}} SgtDate */

/**
 * Wall-clock calendar fields for a timestamp, as seen in Singapore.
 * @param {number} ts epoch milliseconds
 */
export function sgtParts(ts) {
  const d = new Date(ts + SGT_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    /** 0 = Sunday .. 6 = Saturday */
    weekday: d.getUTCDay(),
  };
}

/**
 * Convert a Singapore wall-clock date and time into epoch milliseconds.
 * @param {SgtDate} date
 * @param {number} hour
 * @param {number} minute
 */
export function sgtToTimestamp(date, hour, minute) {
  return Date.UTC(date.year, date.month - 1, date.day, hour, minute) - SGT_OFFSET_MS;
}

/**
 * Parse an "HH:MM" string into hour and minute.
 * @param {string} hhmm
 * @returns {{hour: number, minute: number}}
 */
export function parseHHMM(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!match) throw new Error(`Invalid time "${hhmm}", expected HH:MM`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid time "${hhmm}"`);
  return { hour, minute };
}

/**
 * Format a timestamp as "HH:MM" in Singapore time.
 * @param {number} ts epoch milliseconds
 */
export function formatHHMM(ts) {
  const { hour, minute } = sgtParts(ts);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Add whole days to a Singapore calendar date.
 * @param {SgtDate} date
 * @param {number} days
 * @returns {SgtDate}
 */
export function addDays(date, days) {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Weekday (0 = Sunday) for a Singapore calendar date.
 * @param {SgtDate} date
 */
export function weekdayOf(date) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}
