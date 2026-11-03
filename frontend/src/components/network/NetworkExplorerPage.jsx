import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../utils/api.js';
import { useCityStore } from '../../store/useCityStore.js';
import Logo from '../Logo.jsx';
import NetworkMap from './NetworkMap.jsx';
import Inspector from './Inspector.jsx';
import CityInspector, { buildCityLookups } from './CityInspector.jsx';
import { COLOR_MODES, JUNCTION_KINDS, legendItems } from './networkStyle.js';
import { buildCityScene, buildFullGraphScene, cityLegend, CITY_COLORS } from './scenes.js';
import { DOWNLOAD_MARGIN_M, fetchRoadNetwork, searchPlaces } from '../../network/osmClient.js';
import { bboxAround, boxSizeKm, boxToPolygon, expandBox, polygonAreaKm2, polygonBBox } from '../../network/geo.js';
import { DETAIL_LEVELS, MODEL_CONSTANTS, ROAD_CLASSES } from '../../network/roadDefaults.js';
import { DEFAULT_GRAPH_OPTIONS } from '../../network/buildRoadGraph.js';
import { MAP_STYLES, useMapStyle } from './useMapStyle.js';
import { createBackgroundWorker } from '../../utils/backgroundWorker.js';
import { deriveCity, roughModel, simplifyModel } from '../../network/cityModel.js';
import { CollapsiblePanel, CollapsibleSidebar, usePanels } from '../common/Collapsible.jsx';

const DETAIL_KEY = 'urbangrid-graph-detail-v2';
const GRAPH_DETAIL = { rough: 'Rough', simple: 'Simple', detailed: 'Detailed' };
const DETAIL_HINTS = {
  rough: 'Main structure only. Nearby intersections and sources are joined.',
  simple: 'One road per direction. Same results as Detailed.',
  detailed: 'Every road piece from the map.',
};
const savedDetail = () => {
  try {
    const saved = localStorage.getItem(DETAIL_KEY);
    return GRAPH_DETAIL[saved] ? saved : 'rough';
  } catch {
    return 'rough';
  }
};
import styles from './NetworkExplorer.module.css';
import SiteHeader from '../common/SiteHeader.jsx';

const DEFAULT_CENTER = [30.7398, 76.7827];
const AREA_PRESETS_KM = [1, 2, 3];
const MAX_SIDE_KM = { all: 3, main: 6 };
const MIN_SIDE_KM = 0.3;
const VIEWS = { city: 'City graph', full: 'Full road graph' };
const MAP_OPACITY = { on: 1, dim: 0.35, off: 0 };

// Builds the graphs off the main thread. Started when the page opens and
// reused, so it keeps working even if the dev server stops afterwards.
const graphBuilder = createBackgroundWorker(() => new Worker(new URL('../../network/roadGraphWorker.js', import.meta.url), { type: 'module' }));

function buildInWorker(osmJson, area, downloadBox, options, simOptions) {
  return graphBuilder.run({ osmJson, area, downloadBox, options, simOptions }).promise;
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function StatTile({ label, value, color }) {
  return (
    <div className={styles.statTile}>
      <span className={styles.statValue} style={color ? { color } : undefined}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function CoverageBar({ label, pct }) {
  return (
    <div className={styles.coverage}>
      <div className={styles.coverageHead}><span>{label}</span><strong>{pct}%</strong></div>
      <div className={styles.coverageTrack}><div style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function StepLog({ steps }) {
  const [all, setAll] = useState(false);
  const shown = all ? steps : steps.slice(-1);
  return (
    <ol className={styles.stepLog}>
      {steps.length > 1 && (
        <li>
          <button type="button" className={styles.linkBtn} style={{ margin: 0 }} onClick={() => setAll(!all)}>
            {all ? 'Hide steps' : `Show all ${steps.length} steps`}
          </button>
        </li>
      )}
      {shown.map((s, i) => (
        <li key={i} className={styles[`step_${s.state}`]}>
          <span className={styles.stepDot} />
          <span>{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

function Segmented({ options, value, onChange, disabled }) {
  return (
    <div className={styles.segmented}>
      {Object.entries(options).map(([key, label]) => (
        <button key={key} type="button" className={value === key ? styles.segActive : ''} onClick={() => onChange(key)} disabled={disabled}>
          {label}
        </button>
      ))}
    </div>
  );
}

export default function NetworkExplorerPage() {
  const navigate = useNavigate();
  const [authChecked, setAuthChecked] = useState(false);

  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState([]);
  const [placeName, setPlaceName] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [fitTarget, setFitTarget] = useState(null);

  const [areaPolygon, setAreaPolygon] = useState(() => boxToPolygon(bboxAround(DEFAULT_CENTER[0], DEFAULT_CENTER[1], 2)));
  const [drawMode, setDrawMode] = useState(false);
  const [draftPoints, setDraftPoints] = useState([]);
  const [detail, setDetail] = useState('all');
  const [mode, setMode] = useState('select'); // 'select' | 'explore'

  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState('');
  const [osm, setOsm] = useState(null);
  const [graph, setGraph] = useState(null);
  const [simnet, setSimnet] = useState(null);
  const [detailedCity, setCity] = useState(null);
  // Rough: the skeleton, nearby intersections joined. Simple: only
  // intersections and sources/sinks, one road per direction between them.
  // Detailed: every junction and road piece.
  const [graphDetail, setGraphDetailState] = useState(savedDetail);
  const setGraphDetail = (value) => {
    setGraphDetailState(value);
    setSelection(null);
    try { localStorage.setItem(DETAIL_KEY, value); } catch { /* per-browser preference only */ }
  };
  const city = useMemo(
    () => {
      if (!detailedCity || graphDetail === 'detailed') return detailedCity;
      const model = graphDetail === 'rough' ? roughModel(detailedCity.model) : simplifyModel(detailedCity.model);
      return deriveCity({ ...detailedCity, model });
    },
    [detailedCity, graphDetail],
  );

  const [view, setView] = useState('city');
  const [selection, setSelection] = useState(null);
  const [colorBy, setColorBy] = useState('class');
  const [shape, setShape] = useState('straight');
  const [showLabels, setShowLabels] = useState(true);
  const [mapMode, setMapMode] = useState('dim');
  const [mapStyle, setMapStyle] = useMapStyle();
  const abortRef = useRef(null);
  const loadCity = useCityStore((st) => st.loadCity);
  const fileInputRef = useRef(null);
  const overlays = usePanels('urbangrid-explorer-overlays', { mapOptions: true, legend: false });
  const panels = usePanels('urbangrid-explorer-panels', { find: true, area: true, extract: true, cityGraph: true, funnel: false, fullGraph: true, assumptions: false });

  useEffect(() => {
    if (!api.isAuthenticated()) navigate('/');
    else setAuthChecked(true);
  }, [navigate]);
  useEffect(() => graphBuilder.warm(), []);

  const areaBox = polygonBBox(areaPolygon);
  const size = boxSizeKm(areaBox);
  const areaKm2 = polygonAreaKm2(areaPolygon);
  const maxSide = MAX_SIDE_KM[detail];
  const areaValid = areaPolygon.length >= 3 && areaKm2 >= 0.1
    && size.widthKm <= maxSide && size.heightKm <= maxSide && size.widthKm >= MIN_SIDE_KM && size.heightKm >= MIN_SIDE_KM;
  const areaLabel = `${areaKm2.toFixed(1)} km² · ${size.widthKm.toFixed(1)} × ${size.heightKm.toFixed(1)} km`;

  const startDrawing = () => {
    setDraftPoints([]);
    setDrawMode(true);
    setMode('select');
    setSelection(null);
  };
  const finishDrawing = () => {
    if (draftPoints.length >= 3) setAreaPolygon(draftPoints);
    setDraftPoints([]);
    setDrawMode(false);
  };
  const cancelDrawing = () => {
    setDraftPoints([]);
    setDrawMode(false);
  };

  const graphLookups = useMemo(() => (graph ? {
    linkById: new Map(graph.links.map((l) => [l.id, l])),
    roadById: new Map(graph.roads.map((r) => [r.id, r])),
    junctionById: new Map(graph.junctions.map((j) => [j.id, j])),
  } : null), [graph]);
  const cityLookups = useMemo(() => buildCityLookups(city), [city]);

  const scene = useMemo(() => {
    if (view === 'city' && city) return buildCityScene(city, { shape, showLabels, lightMap: mapStyle === 'light' && mapMode !== 'off' });
    if (view === 'full' && graph) return buildFullGraphScene(graph, colorBy);
    return null;
  }, [view, city, graph, colorBy, shape, showLabels, mapStyle, mapMode]);

  const onSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError('');
    try {
      const results = await searchPlaces(query.trim());
      setPlaces(results);
      if (!results.length) setSearchError('No places found. Try adding the city or country name.');
      else choosePlace(results[0]);
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const choosePlace = (p) => {
    const box = bboxAround(p.lat, p.lon, 2);
    setPlaceName(p.name);
    setMode('select');
    setSelection(null);
    setDrawMode(false);
    setAreaPolygon(boxToPolygon(box));
    setFitTarget({ box, key: `${p.id}-${Date.now()}` });
  };

  const setPreset = (km) => {
    const lat = (areaBox.north + areaBox.south) / 2;
    const lon = (areaBox.west + areaBox.east) / 2;
    const box = bboxAround(lat, lon, km);
    setDrawMode(false);
    setAreaPolygon(boxToPolygon(box));
    setMode('select');
    setFitTarget({ box, key: `preset-${Date.now()}` });
  };

  const pushStep = (text, state = 'active') => setSteps((prev) => [
    ...prev.map((s) => (s.state === 'active' ? { ...s, state: 'done' } : s)),
    { text, state },
  ]);

  const onExtract = async () => {
    if (!areaValid) return;
    const area = { ...areaBox, polygon: areaPolygon };
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError('');
    setSteps([]);
    setSelection(null);
    setGraph(null);
    setSimnet(null);
    setCity(null);
    try {
      pushStep(`Requesting roads for ${areaLabel} (+${DOWNLOAD_MARGIN_M} m margin of main roads) from OpenStreetMap…`);
      const result = await fetchRoadNetwork(area, {
        detailLevel: detail,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.status === 'failed') pushStep(`${new URL(p.endpoint).host} failed (${p.error}).`, 'warn');
          if (p.status === 'requesting' && p.attempt > 1) pushStep(p.hedged ? `No answer yet. Also asking ${new URL(p.endpoint).host}…` : `Trying ${new URL(p.endpoint).host}…`);
          if (p.status === 'pause') pushStep('All servers busy. Retrying shortly.', 'warn');
          if (p.status === 'cached') {
            pushStep(p.storedAt
              ? `Using the copy downloaded ${new Date(p.storedAt).toLocaleString()} (cached in this browser for 7 days).`
              : 'Using the copy already downloaded this session.');
          }
        },
      });
      pushStep(`Received ${result.meta.elementCount.toLocaleString()} OSM elements${result.meta.durationMs ? ` in ${(result.meta.durationMs / 1000).toFixed(1)} s` : ''}. Building the city graph…`);
      await buildFromOsm(result, area, detail);
    } catch (err) {
      setError(err.message);
      pushStep(err.message, 'error');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const buildFromOsm = async (result, area, detailLevel) => {
    const built = await buildInWorker(
      result.data,
      area,
      result.meta.downloadBox,
      { roadClasses: DETAIL_LEVELS[detailLevel].classes, mergeDistanceM: DEFAULT_GRAPH_OPTIONS.mergeDistanceM },
      { includeConnectors: detailLevel === 'all' },
    );
    setOsm({ ...result, detail: detailLevel, area, placeName: result.data.urbangrid?.placeName || placeName });
    setGraph(built.graph);
    setSimnet(built.simnet);
    setCity(built.city);
    setMode('explore');
    pushStep(`Ready: ${built.city.summary.intersections} intersections, ${built.city.summary.sources} sources, ${built.city.summary.sinks} sinks.`, 'done');
  };

  // Load a saved OSM download (from “Raw OSM data” or any Overpass JSON).
  const onImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    setSteps([]);
    setSelection(null);
    try {
      pushStep(`Reading ${file.name}…`);
      const json = JSON.parse(await file.text());
      if (!Array.isArray(json.elements)) throw new Error('Not an OpenStreetMap (Overpass JSON) file.');
      const saved = json.urbangrid || {};
      const area = saved.area || { ...areaBox, polygon: areaPolygon };
      const downloadBox = saved.downloadBox || expandBox(area, DOWNLOAD_MARGIN_M);
      const detailLevel = saved.detail || detail;
      if (saved.area) {
        setAreaPolygon(saved.area.polygon || boxToPolygon(saved.area));
        setDetail(detailLevel);
      }
      if (saved.placeName) setPlaceName(saved.placeName);
      const result = {
        data: json,
        meta: { endpoint: `file: ${file.name}`, fetchedAt: saved.fetchedAt || null, osmTimestamp: json.osm3s?.timestamp_osm_base || null, elementCount: json.elements.length, area, downloadBox },
      };
      pushStep(`Loaded ${json.elements.length.toLocaleString()} OSM elements${saved.area ? ' with their saved area' : ' for the current area'}. Building the city graph…`);
      await buildFromOsm(result, area, detailLevel);
    } catch (err) {
      setError(err.message);
      pushStep(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const sourceMeta = () => ({
    provider: 'OpenStreetMap contributors (ODbL) via Overpass API',
    endpoint: osm.meta.endpoint,
    fetchedAt: osm.meta.fetchedAt,
    osmTimestamp: osm.meta.osmTimestamp,
    placeName: osm.placeName,
    detailLevel: osm.detail,
  });
  const slug = (osm?.placeName || 'area').toLowerCase().replace(/[^a-z0-9]+/g, '-');

  if (!authChecked) return null;
  const s = graph?.summary;
  const c = city?.summary;

  return (
    <div className={styles.page}>
      <SiteHeader />

      <div className={styles.body} style={panels.isOpen('sidebar') ? undefined : { gridTemplateColumns: '40px 1fr' }}>
        <CollapsibleSidebar panels={panels} className={styles.sidebar} label="Panels">
          <CollapsiblePanel id="find" title={<><span className={styles.stepBadge}>1</span>Find a place</>} panels={panels} className={styles.panel}>
            <form className={styles.searchRow} onSubmit={onSearch}>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="City, area or landmark…" aria-label="Search place" />
              <button type="submit" disabled={searching || !query.trim()}>{searching ? '…' : 'Search'}</button>
            </form>
            {searchError && <div className={styles.errorText}>{searchError}</div>}
            {places.length > 1 && (
              <ul className={styles.placeList}>
                {places.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => choosePlace(p)} title={p.displayName}>
                      <strong>{p.name}</strong>
                      <span>{p.displayName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CollapsiblePanel>

          <CollapsiblePanel id="area" title={<><span className={styles.stepBadge}>2</span>Select the area</>} panels={panels} className={styles.panel}>
            {drawMode ? (
              <div className={styles.drawBox}>
                <strong>Drawing: {draftPoints.length} corner{draftPoints.length === 1 ? '' : 's'}</strong>
                <span>Click the map to add corners. Enter finishes, Esc cancels.</span>
                <div className={styles.extractRow}>
                  <button type="button" className={styles.primaryBtn} onClick={finishDrawing} disabled={draftPoints.length < 3}>Finish shape</button>
                  <button type="button" className={styles.secondaryBtn} style={{ marginTop: 0 }} onClick={() => setDraftPoints((pts) => pts.slice(0, -1))} disabled={!draftPoints.length}>Undo</button>
                  <button type="button" className={styles.secondaryBtn} style={{ marginTop: 0 }} onClick={cancelDrawing}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className={styles.extractRow}>
                <button type="button" className={styles.secondaryBtn} style={{ marginTop: 0, flex: 1 }} onClick={startDrawing}>
                  Draw shape
                </button>
                {AREA_PRESETS_KM.map((km) => (
                  <button key={km} type="button" className={styles.secondaryBtn} style={{ marginTop: 0 }} onClick={() => setPreset(km)} disabled={km > maxSide} title={`${km} × ${km} km square`}>
                    {km} km
                  </button>
                ))}
              </div>
            )}
            <div className={styles.areaStats}>
              <span>Selected <strong>{areaKm2.toFixed(1)} km²</strong> ({areaPolygon.length} corners)</span>
              <span>{size.widthKm.toFixed(1)} × {size.heightKm.toFixed(1)} km</span>
            </div>
            {!areaValid && (
              <div className={styles.errorText}>
                {size.widthKm < MIN_SIDE_KM || size.heightKm < MIN_SIDE_KM || areaKm2 < 0.1
                  ? 'Area too small.'
                  : `Too large for the free map servers. Keep each side under ${maxSide} km${detail === 'all' ? ' (or download main roads only)' : ''}.`}
              </div>
            )}
            <label className={styles.fieldLabel}>Download</label>
            <Segmented
              options={{ all: DETAIL_LEVELS.all.label, main: DETAIL_LEVELS.main.label }}
              value={detail}
              onChange={(key) => { setDetail(key); setMode('select'); }}
            />
            <p className={styles.hint}>
              {mode === 'select'
                ? 'Drag the corners to adjust.'
                : 'Click any item to inspect it.'}
            </p>
            {mode === 'explore' && (
              <button type="button" className={styles.secondaryBtn} onClick={() => { setMode('select'); setSelection(null); }}>
                Change area
              </button>
            )}
          </CollapsiblePanel>

          <CollapsiblePanel id="extract" title={<><span className={styles.stepBadge}>3</span>Extract</>} panels={panels} className={styles.panel}>
            <div className={styles.extractRow}>
              <button type="button" className={styles.primaryBtn} onClick={onExtract} disabled={busy || mode !== 'select' || !areaValid || drawMode}>
                {busy ? 'Working…' : `Extract city graph`}
              </button>
              {busy && abortRef.current && (
                <button type="button" className={styles.secondaryBtn} onClick={() => abortRef.current?.abort()}>Cancel</button>
              )}
            </div>
            {steps.length > 0 && <StepLog steps={steps} />}
            {error && !busy && !steps.length && <div className={styles.errorText}>{error}</div>}
            <button type="button" className={styles.linkBtn} onClick={() => fileInputRef.current?.click()} disabled={busy}>
              Import a saved OSM file instead…
            </button>
            <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={onImportFile} aria-label="Import OSM file" />
          </CollapsiblePanel>

          {c && view === 'city' && (
            <>
              <CollapsiblePanel id="cityGraph" title={'City graph'} panels={panels} className={styles.panel}>
                <Segmented options={GRAPH_DETAIL} value={graphDetail} onChange={setGraphDetail} />
                <p className={styles.hint}>{DETAIL_HINTS[graphDetail]}</p>
                <div className={styles.statGrid}>
                  <StatTile label="Intersections" value={c.intersections} color={CITY_COLORS.intersection} />
                  <StatTile label="Sources" value={c.sources} color={CITY_COLORS.feeder} />
                  <StatTile label="Sinks" value={c.sinks} color={CITY_COLORS.exit} />
                  <StatTile label="Roundabouts" value={c.fromRoundabouts} color={CITY_COLORS.roundaboutRing} />
                  <StatTile label="Roads" value={c.roads} />
                  <StatTile label="Road length" value={`${c.roadKm} km`} />
                </div>
                {city.warnings.map((w) => <div key={w} className={styles.warnText}>{w}</div>)}
                <div className={styles.downloadRow}>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    disabled={!c.intersections}
                    onClick={() => {
                      loadCity(city, { placeName: osm.placeName, area: osm.area, fetchedAt: osm.meta.fetchedAt, osmTimestamp: osm.meta.osmTimestamp });
                      navigate('/city-sim');
                    }}
                  >
                    Open in City Simulator →
                  </button>
                  <button type="button" className={styles.secondaryBtn} onClick={() => downloadJson(`city-graph-${slug}.json`, { ...city, source: sourceMeta() })}>
                    Download city graph
                  </button>
                </div>
              </CollapsiblePanel>

              <CollapsiblePanel id="funnel" title={'From map to city graph'} panels={panels} className={styles.panel}>
                <ol className={styles.funnel}>
                  <li>
                    <span>Full map</span><strong>{s.junctions} junctions</strong>
                    <span>{s.roads} road segments, {s.totalRoadKm} km (area + margin)</span>
                  </li>
                  {[...simnet.log, ...city.log].map((entry) => (
                    <li key={entry.step}><span>{entry.step}</span><strong /><span>{entry.detail}</span></li>
                  ))}
                  <li className={styles.funnelFinal}>
                    <span>City graph</span><strong>{c.intersections} intersections</strong>
                    <span>{c.roads} roads · {c.junctions} junctions without signal · {c.sources} sources · {c.sinks} sinks</span>
                  </li>
                </ol>
              </CollapsiblePanel>
            </>
          )}

          {s && view === 'full' && (
            <CollapsiblePanel id="fullGraph" title={'Full road graph'} panels={panels} className={styles.panel}>
              <div className={styles.statGrid}>
                <StatTile label="Junctions" value={s.junctions} />
                <StatTile label="Signalized" value={s.signalized} color={JUNCTION_KINDS.signalized.color} />
                <StatTile label="Roundabouts" value={s.roundabouts} color={JUNCTION_KINDS.roundabout.color} />
                <StatTile label="Roads" value={s.roads} />
                <StatTile label="Road length" value={`${s.totalRoadKm} km`} />
                <StatTile label="Parts" value={s.components} />
              </div>
              <div className={styles.subhead}>Taken from OSM</div>
              <CoverageBar label="Lane counts" pct={s.coverage.lanesFromOsmPct} />
              <CoverageBar label="Speed limits" pct={s.coverage.speedFromOsmPct} />
              {graph.warnings.map((w) => <div key={w} className={styles.warnText}>{w}</div>)}
              <div className={styles.downloadRow}>
                <button type="button" className={styles.secondaryBtn} onClick={() => downloadJson(`road-graph-${slug}.json`, { ...graph, source: sourceMeta() })}>Download graph JSON</button>
                <button type="button" className={styles.secondaryBtn} onClick={() => downloadJson(`osm-${slug}.json`, { ...osm.data, urbangrid: { area: osm.area, downloadBox: osm.meta.downloadBox, detail: osm.detail, fetchedAt: osm.meta.fetchedAt, placeName: osm.placeName } })}>Save OSM data</button>
              </div>
            </CollapsiblePanel>
          )}

          <CollapsiblePanel id="assumptions" title="Model assumptions" panels={panels} className={styles.panel}>
            {(
              <>
                <ul className={styles.ruleList}>
                  <li>Main roads only</li>
                  <li>Signals where movements cross</li>
                  <li>Roundabouts up to 200 m = one intersection</li>
                  <li>Left turns are free</li>
                  <li>Defaults below fill missing OSM tags</li>
                </ul>
                <table className={styles.table}>
                  <thead><tr><th>Road class</th><th>Lanes / dir</th><th>Speed</th></tr></thead>
                  <tbody>
                    {Object.entries(ROAD_CLASSES).map(([key, rc]) => (
                      <tr key={key}>
                        <td><span className={styles.swatch} style={{ background: rc.color }} />{rc.label}</td>
                        <td>{rc.lanesPerDir}</td>
                        <td>{rc.speedKmh} km/h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <dl className={styles.constants}>
                  <dt>Lane width</dt><dd>{MODEL_CONSTANTS.laneWidthM} m</dd>
                  <dt>Saturation flow</dt><dd>{MODEL_CONSTANTS.saturationFlowPerLaneVph} veh/h/lane</dd>
                  <dt>Queue spacing</dt><dd>{MODEL_CONSTANTS.jamSpacingM} m/vehicle</dd>
                  <dt>Download margin</dt><dd>{DOWNLOAD_MARGIN_M} m</dd>
                </dl>
              </>
            )}
          </CollapsiblePanel>

          <footer className={styles.attribution}>
            Road data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> (ODbL)
          </footer>
        </CollapsibleSidebar>

        <main className={styles.mapArea}>
          <div className={styles.mapCard}>
          <NetworkMap
            scene={scene}
            downloadBox={mode === 'explore' ? osm?.meta.downloadBox : null}
            selection={selection}
            onSelect={setSelection}
            areaPolygon={areaPolygon}
            areaEditable={mode === 'select' && !busy}
            areaValid={areaValid}
            areaLabel={mode === 'select' ? areaLabel : null}
            onAreaChange={setAreaPolygon}
            drawMode={drawMode}
            draftPoints={draftPoints}
            onDraftChange={setDraftPoints}
            onDraftClose={finishDrawing}
            onDraftCancel={cancelDrawing}
            fitTarget={fitTarget}
            mapOpacity={view === 'city' && city ? MAP_OPACITY[mapMode] : 1}
            mapStyle={mapStyle}
          />
          {graph && (
            <div className={styles.viewToggle} role="tablist" aria-label="Network view">
              {Object.entries(VIEWS).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? styles.viewActive : ''} onClick={() => { setView(key); setSelection(null); }}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {graph && !overlays.isOpen('mapOptions') && (
            <button type="button" className={`${styles.overlayBtn} ${styles.overlayBtnTop}`} onClick={() => overlays.setOpen('mapOptions', true)}>
              Map options
            </button>
          )}
          {graph && view === 'city' && overlays.isOpen('mapOptions') && (
            <div className={`${styles.mapControls} ${styles.mapControlsLower}`}>
              <span>Roads</span>
              <Segmented options={{ straight: 'Straight', real: 'Real shape' }} value={shape} onChange={setShape} />
              <span>Map</span>
              <Segmented options={{ off: 'Off', dim: 'Dim', on: 'On' }} value={mapMode} onChange={setMapMode} />
              <Segmented options={MAP_STYLES} value={mapStyle} onChange={setMapStyle} />
              <Segmented options={{ on: 'Labels', off: 'No labels' }} value={showLabels ? 'on' : 'off'} onChange={(v) => setShowLabels(v === 'on')} />
              <button type="button" className={styles.overlayClose} onClick={() => overlays.setOpen('mapOptions', false)} aria-label="Hide map options">×</button>
            </div>
          )}
          {!graph && (
            <div className={styles.mapControls} style={{ top: 12 }}>
              <span>Map</span>
              <Segmented options={MAP_STYLES} value={mapStyle} onChange={setMapStyle} />
            </div>
          )}
          {graph && view === 'full' && overlays.isOpen('mapOptions') && (
            <div className={`${styles.mapControls} ${styles.mapControlsLower}`}>
              <span>Colour by</span>
              <Segmented options={COLOR_MODES} value={colorBy} onChange={setColorBy} />
              <span>Map</span>
              <Segmented options={MAP_STYLES} value={mapStyle} onChange={setMapStyle} />
              <button type="button" className={styles.overlayClose} onClick={() => overlays.setOpen('mapOptions', false)} aria-label="Hide map options">×</button>
            </div>
          )}
          {graph && !overlays.isOpen('legend') && (
            <button type="button" className={`${styles.overlayBtn} ${styles.overlayBtnBottom}`} onClick={() => overlays.setOpen('legend', true)}>
              Legend
            </button>
          )}
          {graph && overlays.isOpen('legend') && (
            <div className={styles.legend}>
              <div className={styles.legendHead}>
                <span>Legend</span>
                <button type="button" className={styles.overlayClose} onClick={() => overlays.setOpen('legend', false)} aria-label="Hide legend">×</button>
              </div>
              {view === 'city' ? (
                cityLegend().map((item) => (
                  <div key={item.label} className={styles.legendRow}>
                    <span
                      className={item.kind === 'line' ? styles.legendLine : item.kind === 'square' ? styles.legendSquare : item.ring ? styles.legendRingDot : styles.legendDot}
                      style={{ '--c': item.color, '--r': item.ring }}
                    />
                    {item.label}
                  </div>
                ))
              ) : (
                <>
                  <div className={styles.legendTitle}>Junctions</div>
                  {['signalized', 'roundabout', 'priority', 'boundary'].map((k) => (
                    <div key={k} className={styles.legendRow}>
                      <span className={k === 'boundary' ? styles.legendRing : styles.legendDot} style={{ '--c': JUNCTION_KINDS[k].color }} />
                      {JUNCTION_KINDS[k].label}
                    </div>
                  ))}
                  <div className={styles.legendTitle}>Roads · {COLOR_MODES[colorBy]}</div>
                  {legendItems(colorBy, graph).map((item) => (
                    <div key={item.label} className={styles.legendRow}>
                      <span className={styles.legendLine} style={{ '--c': item.color }} />
                      {item.label}
                    </div>
                  ))}
                </>
              )}
              <div className={styles.legendNote}>Line width = number of lanes</div>
            </div>
          )}
          {drawMode && (
            <div className={styles.mapHint}>
              {draftPoints.length < 3 ? 'Click to add corners' : 'Click the first corner or press Enter to finish'}
            </div>
          )}
          {!graph && !busy && !drawMode && (
            <div className={styles.mapHint}>
              {placeName ? `Adjust the area over ${placeName}, then extract.` : 'Find a place, set the area, then extract.'}
            </div>
          )}
          </div>
        </main>

        {view === 'city'
          ? <CityInspector selection={selection} lookups={cityLookups} onSelect={setSelection} />
          : <Inspector selection={selection} lookups={graphLookups} onSelect={setSelection} />}
      </div>
    </div>
  );
}
