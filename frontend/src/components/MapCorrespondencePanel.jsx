import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useSimStore } from '../store/useSimStore.js';
import styles from './MapCorrespondencePanel.module.css';

// Custom Node Component for ReactFlow
const IntersectionNode = ({ data }) => {
  const isCluster = data.clusterSize > 1;
  const isBoundary = data.isBoundary;
  const size = data.isHighlighted ? 14 : (isCluster ? 10 : 6.4);

  let bgColor = "#22d3ee";
  let borderColor = "#67e8f9";

  if (data.isHighlighted) {
    bgColor = "#ef4444";
    borderColor = "#ef4444";
  } else if (isBoundary) {
    bgColor = "#facc15"; // Bright Yellow for boundary
    borderColor = "#eab308";
  }

  return (
    <div
      className={styles.rfNode}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bgColor,
        border: `1.2px solid ${borderColor}`,
        opacity: 0.92,
        transition: 'all 0.15s ease',
        transform: 'translate(-50%, -50%)',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {isCluster && !data.isHighlighted && (
        <span style={{
          fontSize: '6px',
          color: '#fff',
          fontWeight: 'bold',
          pointerEvents: 'none'
        }}>
          {data.clusterSize}
        </span>
      )}
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
    </div>
  );
};

const nodeTypes = {
  intersection: IntersectionNode,
};

function bboxToBounds(bbox) {
  if (!bbox) return null;
  return [
    [bbox.south, bbox.west],
    [bbox.north, bbox.east],
  ];
}

function approxMeters(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111320;
  const meanLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * 111320 * Math.cos(meanLat);
  return Math.hypot(dLat, dLon);
}

export default function MapCorrespondencePanel() {
  const importedMeta = useSimStore((s) => s.importedScenarioMeta);
  const mapPreview = useSimStore((s) => s.mapPreview);
  const roadOverrides = useSimStore((s) => s.roadOverrides);
  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const layerGroupRef = useRef(null);
  const drawTokenRef = useRef(0);
  const leafMarkersRef = useRef(new Map());
  const lastBoundsRef = useRef(null);

  const [highlightedNode, setHighlightedNode] = useState(null);
  const [boundaryOverrides, setBoundaryOverrides] = useState({}); // { gridKey: boolean }

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const center = useMemo(() => {
    if (importedMeta?.center) return importedMeta.center;
    if (mapPreview?.center) return mapPreview.center;
    return [28.6139, 77.209];
  }, [importedMeta, mapPreview]);

  const placeName = importedMeta?.placeName || mapPreview?.placeName || 'No place imported yet';
  const roads = importedMeta?.roads || mapPreview?.roads || [];
  const markers = importedMeta?.markers || mapPreview?.markers || [];
  const graphEdges = importedMeta?.graphEdges || mapPreview?.graphEdges || [];
  const bounds = bboxToBounds(importedMeta?.bbox || mapPreview?.bbox);

  const graphData = useMemo(() => {
    if (!markers.length) {
      return {
        width: 720,
        height: 380,
        edges: [],
        nodes: [],
        markers: [],
        roads: [],
        stats: {
          roadEdgeCount: 0,
          mappedIntersectionCount: 0,
          componentIntersectionCount: 0,
          largestComponentSize: 0,
          componentCount: 0,
          graphBounds: null,
        },
      };
    }

    const nodeMap = new Map();
    for (const m of markers) {
      const signedRow = Number.isFinite(m.displayRow) ? m.displayRow : m.row;
      const signedCol = Number.isFinite(m.displayCol) ? m.displayCol : m.col;
      nodeMap.set(`${m.row},${m.col}`, {
        ...m,
        signedRow,
        signedCol,
      });
    }

    const allRows = Array.from(nodeMap.values()).map((n) => n.signedRow);
    const allCols = Array.from(nodeMap.values()).map((n) => n.signedCol);
    const minRow = Math.min(...allRows);
    const maxRow = Math.max(...allRows);
    const minCol = Math.min(...allCols);
    const maxCol = Math.max(...allCols);

    const width = 720;
    const height = 380;
    const padX = 42;
    const padY = 28;
    const spanCol = Math.max(1, maxCol - minCol);
    const spanRow = Math.max(1, maxRow - minRow);

    const toCanvasX = (col) => padX + (((col - minCol) / spanCol) * (width - (2 * padX)));
    const toCanvasY = (row) => padY + (((maxRow - row) / spanRow) * (height - (2 * padY)));

    const parsedEdges = [];
    const seenEdgeKeys = new Set();

    // Prefer explicit graph edges built by parser; they preserve true mapped connectivity.
    for (const e of graphEdges) {
      const fromKey = e?.fromGridKey;
      const toKey = e?.toGridKey;
      if (!fromKey || !toKey) continue;

      const fromNode = nodeMap.get(fromKey);
      const toNode = nodeMap.get(toKey);
      if (!fromNode || !toNode) continue;

      const edgeKey = fromKey < toKey ? `${fromKey}<->${toKey}` : `${toKey}<->${fromKey}`;
      if (seenEdgeKeys.has(edgeKey)) continue;
      seenEdgeKeys.add(edgeKey);

      parsedEdges.push({
        key: edgeKey,
        fromKey,
        toKey,
        x1: toCanvasX(fromNode.signedCol),
        y1: toCanvasY(fromNode.signedRow),
        x2: toCanvasX(toNode.signedCol),
        y2: toCanvasY(toNode.signedRow),
      });
    }

    // Backward-compatible fallback for imports without explicit graphEdges metadata.
    if (!parsedEdges.length) {
      for (const road of roads) {
        const fromKey = road?.fromGrid?.gridKey;
        const toKey = road?.toGrid?.gridKey;
        if (!fromKey || !toKey) continue;

        const fromNode = nodeMap.get(fromKey);
        const toNode = nodeMap.get(toKey);
        if (!fromNode || !toNode) continue;

        const edgeKey = fromKey < toKey ? `${fromKey}<->${toKey}` : `${toKey}<->${fromKey}`;
        if (seenEdgeKeys.has(edgeKey)) continue;
        seenEdgeKeys.add(edgeKey);

        parsedEdges.push({
          key: edgeKey,
          fromKey,
          toKey,
          x1: toCanvasX(fromNode.signedCol),
          y1: toCanvasY(fromNode.signedRow),
          x2: toCanvasX(toNode.signedCol),
          y2: toCanvasY(toNode.signedRow),
        });
      }
    }

    // Final fallback: infer links by snapping road segment endpoints to nearest mapped intersections.
    if (!parsedEdges.length && markers.length) {
      const markerList = Array.from(nodeMap.values());

      const nearestMarkerKey = (lat, lon, maxMeters = 180) => {
        let bestKey = null;
        let bestDist = Infinity;
        for (const n of markerList) {
          const d = approxMeters(lat, lon, n.lat, n.lon);
          if (d < bestDist) {
            bestDist = d;
            bestKey = n.gridKey;
          }
        }
        return bestDist <= maxMeters ? bestKey : null;
      };

      for (const road of roads) {
        const coords = road?.coords;
        if (!Array.isArray(coords) || coords.length < 2) continue;

        const [aLat, aLon] = coords[0] || [];
        const [bLat, bLon] = coords[coords.length - 1] || [];
        if (![aLat, aLon, bLat, bLon].every(Number.isFinite)) continue;

        const fromKey = nearestMarkerKey(aLat, aLon);
        const toKey = nearestMarkerKey(bLat, bLon);
        if (!fromKey || !toKey || fromKey === toKey) continue;

        const fromNode = nodeMap.get(fromKey);
        const toNode = nodeMap.get(toKey);
        if (!fromNode || !toNode) continue;

        const edgeKey = fromKey < toKey ? `${fromKey}<->${toKey}` : `${toKey}<->${fromKey}`;
        if (seenEdgeKeys.has(edgeKey)) continue;
        seenEdgeKeys.add(edgeKey);

        parsedEdges.push({
          key: edgeKey,
          fromKey,
          toKey,
          x1: toCanvasX(fromNode.signedCol),
          y1: toCanvasY(fromNode.signedRow),
          x2: toCanvasX(toNode.signedCol),
          y2: toCanvasY(toNode.signedRow),
        });
      }
    }

    // Fallback: if imported roads are unavailable, use simulator override edges.
    if (!parsedEdges.length) {
      const edgeEntries = Object.entries(roadOverrides || {});
      for (const [edgeKey] of edgeEntries) {
        const parts = edgeKey.split('->');
        if (parts.length !== 2) continue;
        const [fromRaw, toRaw] = parts;
        const fromNode = nodeMap.get(fromRaw);
        const toNode = nodeMap.get(toRaw);
        if (!fromNode || !toNode) continue;

        parsedEdges.push({
          key: edgeKey,
          x1: toCanvasX(fromNode.signedCol),
          y1: toCanvasY(fromNode.signedRow),
          x2: toCanvasX(toNode.signedCol),
          y2: toCanvasY(toNode.signedRow),
        });
      }
    }

    const nodes = Array.from(nodeMap.values()).map((n) => ({
      ...n,
      x: toCanvasX(n.signedCol),
      y: toCanvasY(n.signedRow),
    }));

    // Keep only sufficiently large connected components to remove isolated fragments.
    const adjacency = new Map();
    for (const n of nodes) adjacency.set(n.gridKey, new Set());
    for (const e of parsedEdges) {
      const fromKey = e.fromKey;
      const toKey = e.toKey;
      if (!adjacency.has(fromKey) || !adjacency.has(toKey)) continue;
      adjacency.get(fromKey).add(toKey);
      adjacency.get(toKey).add(fromKey);
    }

    const components = [];
    const visited = new Set();
    for (const key of adjacency.keys()) {
      if (visited.has(key)) continue;
      const queue = [key];
      const component = new Set([key]);
      visited.add(key);

      while (queue.length) {
        const cur = queue.shift();
        for (const nxt of adjacency.get(cur) || []) {
          if (visited.has(nxt)) continue;
          visited.add(nxt);
          component.add(nxt);
          queue.push(nxt);
        }
      }

      components.push(component);
    }

    components.sort((a, b) => b.size - a.size);
    const largestComponent = components[0] || new Set();
    const minComponentSize = Math.max(6, Math.round(nodes.length * 0.04));

    let componentKeys = new Set();
    for (const comp of components) {
      if (comp.size >= minComponentSize) {
        for (const k of comp) componentKeys.add(k);
      }
    }

    // If component detection is unexpectedly too sparse, avoid collapsing to tiny artifacts.
    if (!componentKeys.size) {
      if (nodes.length >= 50 && largestComponent.size < minComponentSize) {
        componentKeys = new Set(nodes.map((n) => n.gridKey));
      } else if (largestComponent.size) {
        componentKeys = largestComponent;
      }
    }

    if (!componentKeys.size) {
      componentKeys = new Set(nodes.map((n) => n.gridKey));
    }

    const filteredNodes = nodes.filter((n) => componentKeys.has(n.gridKey));
    const filteredEdges = parsedEdges.filter((e) => {
      const fromKey = e.fromKey ?? String(e.key).split('->')[0];
      const toKey = e.toKey ?? String(e.key).split('->')[1];
      return componentKeys.has(fromKey) && componentKeys.has(toKey);
    });
    const filteredMarkers = markers.filter((m) => componentKeys.has(m.gridKey));
    const filteredRoads = roads.filter((r) => {
      const fromKey = r?.fromGrid?.gridKey;
      const toKey = r?.toGrid?.gridKey;
      return Boolean(fromKey && toKey && componentKeys.has(fromKey) && componentKeys.has(toKey));
    });

    // =====================================================
    // CLUSTERING: Merge intersections within 150m
    // =====================================================
    const CLUSTER_THRESHOLD_METERS = 150;

    // Use index-based Union-Find for better reliability
    const parent = filteredNodes.map((_, i) => i);

    function find(i) {
      if (parent[i] === i) return i;
      parent[i] = find(parent[i]);
      return parent[i];
    }

    function union(i, j) {
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) parent[rootI] = rootJ;
    }

    // Pairwise comparison for clustering
    for (let i = 0; i < filteredNodes.length; i++) {
      const n1 = filteredNodes[i];
      const lat1 = Number(n1.lat);
      const lon1 = Number(n1.lon);

      for (let j = i + 1; j < filteredNodes.length; j++) {
        const n2 = filteredNodes[j];
        const lat2 = Number(n2.lat);
        const lon2 = Number(n2.lon);

        if (approxMeters(lat1, lon1, lat2, lon2) < CLUSTER_THRESHOLD_METERS) {
          union(i, j);
        }
      }
    }

    const clusters = new Map(); // rootIndex -> cluster data
    filteredNodes.forEach((n, idx) => {
      const rootIdx = find(idx);
      if (!clusters.has(rootIdx)) {
        clusters.set(rootIdx, {
          members: [],
          lat: 0, lon: 0,
          signedRow: 0, signedCol: 0,
          x: 0, y: 0,
          mapIds: [],
        });
      }
      const c = clusters.get(rootIdx);
      c.members.push(n);
      c.lat += Number(n.lat);
      c.lon += Number(n.lon);
      c.signedRow += Number(n.signedRow);
      c.signedCol += Number(n.signedCol);
      c.x += Number(n.x);
      c.y += Number(n.y);
      if (n.mapId) c.mapIds.push(n.mapId);
    });

    // Pre-calculate geographic boundaries from data
    const allLats = filteredNodes.map(n => Number(n.lat));
    const allLons = filteredNodes.map(n => Number(n.lon));
    const gMinLat = Math.min(...allLats);
    const gMaxLat = Math.max(...allLats);
    const gMinLon = Math.min(...allLons);
    const gMaxLon = Math.max(...allLons);

    // OPTIMIZATION: Search for the angle that maximizes the number of boundary nodes
    const findOptimalRotation = () => {
      const angles = [0, 5, 10, 15, 20, 25, 30, 35, 40, -5, -10, -15, -20, -25, -30, -35, -40];
      let bestAngle = 0;
      let maxCount = 0;

      const latRange = gMaxLat - gMinLat;
      const lonRange = gMaxLon - gMinLon;
      const tol = Math.max(latRange, lonRange) * 0.035;

      angles.forEach(angle => {
        const rad = (angle * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        let minR = Infinity, maxR = -Infinity, minI = Infinity, maxI = -Infinity;
        const projected = filteredNodes.map(n => {
          const r = n.lat * cos + n.lon * sin;
          const i = -n.lat * sin + n.lon * cos;
          if (r < minR) minR = r; if (r > maxR) maxR = r;
          if (i < minI) minI = i; if (i > maxI) maxI = i;
          return { r, i };
        });

        let count = 0;
        projected.forEach(p => {
          if (Math.abs(p.r - minR) < tol || Math.abs(p.r - maxR) < tol ||
            Math.abs(p.i - minI) < tol || Math.abs(p.i - maxI) < tol) {
            count++;
          }
        });

        if (count > maxCount) {
          maxCount = count;
          bestAngle = angle;
        }
      });
      return bestAngle;
    };

    const bestAngle = findOptimalRotation();
    const rad = (bestAngle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    let minR = Infinity, maxR = -Infinity, minI = Infinity, maxI = -Infinity;
    filteredNodes.forEach(n => {
      const r = n.lat * cos + n.lon * sin;
      const i = -n.lat * sin + n.lon * cos;
      if (r < minR) minR = r; if (r > maxR) maxR = r;
      if (i < minI) minI = i; if (i > maxI) maxI = i;
    });

    const clusteredNodes = [];
    clusters.forEach((c, rootIdx) => {
      const count = c.members.length;
      const rootNode = filteredNodes[rootIdx];
      const avgLat = c.lat / count;
      const avgLon = c.lon / count;
      const avgRow = c.signedRow / count;
      const avgCol = c.signedCol / count;

      // Rotated boundary check
      const r = avgLat * cos + avgLon * sin;
      const i = -avgLat * sin + avgLon * cos;
      const latRange = gMaxLat - gMinLat;
      const lonRange = gMaxLon - gMinLon;
      const tol = Math.max(latRange, lonRange) * 0.035; // 3.5% tolerance

      let isBoundary = (
        Math.abs(r - minR) < tol || Math.abs(r - maxR) < tol ||
        Math.abs(i - minI) < tol || Math.abs(i - maxI) < tol
      );

      // Fallback for extreme grid points
      if (!isBoundary) {
        isBoundary = (
          Math.abs(avgRow - minRow) < 1.0 ||
          Math.abs(avgRow - maxRow) < 1.0 ||
          Math.abs(avgCol - minCol) < 1.0 ||
          Math.abs(avgCol - maxCol) < 1.0
        );
      }

      clusteredNodes.push({
        ...c.members[0], // base properties
        gridKey: rootNode.gridKey,
        lat: avgLat,
        lon: avgLon,
        signedRow: avgRow,
        signedCol: avgCol,
        x: c.x / count,
        y: c.y / count,
        isCluster: count > 1,
        clusterSize: count,
        isBoundary,
        mapId: Array.from(new Set(c.mapIds)).join(', '),
      });
    });

    // Create a mapping from original gridKey to cluster gridKey for updating edges/roads
    const originalToClusterKey = new Map();
    filteredNodes.forEach((n, idx) => {
      const rootIdx = find(idx);
      const rootNode = filteredNodes[rootIdx];
      originalToClusterKey.set(n.gridKey, rootNode.gridKey);
    });

    // Update edges to use cluster representatives
    const clusteredEdges = [];
    const seenClusteredEdgeKeys = new Set();
    filteredEdges.forEach(e => {
      const u = originalToClusterKey.get(e.fromKey ?? String(e.key).split('->')[0]);
      const v = originalToClusterKey.get(e.toKey ?? String(e.key).split('->')[1]);
      if (!u || !v || u === v) return; // ignore self-loops within cluster

      const edgeKey = u < v ? `${u}<->${v}` : `${v}<->${u}`;
      if (seenClusteredEdgeKeys.has(edgeKey)) return;
      seenClusteredEdgeKeys.add(edgeKey);

      const uNode = clusteredNodes.find(n => n.gridKey === u);
      const vNode = clusteredNodes.find(n => n.gridKey === v);
      if (!uNode || !vNode) return;

      clusteredEdges.push({
        key: edgeKey,
        fromKey: u,
        toKey: v,
        x1: uNode.x,
        y1: uNode.y,
        x2: vNode.x,
        y2: vNode.y,
      });
    });


    // Update roads for Leaflet: snap ends to cluster centers and deduplicate
    const clusteredRoads = [];
    const seenRoadKeys = new Set();

    filteredRoads.forEach(r => {
      const fromKey = r?.fromGrid?.gridKey;
      const toKey = r?.toGrid?.gridKey;
      if (!fromKey || !toKey) return;

      const u = find(fromKey);
      const v = find(toKey);
      if (u === v) return; // ignore roads internal to a cluster

      // Deduplicate roads between the same clusters
      const roadKey = u < v ? `${u}<->${v}` : `${v}<->${u}`;
      if (seenRoadKeys.has(roadKey)) return;
      seenRoadKeys.add(roadKey);

      const uNode = clusteredNodes.find(n => n.gridKey === u);
      const vNode = clusteredNodes.find(n => n.gridKey === v);
      if (!uNode || !vNode) return;

      // Create new coordinates: start at u center, keep middle, end at v center
      const newCoords = [...r.coords];
      newCoords[0] = [uNode.lat, uNode.lon];
      newCoords[newCoords.length - 1] = [vNode.lat, vNode.lon];

      clusteredRoads.push({
        ...r,
        fromGrid: { ...r.fromGrid, gridKey: u },
        toGrid: { ...r.toGrid, gridKey: v },
        coords: newCoords,
      });
    });

    // Final Refinement and Pruning:
    // 0. Calculate degrees for clustering
    const nodeDegree = new Map();
    clusteredNodes.forEach(n => nodeDegree.set(n.gridKey, 0));
    clusteredEdges.forEach(e => {
      nodeDegree.set(e.fromKey, (nodeDegree.get(e.fromKey) || 0) + 1);
      nodeDegree.set(e.toKey, (nodeDegree.get(e.toKey) || 0) + 1);
    });

    // 1. Identify "surrounded" degree-1 nodes (internal dead-ends) and drop them.
    const nodesToDrop = new Set();
    const surroundRadius = 0.02; // ~2.2km

    clusteredNodes.forEach(n => {
      const degree = nodeDegree.get(n.gridKey) || 0;
      if (degree === 1) {
        // Use 8 directions for a much more robust "surrounded" check
        let sectors = new Array(8).fill(false);
        clusteredNodes.forEach(other => {
          if (n.gridKey === other.gridKey) return;
          const dLat = other.lat - n.lat;
          const dLon = other.lon - n.lon;
          const dist = Math.sqrt(dLat * dLat + dLon * dLon);
          
          if (dist < surroundRadius) {
            const angle = Math.atan2(dLat, dLon) * (180 / Math.PI);
            // Map angle to 8 sectors (0-7)
            let sectorIdx = Math.floor(((angle + 180 + 22.5) % 360) / 45);
            sectors[sectorIdx] = true;
          }
        });

        // If surrounded in at least 6 out of 8 directions, it's internal
        const occupiedSectors = sectors.filter(s => s).length;
        if (occupiedSectors >= 6) {
          // IMPORTANT: If user manually forced it to be a boundary, don't drop it!
          if (boundaryOverrides[n.gridKey] !== true) {
            nodesToDrop.add(n.gridKey);
          }
        }
      }
    });

    // 2. Filter nodes and edges to remove dropped dead-ends
    const finalNodes = clusteredNodes.filter(n => !nodesToDrop.has(n.gridKey));
    const finalEdges = clusteredEdges.filter(e => !nodesToDrop.has(e.fromKey) && !nodesToDrop.has(e.toKey));
    const finalRoads = clusteredRoads.filter(r => {
      const u = find(r.fromGrid?.gridKey);
      const v = find(r.toGrid?.gridKey);
      return !nodesToDrop.has(u) && !nodesToDrop.has(v);
    });

    // 3. Final Boundary classification for remaining nodes
    finalNodes.forEach(n => {
      const degree = finalEdges.filter(e => e.fromKey === n.gridKey || e.toKey === n.gridKey).length;
      
      // Automatic detection
      let autoBoundary = (degree === 1);
      if (!autoBoundary && n.isBoundary && degree < 3) {
        autoBoundary = true;
      }

      // Apply manual overrides if present
      if (boundaryOverrides[n.gridKey] !== undefined) {
        n.isBoundary = boundaryOverrides[n.gridKey];
      } else {
        n.isBoundary = autoBoundary;
      }
    });

    const clusteredMarkers = finalNodes.map(n => ({
      gridKey: n.gridKey,
      lat: n.lat,
      lon: n.lon,
      mapId: n.mapId,
      isCluster: n.isCluster,
      clusterSize: n.clusterSize,
      isBoundary: n.isBoundary,
    }));

    return {
      width,
      height,
      edges: finalEdges,
      nodes: finalNodes,
      markers: clusteredMarkers,
      roads: finalRoads,
      boundaryOverrides, // Expose for use in effect
      stats: {
        roadEdgeCount: finalEdges.length,
        mappedIntersectionCount: finalNodes.length,
        componentIntersectionCount: componentKeys.size,
        largestComponentSize: largestComponent.size,
        componentCount: components.length,
        graphBounds: { minRow, maxRow, minCol, maxCol },
      },
    };
  }, [markers, roadOverrides, roads, graphEdges, boundaryOverrides]);

  // Sync ReactFlow nodes and edges when graphData changes
  useEffect(() => {
    if (!graphData.nodes.length) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const rfNodes = graphData.nodes.map((n) => ({
      id: n.gridKey,
      type: 'intersection',
      position: { x: n.x, y: n.y },
      data: {
        label: n.mapId,
        isHighlighted: highlightedNode === n.gridKey,
        isCluster: n.isCluster,
        clusterSize: n.clusterSize,
        isBoundary: n.isBoundary
      },
      draggable: true,
    }));

    const rfEdges = graphData.edges.map((e) => ({
      id: e.key,
      source: e.fromKey ?? String(e.key).split('->')[0],
      target: e.toKey ?? String(e.key).split('->')[1],
      style: { stroke: '#9ca3af', strokeWidth: 2, opacity: 0.62 },
      type: 'straight',
    }));

    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [graphData, setNodes, setEdges]);

  // Update node highlight state without resetting positions
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isHighlighted: highlightedNode === node.id,
        },
      }))
    );
  }, [highlightedNode, setNodes]);

  const onNodeClick = useCallback((event, node) => {
    setHighlightedNode(node.id);
  }, []);

  const roadsForDisplay = useMemo(() => {
    const componentRoads = graphData.roads || [];
    const maxRender = 9000;
    if (componentRoads.length <= maxRender) return componentRoads;

    const majorClasses = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
    const priority = componentRoads.filter((r) => r.fromGrid || r.toGrid || majorClasses.has(r.highway));
    if (priority.length >= maxRender) return priority.slice(0, maxRender);

    const remaining = componentRoads.filter((r) => !(r.fromGrid || r.toGrid || majorClasses.has(r.highway)));
    return [...priority, ...remaining.slice(0, Math.max(0, maxRender - priority.length))];
  }, [graphData.roads]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (!leafletMapRef.current) {
      const map = L.map(mapRef.current, {
        center,
        zoom: 13,
        zoomControl: true,
        preferCanvas: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      leafletMapRef.current = map;
      layerGroupRef.current = L.layerGroup().addTo(map);
    }

    const map = leafletMapRef.current;
    const layers = layerGroupRef.current;
    drawTokenRef.current += 1;
    const drawToken = drawTokenRef.current;
    layers.clearLayers();

    // Only fit bounds if the bounds have actually changed (e.g. new import)
    const boundsJson = JSON.stringify(bounds);
    if (boundsJson !== lastBoundsRef.current) {
      lastBoundsRef.current = boundsJson;
      if (bounds) {
        L.rectangle(bounds, { color: '#60a5fa', weight: 1 }).addTo(layers);
        map.fitBounds(bounds, { padding: [20, 20] });
      } else {
        map.setView(center, 13);
      }
    } else if (bounds) {
      // Still draw the rectangle even if not fitting bounds
      L.rectangle(bounds, { color: '#60a5fa', weight: 1 }).addTo(layers);
    }

    const ROAD_BATCH = 450;
    const MARKER_BATCH = 260;

    const drawMarkerBatch = (startIdx) => {
      if (drawTokenRef.current !== drawToken) return;
      const graphMarkers = graphData.markers || [];
      const endIdx = Math.min(startIdx + MARKER_BATCH, graphMarkers.length);

      if (startIdx === 0) {
        leafMarkersRef.current.clear();
      }

      for (let i = startIdx; i < endIdx; i++) {
        const m = graphMarkers[i];
        const isHl = highlightedNode === m.gridKey;
        const isCluster = m.isCluster;
        const isBoundary = m.isBoundary;
        const marker = L.circleMarker([m.lat, m.lon], {
          radius: isHl ? 10 : (isCluster ? 7 : 5),
          color: isHl ? '#ef4444' : (isBoundary ? '#facc15' : '#22d3ee'),
          fillColor: isHl ? '#ef4444' : (isBoundary ? '#facc15' : '#22d3ee'),
          weight: isCluster || isBoundary ? 3 : 2,
          fillOpacity: 0.7,
        });
        // Add a popup with a toggle button
        const popupContent = document.createElement('div');
        popupContent.innerHTML = `
          <div style="font-family: sans-serif; min-width: 140px; padding: 4px;">
            <div style="font-weight: bold; margin-bottom: 6px; border-bottom: 1px solid #eee; padding-bottom: 4px;">
              ${m.mapId || 'Unnamed Node'}
            </div>
            <div style="font-size: 11px; color: #444; margin-bottom: 10px; line-height: 1.4;">
              <b>Type:</b> ${isBoundary ? '<span style="color:#eab308">Boundary</span>' : 'Internal'}<br/>
              <b>Connections:</b> ${graphData.edges.filter(e => e.fromKey === m.gridKey || e.toKey === m.gridKey).length}<br/>
              <b>Cluster:</b> ${isCluster ? 'Yes' : 'No'}
            </div>
            <button id="btn-toggle-${m.gridKey.replace(/[^a-zA-Z0-9]/g, '-')}" style="
              width: 100%;
              padding: 6px 4px;
              background: ${isBoundary ? '#64748b' : '#facc15'};
              color: ${isBoundary ? '#fff' : '#000'};
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-size: 11px;
              font-weight: bold;
              transition: opacity 0.2s;
            ">
              ${isBoundary ? 'Deselect Boundary' : 'Mark as Boundary'}
            </button>
          </div>
        `;

        marker.bindPopup(popupContent);
        
        marker.on('popupopen', () => {
          const btn = document.getElementById(`btn-toggle-${m.gridKey.replace(/[^a-zA-Z0-9]/g, '-')}`);
          if (btn) {
            btn.onclick = (e) => {
              e.stopPropagation();
              setBoundaryOverrides(prev => ({
                ...prev,
                [m.gridKey]: !isBoundary
              }));
              marker.closePopup();
            };
          }
        });

        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          setHighlightedNode(m.gridKey);
        });
        marker.addTo(layers);
        leafMarkersRef.current.set(m.gridKey, marker);
        if (isHl || isCluster) marker.bringToFront();
      }

      if (endIdx < graphMarkers.length) {
        requestAnimationFrame(() => drawMarkerBatch(endIdx));
      }
    };

    const drawRoadBatch = (startIdx) => {
      if (drawTokenRef.current !== drawToken) return;
      const endIdx = Math.min(startIdx + ROAD_BATCH, roadsForDisplay.length);

      for (let i = startIdx; i < endIdx; i++) {
        const road = roadsForDisplay[i];
        const line = L.polyline(road.coords, {
          color: road.oneway ? '#f59e0b' : '#94a3b8',
          weight: 2,
          opacity: 0.8,
        });
        line.bindTooltip(`${road.highway} ${road.oneway ? '(one-way)' : '(two-way)'}`);
        line.addTo(layers);
      }

      if (endIdx < roadsForDisplay.length) {
        requestAnimationFrame(() => drawRoadBatch(endIdx));
      } else {
        requestAnimationFrame(() => drawMarkerBatch(0));
      }
    };

    requestAnimationFrame(() => drawRoadBatch(0));

    return () => {
      // Keep map instance alive across renders; cleanup only drawn overlays.
      drawTokenRef.current += 1;
      if (layerGroupRef.current) layerGroupRef.current.clearLayers();
    };
  }, [bounds, center, graphData.markers, roadsForDisplay]);

  useEffect(() => {
    leafMarkersRef.current.forEach((marker, key) => {
      if (key === highlightedNode) {
        marker.setStyle({ color: '#ef4444', fillColor: '#ef4444', radius: 8 });
        marker.bringToFront();
      } else {
        marker.setStyle({ color: '#22d3ee', fillColor: '#22d3ee', radius: 5 });
      }
    });
  }, [highlightedNode]);

  useEffect(() => {
    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, []);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2>Real Map Correspondence</h2>
        <div className={styles.sub}>{placeName}</div>
      </div>

      <div className={styles.layout}>
        <div className={styles.graphWrap}>
          <div className={styles.graphTitleContainer}>
            <div className={styles.graphTitle}>Extracted City Graph (Major Roads + Intersections)</div>
          </div>
          <div className={styles.rfContainer}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.1}
              maxZoom={10}
              autoPanOnNodeDrag={true}
              panOnScroll={true}
              selectionKeyCode={null}
              multiSelectionKeyCode={null}
            >
              <Background color="#334155" gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </div>

        <div className={styles.mapWrap}>
          <div className={styles.graphTitle}>Real OSM Map (Same Imported Area)</div>
          <div ref={mapRef} className={styles.map} />
        </div>
      </div>

    </div>
  );
}
