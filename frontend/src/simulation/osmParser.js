import { makeConstantInflowProfile } from './arrivalProfile.js';

const MAX_SIM_INTERSECTIONS = 1600;
const INTERSECTION_CLUSTER_RADIUS_M = 90;
const MIN_INTERSECTION_CLUSTER_POINTS = 4;
const MAIN_ROAD_CLASSES = new Set([
  'motorway', 'motorway_link',
  'trunk', 'trunk_link',
  'primary', 'primary_link',
  'secondary', 'secondary_link',
  'tertiary', 'tertiary_link',
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isMainRoadClass(highway) {
  return MAIN_ROAD_CLASSES.has(String(highway || '').toLowerCase());
}

function collapseIntersectionClusters(points, radiusMeters = INTERSECTION_CLUSTER_RADIUS_M, minClusterPoints = MIN_INTERSECTION_CLUSTER_POINTS) {
  if (!Array.isArray(points) || points.length <= 1) return points || [];

  // Build connected components where edges exist for any pair within radius.
  const parent = points.map((_, i) => i);

  const find = (x) => {
    let p = x;
    while (parent[p] !== p) p = parent[p];
    while (parent[x] !== x) {
      const next = parent[x];
      parent[x] = p;
      x = next;
    }
    return p;
  };

  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = haversineMeters(points[i].lat, points[i].lon, points[j].lat, points[j].lon);
      if (d <= radiusMeters) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < points.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(points[i]);
  }

  return Array.from(groups.values())
    .filter((cluster) => cluster.length >= minClusterPoints)
    .map((cluster) => {
    const centerLat = cluster.reduce((acc, c) => acc + c.lat, 0) / cluster.length;
    const centerLon = cluster.reduce((acc, c) => acc + c.lon, 0) / cluster.length;

    // Keep an OSM-backed representative id nearest to cluster centroid.
    let representative = cluster[0];
    let bestDist = haversineMeters(centerLat, centerLon, representative.lat, representative.lon);
    for (let i = 1; i < cluster.length; i++) {
      const c = cluster[i];
      const dist = haversineMeters(centerLat, centerLon, c.lat, c.lon);
      if (dist < bestDist) {
        bestDist = dist;
        representative = c;
      }
    }

      return {
        id: representative.id,
        lat: centerLat,
        lon: centerLon,
        wayCount: Math.max(...cluster.map((c) => c.wayCount || 0)),
        majorWayCount: Math.max(...cluster.map((c) => c.majorWayCount || 0)),
        signal: cluster.some((c) => Boolean(c.signal)),
        mergedCount: cluster.length,
      };
    });
}

function inferSpeedByHighway(highway) {
  switch (highway) {
    case 'motorway':
      return 5.0;
    case 'trunk':
      return 4.3;
    case 'primary':
      return 3.8;
    case 'secondary':
      return 3.2;
    case 'tertiary':
      return 2.8;
    case 'residential':
      return 2.3;
    case 'service':
      return 1.9;
    case 'unclassified':
      return 2.2;
    default:
      return 2.2;
  }
}

function inferLaneByHighway(highway) {
  switch (highway) {
    case 'motorway':
      return 4;
    case 'trunk':
      return 3;
    case 'primary':
      return 3;
    case 'secondary':
      return 2;
    case 'tertiary':
      return 2;
    default:
      return 1;
  }
}

function chooseNearestFreeCell(targetR, targetC, size, occupied, maxRadius = null) {
  const key0 = `${targetR},${targetC}`;
  if (!occupied.has(key0)) return [targetR, targetC];

  const limit = Number.isFinite(maxRadius) ? Math.max(0, maxRadius) : size;
  for (let radius = 1; radius <= limit; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const r = targetR + dr;
        const c = targetC + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        if (Math.abs(dr) + Math.abs(dc) > radius) continue;
        const key = `${r},${c}`;
        if (!occupied.has(key)) return [r, c];
      }
    }
  }

  return null;
}

function chooseNearestFreeSignedCell(targetR, targetC, occupied, maxRadius = 256) {
  const key0 = `${targetR},${targetC}`;
  if (!occupied.has(key0)) return [targetR, targetC];

  const limit = Math.max(0, maxRadius);
  for (let radius = 1; radius <= limit; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.abs(dr) + Math.abs(dc) > radius) continue;
        const r = targetR + dr;
        const c = targetC + dc;
        const key = `${r},${c}`;
        if (!occupied.has(key)) return [r, c];
      }
    }
  }

  return null;
}

function buildAdjacency(links) {
  const adj = new Map();
  for (const l of links) {
    if (!adj.has(l.fromNode)) adj.set(l.fromNode, new Set());
    if (!adj.has(l.toNode)) adj.set(l.toNode, new Set());
    adj.get(l.fromNode).add(l.toNode);
    adj.get(l.toNode).add(l.fromNode);
  }
  return adj;
}

function assignNodesToGridWithGraph(points, links, initialGridSize) {
  const gridSize = Math.max(2, initialGridSize);
  const adj = buildAdjacency(links);

  const lats = points.map((x) => x.lat);
  const lons = points.map((x) => x.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latRange = Math.max(1e-6, maxLat - minLat);
  const lonRange = Math.max(1e-6, maxLon - minLon);

  const targetById = new Map();
  for (const p of points) {
    const rFloatGrid = ((maxLat - p.lat) / latRange) * (gridSize - 1);
    const cFloatGrid = ((p.lon - minLon) / lonRange) * (gridSize - 1);
    const rFloat = rFloatGrid - (gridSize - 1) / 2;
    const cFloat = cFloatGrid - (gridSize - 1) / 2;
    targetById.set(p.id, {
      rFloat,
      cFloat,
      targetR: Math.round(rFloat),
      targetC: Math.round(cFloat),
    });
    if (!adj.has(p.id)) adj.set(p.id, new Set());
  }

  const occupied = new Set();
  const posById = new Map();
  const pointById = new Map(points.map((p) => [p.id, p]));
  const blockedFromReseed = new Set();
  const dirOrder = [
    [0, 1],  // Right
    [1, 0],  // Down
    [0, -1], // Left
    [-1, 0], // Up
  ];

  const pickCellNearParent = (parentPos) => {
    for (const [dr, dc] of dirOrder) {
      const r = parentPos.r + dr;
      const c = parentPos.c + dc;
      if (!occupied.has(`${r},${c}`)) return [r, c];
    }
    return null;
  };

  const seeds = points
    .slice()
    .sort((a, b) => {
      if (a.lat !== b.lat) return b.lat - a.lat; // north first
      if (a.lon !== b.lon) return a.lon - b.lon; // west first
      return (a.id || 0) - (b.id || 0);
    });

  let firstSeedPlaced = false;

  for (const seed of seeds) {
    if (posById.has(seed.id)) continue;
    if (blockedFromReseed.has(seed.id)) continue;

    if (!firstSeedPlaced) {
      posById.set(seed.id, { r: 0, c: 0 });
      occupied.add('0,0');
      firstSeedPlaced = true;
    } else {
      const t = targetById.get(seed.id);
      const assigned = chooseNearestFreeSignedCell(t.targetR, t.targetC, occupied, gridSize * 3);
      if (!assigned) continue;
      const [sr, sc] = assigned;
      posById.set(seed.id, { r: sr, c: sc });
      occupied.add(`${sr},${sc}`);
    }

    const q = [seed.id];
    const seenInComponent = new Set([seed.id]);
    while (q.length) {
      const id = q.shift();
      const parentPos = posById.get(id);
      if (!parentPos) continue;

      const neighbors = Array.from(adj.get(id) || [])
        .filter((nid) => pointById.has(nid))
        .sort((a, b) => {
          const ta = targetById.get(a);
          const tb = targetById.get(b);
          const da = Math.abs(ta.rFloat - targetById.get(id).rFloat) + Math.abs(ta.cFloat - targetById.get(id).cFloat);
          const db = Math.abs(tb.rFloat - targetById.get(id).rFloat) + Math.abs(tb.cFloat - targetById.get(id).cFloat);
          return da - db;
        });

      for (const nid of neighbors) {
        if (!posById.has(nid)) {
          const assigned = pickCellNearParent(parentPos);
          if (!assigned) {
            blockedFromReseed.add(nid);
            continue;
          }
          const [r, c] = assigned;
          posById.set(nid, { r, c });
          occupied.add(`${r},${c}`);
          blockedFromReseed.delete(nid);
        }
        if (!seenInComponent.has(nid)) {
          seenInComponent.add(nid);
          q.push(nid);
        }
      }
    }
  }

  if (!posById.size) return { posById, displayPosById: new Map(), gridSize };

  let minR = Infinity;
  let maxR = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;
  for (const p of posById.values()) {
    if (p.r < minR) minR = p.r;
    if (p.r > maxR) maxR = p.r;
    if (p.c < minC) minC = p.c;
    if (p.c > maxC) maxC = p.c;
  }

  const spanR = maxR - minR + 1;
  const spanC = maxC - minC + 1;
  const normalizedGridSize = Math.max(gridSize, spanR, spanC);
  const padR = Math.floor((normalizedGridSize - spanR) / 2);
  const padC = Math.floor((normalizedGridSize - spanC) / 2);

  const displayPosById = new Map();
  for (const [id, p] of posById.entries()) {
    displayPosById.set(id, { r: p.r, c: p.c });
    p.r = p.r - minR + padR;
    p.c = p.c - minC + padC;
  }

  return {
    posById,
    displayPosById,
    gridSize: normalizedGridSize,
    droppedByAdjacencyCapacity: blockedFromReseed.size,
    droppedDisconnected: Math.max(0, points.length - posById.size - blockedFromReseed.size),
  };
}

function headingFromDelta(dr, dc) {
  if (Math.abs(dr) > Math.abs(dc)) return dr < 0 ? 'N' : 'S';
  return dc > 0 ? 'E' : 'W';
}

function addPathEdges(r1, c1, r2, c2, callback) {
  let r = r1;
  let c = c1;

  while (r !== r2) {
    const nr = r + (r2 > r ? 1 : -1);
    callback(r, c, nr, c);
    r = nr;
  }
  while (c !== c2) {
    const nc = c + (c2 > c ? 1 : -1);
    callback(r, c, r, nc);
    c = nc;
  }
}

function haversineMeters(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLon = (bLon - aLon) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function bearingDeg(aLat, aLon, bLat, bLon) {
  const y = Math.sin((bLon - aLon) * Math.PI / 180) * Math.cos(bLat * Math.PI / 180);
  const x = Math.cos(aLat * Math.PI / 180) * Math.sin(bLat * Math.PI / 180)
    - Math.sin(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.cos((bLon - aLon) * Math.PI / 180);
  const brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

function angleGap(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function axisFromBearing(bearing) {
  return ((bearing % 180) + 180) % 180;
}

function countUniqueAxes(bearings, axisMergeThresholdDeg = 20) {
  const axes = [];
  for (const b of bearings) {
    const axis = axisFromBearing(b);
    const exists = axes.some((x) => Math.abs(x - axis) <= axisMergeThresholdDeg || Math.abs(x - axis) >= (180 - axisMergeThresholdDeg));
    if (!exists) axes.push(axis);
  }
  return axes.length;
}

function selectIntersectionsForSimulation(intersections, maxCount = MAX_SIM_INTERSECTIONS) {
  if (!Array.isArray(intersections) || intersections.length <= maxCount) {
    return intersections || [];
  }

  const ranked = intersections
    .slice()
    .sort((a, b) => {
      if (Number(Boolean(b.signal)) !== Number(Boolean(a.signal))) {
        return Number(Boolean(b.signal)) - Number(Boolean(a.signal));
      }
      if ((b.wayCount || 0) !== (a.wayCount || 0)) {
        return (b.wayCount || 0) - (a.wayCount || 0);
      }
      return (a.id || 0) - (b.id || 0);
    });

  // Prefer dense, highly connected intersections first to preserve usable graph edges.
  return ranked.slice(0, maxCount);
}

function simplifyRoadsForMap(roads, maxCount = 7000) {
  if (!Array.isArray(roads) || roads.length <= maxCount) return roads || [];

  const majorClasses = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
  const priority = roads.filter((r) => r.fromGrid || r.toGrid || majorClasses.has(r.highway));
  if (priority.length >= maxCount) return priority.slice(0, maxCount);

  const remaining = roads.filter((r) => !(r.fromGrid || r.toGrid || majorClasses.has(r.highway)));
  return [...priority, ...remaining.slice(0, Math.max(0, maxCount - priority.length))];
}

function parseOneWayDirection(tags) {
  const raw = String(tags?.oneway || '').trim().toLowerCase();
  if (raw === '-1' || raw === 'reverse') return 'reverse';
  if (raw === 'yes' || raw === '1' || raw === 'true') return 'forward';
  return 'both';
}

function parseRestrictionRelations(relations) {
  return relations
    .map((rel) => {
      const members = rel.members || [];
      const fromWay = members.find((m) => m.type === 'way' && m.role === 'from')?.ref ?? null;
      const toWay = members.find((m) => m.type === 'way' && m.role === 'to')?.ref ?? null;
      const viaNode = members.find((m) => m.type === 'node' && m.role === 'via')?.ref ?? null;
      const viaWay = members.find((m) => m.type === 'way' && m.role === 'via')?.ref ?? null;
      const restrictionType = String(rel.tags?.restriction || '').toLowerCase();

      if (!fromWay || !toWay) return null;

      return {
        id: rel.id,
        fromWay,
        toWay,
        viaNode,
        viaWay,
        restrictionType,
      };
    })
    .filter(Boolean);
}

function buildAccurateTopology({ ways, nodeById, trafficSignals, restrictions }) {
  const nodeWaySet = new Map();
  const nodeNeighborSet = new Map();
  const wayNodePos = new Map();

  for (const way of ways) {
    const nodes = way.nodes || [];
    const posMap = new Map();

    for (let i = 0; i < nodes.length; i++) {
      const nid = nodes[i];
      if (!nodeWaySet.has(nid)) nodeWaySet.set(nid, new Set());
      nodeWaySet.get(nid).add(way.id);

      if (!nodeNeighborSet.has(nid)) nodeNeighborSet.set(nid, new Set());
      if (i > 0) nodeNeighborSet.get(nid).add(nodes[i - 1]);
      if (i < nodes.length - 1) nodeNeighborSet.get(nid).add(nodes[i + 1]);

      posMap.set(nid, i);
    }
    wayNodePos.set(way.id, posMap);
  }

  const parsedRestrictions = parseRestrictionRelations(restrictions);
  const restrictionViaNodeSet = new Set(parsedRestrictions.map((r) => r.viaNode).filter(Boolean));
  const topologyNodeSet = new Set();

  for (const way of ways) {
    const nodes = way.nodes || [];
    if (nodes.length > 0) {
      topologyNodeSet.add(nodes[0]);
      topologyNodeSet.add(nodes[nodes.length - 1]);
    }
  }

  for (const [nid, waySet] of nodeWaySet.entries()) {
    const degree = nodeNeighborSet.get(nid)?.size ?? 0;
    if (waySet.size >= 2 || degree !== 2 || trafficSignals.has(nid) || restrictionViaNodeSet.has(nid)) {
      topologyNodeSet.add(nid);
    }
  }

  const topologyEdges = [];

  for (const way of ways) {
    const nodes = way.nodes || [];
    if (nodes.length < 2) continue;

    const direction = parseOneWayDirection(way.tags);
    const highway = way.tags?.highway || 'unknown';
    const lanes = toNum(way.tags?.lanes, inferLaneByHighway(highway));
    const maxspeedKmh = toNum(String(way.tags?.maxspeed || '').replace(/[^0-9.]/g, ''), 0);

    let segmentStartIdx = 0;

    for (let i = 1; i < nodes.length; i++) {
      const currentNodeId = nodes[i];
      const isSplitPoint = topologyNodeSet.has(currentNodeId);
      if (!isSplitPoint) continue;

      const fromNode = nodes[segmentStartIdx];
      const toNode = currentNodeId;
      if (fromNode === toNode) {
        segmentStartIdx = i;
        continue;
      }

      const pathNodeIds = nodes.slice(segmentStartIdx, i + 1);
      let meters = 0;
      let hasValidPath = true;

      for (let p = 0; p < pathNodeIds.length - 1; p++) {
        const a = nodeById.get(pathNodeIds[p]);
        const b = nodeById.get(pathNodeIds[p + 1]);
        if (!a || !b) {
          hasValidPath = false;
          break;
        }
        meters += haversineMeters(a.lat, a.lon, b.lat, b.lon);
      }

      if (hasValidPath && meters > 0) {
        const edgeBase = {
          wayId: way.id,
          highway,
          lanes,
          maxspeedKmh,
          pathNodeIds,
          meters: Number(meters.toFixed(2)),
        };

        if (direction === 'forward' || direction === 'both') {
          topologyEdges.push({
            ...edgeBase,
            fromNode,
            toNode,
            oneway: direction !== 'both',
          });
        }

        if (direction === 'reverse' || direction === 'both') {
          topologyEdges.push({
            ...edgeBase,
            fromNode: toNode,
            toNode: fromNode,
            pathNodeIds: pathNodeIds.slice().reverse(),
            oneway: direction !== 'both',
          });
        }
      }

      segmentStartIdx = i;
    }
  }

  const edgeKey = (e) => `${e.wayId}:${e.fromNode}->${e.toNode}`;
  const edgeByKey = new Map(topologyEdges.map((e) => [edgeKey(e), e]));
  const byWayToNode = new Map();
  const byWayFromNode = new Map();

  for (const e of topologyEdges) {
    const toKey = `${e.wayId}:${e.toNode}`;
    if (!byWayToNode.has(toKey)) byWayToNode.set(toKey, []);
    byWayToNode.get(toKey).push(e);

    const fromKey = `${e.wayId}:${e.fromNode}`;
    if (!byWayFromNode.has(fromKey)) byWayFromNode.set(fromKey, []);
    byWayFromNode.get(fromKey).push(e);
  }

  const resolvedRestrictions = [];
  let unresolvedRestrictionCount = 0;

  for (const r of parsedRestrictions) {
    // via-way restrictions are retained as unresolved for now.
    if (!r.viaNode) {
      unresolvedRestrictionCount += 1;
      continue;
    }

    const fromCandidates = byWayToNode.get(`${r.fromWay}:${r.viaNode}`) || [];
    const toCandidates = byWayFromNode.get(`${r.toWay}:${r.viaNode}`) || [];

    if (!fromCandidates.length || !toCandidates.length) {
      unresolvedRestrictionCount += 1;
      continue;
    }

    for (const fe of fromCandidates) {
      for (const te of toCandidates) {
        resolvedRestrictions.push({
          relationId: r.id,
          restrictionType: r.restrictionType,
          viaNode: r.viaNode,
          fromEdge: edgeKey(fe),
          toEdge: edgeKey(te),
        });
      }
    }
  }

  const topologyNodes = Array.from(topologyNodeSet)
    .map((nid) => {
      const node = nodeById.get(nid);
      if (!node) return null;
      return {
        id: nid,
        lat: node.lat,
        lon: node.lon,
        signal: trafficSignals.has(nid),
        connectedWayCount: nodeWaySet.get(nid)?.size ?? 0,
        neighborCount: nodeNeighborSet.get(nid)?.size ?? 0,
      };
    })
    .filter(Boolean);

  return {
    nodes: topologyNodes,
    edges: topologyEdges,
    restrictions: resolvedRestrictions,
    summary: {
      topologyNodeCount: topologyNodes.length,
      topologyEdgeCount: topologyEdges.length,
      restrictionCountInput: parsedRestrictions.length,
      restrictionCountResolved: resolvedRestrictions.length,
      restrictionCountUnresolved: unresolvedRestrictionCount,
    },
    internal: {
      edgeByKeySize: edgeByKey.size,
      wayNodePosSize: wayNodePos.size,
    },
  };
}

export function buildImportedScenario({ place, overpassData }) {
  const elements = overpassData?.elements || [];
  const nodeById = new Map();
  const ways = [];
  const restrictions = [];

  for (const el of elements) {
    if (el.type === 'node') nodeById.set(el.id, el);
    if (el.type === 'way' && el.tags?.highway) ways.push(el);
    if (el.type === 'relation' && el.tags?.type === 'restriction') restrictions.push(el);
  }

  const mainWays = ways.filter((w) => isMainRoadClass(w.tags?.highway));
  const networkWays = mainWays.length >= 20 ? mainWays : ways;

  const trafficSignals = new Set(
    elements
      .filter((e) => e.type === 'node' && e.tags?.highway === 'traffic_signals')
      .map((e) => e.id)
  );

  const accurateTopology = buildAccurateTopology({ ways: networkWays, nodeById, trafficSignals, restrictions });
  const topologyNodes = accurateTopology.nodes || [];

  const nodeMajorWayCount = new Map();
  for (const way of networkWays) {
    if (!isMainRoadClass(way.tags?.highway)) continue;
    for (const nid of way.nodes || []) {
      nodeMajorWayCount.set(nid, (nodeMajorWayCount.get(nid) || 0) + 1);
    }
  }

  const intersections = topologyNodes
    .filter((n) => {
      const majorWayCount = nodeMajorWayCount.get(n.id) || 0;
      return majorWayCount >= 2 && n.neighborCount >= 3;
    })
    .map((n) => ({
      id: n.id,
      lat: n.lat,
      lon: n.lon,
      wayCount: n.connectedWayCount,
      majorWayCount: nodeMajorWayCount.get(n.id) || 0,
      signal: n.signal,
    }));

  const rejectedStraightCandidates = topologyNodes.filter((n) => !intersections.some((x) => x.id === n.id));
  const angleThreshold = null;

  let finalIntersections = intersections;
  if (finalIntersections.length < 30) {
    finalIntersections = topologyNodes
      .filter((n) => {
        const majorWayCount = nodeMajorWayCount.get(n.id) || 0;
        return majorWayCount >= 1 && n.neighborCount >= 3;
      })
      .map((n) => ({
        id: n.id,
        lat: n.lat,
        lon: n.lon,
        wayCount: n.connectedWayCount,
        majorWayCount: nodeMajorWayCount.get(n.id) || 0,
        signal: n.signal,
      }));
  }

  if (!finalIntersections.length) {
    throw new Error('No valid intersections detected in fetched OSM network. Try selecting a city-level relation result.');
  }

  const clusteredIntersections = collapseIntersectionClusters(
    finalIntersections,
    INTERSECTION_CLUSTER_RADIUS_M,
    MIN_INTERSECTION_CLUSTER_POINTS
  );
  const droppedByClusterMinPoints = Math.max(0, finalIntersections.length - clusteredIntersections.length);

  // Keep original topology node IDs for graph extraction; clustered representatives
  // can break way-based chaining and cause zero visual edges.
  const intersectionsForSelection = finalIntersections;

  const availableCount = Math.min(intersectionsForSelection.length, MAX_SIM_INTERSECTIONS);
  const gridSlackFactor = 1.6;
  const initialGridSize = Math.max(2, Math.ceil(Math.sqrt(Math.max(4, availableCount) * gridSlackFactor)));
  const targetIntersectionCount = availableCount;
  const simulationIntersections = selectIntersectionsForSimulation(intersectionsForSelection, targetIntersectionCount);

  const nodeToGrid = new Map();
  const gridLabels = {};
  const markers = [];

  // Build connectivity over selected points first, then derive grid from that graph.
  const selectedIdSet = new Set(simulationIntersections.map((x) => x.id));
  const preGraphLinks = [];
  for (const way of networkWays) {
    const highway = way.tags?.highway || 'unknown';
    const oneway = ['yes', '1', 'true'].includes(String(way.tags?.oneway || '').toLowerCase());
    const lanes = toNum(way.tags?.lanes, inferLaneByHighway(highway));
    const maxspeedKmh = toNum(String(way.tags?.maxspeed || '').replace(/[^0-9.]/g, ''), 0);
    const nodes = way.nodes || [];

    let lastSelected = null;
    for (const nid of nodes) {
      if (!selectedIdSet.has(nid)) continue;
      if (lastSelected == null) {
        lastSelected = nid;
        continue;
      }
      if (lastSelected === nid) continue;

      const fromNode = nodeById.get(lastSelected);
      const toNode = nodeById.get(nid);
      if (fromNode && toNode) {
        const meters = haversineMeters(fromNode.lat, fromNode.lon, toNode.lat, toNode.lon);
        preGraphLinks.push({ fromNode: lastSelected, toNode: nid, highway, oneway, lanes, maxspeedKmh, meters });
      }
      lastSelected = nid;
    }
  }

  const placement = assignNodesToGridWithGraph(simulationIntersections, preGraphLinks, initialGridSize);
  const gridSize = placement.gridSize;
  const coordLabels = {};
  let originGridKey = null;

  for (const x of simulationIntersections) {
    const p = placement.posById.get(x.id);
    if (!p) continue;
    const displayPos = placement.displayPosById?.get(x.id) || p;
    const r = p.r;
    const c = p.c;
    const gridKey = `${r},${c}`;
    const mapId = `OSM-${x.id}`;
    const displayRow = displayPos.r;
    const displayCol = displayPos.c;
    const isOrigin = displayRow === 0 && displayCol === 0;

    nodeToGrid.set(x.id, { r, c, gridKey, mapId });
    gridLabels[gridKey] = mapId;
    coordLabels[gridKey] = `(${displayRow},${displayCol})`;
    if (isOrigin) originGridKey = gridKey;
    markers.push({
      id: x.id,
      mapId,
      lat: x.lat,
      lon: x.lon,
      row: r,
      col: c,
      displayRow,
      displayCol,
      gridKey,
      signal: x.signal,
      wayCount: x.wayCount,
      isOrigin,
    });
  }

  const droppedByGridCollision = Math.max(0, simulationIntersections.length - markers.length);

  // Strictly map/connect only points that are actually plotted on the map.
  const mappedNodeSet = new Set(markers.map((m) => m.id));

  const roads = [];
  const graphLinks = [];

  for (const way of ways) {
    const highway = way.tags?.highway || 'unknown';
    const oneway = ['yes', '1', 'true'].includes(String(way.tags?.oneway || '').toLowerCase());
    const lanes = toNum(way.tags?.lanes, inferLaneByHighway(highway));
    const maxspeedKmh = toNum(String(way.tags?.maxspeed || '').replace(/[^0-9.]/g, ''), 0);

    const nodes = way.nodes || [];

    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodeById.get(nodes[i]);
      const b = nodeById.get(nodes[i + 1]);
      if (!a || !b) continue;

      roads.push({
        id: `${way.id}-${i}`,
        highway,
        oneway,
        lanes,
        maxspeedKmh,
        coords: [[a.lat, a.lon], [b.lat, b.lon]],
        fromGrid: nodeToGrid.get(a.id) || null,
        toGrid: nodeToGrid.get(b.id) || null,
      });
    }

    let lastMapped = null;
    for (const nid of nodes) {
      if (!mappedNodeSet.has(nid)) continue;
      if (lastMapped == null) {
        lastMapped = nid;
        continue;
      }
      if (lastMapped === nid) continue;

      const fromNode = nodeById.get(lastMapped);
      const toNode = nodeById.get(nid);
      if (fromNode && toNode) {
        const meters = haversineMeters(fromNode.lat, fromNode.lon, toNode.lat, toNode.lon);
        graphLinks.push({
          fromNode: lastMapped,
          toNode: nid,
          highway,
          oneway,
          lanes,
          maxspeedKmh,
          meters,
        });
      }
      lastMapped = nid;
    }
  }

  const edgeAgg = new Map();
  const nodeDirAgg = new Map();

  function addNodeDir(row, col, dir, capacity) {
    const key = `${row},${col}`;
    if (!nodeDirAgg.has(key)) {
      nodeDirAgg.set(key, { N: 0, S: 0, E: 0, W: 0 });
    }
    nodeDirAgg.get(key)[dir] += capacity;
  }

  for (const link of graphLinks) {
    const fromGrid = nodeToGrid.get(link.fromNode);
    const toGrid = nodeToGrid.get(link.toNode);
    if (!fromGrid || !toGrid) continue;

    const inferredSpeed = link.maxspeedKmh > 0
      ? clamp(link.maxspeedKmh / 18, 1.0, 8.0)
      : inferSpeedByHighway(link.highway);
    const inferredLength = clamp(Math.round(link.meters / 15), 4, 80);
    const capacity = clamp(Math.round(link.lanes * inferredSpeed), 2, 30);

    const dr = toGrid.r - fromGrid.r;
    const dc = toGrid.c - fromGrid.c;
    const manhattanSteps = Math.max(1, Math.abs(dr) + Math.abs(dc));
    const perEdgeLength = clamp(Math.round(inferredLength / manhattanSteps), 2, 80);
    const dir = headingFromDelta(dr, dc);
    const oppositeDir = headingFromDelta(-dr, -dc);

    addNodeDir(fromGrid.r, fromGrid.c, dir, capacity);
    if (!link.oneway) {
      addNodeDir(toGrid.r, toGrid.c, oppositeDir, capacity);
    }

    addPathEdges(fromGrid.r, fromGrid.c, toGrid.r, toGrid.c, (r1, c1, r2, c2) => {
      const edgeKey = `${r1},${c1}->${r2},${c2}`;
      if (!edgeAgg.has(edgeKey)) {
        edgeAgg.set(edgeKey, {
          speedSum: 0,
          speedCount: 0,
          lengthSum: 0,
          lengthCount: 0,
          oneWayForward: 0,
          twoWaySupport: 0,
        });
      }

      const acc = edgeAgg.get(edgeKey);
      acc.speedSum += inferredSpeed;
      acc.speedCount += 1;
      acc.lengthSum += perEdgeLength;
      acc.lengthCount += 1;
      if (link.oneway) acc.oneWayForward += 1;
      else acc.twoWaySupport += 1;
    });

    if (!link.oneway) {
      addPathEdges(toGrid.r, toGrid.c, fromGrid.r, fromGrid.c, (r1, c1, r2, c2) => {
        const edgeKey = `${r1},${c1}->${r2},${c2}`;
        if (!edgeAgg.has(edgeKey)) {
          edgeAgg.set(edgeKey, {
            speedSum: 0,
            speedCount: 0,
            lengthSum: 0,
            lengthCount: 0,
            oneWayForward: 0,
            twoWaySupport: 0,
          });
        }
        const acc = edgeAgg.get(edgeKey);
        acc.speedSum += inferredSpeed;
        acc.speedCount += 1;
        acc.lengthSum += perEdgeLength;
        acc.lengthCount += 1;
        acc.twoWaySupport += 1;
      });
    }
  }

  const roadOverrides = {};
  for (const [edgeKey, acc] of edgeAgg.entries()) {
    const speed = acc.speedCount ? acc.speedSum / acc.speedCount : 2.2;
    const length = acc.lengthCount ? Math.round(acc.lengthSum / acc.lengthCount) : 12;
    const oneWayRatio = (acc.oneWayForward + acc.twoWaySupport) > 0
      ? acc.oneWayForward / (acc.oneWayForward + acc.twoWaySupport)
      : 0;

    roadOverrides[edgeKey] = {
      speed: Number(speed.toFixed(2)),
      length,
      turnT: Number(clamp(0.65 + (1 - oneWayRatio) * 0.2, 0.55, 0.9).toFixed(2)),
      turnR: Number(clamp(0.15 + oneWayRatio * 0.08, 0.05, 0.25).toFixed(2)),
      turnL: Number(clamp(0.2 - oneWayRatio * 0.08, 0.05, 0.3).toFixed(2)),
    };
  }

  const departureRateOverrides = {};
  let totalDepartureSum = 0;
  let totalDepartureCount = 0;

  for (const marker of markers) {
    const key = marker.gridKey;
    const dirData = nodeDirAgg.get(key) || { N: 0, S: 0, E: 0, W: 0 };
    const base = {
      N: clamp(Math.round(3 + dirData.N), 2, 40),
      S: clamp(Math.round(3 + dirData.S), 2, 40),
      E: clamp(Math.round(3 + dirData.E), 2, 40),
      W: clamp(Math.round(3 + dirData.W), 2, 40),
    };
    departureRateOverrides[key] = base;
    totalDepartureSum += base.N + base.S + base.E + base.W;
    totalDepartureCount += 4;
  }

  const boundaryInflowOverrides = {};
  const sideTotals = { N: 0, S: 0, E: 0, W: 0 };

  for (const marker of markers) {
    const dirs = [];
    if (marker.row === 0) dirs.push('N');
    if (marker.row === gridSize - 1) dirs.push('S');
    if (marker.col === 0) dirs.push('W');
    if (marker.col === gridSize - 1) dirs.push('E');

    if (!dirs.length) continue;

    const key = marker.gridKey;
    if (!boundaryInflowOverrides[key]) boundaryInflowOverrides[key] = {};

    const dirData = nodeDirAgg.get(key) || { N: 0, S: 0, E: 0, W: 0 };
    for (const d of dirs) {
      const inflow = clamp(Math.round(2 + (dirData[d] || 0) * 0.7), 0, 40);
      boundaryInflowOverrides[key][d] = makeConstantInflowProfile(inflow);
      sideTotals[d] += inflow;
    }
  }

  const speedSamples = networkWays.map((w) => {
    const highway = w.tags?.highway || 'unknown';
    const maxspeed = toNum(String(w.tags?.maxspeed || '').replace(/[^0-9.]/g, ''), 0);
    return maxspeed > 0 ? clamp(maxspeed / 18, 1.0, 8.0) : inferSpeedByHighway(highway);
  });
  const avgSpeed = speedSamples.length
    ? speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length
    : 2.5;

  const avgDeparture = totalDepartureCount ? totalDepartureSum / totalDepartureCount : 8;
  const globalInflowCap = clamp(Math.round(Math.max(sideTotals.N, sideTotals.S, sideTotals.E, sideTotals.W) || 60), 30, 200);

  const configPatch = {
    gridSize,
    defaultRoadSpeed: Number(avgSpeed.toFixed(2)),
    defaultRoadLength: 12,
    defaultTurnProbT: 0.72,
    defaultTurnProbR: 0.16,
    defaultTurnProbL: 0.12,
    baseDepartureRate: clamp(Math.round(avgDeparture), 4, 40),
    inflowGlobalCap: globalInflowCap,
    defaultBoundaryInflowProfiles: {
      N: makeConstantInflowProfile(clamp(Math.round(sideTotals.N / Math.max(1, markers.length)), 0, 30)),
      S: makeConstantInflowProfile(clamp(Math.round(sideTotals.S / Math.max(1, markers.length)), 0, 30)),
      E: makeConstantInflowProfile(clamp(Math.round(sideTotals.E / Math.max(1, markers.length)), 0, 30)),
      W: makeConstantInflowProfile(clamp(Math.round(sideTotals.W / Math.max(1, markers.length)), 0, 30)),
    },
  };

  const bb = place?.boundingbox || [];
  const bbox = bb.length === 4
    ? {
        south: Number(bb[0]),
        north: Number(bb[1]),
        west: Number(bb[2]),
        east: Number(bb[3]),
      }
    : null;

  const validationReport = {
    inputSummary: {
      totalElements: elements.length,
      wayCount: networkWays.length,
      fetchedWayCount: ways.length,
      nodeCount: nodeById.size,
      restrictionRelationCount: restrictions.length,
      trafficSignalNodeCount: trafficSignals.size,
    },
    intersectionDetection: {
      strictIntersections: finalIntersections.length,
      clusteredIntersections: clusteredIntersections.length,
      selectionSource: 'unclustered_finalIntersections',
      clusterRadiusMeters: INTERSECTION_CLUSTER_RADIUS_M,
      clusterMinPoints: MIN_INTERSECTION_CLUSTER_POINTS,
      droppedByClusterMinPoints,
      selectedForGrid: simulationIntersections.length,
      usedForSimulation: markers.length,
      maxSimIntersections: MAX_SIM_INTERSECTIONS,
      rejectedStraightLikeCandidates: rejectedStraightCandidates.length,
      angleThresholdDeg: angleThreshold,
      topologyCriteria: 'majorWayCount>=2 AND neighborCount>=3 (fallback: majorWayCount>=1 AND neighborCount>=3)',
    },
    projection: {
      gridSize,
      targetIntersectionCount,
      gridSlackFactor,
      mappedPointCount: markers.length,
      droppedByGridCollision,
      droppedByAdjacencyCapacity: placement.droppedByAdjacencyCapacity || 0,
      droppedDisconnected: placement.droppedDisconnected || 0,
      droppedTotalBeforeMapping: Math.max(0, finalIntersections.length - markers.length),
      graphLinkCount: graphLinks.length,
      preGraphLinkCount: preGraphLinks.length,
      latticeEdgeOverrideCount: Object.keys(roadOverrides).length,
      rawRoadSegmentCount: roads.length,
    },
    accurateTopology: accurateTopology.summary,
    simulationIngestion: {
      configPatch,
      departureOverrideCount: Object.keys(departureRateOverrides).length,
      boundaryInflowOverrideCount: Object.keys(boundaryInflowOverrides).length,
      roadOverrideCount: Object.keys(roadOverrides).length,
      limitation: 'Engine still uses full lattice connectivity. Imported topology is represented through weighted road/departure/inflow parameters, not hard edge disabling.',
    },
    parameterDerivation: {
      fromWays: ['highway class', 'lanes', 'maxspeed', 'oneway'],
      fromNodes: ['signal presence', 'intersection topology', 'boundary position'],
      outputs: ['defaultRoadSpeed', 'baseDepartureRate', 'inflowGlobalCap', 'roadOverrides', 'departureRateOverrides', 'boundaryInflowOverrides'],
      sideInflowTotals: sideTotals,
    },
    sampleMappings: markers.slice(0, 12).map((m) => ({
      mapId: m.mapId,
      osmNodeId: m.id,
      lat: m.lat,
      lon: m.lon,
      gridCell: [m.row, m.col],
      displayGridCell: [m.displayRow, m.displayCol],
      signal: m.signal,
      wayCount: m.wayCount,
    })),
  };

  const mapRoads = simplifyRoadsForMap(roads, 7000);
  validationReport.projection.mapRoadSegmentCount = mapRoads.length;

  const graphEdges = [];
  const graphEdgeSeen = new Set();
  const allVisualLinks = [...preGraphLinks, ...graphLinks];
  for (const link of allVisualLinks) {
    const fromGrid = nodeToGrid.get(link.fromNode);
    const toGrid = nodeToGrid.get(link.toNode);
    if (!fromGrid || !toGrid) continue;
    if (fromGrid.gridKey === toGrid.gridKey) continue;

    // Visual graph uses undirected links for clarity; dedupe both directions.
    const a = fromGrid.gridKey;
    const b = toGrid.gridKey;
    const undirectedKey = a < b ? `${a}<->${b}` : `${b}<->${a}`;
    if (graphEdgeSeen.has(undirectedKey)) continue;
    graphEdgeSeen.add(undirectedKey);

    graphEdges.push({
      fromGridKey: a,
      toGridKey: b,
      highway: link.highway,
      oneway: link.oneway,
    });
  }
  validationReport.projection.visualGraphEdgeCount = graphEdges.length;

  let adjacencyViolations = 0;
  for (const link of graphLinks) {
    const a = nodeToGrid.get(link.fromNode);
    const b = nodeToGrid.get(link.toNode);
    if (!a || !b) continue;
    const manhattan = Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
    if (manhattan !== 1) adjacencyViolations += 1;
  }
  validationReport.projection.adjacencyViolations = adjacencyViolations;

  const meta = {
    placeName: place?.display_name || 'Imported place',
    center: [Number(place?.lat || 0), Number(place?.lon || 0)],
    bbox,
    markers,
    roads: mapRoads,
    graphEdges,
    accurateTopology: { summary: accurateTopology.summary },
    gridLabels,
    coordLabels,
    originGridKey,
    validationReport,
    notes: [
      'Drivable roads, traffic-signal hints, and turn-restriction relations were fetched from OSM.',
      'Intersections are detected using strict way-crossing + angle-spread rules to avoid straight-road false points.',
      'Imported data is mapped to simulator config/road/departure/boundary inflow parameters.',
    ],
  };

  return {
    configPatch,
    roadOverrides,
    boundaryRoadOverrides: {},
    departureRateOverrides,
    boundaryInflowOverrides,
    meta,
  };
}
