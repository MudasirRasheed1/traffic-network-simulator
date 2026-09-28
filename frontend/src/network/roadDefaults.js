// =====================================================
// ROAD MODEL DEFAULTS & TAG PARSING
//
// OSM rarely tags every road with lanes / speed limits.
// When a tag is missing we fall back to a per-class default
// and record the parameter's source so the UI can show
// exactly where each number came from.
// =====================================================

export const ROAD_CLASSES = {
  motorway:       { label: 'Motorway',        lanesPerDir: 3, speedKmh: 80, rank: 10, color: '#f43f5e' },
  motorway_link:  { label: 'Motorway link',   lanesPerDir: 1, speedKmh: 40, rank: 9,  color: '#fb7185' },
  trunk:          { label: 'Trunk',           lanesPerDir: 2, speedKmh: 60, rank: 9,  color: '#f97316' },
  trunk_link:     { label: 'Trunk link',      lanesPerDir: 1, speedKmh: 40, rank: 8,  color: '#fb923c' },
  primary:        { label: 'Primary',         lanesPerDir: 2, speedKmh: 50, rank: 8,  color: '#f59e0b' },
  primary_link:   { label: 'Primary link',    lanesPerDir: 1, speedKmh: 30, rank: 7,  color: '#fbbf24' },
  secondary:      { label: 'Secondary',       lanesPerDir: 2, speedKmh: 40, rank: 7,  color: '#eab308' },
  secondary_link: { label: 'Secondary link',  lanesPerDir: 1, speedKmh: 30, rank: 6,  color: '#facc15' },
  tertiary:       { label: 'Tertiary',        lanesPerDir: 1, speedKmh: 40, rank: 6,  color: '#38bdf8' },
  tertiary_link:  { label: 'Tertiary link',   lanesPerDir: 1, speedKmh: 30, rank: 5,  color: '#7dd3fc' },
  unclassified:   { label: 'Unclassified',    lanesPerDir: 1, speedKmh: 30, rank: 4,  color: '#b4c0d3' },
  residential:    { label: 'Residential',     lanesPerDir: 1, speedKmh: 25, rank: 3,  color: '#8796ad' },
  living_street:  { label: 'Living street',   lanesPerDir: 1, speedKmh: 15, rank: 2,  color: '#6b7a90' },
};

export const MAIN_ROAD_CLASSES = [
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
];

export const LOCAL_ROAD_CLASSES = ['unclassified', 'residential', 'living_street'];

export const DETAIL_LEVELS = {
  main: { label: 'Main roads', classes: MAIN_ROAD_CLASSES },
  all: { label: 'Main + local streets', classes: [...MAIN_ROAD_CLASSES, ...LOCAL_ROAD_CLASSES] },
};

// Traffic-engineering constants used for derived link parameters.
export const MODEL_CONSTANTS = {
  laneWidthM: 3.5,          // used when OSM has no width tag
  saturationFlowPerLaneVph: 1800, // vehicles/hour/lane at green (HCM-style base)
  jamSpacingM: 7.5,         // road space per queued vehicle (car length + gap)
};

export const SOURCES = {
  OSM: 'osm',         // read directly from an OSM tag
  DEFAULT: 'default', // class default because the tag was missing
  DERIVED: 'derived', // computed from other parameters
  MIXED: 'mixed',     // road made of several OSM sections, only some tagged
};

export function roadClassInfo(highway) {
  return ROAD_CLASSES[highway] || ROAD_CLASSES.unclassified;
}

function parsePositiveNumber(raw) {
  if (raw == null) return null;
  const match = String(raw).match(/[0-9]+(\.[0-9]+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseLanes(raw) {
  const n = parsePositiveNumber(String(raw ?? '').split(';')[0]);
  return n == null ? null : Math.round(n);
}

export function parseMaxspeedKmh(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'walk') return 5;
  const n = parsePositiveNumber(s);
  if (n == null) return null;
  return s.includes('mph') ? Math.round(n * 1.609) : n;
}

export function parseWidthM(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  const n = parsePositiveNumber(s);
  if (n == null) return null;
  if (s.includes("'") || s.includes('ft')) return Math.round(n * 0.3048 * 10) / 10;
  return n;
}

// Returns 'both' | 'forward' | 'backward' relative to the way's node order.
export function parseOneway(tags = {}) {
  const v = String(tags.oneway ?? '').toLowerCase();
  if (v === '-1' || v === 'reverse') return 'backward';
  if (v === 'yes' || v === 'true' || v === '1') return 'forward';
  if (v === 'no' || v === 'false' || v === '0' || v === 'reversible' || v === 'alternating') return 'both';
  const junction = String(tags.junction ?? '').toLowerCase();
  if (junction === 'roundabout' || junction === 'circular') return 'forward';
  if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return 'forward';
  return 'both';
}

export function isRoundaboutTags(tags = {}) {
  const j = String(tags.junction ?? '').toLowerCase();
  return j === 'roundabout' || j === 'circular';
}

export function isExcludedByAccess(tags = {}) {
  const access = String(tags.access ?? '').toLowerCase();
  const motor = String(tags.motor_vehicle ?? tags.motorcar ?? '').toLowerCase();
  if (motor === 'yes' || motor === 'designated') return false;
  if (motor === 'no' || motor === 'private') return true;
  return access === 'no' || access === 'private';
}

// Lanes in one travel direction of a way part.
// `forwardAlongWay` = true when travel follows the way's node order.
export function lanesForDirection(tags, isOneway, forwardAlongWay) {
  const dirKey = forwardAlongWay ? 'lanes:forward' : 'lanes:backward';
  const dirLanes = parseLanes(tags[dirKey]);
  if (dirLanes != null) return { value: dirLanes, source: SOURCES.OSM, detail: `${dirKey}=${tags[dirKey]}` };

  const total = parseLanes(tags.lanes);
  if (total != null) {
    if (isOneway) return { value: total, source: SOURCES.OSM, detail: `lanes=${tags.lanes} (one-way)` };
    return {
      value: Math.max(1, Math.floor(total / 2)),
      source: SOURCES.OSM,
      detail: `lanes=${tags.lanes} split across two directions`,
    };
  }

  const info = roadClassInfo(tags.highway);
  return { value: info.lanesPerDir, source: SOURCES.DEFAULT, detail: `default for ${info.label.toLowerCase()} roads` };
}

export function speedForDirection(tags, forwardAlongWay) {
  const dirKey = forwardAlongWay ? 'maxspeed:forward' : 'maxspeed:backward';
  const dirSpeed = parseMaxspeedKmh(tags[dirKey]);
  if (dirSpeed != null) return { value: dirSpeed, source: SOURCES.OSM, detail: `${dirKey}=${tags[dirKey]}` };
  const speed = parseMaxspeedKmh(tags.maxspeed);
  if (speed != null) return { value: speed, source: SOURCES.OSM, detail: `maxspeed=${tags.maxspeed}` };
  const info = roadClassInfo(tags.highway);
  return { value: info.speedKmh, source: SOURCES.DEFAULT, detail: `default for ${info.label.toLowerCase()} roads` };
}
