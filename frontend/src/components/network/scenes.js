// =====================================================
// MAP SCENES
// Turn a network (full road graph or city graph) into plain
// drawing instructions for NetworkMap:
//   lines / points / markers / arrows / labels, plus
//   per-selection highlight specs and a focus point.
// =====================================================

import { pointAlong } from '../../network/geo.js';
import { MODEL_CONSTANTS } from '../../network/roadDefaults.js';
import {
  JUNCTION_KINDS,
  junctionColor,
  junctionRadius,
  roadColor,
  roadMetrics,
  roadWeight,
} from './networkStyle.js';

const zoomScale = (zoom) => (zoom >= 17 ? 1.5 : zoom >= 16 ? 1.25 : zoom >= 15 ? 1 : 0.8);

// Two directions of a road are drawn side by side: each this far (in
// screen pixels, plus half its width) to the left of its direction.
const DIRECTION_GAP_PX = 1.5;
const directionWeight = (lanes) => Math.min(6, 1.5 + lanes * 0.8);

// ---------------------------------------------------------------
// Full road graph
// ---------------------------------------------------------------
export function buildFullGraphScene(graph, colorBy) {
  const linkById = new Map(graph.links.map((l) => [l.id, l]));
  const roadById = new Map(graph.roads.map((r) => [r.id, r]));
  const junctionById = new Map(graph.junctions.map((j) => [j.id, j]));
  const metricsByRoad = new Map(graph.roads.map((r) => [r.id, roadMetrics(r, linkById)]));

  // A one-way road is one path; a two-way road one path per direction.
  const pathsOf = (road) => {
    if (road.linkIds.length < 2) return [{ key: road.id, coords: road.coords, offset: 0, weight: roadWeight(metricsByRoad.get(road.id)) }];
    return road.linkIds.map((id) => {
      const w = directionWeight(linkById.get(id)?.lanes.value || 1);
      return { key: `${road.id}:${id}`, coords: id.endsWith('f') ? road.coords : road.coords.slice().reverse(), offset: w / 2 + DIRECTION_GAP_PX, weight: w };
    });
  };
  const lines = graph.roads.flatMap((road) => {
    const m = metricsByRoad.get(road.id);
    return pathsOf(road).map((p) => ({
      ...p,
      color: roadColor(road, m, colorBy),
      tooltip: `<strong>${road.name || 'Unnamed road'}</strong><br/>${road.id} · ${Math.round(road.lengthM)} m · ${m.totalLanes} lane(s) · ${road.linkIds.length > 1 ? 'two-way' : 'one-way'}`,
      select: { type: 'road', id: road.id },
    }));
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
        glow: j.legs.flatMap((leg) => pathsOf(roadById.get(leg.roadId))),
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
        glow: pathsOf(road),
        arrows: pathsOf(road).map((p) => ({ coords: p.coords, offset: p.offset, fraction: 0.5 })),
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
  junction: '#94a3b8',
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
  { max: 15, color: '#eab308', label: '6 to 15' },
  { max: 30, color: '#f97316', label: '16 to 30' },
  { max: Infinity, color: '#ef4444', label: '> 30' },
];
export const LOAD_STOPS = [
  { max: 0.25, color: '#64748b', label: '< 25% full' },
  { max: 0.5, color: '#eab308', label: '25 to 50%' },
  { max: 0.8, color: '#f97316', label: '50 to 80%' },
  { max: Infinity, color: '#ef4444', label: '> 80%' },
];
const stopColor = (stops, v) => stops.find((st) => v <= st.max).color;

/**
 * Draws the physical graph: one line per road (both directions together),
 * intersections, junctions without signal, sources and sinks.
 *
 * live (optional): { queues: {intersectionId: n}, phases: {id: name},
 *                    linkCars: {linkId: n} }
 * marked (optional): Set of node/road ids to flag as changed by the user.
 * pending (optional): id of a node picked as the start of a new road.
 */
export function buildCityScene(city, { shape = 'straight', showLabels = true, live = null, marked = null, lightMap = false, pending = null, labelJunctions = false } = {}) {
  const linkById = new Map(city.links.map((l) => [l.id, l]));
  const nodes = [...city.intersections, ...city.junctions, ...city.gateways];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const gatewayIds = new Set(city.gateways.map((g) => g.id));
  const junctionIds = new Set(city.junctions.map((j) => j.id));
  const roadById = new Map(city.roads.map((r) => [r.id, r]));
  const pos = (id) => [nodeById.get(id).lat, nodeById.get(id).lon];
  const coordsOf = (l) => (shape === 'straight' ? [pos(l.from), pos(l.to)] : l.coords);
  const roadCoords = (r) => (shape === 'straight' ? [pos(r.a), pos(r.b)] : linkById.get(r.linkIds[0]).coords);
  const roadLinks = (r) => r.linkIds.map((id) => linkById.get(id));
  const roadLanes = (r) => roadLinks(r).reduce((s, l) => s + l.lanes.value, 0);
  const weightOf = (r) => Math.min(9, 2 + roadLanes(r) * 0.9);
  const storageOf = (l) => Math.max(1, Math.floor((l.lengthM * l.lanes.value) / MODEL_CONSTANTS.jamSpacingM));
  const roadLoad = (r) => {
    const cars = r.linkIds.reduce((s, id) => s + (live.linkCars[id] || 0), 0);
    const storage = roadLinks(r).reduce((s, l) => s + storageOf(l), 0);
    return { cars, load: cars / storage };
  };
  const linkRole = (l) => (gatewayIds.has(l.from) ? 'feeder' : gatewayIds.has(l.to) ? 'exit' : 'internal');
  const roadColor = (r) => {
    if (live && r.kind === 'internal') return stopColor(LOAD_STOPS, roadLoad(r).load);
    if (r.kind === 'internal') return lightMap ? CITY_COLORS.roadOnLight : CITY_COLORS.road;
    return roadLinks(r).some((l) => linkRole(l) === 'feeder') ? CITY_COLORS.feeder : CITY_COLORS.exit;
  };
  const arrowColor = (l) => ({ feeder: CITY_COLORS.feeder, exit: CITY_COLORS.exit, internal: '#f8fafc' }[linkRole(l)]);

  // Directions between the same two nodes: each keeps to its left, and
  // several in the same direction sit next to each other.
  const lineWeight = (l) => (roadById.get(l.roadId).linkIds.length > 1 ? directionWeight(l.lanes.value) : weightOf(roadById.get(l.roadId)));
  const offsetOf = (l) => {
    const r = roadById.get(l.roadId);
    if (r.linkIds.length < 2) return 0;
    const sameWay = roadLinks(r).filter((x) => x.from === l.from);
    const w = lineWeight(l);
    return w / 2 + DIRECTION_GAP_PX + sameWay.indexOf(l) * (w + DIRECTION_GAP_PX);
  };
  const linkLoad = (l) => (live.linkCars[l.id] || 0) / storageOf(l);
  const linkColor = (l) => {
    const r = roadById.get(l.roadId);
    if (live && r.kind === 'internal') return stopColor(LOAD_STOPS, linkLoad(l));
    if (r.kind === 'internal') return roadColor(r);
    // At a source/sink each direction shows its own role: in or out.
    return linkRole(l) === 'exit' ? CITY_COLORS.exit : CITY_COLORS.feeder;
  };
  const roadLabel = (r) => (r.kind === 'internal' ? 'road' : roadLinks(r).some((l) => linkRole(l) === 'feeder') ? 'inflow road' : 'outflow road');
  const roadTip = (r) => {
    const links = roadLinks(r);
    const name = links.find((l) => l.name)?.name;
    return `<strong>${escapeHtml(name || 'Unnamed road')}</strong><br/>${r.a} ↔ ${r.b} · ${roadLabel(r)} · ${links.length > 1 ? 'two-way' : 'one-way'} · ${roadLanes(r)} lane(s)${live ? ` · ${roadLoad(r).cars} car(s) driving` : ''}${marked?.has(r.id) ? ' · <em>edited</em>' : ''}`;
  };
  const linkTip = (l) => `<strong>${escapeHtml(l.name || 'Unnamed road')}</strong><br/>${l.from} → ${l.to} · ${l.lanes.value} lane(s)${live ? ` · ${live.linkCars[l.id] || 0} car(s) driving` : ''}`;
  // One path per direction, straight between the nodes or along the real
  // road. A two-way road shows two paths side by side; each can be clicked.
  const lines = city.links.map((l) => ({
    key: l.id,
    coords: coordsOf(l),
    offset: offsetOf(l),
    color: linkColor(l),
    weight: lineWeight(l),
    dash: l.connector ? '6 5' : null,
    tooltip: `${linkTip(l)}<br/>${roadTip(roadById.get(l.roadId)).split('<br/>')[1]}`,
    select: { type: 'road', id: l.roadId, linkId: l.id },
  }));

  // Direction arrows: one per road piece, offset along the line. Clicking
  // one opens the road with that direction in front.
  const arrows = city.links.map((l) => {
    return {
      coords: coordsOf(l),
      offset: offsetOf(l),
      fraction: 0.55,
      color: arrowColor(l),
      size: 14,
      tooltip: linkTip(l),
      select: { type: 'road', id: l.roadId, linkId: l.id },
    };
  });

  const strokeOf = (id, base) => (pending === id ? '#38bdf8' : marked?.has(id) ? '#f8fafc' : base);
  const points = [
    ...city.junctions.map((j) => ({
      key: j.id,
      lat: j.lat,
      lon: j.lon,
      radius: (z) => 3.5 * zoomScale(z),
      stroke: strokeOf(j.id, '#0b0f19'),
      strokeWeight: pending === j.id || marked?.has(j.id) ? 3 : 1.5,
      fill: CITY_COLORS.junction,
      tooltip: `<strong>${escapeHtml(j.name || j.id)}</strong><br/>${j.id} · junction, no signal`,
      select: { type: 'junction', id: j.id },
    })),
    ...city.intersections.map((i) => ({
      key: i.id,
      lat: i.lat,
      lon: i.lon,
      radius: (z) => (6 + (i.armCount === 4 ? 1.5 : 0) + (live ? Math.min(5, (live.queues[i.id] || 0) / 8) : 0)) * zoomScale(z),
      stroke: strokeOf(i.id, i.originalKind === 'roundabout' ? CITY_COLORS.roundaboutRing : '#0b0f19'),
      strokeWeight: pending === i.id || marked?.has(i.id) || i.originalKind === 'roundabout' ? 3 : 2,
      fill: live ? stopColor(QUEUE_STOPS, live.queues[i.id] || 0) : CITY_COLORS.intersection,
      tooltip: `<strong>${escapeHtml(i.name || i.id)}</strong><br/>${i.id} · ${i.armCount}-arm signalized${i.originalKind === 'roundabout' ? ' · roundabout' : ''}${live ? `<br/>${live.queues[i.id] || 0} queued · phase ${live.phases[i.id] || '-'}` : ''}`,
      select: { type: 'intersection', id: i.id },
    })),
  ];

  const markers = city.gateways.map((g) => {
    const c = g.role === 'unused' ? { fill: '#64748b', border: '#64748b' } : gatewayColors(g.role);
    return {
      key: g.id,
      lat: g.lat,
      lon: g.lon,
      size: 14,
      html: `<span style="background:${c.fill};border-color:${pending === g.id ? '#38bdf8' : c.border}"></span>`,
      className: 'gateway',
      tooltip: `<strong>${escapeHtml(g.junctionName || g.roadName || g.id)}</strong><br/>${g.id} · ${g.role === 'both' ? 'source and sink' : g.role === 'unused' ? 'not connected' : g.role}`,
      select: { type: 'gateway', id: g.id },
    };
  });
  const labels = showLabels
    ? [...city.intersections, ...city.gateways, ...(labelJunctions ? city.junctions : [])].map((n) => ({
      lat: n.lat,
      lon: n.lon,
      text: n.id,
      kind: gatewayIds.has(n.id) ? 'gateway' : junctionIds.has(n.id) ? 'junction' : 'intersection',
    }))
    : [];

  const ring = (n) => ({ lat: n.lat, lon: n.lon, radius: (z) => 12 * zoomScale(z) });
  const roadsAt = (id) => city.roads.filter((r) => r.a === id || r.b === id);
  const glowOfLink = (l) => ({ coords: coordsOf(l), offset: offsetOf(l), weight: lineWeight(l) });
  const glowOf = (roads) => roads.flatMap((r) => roadLinks(r).map(glowOfLink));
  const highlight = (selection) => {
    if (!selection) return null;
    if (selection.type === 'road') {
      const r = roadById.get(selection.id);
      if (!r) return null;
      // With one direction picked, only that side glows.
      const picked = selection.linkId ? linkById.get(selection.linkId) : null;
      const glow = picked ? [glowOfLink(picked)] : glowOf([r]);
      return { glow, rings: [ring(nodeById.get(r.a)), ring(nodeById.get(r.b))] };
    }
    const n = nodeById.get(selection.id);
    if (!n) return null;
    if (!n.arms) return { glow: glowOf(roadsAt(n.id)), rings: [ring(n)] };
    const armLabels = Object.values(n.arms).map((a) => {
      const l = linkById.get(a.outLinkIds[0] || a.inLinkIds[0]);
      const away = l.from === n.id ? coordsOf(l) : coordsOf(l).slice().reverse();
      const [lat, lon] = pointAlong(away, 60);
      return { lat, lon, text: a.dir };
    });
    return { glow: glowOf(roadsAt(n.id)), rings: [ring(n)], labels: armLabels };
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
    { kind: 'dot', color: CITY_COLORS.junction, label: 'Junction, no signal' },
    { kind: 'square', color: CITY_COLORS.feeder, label: 'Source' },
    { kind: 'square', color: CITY_COLORS.exit, label: 'Sink' },
    { kind: 'line', color: CITY_COLORS.road, label: 'Road' },
    { kind: 'line', color: CITY_COLORS.feeder, label: 'Inflow road' },
    { kind: 'line', color: CITY_COLORS.exit, label: 'Outflow road' },
  ];
}
