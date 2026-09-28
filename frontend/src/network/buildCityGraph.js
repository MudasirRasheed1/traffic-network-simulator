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
//   edges          directed roads intersection→intersection,
//                  gateway→intersection (feeder) and
//                  intersection→gateway (exit)
//
// Merge/split points inside the area are folded into the roads
// that pass through them; anything that never reaches an
// intersection is dropped.
// =====================================================

import { MODEL_CONSTANTS, SOURCES, roadClassInfo } from './roadDefaults.js';
import { LEFT_EXIT, PHASES, RIGHT_EXIT, THROUGH_EXIT } from '../simulation/constants.js';
import { GRID_DIRS, findCrossingConflict } from './buildSimulationNetwork.js';
import { isInsideArea } from './geo.js';

export const DEFAULT_CITY_OPTIONS = {
  maxTraceM: 2500, // give up following a road after this distance
  minFeederM: 200, // a source/sink closer than this is skipped for the next junction
};


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
  result.summary.noLongerCrossing = demoted.size;
  if (demoted.size) {
    result.log.splice(result.log.length - 0, 0, { step: 'No crossing traffic', detail: `${demoted.size} junction(s) where traffic only merges or splits were folded into the roads` });
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

  // ---- Intersections left with ≤ 2 arms are just a road passing
  // through: join their roads. A road that would then run gateway →
  // gateway without meeting an intersection is dropped.
  let edges = rawEdges;
  let passThrough = 0;
  const armsOf = (core) => {
    const arms = new Set();
    for (const e of edges) {
      if (e.to === core) arms.add(e.path[e.path.length - 1].toArm);
      if (e.from === core) arms.add(e.path[0].fromArm);
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
          if (a.path[a.path.length - 1].toArm === b.path[0].fromArm || a.from === b.to) continue;
          const fromCore = isCore(a.from);
          const toCore = isCore(b.to);
          if (!fromCore && !toCore) continue;
          joined.push({
            from: a.from,
            to: b.to,
            kind: fromCore && toCore ? 'internal' : fromCore ? 'exit' : 'feeder',
            path: [...a.path, ...b.path],
            share: a.share * b.share,
          });
        }
      }
      edges = edges.filter((e) => e.from !== core && e.to !== core).concat(joined);
      passThrough += 1;
      changed = true;
    }
  }

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

  // ---- Build output objects ------------------------------------
  const usedCores = new Set();
  const usedGateways = new Set();
  for (const e of edges) {
    for (const id of [e.from, e.to]) (isCore(id) ? usedCores : usedGateways).add(id);
  }
  const byPosition = (a, b) => (nodes.get(b).lat - nodes.get(a).lat) || (nodes.get(a).lon - nodes.get(b).lon);
  const intersectionId = new Map(Array.from(usedCores).sort(byPosition).map((id, k) => [id, `I${k + 1}`]));
  const gatewayId = new Map(Array.from(usedGateways).sort(byPosition).map((id, k) => [id, `G${k + 1}`]));
  const idOf = (simId) => intersectionId.get(simId) || gatewayId.get(simId);

  const outEdges = edges.map((e, k) => {
    const first = e.path[0];
    const last = e.path[e.path.length - 1];
    return {
      id: `E${k + 1}`,
      from: idOf(e.from),
      to: idOf(e.to),
      kind: e.kind,
      fromArm: isCore(e.from) ? first.fromArm : null,
      toArm: isCore(e.to) ? last.toArm : null,
      ...pathToEdge(e.path, e.share),
    };
  });

  const intersections = Array.from(usedCores).map((simId) => {
    const src = nodes.get(simId).ref;
    const id = intersectionId.get(simId);
    const arms = {};
    for (const dir of GRID_DIRS) {
      const a = src.arms[dir];
      if (!a) continue;
      const inEdgeIds = outEdges.filter((e) => e.to === id && e.toArm === dir).map((e) => e.id);
      const outEdgeIds = outEdges.filter((e) => e.from === id && e.fromArm === dir).map((e) => e.id);
      if (!inEdgeIds.length && !outEdgeIds.length) continue;
      const lanesOf = (ids) => ids.reduce((s, eid) => {
        const e = outEdges.find((x) => x.id === eid);
        return s + e.lanes.value;
      }, 0);
      arms[dir] = {
        dir,
        bearing: a.bearing,
        compass: a.compass,
        name: a.name,
        highway: a.highway,
        joinedArms: a.joinedArms,
        inEdgeIds,
        outEdgeIds,
        // Several edges can leave one arm when a road splits further on.
        inLanes: a.inLanes,
        outLanes: a.outLanes,
        edgeLanesIn: lanesOf(inEdgeIds),
      };
    }
    const movements = [];
    for (const from of GRID_DIRS) {
      if (!arms[from]?.inEdgeIds.length) continue;
      for (const [turn, exitMap] of [['L', LEFT_EXIT], ['T', THROUGH_EXIT], ['R', RIGHT_EXIT]]) {
        const to = exitMap[from];
        if (!arms[to]?.outEdgeIds.length) continue;
        const original = src.movements.find((m) => m.from === from && m.to === to);
        movements.push({ from, to, turn, allowed: original ? original.allowed : true, reason: original?.reason || null });
      }
    }
    const allowedSet = new Set(movements.filter((m) => m.allowed).map((m) => `${m.from}${m.turn}`));
    const phases = Object.entries(PHASES)
      .map(([name, moves]) => {
        const served = moves.filter(([approach, mv]) => allowedSet.has(`${approach}${mv}`));
        return { name, served: served.map(([ap, mv]) => `${ap}${mv}`), partial: served.length < moves.length };
      })
      .filter((p) => p.served.length > 0);
    return {
      id,
      simId,
      lat: src.lat,
      lon: src.lon,
      name: src.name,
      originalKind: src.originalKind,
      osmSignal: src.osmSignal,
      frameRotation: src.frameRotation,
      originalArmCount: src.originalArmCount,
      armCount: Object.keys(arms).length,
      arms,
      movements,
      phases,
      sourceJunctionId: src.sourceJunctionId,
    };
  }).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));

  const gateways = Array.from(usedGateways).map((simId) => {
    const n = nodes.get(simId);
    const id = gatewayId.get(simId);
    const feederEdgeIds = outEdges.filter((e) => e.from === id).map((e) => e.id);
    const exitEdgeIds = outEdges.filter((e) => e.to === id).map((e) => e.id);
    const roadName = outEdges.find((e) => e.from === id || e.to === id)?.name || null;
    return {
      id,
      lat: n.lat,
      lon: n.lon,
      role: feederEdgeIds.length && exitEdgeIds.length ? 'both' : feederEdgeIds.length ? 'source' : 'sink',
      placedAt: n.kind === 'edge' ? 'download-edge' : 'junction',
      junctionName: n.kind === 'edge' ? null : n.name,
      roadName,
      feederEdgeIds,
      exitEdgeIds,
    };
  }).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));

  // Road pairs for drawing: both directions between the same two nodes.
  const roads = [];
  const roadByKey = new Map();
  for (const e of outEdges) {
    const key = [e.from, e.to].sort().join('~');
    let road = roadByKey.get(key);
    if (!road) {
      road = { id: `R${roads.length + 1}`, a: e.from, b: e.to, edgeIds: [], kind: e.kind === 'internal' ? 'internal' : 'boundary' };
      roads.push(road);
      roadByKey.set(key, road);
    }
    road.edgeIds.push(e.id);
    e.roadId = road.id;
  }

  const summary = {
    intersections: intersections.length,
    armsHistogram: intersections.reduce((acc, i) => ({ ...acc, [i.armCount]: (acc[i.armCount] || 0) + 1 }), {}),
    fromRoundabouts: intersections.filter((i) => i.originalKind === 'roundabout').length,
    sources: gateways.filter((g) => g.role !== 'sink').length,
    sinks: gateways.filter((g) => g.role !== 'source').length,
    gateways: gateways.length,
    internalEdges: outEdges.filter((e) => e.kind === 'internal').length,
    feederEdges: outEdges.filter((e) => e.kind === 'feeder').length,
    exitEdges: outEdges.filter((e) => e.kind === 'exit').length,
    roadKm: Math.round(outEdges.filter((e) => e.kind === 'internal').reduce((s, e) => s + e.lengthM, 0) / 100) / 10,
    gatewaysAtDownloadEdge: gateways.filter((g) => g.placedAt === 'download-edge').length,
    removedIntersections: removedCores,
    passThroughJoined: passThrough,
    abandonedTraces: abandoned,
  };

  log.push({ step: 'Intersections', detail: `${intersections.length} signalized intersection(s) inside your area` });
  log.push({ step: 'Roads between them', detail: `${summary.internalEdges} directed road(s); merge/split points folded into the roads` });
  log.push({ step: 'Traffic in and out', detail: `${summary.feederEdges} feeder and ${summary.exitEdges} exit road(s), traced out to the previous junction (${summary.sources} source(s), ${summary.sinks} sink(s))` });
  if (passThrough) log.push({ step: 'Joined', detail: `${passThrough} point(s) with only two arms were just a road passing through` });
  if (removedCores) log.push({ step: 'Dropped', detail: `${removedCores} intersection(s) that traffic could not pass through` });

  const warnings = [];
  if (!intersections.length) warnings.push('No signalized intersections inside the selected area. Make the box larger or move it over main roads.');
  if (summary.gatewaysAtDownloadEdge) warnings.push(`${summary.gatewaysAtDownloadEdge} road(s) had no junction within the extra download margin; their source/sink sits at the margin edge.`);

  return {
    schemaVersion: 1,
    kind: 'city-graph',
    area: innerBox,
    downloadBox: simnet.bbox,
    intersections,
    gateways,
    edges: outEdges,
    roads,
    summary,
    log,
    warnings,
  };
}
