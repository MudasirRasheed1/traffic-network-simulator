// =====================================================
// FREE OPENSTREETMAP DATA CLIENT
//
//  Nominatim  – place name  -> coordinates + bounding box
//  Overpass   – bounding box -> raw roads (ways), points
//               (nodes), signals and turn restrictions
//
// Both are free public services with fair-use limits, so
// requests are explicit (button-driven) and cached.
// =====================================================

import { DETAIL_LEVELS, MAIN_ROAD_CLASSES } from './roadDefaults.js';
import { expandBox } from './geo.js';

// Extra main-road margin downloaded around the selected area, so feeder
// roads can be traced back to the previous junction outside it.
export const DOWNLOAD_MARGIN_M = 700;

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// Public Overpass instances, tried in order when one is busy.
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const RETRY_ROUNDS = 2;
const RETRY_PAUSE_MS = 4000;

const OVERPASS_TIMEOUT_S = 90;
const cache = new Map();

// ---- Persistent cache (IndexedDB) --------------------------------
// Downloads are slow on the free servers, so keep them for a week.
// Any storage failure (private mode, quota) silently falls back to network.
const DB_NAME = 'urbangrid-osm-cache';
const STORE = 'overpass';
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readPersistent(key) {
  try {
    const db = await openDb();
    const value = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!value || Date.now() - value.storedAt > CACHE_TTL_MS) return null;
    return value.result;
  } catch {
    return null;
  }
}

async function writePersistent(key, result) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ storedAt: Date.now(), result }, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // cache is best-effort
  }
}

export async function searchPlaces(query, limit = 6) {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Place search failed (HTTP ${res.status})`);
  const data = await res.json();
  return data.map((p) => ({
    id: `${p.osm_type}-${p.osm_id}`,
    name: p.name || p.display_name.split(',')[0],
    displayName: p.display_name,
    type: p.addresstype || p.type,
    lat: Number(p.lat),
    lon: Number(p.lon),
    bbox: p.boundingbox
      ? {
        south: Number(p.boundingbox[0]),
        north: Number(p.boundingbox[1]),
        west: Number(p.boundingbox[2]),
        east: Number(p.boundingbox[3]),
      }
      : null,
  }));
}

const boxString = (b) => `${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}`;

// All roads of the chosen detail inside the area; main roads only in the margin.
export function buildRoadQuery(area, detailLevel = 'all', downloadBox = expandBox(area, DOWNLOAD_MARGIN_M)) {
  const classes = (DETAIL_LEVELS[detailLevel] || DETAIL_LEVELS.all).classes;
  const a = boxString(area);
  const d = boxString(downloadBox);
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];
(
  way["highway"~"^(${classes.join('|')})$"]["area"!="yes"](${a});
  way["highway"~"^(${MAIN_ROAD_CLASSES.join('|')})$"]["area"!="yes"](${d});
  node["highway"="traffic_signals"](${d});
  relation["type"="restriction"](${d});
);
out body;
>;
out skel qt;`;
}

async function postQuery(endpoint, query, signal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(), (OVERPASS_TIMEOUT_S + 15) * 1000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ data: query }).toString(),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // Busy servers answer 200 with an XML/HTML error page.
    if (!text.trimStart().startsWith('{')) {
      const reason = text.match(/<strong[^>]*>Error<\/strong>:([^<]*)/)?.[1]?.trim();
      throw new Error(reason ? `server busy (${reason.slice(0, 80)})` : 'non-JSON response');
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// onProgress receives { endpoint, attempt, total, status, error? }
// Returns { data, meta } where meta.downloadBox is the area plus margin.
export async function fetchRoadNetwork(area, { detailLevel = 'all', onProgress, signal } = {}) {
  const downloadBox = expandBox(area, DOWNLOAD_MARGIN_M);
  const query = buildRoadQuery(area, detailLevel, downloadBox);
  if (cache.has(query)) {
    onProgress?.({ status: 'cached' });
    return cache.get(query);
  }
  const stored = await readPersistent(query);
  if (stored) {
    cache.set(query, stored);
    onProgress?.({ status: 'cached', storedAt: stored.meta.fetchedAt });
    return { ...stored, meta: { ...stored.meta, durationMs: 0, fromCache: true } };
  }
  const errors = [];
  const attempts = [];
  for (let round = 0; round < RETRY_ROUNDS; round++) for (const endpoint of OVERPASS_ENDPOINTS) attempts.push({ endpoint, round });
  for (let i = 0; i < attempts.length; i++) {
    const { endpoint, round } = attempts[i];
    if (round > 0 && attempts[i - 1].round !== round) {
      onProgress?.({ status: 'pause', round: round + 1 });
      await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    }
    if (signal?.aborted) throw new Error('Cancelled');
    onProgress?.({ endpoint, attempt: i + 1, total: attempts.length, status: 'requesting' });
    const started = performance.now();
    try {
      const data = await postQuery(endpoint, query, signal);
      const result = {
        data,
        meta: {
          endpoint,
          query,
          area,
          downloadBox,
          fetchedAt: new Date().toISOString(),
          durationMs: Math.round(performance.now() - started),
          osmTimestamp: data.osm3s?.timestamp_osm_base || null,
          elementCount: data.elements?.length || 0,
        },
      };
      cache.set(query, result);
      writePersistent(query, result);
      return result;
    } catch (err) {
      if (signal?.aborted) throw new Error('Cancelled');
      const message = err.name === 'AbortError' ? 'timed out' : err.message;
      errors.push(`${new URL(endpoint).host}: ${message}`);
      onProgress?.({ endpoint, attempt: i + 1, total: attempts.length, status: 'failed', error: message });
    }
  }
  throw new Error(`The free OpenStreetMap servers are busy (${errors.slice(-OVERPASS_ENDPOINTS.length).join('; ')}). Try again in a few minutes, pick a smaller area, or import a saved OSM file.`);
}
