// =====================================================
// TRAFFIC DATA FILES
// Turns a file of counted traffic into cars per simulation step, for the
// 'From data file' inflow function (grid and city simulators).
//
// All sources share one clock: step 0 is the earliest time in any data
// file (or a start the user sets), every step is the same number of
// seconds. The timeline is cut into windows of one step; each row pours
// its cars into the windows it covers.
//   Moments: each row is a time and the cars seen then (one window).
//   Periods: each row is a time span and the cars counted in it, spread
//            over its windows evenly, at random moments, or skewed
//            towards a point; a spread column can set this per row.
// Cars before step 0 are dropped; after the data ends a source sends no
// cars. A data-file source with no file loaded does not run.
// =====================================================

export const DATA_FILE_ACCEPT = '.csv,.tsv,.txt,.json,.xlsx';

export const DATA_KINDS = {
  moments: 'Time and cars',
  periods: 'Period and cars',
};

// How a period's cars are shared across its windows. Older settings may
// say 'random'; it now means the same as equal.
export const SPREADS = {
  even: 'Equal',
  skewed: 'Skewed',
};

// Where a skewed period's cars crowd: its first, middle or last windows.
export const SKEW_DIRECTIONS = [
  { key: 'left', label: 'Left', peak: 0 },
  { key: 'center', label: 'Center', peak: 0.5 },
  { key: 'right', label: 'Right', peak: 1 },
];

// How tightly a skewed period crowds around its peak.
export const SKEW_STRENGTHS = {
  mild: { label: 'Low', concentration: 2 },
  medium: { label: 'Medium', concentration: 5 },
  strong: { label: 'High', concentration: 12 },
};

export const DEFAULT_STEP_SECONDS = 5;

// Column names understood in a file (compared without case, spaces or dashes).
export const COLUMN_NAMES = {
  time: ['time', 'timestamp', 'datetime', 'date_time', 't', 'seconds', 'sec'],
  start: ['start', 'start_time', 'starttime', 'from', 'period_start', 'begin'],
  end: ['end', 'end_time', 'endtime', 'to', 'period_end', 'until'],
  interval: ['interval', 'period', 'window'],
  spread: ['spread', 'distribution', 'shape'],
  count: ['vehicles', 'vehicle', 'cars', 'car', 'count', 'counts', 'volume', 'flow', 'vehicle_count', 'vehicles_count'],
};

const ONE_PER_ROW = 'One car per row';
const DAY = 86400;

const normName = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

// ---------------------------------------------------------------
// Reading a file into rows (first row: column names)
// ---------------------------------------------------------------

function splitCsvLine(line, delimiter) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { cells.push(cell); cell = ''; } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

export function parseDelimitedText(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const head = lines[0];
  const counts = [',', ';', '\t', '|'].map((d) => [d, head.split(d).length - 1]).sort((a, b) => b[1] - a[1]);
  if (counts[0][1] > 0) return lines.map((l) => splitCsvLine(l, counts[0][0]));
  // No separator character: columns split by spaces.
  return lines.map((l) => l.trim().split(/\s+/));
}

function rowsFromJson(json) {
  const list = Array.isArray(json) ? json : json?.rows || json?.data || json?.records;
  if (!Array.isArray(list) || !list.length) throw new Error('The JSON file has no list of rows.');
  if (Array.isArray(list[0])) return list;
  const keys = [];
  for (const item of list) for (const k of Object.keys(item || {})) if (!keys.includes(k)) keys.push(k);
  return [keys, ...list.map((item) => keys.map((k) => item?.[k]))];
}

// file: a browser File. Returns rows (arrays of cells), header first.
export async function readDataFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    return readSheet(file);
  }
  if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported. Save the sheet as .xlsx or .csv.');
  const text = await file.text();
  if (name.endsWith('.json')) {
    let json;
    try { json = JSON.parse(text); } catch { throw new Error('The JSON file could not be read.'); }
    return rowsFromJson(json);
  }
  return parseDelimitedText(text);
}

// ---------------------------------------------------------------
// Times
// ---------------------------------------------------------------

// Seconds from a cell: plain seconds, a clock time or a date and time.
// kind says which, so clock times can roll over midnight.
export function parseTime(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // Excel keeps a time-only cell (08:00) as that time on 30 Dec 1899.
    if (value.getUTCFullYear() < 1900) return { seconds: value.getUTCHours() * 3600 + value.getUTCMinutes() * 60 + value.getUTCSeconds(), kind: 'clock' };
    return { seconds: value.getTime() / 1000, kind: 'date' };
  }
  if (typeof value === 'number') return Number.isFinite(value) ? { seconds: value, kind: 'number' } : null;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  if (/^[-+]?\d+(\.\d+)?$/.test(s)) return { seconds: Number(s), kind: 'number' };
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(am|pm)?$/i.exec(s);
  if (clock) {
    let h = Number(clock[1]);
    const ampm = clock[4]?.toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return { seconds: h * 3600 + Number(clock[2]) * 60 + Number(clock[3] || 0), kind: 'clock' };
  }
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(s) ? s.replace(' ', 'T') : s;
  if (!/\d{4}/.test(iso)) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : { seconds: ms / 1000, kind: 'date' };
}

// "08:00-08:15", "08:00 to 08:15", "2026-10-26 08:00 - 2026-10-26 08:15"
export function parseInterval(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  const word = /^(.+?)\s+(?:to|until)\s+(.+)$/i.exec(s) || /^(.+?)\s*[–—]\s*(.+)$/.exec(s);
  if (word) {
    const a = parseTime(word[1]);
    const b = parseTime(word[2]);
    if (a && b) return [a, b];
  }
  for (let i = s.indexOf('-'); i > 0; i = s.indexOf('-', i + 1)) {
    const a = parseTime(s.slice(0, i));
    const b = parseTime(s.slice(i + 1));
    if (a && b) return [a, b];
  }
  return null;
}

// Clock times only: a time much earlier than the one before is the next day.
function unwrapClock(times) {
  let offset = 0;
  let prev = null;
  return times.map((t) => {
    if (!t) return null;
    if (t.kind !== 'clock') return t.seconds;
    if (prev != null && t.seconds + offset < prev - DAY / 2) offset += DAY;
    prev = t.seconds + offset;
    return prev;
  });
}

// ---------------------------------------------------------------
// Rows into a dataset
// ---------------------------------------------------------------

function findColumn(headers, names) {
  return headers.findIndex((h) => names.includes(normName(h)));
}

function toCount(value) {
  if (isBlank(value)) return 0;
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * rows: header row first. Returns
 * { fileName, kind, times, ends, counts: { column: number[] }, columns,
 *   rowCount, errors: [{ row, text }] }
 * `times` are seconds (moment, or period start); `ends` are period ends
 * from the file, or null where they follow from the next start.
 */
export function buildDataset(rows, fileName = 'data') {
  if (!rows?.length) return { fileName, errors: [{ row: null, text: 'The file is empty.' }] };
  let headers = rows[0].map((h) => (h == null ? '' : String(h).trim()));
  let first = 1;
  // No column names: the first row is data. Use time, cars.
  if (parseTime(rows[0][0]) && (rows[0].length < 2 || toCount(rows[0][1]) != null)) {
    headers = rows[0].map((_, k) => (k === 0 ? 'time' : k === 1 ? 'vehicles' : `column ${k + 1}`));
    first = 0;
  }
  // Each row keeps its line number in the file for messages.
  const body = rows.slice(first).map((r, i) => Object.assign(r || [], { rowNo: i + first + 1 })).filter((r) => r.some((c) => !isBlank(c)));
  if (!body.length) return { fileName, errors: [{ row: null, text: 'The file has column names but no rows.' }] };

  const col = {
    time: findColumn(headers, COLUMN_NAMES.time),
    start: findColumn(headers, COLUMN_NAMES.start),
    end: findColumn(headers, COLUMN_NAMES.end),
    interval: findColumn(headers, COLUMN_NAMES.interval),
    spread: findColumn(headers, COLUMN_NAMES.spread),
  };
  const kind = col.interval >= 0 || col.start >= 0 ? 'periods' : 'moments';
  if (kind === 'moments' && col.time < 0) {
    // No known name: a first column that holds times.
    if (body.slice(0, 5).every((r) => parseTime(r[0]))) col.time = 0;
    else {
      return {
        fileName,
        errors: [{ row: null, text: `No time column found. Name it one of: ${[...COLUMN_NAMES.time, ...COLUMN_NAMES.start, ...COLUMN_NAMES.interval].join(', ')}.` }],
      };
    }
  }
  const timeCols = new Set(Object.values(col).filter((k) => k >= 0));
  // Cars: columns with a known name or any other column of numbers
  // (one per source, named after it).
  let countCols = headers
    .map((h, k) => k)
    .filter((k) => !timeCols.has(k) && headers[k] !== '')
    .filter((k) => COLUMN_NAMES.count.includes(normName(headers[k])) || body.slice(0, 20).every((r) => toCount(r[k]) != null));
  const known = countCols.filter((k) => COLUMN_NAMES.count.includes(normName(headers[k])));
  if (known.length) countCols = [...known, ...countCols.filter((k) => !known.includes(k))];

  const errors = [];
  const starts = [];
  const ends = [];
  const rowNos = [];
  const spreads = [];
  const counts = Object.fromEntries(countCols.map((k) => [headers[k], []]));
  if (!countCols.length) counts[ONE_PER_ROW] = [];
  body.forEach((r) => {
    const { rowNo } = r;
    let start = null;
    let end = null;
    if (kind === 'moments') {
      start = parseTime(r[col.time]);
      if (!start) { errors.push({ row: rowNo, text: `time "${r[col.time] ?? ''}" is not readable` }); return; }
    } else if (col.interval >= 0) {
      const pair = parseInterval(r[col.interval]);
      if (!pair) { errors.push({ row: rowNo, text: `period "${r[col.interval] ?? ''}" is not readable` }); return; }
      [start, end] = pair;
    } else {
      start = parseTime(r[col.start]);
      if (!start) { errors.push({ row: rowNo, text: `start "${r[col.start] ?? ''}" is not readable` }); return; }
      if (col.end >= 0 && !isBlank(r[col.end])) {
        end = parseTime(r[col.end]);
        if (!end) { errors.push({ row: rowNo, text: `end "${r[col.end]}" is not readable` }); return; }
      }
    }
    const code = col.spread >= 0 && !isBlank(r[col.spread]) ? String(r[col.spread]).trim() : null;
    if (code && !parseSpreadCode(code)) { errors.push({ row: rowNo, text: `spread "${code}" is not a known code (for example even, random, left-high, center-medium, peak-30-low)` }); return; }
    const values = countCols.map((k) => toCount(r[k]));
    const bad = values.findIndex((v) => v == null);
    if (bad >= 0) { errors.push({ row: rowNo, text: `cars "${r[countCols[bad]]}" in ${headers[countCols[bad]]} must be a number of 0 or more` }); return; }
    starts.push(start);
    rowNos.push(rowNo);
    spreads.push(code);
    ends.push(end);
    countCols.forEach((k, j) => counts[headers[k]].push(values[j]));
    if (!countCols.length) counts[ONE_PER_ROW].push(1);
  });

  const times = unwrapClock(starts);
  // A period's end follows its start on the clock too.
  const endSeconds = ends.map((e, i) => {
    if (!e) return null;
    if (e.kind !== 'clock') return e.seconds;
    let s = e.seconds + (times[i] - starts[i].seconds);
    if (s <= times[i]) s += DAY;
    return s;
  });
  endSeconds.forEach((e, i) => {
    if (e != null && e <= times[i]) errors.push({ row: rowNos[i], text: 'the period ends before it starts' });
  });
  if (kind === 'periods' && times.length === 1 && endSeconds[0] == null) {
    errors.push({ row: rowNos[0], text: 'a single period needs an end time' });
  }
  if (!times.length && !errors.length) errors.push({ row: null, text: 'No usable rows.' });
  // One time format per file, so files can be lined up with each other.
  const timeKinds = new Set(starts.map((t) => t.kind));
  if (timeKinds.size > 1) errors.push({ row: null, text: 'Use one time format in the whole file (plain seconds, clock times or dates).' });
  return {
    fileName,
    kind,
    times,
    ends: endSeconds.some((e) => e != null) ? endSeconds : null,
    timeKind: [...timeKinds][0] || 'number',
    spreads: spreads.some(Boolean) ? spreads : null,
    counts,
    columns: Object.keys(counts),
    rowCount: times.length,
    errors,
  };
}

// The column for a source: one named after it, else the first cars column.
export function matchColumn(columns, sourceNames = []) {
  const wanted = sourceNames.filter(Boolean).map(normName);
  return columns.find((c) => wanted.includes(normName(c)));
}

export function pickColumn(columns, sourceNames = []) {
  return matchColumn(columns, sourceNames) || columns[0];
}

// What the inflow function stores.
export function makeDataConfig(dataset, sourceNames = [], previous = {}) {
  return {
    fileName: dataset.fileName,
    kind: dataset.kind,
    detectedKind: dataset.kind,
    timeKind: dataset.timeKind,
    times: dataset.times,
    ends: dataset.ends,
    counts: dataset.counts,
    spreads: dataset.spreads,
    column: pickColumn(dataset.columns, sourceNames),
    spread: previous.spread === 'skewed' ? 'skewed' : 'even',
    skewPeak: previous.skewPeak ?? 0.5,
    skewStrength: previous.skewStrength || 'medium',
  };
}

// ---------------------------------------------------------------
// Spread codes (the optional `spread` column, one per period row)
// ---------------------------------------------------------------

const PLACES = { left: 0, start: 0, early: 0, center: 0.5, centre: 0.5, middle: 0.5, mid: 0.5, right: 1, end: 1, late: 1 };
const STRENGTH_WORDS = { low: 'mild', mild: 'mild', medium: 'medium', med: 'medium', high: 'strong', strong: 'strong' };

/**
 * equal, or a direction and a skewness: left-high, center-medium,
 * right-low. Older codes are still read: even, random (both equal),
 * peak-30-high, and a -random ending (ignored). Returns
 * { type: 'even' | 'skewed', peak, strength } or null.
 */
export function parseSpreadCode(value) {
  const s = String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/%/g, '');
  if (['even', 'uniform', 'equal', 'random', 'rand'].includes(s)) return { type: 'even' };
  const place = /^([a-z]+)-([a-z]+)(-random)?$/.exec(s);
  if (place && place[1] in PLACES && place[2] in STRENGTH_WORDS) {
    return { type: 'skewed', peak: PLACES[place[1]], strength: STRENGTH_WORDS[place[2]] };
  }
  const peak = /^peak-?(\d{1,3})-([a-z]+)(-random)?$/.exec(s);
  if (peak && Number(peak[1]) <= 100 && peak[2] in STRENGTH_WORDS) {
    return { type: 'skewed', peak: Number(peak[1]) / 100, strength: STRENGTH_WORDS[peak[2]] };
  }
  return null;
}

// ---------------------------------------------------------------
// One clock for every source
// ---------------------------------------------------------------

const minOf = (xs) => xs.reduce((m, x) => (x < m ? x : m), Infinity);
const TIME_KIND_NAMES = { number: 'plain seconds', clock: 'clock times', date: 'dates and times' };

// Files loaded before formats were recorded: dates are large numbers
// (seconds since 1970); anything else counts as plain seconds.
const timeKindOf = (data) => data.timeKind || (minOf(data.times) > 1e8 ? 'date' : 'number');

export const isDataProfile = (profile) => profile?.mode === 'function' && profile.functionConfig?.profileType === 'data';

/**
 * The shared timeline of a scenario: step 0 starts at the earliest time in
 * any data file (or at `start`, if given), every step is `stepSeconds` long.
 * entries: [{ label, profile }]. Returns { origin, stepSeconds, earliest,
 * earliestLabel, timeKind, error }.
 */
export const DEFAULT_SPREAD = { spread: 'even', skewPeak: 0.5, skewStrength: 'medium' };

export function dataTimeline(entries, { stepSeconds = DEFAULT_STEP_SECONDS, start = null, spread = null } = {}) {
  const S = Math.max(0.1, Number(stepSeconds) || DEFAULT_STEP_SECONDS);
  const loaded = entries.filter(({ profile }) => isDataProfile(profile) && profile.functionConfig.data?.times?.length);
  const timeline = {
    origin: null,
    stepSeconds: S,
    start: start != null && String(start).trim() !== '' ? String(start).trim() : null,
    // How periods spread their cars unless a row has its own code: one
    // default for every source.
    spread: { ...DEFAULT_SPREAD, ...(spread || {}) },
    earliest: null,
    earliestLabel: null,
    timeKind: null,
    error: null,
  };
  if (!loaded.length) return timeline;
  const kinds = new Set(loaded.map(({ profile }) => timeKindOf(profile.functionConfig.data)));
  if (kinds.size > 1) {
    timeline.error = `The data files use different time formats (${[...kinds].map((k) => TIME_KIND_NAMES[k]).join(', ')}). Use the same format in every file so they line up.`;
    return timeline;
  }
  timeline.timeKind = [...kinds][0] || 'number';
  for (const { label, profile } of loaded) {
    const first = minOf(profile.functionConfig.data.times);
    if (timeline.earliest == null || first < timeline.earliest) {
      timeline.earliest = first;
      timeline.earliestLabel = label;
    }
  }
  timeline.origin = timeline.earliest;
  if (start != null && String(start).trim() !== '') {
    const t = parseTime(String(start));
    if (!t) timeline.error = `The start "${start}" is not a readable time.`;
    else if (timeline.timeKind === 'date' && t.kind === 'clock') {
      // A clock time on the day the data begins.
      const day = new Date(timeline.earliest * 1000);
      day.setHours(0, 0, 0, 0);
      timeline.origin = day.getTime() / 1000 + t.seconds;
    } else if (t.kind === timeline.timeKind || (t.kind === 'number' && timeline.timeKind === 'number')) timeline.origin = t.seconds;
    else timeline.error = `The start "${start}" is not in the files' time format (${TIME_KIND_NAMES[timeline.timeKind]}).`;
  }
  return timeline;
}

// Every data profile on the shared timeline; returns the new entries and
// any timeline problem.
export function alignDataEntries(entries, settings) {
  const timeline = dataTimeline(entries, settings);
  const aligned = new Map();
  const place = (profile) => {
    if (!isDataProfile(profile)) return profile;
    if (!aligned.has(profile)) {
      const data = profile.functionConfig.data || {};
      aligned.set(profile, { ...profile, functionConfig: { ...profile.functionConfig, data: { ...data, ...timeline.spread, origin: timeline.origin, stepSeconds: timeline.stepSeconds } } });
    }
    return aligned.get(profile);
  };
  return { entries: entries.map((e) => ({ ...e, profile: place(e.profile) })), timeline };
}

export function formatDataTime(seconds, timeKind) {
  if (seconds == null) return '';
  if (timeKind === 'date') return new Date(seconds * 1000).toLocaleString();
  if (timeKind === 'clock') {
    const s = ((Math.round(seconds) % DAY) + DAY) % DAY;
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((v) => String(v).padStart(2, '0')).join(':');
  }
  return `${seconds} s`;
}

// ---------------------------------------------------------------
// Cars per step: cut the shared timeline into windows of one step each,
// then pour every row's cars into the windows it covers.
// ---------------------------------------------------------------

// Periods: ends from the file, else the next start; the last period is
// as long as the one before it.
function periodEnds(data, S) {
  const n = data.times.length;
  const order = data.times.map((_, i) => i).sort((a, b) => data.times[a] - data.times[b]);
  const ends = new Array(n);
  order.forEach((i, k) => {
    const given = data.ends?.[i];
    if (given != null) { ends[i] = given; return; }
    const next = order.slice(k + 1).find((j) => data.times[j] > data.times[i]);
    if (next != null) ends[i] = data.times[next];
    else {
      const prev = k > 0 ? order[k - 1] : null;
      const len = prev != null ? ends[prev] - data.times[prev] : 0;
      ends[i] = data.times[i] + Math.max(len, S);
    }
  });
  return ends;
}

// Each row on the timeline, in steps from step 0 (fractions allowed).
function rowSpans(data) {
  const S = Math.max(0.001, Number(data.stepSeconds) || DEFAULT_STEP_SECONDS);
  const origin = data.origin ?? minOf(data.times);
  if (data.kind === 'periods') {
    const ends = periodEnds(data, S);
    return data.times.map((s, i) => [(s - origin) / S, (ends[i] - origin) / S]);
  }
  return data.times.map((t) => [(t - origin) / S, null]);
}

// How many steps from step 0 the data reaches.
export function dataStepCount(data) {
  if (!data?.times?.length) return 0;
  return rowSpans(data).reduce((m, [a, b]) => Math.max(m, b == null ? Math.floor(a + 1e-9) + 1 : Math.ceil(b - 1e-9)), 0);
}

// Skewed shapes: a Beta curve with its highest point at `peak` (0 = start
// of the period, 1 = end). Its running total, tabulated once per shape.
const CDF_POINTS = 2000;
const cdfCache = new Map();
function skewCdf(peak, strength) {
  const c = (SKEW_STRENGTHS[strength] || SKEW_STRENGTHS.medium).concentration;
  const m = Math.min(1, Math.max(0, Number(peak) || 0));
  const key = `${m}|${c}`;
  if (!cdfCache.has(key)) {
    const alpha = 1 + c * m;
    const beta = 1 + c * (1 - m);
    const table = new Float64Array(CDF_POINTS + 1);
    for (let k = 0; k < CDF_POINTS; k++) {
      const x = (k + 0.5) / CDF_POINTS;
      table[k + 1] = table[k] + x ** (alpha - 1) * (1 - x) ** (beta - 1);
    }
    const total = table[CDF_POINTS] || 1;
    for (let k = 0; k <= CDF_POINTS; k++) table[k] /= total;
    cdfCache.set(key, table);
  }
  return cdfCache.get(key);
}
const cdfAt = (table, x) => {
  const p = Math.min(1, Math.max(0, x)) * CDF_POINTS;
  const k = Math.min(CDF_POINTS - 1, Math.floor(p));
  return table[k] + (table[k + 1] - table[k]) * (p - k);
};

// A row's cars per window it touches: [window, exact amount]. Even, or
// following a skewed shape; each window gets the share of the period's
// time (or of the shape) that falls inside it.
function windowAmounts(a, b, n, table) {
  const len = b - a;
  const share = (t) => (table ? cdfAt(table, (t - a) / len) : (t - a) / len);
  const out = [];
  for (let k = Math.floor(a); k < Math.ceil(b - 1e-9); k++) {
    const from = Math.max(a, k);
    const to = Math.min(b, k + 1);
    if (to > from) out.push([k, n * (share(to) - share(from))]);
  }
  return out;
}

// Random: every window gets its amount rounded down or up, and which
// windows are rounded up is random (likelier the larger the fraction).
// No window strays more than one car from its amount; the total is exact.
function randomRound(parts, random) {
  const whole = parts.map(([k, v]) => [k, Math.floor(v + 1e-9), v - Math.floor(v + 1e-9)]);
  let extra = Math.round(parts.reduce((s, [, v]) => s + v, 0) + 1e-9) - whole.reduce((s, [, c]) => s + c, 0);
  const order = whole
    .filter(([, , f]) => f > 1e-9)
    .map((w) => ({ w, key: random() ** (1 / w[2]) }))
    .sort((x, y) => y.key - x.key);
  for (const { w } of order) {
    if (extra <= 0) break;
    w[1] += 1;
    extra -= 1;
  }
  return whole.map(([k, c]) => [k, c]);
}

// Shares of a skewed period per whole window, for tests and the docs.
export function skewWeights(len, peak, strength) {
  const table = skewCdf(peak, strength);
  return Array.from({ length: len }, (_, k) => cdfAt(table, (k + 1) / len) - cdfAt(table, k / len));
}

// Whole cars per step whose running total stays as close as possible to
// the exact amounts (and ends on the exact total).
function roundRunning(amounts) {
  let total = 0;
  let sent = 0;
  return amounts.map((v) => {
    total += v || 0;
    const now = Math.round(total + 1e-9);
    const cars = now - sent;
    sent = now;
    return cars;
  });
}

// The spread of one row: its own code from the file, else the panel's.
function spreadOf(data, i) {
  const own = data.spreads?.[i] ? parseSpreadCode(data.spreads[i]) : null;
  if (own) return own;
  if (data.spread === 'skewed') return { type: 'skewed', peak: data.skewPeak ?? 0.5, strength: data.skewStrength || 'medium' };
  return { type: 'even' };
}

/**
 * Cars per step from step 0 of the shared timeline (data.origin; the
 * file's own first time when used alone). Cars falling before step 0 are
 * dropped; after the data ends the source sends none. `random` returns
 * numbers in [0, 1); the engines pass their seeded generator. `data.scale`
 * (Extract Details levels) multiplies every count.
 */
export function buildDataSeries(data, random = Math.random) {
  const values = data?.counts?.[data.column] || [];
  if (!data?.times?.length || !values.length) return [];
  const scale = Number.isFinite(Number(data.scale)) ? Number(data.scale) : 1;
  const amounts = [];
  const placed = [];
  const add = (list, k, v) => { if (k >= 0) list[k] = (list[k] || 0) + v; };
  rowSpans(data).forEach(([a, b], i) => {
    const n = (values[i] || 0) * scale;
    if (!n) return;
    if (b == null) { add(amounts, Math.floor(a + 1e-9), n); return; } // a moment: one window
    const spread = spreadOf(data, i);
    const table = spread.type === 'skewed' ? skewCdf(spread.peak, spread.strength) : null;
    // Each window: its share rounded down or up, the extra cars on random windows.
    for (const [k, c] of randomRound(windowAmounts(a, b, n, table), random)) add(placed, k, c);
  });
  // As long as the data reaches, so empty windows at its end count too.
  const length = Math.max(amounts.length, placed.length, dataStepCount(data));
  const whole = roundRunning(Array.from({ length }, (_, k) => amounts[k] || 0));
  return whole.map((v, k) => v + (placed[k] || 0));
}

// Data-file sources with no file loaded: one message, or null.
// entries: [{ label, profile }]
export function missingDataMessage(entries) {
  const missing = entries
    .filter(({ profile }) => isDataProfile(profile) && !profile.functionConfig.data?.times?.length)
    .map(({ label }) => label);
  if (!missing.length) return null;
  const listed = missing.length > 4 ? [...missing.slice(0, 4), `${missing.length - 4} more`] : missing;
  return `No data file loaded for ${listed.join(', ')}. Load a file or choose another inflow.`;
}

// Extract Details: a data source keeps its file, scaled by the level.
export function scaleDataProfile(profile, scale) {
  return { ...profile, functionConfig: { ...profile.functionConfig, data: { ...profile.functionConfig.data, scale } } };
}

export function describeSteps(steps, stepSeconds) {
  const secs = steps * (Number(stepSeconds) || DEFAULT_STEP_SECONDS);
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
