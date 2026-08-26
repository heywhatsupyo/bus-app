/**
 * Commute persistence in localStorage. The key is versioned so a future schema
 * change can migrate rather than crash on old data.
 */

// v2 dropped the destination stop, ride time and arrival target, so old
// records are not readable as the current shape.
const KEY = 'bus-app.commutes.v2';

/**
 * @returns {import('./planner.js').Commute[]}
 */
export function loadCommutes() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or unavailable storage (private mode, quota) must not break the page.
    return [];
  }
}

/** @param {import('./planner.js').Commute[]} commutes */
export function saveCommutes(commutes) {
  try {
    localStorage.setItem(KEY, JSON.stringify(commutes));
    return true;
  } catch {
    return false;
  }
}

/** @param {import('./planner.js').Commute} commute */
export function addCommute(commute) {
  const all = loadCommutes();
  all.push(commute);
  saveCommutes(all);
  return all;
}

/** @param {string} id */
export function removeCommute(id) {
  const all = loadCommutes().filter((c) => c.id !== id);
  saveCommutes(all);
  return all;
}

export function newId() {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/**
 * Replace one commute in place, keeping order.
 * @param {import('./planner.js').Commute} commute
 */
export function updateCommute(commute) {
  const all = loadCommutes().map((c) => (c.id === commute.id ? commute : c));
  saveCommutes(all);
  return all;
}
