/**
 * Entry point. On load: restore saved commutes, fetch live arrivals, and show
 * when to leave. No polling loop — arrivals refresh on load and when the tab
 * regains focus, which respects arrivelah2's 15s cache.
 */

import { findServicesBetween, loadBusData, nearestStops, searchStops } from './busdata.js';
import { fetchArrivals } from './arrivals.js';
import { decideDeparture } from './planner.js';
import { addCommute, loadCommutes, newId, removeCommute } from './storage.js';
import { maybeNotify, renderDecision, tickCountdowns } from './ui.js';

/** @typedef {import('./busdata.js').Stop} Stop */

/** @type {import('./busdata.js').BusData|null} */
let busData = null;

/** @type {{board: Stop|null, alight: Stop|null}} */
const picked = { board: null, alight: null };

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}

/**
 * @param {string} id
 * @returns {HTMLInputElement}
 */
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

/* ---------- rendering saved commutes ---------- */

async function refresh() {
  const commutes = loadCommutes();
  const container = el('decisions');
  container.replaceChildren();
  el('empty').hidden = commutes.length > 0;
  if (commutes.length === 0) return;

  const now = Date.now();
  for (const commute of commutes) {
    let decision;
    try {
      const arrivals = await fetchArrivals(commute.boardStop, { now });
      decision = decideDeparture({ commute, arrivals, now });
    } catch (error) {
      const card = document.createElement('article');
      card.className = 'decision decision--error';
      card.textContent = `${commute.label}: could not load arrivals (${
        error instanceof Error ? error.message : String(error)
      })`;
      container.append(card);
      continue;
    }

    const boardStopInfo = busData?.stops.get(commute.boardStop);
    const card = renderDecision({ commute, decision, boardStopInfo });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'decision__remove';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => {
      if (!confirm(`Delete "${commute.label}"?`)) return;
      removeCommute(commute.id);
      refresh();
    });
    card.append(remove);

    container.append(card);
    maybeNotify(decision, commute);
  }

  el('updated').textContent = `Updated ${new Date(now).toLocaleTimeString()}`;
}

/* ---------- stop pickers ---------- */

/**
 * @param {HTMLElement} container
 * @param {(Stop & {distance?: number})[]} stops
 * @param {(stop: Stop) => void} onPick
 */
function renderStopResults(container, stops, onPick) {
  container.replaceChildren();
  if (stops.length === 0) {
    container.hidden = true;
    return;
  }
  for (const stop of stops) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stop-result';
    const distance = stop.distance !== undefined ? ` · ${stop.distance} m` : '';
    button.textContent = `${stop.name} — ${stop.road} (${stop.code})${distance}`;
    button.addEventListener('click', () => onPick(stop));
    container.append(button);
  }
  container.hidden = false;
}

/** @param {'board'|'alight'} which */
function wireStopPicker(which) {
  const search = input(`${which}Search`);
  const results = el(`${which}Results`);
  const chosen = el(`${which}Chosen`);

  /** @param {Stop} stop */
  const choose = (stop) => {
    picked[which] = stop;
    chosen.textContent = `${stop.name} (${stop.code})`;
    results.hidden = true;
    search.value = '';
    updateServiceOptions();
  };

  search.addEventListener('input', () => {
    if (!busData) return;
    renderStopResults(results, searchStops(busData.stops, search.value), choose);
  });

  el(`${which}Nearby`).addEventListener('click', () => {
    if (!busData) return;
    if (!navigator.geolocation) {
      setStatus('This browser will not share a location. Search by name instead.', true);
      return;
    }
    setStatus('Finding nearby stops…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setStatus('');
        if (!busData) return;
        const origin = { lat: position.coords.latitude, lng: position.coords.longitude };
        renderStopResults(results, nearestStops(busData.stops, origin), choose);
      },
      () => setStatus('Location unavailable. Search by name instead.', true),
      { timeout: 8000 },
    );
  });
}

/** Work out which buses serve both chosen stops, in the right direction. */
function updateServiceOptions() {
  const container = el('services');
  const hint = el('servicesHint');
  container.replaceChildren();

  if (!picked.board || !picked.alight || !busData) {
    hint.textContent = 'Choose both stops to see which buses work.';
    return;
  }

  const matches = findServicesBetween(
    busData.services,
    picked.board.code,
    picked.alight.code,
  );

  if (matches.length === 0) {
    hint.textContent =
      'No single bus links those stops in that direction. Try a different pair — transfers are not supported yet.';
    return;
  }

  hint.textContent = `${matches.length} bus${
    matches.length === 1 ? '' : 'es'
  } link these stops. Tick the ones you would actually take.`;

  for (const match of matches) {
    const wrapper = document.createElement('label');
    wrapper.className = 'service-option';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = match.service;
    box.checked = true;
    wrapper.append(
      box,
      document.createTextNode(` ${match.service} · ${match.stopsBetween} stops`),
    );
    container.append(wrapper);
  }
}

/* ---------- form submission ---------- */

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

  if (!picked.board || !picked.alight) {
    setStatus('Choose a boarding stop and an alighting stop first.', true);
    return;
  }
  const services = checkedValues('services');
  if (services.length === 0) {
    setStatus('Tick at least one bus service.', true);
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
    boardStop: picked.board.code,
    alightStop: picked.alight.code,
    services,
    walkToStopMin: Number(input('walkTo').value),
    rideMin: Number(input('ride').value),
    walkFromStopMin: Number(input('walkFrom').value),
    bufferMin: Number(input('buffer').value),
    targetArrivalHHMM: input('target').value,
    activeDays,
  });

  setStatus(`Saved "${label}".`);
  /** @type {HTMLFormElement} */ (el('form')).reset();
  picked.board = null;
  picked.alight = null;
  el('boardChosen').textContent = 'none yet';
  el('alightChosen').textContent = 'none yet';
  updateServiceOptions();
  /** @type {HTMLDetailsElement} */ (el('setup')).open = false;
  refresh();
}

/* ---------- boot ---------- */

async function init() {
  el('form').addEventListener('submit', handleSubmit);
  el('refresh').addEventListener('click', () => refresh());

  // Show saved commutes as soon as possible; the static dataset is only needed
  // for stop names and the setup form.
  refresh();

  try {
    setStatus('Loading bus data…');
    busData = await loadBusData();
    setStatus('');
    wireStopPicker('board');
    wireStopPicker('alight');
    updateServiceOptions();
    refresh();
  } catch (error) {
    setStatus(
      `Could not load bus data: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }

  // Re-check when the user returns to the tab, and keep the countdown ticking.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  setInterval(() => tickCountdowns(el('decisions')), 1000);
}

document.addEventListener('DOMContentLoaded', init);
