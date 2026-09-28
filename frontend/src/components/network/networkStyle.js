import { ROAD_CLASSES, SOURCES } from '../../network/roadDefaults.js';

export const JUNCTION_KINDS = {
  signalized:   { label: 'Signalized junction',   short: 'Signal',      color: '#f59e0b' },
  roundabout:   { label: 'Roundabout',            short: 'Roundabout',  color: '#a78bfa' },
  priority:     { label: 'Unsignalized junction', short: 'No signal',   color: '#38bdf8' },
  continuation: { label: 'Road continuation',     short: 'Continuation', color: '#64748b' },
  dead_end:     { label: 'Dead end',              short: 'Dead end',    color: '#475569' },
  boundary:     { label: 'Boundary entry / exit', short: 'Boundary',    color: '#10b981' },
};

export const SOURCE_BADGES = {
  [SOURCES.OSM]:     { label: 'OSM tag', color: '#10b981', hint: 'Read directly from an OpenStreetMap tag' },
  [SOURCES.DEFAULT]: { label: 'Default', color: '#f59e0b', hint: 'OSM has no value here; a per-road-class default is used' },
  [SOURCES.MIXED]:   { label: 'Mixed',   color: '#38bdf8', hint: 'Road spans several OSM sections, only some are tagged' },
  [SOURCES.DERIVED]: { label: 'Derived', color: '#a78bfa', hint: 'Computed from other parameters (formula shown)' },
};

export const COLOR_MODES = {
  class: 'Road class',
  lanes: 'Lanes',
  speed: 'Speed limit',
  source: 'Data quality',
};

const LANE_RAMP = ['#1e3a8a', '#1d4ed8', '#3b82f6', '#60a5fa', '#93c5fd', '#dbeafe'];
const SPEED_STOPS = [
  { max: 20, color: '#475569', label: '≤ 20 km/h' },
  { max: 30, color: '#0ea5e9', label: '21–30' },
  { max: 40, color: '#22c55e', label: '31–40' },
  { max: 50, color: '#eab308', label: '41–50' },
  { max: 70, color: '#f97316', label: '51–70' },
  { max: Infinity, color: '#ef4444', label: '> 70' },
];
const QUALITY = {
  full: { color: '#10b981', label: 'Lanes & speed from OSM' },
  partial: { color: '#f59e0b', label: 'One of them from OSM' },
  none: { color: '#64748b', label: 'Both use defaults' },
};

export function roadMetrics(road, linkById) {
  const links = road.linkIds.map((id) => linkById.get(id)).filter(Boolean);
  const totalLanes = links.reduce((s, l) => s + l.lanes.value, 0);
  const speed = links.length ? Math.max(...links.map((l) => l.speedKmh.value)) : 0;
  const osmCount = (key) => links.filter((l) => l[key].source === SOURCES.OSM).length;
  const lanesOsm = links.length && osmCount('lanes') === links.length;
  const speedOsm = links.length && osmCount('speedKmh') === links.length;
  return { links, totalLanes, speed, lanesOsm, speedOsm };
}

export function roadColor(road, metrics, mode) {
  if (mode === 'lanes') return LANE_RAMP[Math.min(LANE_RAMP.length - 1, Math.max(0, metrics.totalLanes - 1))];
  if (mode === 'speed') return SPEED_STOPS.find((s) => metrics.speed <= s.max).color;
  if (mode === 'source') {
    if (metrics.lanesOsm && metrics.speedOsm) return QUALITY.full.color;
    if (metrics.lanesOsm || metrics.speedOsm) return QUALITY.partial.color;
    return QUALITY.none.color;
  }
  return (ROAD_CLASSES[road.highway] || ROAD_CLASSES.unclassified).color;
}

export function roadWeight(metrics) {
  return Math.min(9, 1.6 + metrics.totalLanes * 0.9);
}

export function legendItems(mode, graph) {
  if (mode === 'lanes') {
    return LANE_RAMP.map((color, i) => ({ color, label: i === LANE_RAMP.length - 1 ? `${i + 1}+ lanes` : `${i + 1} lane${i ? 's' : ''}` }));
  }
  if (mode === 'speed') return SPEED_STOPS.map((s) => ({ color: s.color, label: s.label }));
  if (mode === 'source') return Object.values(QUALITY);
  const present = new Set(graph?.roads.map((r) => r.highway) || []);
  return Object.entries(ROAD_CLASSES)
    .filter(([key]) => !graph || present.has(key))
    .map(([, info]) => ({ color: info.color, label: info.label }));
}

export function junctionColor(j) {
  if (j.kind === 'boundary' && j.boundaryRole === 'exit') return '#f472b6';
  return JUNCTION_KINDS[j.kind]?.color || '#94a3b8';
}

export function junctionRadius(j, zoom = 15) {
  const scale = zoom >= 17 ? 1.5 : zoom >= 16 ? 1.25 : zoom >= 15 ? 1 : 0.8;
  let r;
  if (j.kind === 'boundary') r = 3.5;
  else if (j.kind === 'dead_end' || j.kind === 'continuation') r = 2;
  else if (j.kind === 'signalized' || j.kind === 'roundabout') r = 5 + Math.min(3, (j.arms?.length || 3) - 3);
  else r = 2.5 + Math.min(3, (j.arms?.length || 3) - 3) * 0.6;
  return r * scale;
}

export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60);
  return `${m} min ${Math.round(seconds - m * 60)} s`;
}

export function formatLength(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}
