// =====================================================
// CITY MODEL
//
// The city graph is stored as what is physically there:
//
//   nodes   intersection  signalized, the only nodes that decide
//           junction      roads join or split, no signal, no waiting
//           gateway       source / sink where traffic enters or leaves
//   links   one directed piece of road between two nodes
//
// Everything the simulator and the screens need is worked out from
// that by deriveCity(): the arms, turns and phases of every
// intersection, and the routes (intersection or source → through any
// junctions → next intersection or sink) the engine moves cars along.
// A road shared by several routes therefore exists once.
//
// The edit functions at the bottom return a new model; nothing here
// mutates its input.
// =====================================================

import { LEFT_EXIT, PHASES, RIGHT_EXIT, THROUGH_EXIT } from '../simulation/constants.js';
import { MODEL_CONSTANTS, SOURCES, roadClassInfo } from './roadDefaults.js';
import { angleDiff, bearingDeg, compassLabel, haversineM, polylineLengthM } from './geo.js';
import { assignDirections } from './buildSimulationNetwork.js';

export const CITY_SCHEMA_VERSION = 2;
export const NODE_KINDS = ['intersection', 'junction', 'gateway'];
export const ARM_DIRS = ['N', 'E', 'S', 'W']; // clockwise
const DIR_ANGLE = { N: 0, E: 90, S: 180, W: 270 };
const TURNS = [['L', LEFT_EXIT], ['T', THROUGH_EXIT], ['R', RIGHT_EXIT]];
const USER = 'user';
const MAX_ROUTE_LINKS = 60;
const MAX_ROUTE_SEARCH = 200000;
const MAX_ROUTES = 4000;

const round1 = (v) => Math.round(v * 10) / 10;

function circularMean(bearings) {
  const base = bearings[0];
  const avg = bearings.reduce((s, b) => s + angleDiff(base, b), 0) / bearings.length;
  return (base + avg + 360) % 360;
}

// Direction in which a link lies as seen from one of its end nodes,
// judged a little way along it so a curved turn does not mislead.
export function linkBearingAt(link, node, atStart) {
  const coords = atStart ? link.coords : link.coords.slice().reverse();
  const far = coords.find((p) => haversineM(node.lat, node.lon, p[0], p[1]) >= 40) || coords[coords.length - 1];
  if (!far || (far[0] === node.lat && far[1] === node.lon)) return 0;
  return bearingDeg(node.lat, node.lon, far[0], far[1]);
}

// The N/E/S/W arm of an intersection that a road in direction `bearing` uses.
export function armForBearing(node, bearing) {
  const rotation = node.frameRotation || 0;
  return ARM_DIRS.slice().sort((a, b) => Math.abs(angleDiff(DIR_ANGLE[a] + rotation, bearing)) - Math.abs(angleDiff(DIR_ANGLE[b] + rotation, bearing)))[0];
}

const armAtStart = (link, node) => (ARM_DIRS.includes(link.fromArm) ? link.fromArm : armForBearing(node, linkBearingAt(link, node, true)));
const armAtEnd = (link, node) => (ARM_DIRS.includes(link.toArm) ? link.toArm : armForBearing(node, linkBearingAt(link, node, false)));

function combineSource(values) {
  const set = new Set(values.map((v) => v.source));
  return set.size === 1 ? values[0].source : SOURCES.MIXED;
}

// One route = the links a car drives from one deciding node to the next.
function routeFromPath(path, share, nodeById) {
  const first = path[0];
  const last = path[path.length - 1];
  const fromKind = nodeById.get(first.from).kind;
  const toKind = nodeById.get(last.to).kind;
  const lengthM = path.reduce((s, l) => s + l.lengthM, 0);
  const narrowest = path.reduce((m, l) => (l.lanes.value < m.lanes.value ? l : m), path[0]);
  const speed = path.reduce((s, l) => s + l.speedKmh.value * l.lengthM, 0) / (lengthM || 1);
  const nameLength = new Map();
  for (const l of path) if (l.name) nameLength.set(l.name, (nameLength.get(l.name) || 0) + l.lengthM);
  const name = Array.from(nameLength.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const main = path.slice().sort((a, b) => roadClassInfo(b.highway).rank - roadClassInfo(a.highway).rank)[0];
  const lanes = narrowest.lanes.value;
  return {
    id: path.map((l) => l.id).join('+'),
    from: first.from,
    to: last.to,
    kind: fromKind === 'gateway' ? 'feeder' : toKind === 'gateway' ? 'exit' : 'internal',
    fromArm: fromKind === 'intersection' ? armAtStart(first, nodeById.get(first.from)) : null,
    toArm: toKind === 'intersection' ? armAtEnd(last, nodeById.get(last.to)) : null,
    linkIds: path.map((l) => l.id),
    share: Math.max(0.001, Math.round(share * 1000) / 1000),
    lengthM: round1(lengthM),
    name,
    highway: main.highway,
    connector: path.every((l) => l.connector),
    lanes: { value: lanes, source: combineSource(path.map((l) => l.lanes)), detail: path.length > 1 ? `narrowest of ${path.length} road pieces` : narrowest.lanes.detail },
    speedKmh: { value: round1(speed), source: combineSource(path.map((l) => l.speedKmh)), detail: path.length > 1 ? `length-weighted over ${path.length} road pieces` : path[0].speedKmh.detail },
    freeFlowTimeS: round1(path.reduce((s, l) => s + l.lengthM / (l.speedKmh.value / 3.6), 0)),
    saturationFlowVph: lanes * MODEL_CONSTANTS.saturationFlowPerLaneVph,
    storageVeh: Math.max(1, Math.floor((lengthM * lanes) / MODEL_CONSTANTS.jamSpacingM)),
    coords: path.flatMap((l, i) => (i === 0 ? l.coords : l.coords.slice(1))),
    simLinkIds: path.flatMap((l) => l.simLinkIds || []),
  };
}

// Where a car arriving at a junction on `link` may continue, with weights.
// `link.next` lists it explicitly; without it every road out of the junction
// is used except the one straight back.
export function continuationsOf(link, outLinks) {
  const explicit = link.next ? outLinks.filter((o) => link.next[o.id] > 0).map((o) => ({ link: o, weight: link.next[o.id] })) : [];
  if (explicit.length) return explicit;
  return outLinks.filter((o) => o.to !== link.from).map((o) => ({ link: o, weight: o.lanes.value || 1 }));
}

/**
 * @param base { model: { nodes, links }, area, downloadBox, extraction? }
 * @returns the full city graph: base + intersections, junctions, gateways,
 *          links, roads, edges (routes), summary, issues
 */
export function deriveCity(base) {
  const model = base.model;
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const links = model.links.filter((l) => nodeById.has(l.from) && nodeById.has(l.to) && l.from !== l.to);
  const outOf = new Map(model.nodes.map((n) => [n.id, []]));
  const inTo = new Map(model.nodes.map((n) => [n.id, []]));
  for (const l of links) {
    outOf.get(l.from).push(l);
    inTo.get(l.to).push(l);
  }
  const kindOf = (id) => nodeById.get(id).kind;

  // ---- Routes ----------------------------------------------------
  const found = [];
  let truncated = false;
  // A car does not pass the same junction twice, and the search gives up
  // on graphs with too many ways through (a mesh of junctions).
  let budget = MAX_ROUTE_SEARCH;
  const walk = (path, share, visited) => {
    const last = path[path.length - 1];
    if (kindOf(last.to) !== 'junction') {
      found.push({ path, share });
      return;
    }
    budget -= 1;
    if (budget <= 0 || path.length >= MAX_ROUTE_LINKS || found.length >= MAX_ROUTES) {
      truncated = true;
      return;
    }
    const options = continuationsOf(last, outOf.get(last.to)).filter((o) => !visited.has(o.link.to) || kindOf(o.link.to) !== 'junction');
    const total = options.reduce((s, o) => s + o.weight, 0);
    for (const o of options) walk([...path, o.link], (share * o.weight) / total, new Set(visited).add(last.to));
  };
  for (const l of links) if (kindOf(l.from) !== 'junction') walk([l], l.share ?? 1, new Set());
  const throughRoutes = found.filter((r) => kindOf(r.path[0].from) === 'gateway' && kindOf(r.path[r.path.length - 1].to) === 'gateway').length;
  const edges = found
    .filter((r) => kindOf(r.path[0].from) === 'intersection' || kindOf(r.path[r.path.length - 1].to) === 'intersection')
    .map((r) => routeFromPath(r.path, r.share, nodeById));

  // ---- Roads: both directions between the same two nodes ---------
  const roads = [];
  const roadByKey = new Map();
  const roadIdOf = new Map();
  for (const l of links) {
    const key = [l.from, l.to].sort().join('~');
    let road = roadByKey.get(key);
    if (!road) {
      const [a, b] = [l.from, l.to].sort();
      road = { id: `R:${key}`, a, b, linkIds: [], kind: 'internal' };
      roads.push(road);
      roadByKey.set(key, road);
    }
    road.linkIds.push(l.id);
    roadIdOf.set(l.id, road.id);
  }
  for (const r of roads) {
    const hasGateway = kindOf(r.a) === 'gateway' || kindOf(r.b) === 'gateway';
    r.kind = hasGateway ? 'boundary' : 'internal';
  }
  for (const e of edges) e.roadId = roadIdOf.get(e.linkIds[e.kind === 'exit' ? 0 : e.linkIds.length - 1]);

  // ---- Intersections ---------------------------------------------
  const intersections = model.nodes.filter((n) => n.kind === 'intersection').map((n) => {
    const arms = {};
    const armOf = new Map();
    for (const l of inTo.get(n.id)) armOf.set(`in:${l.id}`, armAtEnd(l, n));
    for (const l of outOf.get(n.id)) armOf.set(`out:${l.id}`, armAtStart(l, n));
    for (const dir of ARM_DIRS) {
      const inLinks = inTo.get(n.id).filter((l) => armOf.get(`in:${l.id}`) === dir);
      const outLinks = outOf.get(n.id).filter((l) => armOf.get(`out:${l.id}`) === dir);
      if (!inLinks.length && !outLinks.length) continue;
      const bearings = [...inLinks.map((l) => linkBearingAt(l, n, false)), ...outLinks.map((l) => linkBearingAt(l, n, true))];
      const bearing = Math.round(circularMean(bearings));
      const all = [...inLinks, ...outLinks];
      const main = all.slice().sort((a, b) => roadClassInfo(b.highway).rank - roadClassInfo(a.highway).rank)[0];
      arms[dir] = {
        dir,
        bearing,
        compass: compassLabel(bearing),
        name: all.find((l) => l.name)?.name || null,
        highway: main.highway,
        inLinkIds: inLinks.map((l) => l.id),
        outLinkIds: outLinks.map((l) => l.id),
        // Routes arriving on / leaving by this arm (what the engine queues and releases).
        inEdgeIds: edges.filter((e) => e.to === n.id && e.toArm === dir).map((e) => e.id),
        outEdgeIds: edges.filter((e) => e.from === n.id && e.fromArm === dir).map((e) => e.id),
        inLanes: Math.min(inLinks.reduce((s, l) => s + l.lanes.value, 0), n.armLanes?.[dir] || Infinity),
        outLanes: outLinks.reduce((s, l) => s + l.lanes.value, 0),
        turnLane: all.every((l) => l.turnLane),
      };
    }
    const blocked = new Set(n.blockedTurns || []);
    const movements = [];
    for (const from of ARM_DIRS) {
      if (!arms[from]?.inLinkIds.length) continue;
      for (const [turn, exitMap] of TURNS) {
        const to = exitMap[from];
        if (!arms[to]?.outLinkIds.length) continue;
        const allowed = !blocked.has(`${from}>${to}`);
        movements.push({ from, to, turn, allowed, reason: allowed ? null : 'Turn not allowed' });
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
      id: n.id,
      simId: n.simId ?? null,
      lat: n.lat,
      lon: n.lon,
      name: n.name || null,
      originalKind: n.originalKind || 'signalized',
      osmSignal: n.osmSignal ?? null,
      frameRotation: n.frameRotation || 0,
      originalArmCount: n.originalArmCount ?? Object.keys(arms).length,
      armCount: Object.keys(arms).length,
      arms,
      movements,
      phases,
      sourceJunctionId: n.sourceJunctionId ?? null,
      armLanes: n.armLanes || null,
      custom: Boolean(n.custom),
    };
  });

  const junctions = model.nodes.filter((n) => n.kind === 'junction').map((n) => ({
    id: n.id,
    lat: n.lat,
    lon: n.lon,
    name: n.name || null,
    inLinkIds: inTo.get(n.id).map((l) => l.id),
    outLinkIds: outOf.get(n.id).map((l) => l.id),
    custom: Boolean(n.custom),
  }));

  const gateways = model.nodes.filter((n) => n.kind === 'gateway').map((n) => {
    const outLinkIds = outOf.get(n.id).map((l) => l.id);
    const inLinkIds = inTo.get(n.id).map((l) => l.id);
    return {
      id: n.id,
      lat: n.lat,
      lon: n.lon,
      role: outLinkIds.length && inLinkIds.length ? 'both' : outLinkIds.length ? 'source' : inLinkIds.length ? 'sink' : 'unused',
      placedAt: n.placedAt || 'junction',
      junctionName: n.name || null,
      roadName: [...outOf.get(n.id), ...inTo.get(n.id)].find((l) => l.name)?.name || null,
      outLinkIds,
      inLinkIds,
      feederEdgeIds: edges.filter((e) => e.from === n.id).map((e) => e.id),
      exitEdgeIds: edges.filter((e) => e.to === n.id).map((e) => e.id),
      custom: Boolean(n.custom),
    };
  });

  // ---- Checks the user can act on --------------------------------
  const issues = [];
  for (const i of intersections) {
    const ins = Object.values(i.arms).reduce((s, a) => s + a.inLinkIds.length, 0);
    const outs = Object.values(i.arms).reduce((s, a) => s + a.outLinkIds.length, 0);
    if (!ins && !outs) issues.push({ nodeId: i.id, text: `${i.id} has no roads` });
    else if (!ins) issues.push({ nodeId: i.id, text: `${i.id} has no road coming in` });
    else if (!outs) issues.push({ nodeId: i.id, text: `${i.id} has no road going out; cars that reach it leave the network there` });
    else if (!i.movements.some((m) => m.allowed)) issues.push({ nodeId: i.id, text: `${i.id} allows no turn` });
  }
  for (const j of junctions) {
    if (!j.inLinkIds.length && !j.outLinkIds.length) issues.push({ nodeId: j.id, text: `${j.id} has no roads` });
    else if (!j.inLinkIds.length || !j.outLinkIds.length) issues.push({ nodeId: j.id, text: `${j.id} is a dead end, so roads into it carry no traffic` });
  }
  for (const g of gateways) if (g.role === 'unused') issues.push({ nodeId: g.id, text: `${g.id} is not connected` });
  if (intersections.length && !edges.some((e) => e.kind === 'feeder')) issues.push({ nodeId: null, text: 'No source reaches an intersection, so no traffic enters' });
  if (throughRoutes) issues.push({ nodeId: null, text: `${throughRoutes} route(s) run from a source to a sink without meeting an intersection and are ignored` });
  if (truncated) issues.push({ nodeId: null, text: 'Some routes through junctions are too long or loop and were cut short' });

  const gatewayIds = new Set(gateways.map((g) => g.id));
  const summary = {
    ...(base.extraction?.summary || {}),
    intersections: intersections.length,
    armsHistogram: intersections.reduce((acc, i) => ({ ...acc, [i.armCount]: (acc[i.armCount] || 0) + 1 }), {}),
    fromRoundabouts: intersections.filter((i) => i.originalKind === 'roundabout').length,
    junctions: junctions.length,
    sources: gateways.filter((g) => g.role === 'source' || g.role === 'both').length,
    sinks: gateways.filter((g) => g.role === 'sink' || g.role === 'both').length,
    gateways: gateways.length,
    links: links.length,
    roads: roads.length,
    internalEdges: edges.filter((e) => e.kind === 'internal').length,
    feederEdges: edges.filter((e) => e.kind === 'feeder').length,
    exitEdges: edges.filter((e) => e.kind === 'exit').length,
    roadKm: Math.round(links.filter((l) => !gatewayIds.has(l.from) && !gatewayIds.has(l.to)).reduce((s, l) => s + l.lengthM, 0) / 100) / 10,
    gatewaysAtDownloadEdge: gateways.filter((g) => g.placedAt === 'download-edge').length,
  };

  return {
    ...base,
    schemaVersion: CITY_SCHEMA_VERSION,
    kind: 'city-graph',
    model,
    intersections,
    junctions,
    gateways,
    // Arms are filled in here even where the model leaves them to the geometry.
    links: links.map((l) => ({
      ...l,
      roadId: roadIdOf.get(l.id),
      fromArm: kindOf(l.from) === 'intersection' ? armAtStart(l, nodeById.get(l.from)) : null,
      toArm: kindOf(l.to) === 'intersection' ? armAtEnd(l, nodeById.get(l.to)) : null,
    })),
    roads,
    edges,
    summary,
    issues,
    log: base.extraction?.log || [],
    warnings: base.extraction?.warnings || [],
  };
}

// =====================================================
// SIMPLE GRAPH
//
// The high-level picture: only intersections and sources/sinks, and
// between any two of them at most one road per direction. Every way
// through the junctions becomes a direct road; ways that end at the same
// node are joined into one (the busiest one's shape and arms, the widest
// lanes). How traffic divided where roads forked is kept as each road's
// share, so the simulation sends the same fractions each way.
// =====================================================
export function simplifyModel(model) {
  const detailed = deriveCity({ model });
  const groups = new Map();
  for (const route of detailed.edges) {
    // Same start, same end, same arms: strands of one road. Roads that
    // leave or arrive by different arms are different roads and stay.
    const key = `${route.from}:${route.fromArm || ''}>${route.to}:${route.toArm || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(route);
  }
  const pieceById = new Map(detailed.links.map((l) => [l.id, l]));
  const kindOf = (id) => model.nodes.find((nd) => nd.id === id)?.kind;
  // Lanes where the road meets its intersection: they decide how many
  // cars it can release on green there.
  const endLanes = (r) => {
    const piece = pieceById.get(kindOf(r.to) === 'intersection' ? r.linkIds[r.linkIds.length - 1] : r.linkIds[0]);
    return piece?.lanes.value ?? r.lanes.value;
  };
  let n = 0;
  const links = Array.from(groups.values()).map((routes) => {
    const main = routes.slice().sort((a, b) => b.share - a.share || endLanes(b) - endLanes(a))[0];
    const lanes = Math.max(...routes.map(endLanes));
    n += 1;
    return {
      id: `L${n}`,
      from: main.from,
      to: main.to,
      fromArm: main.fromArm,
      toArm: main.toArm,
      lengthM: main.lengthM,
      name: main.name,
      highway: main.highway,
      connector: main.connector,
      lanes: { ...main.lanes, value: lanes, detail: routes.length > 1 ? `widest of ${routes.length} parallel ways, where they meet the intersection` : 'where the road meets the intersection' },
      speedKmh: main.speedKmh,
      coords: main.coords,
      next: null,
      simLinkIds: main.simLinkIds,
      share: Math.round(Math.min(1, routes.reduce((s, r) => s + r.share, 0)) * 1000) / 1000,
      turnLane: false,
    };
  });
  const used = new Set(links.flatMap((l) => [l.from, l.to]));
  // Several direct roads may now arrive on one arm where one physical
  // road did; the arm keeps the lanes it really has, so its green-light
  // capacity is not counted several times.
  const armLanesOf = new Map(detailed.intersections.map((i) => [i.id, Object.fromEntries(Object.values(i.arms).map((a) => [a.dir, a.inLanes]))]));
  const nodes = model.nodes
    .filter((nd) => nd.kind !== 'junction' && (nd.kind === 'intersection' || used.has(nd.id)))
    .map((nd) => (nd.kind === 'intersection' ? { ...nd, armLanes: armLanesOf.get(nd.id) || {} } : nd));
  return { nodes, links, simple: true };
}

// =====================================================
// ROUGH GRAPH
//
// The skeleton of the city. Only the main road classes stay (local
// streets and slip roads go); a point where just one road passes through
// is no longer an intersection. Then intersections closer than `mergeM`
// (the two halves of a divided road) become one, and so do sources/sinks
// next to each other, and between any two nodes one road per direction
// is left. The numbers differ from the detailed graph.
// =====================================================
const ROUGH_MIN_RANKS = [7, 6]; // secondary and up; tertiary if too little is left

// Roads that lead nowhere once the minor streets are gone.
function pruneDeadEnds(model) {
  let links = model.links;
  const junctions = new Set(model.nodes.filter((nd) => nd.kind === 'junction').map((nd) => nd.id));
  for (;;) {
    const ins = new Map();
    const outs = new Map();
    for (const l of links) {
      ins.set(l.to, (ins.get(l.to) || 0) + 1);
      outs.set(l.from, (outs.get(l.from) || 0) + 1);
    }
    const dead = (id) => junctions.has(id) && (!ins.get(id) || !outs.get(id));
    const kept = links.filter((l) => !dead(l.from) && !dead(l.to));
    if (kept.length === links.length) return cleanContinuations({ ...model, links });
    links = kept;
  }
}

function mainRoadsOnly(model, minRank) {
  const main = (l) => l.custom || !l.highway || (!l.highway.endsWith('_link') && roadClassInfo(l.highway).rank >= minRank);
  const kept = pruneDeadEnds({ ...model, links: model.links.filter(main) });
  // Two directions or fewer: a bend in one road, not an intersection.
  const arms = new Map(deriveCity({ model: kept }).intersections.map((i) => [i.id, Object.keys(i.arms).length]));
  const nodes = kept.nodes.map((nd) => (nd.kind === 'intersection' && !nd.custom && (arms.get(nd.id) || 0) <= 2 ? { ...nd, kind: 'junction' } : nd));
  return pruneDeadEnds({ ...kept, nodes });
}

export function roughModel(model, { mergeM = 150 } = {}) {
  let base = model;
  for (const minRank of ROUGH_MIN_RANKS) {
    const candidate = mainRoadsOnly(model, minRank);
    if (candidate.nodes.filter((nd) => nd.kind === 'intersection').length >= 2) {
      base = candidate;
      break;
    }
  }
  let next = simplifyModel(base);
  const degree = (id) => next.links.filter((l) => l.from === id || l.to === id).length;
  const merged = new Set();

  for (const kind of ['intersection', 'gateway']) {
    const nodes = next.nodes.filter((nd) => nd.kind === kind);
    const dist = (a, b) => haversineM(a.lat, a.lon, b.lat, b.lon);
    const pairs = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = dist(nodes[i], nodes[j]);
        if (d <= mergeM) pairs.push({ a: nodes[i], b: nodes[j], d });
      }
    }
    pairs.sort((x, y) => x.d - y.d);
    // Closest pairs first; a group never spreads wider than 1.5 × mergeM.
    const groupOf = new Map(nodes.map((nd) => [nd.id, [nd]]));
    for (const { a, b } of pairs) {
      const ga = groupOf.get(a.id);
      const gb = groupOf.get(b.id);
      if (ga === gb) continue;
      if (ga.some((x) => gb.some((y) => dist(x, y) > mergeM * 1.5))) continue;
      const joined = [...ga, ...gb];
      for (const nd of joined) groupOf.set(nd.id, joined);
    }
    for (const group of new Set(groupOf.values())) {
      if (group.length < 2) continue;
      const keep = group.slice().sort((x, y) => degree(y.id) - degree(x.id) || x.id.localeCompare(y.id))[0];
      for (const nd of group) if (nd.id !== keep.id) next = mergeNodes(next, keep.id, nd.id);
      const lat = group.reduce((s, nd) => s + nd.lat, 0) / group.length;
      const lon = group.reduce((s, nd) => s + nd.lon, 0) / group.length;
      next = moveNode(next, keep.id, lat, lon);
      if (kind === 'intersection') {
        next = updateNode(next, keep.id, { blockedTurns: [], mergedFrom: group.map((nd) => nd.id) });
        next = fitArms(next, keep.id);
        merged.add(keep.id);
      }
    }
  }

  // One road per direction between two nodes: the busiest one, with the
  // widest lanes and the traffic of all of them.
  const groups = new Map();
  for (const l of next.links) {
    const key = `${l.from}>${l.to}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  const links = Array.from(groups.values()).map((ls) => {
    if (ls.length === 1) return ls[0];
    const main = ls.slice().sort((a, b) => (b.share ?? 1) - (a.share ?? 1) || b.lanes.value - a.lanes.value)[0];
    return {
      ...main,
      lanes: { ...main.lanes, value: Math.max(...ls.map((l) => l.lanes.value)) },
      share: Math.round(Math.min(1, ls.reduce((s, l) => s + (l.share ?? 1), 0)) * 1000) / 1000,
    };
  });

  // Merged intersections: each arm keeps the lanes of its widest road in.
  const nodes = next.nodes.map((nd) => {
    if (!merged.has(nd.id)) return nd;
    const armLanes = {};
    for (const l of links) {
      if (l.to !== nd.id || !l.toArm) continue;
      armLanes[l.toArm] = Math.max(armLanes[l.toArm] || 0, l.lanes.value);
    }
    return { ...nd, armLanes };
  });
  return { nodes, links, simple: true, rough: true };
}

// =====================================================
// EDITING
// =====================================================
const PREFIX = { intersection: 'I', junction: 'J', gateway: 'G' };

function nextId(items, prefix) {
  let max = 0;
  for (const it of items) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(it.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

const withNodes = (model, nodes) => ({ ...model, nodes });
const withLinks = (model, links) => ({ ...model, links });
const nodeOf = (model, id) => model.nodes.find((n) => n.id === id);

// Arms of the links meeting at an intersection, re-chosen from geometry.
function assignArms(model, nodeId, linkIds = null) {
  const node = nodeOf(model, nodeId);
  if (!node || node.kind !== 'intersection') return model;
  return withLinks(model, model.links.map((l) => {
    if (linkIds && !linkIds.includes(l.id)) return l;
    let next = l;
    if (l.from === nodeId) next = { ...next, fromArm: armForBearing(node, linkBearingAt(l, node, true)) };
    if (l.to === nodeId) next = { ...next, toArm: armForBearing(node, linkBearingAt(l, node, false)) };
    return next;
  }));
}

// Turn the N/E/S/W frame of an intersection to fit its roads and give
// every road its arm, the way extracted intersections get theirs: roads
// from about the same direction share an arm, opposite roads get opposite
// arms. Used for intersections the user makes, where no frame exists yet.
function fitArms(model, nodeId) {
  const node = nodeOf(model, nodeId);
  if (!node || node.kind !== 'intersection') return model;
  const ends = [];
  for (const l of model.links) {
    if (l.from === nodeId) ends.push({ link: l.id, key: 'fromArm', bearing: linkBearingAt(l, node, true) });
    if (l.to === nodeId) ends.push({ link: l.id, key: 'toArm', bearing: linkBearingAt(l, node, false) });
  }
  if (!ends.length) return model;
  ends.sort((a, b) => a.bearing - b.bearing);
  // Roads within 40° of each other are one arm.
  let groups = [];
  for (const end of ends) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(angleDiff(last[last.length - 1].bearing, end.bearing)) <= 40) last.push(end);
    else groups.push([end]);
  }
  if (groups.length > 1 && Math.abs(angleDiff(groups[groups.length - 1].at(-1).bearing, groups[0][0].bearing)) <= 40) {
    groups[0] = [...groups.pop(), ...groups[0]];
  }
  const centre = (g) => circularMean(g.map((x) => x.bearing));
  while (groups.length > 4) {
    // Too many directions for a 4-arm frame: join the two closest.
    let best = { gap: Infinity, k: 0 };
    for (let k = 0; k < groups.length; k++) {
      const gap = Math.abs(angleDiff(centre(groups[k]), centre(groups[(k + 1) % groups.length])));
      if (gap < best.gap) best = { gap, k };
    }
    const other = (best.k + 1) % groups.length;
    groups[best.k] = [...groups[best.k], ...groups[other]];
    groups = groups.filter((_, k) => k !== other);
  }
  const arms = groups.map((g) => ({ ends: g, bearing: centre(g) })).sort((a, b) => a.bearing - b.bearing);
  const placed = assignDirections(arms);
  const armOf = new Map();
  for (const arm of placed) for (const end of arm.ends) armOf.set(`${end.key}:${end.link}`, arm.dir);
  const fitted = updateNode(model, nodeId, { frameRotation: placed[0].frameRotation });
  return withLinks(fitted, fitted.links.map((l) => ({
    ...l,
    ...(armOf.has(`fromArm:${l.id}`) ? { fromArm: armOf.get(`fromArm:${l.id}`) } : {}),
    ...(armOf.has(`toArm:${l.id}`) ? { toArm: armOf.get(`toArm:${l.id}`) } : {}),
  })));
}

// A new road at an intersection: one the user made, with no turns set yet,
// re-fits its whole frame; any other keeps its frame and places only the road.
function placeAt(model, nodeId, linkId) {
  const node = nodeOf(model, nodeId);
  if (!node || node.kind !== 'intersection') return model;
  if (node.custom && !(node.blockedTurns || []).length) return fitArms(model, nodeId);
  return assignArms(model, nodeId, [linkId]);
}

// Forget continuations that point at links which no longer exist.
function cleanContinuations(model) {
  const ids = new Set(model.links.map((l) => l.id));
  return withLinks(model, model.links.map((l) => {
    if (!l.next) return l;
    const next = Object.fromEntries(Object.entries(l.next).filter(([id]) => ids.has(id)));
    return { ...l, next: Object.keys(next).length ? next : null };
  }));
}

export function addNode(model, kind, lat, lon, props = {}) {
  const id = nextId(model.nodes, PREFIX[kind]);
  const node = { id, kind, lat, lon, name: null, custom: true, ...(kind === 'intersection' ? { frameRotation: 0, blockedTurns: [] } : {}), ...props };
  return { model: withNodes(model, [...model.nodes, node]), id };
}

export function updateNode(model, id, patch) {
  return withNodes(model, model.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)));
}

export function moveNode(model, id, lat, lon) {
  const moved = updateNode(model, id, { lat, lon });
  return withLinks(moved, moved.links.map((l) => {
    if (l.from !== id && l.to !== id) return l;
    const coords = l.coords.slice();
    if (l.from === id) coords[0] = [lat, lon];
    if (l.to === id) coords[coords.length - 1] = [lat, lon];
    // A road the user drew is a straight line, so its length follows the nodes.
    return { ...l, coords, ...(l.custom && !l.lengthEdited ? { lengthM: round1(polylineLengthM(coords)) } : {}) };
  }));
}

export function deleteNode(model, id) {
  const next = { ...model, nodes: model.nodes.filter((n) => n.id !== id), links: model.links.filter((l) => l.from !== id && l.to !== id) };
  return cleanContinuations(next);
}

// Signalized intersection ⇄ junction without signal ⇄ source/sink. Roads
// stay. The node gets an id of its new kind (I…, J…, G…), which is returned.
export function setNodeKind(model, id, kind) {
  const node = nodeOf(model, id);
  if (!node || node.kind === kind) return { model, id };
  const newId = nextId(model.nodes, PREFIX[kind]);
  const nodes = model.nodes.map((n) => (n.id === id
    ? { ...n, id: newId, kind, ...(kind === 'intersection' ? { frameRotation: n.frameRotation || 0, blockedTurns: n.blockedTurns || [] } : {}) }
    : n));
  const links = model.links.map((l) => ({
    ...l,
    ...(l.from === id ? { from: newId, fromArm: null } : {}),
    ...(l.to === id ? { to: newId, toArm: null } : {}),
  }));
  const changed = { ...model, nodes, links };
  return { model: kind === 'intersection' ? fitArms(changed, newId) : changed, id: newId };
}

export function addLink(model, from, to, props = {}) {
  const a = nodeOf(model, from);
  const b = nodeOf(model, to);
  if (!a || !b || from === to) return { model, id: null };
  const id = nextId(model.links, 'L');
  const coords = props.coords || [[a.lat, a.lon], [b.lat, b.lon]];
  const link = {
    id,
    from,
    to,
    fromArm: null,
    toArm: null,
    lengthM: round1(Math.max(1, polylineLengthM(coords))),
    name: props.name ?? null,
    highway: props.highway || 'secondary',
    connector: false,
    lanes: { value: props.lanes ?? 2, source: USER, detail: 'set by you' },
    speedKmh: { value: props.speedKmh ?? 40, source: USER, detail: 'set by you' },
    coords,
    next: null,
    simLinkIds: [],
    custom: true,
  };
  let next = withLinks(model, [...model.links, link]);
  // Roads that already list where they continue at this junction gain the new one.
  if (a.kind === 'junction') {
    next = withLinks(next, next.links.map((l) => (l.to === from && l.next && l.from !== to ? { ...l, next: { ...l.next, [id]: link.lanes.value } } : l)));
  }
  next = placeAt(placeAt(next, from, id), to, id);
  return { model: next, id };
}

// The opposite direction of an existing road piece.
export function addReverseLink(model, linkId) {
  const l = model.links.find((x) => x.id === linkId);
  if (!l) return { model, id: null };
  const made = addLink(model, l.to, l.from, { coords: l.coords.slice().reverse(), lanes: l.lanes.value, speedKmh: l.speedKmh.value, name: l.name, highway: l.highway });
  if (!made.id) return made;
  return {
    id: made.id,
    model: withLinks(made.model, made.model.links.map((x) => (x.id === made.id ? { ...x, lengthM: l.lengthM, ...(l.toArm ? { fromArm: l.toArm } : {}), ...(l.fromArm ? { toArm: l.fromArm } : {}) } : x))),
  };
}

// Connect two nodes by road, one-way or two-way. A direction that already
// exists is left alone. A direction whose opposite exists becomes its
// mirror: same arms, length and shape, so the two form one two-way road.
// Returns { model, ids } with the ids of the directions actually added.
export function connectNodes(model, from, to, { twoWay = true, ...props } = {}) {
  let next = model;
  const ids = [];
  for (const [a, b] of twoWay ? [[from, to], [to, from]] : [[from, to]]) {
    if (next.links.some((l) => l.from === a && l.to === b)) continue;
    const opposite = next.links.find((l) => l.from === b && l.to === a);
    const made = opposite ? addReverseLink(next, opposite.id) : addLink(next, a, b, props);
    if (!made.id) continue;
    next = made.model;
    ids.push(made.id);
  }
  return { model: next, ids, id: ids[0] ?? null };
}

export function deleteLink(model, id) {
  return cleanContinuations(withLinks(model, model.links.filter((l) => l.id !== id)));
}

/** patch: { lanes, speedKmh, lengthM, name, fromArm, toArm, next } */
export function updateLink(model, id, patch) {
  return withLinks(model, model.links.map((l) => {
    if (l.id !== id) return l;
    const next = { ...l };
    if (patch.lanes != null) next.lanes = { value: Math.max(1, Math.round(patch.lanes)), source: USER, detail: 'set by you' };
    if (patch.speedKmh != null) next.speedKmh = { value: Math.max(1, patch.speedKmh), source: USER, detail: 'set by you' };
    if (patch.lengthM != null) {
      next.lengthM = Math.max(1, patch.lengthM);
      next.lengthEdited = true;
    }
    if ('name' in patch) next.name = patch.name || null;
    if ('fromArm' in patch) next.fromArm = patch.fromArm;
    if ('toArm' in patch) next.toArm = patch.toArm;
    if ('next' in patch) next.next = patch.next && Object.keys(patch.next).length ? patch.next : null;
    return next;
  }));
}

// Allow or forbid one turn (arm → arm) at an intersection.
export function setTurnAllowed(model, nodeId, from, to, allowed) {
  const node = nodeOf(model, nodeId);
  if (!node) return model;
  const key = `${from}>${to}`;
  const set = new Set(node.blockedTurns || []);
  if (allowed) set.delete(key);
  else set.add(key);
  return updateNode(model, nodeId, { blockedTurns: Array.from(set) });
}

// Allow or forbid continuing from one road onto another at a junction.
export function setContinuation(model, inLinkId, outLinkId, allowed) {
  const link = model.links.find((l) => l.id === inLinkId);
  if (!link) return model;
  const outs = model.links.filter((l) => l.from === link.to);
  const current = Object.fromEntries(continuationsOf(link, outs).map((c) => [c.link.id, c.weight]));
  const out = outs.find((l) => l.id === outLinkId);
  if (allowed && out) current[outLinkId] = out.lanes.value || 1;
  else delete current[outLinkId];
  // An empty list would mean "automatic", so keep at least one way on.
  if (!Object.keys(current).length) return model;
  return updateLink(model, inLinkId, { next: current });
}

// Point of a polyline nearest to (lat, lon): distance in metres, segment and position.
function nearestOnLine(coords, lat, lon) {
  const kx = Math.cos((lat * Math.PI) / 180);
  let best = { d: Infinity, i: 0, point: coords[0] };
  for (let i = 0; i + 1 < coords.length; i++) {
    const [aLat, aLon] = coords[i];
    const [bLat, bLon] = coords[i + 1];
    const ax = (aLon - lon) * kx;
    const ay = aLat - lat;
    const dx = (bLon - aLon) * kx;
    const dy = bLat - aLat;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy) * 111320;
    if (d < best.d) best = { d, i, point: [aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t] };
  }
  return best;
}

// Cut one link in two at `nodeId`. The first half keeps the id, so roads
// that continued onto this piece still do, and it simply carries on into
// the second half.
function cutLink(model, link, nodeId, at) {
  const head = [...link.coords.slice(0, at.i + 1), at.point];
  const tail = [at.point, ...link.coords.slice(at.i + 1)];
  const headLen = polylineLengthM(head);
  const tailLen = polylineLengthM(tail);
  const ratio = headLen + tailLen > 0 ? headLen / (headLen + tailLen) : 0.5;
  const secondId = nextId(model.links, 'L');
  const first = { ...link, to: nodeId, toArm: null, coords: head, lengthM: round1(Math.max(1, link.lengthM * ratio)), next: { [secondId]: 1 } };
  const second = { ...link, id: secondId, from: nodeId, fromArm: null, coords: tail, lengthM: round1(Math.max(1, link.lengthM * (1 - ratio))), simLinkIds: [] };
  return withLinks(model, [...model.links.filter((x) => x.id !== link.id), first, second]);
}

// Put a new node on an existing road: every direction of that road is cut there.
export function splitRoadAt(model, linkIds, lat, lon, kind = 'junction') {
  const made = addNode(model, kind, lat, lon);
  let next = made.model;
  for (const linkId of linkIds) {
    const l = next.links.find((x) => x.id === linkId);
    if (!l) continue;
    next = cutLink(next, l, made.id, { ...nearestOnLine(l.coords, lat, lon), point: [lat, lon] });
  }
  return { model: kind === 'intersection' ? fitArms(next, made.id) : next, id: made.id };
}

// A divided road is two one-way roads side by side. When a junction sits
// on one of them (Y → J → X), the opposite one (X → Y) passes the same
// spot without a node, which draws as a triangle instead of one road.
// It is cut at that junction so both directions run through the same dot.
export function pairDividedRoads(model, maxM = 45) {
  let next = model;
  for (let guard = 0; guard < 200; guard++) {
    let cut = null;
    for (const j of next.nodes) {
      if (j.kind !== 'junction') continue;
      const into = next.links.filter((l) => l.to === j.id);
      const outOf = next.links.filter((l) => l.from === j.id);
      for (const a of into) {
        for (const b of continuationsOf(a, outOf)) {
          if (b.link.to === a.from) continue;
          const opposite = next.links.filter((o) => o.from === b.link.to && o.to === a.from);
          for (const o of opposite) {
            const at = nearestOnLine(o.coords, j.lat, j.lon);
            if (at.d <= maxM) cut = { link: o, node: j.id, at };
            if (cut) break;
          }
          if (cut) break;
        }
        if (cut) break;
      }
      if (cut) break;
    }
    if (!cut) return next;
    next = cutLink(next, cut.link, cut.node, cut.at);
  }
  return next;
}

// Two nodes that are really one place: `removeId` is folded into `keepId`.
export function mergeNodes(model, keepId, removeId) {
  if (keepId === removeId || !nodeOf(model, keepId) || !nodeOf(model, removeId)) return model;
  const links = model.links
    .filter((l) => !((l.from === keepId && l.to === removeId) || (l.from === removeId && l.to === keepId)))
    .map((l) => ({
      ...l,
      ...(l.from === removeId ? { from: keepId, fromArm: null } : {}),
      ...(l.to === removeId ? { to: keepId, toArm: null } : {}),
    }));
  const next = cleanContinuations({ ...model, nodes: model.nodes.filter((n) => n.id !== removeId), links });
  const touched = links.filter((l) => (l.from === keepId && l.fromArm == null) || (l.to === keepId && l.toArm == null)).map((l) => l.id);
  return assignArms(next, keepId, touched);
}
