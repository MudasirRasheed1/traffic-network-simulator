const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const NON_DRIVEABLE_HIGHWAY_REGEX = 'footway|cycleway|path|pedestrian|steps|bridleway|corridor|proposed|construction';
const HIGHWAY_INCLUDE_REGEX = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|service|living_street|track|road|bus_guideway';
const OVERPASS_REQUEST_TIMEOUT_MS = 25000;
const OVERPASS_MAX_TOTAL_FETCH_MS = 120000;
const OVERPASS_MAX_ELEMENTS = 90000;
const BBOX_SIDE_TRIM_RATIO = 0.1;
const BBOX_MAX_SPAN = 0.14;

const HIGHWAY_PRIORITY = {
  motorway: 100,
  motorway_link: 95,
  trunk: 92,
  trunk_link: 88,
  primary: 85,
  primary_link: 80,
  secondary: 75,
  secondary_link: 70,
  tertiary: 65,
  tertiary_link: 60,
  unclassified: 50,
  residential: 45,
  service: 35,
  living_street: 30,
  track: 20,
  road: 15,
  bus_guideway: 25,
};

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBBox(bbox) {
  const south = Math.min(toNum(bbox.south), toNum(bbox.north));
  const north = Math.max(toNum(bbox.south), toNum(bbox.north));
  const west = Math.min(toNum(bbox.west), toNum(bbox.east));
  const east = Math.max(toNum(bbox.west), toNum(bbox.east));
  return { south, west, north, east };
}

function clampBBoxSpan(rawBBox, maxSpan = 0.14) {
  const bbox = normalizeBBox(rawBBox);
  const centerLat = (bbox.south + bbox.north) / 2;
  const centerLon = (bbox.west + bbox.east) / 2;
  const latSpan = bbox.north - bbox.south;
  const lonSpan = bbox.east - bbox.west;

  const halfLat = Math.min(latSpan / 2, maxSpan / 2);
  const halfLon = Math.min(lonSpan / 2, maxSpan / 2);

  return {
    south: centerLat - halfLat,
    north: centerLat + halfLat,
    west: centerLon - halfLon,
    east: centerLon + halfLon,
  };
}

function reduceBBoxFromAllSides(rawBBox, sideTrimRatio = BBOX_SIDE_TRIM_RATIO) {
  const bbox = normalizeBBox(rawBBox);
  const ratio = Math.max(0, Math.min(0.35, sideTrimRatio));

  const latSpan = Math.max(1e-6, bbox.north - bbox.south);
  const lonSpan = Math.max(1e-6, bbox.east - bbox.west);
  const trimLat = latSpan * ratio;
  const trimLon = lonSpan * ratio;

  const reduced = {
    south: bbox.south + trimLat,
    north: bbox.north - trimLat,
    west: bbox.west + trimLon,
    east: bbox.east - trimLon,
  };

  // Guard against degenerate boxes for very small candidate places.
  if (reduced.south >= reduced.north || reduced.west >= reduced.east) {
    return bbox;
  }

  return reduced;
}

function buildOverpassQuery({ south, west, north, east }) {
  return `
[out:json][timeout:90];
(
  way["highway"]["area"!="yes"]["highway"~"${HIGHWAY_INCLUDE_REGEX}"]["highway"!~"${NON_DRIVEABLE_HIGHWAY_REGEX}"](${south},${west},${north},${east});
  node["highway"="traffic_signals"](${south},${west},${north},${east});
  relation["type"="restriction"](${south},${west},${north},${east});
);
out body;
>;
out skel qt;
`;
}

function getAreaIdFromPlace(place) {
  const osmType = String(place?.osm_type || '').toLowerCase();
  const osmId = Number(place?.osm_id);
  if (!Number.isFinite(osmId) || osmId <= 0) return null;
  if (osmType === 'relation') return 3600000000 + osmId;
  if (osmType === 'way') return 2400000000 + osmId;
  return null;
}

function buildAreaOverpassQuery(areaId) {
  return `
[out:json][timeout:120];
area(${areaId})->.searchArea;
(
  way(area.searchArea)["highway"]["area"!="yes"]["highway"~"${HIGHWAY_INCLUDE_REGEX}"]["highway"!~"${NON_DRIVEABLE_HIGHWAY_REGEX}"];
  node(area.searchArea)["highway"="traffic_signals"];
  relation(area.searchArea)["type"="restriction"];
);
out body;
>;
out skel qt;
`;
}

function splitBBoxIntoTiles(bbox) {
  const n = normalizeBBox(bbox);
  const latSpan = n.north - n.south;
  const lonSpan = n.east - n.west;

  let rows = 1;
  let cols = 1;
  if (latSpan > 0.2 || lonSpan > 0.2) {
    rows = 3;
    cols = 3;
  } else if (latSpan > 0.08 || lonSpan > 0.08) {
    rows = 2;
    cols = 2;
  }

  const dLat = latSpan / rows;
  const dLon = lonSpan / cols;
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const south = n.south + r * dLat;
      const north = r === rows - 1 ? n.north : n.south + (r + 1) * dLat;
      const west = n.west + c * dLon;
      const east = c === cols - 1 ? n.east : n.west + (c + 1) * dLon;
      tiles.push({ south, west, north, east, tileId: `${r}-${c}` });
    }
  }
  return tiles;
}

async function postOverpass(url, query, timeoutMs = OVERPASS_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(`Overpass request failed with status ${res.status}`);
  }
  return res.json();
}

async function fetchQueryWithFallback(query, context, onProgress) {
  let lastErr = null;

  for (const baseUrl of OVERPASS_URLS) {
    for (let attempt = 0; attempt < 1; attempt++) {
      onProgress?.({ phase: 'attempt', endpoint: baseUrl, attempt: attempt + 1, context });
      try {
        return await postOverpass(baseUrl, query);
      } catch (err) {
        const msg = err?.name === 'AbortError'
          ? `Overpass tile timed out after ${Math.round(OVERPASS_REQUEST_TIMEOUT_MS / 1000)}s`
          : (err?.message || 'Unknown Overpass error');
        lastErr = new Error(msg);
      }
    }
  }

  throw lastErr || new Error('All Overpass endpoints failed');
}

async function fetchTileWithFallback(tileBBox, onProgress) {
  const query = buildOverpassQuery(tileBBox);
  return fetchQueryWithFallback(query, { tileId: tileBBox.tileId }, onProgress);
}

function mergeOverpassPayloads(payloads) {
  const byId = new Map();

  for (const p of payloads) {
    const elements = p?.elements || [];
    for (const el of elements) {
      const key = `${el.type}:${el.id}`;
      if (!byId.has(key)) byId.set(key, el);
    }
  }

  return {
    elements: Array.from(byId.values()),
  };
}

function trimOverpassPayloadToBudget(payload, maxElements = OVERPASS_MAX_ELEMENTS) {
  const elements = payload?.elements || [];
  if (elements.length <= maxElements) {
    return { payload, trimmed: false, originalCount: elements.length, finalCount: elements.length };
  }

  const nodes = [];
  const ways = [];
  const relations = [];

  for (const el of elements) {
    if (el.type === 'node') nodes.push(el);
    else if (el.type === 'way') ways.push(el);
    else if (el.type === 'relation') relations.push(el);
  }

  const sortedWays = ways
    .slice()
    .sort((a, b) => {
      const pa = HIGHWAY_PRIORITY[a.tags?.highway] || 0;
      const pb = HIGHWAY_PRIORITY[b.tags?.highway] || 0;
      if (pb !== pa) return pb - pa;
      return (b.nodes?.length || 0) - (a.nodes?.length || 0);
    });

  const keptWays = [];
  const referencedNodeIds = new Set();

  const relationBudget = Math.min(relations.length, Math.max(500, Math.floor(maxElements * 0.03)));
  const reservedForRelations = relationBudget;
  const reservedForSignals = Math.max(1500, Math.floor(maxElements * 0.07));
  const wayAndNodeBudget = Math.max(0, maxElements - reservedForRelations - reservedForSignals);

  let consumedByWaysAndRefs = 0;
  for (const w of sortedWays) {
    const nodeCount = w.nodes?.length || 0;
    const newRefs = (w.nodes || []).reduce((acc, id) => acc + (referencedNodeIds.has(id) ? 0 : 1), 0);
    const incrementalCost = 1 + newRefs;
    if (consumedByWaysAndRefs + incrementalCost > wayAndNodeBudget) continue;

    keptWays.push(w);
    consumedByWaysAndRefs += 1;
    for (const nid of w.nodes || []) {
      if (!referencedNodeIds.has(nid)) {
        referencedNodeIds.add(nid);
        consumedByWaysAndRefs += 1;
      }
    }

    if (keptWays.length >= ways.length) break;
    if (consumedByWaysAndRefs >= wayAndNodeBudget) break;
  }

  const keptNodeMap = new Map();
  for (const n of nodes) {
    if (referencedNodeIds.has(n.id)) keptNodeMap.set(n.id, n);
  }

  // Keep some explicit traffic signal nodes as hints even if not in selected references.
  let signalAdded = 0;
  for (const n of nodes) {
    if (signalAdded >= reservedForSignals) break;
    if (n.tags?.highway !== 'traffic_signals') continue;
    if (!keptNodeMap.has(n.id)) {
      keptNodeMap.set(n.id, n);
      signalAdded += 1;
    }
  }

  const keptRelations = relations.slice(0, relationBudget);
  const trimmedElements = [
    ...Array.from(keptNodeMap.values()),
    ...keptWays,
    ...keptRelations,
  ];

  return {
    payload: {
      ...payload,
      elements: trimmedElements,
    },
    trimmed: true,
    originalCount: elements.length,
    finalCount: trimmedElements.length,
  };
}

function placeRank(place) {
  const osmType = String(place?.osm_type || '').toLowerCase();
  const addresstype = String(place?.addresstype || '').toLowerCase();
  const type = String(place?.type || '').toLowerCase();
  const display = String(place?.display_name || '').toLowerCase();

  let score = 0;
  if (osmType === 'relation') score += 20;
  if (addresstype.includes('city') || addresstype.includes('municipality')) score += 10;
  if (type.includes('city') || type.includes('administrative')) score += 10;
  if (display.includes('india')) score += 1;

  return score;
}

export async function searchAddressCandidates(query, limit = 5) {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Nominatim request failed with status ${res.status}`);
  }

  const data = await res.json();
  const list = Array.isArray(data) ? data : [];
  return list
    .slice()
    .sort((a, b) => placeRank(b) - placeRank(a))
    .slice(0, limit);
}

export function getBBoxFromPlace(place) {
  const bb = place?.boundingbox || [];
  if (bb.length === 4) {
    const south = toNum(bb[0]);
    const north = toNum(bb[1]);
    const west = toNum(bb[2]);
    const east = toNum(bb[3]);
    const reduced = reduceBBoxFromAllSides({ south, west, north, east }, BBOX_SIDE_TRIM_RATIO);
    return clampBBoxSpan(reduced, BBOX_MAX_SPAN);
  }

  const lat = Number(place?.lat || 0);
  const lon = Number(place?.lon || 0);
  const delta = 0.01;
  const fallback = normalizeBBox({
    south: lat - delta,
    north: lat + delta,
    west: lon - delta,
    east: lon + delta,
  });
  const reduced = reduceBBoxFromAllSides(fallback, BBOX_SIDE_TRIM_RATIO);
  return clampBBoxSpan(reduced, BBOX_MAX_SPAN);
}

export async function fetchMajorRoadNetwork(bbox, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const place = options.place || null;
  const startedAt = Date.now();

  const exceededDeadline = () => (Date.now() - startedAt) > OVERPASS_MAX_TOTAL_FETCH_MS;

  const normalized = normalizeBBox(bbox);

  const areaId = getAreaIdFromPlace(place);
  if (areaId) {
    onProgress?.({ phase: 'area-start', areaId });
    try {
      const areaQuery = buildAreaOverpassQuery(areaId);
      const payload = await fetchQueryWithFallback(areaQuery, { mode: 'area', areaId }, onProgress);
      const trimmedResult = trimOverpassPayloadToBudget(payload, OVERPASS_MAX_ELEMENTS);
      const finalPayload = trimmedResult.payload;
      finalPayload.__meta = {
        mode: 'area',
        areaId,
        tileCount: 1,
        successCount: 1,
        failedCount: 0,
        failedTiles: [],
        trimmedByBudget: trimmedResult.trimmed,
        originalElementCount: trimmedResult.originalCount,
        finalElementCount: trimmedResult.finalCount,
        elementBudget: OVERPASS_MAX_ELEMENTS,
      };
      if (trimmedResult.trimmed) {
        onProgress?.({
          phase: 'tile-budget-cutoff',
          index: 1,
          total: 1,
          tileId: 'area',
          cumulativeElements: trimmedResult.originalCount,
          budget: OVERPASS_MAX_ELEMENTS,
        });
      }
      onProgress?.({ phase: 'area-success', areaId });
      return finalPayload;
    } catch (error) {
      onProgress?.({ phase: 'area-failed', areaId, error: error.message });
      if (exceededDeadline()) {
        throw new Error('OSM fetch timed out while querying city transport area');
      }
    }
  }

  const tiles = splitBBoxIntoTiles(normalized);
  const payloads = [];
  const failedTiles = [];
  let cumulativeElements = 0;
  let cutOffByBudget = false;

  for (let i = 0; i < tiles.length; i++) {
    if (exceededDeadline()) {
      break;
    }
    const tile = tiles[i];
    onProgress?.({ phase: 'tile-start', index: i + 1, total: tiles.length, tileId: tile.tileId });
    try {
      // Sequential tile fetch keeps Overpass rate within safer limits.
      const payload = await fetchTileWithFallback(tile, onProgress);
      const elementCount = payload?.elements?.length || 0;
      cumulativeElements += elementCount;
      payloads.push(payload);
      onProgress?.({ phase: 'tile-success', index: i + 1, total: tiles.length, tileId: tile.tileId });

      if (cumulativeElements >= OVERPASS_MAX_ELEMENTS) {
        cutOffByBudget = true;
        onProgress?.({
          phase: 'tile-budget-cutoff',
          index: i + 1,
          total: tiles.length,
          tileId: tile.tileId,
          cumulativeElements,
          budget: OVERPASS_MAX_ELEMENTS,
        });
        break;
      }
    } catch (error) {
      failedTiles.push({ tileId: tile.tileId, error: error.message });
      onProgress?.({ phase: 'tile-failed', index: i + 1, total: tiles.length, tileId: tile.tileId, error: error.message });
    }
  }

  if (!payloads.length) {
    if (exceededDeadline()) {
      throw new Error('OSM fetch timed out before any tile could be imported');
    }
    throw new Error('Overpass tiled fetch failed for all tiles');
  }

  const merged = mergeOverpassPayloads(payloads);
  const trimmedMerged = trimOverpassPayloadToBudget(merged, OVERPASS_MAX_ELEMENTS);
  const finalMerged = trimmedMerged.payload;

  finalMerged.__meta = {
    mode: 'bbox-tiles',
    tileCount: tiles.length,
    successCount: payloads.length,
    failedCount: failedTiles.length,
    failedTiles,
    cumulativeElements,
    elementBudget: OVERPASS_MAX_ELEMENTS,
    cutOffByBudget,
    trimmedByBudget: trimmedMerged.trimmed,
    originalElementCount: trimmedMerged.originalCount,
    finalElementCount: trimmedMerged.finalCount,
  };
  return finalMerged;
}

export function summarizePlaceResult(place) {
  return {
    osmId: place?.osm_id,
    osmType: place?.osm_type,
    displayName: place?.display_name,
    lat: Number(place?.lat || 0),
    lon: Number(place?.lon || 0),
    boundingbox: place?.boundingbox || [],
  };
}

export function summarizeOverpassResult(payload) {
  const elements = payload?.elements || [];
  let nodeCount = 0;
  let wayCount = 0;
  let relationCount = 0;
  let trafficSignalNodeCount = 0;
  const highwayClassCounts = {};

  for (const el of elements) {
    if (el.type === 'node') nodeCount += 1;
    if (el.type === 'way') {
      wayCount += 1;
      const klass = el.tags?.highway || 'unknown';
      highwayClassCounts[klass] = (highwayClassCounts[klass] || 0) + 1;
    }
    if (el.type === 'relation') {
      relationCount += 1;
      if (el.tags?.type === 'restriction') {
        // Included in relationCount; leave here for clarity if needed later.
      }
    }
    if (el.type === 'node' && el.tags?.highway === 'traffic_signals') {
      trafficSignalNodeCount += 1;
    }
  }

  return {
    elementCount: elements.length,
    nodeCount,
    wayCount,
    relationCount,
    trafficSignalNodeCount,
    highwayClassCounts,
    fetchMeta: payload?.__meta || null,
  };
}

export function explainNominatimShape(sample) {
  if (!sample) return null;
  return {
    service: 'Nominatim search',
    keyFields: {
      display_name: 'Human-readable place string shown to user.',
      lat: 'Center latitude of selected place candidate.',
      lon: 'Center longitude of selected place candidate.',
      boundingbox: 'Area used for Overpass road-network fetch.',
      osm_type: 'OSM element type of matched place (node/way/relation).',
      osm_id: 'OSM element id of matched place.',
    },
    sample: summarizePlaceResult(sample),
  };
}

export function explainOverpassShape(samplePayload) {
  const elements = samplePayload?.elements || [];
  const sampleNode = elements.find((e) => e.type === 'node') || null;
  const sampleWay = elements.find((e) => e.type === 'way') || null;
  const sampleRestriction = elements.find((e) => e.type === 'relation' && e.tags?.type === 'restriction') || null;

  return {
    service: 'Overpass road-network fetch',
    keyFields: {
      elements: 'Heterogeneous array containing node/way/relation objects.',
      'node.lat/lon': 'Geographic coordinates used for map plotting and grid projection.',
      'way.nodes': 'Ordered node id list defining road polyline geometry.',
      'way.tags.highway': 'Road class used for speed/lane/departure inference.',
      'way.tags.oneway': 'Directionality hint used for one-way weighting.',
      'node.tags.highway=traffic_signals': 'Signal presence hint near intersections.',
      'relation.tags.type=restriction': 'Turn restriction metadata when available.',
    },
    sampleElements: {
      node: sampleNode,
      way: sampleWay,
      restrictionRelation: sampleRestriction,
    },
  };
}
