// =====================================================
// CITY GRAPH
//
// The final network the policy is simulated on — a plain graph:
//
//   intersections  signalized intersections inside the selected
//                  area (the only nodes that make decisions)
//   gateways       where traffic enters / leaves: the first real
//                  junction outside the area along each road
//                  (traced outward, never the arbitrary box edge)
//   junctions      points where roads join or split without a signal
//   links          directed pieces of road between those nodes
//
// The result is the editable model of cityModel.js; the routes the
// engine uses are derived from it. Anything that never reaches an
// intersection is dropped.
// =====================================================

import { MODEL_CONSTANTS, SOURCES, roadClassInfo } from './roadDefaults.js';
import { LEFT_EXIT, THROUGH_EXIT } from '../simulation/constants.js';
import { GRID_DIRS, findCrossingConflict } from './buildSimulationNetwork.js';
import { deriveCity, pairDividedRoads } from './cityModel.js';
import { angleDiff, bearingDeg, compassLabel, haversineM, isInsideArea } from './geo.js';

export const DEFAULT_CITY_OPTIONS = {
  maxTraceM: 2500, // give up following a road after this distance
  minFeederM: 200, // a source/sink closer than this is skipped for the next junction
  mergeGatewayM: 120, // source and sink of the same road end closer than this become one
  turnLaneM: 80, // a road joining or leaving another this close to an intersection is one of its turns
};

const DIR_ANGLE = { N: 0, E: 90, S: 180, W: 270 };
// Arm of an intersection that an edge leaves from / arrives on.
const startArm = (e) => e.startArm ?? e.path[0].fromArm;
const endArm = (e) => e.endArm ?? e.path[e.path.length - 1].toArm;
const sumLength = (links) => links.reduce((t, l) => t + l.lengthM, 0);

function commonPrefix(a, b) {
  let k = 0;
  while (k < a.length && k < b.length && a[k].id === b[k].id) k += 1;
  return k;
}
function commonSuffix(a, b) {
  let k = 0;
  while (k < a.length && k < b.length && a[a.length - 1 - k].id === b[b.length - 1 - k].id) k += 1;
  return k;
}

// Which arm of intersection `node` a road lying at `bearing` uses, given
// the turn it makes. The arm that makes the turn a free left is preferred
// when the road really lies roughly there; otherwise the nearest arm.
function pickTurnArm(node, bearing, wantedArm, takenArm) {
  const rotation = node.ref.frameRotation || 0;
  const off = (dir) => Math.abs(angleDiff(DIR_ANGLE[dir] + rotation, bearing));
  if (wantedArm && off(wantedArm) <= 75) return wantedArm;
  return GRID_DIRS.filter((d) => d !== takenArm).sort((a, b) => off(a) - off(b))[0];
}

// ---------------------------------------------------------------
// Turn lanes
//
// A free-left (slip) lane is drawn in OSM as its own little road that
// leaves the approach just before an intersection and/or joins the exit
// road just after it. Traced naively it becomes a direct road between
// the intersections on either side, skipping the one it belongs to and
// duplicating the road it joins. Here such a road is given back to its
// intersection X:
//   leaves A→X near X and joins X→C near X : it is the turn itself, dropped
//   only joins X→C near X                 : becomes A→X on its own arm
//   only leaves A→X near X                : becomes X→C on its own arm
// and X is told which turn it stands for.
// ---------------------------------------------------------------
function absorbTurnLanes(edges, nodes, isCore, maxM) {
  const result = [];
  const extraShare = new Map(); // edge -> share taken over from a dropped turn lane
  const allow = new Map(); // core -> Set('from>to') turns that must exist
  const newArms = new Map(); // core -> Map(dir -> arm info)
  let absorbed = 0;

  const noteArm = (core, dir, bearing, path) => {
    if (nodes.get(core).ref.arms?.[dir]) return;
    if (!newArms.has(core)) newArms.set(core, new Map());
    if (newArms.get(core).has(dir)) return;
    const main = path.slice().sort((a, b) => roadClassInfo(b.highway).rank - roadClassInfo(a.highway).rank)[0];
    newArms.get(core).set(dir, {
      dir,
      bearing: Math.round(bearing),
      compass: compassLabel(bearing),
      name: path.find((l) => l.name)?.name || null,
      highway: main.highway,
      joinedArms: 1,
      inLanes: 0,
      outLanes: 0,
      turnLane: true,
    });
  };
  // Direction (seen from the intersection) in which a path lies, judged a
  // little way along it so the curve of the turn itself does not mislead.
  const bearingOfPath = (core, path, fromEnd) => {
    const coords = path.flatMap((l, i) => (i === 0 ? l.coords : l.coords.slice(1)));
    const ordered = fromEnd ? coords.slice().reverse() : coords;
    const c = nodes.get(core);
    const far = ordered.find((pt) => haversineM(c.lat, c.lon, pt[0], pt[1]) >= 60) || ordered[ordered.length - 1];
    return bearingDeg(c.lat, c.lon, far[0], far[1]);
  };

  for (const e of edges) {
    let join = null; // joins g: X→C close to X
    let leave = null; // leaves f: A→X close to X
    for (const g of edges) {
      if (g === e || !isCore(g.from) || g.from === e.from || g.from === e.to) continue;
      const k = commonSuffix(e.path, g.path);
      if (k === 0 || k >= e.path.length || k >= g.path.length) continue;
      const dist = sumLength(g.path.slice(0, g.path.length - k));
      if (dist <= maxM && (!join || dist < join.dist)) join = { g, k, dist, core: g.from };
    }
    for (const f of edges) {
      if (f === e || !isCore(f.to) || f.to === e.from || f.to === e.to) continue;
      const k = commonPrefix(e.path, f.path);
      if (k === 0 || k >= e.path.length || k >= f.path.length) continue;
      const dist = sumLength(f.path.slice(k));
      if (dist <= maxM && (!leave || dist < leave.dist)) leave = { f, k, dist, core: f.to };
    }

    if (join && leave && join.core === leave.core && join.k + leave.k <= e.path.length) {
      // The whole road is one turn at X: A→X, turn, X→C already exist.
      const from = endArm(leave.f);
      const to = startArm(join.g);
      if (from && to && from !== to) {
        extraShare.set(leave.f, (extraShare.get(leave.f) || 0) + e.share);
        if (!allow.has(join.core)) allow.set(join.core, new Set());
        allow.get(join.core).add(`${from}>${to}`);
        absorbed += 1;
        continue;
      }
    }
    if (join) {
      const exitArm = startArm(join.g);
      const path = e.path.slice(0, e.path.length - join.k);
      const bearing = bearingOfPath(join.core, path, true);
      const wanted = GRID_DIRS.find((d) => LEFT_EXIT[d] === exitArm);
      const arm = pickTurnArm(nodes.get(join.core), bearing, wanted, exitArm);
      if (exitArm && arm) {
        noteArm(join.core, arm, bearing, path);
        result.push({ ...e, to: join.core, kind: isCore(e.from) ? 'internal' : 'feeder', path, endArm: arm, turnTo: exitArm });
        absorbed += 1;
        continue;
      }
    }
    if (leave) {
      const entryArm = endArm(leave.f);
      const path = e.path.slice(leave.k);
      const bearing = bearingOfPath(leave.core, path, false);
      const arm = pickTurnArm(nodes.get(leave.core), bearing, LEFT_EXIT[entryArm], entryArm);
      if (entryArm && arm) {
        noteArm(leave.core, arm, bearing, path);
        extraShare.set(leave.f, (extraShare.get(leave.f) || 0) + e.share);
        result.push({ ...e, from: leave.core, kind: isCore(e.to) ? 'internal' : 'exit', path, share: 1, startArm: arm, turnFrom: entryArm });
        absorbed += 1;
        continue;
      }
    }
    result.push(e);
  }
  const out = result.map((e) => (extraShare.has(e) ? { ...e, share: Math.min(1, e.share + extraShare.get(e)) } : e));
  // Shares were keyed by the original objects; rewritten copies keep theirs.
  return { edges: out, absorbed, allow, newArms };
}

const endsWith = (long, short) => long.length > short.length && short.every((l, k) => long[long.length - short.length + k].id === l.id);
const startsWith = (long, short) => long.length > short.length && short.every((l, k) => long[k].id === l.id);

// A feeder that is only the last stretch of another road into the same
// intersection (or an exit that is only the first stretch of another road
// out of it) adds a second line on top of that road. This happens where a
// road briefly leaves the selected area. Such edges are dropped.
function dropOverlappingEdges(edges) {
  return edges.filter((e) => {
    if (e.kind === 'feeder') return !edges.some((f) => f !== e && f.to === e.to && endsWith(f.path, e.path));
    if (e.kind === 'exit') return !edges.some((f) => f !== e && f.from === e.from && startsWith(f.path, e.path));
    return true;
  });
}

// A road between two intersections that runs outside the selected area
// for a while is traced as a way out (to a sink) and a way in (from a
// source) that overlap in the middle. It is one road: the two are joined.
function joinThroughRoads(edges, isCore) {
  const usedFeeders = new Set();
  const joined = [];
  const out = [];
  for (const e of edges) {
    if (e.kind !== 'exit') { out.push(e); continue; }
    let made = false;
    for (const f of edges) {
      if (f.kind !== 'feeder' || !isCore(f.to) || f.to === e.from) continue;
      // Longest end of the way out that is also the start of the way in.
      let k = Math.min(e.path.length, f.path.length);
      while (k > 0 && !f.path.slice(0, k).every((l, n) => e.path[e.path.length - k + n].id === l.id)) k -= 1;
      if (!k) continue;
      joined.push({ ...e, to: f.to, kind: 'internal', path: [...e.path, ...f.path.slice(k)], endArm: f.endArm, turnTo: f.turnTo });
      usedFeeders.add(f);
      made = true;
    }
    if (!made) out.push(e);
  }
  return { edges: [...out.filter((e) => !usedFeeders.has(e)), ...joined], count: joined.length };
}

// Divided roads are two one-way carriageways in OSM, so the traffic
// leaving an arm and the traffic entering it can be traced to two
// different points along the road. Gateways serving the same arm of the
// same intersection are merged into one when they are within `maxM` of
// each other, or when one only sends traffic in and the other only takes
// it out and both lie in the same direction from the intersection.
// Returns a map gateway simId -> merged node.
const SAME_DIRECTION_DEG = 30;
const angleBetween = (c, a, b) => Math.abs(angleDiff(bearingDeg(c.lat, c.lon, a.lat, a.lon), bearingDeg(c.lat, c.lon, b.lat, b.lon)));

function mergeGatewayEnds(edges, nodes, isCore, maxM) {
  const byArm = new Map();
  const add = (core, arm, gatewayId, way) => {
    const key = `${core}|${arm}`;
    if (!byArm.has(key)) byArm.set(key, { core, ways: new Map() });
    const ways = byArm.get(key).ways;
    if (!ways.has(gatewayId)) ways.set(gatewayId, new Set());
    ways.get(gatewayId).add(way);
  };
  for (const e of edges) {
    if (e.kind === 'feeder' && isCore(e.to)) add(e.to, endArm(e), e.from, 'in');
    if (e.kind === 'exit' && isCore(e.from)) add(e.from, startArm(e), e.to, 'out');
  }
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) x = parent.get(x);
    return x;
  };
  for (const { core, ways } of byArm.values()) {
    const c = nodes.get(core);
    const list = Array.from(ways.keys());
    for (const id of list) if (!parent.has(id)) parent.set(id, id);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = nodes.get(list[i]);
        const b = nodes.get(list[j]);
        const wa = ways.get(list[i]);
        const wb = ways.get(list[j]);
        const inAndOut = wa.size === 1 && wb.size === 1 && [...wa][0] !== [...wb][0];
        const close = haversineM(a.lat, a.lon, b.lat, b.lon) <= maxM;
        if (close || (inAndOut && angleBetween(c, a, b) <= SAME_DIRECTION_DEG)) parent.set(find(list[i]), find(list[j]));
      }
    }
  }
  const groups = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }
  const merged = new Map();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const pts = members.map((id) => nodes.get(id));
    const junctions = pts.filter((n) => n.kind !== 'edge');
    // Sit on one of the real junctions (a midpoint could fall inside the area).
    const at = junctions.find((n) => n.name) || junctions[0] || pts[0];
    const node = {
      id: `merged:${members.sort().join('+')}`,
      kind: junctions.length ? 'merge' : 'edge',
      lat: at.lat,
      lon: at.lon,
      name: (junctions.find((n) => n.name) || pts.find((n) => n.name))?.name || null,
      inside: false,
      members,
    };
    nodes.set(node.id, node);
    for (const id of members) merged.set(id, node.id);
  }
  return merged;
}


function combineSource(values) {
  const set = new Set(values.map((v) => v.source));
  return set.size === 1 ? values[0].source : SOURCES.MIXED;
}

// Collapse a path of simulation-network links into one graph edge.
function pathToEdge(path, share) {
  const lengthM = path.reduce((s, l) => s + l.lengthM, 0);
  const narrowest = path.reduce((m, l) => (l.lanes.value < m.lanes.value ? l : m), path[0]);
  const speed = path.reduce((s, l) => s + l.speedKmh.value * l.lengthM, 0) / (lengthM || 1);
  const nameLength = new Map();
  for (const l of path) if (l.name) nameLength.set(l.name, (nameLength.get(l.name) || 0) + l.lengthM);
  const name = Array.from(nameLength.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const main = path.slice().sort((a, b) => roadClassInfo(b.highway).rank - roadClassInfo(a.highway).rank)[0];
  const lanes = narrowest.lanes.value;
  return {
    lengthM: Math.round(lengthM * 10) / 10,
    name,
    highway: main.highway,
    connector: path.every((l) => l.connector),
    lanes: {
      value: lanes,
      source: combineSource(path.map((l) => l.lanes)),
      detail: path.length > 1 ? `narrowest of ${path.length} road pieces` : narrowest.lanes.detail,
    },
    speedKmh: {
      value: Math.round(speed * 10) / 10,
      source: combineSource(path.map((l) => l.speedKmh)),
      detail: path.length > 1 ? `length-weighted over ${path.length} road pieces` : path[0].speedKmh.detail,
    },
    freeFlowTimeS: Math.round(path.reduce((s, l) => s + l.freeFlowTimeS, 0) * 10) / 10,
    saturationFlowVph: lanes * MODEL_CONSTANTS.saturationFlowPerLaneVph,
    storageVeh: Math.max(1, Math.floor((lengthM * lanes) / MODEL_CONSTANTS.jamSpacingM)),
    coords: path.flatMap((l, i) => (i === 0 ? l.coords : l.coords.slice(1))),
    share: Math.round(share * 1000) / 1000,
    simLinkIds: path.map((l) => l.id),
  };
}

export function buildCityGraph(simnet, innerBox, userOptions = {}) {
  const options = { ...DEFAULT_CITY_OPTIONS, ...userOptions };
  // Dropping arms (dead roads) can leave an intersection where nothing
  // crosses any more; such a point no longer needs a signal, so it is
  // treated like a merge point and the graph rebuilt, until stable.
  const demoted = new Set();
  let result = null;
  for (let round = 0; round < 10; round++) {
    result = assembleCityGraph(simnet, innerBox, options, demoted);
    const newlyDemoted = result.intersections
      .filter((i) => i.originalKind !== 'roundabout' && !findCrossingConflict(i.movements))
      .map((i) => i.simId);
    if (!newlyDemoted.length) break;
    newlyDemoted.forEach((id) => demoted.add(id));
  }
  result.extraction.summary.noLongerCrossing = demoted.size;
  result.summary.noLongerCrossing = demoted.size;
  if (demoted.size) {
    result.log.push({ step: 'No crossing traffic', detail: `${demoted.size} junction(s) where traffic only merges or splits need no signal` });
  }
  return result;
}

function assembleCityGraph(simnet, innerBox, options, demoted) {
  const log = [];

  // ---- Node table --------------------------------------------
  const nodes = new Map();
  for (const i of simnet.intersections) {
    nodes.set(i.id, { id: i.id, kind: i.control === 'signal' && !demoted.has(i.id) ? 'signal' : 'merge', lat: i.lat, lon: i.lon, name: i.name, ref: i });
  }
  for (const b of simnet.boundaryPoints) {
    nodes.set(b.id, { id: b.id, kind: 'edge', lat: b.lat, lon: b.lon, name: b.name, ref: b });
  }
  for (const n of nodes.values()) n.inside = isInsideArea(innerBox, n.lat, n.lon);
  const isCore = (id) => {
    const n = nodes.get(id);
    return n.kind === 'signal' && n.inside;
  };

  const outLinks = new Map();
  const inLinks = new Map();
  for (const l of simnet.links) {
    if (!outLinks.has(l.from)) outLinks.set(l.from, []);
    if (!inLinks.has(l.to)) inLinks.set(l.to, []);
    outLinks.get(l.from).push(l);
    inLinks.get(l.to).push(l);
  }

  // ---- Trace roads out of / into each core intersection -------
  const rawEdges = [];
  let abandoned = 0;
  const coreIds = Array.from(nodes.values()).filter((n) => isCore(n.id)).map((n) => n.id);

  const linksOfArm = (nodeId, dir, index) => {
    const arm = nodes.get(nodeId).ref.arms?.[dir];
    if (!arm) return [];
    const ids = new Set(index === 'out' ? arm.outLinkIds : arm.inLinkIds);
    return ((index === 'out' ? outLinks : inLinks).get(nodeId) || []).filter((l) => ids.has(l.id));
  };
  // Leaving merge point `node` after arriving on `arrived`.
  const onwardLinks = (node, arrived) => {
    const straight = arrived.toArm ? linksOfArm(node, THROUGH_EXIT[arrived.toArm], 'out') : [];
    if (straight.length) return straight;
    return (outLinks.get(node) || []).filter((l) => l.to !== arrived.from);
  };
  // Links arriving at merge point `node` that continue onto `leaving`.
  const upstreamLinks = (node, leaving) => {
    const straight = leaving.fromArm ? linksOfArm(node, THROUGH_EXIT[leaving.fromArm], 'in') : [];
    if (straight.length) return straight;
    return (inLinks.get(node) || []).filter((l) => l.from !== leaving.to);
  };

  // Fallback when going straight on never ends (e.g. a ring road made only
  // of merge points): the shortest way to the nearest stop.
  const isStop = (id, origin) => (isCore(id) && id !== origin) || !nodes.get(id).inside || nodes.get(id).kind === 'edge';
  const nearestStop = (origin, firstLink, forward) => {
    const startNode = forward ? firstLink.to : firstLink.from;
    if (isStop(startNode, origin)) return [firstLink];
    const best = new Map([[startNode, { dist: firstLink.lengthM, path: [firstLink] }]]);
    const queue = [startNode];
    let found = null;
    while (queue.length) {
      queue.sort((a, b) => best.get(a).dist - best.get(b).dist);
      const cur = queue.shift();
      const { dist, path } = best.get(cur);
      if (dist > options.maxTraceM) break;
      if (isStop(cur, origin)) { found = path; break; }
      if (cur === origin) continue;
      const nextLinks = forward ? (outLinks.get(cur) || []) : (inLinks.get(cur) || []);
      for (const l of nextLinks) {
        const nxt = forward ? l.to : l.from;
        const nd = dist + l.lengthM;
        if (nd < (best.get(nxt)?.dist ?? Infinity)) {
          best.set(nxt, { dist: nd, path: forward ? [...path, l] : [l, ...path] });
          queue.push(nxt);
        }
      }
    }
    return found;
  };

  const traceForward = (start, link) => {
    const before = rawEdges.length;
    const stack = [{ path: [link], share: 1, seen: new Set([start]) }];
    while (stack.length) {
      const { path, share, seen } = stack.pop();
      const last = path[path.length - 1];
      const cur = last.to;
      const length = path.reduce((s, l) => s + l.lengthM, 0);
      if (isCore(cur)) {
        if (cur !== start) rawEdges.push({ from: start, to: cur, kind: 'internal', path, share });
        continue;
      }
      const node = nodes.get(cur);
      if (!node.inside || node.kind === 'edge') {
        // Stop at the first junction outside the area — unless it is so
        // close that it would sit on top of the intersection.
        const onward = node.kind === 'edge' || length >= options.minFeederM ? [] : onwardLinks(cur, last);
        if (!onward.length || seen.has(cur)) {
          rawEdges.push({ from: start, to: cur, kind: 'exit', path, share });
          continue;
        }
        const nextSeen = new Set(seen).add(cur);
        const lanes = onward.reduce((s2, l) => s2 + l.lanes.value, 0) || 1;
        for (const l of onward) stack.push({ path: [...path, l], share: share * (l.lanes.value / lanes), seen: nextSeen });
        continue;
      }
      if (length > options.maxTraceM || seen.has(cur)) { abandoned += 1; continue; }
      // Inside merge/split point: keep following the same road (straight
      // on); only where the road ends at it (side road) take the turns.
      const onward = onwardLinks(cur, last);
      const totalLanes = onward.reduce((s, l) => s + l.lanes.value, 0) || 1;
      const nextSeen = new Set(seen).add(cur);
      for (const l of onward) stack.push({ path: [...path, l], share: share * (l.lanes.value / totalLanes), seen: nextSeen });
    }
    if (rawEdges.length === before) {
      const path = nearestStop(start, link, true);
      const to = path?.[path.length - 1].to;
      if (path && to !== start) rawEdges.push({ from: start, to, kind: isCore(to) ? 'internal' : 'exit', path, share: 1, viaFallback: true });
    }
  };

  const traceBackward = (end, link) => {
    const before = rawEdges.length;
    let reachedCore = false;
    const stack = [{ path: [link], seen: new Set([end]) }];
    while (stack.length) {
      const { path, seen } = stack.pop();
      const first = path[0];
      const cur = first.from;
      const length = path.reduce((s, l) => s + l.lengthM, 0);
      if (isCore(cur)) { reachedCore = true; continue; } // internal roads come from the forward trace
      const node = nodes.get(cur);
      if (!node.inside || node.kind === 'edge') {
        const upstream = node.kind === 'edge' || length >= options.minFeederM ? [] : upstreamLinks(cur, first);
        if (!upstream.length || seen.has(cur)) {
          rawEdges.push({ from: cur, to: end, kind: 'feeder', path, share: 1 });
          continue;
        }
        const nextSeen = new Set(seen).add(cur);
        for (const l of upstream) stack.push({ path: [l, ...path], seen: nextSeen });
        continue;
      }
      if (length > options.maxTraceM || seen.has(cur)) { abandoned += 1; continue; }
      const upstream = upstreamLinks(cur, first);
      const nextSeen = new Set(seen).add(cur);
      for (const l of upstream) stack.push({ path: [l, ...path], seen: nextSeen });
    }
    if (rawEdges.length === before && !reachedCore) {
      const path = nearestStop(end, link, false);
      const from = path?.[0].from;
      if (path && from !== end && !isCore(from)) rawEdges.push({ from, to: end, kind: 'feeder', path, share: 1, viaFallback: true });
    }
  };

  for (const id of coreIds) {
    for (const l of outLinks.get(id) || []) traceForward(id, l);
    for (const l of inLinks.get(id) || []) traceBackward(id, l);
  }

  // ---- Turn lanes belong to the intersection they bypass ---------
  const turnLanes = absorbTurnLanes(rawEdges, nodes, isCore, options.turnLaneM);

  // ---- Intersections left with ≤ 2 arms are just a road passing
  // through: join their roads. A road that would then run gateway →
  // gateway without meeting an intersection is dropped.
  let edges = turnLanes.edges;
  let passThrough = 0;
  const armsOf = (core) => {
    const arms = new Set();
    for (const e of edges) {
      if (e.to === core) arms.add(endArm(e));
      if (e.from === core) arms.add(startArm(e));
    }
    return arms;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const core of coreIds) {
      const incident = edges.filter((e) => e.from === core || e.to === core);
      if (!incident.length || armsOf(core).size > 2) continue;
      const ins = incident.filter((e) => e.to === core);
      const outs = incident.filter((e) => e.from === core);
      const joined = [];
      for (const a of ins) {
        for (const b of outs) {
          if (endArm(a) === startArm(b) || a.from === b.to) continue;
          const fromCore = isCore(a.from);
          const toCore = isCore(b.to);
          if (!fromCore && !toCore) continue;
          joined.push({
            from: a.from,
            to: b.to,
            kind: fromCore && toCore ? 'internal' : fromCore ? 'exit' : 'feeder',
            path: [...a.path, ...b.path],
            share: a.share * b.share,
            startArm: a.startArm,
            endArm: b.endArm,
            turnFrom: a.turnFrom,
            turnTo: b.turnTo,
          });
        }
      }
      edges = edges.filter((e) => e.from !== core && e.to !== core).concat(joined);
      passThrough += 1;
      changed = true;
    }
  }

  const through = joinThroughRoads(edges, isCore);
  edges = through.edges;

  const beforeOverlap = edges.length;
  edges = dropOverlappingEdges(edges);
  const overlapping = beforeOverlap - edges.length;

  // ---- Prune: every intersection must take traffic in and send it on,
  // and be reachable from a gateway and able to reach one.
  let removedCores = 0;
  for (let guard = 0; guard < 20; guard++) {
    const coresInUse = new Set();
    for (const e of edges) {
      if (isCore(e.from)) coresInUse.add(e.from);
      if (isCore(e.to)) coresInUse.add(e.to);
    }
    const fromGateway = new Set();
    const toGateway = new Set();
    const walk = (seeds, next, into) => {
      const stack = [...seeds];
      while (stack.length) {
        const n = stack.pop();
        if (into.has(n)) continue;
        into.add(n);
        for (const m of next(n)) stack.push(m);
      }
    };
    walk(edges.filter((e) => e.kind === 'feeder').map((e) => e.to), (n) => edges.filter((e) => e.from === n && e.kind === 'internal').map((e) => e.to), fromGateway);
    walk(edges.filter((e) => e.kind === 'exit').map((e) => e.from), (n) => edges.filter((e) => e.to === n && e.kind === 'internal').map((e) => e.from), toGateway);
    const dead = Array.from(coresInUse).filter((c) => !fromGateway.has(c) || !toGateway.has(c));
    if (!dead.length) break;
    removedCores += dead.length;
    const deadSet = new Set(dead);
    edges = edges.filter((e) => !deadSet.has(e.from) && !deadSet.has(e.to));
  }

  // ---- One source/sink per road end ------------------------------
  const mergedInto = mergeGatewayEnds(edges, nodes, isCore, options.mergeGatewayM);
  if (mergedInto.size) {
    edges = edges.map((e) => ({ ...e, from: mergedInto.get(e.from) ?? e.from, to: mergedInto.get(e.to) ?? e.to }));
  }
  const mergedGateways = new Set(mergedInto.values()).size;

  // ---- Physical road pieces --------------------------------------
  // Routes that share a stretch of road share the same sim links. A point
  // on the way where three or more road branches meet is a junction (no
  // signal); every route through it is cut there and identical pieces
  // become one road, so both directions of a road meet at the same dot.
  const branches = new Map(); // point a route passes -> the points next to it on any route
  for (const e of edges) {
    for (let k = 0; k + 1 < e.path.length; k++) {
      const point = e.path[k].to;
      if (!branches.has(point)) branches.set(point, new Set());
      branches.get(point).add(e.path[k].from).add(e.path[k + 1].to);
    }
  }
  // Three or more road branches meeting: roads join, split or fork there.
  const junctionSims = new Set(Array.from(branches.entries()).filter(([, around]) => around.size >= 3).map(([point]) => point));

  const usedCores = new Set();
  const usedGateways = new Set();
  for (const e of edges) {
    for (const id of [e.from, e.to]) (isCore(id) ? usedCores : usedGateways).add(id);
  }
  const byPosition = (x, y) => (nodes.get(y).lat - nodes.get(x).lat) || (nodes.get(x).lon - nodes.get(y).lon);
  const intersectionId = new Map(Array.from(usedCores).sort(byPosition).map((id, k) => [id, `I${k + 1}`]));
  const gatewayId = new Map(Array.from(usedGateways).sort(byPosition).map((id, k) => [id, `G${k + 1}`]));
  const junctionId = new Map(Array.from(junctionSims).sort(byPosition).map((id, k) => [id, `J${k + 1}`]));
  const idOf = (simId) => intersectionId.get(simId) || gatewayId.get(simId);

  const pieceByKey = new Map();
  const pieces = [];
  const turnsGiven = new Map(); // intersection sim id -> [{ from, to }] turns a turn lane stands for
  const giveTurn = (core, from, to) => {
    if (!turnsGiven.has(core)) turnsGiven.set(core, []);
    turnsGiven.get(core).push({ from, to });
  };
  for (const e of edges) {
    const cuts = [0];
    for (let k = 0; k + 1 < e.path.length; k++) if (junctionSims.has(e.path[k].to)) cuts.push(k + 1);
    cuts.push(e.path.length);
    let previous = null;
    for (let c = 0; c + 1 < cuts.length; c++) {
      const path = e.path.slice(cuts[c], cuts[c + 1]);
      const isFirst = c === 0;
      const isLast = c + 2 === cuts.length;
      const from = isFirst ? idOf(e.from) : junctionId.get(e.path[cuts[c] - 1].to);
      const to = isLast ? idOf(e.to) : junctionId.get(path[path.length - 1].to);
      const key = `${from}|${to}|${path.map((l) => l.id).join(',')}`;
      let piece = pieceByKey.get(key);
      if (!piece) {
        piece = {
          from,
          to,
          path,
          fromArm: isFirst && isCore(e.from) ? startArm(e) : null,
          toArm: isLast && isCore(e.to) ? endArm(e) : null,
          turnLane: false,
          next: new Map(),
        };
        pieceByKey.set(key, piece);
        pieces.push(piece);
      }
      if (isLast && isCore(e.to) && e.turnTo) {
        piece.turnLane = true;
        piece.turnTo = e.turnTo;
        giveTurn(e.to, endArm(e), e.turnTo);
      }
      if (isFirst && isCore(e.from) && e.turnFrom) {
        piece.turnLane = true;
        piece.turnFrom = e.turnFrom;
        giveTurn(e.from, e.turnFrom, startArm(e));
      }
      if (previous) previous.next.set(piece, (previous.next.get(piece) || 0) + e.share);
      previous = piece;
    }
  }
  pieces.forEach((piece, k) => { piece.id = `L${k + 1}`; });
  const modelLinks = pieces.map((piece) => {
    const { share: _share, ...attrs } = pathToEdge(piece.path, 1);
    return {
      id: piece.id,
      from: piece.from,
      to: piece.to,
      fromArm: piece.fromArm,
      toArm: piece.toArm,
      ...attrs,
      turnLane: piece.turnLane,
      next: piece.next.size ? Object.fromEntries(Array.from(piece.next.entries()).map(([nxt, w]) => [nxt.id, Math.round(w * 1000) / 1000])) : null,
    };
  });

  // Turns each intersection does not offer: the map's restrictions, and
  // for an arm made only of turn lanes everything but the turn they make.
  const blockedTurnsOf = (simId) => {
    const src = nodes.get(simId).ref;
    const blocked = new Set(src.movements.filter((m) => !m.allowed).map((m) => `${m.from}>${m.to}`));
    for (const dir of GRID_DIRS) {
      const arriving = pieces.filter((x) => x.to === intersectionId.get(simId) && x.toArm === dir);
      if (arriving.length && arriving.every((x) => x.turnTo)) {
        for (const to of GRID_DIRS) if (to !== dir && !arriving.some((x) => x.turnTo === to)) blocked.add(`${dir}>${to}`);
      }
      const leaving = pieces.filter((x) => x.from === intersectionId.get(simId) && x.fromArm === dir);
      if (leaving.length && leaving.every((x) => x.turnFrom)) {
        for (const from of GRID_DIRS) if (from !== dir && !leaving.some((x) => x.turnFrom === from)) blocked.add(`${from}>${dir}`);
      }
    }
    for (const key of turnLanes.allow.get(simId) || []) blocked.delete(key);
    for (const t of turnsGiven.get(simId) || []) blocked.delete(`${t.from}>${t.to}`);
    return Array.from(blocked).sort();
  };

  const modelNodes = [
    ...Array.from(usedCores).map((simId) => {
      const src = nodes.get(simId).ref;
      return {
        id: intersectionId.get(simId),
        kind: 'intersection',
        lat: src.lat,
        lon: src.lon,
        name: src.name,
        frameRotation: src.frameRotation,
        originalKind: src.originalKind,
        osmSignal: src.osmSignal,
        originalArmCount: src.originalArmCount,
        sourceJunctionId: src.sourceJunctionId,
        simId,
        blockedTurns: blockedTurnsOf(simId),
      };
    }),
    ...Array.from(junctionSims).map((simId) => {
      const n = nodes.get(simId);
      return { id: junctionId.get(simId), kind: 'junction', lat: n.lat, lon: n.lon, name: n.name || null, simId };
    }),
    ...Array.from(usedGateways).map((simId) => {
      const n = nodes.get(simId);
      return { id: gatewayId.get(simId), kind: 'gateway', lat: n.lat, lon: n.lon, name: n.kind === 'edge' ? null : n.name, placedAt: n.kind === 'edge' ? 'download-edge' : 'junction', simId };
    }),
  ].sort((x, y) => x.id[0].localeCompare(y.id[0]) || Number(x.id.slice(1)) - Number(y.id.slice(1)));

  const atDownloadEdge = modelNodes.filter((n) => n.placedAt === 'download-edge').length;
  const feeders = edges.filter((e) => e.kind === 'feeder').length;
  const exits = edges.filter((e) => e.kind === 'exit').length;
  log.push({ step: 'Intersections', detail: `${usedCores.size} signalized intersection(s) inside your area` });
  log.push({ step: 'Roads', detail: `${modelLinks.length} road piece(s); ${junctionSims.size} junction(s) without signal where roads join or split` });
  log.push({ step: 'Traffic in and out', detail: `${feeders} way(s) in and ${exits} way(s) out, traced to the previous junction outside the area` });
  if (turnLanes.absorbed) log.push({ step: 'Turn lanes', detail: `${turnLanes.absorbed} turn lane(s) that skipped an intersection now arrive at it and turn there` });
  if (through.count) log.push({ step: 'Roads rejoined', detail: `${through.count} road(s) between two intersections that leave the area and come back` });
  if (overlapping) log.push({ step: 'Overlaps removed', detail: `${overlapping} source/sink road(s) that ran on top of another road` });
  if (mergedGateways) log.push({ step: 'Road ends merged', detail: `${mergedGateways} source/sink pair(s) at the two carriageways of one road` });
  if (passThrough) log.push({ step: 'Joined', detail: `${passThrough} point(s) with only two arms were just a road passing through` });
  if (removedCores) log.push({ step: 'Dropped', detail: `${removedCores} intersection(s) that traffic could not pass through` });

  const warnings = [];
  if (!usedCores.size) warnings.push('No signalized intersections inside the selected area. Make the box larger or move it over main roads.');
  if (atDownloadEdge) warnings.push(`${atDownloadEdge} road(s) had no junction within the extra download margin; their source/sink sits at the margin edge.`);

  return deriveCity({
    area: innerBox,
    downloadBox: simnet.bbox,
    model: pairDividedRoads({ nodes: modelNodes, links: modelLinks }),
    extraction: {
      summary: {
        removedIntersections: removedCores,
        passThroughJoined: passThrough,
        abandonedTraces: abandoned,
        overlappingDropped: overlapping,
        throughRoadsJoined: through.count,
        turnLanesAbsorbed: turnLanes.absorbed,
        gatewaysMerged: mergedGateways,
      },
      log,
      warnings,
    },
  });
}
