// =====================================================
// SIMULATION NETWORK ("city skeleton")
//
// Reduces the full road graph to what the signal-control
// algorithm needs — intersections joined by directed links,
// exactly like the grid simulator:
//
//   1. keep main roads (+ minor streets that are real shortcuts
//      between two main junctions)
//   2. repeatedly remove dead ends and anything traffic from the
//      entry points cannot pass through
//   3. join roads through points that are not intersections
//   4. give every intersection at most 4 arms (arms arriving from
//      the same direction are joined) labelled N / E / S / W
//   5. every intersection (roundabouts included) is signal
//      controlled and gets the grid's movements and phases
// =====================================================

import { angleDiff, bearingDeg, compassLabel, pointAlong } from './geo.js';
import { MAIN_ROAD_CLASSES, MODEL_CONSTANTS, SOURCES, roadClassInfo } from './roadDefaults.js';
import { LEFT_EXIT, PHASES, RIGHT_EXIT, THROUGH_EXIT } from '../simulation/constants.js';

export const GRID_DIRS = ['N', 'E', 'S', 'W']; // clockwise
const DIR_ANGLE = { N: 0, E: 90, S: 180, W: 270 };
const PHASE_SETS = Object.values(PHASES).map((moves) => new Set(moves.map(([approach, mv]) => `${approach}${mv}`)));

export const DEFAULT_SIMNET_OPTIONS = {
  roadClasses: MAIN_ROAD_CLASSES,
  includeConnectors: true,
  connectorMaxLengthM: 800,   // longest minor-street chain considered a connector
  connectorShortcutRatio: 1.5, // keep it only if the main-road detour is ≥ 1.5× longer
  armMergeDeg: 35,            // one-way in/out legs this close form one (divided) arm
  legProbeM: 25,
};

// ---------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------
function circularMean(bearings) {
  const base = bearings[0];
  const avg = bearings.reduce((s, b) => s + angleDiff(base, b), 0) / bearings.length;
  return (base + avg + 360) % 360;
}

function combineSource(values) {
  const set = new Set(values.map((v) => v.source));
  return set.size === 1 ? values[0].source : SOURCES.MIXED;
}

class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.items.length; }
}

function shortestDistance(adjacency, from, to, limit) {
  const dist = new Map([[from, 0]]);
  const heap = new MinHeap();
  heap.push([0, from]);
  while (heap.size) {
    const [d, node] = heap.pop();
    if (node === to) return d;
    if (d > limit) return Infinity;
    if (d > (dist.get(node) ?? Infinity)) continue;
    for (const [next, w] of adjacency.get(node) || []) {
      const nd = d + w;
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd);
        heap.push([nd, next]);
      }
    }
  }
  return Infinity;
}

// ---------------------------------------------------------------
// Step 1b: minor streets that genuinely connect two main junctions
// ---------------------------------------------------------------
function findConnectorChains(graph, isMainRoad, mainJunctions, options) {
  const roadById = new Map(graph.roads.map((r) => [r.id, r]));
  const junctionById = new Map(graph.junctions.map((j) => [j.id, j]));
  const minorAdj = new Map();
  for (const r of graph.roads) {
    if (isMainRoad(r)) continue;
    for (const end of [r.from, r.to]) {
      if (!minorAdj.has(end)) minorAdj.set(end, new Set());
      minorAdj.get(end).add(r.id);
    }
  }

  // Strip minor dead-end branches (cul-de-sacs, lanes leaving the area).
  const queue = Array.from(minorAdj.keys());
  while (queue.length) {
    const j = queue.pop();
    const set = minorAdj.get(j);
    if (!set) continue;
    const junction = junctionById.get(j);
    const isAnchor = mainJunctions.has(j);
    if (isAnchor && !junction.isBoundary) continue;
    if (junction.isBoundary || set.size <= 1) {
      for (const rid of set) {
        const r = roadById.get(rid);
        const other = r.from === j ? r.to : r.from;
        minorAdj.get(other)?.delete(rid);
        queue.push(other);
      }
      minorAdj.delete(j);
    }
  }

  const mainAdj = new Map();
  for (const r of graph.roads) {
    if (!isMainRoad(r)) continue;
    for (const [a, b] of [[r.from, r.to], [r.to, r.from]]) {
      if (!mainAdj.has(a)) mainAdj.set(a, []);
      mainAdj.get(a).push([b, r.lengthM]);
    }
  }

  const linkDirection = (road, fromJ) => road.linkIds.some((id) => (id.endsWith('f') ? road.from : road.to) === fromJ);
  const chains = [];
  const seen = new Set();
  for (const m of mainJunctions) {
    for (const startId of minorAdj.get(m) || []) {
      const path = [startId];
      let length = roadById.get(startId).lengthM;
      let forwardOk = linkDirection(roadById.get(startId), m);
      let backwardOk = linkDirection(roadById.get(startId), roadById.get(startId).from === m ? roadById.get(startId).to : roadById.get(startId).from);
      let cur = roadById.get(startId).from === m ? roadById.get(startId).to : roadById.get(startId).from;
      let ok = true;
      while (!mainJunctions.has(cur)) {
        const set = minorAdj.get(cur);
        if (!set || set.size !== 2) { ok = false; break; }
        const nextId = Array.from(set).find((id) => id !== path[path.length - 1]);
        const next = roadById.get(nextId);
        const nextEnd = next.from === cur ? next.to : next.from;
        forwardOk = forwardOk && linkDirection(next, cur);
        backwardOk = backwardOk && linkDirection(next, nextEnd);
        path.push(nextId);
        length += next.lengthM;
        if (length > options.connectorMaxLengthM) { ok = false; break; }
        cur = nextEnd;
      }
      if (!ok || cur === m || (!forwardOk && !backwardOk)) continue;
      const key = path.slice().sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const detour = shortestDistance(mainAdj, m, cur, length * options.connectorShortcutRatio);
      if (detour >= length * options.connectorShortcutRatio) {
        chains.push({ from: m, to: cur, roadIds: path, lengthM: Math.round(length), detourM: Number.isFinite(detour) ? Math.round(detour) : null });
      }
    }
  }
  return chains;
}

// ---------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------
export function buildSimulationNetwork(graph, userOptions = {}) {
  const options = { ...DEFAULT_SIMNET_OPTIONS, ...userOptions };
  const mainClasses = new Set(options.roadClasses);
  const isMainRoad = (r) => mainClasses.has(r.highway);
  const junctionById = new Map(graph.junctions.map((j) => [j.id, j]));
  const fullLinkById = new Map(graph.links.map((l) => [l.id, l]));
  const log = [];

  // ---- 1. Road selection --------------------------------------
  const mainRoads = graph.roads.filter(isMainRoad);
  const mainJunctions = new Set();
  for (const r of mainRoads) {
    for (const j of [r.from, r.to]) if (!junctionById.get(j).isBoundary) mainJunctions.add(j);
  }
  const selectedRoads = new Map(mainRoads.map((r) => [r.id, { road: r, connector: false }]));
  log.push({ step: 'Main roads', detail: `${mainRoads.length} of ${graph.roads.length} road segments are primary/secondary/tertiary` });

  let chains = [];
  if (options.includeConnectors) {
    chains = findConnectorChains(graph, isMainRoad, mainJunctions, options);
    const roadById = new Map(graph.roads.map((r) => [r.id, r]));
    for (const c of chains) for (const id of c.roadIds) selectedRoads.set(id, { road: roadById.get(id), connector: true });
    log.push({ step: 'Connector streets', detail: `${chains.length} minor street(s) kept as shortcuts between main junctions` });
  }

  // ---- Directed link index ------------------------------------
  let linkSeq = 0;
  const links = new Map();
  const outIdx = new Map();
  const inIdx = new Map();
  const addLink = (link) => {
    links.set(link.id, link);
    if (!outIdx.has(link.from)) outIdx.set(link.from, new Set());
    if (!inIdx.has(link.to)) inIdx.set(link.to, new Set());
    outIdx.get(link.from).add(link.id);
    inIdx.get(link.to).add(link.id);
  };
  const removeLink = (id) => {
    const l = links.get(id);
    if (!l) return;
    links.delete(id);
    outIdx.get(l.from)?.delete(id);
    inIdx.get(l.to)?.delete(id);
  };
  const linksAt = (node) => [
    ...Array.from(outIdx.get(node) || []).map((id) => links.get(id)),
    ...Array.from(inIdx.get(node) || []).map((id) => links.get(id)),
  ];

  for (const { road, connector } of selectedRoads.values()) {
    for (const fullId of road.linkIds) {
      const full = fullLinkById.get(fullId);
      const forward = fullId.endsWith('f');
      addLink({
        id: `t${++linkSeq}`,
        from: full.from,
        to: full.to,
        coords: forward ? road.coords : road.coords.slice().reverse(),
        segments: [{ ...full, highway: road.highway, name: road.name, connector }],
      });
    }
  }

  // ---- Arms of a node from its current links ------------------
  const nodePos = (id) => {
    const j = junctionById.get(id);
    return [j.lat, j.lon];
  };
  const legBearing = (node, coordsAway, lengthM) => {
    const [lat, lon] = nodePos(node);
    const probe = pointAlong(coordsAway, Math.min(options.legProbeM, lengthM * 0.5));
    return bearingDeg(lat, lon, probe[0], probe[1]);
  };
  const linkLength = (l) => l.segments.reduce((s, x) => s + x.lengthM, 0);

  function computeArms(node) {
    const groups = new Map(); // neighbour -> legs
    for (const l of linksAt(node)) {
      const isOut = l.from === node;
      const neighbour = isOut ? l.to : l.from;
      const away = isOut ? l.coords : l.coords.slice().reverse();
      const leg = { link: l, isOut, bearing: legBearing(node, away, linkLength(l)) };
      if (!groups.has(neighbour)) groups.set(neighbour, []);
      groups.get(neighbour).push(leg);
    }
    let arms = Array.from(groups.values()).map((legs) => ({ legs, bearing: circularMean(legs.map((x) => x.bearing)) }));
    // Pair divided carriageways that end at different neighbours.
    const inOnly = (a) => a.legs.every((x) => !x.isOut);
    const outOnly = (a) => a.legs.every((x) => x.isOut);
    const pairs = [];
    arms.forEach((a, i) => arms.forEach((b, k) => {
      if (k <= i) return;
      const gap = Math.abs(angleDiff(a.bearing, b.bearing));
      if (gap <= options.armMergeDeg && ((inOnly(a) && outOnly(b)) || (outOnly(a) && inOnly(b)))) pairs.push({ i, k, gap });
    }));
    pairs.sort((x, y) => x.gap - y.gap);
    const used = new Set();
    const merged = [];
    for (const p of pairs) {
      if (used.has(p.i) || used.has(p.k)) continue;
      used.add(p.i);
      used.add(p.k);
      const legs = [...arms[p.i].legs, ...arms[p.k].legs];
      merged.push({ legs, bearing: circularMean(legs.map((x) => x.bearing)) });
    }
    arms = [...merged, ...arms.filter((_, i) => !used.has(i))];
    return arms.sort((a, b) => a.bearing - b.bearing);
  }

  // ---- 2 & 3. Prune / reachability / contraction loop ----------
  const isBoundary = (id) => junctionById.get(id).isBoundary;
  const allNodes = () => new Set([...outIdx.keys(), ...inIdx.keys()].filter((n) => linksAt(n).length));
  let prunedDeadEnds = 0;
  let prunedUnreachable = 0;
  let contracted = 0;

  const concat = (a, b) => ({
    id: `t${++linkSeq}`,
    from: a.from,
    to: b.to,
    coords: a.coords.concat(b.coords.slice(1)),
    segments: [...a.segments, ...b.segments],
  });

  for (let guard = 0; guard < 50; guard++) {
    let changed = false;

    // Dead ends: a non-boundary node reaching only one other node.
    let removedSomething = true;
    while (removedSomething) {
      removedSomething = false;
      for (const node of allNodes()) {
        if (isBoundary(node)) continue;
        const neighbours = new Set(linksAt(node).map((l) => (l.from === node ? l.to : l.from)));
        neighbours.delete(node);
        if (neighbours.size <= 1) {
          for (const l of linksAt(node)) removeLink(l.id);
          prunedDeadEnds += 1;
          removedSomething = true;
          changed = true;
        }
      }
    }

    // Keep only what lies on some entry -> exit path.
    const nodes = allNodes();
    const entries = Array.from(nodes).filter((n) => isBoundary(n) && (outIdx.get(n)?.size || 0) > 0);
    const exits = Array.from(nodes).filter((n) => isBoundary(n) && (inIdx.get(n)?.size || 0) > 0);
    if (entries.length && exits.length) {
      const walk = (starts, index, pick) => {
        const seen = new Set(starts);
        const stack = [...starts];
        while (stack.length) {
          const n = stack.pop();
          for (const id of index.get(n) || []) {
            const next = pick(links.get(id));
            if (!seen.has(next)) { seen.add(next); stack.push(next); }
          }
        }
        return seen;
      };
      const fromEntries = walk(entries, outIdx, (l) => l.to);
      const toExits = walk(exits, inIdx, (l) => l.from);
      for (const l of Array.from(links.values())) {
        const ok = fromEntries.has(l.from) && toExits.has(l.from) && fromEntries.has(l.to) && toExits.has(l.to);
        if (!ok) { removeLink(l.id); prunedUnreachable += 1; changed = true; }
      }
    }

    // Pass-through points (exactly two arms) are not intersections.
    for (const node of allNodes()) {
      if (isBoundary(node)) continue;
      const arms = computeArms(node);
      if (arms.length !== 2) continue;
      const ins = linksAt(node).filter((l) => l.to === node);
      const outs = linksAt(node).filter((l) => l.from === node);
      const armOf = (l) => arms.findIndex((a) => a.legs.some((x) => x.link === l));
      const created = [];
      for (const a of ins) {
        for (const b of outs) {
          if (armOf(a) === armOf(b) || a.from === b.to) continue;
          created.push(concat(a, b));
        }
      }
      for (const l of [...ins, ...outs]) removeLink(l.id);
      for (const l of created) addLink(l);
      contracted += 1;
      changed = true;
    }

    if (!changed) break;
  }

  // Merge parallel links (same endpoints, same approach direction).
  const byEnds = new Map();
  for (const l of links.values()) {
    const key = `${l.from}>${l.to}`;
    if (!byEnds.has(key)) byEnds.set(key, []);
    byEnds.get(key).push(l);
  }
  let parallelMerged = 0;
  for (const group of byEnds.values()) {
    if (group.length < 2) continue;
    const keep = group[0];
    for (const other of group.slice(1)) {
      const startGap = Math.abs(angleDiff(
        legBearing(keep.from, keep.coords, linkLength(keep)),
        legBearing(other.from, other.coords, linkLength(other)),
      ));
      if (startGap > options.armMergeDeg) continue;
      keep.parallel = [...(keep.parallel || []), other];
      removeLink(other.id);
      parallelMerged += 1;
    }
  }
  log.push({ step: 'Clean-up', detail: `${prunedDeadEnds} dead-end point(s) and ${prunedUnreachable} unreachable link(s) removed; ${contracted} pass-through point(s) joined` });

  // ---- 4. Arms (≤ 4) with grid directions ---------------------
  const nodes = Array.from(allNodes());
  const intersectionNodes = nodes.filter((n) => !isBoundary(n));
  const armInfo = new Map();
  let armJoins = 0;
  for (const node of intersectionNodes) {
    let arms = computeArms(node).map((a) => ({ ...a, sourceArms: 1 }));
    const originalCount = arms.length;
    // Join arms coming from the same direction until at most 4 remain.
    while (arms.length > 4) {
      let best = 0;
      let bestGap = Infinity;
      for (let i = 0; i < arms.length; i++) {
        const gap = Math.abs(angleDiff(arms[i].bearing, arms[(i + 1) % arms.length].bearing));
        if (gap < bestGap) { bestGap = gap; best = i; }
      }
      const a = arms[best];
      const b = arms[(best + 1) % arms.length];
      const legs = [...a.legs, ...b.legs];
      const joined = { legs, bearing: circularMean(legs.map((x) => x.bearing)), sourceArms: a.sourceArms + b.sourceArms };
      arms = arms.filter((x) => x !== a && x !== b).concat(joined).sort((x, y) => x.bearing - y.bearing);
    }
    if (originalCount > 4) armJoins += 1;
    armInfo.set(node, { arms: assignDirections(arms), originalCount });
  }
  if (armJoins) log.push({ step: 'Arm joining', detail: `${armJoins} intersection(s) had 5+ arms; arms from the same direction were joined to give 4` });

  // ---- 5. Output ---------------------------------------------
  const intersectionIds = new Map();
  const sortedNodes = nodes.slice().sort((a, b) => {
    const ja = junctionById.get(a);
    const jb = junctionById.get(b);
    return (jb.lat - ja.lat) || (ja.lon - jb.lon);
  });
  let iSeq = 0;
  let eSeq = 0;
  for (const n of sortedNodes) intersectionIds.set(n, isBoundary(n) ? `B${++eSeq}` : `I${++iSeq}`);

  const dirOfLinkAt = (node, link) => {
    const info = armInfo.get(node);
    if (!info) return null;
    const arm = info.arms.find((a) => a.legs.some((x) => x.link === link || x.link.parallel?.includes(link)));
    return arm?.dir || null;
  };

  const outLinks = [];
  let lSeq = 0;
  const finalLinkId = new Map();
  for (const l of links.values()) {
    const segs = [l, ...(l.parallel || [])].map((x) => x.segments);
    const primary = segs[0];
    const lengthM = primary.reduce((s, x) => s + x.lengthM, 0);
    const narrowest = primary.reduce((m, x) => (x.lanes.value < m.lanes.value ? x : m), primary[0]);
    const parallelLanes = segs.slice(1).reduce((s, sg) => s + Math.min(...sg.map((x) => x.lanes.value)), 0);
    const lanesValue = narrowest.lanes.value + parallelLanes;
    const speedValue = primary.reduce((s, x) => s + x.speedKmh.value * x.lengthM, 0) / (lengthM || 1);
    const main = primary.slice().sort((a, b) => roadClassInfo(b.highway).rank - roadClassInfo(a.highway).rank)[0];
    const id = `L${++lSeq}`;
    finalLinkId.set(l.id, id);
    outLinks.push({
      id,
      from: intersectionIds.get(l.from),
      to: intersectionIds.get(l.to),
      fromArm: dirOfLinkAt(l.from, l),
      toArm: dirOfLinkAt(l.to, l),
      coords: l.coords,
      lengthM: Math.round(lengthM * 10) / 10,
      name: primary.find((x) => x.name)?.name || null,
      highway: main.highway,
      connector: primary.every((x) => x.connector),
      lanes: {
        value: lanesValue,
        source: combineSource(primary.map((x) => x.lanes)),
        detail: primary.length > 1 || parallelLanes
          ? `narrowest of ${primary.length} section(s)${parallelLanes ? ` + ${parallelLanes} lane(s) on a parallel carriageway` : ''}`
          : narrowest.lanes.detail,
      },
      speedKmh: {
        value: Math.round(speedValue * 10) / 10,
        source: combineSource(primary.map((x) => x.speedKmh)),
        detail: primary.length > 1 ? `length-weighted over ${primary.length} section(s)` : primary[0].speedKmh.detail,
      },
      freeFlowTimeS: Math.round((lengthM / (speedValue / 3.6)) * 10) / 10,
      saturationFlowVph: lanesValue * MODEL_CONSTANTS.saturationFlowPerLaneVph,
      storageVeh: Math.max(1, Math.floor((lengthM * lanesValue) / MODEL_CONSTANTS.jamSpacingM)),
      sourceLinkIds: segs.flat().map((x) => x.id),
    });
  }
  const linkByFinal = new Map(outLinks.map((l) => [l.id, l]));

  const intersections = [];
  for (const node of intersectionNodes) {
    const j = junctionById.get(node);
    const { arms, originalCount } = armInfo.get(node);
    const armsByDir = {};
    for (const arm of arms) {
      const inIds = arm.legs.filter((x) => !x.isOut).map((x) => finalLinkId.get(x.link.id)).filter(Boolean);
      const outIds = arm.legs.filter((x) => x.isOut).map((x) => finalLinkId.get(x.link.id)).filter(Boolean);
      const names = [...inIds, ...outIds].map((id) => linkByFinal.get(id)?.name).filter(Boolean);
      armsByDir[arm.dir] = {
        dir: arm.dir,
        bearing: Math.round(arm.bearing),
        compass: compassLabel(arm.bearing),
        name: names[0] || null,
        highway: linkByFinal.get(inIds[0] || outIds[0])?.highway || null,
        inLinkIds: inIds,
        outLinkIds: outIds,
        inLanes: inIds.reduce((s, id) => s + linkByFinal.get(id).lanes.value, 0),
        outLanes: outIds.reduce((s, id) => s + linkByFinal.get(id).lanes.value, 0),
        joinedArms: arm.sourceArms,
      };
    }

    // Movements in grid terms; OSM turn bans carried over.
    const blocked = (fromDir, toDir) => {
      const ins = armsByDir[fromDir].inLinkIds.map((id) => linkByFinal.get(id).sourceLinkIds.at(-1));
      const outs = armsByDir[toDir].outLinkIds.map((id) => linkByFinal.get(id).sourceLinkIds[0]);
      let any = false;
      let allBlocked = true;
      for (const a of ins) {
        for (const b of outs) {
          const m = j.movements.find((x) => x.fromLinkId === a && x.toLinkId === b);
          if (!m) continue;
          any = true;
          if (m.allowed || !String(m.reason).startsWith('OSM')) allBlocked = false;
        }
      }
      return any && allBlocked;
    };
    const movements = [];
    for (const from of GRID_DIRS) {
      if (!armsByDir[from]?.inLinkIds.length) continue;
      for (const [turn, exitMap] of [['L', LEFT_EXIT], ['T', THROUGH_EXIT], ['R', RIGHT_EXIT]]) {
        const to = exitMap[from];
        if (!armsByDir[to]?.outLinkIds.length) continue;
        const isBlocked = blocked(from, to);
        movements.push({ from, to, turn, allowed: !isBlocked, reason: isBlocked ? 'OSM turn restriction' : null });
      }
    }
    const allowedSet = new Set(movements.filter((m) => m.allowed).map((m) => `${m.from}${m.turn}`));

    // A signal only matters where two movements cross. Using the grid's
    // own phases: two through/right movements (left is free) from
    // different approaches conflict unless some phase runs them together
    // or they feed the same exit (a merge). Roundabouts: always signalized.
    const conflict = findCrossingConflict(movements);
    const isRoundabout = j.kind === 'roundabout';
    const signalized = isRoundabout || Boolean(conflict);
    const controlReason = isRoundabout
      ? 'Roundabout, modelled as a signalized intersection'
      : signalized
        ? `Crossing movements: ${conflict[0].from}${conflict[0].turn} and ${conflict[1].from}${conflict[1].turn} cannot share a phase`
        : 'Merge or split point, no signal needed';

    const phases = !signalized ? [] : Object.entries(PHASES)
      .map(([name, moves]) => {
        const served = moves.filter(([approach, mv]) => allowedSet.has(`${approach}${mv}`));
        return { name, served: served.map(([a, mv]) => `${a}${mv}`), partial: served.length < moves.length };
      })
      .filter((p) => p.served.length > 0);

    intersections.push({
      id: intersectionIds.get(node),
      lat: j.lat,
      lon: j.lon,
      name: j.name,
      control: signalized ? 'signal' : 'none',
      controlReason,
      frameRotation: arms[0]?.frameRotation ?? 0,
      originalKind: j.kind,
      osmSignal: j.signal.value,
      sourceJunctionId: j.id,
      osmNodeCount: j.osmNodes.length,
      armCount: arms.length,
      originalArmCount: originalCount,
      arms: armsByDir,
      movements,
      phases,
      freeLeft: true,
    });
  }

  const boundaryPoints = nodes.filter(isBoundary).map((n) => {
    const j = junctionById.get(n);
    const out = Array.from(outIdx.get(n) || []).map((id) => linkByFinal.get(finalLinkId.get(id)));
    const inn = Array.from(inIdx.get(n) || []).map((id) => linkByFinal.get(finalLinkId.get(id)));
    return {
      id: intersectionIds.get(n),
      lat: j.lat,
      lon: j.lon,
      role: out.length && inn.length ? 'entry_exit' : out.length ? 'entry' : 'exit',
      name: (out[0] || inn[0])?.name || null,
      entryLinkIds: out.map((l) => l.id),
      exitLinkIds: inn.map((l) => l.id),
      entryLanes: out.reduce((s, l) => s + l.lanes.value, 0),
      feeds: out.map((l) => ({ intersection: l.to, arm: l.toArm })),
    };
  });

  // Corridors: the two directions of one physical road, for display.
  const corridors = [];
  const corridorByPair = new Map();
  for (const l of outLinks) {
    const key = [l.from, l.to].sort().join('~');
    const reverse = corridorByPair.get(key)?.find((c) => c.linkIds.length === 1 && linkByFinal.get(c.linkIds[0]).from === l.to);
    if (reverse) {
      reverse.linkIds.push(l.id);
      continue;
    }
    const c = {
      id: `C${corridors.length + 1}`,
      a: l.from,
      b: l.to,
      linkIds: [l.id],
      coords: l.coords,
      lengthM: l.lengthM,
      name: l.name,
      highway: l.highway,
      connector: l.connector,
    };
    corridors.push(c);
    if (!corridorByPair.has(key)) corridorByPair.set(key, []);
    corridorByPair.get(key).push(c);
  }
  for (const l of outLinks) l.corridorId = corridors.find((c) => c.linkIds.includes(l.id)).id;

  const signalizedList = intersections.filter((i) => i.control === 'signal');
  const armsHistogram = signalizedList.reduce((acc, i) => ({ ...acc, [i.armCount]: (acc[i.armCount] || 0) + 1 }), {});
  const summary = {
    intersections: intersections.length,
    signalized: signalizedList.length,
    mergePoints: intersections.length - signalizedList.length,
    armsHistogram,
    fromRoundabouts: intersections.filter((i) => i.originalKind === 'roundabout').length,
    osmSignalized: intersections.filter((i) => i.osmSignal).length,
    entries: boundaryPoints.filter((b) => b.role !== 'exit').length,
    exits: boundaryPoints.filter((b) => b.role !== 'entry').length,
    links: outLinks.length,
    corridors: corridors.length,
    roadKm: Math.round(corridors.reduce((s, c) => s + c.lengthM, 0) / 100) / 10,
    connectorChains: chains.length,
    fullGraphJunctions: graph.summary.junctions,
    processing: { prunedDeadEnds, prunedUnreachable, contracted, parallelMerged, armJoins },
  };

  const warnings = [];
  if (!intersections.length) warnings.push('No intersections left after simplification. Try a larger area or one with more main roads.');
  if (!summary.entries) warnings.push('No entry points: the network does not cross the area edge on a main road.');

  return {
    schemaVersion: 1,
    kind: 'simulation-network',
    bbox: graph.bbox,
    options,
    intersections,
    boundaryPoints,
    links: outLinks,
    corridors,
    connectorChains: chains,
    summary,
    log,
    warnings,
  };
}

// A signal only matters where two movements cross. Using the grid's
// own phases: two through/right movements (left is free) from
// different approaches conflict unless some phase runs them together
// or they feed the same exit (a merge). Returns the first conflicting
// pair, or null.
export function findCrossingConflict(movements) {
  const controlled = movements.filter((m) => m.allowed && m.turn !== 'L');
  for (let a = 0; a < controlled.length; a++) {
    for (let b = a + 1; b < controlled.length; b++) {
      const m1 = controlled[a];
      const m2 = controlled[b];
      if (m1.from === m2.from || m1.to === m2.to) continue;
      const together = PHASE_SETS.some((set) => set.has(`${m1.from}${m1.turn}`) && set.has(`${m2.from}${m2.turn}`));
      if (!together) return [m1, m2];
    }
  }
  return null;
}

// Order-preserving assignment of up to 4 arms to N/E/S/W.
// The N/E/S/W frame may rotate to fit the junction (a junction on a
// diagonal road is still a "+"), so what matters is the arms' angles
// relative to each other: roads ~180° apart get opposite labels and
// therefore a through movement. Arms must be sorted by bearing.
export function assignDirections(arms) {
  const n = arms.length;
  if (n === 0) return [];
  let best = null;
  const subsets = [];
  const rec = (start, chosen) => {
    if (chosen.length === n) { subsets.push(chosen.slice()); return; }
    for (let i = start; i < 4; i++) { chosen.push(GRID_DIRS[i]); rec(i + 1, chosen); chosen.pop(); }
  };
  rec(0, []);
  for (const dirs of subsets) {
    for (let shift = 0; shift < n; shift++) {
      const residuals = arms.map((arm, i) => angleDiff(DIR_ANGLE[dirs[(i + shift) % n]], arm.bearing));
      // Best frame rotation = circular mean of the residuals (small tie-break
      // towards true compass so labels stay intuitive).
      const rotation = angleDiff(0, circularMean(residuals.map((r) => (r + 360) % 360)));
      const cost = residuals.reduce((s, r) => s + Math.abs(angleDiff(rotation, r)), 0) + Math.abs(rotation) * 0.01;
      if (!best || cost < best.cost) best = { cost, dirs, shift, rotation };
    }
  }
  return arms.map((arm, i) => ({ ...arm, dir: best.dirs[(i + best.shift) % n], frameRotation: Math.round(best.rotation) }));
}
