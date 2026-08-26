/**
 * Entry point. On load: restore saved commutes, fetch live arrivals for the ones
 * that are close to their departure time, and show when to leave.
 *
 * Arrivals refresh on load and when the tab regains focus, never in a tight
 * poll — arrivelah2 is a small community service.
 */

import { loadBusData, nearestStops, searchStops, servicesAtStop } from './busdata.js';
import { fetchArrivals } from './arrivals.js';
import { decideDeparture, isActiveNow } from './planner.js';
import { addCommute, loadCommutes, newId, removeCommute } from './storage.js';
import { maybeNotify, renderDecision, tickCountdowns } from './ui.js';

/** @typedef {import('./busdata.js').Stop} Stop */

/** @type {import('./busdata.js').BusData|null} */
let busData = null;

/** @type {Stop|null} */
let pickedStop = null;

/** @param {string} id @returns {HTMLElement} */
function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}

/** @param {string} id @returns {HTMLInputElement} */
function input(id) {
  return /** @type {HTMLInputElement} */ (el(id));
}

/** @param {string} message */
function setStatus(message, isError = false) {
  const node = el('status');
  node.textContent = message;
  node.classList.toggle('is-error', isError);
  node.hidden = !message;
}

/* ---------- cards ---------- */

async function refresh() {
  const commutes = loadCommutes();
  const container = el('cards');
  container.replaceChildren();
  el('empty').hidden = commutes.length > 0;
  if (commutes.length === 0) {
    el('updated').textContent = '';
    return;
  }

  const now = Date.now();

  // Sort so whatever is happening soonest sits at the top.
  const ordered = [...commutes].sort((a, b) => {
    const activeDiff = Number(isActiveNow(b, now)) - Number(isActiveNow(a, now));
    return activeDiff || a.departAfterHHMM.localeCompare(b.departAfterHHMM);
  });

  for (const commute of ordered) {
    let decision;
    try {
      // Only spend a request when the commute is actually near its time.
      const arrivals = isActiveNow(commute, now)
        ? await fetchArrivals(commute.boardStop, { now })
        : [];
      decision = decideDeparture({ commute, arrivals, now });
    } catch (error) {
      const card = document.createElement('article');
      card.className = 'card card--error';
      card.textContent = `${commute.label}: could not load arrivals (${
        error instanceof Error ? error.message : String(error)
      })`;
      container.append(card);
      continue;
    }

    container.append(
      renderDecision({
        commute,
        decision,
        now,
        boardStopInfo: busData?.stops.get(commute.boardStop),
      }),
    );
    maybeNotify(decision, commute);
  }

  el('updated').textContent = `Updated ${new Date(now).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/* ---------- stop picker ---------- */

/**
 * @param {(Stop & {distance?: number})[]} stops
 */
function renderStopResults(stops) {
  const container = el('stopResults');
  container.replaceChildren();
  if (stops.length === 0) {
    container.hidden = true;
    return;
  }
  for (const stop of stops) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result';
    const name = document.createElement('span');
    name.className = 'result__name';
    name.textContent = stop.name;
    const meta = document.createElement('span');
    meta.className = 'result__meta';
    meta.textContent =
      stop.distance !== undefined
        ? `${stop.road} · ${stop.code} · ${stop.distance} m`
        : `${stop.road} · ${stop.code}`;
    button.append(name, meta);
    button.addEventListener('click', () => chooseStop(stop));
    container.append(button);
  }
  container.hidden = false;
}

/** @param {Stop} stop */
function chooseStop(stop) {
  pickedStop = stop;
  const chosen = el('stopChosen');
  chosen.textContent = `${stop.name} · ${stop.road} (${stop.code})`;
  chosen.dataset.empty = 'false';
  el('stopResults').hidden = true;
  input('stopSearch').value = '';
  updateServiceOptions();
}

function wireStopPicker() {
  const search = input('stopSearch');

  search.addEventListener('input', () => {
    if (!busData) return;
    renderStopResults(searchStops(busData.stops, search.value));
  });

  el('stopNearby').addEventListener('click', () => {
    if (!busData) return;
    if (!navigator.geolocation) {
      setStatus('This browser will not share a location. Search by name instead.', true);
      return;
    }
    setStatus('Finding stops near you…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setStatus('');
        if (!busData) return;
        renderStopResults(
          nearestStops(busData.stops, {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          }),
        );
      },
      () => setStatus('Location unavailable. Search by name instead.', true),
      { timeout: 8000 },
    );
  });
}

/** List the buses calling at the chosen stop, as toggleable chips. */
function updateServiceOptions() {
  const container = el('services');
  const hint = el('servicesHint');
  container.replaceChildren();

  if (!pickedStop || !busData) {
    hint.textContent = 'Choose a stop first.';
    return;
  }

  const found = servicesAtStop(busData.services, pickedStop.code);
  if (found.length === 0) {
    hint.textContent = 'No buses are recorded at that stop.';
    return;
  }

  hint.textContent = `${found.length} bus${
    found.length === 1 ? '' : 'es'
  } call here. Tick the ones you would actually board.`;

  for (const entry of found) {
    const chip = document.createElement('label');
    chip.className = 'chip';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = entry.service;
    const text = document.createElement('span');
    text.textContent = entry.service;
    chip.title = entry.name;
    chip.append(box, text);
    container.append(chip);
  }
}

/* ---------- form ---------- */

/** @param {string} containerId */
function checkedValues(containerId) {
  const boxes = /** @type {NodeListOf<HTMLInputElement>} */ (
    el(containerId).querySelectorAll('input:checked')
  );
  return [...boxes].map((box) => box.value);
}

/** @param {Event} event */
function handleSubmit(event) {
  event.preventDefault();

  if (!pickedStop) {
    setStatus('Choose the stop you walk to.', true);
    return;
  }
  const services = checkedValues('services');
  if (services.length === 0) {
    setStatus('Tick at least one bus.', true);
    return;
  }
  const activeDays = checkedValues('days').map(Number);
  if (activeDays.length === 0) {
    setStatus('Pick at least one day.', true);
    return;
  }

  const label = input('label').value.trim() || 'My commute';
  addCommute({
    id: newId(),
    label,
    boardStop: pickedStop.code,
    services,
    walkToStopMin: Number(input('walkTo').value),
    bufferMin: Number(input('buffer').value),
    departAfterHHMM: input('departAfter').value,
    activeDays,
  });

  setStatus(`Saved “${label}”.`);
  /** @type {HTMLFormElement} */ (el('form')).reset();
  pickedStop = null;
  const chosen = el('stopChosen');
  chosen.textContent = 'No stop chosen';
  chosen.dataset.empty = 'true';
  updateServiceOptions();
  refresh();
}

/* ---------- alerts opt-in ---------- */

function wireAlertsButton() {
  const button = el('alerts');
  if (typeof Notification === 'undefined') return;

  // Only offer it when it would actually do something.
  if (Notification.permission === 'default') button.hidden = false;

  button.addEventListener('click', async () => {
    const result = await Notification.requestPermission();
    button.hidden = result !== 'default';
    setStatus(
      result === 'granted'
        ? 'Alerts on. This page will notify you when it is time to leave, while it is open.'
        : 'Alerts stayed off. The page still shows the countdown.',
      result === 'denied',
    );
  });
}

/* ---------- boot ---------- */

async function init() {
  el('form').addEventListener('submit', handleSubmit);
  el('refresh').addEventListener('click', () => refresh());
  wireAlertsButton();

  // Delete buttons are created dynamically, so listen on the container.
  el('cards').addEventListener('click', (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (target?.dataset.action !== 'delete') return;
    const id = target.dataset.id;
    if (!id) return;
    const commute = loadCommutes().find((c) => c.id === id);
    if (!confirm(`Delete “${commute?.label ?? 'this commute'}”?`)) return;
    removeCommute(id);
    refresh();
  });

  // Show saved commutes immediately; static data is only needed for stop names.
  refresh();

  try {
    setStatus('Loading bus data…');
    busData = await loadBusData();
    setStatus('');
    wireStopPicker();
    updateServiceOptions();
    refresh();
  } catch (error) {
    setStatus(
      `Could not load bus data: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  setInterval(() => tickCountdowns(el('cards')), 1000);
}

document.addEventListener('DOMContentLoaded', init);
