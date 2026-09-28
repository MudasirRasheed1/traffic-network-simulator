// =====================================================
// MAP SCENES
// Turn a network (full road graph or city graph) into plain
// drawing instructions for NetworkMap:
//   lines / points / markers / arrows / labels, plus
//   per-selection highlight specs and a focus point.
// =====================================================

import { pointAlong } from '../../network/geo.js';
import {
  JUNCTION_KINDS,
  junctionColor,
  junctionRadius,
  roadColor,
  roadMetrics,
  roadWeight,
} from './networkStyle.js';

const zoomScale = (zoom) => (zoom >= 17 ? 1.5 : zoom >= 16 ? 1.25 : zoom >= 15 ? 1 : 0.8);

// ---------------------------------------------------------------
// Full road graph
// ---------------------------------------------------------------
export function buildFullGraphScene(graph, colorBy) {
  const linkById = new Map(graph.links.map((l) => [l.id, l]));
  const roadById = new Map(graph.roads.map((r) => [r.id, r]));
  const junctionById = new Map(graph.junctions.map((j) => [j.id, j]));
  const metricsByRoad = new Map(graph.roads.map((r) => [r.id, roadMetrics(r, linkById)]));

  const lines = graph.roads.map((road) => {
    const m = metricsByRoad.get(road.id);
    return {
      key: road.id,
      coords: road.coords,
      color: roadColor(road, m, colorBy),
      weight: roadWeight(m),
      tooltip: `<strong>${road.name || 'Unnamed road'}</strong><br/>${road.id} · ${Math.round(road.lengthM)} m · ${m.totalLanes} lane(s)`,
      select: { type: 'road', id: road.id },
    };
  });

  const points = graph.junctions.map((j) => {
    const color = junctionColor(j);
    const boundary = j.kind === 'boundary';
    const kindLabel = boundary ? (j.boundaryRole === 'exit' ? 'Boundary exit' : 'Boundary entry') : JUNCTION_KINDS[j.kind]?.label;
    return {
      key: j.id,
      lat: j.lat,
      lon: j.lon,
      radius: (zoom) => junctionRadius(j, zoom),
      stroke: boundary ? color : '#0b0f19',
      strokeWeight: boundary ? 2 : 1.5,
      fill: boundary ? '#0b0f19' : color,
      tooltip: `<strong>${j.name || j.id}</strong><br/>${j.id} · ${kindLabel}${!boundary ? ` · ${j.arms.length} arms` : ''}`,
      select: { type: 'junction', id: j.id },
    };
  });

  const internal = graph.internalGeometry.map((g) => ({ coords: g.coords, color: g.roundabout ? '#a78bfa' : '#94a3b8' }));

  const highlight = (selection) => {
    if (selection?.type === 'junction') {
      const j = junctionById.get(selection.id);
      if (!j) return null;
      return {
        glow: j.legs.map((leg) => {
          const road = roadById.get(leg.roadId);
          return { coords: road.coords, weight: roadWeight(metricsByRoad.get(road.id)) };
        }),
        dashed: graph.internalGeometry.filter((g) => g.junctionId === j.id).map((g) => g.coords),
        dots: j.osmNodes.map((n) => [n.lat, n.lon]),
        rings: [{ lat: j.lat, lon: j.lon, radius: (z) => junctionRadius(j, z) + 6 }],
      };
    }
    if (selection?.type === 'road') {
      const road = roadById.get(selection.id);
      if (!road) return null;
      const ends = [junctionById.get(road.from), junctionById.get(road.to)];
      return {
        glow: [{ coords: road.coords, weight: roadWeight(metricsByRoad.get(road.id)) }],
        arrows: road.linkIds.map((id) => ({
          coords: id.endsWith('f') ? road.coords : road.coords.slice().reverse(),
          fraction: road.linkIds.length > 1 ? 0.35 : 0.5,
        })),
        rings: ends.map((j) => ({ lat: j.lat, lon: j.lon, radius: (z) => junctionRadius(j, z) + 6 })),
      };
    }
    return null;
  };

  const focus = (selection) => {
    if (selection?.type === 'junction') {
      const j = junctionById.get(selection.id);
      return j ? [j.lat, j.lon] : null;
    }
    if (selection?.type === 'road') {
      const r = roadById.get(selection.id);
      return r ? pointAlong(r.coords, r.lengthM / 2) : null;
    }
    return null;
  };

  return { lines, points, internal, highlight, focus };
}

// ---------------------------------------------------------------
// City graph — the simple node/edge picture the policy runs on
// ---------------------------------------------------------------
export const CITY_COLORS = {
  intersection: '#f59e0b',
  roundaboutRing: '#a78bfa',
  road: '#cbd5e1',
  roadOnLight: '#475569',
  feeder: '#2dd4bf',
  exit: '#f472b6',
  connector: '#2dd4bf',
};

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function gatewayColors(role) {
  if (role === 'source') return { fill: CITY_COLORS.feeder, border: CITY_COLORS.feeder };
  if (role === 'sink') return { fill: CITY_COLORS.exit, border: CITY_COLORS.exit };
  return { fill: CITY_COLORS.feeder, border: CITY_COLORS.exit };
}

// Live colouring while a simulation runs.
export const QUEUE_STOPS = [
  { max: 5, color: '#22c55e', label: '≤ 5 queued' },
  { max: 15, color: '#eab308', label: '6–15' },
  { max: 30, color: '#f97316', label: '16–30' },
  { max: Infinity, color: '#ef4444', label: '> 30' },
];
export const LOAD_STOPS = [
  { max: 0.25, color: '#64748b', label: '< 25% full' },
  { max: 0.5, color: '#eab308', label: '25–50%' },
  { max: 0.8, color: '#f97316', label: '50–80%' },
  { max: Infinity, color: '#ef4444', label: '> 80%' },
];
const stopColor = (stops, v) => stops.find((st) => v <= st.max).color;

/**
 * live (optional): { queues: {intersectionId: n}, phases: {id: name},
 *                    edgeCars: {edgeId: n}, edgeStorage: {edgeId: n} }
 * marked (optional): Set of node/road ids to flag as user-overridden.
 */
export function buildCityScene(city, { shape = 'straight', showLabels = true, live = null, marked = null, lightMap = false } = {}) {
  const edgeById = new Map(city.edges.map((e) => [e.id, e]));
  const nodeById = new Map([...city.intersections, ...city.gateways].map((n) => [n.id, n]));
  const gatewayIds = new Set(city.gateways.map((g) => g.id));
  const roadById = new Map(city.roads.map((r) => [r.id, r]));
  const pos = (id) => [nodeById.get(id).lat, nodeById.get(id).lon];
  const coordsOf = (e) => (shape === 'straight' ? [pos(e.from), pos(e.to)] : e.coords);
  const roadCoords = (r) => {
    const e = edgeById.get(r.edgeIds[0]);
    return shape === 'straight' ? [pos(r.a), pos(r.b)] : e.coords;
  };
  const roadLanes = (r) => r.edgeIds.reduce((s, id) => s + edgeById.get(id).lanes.value, 0);
  const weightOf = (r) => Math.min(9, 2 + roadLanes(r) * 0.9);
  const roadLoad = (r) => {
    const cars = r.edgeIds.reduce((s2, id) => s2 + (live.edgeCars[id] || 0), 0);
    const storage = r.edgeIds.reduce((s2, id) => s2 + (live.edgeStorage[id] || 1), 0);
    return { cars, load: cars / storage };
  };
  const roadColor = (r) => {
    if (live && r.kind === 'internal') return stopColor(LOAD_STOPS, roadLoad(r).load);
    if (r.kind === 'internal') return lightMap ? CITY_COLORS.roadOnLight : CITY_COLORS.road;
    const kinds = new Set(r.edgeIds.map((id) => edgeById.get(id).kind));
    return kinds.has('feeder') ? CITY_COLORS.feeder : CITY_COLORS.exit;
  };
  const arrowColor = (e) => (e.kind === 'feeder' ? CITY_COLORS.feeder : e.kind === 'exit' ? CITY_COLORS.exit : '#f8fafc');

  const lines = city.roads.map((r) => {
    const edges = r.edgeIds.map((id) => edgeById.get(id));
    const name = edges.find((e) => e.name)?.name;
    const label = r.kind === 'internal' ? 'road' : edges.some((e) => e.kind === 'feeder') ? 'feeder road' : 'exit road';
    return {
      key: r.id,
      coords: roadCoords(r),
      color: roadColor(r),
      weight: weightOf(r),
      dash: edges.every((e) => e.connector) ? '6 5' : null,
      tooltip: `<strong>${escapeHtml(name || 'Unnamed road')}</strong><br/>${r.a} ↔ ${r.b} · ${label} · ${roadLanes(r)} lane(s)${live ? ` · ${roadLoad(r).cars} car(s) driving` : ''}${marked?.has(r.id) ? ' · <em>edited</em>' : ''}`,
      select: { type: 'road', id: r.id },
    };
  });

  // Direction arrows: one per directed edge, offset along the line.
  const arrows = city.edges.map((e) => {
    const road = roadById.get(e.roadId);
    const twoWay = road.edgeIds.length > 1;
    return { coords: coordsOf(e), fraction: twoWay ? 0.62 : 0.55, color: arrowColor(e), size: 14 };
  });

  const points = city.intersections.map((i) => ({
    key: i.id,
    lat: i.lat,
    lon: i.lon,
    radius: (z) => (6 + (i.armCount === 4 ? 1.5 : 0) + (live ? Math.min(5, (live.queues[i.id] || 0) / 8) : 0)) * zoomScale(z),
    stroke: marked?.has(i.id) ? '#f8fafc' : i.originalKind === 'roundabout' ? CITY_COLORS.roundaboutRing : '#0b0f19',
    strokeWeight: marked?.has(i.id) || i.originalKind === 'roundabout' ? 3 : 2,
    fill: live ? stopColor(QUEUE_STOPS, live.queues[i.id] || 0) : CITY_COLORS.intersection,
    tooltip: `<strong>${escapeHtml(i.name || i.id)}</strong><br/>${i.id} · ${i.armCount}-arm signalized${i.originalKind === 'roundabout' ? ' · roundabout' : ''}${live ? `<br/>${live.queues[i.id] || 0} queued · phase ${live.phases[i.id] || '–'}` : ''}`,
    select: { type: 'intersection', id: i.id },
  }));

  const markers = [
    ...city.gateways.map((g) => {
      const c = gatewayColors(g.role);
      return {
        key: g.id,
        lat: g.lat,
        lon: g.lon,
        size: 14,
        html: `<span style="background:${c.fill};border-color:${c.border}"></span>`,
        className: 'gateway',
        tooltip: `<strong>${escapeHtml(g.junctionName || g.roadName || g.id)}</strong><br/>${g.id} · ${g.role === 'both' ? 'source + sink' : g.role}`,
        select: { type: 'gateway', id: g.id },
      };
    }),
  ];
  const labels = showLabels
    ? [...city.intersections, ...city.gateways].map((n) => ({ lat: n.lat, lon: n.lon, text: n.id, kind: gatewayIds.has(n.id) ? 'gateway' : 'intersection' }))
    : [];

  const ring = (n) => ({ lat: n.lat, lon: n.lon, radius: (z) => 12 * zoomScale(z) });
  const highlight = (selection) => {
    if (!selection) return null;
    if (selection.type === 'intersection') {
      const i = nodeById.get(selection.id);
      if (!i) return null;
      const edgeIds = Object.values(i.arms).flatMap((a) => [...a.inEdgeIds, ...a.outEdgeIds]);
      const roads = new Set(edgeIds.map((id) => edgeById.get(id).roadId));
      const armLabels = Object.values(i.arms).map((a) => {
        const e = edgeById.get(a.outEdgeIds[0] || a.inEdgeIds[0]);
        const away = e.from === i.id ? coordsOf(e) : coordsOf(e).slice().reverse();
        const [lat, lon] = pointAlong(away, 60);
        return { lat, lon, text: a.dir };
      });
      return {
        glow: Array.from(roads).map((rid) => ({ coords: roadCoords(roadById.get(rid)), weight: weightOf(roadById.get(rid)) })),
        rings: [ring(i)],
        labels: armLabels,
      };
    }
    if (selection.type === 'road') {
      const r = roadById.get(selection.id);
      if (!r) return null;
      return {
        glow: [{ coords: roadCoords(r), weight: weightOf(r) }],
        rings: [ring(nodeById.get(r.a)), ring(nodeById.get(r.b))],
      };
    }
    if (selection.type === 'gateway') {
      const g = nodeById.get(selection.id);
      if (!g) return null;
      const roads = new Set([...g.feederEdgeIds, ...g.exitEdgeIds].map((id) => edgeById.get(id).roadId));
      return {
        glow: Array.from(roads).map((rid) => ({ coords: roadCoords(roadById.get(rid)), weight: weightOf(roadById.get(rid)) })),
        rings: [ring(g)],
      };
    }
    return null;
  };

  const focus = (selection) => {
    if (!selection) return null;
    if (selection.type === 'road') {
      const r = roadById.get(selection.id);
      if (!r) return null;
      const [a, b] = [pos(r.a), pos(r.b)];
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
    const n = nodeById.get(selection.id);
    return n ? [n.lat, n.lon] : null;
  };

  return { lines, points, internal: [], markers, arrows, labels, highlight, focus };
}

export function cityLegend() {
  return [
    { kind: 'dot', color: CITY_COLORS.intersection, label: 'Signalized intersection' },
    { kind: 'dot', color: CITY_COLORS.intersection, ring: CITY_COLORS.roundaboutRing, label: 'Roundabout (as signal)' },
    { kind: 'square', color: CITY_COLORS.feeder, label: 'Source (traffic comes from)' },
    { kind: 'square', color: CITY_COLORS.exit, label: 'Sink (traffic leaves to)' },
    { kind: 'line', color: CITY_COLORS.road, label: 'Road between intersections' },
    { kind: 'line', color: CITY_COLORS.feeder, label: 'Feeder road (in)' },
    { kind: 'line', color: CITY_COLORS.exit, label: 'Exit road (out)' },
  ];
}
