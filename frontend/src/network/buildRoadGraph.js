// =====================================================
// ROAD GRAPH BUILDER
//
// Turns raw OpenStreetMap data (Overpass JSON) into a
// simulation-ready road graph:
//
//   junctions  – real intersections (clustered), dead ends and
//                boundary entry/exit points
//   roads      – physical road segments between two junctions
//   links      – one per allowed travel direction of a road,
//                carrying lanes / speed / capacity parameters
//   movements  – allowed (incoming link -> outgoing link) turns
//                at each junction, with turn type
//
// Pipeline:
//   1. keep drivable ways of the requested classes
//   2. clip ways to the selected area (creates boundary points)
//   3. split ways at shared nodes -> raw edges
//   4. merge chains through pass-through nodes (degree 2)
//   5. cluster nodes that form one physical junction
//      (roundabouts, dual-carriageway crossings)
//   6. derive parameters, signals, legs, movements
// =====================================================

import {
  angleDiff,
  bearingDeg,
  clipSegmentToBox,
  compassLabel,
  haversineM,
  pointAlong,
  polylineLengthM,
} from './geo.js';
import {
  DETAIL_LEVELS,
  MODEL_CONSTANTS,
  SOURCES,
  isExcludedByAccess,
  isRoundaboutTags,
  lanesForDirection,
  parseOneway,
  parseWidthM,
  roadClassInfo,
  speedForDirection,
} from './roadDefaults.js';

export const GRAPH_SCHEMA_VERSION = 1;

export const DEFAULT_GRAPH_OPTIONS = {
  roadClasses: DETAIL_LEVELS.all.classes,
  mergeDistanceM: 25,   // edges shorter than this between junction nodes are merged
  maxClusterSpanM: 70,  // a merged (non-roundabout) junction may not grow wider than this
  signalSearchM: 40,    // approach-mapped signals within this distance belong to the junction
  legProbeM: 25,        // distance along a leg used to measure its bearing
  armMergeDeg: 35,      // one-way in/out legs closer than this form one arm (divided road)
  maxRoundaboutSpanM: 200, // larger rings are ring roads, not one junction
};

const EPS = 1e-9;

// ---------------------------------------------------------------
// Union–find with cluster extent tracking
// ---------------------------------------------------------------
class Clusters {
  constructor() {
    this.parent = new Map();
    this.info = new Map();
  }

  add(point) {
    if (this.parent.has(point.id)) return;
    this.parent.set(point.id, point.id);
    this.info.set(point.id, {
      minLat: point.lat, maxLat: point.lat, minLon: point.lon, maxLon: point.lon,
      roundabout: false,
      coreSpanM: 0,
    });
  }

  find(id) {
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  static spanOf(info) {
    return haversineM(info.minLat, info.minLon, info.maxLat, info.maxLon);
  }

  mergedInfo(ra, rb) {
    const a = this.info.get(ra);
    const b = this.info.get(rb);
    return {
      minLat: Math.min(a.minLat, b.minLat),
      maxLat: Math.max(a.maxLat, b.maxLat),
      minLon: Math.min(a.minLon, b.minLon),
      maxLon: Math.max(a.maxLon, b.maxLon),
      roundabout: a.roundabout || b.roundabout,
      coreSpanM: Math.max(a.coreSpanM, b.coreSpanM),
    };
  }

  union(aId, bId, { roundabout = false } = {}) {
    const ra = this.find(aId);
    const rb = this.find(bId);
    const merged = ra === rb ? { ...this.info.get(ra) } : this.mergedInfo(ra, rb);
    if (roundabout) {
      merged.roundabout = true;
      merged.coreSpanM = Math.max(merged.coreSpanM, Clusters.spanOf(merged));
    }
    if (ra !== rb) this.parent.set(rb, ra);
    this.info.set(ra, merged);
    return ra;
  }
}

// ---------------------------------------------------------------
// Edge helpers
// ---------------------------------------------------------------
function flipDir(dir) {
  if (dir === 'ab') return 'ba';
  if (dir === 'ba') return 'ab';
  return dir;
}

function reverseEdge(edge) {
  return {
    ...edge,
    a: edge.b,
    b: edge.a,
    pts: edge.pts.slice().reverse(),
    parts: edge.parts.slice().reverse().map((p) => ({ ...p, alongWay: !p.alongWay })),
    dir: flipDir(edge.dir),
  };
}

function partDir(way, alongWay) {
  const oneway = parseOneway(way.tags);
  if (oneway === 'both') return 'both';
  const forwardOk = oneway === 'forward';
  return forwardOk === alongWay ? 'ab' : 'ba';
}

function edgeLength(edge) {
  return edge.parts.reduce((s, p) => s + p.lengthM, 0);
}

// ---------------------------------------------------------------
// Link parameters (one travel direction of a road)
// ---------------------------------------------------------------
function combineSources(values) {
  const sources = new Set(values.map((v) => v.source));
  if (sources.size === 1) return values[0].source;
  return SOURCES.MIXED;
}

function linkParameters(road, forward) {
  const parts = road.parts.map((p) => ({
    ...p,
    travelAlongWay: forward ? p.alongWay : !p.alongWay,
  }));

  const laneValues = parts.map((p) => ({
    ...lanesForDirection(p.way.tags, parseOneway(p.way.tags) !== 'both', p.travelAlongWay),
    lengthM: p.lengthM,
  }));
  const narrowest = laneValues.reduce((m, v) => (v.value < m.value ? v : m), laneValues[0]);
  const lanes = {
    value: narrowest.value,
    source: combineSources(laneValues),
    detail: parts.length > 1
      ? `${narrowest.detail} — narrowest of ${parts.length} OSM sections`
      : narrowest.detail,
  };

  const speedValues = parts.map((p) => ({ ...speedForDirection(p.way.tags, p.travelAlongWay), lengthM: p.lengthM }));
  const totalLen = speedValues.reduce((s, v) => s + v.lengthM, 0) || 1;
  const weightedSpeed = speedValues.reduce((s, v) => s + v.value * v.lengthM, 0) / totalLen;
  const speedSource = combineSources(speedValues);
  const speedKmh = {
    value: Math.round(weightedSpeed * 10) / 10,
    source: speedSource,
    detail: speedSource === SOURCES.MIXED
      ? `length-weighted over ${parts.length} sections (some tagged, some default)`
      : speedValues[0].detail,
  };

  const lengthM = road.lengthM;
  const freeFlowTimeS = lengthM / (speedKmh.value / 3.6);
  return {
    lanes,
    speedKmh,
    freeFlowTimeS: Math.round(freeFlowTimeS * 10) / 10,
    saturationFlowVph: lanes.value * MODEL_CONSTANTS.saturationFlowPerLaneVph,
    storageVeh: Math.max(1, Math.floor((lengthM * lanes.value) / MODEL_CONSTANTS.jamSpacingM)),
  };
}

// ---------------------------------------------------------------
// Arms: a divided road reaches a junction as two one-way legs
// (inbound + outbound) a few degrees apart. Pair them into one arm.
// `legs` must be sorted by bearing; sets leg.armIndex.
// ---------------------------------------------------------------
function groupLegsIntoArms(legs, maxGapDeg) {
  const isInOnly = (l) => l.inLinkId && !l.outLinkId;
  const isOutOnly = (l) => l.outLinkId && !l.inLinkId;
  const candidates = [];
  const n = legs.length;
  if (n > 1) {
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      if (k === i || (n === 2 && i === 1)) continue;
      const a = legs[i];
      const b = legs[k];
      const complementary = (isInOnly(a) && isOutOnly(b)) || (isOutOnly(a) && isInOnly(b));
      const gap = Math.abs(angleDiff(a.bearing, b.bearing));
      const namesAgree = !a.name || !b.name || a.name === b.name;
      if (complementary && namesAgree && gap <= maxGapDeg) candidates.push({ i, k, gap });
    }
  }
  candidates.sort((x, y) => x.gap - y.gap);
  const paired = new Map();
  for (const c of candidates) {
    if (paired.has(c.i) || paired.has(c.k)) continue;
    paired.set(c.i, c.k);
    paired.set(c.k, c.i);
  }

  const arms = [];
  const seen = new Set();
  legs.forEach((leg, idx) => {
    if (seen.has(idx)) return;
    const members = paired.has(idx) ? [idx, paired.get(idx)] : [idx];
    members.forEach((m) => seen.add(m));
    const ls = members.map((m) => legs[m]);
    const base = ls[0].bearing;
    const bearing = (base + ls.reduce((s, l) => s + angleDiff(base, l.bearing), 0) / ls.length + 360) % 360;
    arms.push({
      bearing: Math.round(bearing),
      compass: compassLabel(bearing),
      name: ls.find((l) => l.name)?.name || null,
      highway: ls[0].highway,
      legIndices: members,
      divided: members.length > 1,
      inLanes: ls.reduce((s, l) => s + l.inLanes, 0),
      outLanes: ls.reduce((s, l) => s + l.outLanes, 0),
    });
  });
  arms.sort((x, y) => x.bearing - y.bearing);
  arms.forEach((arm, armIdx) => arm.legIndices.forEach((li) => { legs[li].armIndex = armIdx; }));
  return arms;
}

// ---------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------
export function buildRoadGraph(osmJson, { bbox = null, ...userOptions } = {}) {
  const options = { ...DEFAULT_GRAPH_OPTIONS, ...userOptions };
  const allowedClasses = new Set(options.roadClasses);
  const warnings = [];

  // ---- 1. Parse ------------------------------------------------
  const nodeById = new Map();
  const rawWays = [];
  const relations = [];
  for (const el of osmJson?.elements || []) {
    // Overpass can return a node twice (with tags, then as a tagless
    // "skel" copy); never let the bare copy overwrite the tagged one.
    if (el.type === 'node') {
      const prev = nodeById.get(String(el.id));
      if (!prev || (!prev.tags && el.tags)) nodeById.set(String(el.id), el);
    }
    else if (el.type === 'way') rawWays.push(el);
    else if (el.type === 'relation') relations.push(el);
  }
  const wayById = new Map(rawWays.map((w) => [String(w.id), w]));
  const ways = rawWays.filter((w) => w.tags
    && allowedClasses.has(w.tags.highway)
    && w.tags.area !== 'yes'
    && !isExcludedByAccess(w.tags));

  // ---- 2. Clip to area ----------------------------------------
  const points = new Map();
  let boundaryCount = 0;
  const realPoint = (n) => {
    const id = String(n.id);
    if (!points.has(id)) points.set(id, { id, lat: n.lat, lon: n.lon, boundary: false, tags: n.tags || null });
    return points.get(id);
  };
  const boundaryPoint = (a, b, t) => {
    const id = `B${++boundaryCount}`;
    const p = { id, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, boundary: true, tags: null };
    points.set(id, p);
    return p;
  };

  const pieces = [];
  let waysWithMissingNodes = 0;
  for (const way of ways) {
    // Split at missing nodes so geometry never jumps across a gap.
    const runs = [];
    let run = [];
    for (const nid of way.nodes || []) {
      const n = nodeById.get(String(nid));
      if (n) run.push(n);
      else {
        if (run.length) runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
    if (runs.length > 1) waysWithMissingNodes += 1;

    for (const nodes of runs) {
      if (nodes.length < 2) continue;
      if (!bbox) {
        pieces.push({ way, pts: nodes.map(realPoint) });
        continue;
      }
      let current = null;
      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i];
        const b = nodes[i + 1];
        const clip = clipSegmentToBox(a, b, bbox);
        if (!clip) {
          if (current) pieces.push({ way, pts: current });
          current = null;
          continue;
        }
        const [t0, t1] = clip;
        if (!current || t0 > EPS) {
          if (current) pieces.push({ way, pts: current });
          current = [t0 > EPS ? boundaryPoint(a, b, t0) : realPoint(a)];
        }
        if (t1 < 1 - EPS) {
          current.push(boundaryPoint(a, b, t1));
          pieces.push({ way, pts: current });
          current = null;
        } else {
          current.push(realPoint(b));
        }
      }
      if (current) pieces.push({ way, pts: current });
    }
  }
  if (waysWithMissingNodes) warnings.push(`${waysWithMissingNodes} OSM way(s) referenced nodes missing from the download and were split.`);

  // ---- 3. Split at topology nodes -----------------------------
  const refCount = new Map();
  const endpointIds = new Set();
  for (const piece of pieces) {
    for (const p of piece.pts) refCount.set(p.id, (refCount.get(p.id) || 0) + 1);
    endpointIds.add(piece.pts[0].id);
    endpointIds.add(piece.pts[piece.pts.length - 1].id);
  }
  const isTopo = (p) => p.boundary || endpointIds.has(p.id) || (refCount.get(p.id) || 0) >= 2;

  let edges = [];
  for (const piece of pieces) {
    let start = 0;
    for (let i = 1; i < piece.pts.length; i++) {
      if (!isTopo(piece.pts[i])) continue;
      const pts = piece.pts.slice(start, i + 1);
      const lengthM = polylineLengthM(pts.map((p) => [p.lat, p.lon]));
      if (lengthM > 0.5) {
        edges.push({
          a: pts[0].id,
          b: pts[pts.length - 1].id,
          pts,
          parts: [{ way: piece.way, lengthM, alongWay: true }],
          dir: partDir(piece.way, true),
          roundabout: isRoundaboutTags(piece.way.tags),
        });
      }
      start = i;
    }
  }
  const rawEdgeCount = edges.length;

  // ---- 4. Merge chains through pass-through nodes -------------
  const adjacency = new Map();
  const attach = (id, edge) => {
    if (!adjacency.has(id)) adjacency.set(id, new Set());
    adjacency.get(id).add(edge);
  };
  const detach = (id, edge) => adjacency.get(id)?.delete(edge);
  for (const e of edges) {
    attach(e.a, e);
    attach(e.b, e);
  }

  let mergedChains = 0;
  for (const nodeId of Array.from(adjacency.keys())) {
    const point = points.get(nodeId);
    const incident = adjacency.get(nodeId);
    if (!point || point.boundary || !incident || incident.size !== 2) continue;
    let [e1, e2] = Array.from(incident);
    if (e1.a === e1.b || e2.a === e2.b) continue;
    if (e1.roundabout !== e2.roundabout) continue;
    const o1 = e1.b === nodeId ? e1 : reverseEdge(e1);
    const o2 = e2.a === nodeId ? e2 : reverseEdge(e2);
    if (o1.dir !== o2.dir) continue;

    const merged = {
      a: o1.a,
      b: o2.b,
      pts: o1.pts.concat(o2.pts.slice(1)),
      parts: o1.parts.concat(o2.parts),
      dir: o1.dir,
      roundabout: o1.roundabout,
    };
    detach(e1.a, e1); detach(e1.b, e1);
    detach(e2.a, e2); detach(e2.b, e2);
    adjacency.delete(nodeId);
    attach(merged.a, merged);
    attach(merged.b, merged);
    mergedChains += 1;
  }
  const edgeSet = new Set();
  for (const set of adjacency.values()) for (const e of set) edgeSet.add(e);
  edges = Array.from(edgeSet);

  // ---- 5. Cluster physical junctions ---------------------------
  const clusters = new Clusters();
  for (const id of adjacency.keys()) clusters.add(points.get(id));
  const degree = (id) => adjacency.get(id)?.size || 0;

  // Collapse roundabouts into one junction — but only normal-sized ones.
  // Very large rings (e.g. Connaught Place) are circular roads with
  // several junctions of their own, so their pieces stay separate.
  const ringParent = new Map();
  const ringFind = (x) => {
    while (ringParent.get(x) !== x) x = ringParent.get(x);
    return x;
  };
  const roundaboutEdges = edges.filter((e) => e.roundabout);
  for (const e of roundaboutEdges) {
    for (const id of [e.a, e.b]) if (!ringParent.has(id)) ringParent.set(id, id);
    ringParent.set(ringFind(e.a), ringFind(e.b));
  }
  const ringExtent = new Map();
  for (const e of roundaboutEdges) {
    const root = ringFind(e.a);
    const ext = ringExtent.get(root) || { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 };
    for (const p of e.pts) {
      ext.minLat = Math.min(ext.minLat, p.lat);
      ext.maxLat = Math.max(ext.maxLat, p.lat);
      ext.minLon = Math.min(ext.minLon, p.lon);
      ext.maxLon = Math.max(ext.maxLon, p.lon);
    }
    ringExtent.set(root, ext);
  }
  let largeRings = 0;
  for (const [root, ext] of ringExtent.entries()) {
    const span = haversineM(ext.minLat, ext.minLon, ext.maxLat, ext.maxLon);
    ext.collapse = span <= options.maxRoundaboutSpanM;
    if (!ext.collapse) largeRings += 1;
    ringExtent.set(root, ext);
  }
  for (const e of roundaboutEdges) {
    if (ringExtent.get(ringFind(e.a)).collapse) clusters.union(e.a, e.b, { roundabout: true });
    else e.roundabout = false; // treated as an ordinary (one-way) ring road
  }
  if (largeRings) warnings.push(`${largeRings} very large roundabout(s) (over ${options.maxRoundaboutSpanM} m) kept as ring roads with their own junctions.`);

  const shortEdges = edges
    .filter((e) => !e.roundabout && e.a !== e.b && edgeLength(e) <= options.mergeDistanceM)
    .sort((x, y) => edgeLength(x) - edgeLength(y));
  let shortEdgeMerges = 0;
  for (const e of shortEdges) {
    const pa = points.get(e.a);
    const pb = points.get(e.b);
    if (pa.boundary || pb.boundary) continue;
    if (degree(e.a) < 3 || degree(e.b) < 3) continue;
    const ra = clusters.find(e.a);
    const rb = clusters.find(e.b);
    if (ra === rb) continue;
    const merged = clusters.mergedInfo(ra, rb);
    const limit = merged.roundabout
      ? Math.max(options.maxClusterSpanM, merged.coreSpanM + 2 * options.mergeDistanceM)
      : options.maxClusterSpanM;
    if (Clusters.spanOf(merged) > limit) continue;
    clusters.union(e.a, e.b);
    shortEdgeMerges += 1;
  }

  // ---- 6a. Junctions ------------------------------------------
  const membersByRoot = new Map();
  for (const id of adjacency.keys()) {
    const root = clusters.find(id);
    if (!membersByRoot.has(root)) membersByRoot.set(root, []);
    membersByRoot.get(root).push(points.get(id));
  }

  const externalEdges = [];
  const internalEdges = [];
  for (const e of edges) {
    if (clusters.find(e.a) === clusters.find(e.b)) internalEdges.push(e);
    else externalEdges.push(e);
  }
  const rootsWithRoads = new Set();
  for (const e of externalEdges) {
    rootsWithRoads.add(clusters.find(e.a));
    rootsWithRoads.add(clusters.find(e.b));
  }

  const junctionDrafts = [];
  for (const [root, members] of membersByRoot.entries()) {
    if (!rootsWithRoads.has(root)) continue;
    const lat = members.reduce((s, p) => s + p.lat, 0) / members.length;
    const lon = members.reduce((s, p) => s + p.lon, 0) / members.length;
    junctionDrafts.push({
      root,
      lat,
      lon,
      members,
      isBoundary: members.some((p) => p.boundary),
      isRoundabout: clusters.info.get(root).roundabout,
    });
  }
  // Stable, readable IDs: numbered north-west to south-east.
  junctionDrafts.sort((x, y) => (y.lat - x.lat) || (x.lon - y.lon));
  const junctionByRoot = new Map();
  let jCounter = 0;
  let eCounter = 0;
  const junctions = junctionDrafts.map((d) => {
    const id = d.isBoundary ? `E${++eCounter}` : `J${++jCounter}`;
    const j = {
      id,
      lat: d.lat,
      lon: d.lon,
      kind: null,
      name: null,
      isBoundary: d.isBoundary,
      isRoundabout: d.isRoundabout,
      osmNodes: d.members.filter((p) => !p.boundary).map((p) => ({ id: p.id, lat: p.lat, lon: p.lon })),
      signal: { value: false, source: SOURCES.DEFAULT, detail: 'no traffic_signals tag found nearby', evidence: [] },
      legs: [],
      movements: [],
      restrictions: [],
      componentId: null,
    };
    junctionByRoot.set(d.root, j);
    return j;
  });
  const junctionOfPoint = (pointId) => junctionByRoot.get(clusters.find(pointId));

  // ---- 6b. Roads & links --------------------------------------
  // Order roads by their importance then position for stable IDs.
  externalEdges.sort((x, y) => {
    const rx = Math.max(...x.parts.map((p) => roadClassInfo(p.way.tags.highway).rank));
    const ry = Math.max(...y.parts.map((p) => roadClassInfo(p.way.tags.highway).rank));
    return (ry - rx) || (y.pts[0].lat - x.pts[0].lat) || (x.pts[0].lon - y.pts[0].lon);
  });

  const roads = [];
  const links = [];
  const roadById = new Map();
  const linkById = new Map();
  externalEdges.forEach((e, idx) => {
    const lengthM = Math.round(edgeLength(e) * 10) / 10;
    const byLength = e.parts.slice().sort((p, q) => q.lengthM - p.lengthM);
    const main = byLength[0].way.tags;
    const named = byLength.find((p) => p.way.tags.name)?.way.tags;
    const widthTag = parseWidthM(main.width);
    const road = {
      id: `R${idx + 1}`,
      from: junctionOfPoint(e.a).id,
      to: junctionOfPoint(e.b).id,
      coords: e.pts.map((p) => [p.lat, p.lon]),
      lengthM,
      highway: main.highway,
      name: named?.name || null,
      ref: named?.ref || main.ref || null,
      oneway: e.dir !== 'both',
      surface: main.surface || null,
      bridge: e.parts.some((p) => p.way.tags.bridge && p.way.tags.bridge !== 'no'),
      tunnel: e.parts.some((p) => p.way.tags.tunnel && p.way.tags.tunnel !== 'no'),
      osmWayIds: Array.from(new Set(e.parts.map((p) => String(p.way.id)))),
      sections: e.parts.map((p) => ({
        wayId: String(p.way.id),
        highway: p.way.tags.highway,
        name: p.way.tags.name || null,
        lengthM: Math.round(p.lengthM * 10) / 10,
        tags: {
          lanes: p.way.tags.lanes ?? null,
          maxspeed: p.way.tags.maxspeed ?? null,
          oneway: p.way.tags.oneway ?? null,
          width: p.way.tags.width ?? null,
        },
      })),
      width: null,
      linkIds: [],
      midblockSignals: [],
      componentId: null,
      _edge: e,
      parts: e.parts,
    };

    const directions = [];
    if (e.dir === 'both' || e.dir === 'ab') directions.push(true);
    if (e.dir === 'both' || e.dir === 'ba') directions.push(false);
    let totalLanes = 0;
    for (const forward of directions) {
      const params = linkParameters(road, forward);
      const link = {
        id: `${road.id}${forward ? 'f' : 'b'}`,
        roadId: road.id,
        from: forward ? road.from : road.to,
        to: forward ? road.to : road.from,
        lengthM,
        ...params,
      };
      totalLanes += params.lanes.value;
      links.push(link);
      linkById.set(link.id, link);
      road.linkIds.push(link.id);
    }
    road.width = widthTag != null
      ? { value: widthTag, source: SOURCES.OSM, detail: `width=${main.width}` }
      : {
        value: Math.round(totalLanes * MODEL_CONSTANTS.laneWidthM * 10) / 10,
        source: SOURCES.DERIVED,
        detail: `${totalLanes} lane(s) × ${MODEL_CONSTANTS.laneWidthM} m`,
      };
    roads.push(road);
    roadById.set(road.id, road);
  });

  const junctionById = new Map(junctions.map((j) => [j.id, j]));
  const internalGeometry = internalEdges.map((e) => ({
    junctionId: junctionOfPoint(e.a)?.id || null,
    roundabout: e.roundabout,
    coords: e.pts.map((p) => [p.lat, p.lon]),
  })).filter((g) => g.junctionId);

  // ---- 6c. Traffic signals ------------------------------------
  const signalPoints = Array.from(points.values()).filter((p) => p.tags?.highway === 'traffic_signals');
  const onEdge = new Map();
  for (const e of edges) {
    let walked = 0;
    for (let i = 0; i < e.pts.length; i++) {
      if (i > 0) walked += haversineM(e.pts[i - 1].lat, e.pts[i - 1].lon, e.pts[i].lat, e.pts[i].lon);
      if (e.pts[i].tags?.highway === 'traffic_signals' && !onEdge.has(e.pts[i].id)) {
        onEdge.set(e.pts[i].id, { edge: e, distFromA: walked });
      }
    }
  }
  const markSignal = (junction, evidence) => {
    junction.signal.value = true;
    junction.signal.source = SOURCES.OSM;
    junction.signal.evidence.push(evidence);
    const direct = junction.signal.evidence.filter((ev) => ev.distanceM === 0).length;
    const approach = junction.signal.evidence.length - direct;
    junction.signal.detail = [
      direct ? `${direct} traffic_signals node(s) on the junction` : null,
      approach ? `${approach} signal node(s) on approaches within ${options.signalSearchM} m` : null,
    ].filter(Boolean).join(', ');
  };
  let unassignedSignals = 0;
  for (const sp of signalPoints) {
    if (adjacency.has(sp.id)) {
      const j = junctionOfPoint(sp.id);
      if (j) { markSignal(j, { osmNodeId: sp.id, distanceM: 0 }); continue; }
    }
    const hit = onEdge.get(sp.id);
    if (!hit) { unassignedSignals += 1; continue; }
    const len = edgeLength(hit.edge);
    const ja = junctionOfPoint(hit.edge.a);
    const jb = junctionOfPoint(hit.edge.b);
    if (ja && ja === jb) { markSignal(ja, { osmNodeId: sp.id, distanceM: 0 }); continue; }
    const distA = hit.distFromA;
    const distB = Math.max(0, len - hit.distFromA);
    const [near, dist] = distA <= distB ? [ja, distA] : [jb, distB];
    if (near && !near.isBoundary && dist <= options.signalSearchM) {
      markSignal(near, { osmNodeId: sp.id, distanceM: Math.round(dist) });
    } else {
      const road = roads.find((r) => r._edge === hit.edge);
      if (road) road.midblockSignals.push({ osmNodeId: sp.id, lat: sp.lat, lon: sp.lon });
      else unassignedSignals += 1;
    }
  }

  // ---- 6d. Legs & movements -----------------------------------
  const legsByJunction = new Map(junctions.map((j) => [j.id, []]));
  for (const road of roads) {
    for (const end of ['from', 'to']) {
      const j = junctionById.get(road[end]);
      const away = end === 'from' ? road.coords : road.coords.slice().reverse();
      const probe = pointAlong(away, Math.min(options.legProbeM, road.lengthM * 0.5));
      const origin = haversineM(j.lat, j.lon, probe[0], probe[1]) > 3 ? [j.lat, j.lon] : away[0];
      const bearing = bearingDeg(origin[0], origin[1], probe[0], probe[1]);
      const inLink = road.linkIds.map((id) => linkById.get(id)).find((l) => l.to === j.id) || null;
      const outLink = road.linkIds.map((id) => linkById.get(id)).find((l) => l.from === j.id) || null;
      legsByJunction.get(j.id).push({
        roadId: road.id,
        bearing: Math.round(bearing),
        compass: compassLabel(bearing),
        name: road.name,
        highway: road.highway,
        inLinkId: inLink?.id || null,
        outLinkId: outLink?.id || null,
        inLanes: inLink?.lanes.value ?? 0,
        outLanes: outLink?.lanes.value ?? 0,
      });
    }
  }

  // Turn restrictions -> (junction, fromWay, toWay, type)
  const parsedRestrictions = [];
  let unresolvedRestrictions = 0;
  for (const rel of relations) {
    const tags = rel.tags || {};
    if (tags.type !== 'restriction') continue;
    const kind = tags.restriction || tags['restriction:motorcar'] || tags['restriction:motor_vehicle'];
    if (!kind) continue;
    const from = rel.members?.find((m) => m.role === 'from' && m.type === 'way');
    const to = rel.members?.find((m) => m.role === 'to' && m.type === 'way');
    const via = rel.members?.find((m) => m.role === 'via');
    if (!from || !to || !via) { unresolvedRestrictions += 1; continue; }
    let junction = null;
    if (via.type === 'node' && adjacency.has(String(via.ref))) {
      junction = junctionOfPoint(String(via.ref));
    } else if (via.type === 'way') {
      const viaWay = wayById.get(String(via.ref));
      const js = new Set((viaWay?.nodes || [])
        .map((n) => String(n))
        .filter((n) => adjacency.has(n))
        .map((n) => junctionOfPoint(n))
        .filter(Boolean));
      if (js.size === 1) junction = Array.from(js)[0];
    }
    if (!junction) { unresolvedRestrictions += 1; continue; }
    parsedRestrictions.push({ relationId: String(rel.id), kind, junction, fromWay: String(from.ref), toWay: String(to.ref) });
  }

  for (const j of junctions) {
    const legs = legsByJunction.get(j.id).sort((x, y) => x.bearing - y.bearing);
    j.legs = legs;
    j.arms = groupLegsIntoArms(legs, options.armMergeDeg);
    const names = Array.from(new Set(j.arms.map((a) => a.name).filter(Boolean)));
    j.name = names.length ? names.slice(0, 3).join(' × ') : null;

    const movements = [];
    legs.forEach((inLeg, inIdx) => {
      if (!inLeg.inLinkId) return;
      const inArm = j.arms[inLeg.armIndex];
      const heading = (inArm.bearing + 180) % 360;
      legs.forEach((outLeg, outIdx) => {
        if (!outLeg.outLinkId) return;
        const outArm = j.arms[outLeg.armIndex];
        const angle = Math.round(angleDiff(heading, outArm.bearing));
        let turn;
        if (inIdx === outIdx || inLeg.armIndex === outLeg.armIndex) turn = 'U';
        else if (Math.abs(angle) <= 30) turn = 'T';
        else if (angle > 30 && angle < 150) turn = 'R';
        else if (angle < -30 && angle > -150) turn = 'L';
        else turn = 'U';
        movements.push({
          id: `${inLeg.inLinkId}->${outLeg.outLinkId}`,
          fromLinkId: inLeg.inLinkId,
          toLinkId: outLeg.outLinkId,
          fromLeg: inIdx,
          toLeg: outIdx,
          fromArm: inLeg.armIndex,
          toArm: outLeg.armIndex,
          turn,
          angle,
          allowed: turn !== 'U',
          reason: turn === 'U' ? 'U-turns excluded by default' : null,
        });
      });
    });

    const inWays = (m) => roadById.get(linkById.get(m.fromLinkId).roadId).osmWayIds;
    const outWays = (m) => roadById.get(linkById.get(m.toLinkId).roadId).osmWayIds;
    for (const r of parsedRestrictions.filter((x) => x.junction === j)) {
      let applied = 0;
      for (const m of movements) {
        if (!inWays(m).includes(r.fromWay)) continue;
        const matchesTo = outWays(m).includes(r.toWay);
        if (r.kind.startsWith('no_') && matchesTo) {
          m.allowed = false;
          m.reason = `OSM ${r.kind} (relation ${r.relationId})`;
          applied += 1;
        } else if (r.kind.startsWith('only_') && !matchesTo) {
          m.allowed = false;
          m.reason = `OSM ${r.kind} (relation ${r.relationId})`;
          applied += 1;
        }
      }
      j.restrictions.push({ relationId: r.relationId, kind: r.kind, fromWay: r.fromWay, toWay: r.toWay, movementsAffected: applied });
    }
    j.movements = movements;

    if (j.isBoundary) j.kind = 'boundary';
    else if (j.arms.length === 1) j.kind = 'dead_end';
    else if (j.isRoundabout) j.kind = 'roundabout';
    else if (j.signal.value) j.kind = 'signalized';
    else if (j.arms.length === 2) j.kind = 'continuation';
    else j.kind = 'priority';

    if (j.isBoundary) {
      const leg = legs[0];
      j.boundaryRole = leg?.outLinkId && leg?.inLinkId ? 'entry_exit' : leg?.outLinkId ? 'entry' : 'exit';
    }
  }

  // ---- 6e. Connected components -------------------------------
  const neighbours = new Map(junctions.map((j) => [j.id, []]));
  for (const r of roads) {
    neighbours.get(r.from).push(r.to);
    neighbours.get(r.to).push(r.from);
  }
  const componentSizes = [];
  for (const j of junctions) {
    if (j.componentId != null) continue;
    const cid = componentSizes.length;
    let size = 0;
    const stack = [j.id];
    j.componentId = cid;
    while (stack.length) {
      const cur = stack.pop();
      size += 1;
      for (const n of neighbours.get(cur)) {
        const nj = junctionById.get(n);
        if (nj.componentId == null) { nj.componentId = cid; stack.push(n); }
      }
    }
    componentSizes.push(size);
  }
  for (const r of roads) r.componentId = junctionById.get(r.from).componentId;

  // ---- Summary ------------------------------------------------
  const realJunctions = junctions.filter((j) => !j.isBoundary && j.kind !== 'dead_end' && j.kind !== 'continuation');
  const totalLengthM = roads.reduce((s, r) => s + r.lengthM, 0);
  const lengthWhere = (pred) => links.filter(pred).reduce((s, l) => s + l.lengthM, 0);
  const linkLengthTotal = lengthWhere(() => true) || 1;
  const kindCounts = junctions.reduce((acc, j) => ({ ...acc, [j.kind]: (acc[j.kind] || 0) + 1 }), {});

  const summary = {
    junctions: realJunctions.length,
    signalized: junctions.filter((j) => j.kind === 'signalized').length,
    roundabouts: kindCounts.roundabout || 0,
    priority: kindCounts.priority || 0,
    deadEnds: kindCounts.dead_end || 0,
    continuations: kindCounts.continuation || 0,
    entryPoints: junctions.filter((j) => j.isBoundary && j.boundaryRole !== 'exit').length,
    exitPoints: junctions.filter((j) => j.isBoundary && j.boundaryRole !== 'entry').length,
    roads: roads.length,
    links: links.length,
    movements: junctions.reduce((s, j) => s + j.movements.filter((m) => m.allowed).length, 0),
    totalRoadKm: Math.round(totalLengthM / 100) / 10,
    armsHistogram: realJunctions.reduce((acc, j) => ({ ...acc, [j.arms.length]: (acc[j.arms.length] || 0) + 1 }), {}),
    components: componentSizes.length,
    largestComponentShare: junctions.length ? Math.round((Math.max(...componentSizes) / junctions.length) * 100) : 0,
    coverage: {
      lanesFromOsmPct: Math.round((lengthWhere((l) => l.lanes.source === SOURCES.OSM) / linkLengthTotal) * 100),
      speedFromOsmPct: Math.round((lengthWhere((l) => l.speedKmh.source === SOURCES.OSM) / linkLengthTotal) * 100),
    },
    processing: {
      osmWaysUsed: ways.length,
      osmNodes: nodeById.size,
      rawEdges: rawEdgeCount,
      passThroughMerges: mergedChains,
      shortEdgeMerges,
      internalJunctionEdges: internalEdges.length,
      signalNodes: signalPoints.length,
      unassignedSignals,
      restrictionsResolved: parsedRestrictions.length,
      restrictionsUnresolved: unresolvedRestrictions,
    },
  };
  if (summary.components > 1) {
    warnings.push(`Network has ${summary.components} disconnected parts; the largest holds ${summary.largestComponentShare}% of junctions.`);
  }
  if (!roads.length) warnings.push('No drivable roads found in this area. Try a larger area or include local streets.');

  for (const r of roads) {
    delete r._edge;
    delete r.parts;
  }

  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    bbox,
    options,
    junctions,
    roads,
    links,
    internalGeometry,
    summary,
    warnings,
  };
}
