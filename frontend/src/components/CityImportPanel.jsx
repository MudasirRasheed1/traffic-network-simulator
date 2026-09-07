import { useMemo, useState } from 'react';
import { useSimStore } from '../store/useSimStore.js';
import {
  explainNominatimShape,
  explainOverpassShape,
  fetchMajorRoadNetwork,
  getBBoxFromPlace,
  searchAddressCandidates,
  summarizeOverpassResult,
  summarizePlaceResult,
} from '../simulation/osmApi.js';
import styles from './CityImportPanel.module.css';

const ENABLE_API_LOGS = false;

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildImportedScenarioInWorker(place, overpassData, timeoutMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../simulation/importWorker.js', import.meta.url), { type: 'module' });
    const timeoutId = setTimeout(() => {
      worker.terminate();
      reject(new Error('Import worker timed out while building scenario'));
    }, timeoutMs);

    worker.onmessage = (event) => {
      clearTimeout(timeoutId);
      worker.terminate();
      const payload = event.data || {};
      if (payload.ok) resolve(payload.imported);
      else reject(new Error(payload.error || 'Import worker failed'));
    };

    worker.onerror = () => {
      clearTimeout(timeoutId);
      worker.terminate();
      reject(new Error('Import worker crashed'));
    };

    worker.postMessage({ place, overpassData });
  });
}

export default function CityImportPanel() {
  const scenarioMode = useSimStore((s) => s.scenarioMode);
  const apiLogs = useSimStore((s) => s.apiLogs);
  const appendApiLog = useSimStore((s) => s.appendApiLog);
  const clearApiLogs = useSimStore((s) => s.clearApiLogs);
  const setMapPreview = useSimStore((s) => s.setMapPreview);
  const restoreManualScenario = useSimStore((s) => s.restoreManualScenario);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [status, setStatus] = useState('');

  const safeAppendApiLog = (entry) => {
    if (!ENABLE_API_LOGS) return;
    appendApiLog(entry);
  };

  const selectedPlace = useMemo(() => results[selectedIndex] || null, [results, selectedIndex]);

  const onSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setStatus('Searching addresses...');

    try {
      const candidates = await searchAddressCandidates(query.trim(), 5);
      setResults(candidates);
      setSelectedIndex(0);

      safeAppendApiLog({
        source: 'nominatim',
        kind: 'search',
        summary: `Returned ${candidates.length} candidate(s) for "${query.trim()}"`,
        details: {
          candidates: candidates.map(summarizePlaceResult),
          responseSchema: explainNominatimShape(candidates[0] || null),
        },
      });

      if (candidates[0]) {
        setMapPreview({
          center: [Number(candidates[0].lat), Number(candidates[0].lon)],
          placeName: candidates[0].display_name,
          bbox: getBBoxFromPlace(candidates[0]),
        });
      }

      setStatus(candidates.length ? 'Select a result and import.' : 'No matches found.');
    } catch (error) {
      setStatus(`Search failed: ${error.message}`);
      safeAppendApiLog({
        source: 'nominatim',
        kind: 'error',
        summary: `Search error: ${error.message}`,
      });
      console.error('Nominatim search failed', error);
    } finally {
      setIsSearching(false);
    }
  };

  const onImport = async () => {
    if (!selectedPlace) return;

    setIsImporting(true);
    setStatus('Fetching road network...');

    try {
      const bbox = getBBoxFromPlace(selectedPlace);
      const overpass = await fetchMajorRoadNetwork(bbox, {
        place: selectedPlace,
        onProgress: (p) => {
          if (p.phase === 'area-start') {
            setStatus('Fetching road network from OSM city transport area...');
          }
          if (p.phase === 'area-failed') {
            setStatus('Area fetch failed, falling back to tiled fetch...');
          }
          if (p.phase === 'tile-start') {
            setStatus(`Fetching road network... tile ${p.index}/${p.total}`);
          }
          if (p.phase === 'tile-failed') {
            setStatus(`Fetching road network... tile ${p.index}/${p.total} failed, continuing`);
          }
          if (p.phase === 'tile-budget-cutoff') {
            setStatus(`Fetched large network (${p.cumulativeElements} elements). Stopping early to keep UI responsive...`);
          }
        },
      });

      const overpassSummary = summarizeOverpassResult(overpass);
      if (overpassSummary.fetchMeta?.trimmedByBudget) {
        setStatus(`Large network trimmed from ${overpassSummary.fetchMeta.originalElementCount} to ${overpassSummary.fetchMeta.finalElementCount} elements for stability...`);
      }
      safeAppendApiLog({
        source: 'overpass',
        kind: 'network',
        summary: `Network fetched: ${overpassSummary.wayCount} ways, ${overpassSummary.nodeCount} nodes, ${overpassSummary.relationCount} relation(s), ${overpassSummary.trafficSignalNodeCount} signal node(s)`,
        details: {
          summary: overpassSummary,
          responseSchema: explainOverpassShape(overpass),
        },
      });

      const elementCount = overpass?.elements?.length || 0;
      const workerTimeoutMs = Math.min(300000, Math.max(120000, elementCount * 2));
      setStatus(`Building simulation model in background worker... (${elementCount} elements)`);
      const imported = await buildImportedScenarioInWorker(selectedPlace, overpass, workerTimeoutMs);

      safeAppendApiLog({
        source: 'parser',
        kind: 'transform',
        summary: `Mapped to ${imported.configPatch.gridSize}x${imported.configPatch.gridSize} adaptive grid with ${imported.meta.markers.length} mapped point(s)`,
        details: {
          gridSize: imported.configPatch.gridSize,
          mappedPoints: imported.meta.markers.length,
          placeName: imported.meta.placeName,
          validationReport: imported.meta.validationReport,
        },
      });

      if (imported.meta?.accurateTopology?.summary) {
        const t = imported.meta.accurateTopology.summary;
        safeAppendApiLog({
          source: 'topology',
          kind: 'graph',
          summary: `Constructed topology graph: ${t.topologyNodeCount} node(s), ${t.topologyEdgeCount} directed edge(s), ${t.restrictionCountResolved} resolved restriction(s)`,
          details: t,
        });
      }

      // Visual import only: keep fetched map/graph visible, but do not mutate
      // simulator parameters from imported OSM-derived calibration.
      setMapPreview({
        center: imported.meta.center,
        placeName: imported.meta.placeName,
        bbox: imported.meta.bbox,
        roads: imported.meta.roads,
        markers: imported.meta.markers,
        graphEdges: imported.meta.graphEdges,
        originGridKey: imported.meta.originGridKey,
      });

      setStatus('Imported map and graph are ready for visualization. Simulator parameters were not changed.');
    } catch (error) {
      setStatus(`Import failed: ${error.message}`);
      safeAppendApiLog({
        source: 'import',
        kind: 'error',
        summary: `Import error: ${error.message}`,
      });
      console.error('City import failed', error);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.headerRow}>
        <h3>Real-World City Import</h3>
        <div className={styles.modeBadge}>{scenarioMode === 'imported' ? 'Imported Mode' : 'Manual Mode'}</div>
      </div>

      <div className={styles.row}>
        <input
          type="text"
          placeholder="Enter exact address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={isSearching || isImporting}
        />
        <button type="button" onClick={onSearch} disabled={isSearching || isImporting || !query.trim()}>
          {isSearching ? 'Searching...' : 'Search'}
        </button>
      </div>

      {results.length > 0 && (
        <div className={styles.row}>
          <select
            value={selectedIndex}
            onChange={(e) => {
              const idx = Number(e.target.value);
              setSelectedIndex(idx);
              const p = results[idx];
              if (p) {
                setMapPreview({
                  center: [Number(p.lat), Number(p.lon)],
                  placeName: p.display_name,
                  bbox: getBBoxFromPlace(p),
                });
              }
            }}
            disabled={isImporting}
          >
            {results.map((r, idx) => (
              <option key={`${r.osm_type}-${r.osm_id}-${idx}`} value={idx}>
                {r.display_name}
              </option>
            ))}
          </select>
          <button type="button" onClick={onImport} disabled={isImporting || !selectedPlace}>
            {isImporting ? 'Importing...' : 'Import Map View'}
          </button>
        </div>
      )}

      <div className={styles.actionsRow}>
        <button type="button" onClick={restoreManualScenario} disabled={scenarioMode === 'manual'}>
          Switch to Manual
        </button>
        <button type="button" onClick={clearApiLogs} disabled={!ENABLE_API_LOGS}>
          Clear Logs
        </button>
      </div>

      {status && <div className={styles.status}>{status}</div>}

      {ENABLE_API_LOGS && (
        <div className={styles.logPanel}>
          <div className={styles.logTitle}>API Logs</div>
          {apiLogs.length === 0 && <div className={styles.logEmpty}>No logs yet.</div>}
          {apiLogs.slice().reverse().map((log) => (
            <div className={styles.logItem} key={log.id}>
              <div className={styles.logLine}><strong>{log.source}</strong> - {log.summary}</div>
              <div className={styles.logMeta}>{new Date(log.at).toLocaleTimeString()}</div>
              {log.details && <pre>{JSON.stringify(log.details, null, 2)}</pre>}
              {log.raw && (
                <button
                  type="button"
                  onClick={() => downloadJson(`osm-log-${log.id}.json`, log.raw)}
                >
                  Download Raw JSON
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
