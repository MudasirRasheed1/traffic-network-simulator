import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { bearingDeg, expandBox, pointAlong, polygonBBox, polylineLengthM } from '../../network/geo.js';
import { DOWNLOAD_MARGIN_M } from '../../network/osmClient.js';
import styles from './NetworkExplorer.module.css';

const DEFAULT_CENTER = [30.7398, 76.7827];
// Lines and points share ONE interactive canvas: stacked canvases
// would swallow each other's clicks. Overlay panes are click-through.
const PANES = [
  ['nx-network', 420, true],
  ['nx-highlight', 430, false],
  ['nx-selected', 440, false],
];

const boxToBounds = (box) => [[box.south, box.west], [box.north, box.east]];

// The same path moved `px` screen pixels to the left of its direction of
// travel. Each direction of a two-way road keeps to its own side (left-hand
// traffic), so the two show as two paths. Recomputed at every zoom.
function offsetPath(map, coords, px) {
  if (!px || !map || !coords || coords.length < 2) return coords;
  const pts = [];
  for (const c of coords) {
    const p = map.latLngToLayerPoint(c);
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last.x - p.x) + Math.abs(last.y - p.y) > 0.01) pts.push(p);
  }
  if (pts.length < 2) return coords;
  const normals = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy) || 1;
    normals.push([dy / len, -dx / len]); // left of travel, on screen (y points down)
  }
  return pts.map((p, i) => {
    const a = normals[Math.max(0, i - 1)];
    const b = normals[Math.min(normals.length - 1, i)];
    let nx = a[0] + b[0];
    let ny = a[1] + b[1];
    const len = Math.hypot(nx, ny);
    if (len < 1e-6) [nx, ny] = b;
    else [nx, ny] = [nx / len, ny / len];
    // Keep the gap even around bends (capped so sharp turns do not spike).
    const scale = px / Math.max(0.5, nx * b[0] + ny * b[1]);
    const ll = map.layerPointToLatLng(L.point(p.x + nx * scale, p.y + ny * scale));
    return [ll.lat, ll.lng];
  });
}

// `pane` null puts the arrow in the normal marker pane, where it can be clicked.
function arrowMarker(coords, fraction, pane, color = '#f8fafc', size = 18) {
  const total = polylineLengthM(coords);
  const at = pointAlong(coords, total * fraction);
  const ahead = pointAlong(coords, Math.min(total, total * fraction + 4));
  const angle = bearingDeg(at[0], at[1], ahead[0], ahead[1]);
  return L.marker(at, {
    ...(pane ? { pane } : {}),
    interactive: !pane,
    keyboard: false,
    icon: L.divIcon({
      className: pane ? styles.arrowIcon : `${styles.arrowIcon} ${styles.arrowIconClickable}`,
      html: `<span style="transform: rotate(${angle - 90}deg); background:${color}; width:${size}px; height:${size}px; line-height:${size}px; font-size:${Math.round(size * 0.55)}px">➤</span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    }),
  });
}

function textMarker(lat, lon, text, className, pane = 'nx-selected') {
  return L.marker([lat, lon], {
    pane,
    interactive: false,
    icon: L.divIcon({ className, html: `<span>${text}</span>`, iconSize: [0, 0] }),
  });
}

function handleIcon(kind) {
  return L.divIcon({
    className: kind === 'move' ? styles.moveHandle : styles.cornerHandle,
    html: kind === 'move' ? '<span>✥</span>' : '<span></span>',
    iconSize: kind === 'move' ? [28, 28] : [14, 14],
    iconAnchor: kind === 'move' ? [14, 14] : [7, 7],
  });
}

/**
 * Draws a "scene" (see scenes.js) plus an editable area box.
 */
export default function NetworkMap({
  scene,
  downloadBox,
  selection,
  onSelect,
  areaPolygon,
  areaEditable,
  areaValid,
  areaLabel,
  onAreaChange,
  drawMode,
  draftPoints,
  onDraftChange,
  onDraftClose,
  onDraftCancel,
  fitTarget,
  mapOpacity = 1,
  mapStyle = 'dark',
  onMapClick,
  placing = false,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const tilesRef = useRef(null);
  const renderersRef = useRef({});
  const layersRef = useRef({});
  const pointMarkersRef = useRef([]);
  const areaRef = useRef({ shape: null, margin: null, handles: [], move: null, label: null, dragging: null });
  const [zoom, setZoom] = useState(14);
  const callbacksRef = useRef({});
  callbacksRef.current = { onSelect, onAreaChange, onDraftChange, onDraftClose, onDraftCancel, onMapClick };
  const pendingFitRef = useRef(null);
  const areaPolygonRef = useRef(areaPolygon);
  areaPolygonRef.current = areaPolygon;

  // ---- Map init --------------------------------------------------
  useEffect(() => {
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: 14,
      zoomControl: false,
      zoomSnap: 0.25,
      preferCanvas: true,
    });
    L.control.zoom({ position: 'topleft' }).addTo(map);
    // Free OSM standard tiles, darkened with a CSS filter to match the UI.
    tilesRef.current = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    for (const [name, z, interactive] of PANES) {
      const pane = map.createPane(name);
      pane.style.zIndex = String(z);
      if (!interactive) pane.style.pointerEvents = 'none';
      renderersRef.current[name] = L.canvas({ pane: name, padding: 0.5, tolerance: 5 });
    }
    layersRef.current = {
      network: L.layerGroup().addTo(map),
      decorations: L.layerGroup().addTo(map),
      highlight: L.layerGroup().addTo(map),
      area: L.layerGroup().addTo(map),
    };

    // A click on empty map places something when the page asks for it,
    // otherwise it clears the selection.
    map.on('click', (e) => {
      if (callbacksRef.current.onMapClick) callbacksRef.current.onMapClick(e.latlng.lat, e.latlng.lng);
      else callbacksRef.current.onSelect?.(null);
    });
    map.on('zoomend', () => {
      const z = map.getZoom();
      setZoom(z);
      for (const { marker, point } of pointMarkersRef.current) marker.setRadius(point.radius(z));
    });
    mapRef.current = map;
    if (import.meta.env.DEV) window.__networkMap = map; // test/debug hook

    // Keep Leaflet's size in sync with the CSS layout.
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
      if (pendingFitRef.current && map.getSize().x > 0) {
        const box = pendingFitRef.current;
        pendingFitRef.current = null;
        map.fitBounds(boxToBounds(box.bounds), { padding: box.padding, animate: false });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      // Layers belonged to the removed map; forget them so a re-created map
      // (e.g. React dev double-mount) draws the area from scratch.
      areaRef.current = { shape: null, margin: null, handles: [], move: null, label: null, dragging: null };
    };
  }, []);

  useEffect(() => {
    tilesRef.current?.setOpacity(mapOpacity);
  }, [mapOpacity]);

  // Dark = OSM tiles recoloured by a CSS filter; light = original colours.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getPane('tilePane').classList.toggle(styles.darkTiles, mapStyle === 'dark');
    map.getContainer().classList.toggle(styles.lightMap, mapStyle === 'light');
  }, [mapStyle]);

  // Fit a box — or, if the map has no size yet (hidden tab / pane),
  // remember it and fit as soon as it is laid out.
  const fitWhenSized = (map, bounds, padding) => {
    map.invalidateSize();
    if (map.getSize().x === 0 || map.getSize().y === 0) {
      pendingFitRef.current = { bounds, padding };
      return;
    }
    map.fitBounds(boxToBounds(bounds), { padding, animate: !document.hidden });
  };

  // ---- Fit to a place / area ------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!fitTarget || !map) return;
    // Animations pause in background tabs; jump directly there.
    fitWhenSized(map, fitTarget.box, [60, 60]);
  }, [fitTarget]);

  // ---- Draw a shape: click corner by corner -------------------------
  // Click adds a corner; clicking the first corner (or Enter) closes the
  // shape; Backspace removes the last corner; Esc cancels. The page owns
  // the draft points.
  const draftRef = useRef(draftPoints || []);
  draftRef.current = draftPoints || [];
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drawMode) return undefined;
    const rubber = L.polyline([], { color: '#38bdf8', weight: 2, dashArray: '4 6', interactive: false }).addTo(map);
    map.doubleClickZoom.disable();
    map.getContainer().style.cursor = 'crosshair';
    const onClick = (e) => {
      const pts = draftRef.current;
      // A double-click (or a jittery click) must not add the same corner twice.
      if (pts.length && map.latLngToContainerPoint(pts[pts.length - 1]).distanceTo(e.containerPoint) < 6) return;
      if (pts.length >= 3) {
        const first = map.latLngToContainerPoint(pts[0]);
        if (first.distanceTo(e.containerPoint) < 14) {
          callbacksRef.current.onDraftClose?.();
          return;
        }
      }
      callbacksRef.current.onDraftChange?.([...pts, [e.latlng.lat, e.latlng.lng]]);
    };
    const onMove = (e) => {
      const pts = draftRef.current;
      rubber.setLatLngs(pts.length ? [pts[pts.length - 1], e.latlng] : []);
    };
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape') callbacksRef.current.onDraftCancel?.();
      if (e.key === 'Enter' && draftRef.current.length >= 3) callbacksRef.current.onDraftClose?.();
      if (e.key === 'Backspace' && draftRef.current.length) callbacksRef.current.onDraftChange?.(draftRef.current.slice(0, -1));
    };
    map.on('click', onClick);
    map.on('mousemove', onMove);
    window.addEventListener('keydown', onKey);
    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMove);
      window.removeEventListener('keydown', onKey);
      rubber.remove();
      map.doubleClickZoom.enable();
      map.getContainer().style.cursor = '';
    };
  }, [drawMode]);

  // Draft shape while drawing (first corner turns green once it can close).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drawMode) return undefined;
    const pts = draftPoints || [];
    const layers = [];
    if (pts.length > 1) layers.push(L.polyline(pts, { color: '#38bdf8', weight: 2.5, interactive: false }));
    pts.forEach((p, k) => {
      const closer = k === 0 && pts.length >= 3;
      layers.push(L.circleMarker(p, {
        radius: closer ? 8 : 5,
        color: '#0b0f19',
        weight: 2,
        fillColor: closer ? '#22c55e' : '#38bdf8',
        fillOpacity: 1,
        interactive: false,
      }));
    });
    layers.forEach((l) => l.addTo(map));
    return () => layers.forEach((l) => l.remove());
  }, [drawMode, draftPoints]);

  // ---- Finished area (shape, margin outline, handles) ------------
  useEffect(() => {
    const map = mapRef.current;
    const group = layersRef.current.area;
    const a = areaRef.current;
    if (!map || !group) return;
    const pts = drawMode ? null : areaPolygon;
    if (!pts || pts.length < 3) {
      group.clearLayers();
      Object.assign(a, { shape: null, margin: null, label: null, handles: [], move: null });
      return;
    }
    const color = areaValid ? '#38bdf8' : '#ef4444';
    const box = polygonBBox(pts);
    const marginBounds = boxToBounds(expandBox(box, DOWNLOAD_MARGIN_M));
    if (!a.shape) {
      a.margin = L.rectangle(marginBounds, {
        pane: 'nx-highlight', renderer: renderersRef.current['nx-highlight'], weight: 1, dashArray: '2 6', fill: false, interactive: false,
      }).addTo(group);
      a.shape = L.polygon(pts, {
        pane: 'nx-highlight', renderer: renderersRef.current['nx-highlight'], weight: 2.5, dashArray: '10 7', interactive: false,
      }).addTo(group);
    }
    a.shape.setLatLngs(pts);
    a.margin.setBounds(marginBounds);
    a.shape.setStyle({ color, fillColor: color, opacity: areaEditable ? 1 : 0.6, fillOpacity: areaEditable ? 0.07 : 0 });
    a.margin.setStyle({ color, opacity: areaEditable ? 0.55 : 0 });

    // Corner handles: rebuilt when editing stops or the corner count changes.
    if (!areaEditable || a.handles.length !== pts.length) {
      a.handles.forEach((h) => group.removeLayer(h));
      a.handles = [];
      if (a.move) { group.removeLayer(a.move); a.move = null; }
    }
    if (areaEditable) {
      if (!a.handles.length) {
        a.handles = pts.map((p, k) => {
          const marker = L.marker(p, { icon: handleIcon('corner'), draggable: true, zIndexOffset: 1000 });
          marker.on('dragstart', () => { a.dragging = k; });
          marker.on('drag', (e) => {
            const next = areaPolygonRef.current.map((q, idx) => (idx === k ? [e.latlng.lat, e.latlng.lng] : q));
            callbacksRef.current.onAreaChange?.(next);
          });
          marker.on('dragend', () => { a.dragging = null; });
          return marker.addTo(group);
        });
        a.move = L.marker([(box.north + box.south) / 2, (box.west + box.east) / 2], { icon: handleIcon('move'), draggable: true, zIndexOffset: 1000 });
        a.move.on('dragstart', () => {
          a.dragging = 'move';
          a.dragStart = { latlng: a.move.getLatLng(), pts: areaPolygonRef.current.map((q) => [...q]) };
        });
        a.move.on('drag', (e) => {
          const dLat = e.latlng.lat - a.dragStart.latlng.lat;
          const dLng = e.latlng.lng - a.dragStart.latlng.lng;
          callbacksRef.current.onAreaChange?.(a.dragStart.pts.map(([lat, lon]) => [lat + dLat, lon + dLng]));
        });
        a.move.on('dragend', () => { a.dragging = null; });
        a.move.addTo(group);
      }
      pts.forEach((p, k) => { if (a.dragging !== k) a.handles[k].setLatLng(p); });
      if (a.dragging !== 'move') a.move.setLatLng([(box.north + box.south) / 2, (box.west + box.east) / 2]);
    }
    if (a.label) group.removeLayer(a.label);
    a.label = areaLabel
      ? textMarker(box.north, box.west, areaLabel, areaValid ? styles.areaLabel : `${styles.areaLabel} ${styles.areaLabelBad}`, 'markerPane').addTo(group)
      : null;
  }, [areaPolygon, areaEditable, areaValid, areaLabel, drawMode]);

  // ---- Download outline after extraction -------------------------
  useEffect(() => {
    // The download box (area + margin) is drawn by the area effect while
    // editing; after extraction show it faintly so feeders make sense.
    const map = mapRef.current;
    if (!map || !downloadBox) return undefined;
    const outline = L.rectangle(boxToBounds(downloadBox), {
      pane: 'nx-highlight', renderer: renderersRef.current['nx-highlight'], color: '#64748b', weight: 1, dashArray: '2 6', fill: false, interactive: false,
    }).addTo(map);
    // After the map is torn down its canvas is gone; removing would schedule a redraw on it.
    return () => { if (mapRef.current) outline.remove(); };
  }, [downloadBox]);

  // ---- Draw scene -----------------------------------------------
  useEffect(() => {
    const group = layersRef.current.network;
    const deco = layersRef.current.decorations;
    if (!group) return;
    group.clearLayers();
    deco.clearLayers();
    pointMarkersRef.current = [];
    if (!scene) return;
    const renderer = renderersRef.current['nx-network'];
    const z = mapRef.current?.getZoom() ?? 14;
    // The click position goes along, for pages that place things on a road.
    const select = (target) => (e) => {
      L.DomEvent.stopPropagation(e);
      callbacksRef.current.onSelect?.(target, e.latlng ? [e.latlng.lat, e.latlng.lng] : null);
    };

    for (const g of scene.internal || []) {
      L.polyline(g.coords, { pane: 'nx-network', renderer, color: g.color, weight: 2, opacity: 0.55, interactive: false }).addTo(group);
    }
    const map = mapRef.current;
    for (const line of scene.lines) {
      const layer = L.polyline(offsetPath(map, line.coords, line.offset), {
        pane: 'nx-network', renderer, color: line.color, weight: line.weight, opacity: 0.9, lineCap: 'round', dashArray: line.dash || null,
      });
      layer.bindTooltip(line.tooltip, { sticky: true, className: styles.mapTooltip, direction: 'top', offset: [0, -6] });
      layer.on('click', select(line.select));
      layer.addTo(group);
    }
    for (const point of scene.points) {
      const marker = L.circleMarker([point.lat, point.lon], {
        pane: 'nx-network', renderer, radius: point.radius(z), color: point.stroke, weight: point.strokeWeight, fillColor: point.fill, fillOpacity: 1,
      });
      marker.bindTooltip(point.tooltip, { className: styles.mapTooltip, direction: 'top', offset: [0, -6] });
      marker.on('click', select(point.select));
      marker.addTo(group);
      pointMarkersRef.current.push({ marker, point });
    }
    for (const a of scene.arrows || []) {
      const arrow = arrowMarker(offsetPath(map, a.coords, a.offset), a.fraction, a.select ? null : 'nx-highlight', a.color, a.size);
      if (a.select) {
        if (a.tooltip) arrow.bindTooltip(a.tooltip, { className: styles.mapTooltip, direction: 'top', offset: [0, -8] });
        arrow.on('click', select(a.select));
      }
      arrow.addTo(deco);
    }
    for (const m of scene.markers || []) {
      const marker = L.marker([m.lat, m.lon], {
        icon: L.divIcon({ className: styles[m.className] || m.className, html: m.html, iconSize: [m.size, m.size], iconAnchor: [m.size / 2, m.size / 2] }),
      });
      marker.bindTooltip(m.tooltip, { className: styles.mapTooltip, direction: 'top', offset: [0, -8] });
      marker.on('click', select(m.select));
      marker.addTo(deco);
    }
    for (const l of scene.labels || []) {
      textMarker(l.lat, l.lon, l.text, l.kind === 'gateway' ? styles.nodeLabelGateway : styles.nodeLabel, 'nx-selected').addTo(deco);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, zoom]);

  // ---- Fit to a newly extracted network -------------------------
  const fittedRef = useRef(null);
  useEffect(() => {
    if (!downloadBox || !mapRef.current) return;
    const key = JSON.stringify(downloadBox);
    if (fittedRef.current === key) return;
    fittedRef.current = key;
    fitWhenSized(mapRef.current, downloadBox, [24, 24]);
  }, [downloadBox]);

  // ---- Selection highlight --------------------------------------
  useEffect(() => {
    const group = layersRef.current.highlight;
    if (!group) return;
    group.clearLayers();
    const spec = scene?.highlight(selection);
    if (!spec) return;
    const hl = renderersRef.current['nx-highlight'];
    const top = renderersRef.current['nx-selected'];
    for (const g of spec.glow || []) {
      const coords = offsetPath(mapRef.current, g.coords, g.offset);
      L.polyline(coords, { pane: 'nx-highlight', renderer: hl, color: '#f8fafc', weight: g.weight + 6, opacity: 0.25, interactive: false }).addTo(group);
      L.polyline(coords, { pane: 'nx-highlight', renderer: hl, color: '#f8fafc', weight: Math.max(2, g.weight - 1), opacity: 0.95, interactive: false }).addTo(group);
    }
    for (const coords of spec.dashed || []) {
      L.polyline(coords, { pane: 'nx-selected', renderer: top, color: '#fbbf24', weight: 2.5, dashArray: '4 4', interactive: false }).addTo(group);
    }
    for (const [lat, lon] of spec.dots || []) {
      L.circleMarker([lat, lon], { pane: 'nx-selected', renderer: top, radius: 2.5, color: '#fbbf24', weight: 1, fillColor: '#fbbf24', fillOpacity: 1, interactive: false }).addTo(group);
    }
    for (const r of spec.rings || []) {
      L.circleMarker([r.lat, r.lon], { pane: 'nx-selected', renderer: top, radius: r.radius(zoom), color: '#f8fafc', weight: 2, fill: false, interactive: false }).addTo(group);
    }
    for (const a of spec.arrows || []) arrowMarker(offsetPath(mapRef.current, a.coords, a.offset), a.fraction, 'nx-selected').addTo(group);
    for (const l of spec.labels || []) textMarker(l.lat, l.lon, l.text, styles.armLabel).addTo(group);
  }, [selection, scene, zoom]);

  // Keep the selection visible beside the floating inspector panel.
  useEffect(() => {
    const map = mapRef.current;
    const target = scene?.focus(selection);
    if (!map || !target) return;
    const narrow = map.getContainer().clientWidth < 700;
    map.panInside(target, {
      paddingTopLeft: [60, 60],
      paddingBottomRight: narrow ? [20, map.getContainer().clientHeight * 0.6] : [440, 40],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // Crosshair while the page is waiting for a spot on the map.
  useEffect(() => {
    const el = mapRef.current?.getContainer();
    if (el) el.style.cursor = placing ? 'crosshair' : '';
  }, [placing]);

  return <div ref={containerRef} className={styles.map} />;
}
