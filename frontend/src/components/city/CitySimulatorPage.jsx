import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../utils/api.js';
import Logo from '../Logo.jsx';
import NetworkMap from '../network/NetworkMap.jsx';
import { buildCityScene, cityLegend, LOAD_STOPS, QUEUE_STOPS } from '../network/scenes.js';
import { useCityStore } from '../../store/useCityStore.js';
import { DEFAULT_CITY_SIM_CONFIG } from '../../simulation/cityNetwork.js';
import { addNode, connectNodes, moveNode, splitRoadAt } from '../../network/cityModel.js';
import { makeConstantInflowProfile } from '../../simulation/arrivalProfile.js';
import CityEditPanel from './CityEditPanel.jsx';
import CityStatsDashboard from './CityStatsDashboard.jsx';
import MultiSeedPanel from './MultiSeedPanel.jsx';
import { MAP_STYLES, useMapStyle } from '../network/useMapStyle.js';
import nx from '../network/NetworkExplorer.module.css';
import styles from './CitySimulator.module.css';

// Same colours as the analytics dashboard (grid simulator convention).
const POLICY_COLORS = { fixed: '#f59e0b', greedy: '#22c55e' };
const MAP_OPACITY = { off: 0, dim: 0.35, on: 1 };
const NODE_TOOLS = { intersection: 'Add intersection', junction: 'Add junction', gateway: 'Add source/sink' };
const NODE_TYPES = ['intersection', 'junction', 'gateway'];

function Segmented({ options, value, onChange, disabled }) {
  return (
    <div className={nx.segmented}>
      {Object.entries(options).map(([key, label]) => (
        <button key={key} type="button" className={String(value) === String(key) ? nx.segActive : ''} onClick={() => onChange(key)} disabled={disabled}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {hint && <em>{hint}</em>}
    </label>
  );
}

function NumberField({ value, onChange, min = 0, step = 1, max }) {
  return (
    <input
      className={styles.numInput}
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= min && (max == null || v <= max)) onChange(v);
      }}
    />
  );
}

export default function CitySimulatorPage() {
  const navigate = useNavigate();
  const [authChecked, setAuthChecked] = useState(false);
  const [selection, setSelection] = useState(null);
  const [liveView, setLiveView] = useState('greedy');
  const [shape, setShape] = useState('straight');
  const [mapMode, setMapMode] = useState('dim');
  const [mapStyle, setMapStyle] = useMapStyle();
  const [showLabels, setShowLabels] = useState(true);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [showWeights, setShowWeights] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  // Editing: tool is null, a node kind to place, 'road' or 'move'.
  const [tool, setTool] = useState(null);
  const [toolNode, setToolNode] = useState(null);
  const [twoWay, setTwoWay] = useState(true);
  const [notice, setNotice] = useState(null);

  const {
    city, meta, config, overrides, inflows, snapshot, isRunning, speed, engine, history, future, original,
    setConfig, setAllInflows, clearOverrides, start, pause, reset, stepOnce, runToEnd, setSpeed,
    editModel, undo, redo, restoreOriginal,
  } = useCityStore();

  const stopTool = useCallback(() => {
    setTool(null);
    setToolNode(null);
  }, []);
  useEffect(() => {
    if (!tool) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') stopTool(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, stopTool]);

  // A click on a node, road or source while a tool is active.
  const handleSelect = (target, at) => {
    if (tool === 'road') {
      if (!target || !NODE_TYPES.includes(target.type)) return;
      if (!toolNode) {
        setToolNode(target.id);
        return;
      }
      if (target.id === toolNode) return;
      const added = editModel((m) => connectNodes(m, toolNode, target.id, { twoWay }));
      setNotice(added ? null : `${toolNode} and ${target.id} are already connected ${twoWay ? 'both ways' : 'in that direction'}.`);
      setSelection({ type: 'road', id: `R:${[toolNode, target.id].sort().join('~')}`, linkId: added || undefined });
      stopTool();
      return;
    }
    if (NODE_TYPES.includes(tool)) {
      // Placing on a road puts the new node into that road.
      if (target?.type === 'road' && at) {
        const road = city.roads.find((r) => r.id === target.id);
        const id = road && editModel((m) => splitRoadAt(m, road.linkIds, at[0], at[1], tool));
        if (id) setSelection({ type: tool, id });
        stopTool();
      }
      return;
    }
    if (tool === 'move') return;
    setSelection(target);
  };
  // A click on empty map while placing or moving.
  const handleMapClick = (lat, lon) => {
    if (NODE_TYPES.includes(tool)) {
      const id = editModel((m) => addNode(m, tool, lat, lon));
      if (id) setSelection({ type: tool, id });
    } else if (tool === 'move' && toolNode) {
      editModel((m) => moveNode(m, toolNode, lat, lon));
    }
    stopTool();
  };
  const tools = {
    startMove: (id) => { setTool('move'); setToolNode(id); },
    startRoad: (id) => { setNotice(null); setTool('road'); setToolNode(id); },
  };
  const toolHint = !tool ? null
    : tool === 'road' ? (toolNode ? `Click the node where the road from ${toolNode} ends. Esc cancels.` : 'Click the node where the road starts. Esc cancels.')
      : tool === 'move' ? `Click the new position for ${toolNode}. Esc cancels.`
        : 'Click the map, or a road to place it on that road. Esc cancels.';

  useEffect(() => {
    if (!api.isAuthenticated()) navigate('/');
    else setAuthChecked(true);
  }, [navigate]);

  const totalSteps = Math.max(1, config.simDuration);
  const sideDefault = config.defaultBoundaryInflowProfiles?.N;
  const defaultCarsPerStep = sideDefault?.mode === 'constant' ? sideDefault.constantValue : '';
  const turnSum = config.defaultTurnProbT + config.defaultTurnProbR + config.defaultTurnProbL;
  const turnBalanced = Math.abs(turnSum - 1) < 0.01;
  const edited = useMemo(() => {
    if (!city) return new Set();
    const linkById = new Map(city.links.map((l) => [l.id, l]));
    return new Set([
      ...Object.keys(overrides.links || {}).map((id) => linkById.get(id)?.roadId),
      ...Object.keys(overrides.turns || {}),
      ...Object.keys(overrides.departure || {}),
      ...Object.keys(inflows || {}).map((id) => linkById.get(id)?.from),
      ...city.model.nodes.filter((n) => n.custom).map((n) => n.id),
      ...city.links.filter((l) => l.custom).map((l) => l.roadId),
    ].filter(Boolean));
  }, [overrides, inflows, city]);

  const live = useMemo(() => {
    if (!snapshot || !engine) return null;
    const s = snapshot[liveView];
    return {
      queues: Object.fromEntries(Object.entries(s.intersections).map(([id, v]) => [id, v.totalQueued])),
      phases: Object.fromEntries(Object.entries(s.intersections).map(([id, v]) => [id, v.currentPhase])),
      linkCars: s.links || {},
    };
  }, [snapshot, liveView, engine]);

  const scene = useMemo(
    () => (city ? buildCityScene(city, { shape, showLabels, live, marked: edited, lightMap: mapStyle === 'light' && mapMode !== 'off', pending: toolNode, labelJunctions: Boolean(tool) }) : null),
    [city, shape, showLabels, live, edited, mapStyle, mapMode, toolNode, tool],
  );
  // What is selected must still exist after an edit or an undo.
  const activeSelection = useMemo(() => {
    if (!selection || !city) return null;
    if (selection.type === 'road') {
      const road = city.roads.find((r) => r.id === selection.id);
      if (!road) return null;
      return { type: 'road', id: road.id, linkId: road.linkIds.includes(selection.linkId) ? selection.linkId : undefined };
    }
    const node = city.model.nodes.find((n) => n.id === selection.id);
    return node ? { type: node.kind, id: node.id } : null;
  }, [selection, city]);
  const fitTarget = useMemo(() => {
    if (!city) return null;
    const nodes = city.model.nodes;
    if (!nodes.length) return null;
    const lats = nodes.map((n) => n.lat);
    const lons = nodes.map((n) => n.lon);
    return { box: { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) }, key: meta?.placeName || 'city' };
    // Fit once per loaded city, not after every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original, meta]);

  if (!authChecked) return null;

  const header = (
    <header className={nx.topbar}>
      <Logo size="small" subtitle="City Simulator" />
      <nav className={nx.nav}>
        <Link to="/simulator">Grid Simulator</Link>
        <Link to="/city-sim" className={nx.navActive}>City Simulator</Link>
        <Link to="/network">Network Explorer</Link>
        <Link to="/saved-simulations">Saved Archives</Link>
        <Link to="/docs">Docs</Link>
      </nav>
    </header>
  );

  if (!city) {
    return (
      <div className={nx.page}>
        {header}
        <div className={styles.emptyState}>
          <h2>No city network loaded</h2>
          <p>Extract a city graph in the Network Explorer, then open it here.</p>
          <Link to="/network" className={nx.primaryBtn}>Open the Network Explorer</Link>
        </div>
      </div>
    );
  }

  const s = city.summary;
  const progress = snapshot ? snapshot.time / totalSteps : 0;
  const editedCount = Object.keys(overrides.links || {}).length + Object.keys(overrides.turns || {}).length + Object.keys(overrides.departure || {}).length + Object.keys(inflows || {}).length;
  const graphChanged = city.model !== original;

  return (
    <div className={nx.page}>
      {header}
      <div className={nx.body}>
        <aside className={nx.sidebar}>
          <section className={nx.panel}>
            <h2>{meta?.placeName || 'City network'}</h2>
            <div className={nx.statGrid}>
              <div className={nx.statTile}><span className={nx.statValue}>{s.intersections}</span><span className={nx.statLabel}>Intersections</span></div>
              <div className={nx.statTile}><span className={nx.statValue}>{s.junctions}</span><span className={nx.statLabel}>Junctions</span></div>
              <div className={nx.statTile}><span className={nx.statValue}>{s.roads}</span><span className={nx.statLabel}>Roads</span></div>
              <div className={nx.statTile}><span className={nx.statValue}>{s.sources}</span><span className={nx.statLabel}>Sources</span></div>
              <div className={nx.statTile}><span className={nx.statValue}>{s.sinks}</span><span className={nx.statLabel}>Sinks</span></div>
            </div>
            <Link to="/network" className={nx.linkBtn}>Change area</Link>
          </section>

          <section className={nx.panel}>
            <h2>Edit Network</h2>
            <div className={styles.toolGrid}>
              {Object.entries(NODE_TOOLS).map(([kind, label]) => (
                <button key={kind} type="button" className={`${nx.secondaryBtn} ${tool === kind ? styles.toolActive : ''}`} onClick={() => (tool === kind ? stopTool() : (setTool(kind), setToolNode(null)))}>{label}</button>
              ))}
              <button type="button" className={`${nx.secondaryBtn} ${tool === 'road' ? styles.toolActive : ''}`} onClick={() => (tool === 'road' ? stopTool() : (setTool('road'), setToolNode(null)))}>Add road</button>
              <button type="button" className={nx.secondaryBtn} onClick={undo} disabled={!history.length}>Undo</button>
              <button type="button" className={nx.secondaryBtn} onClick={redo} disabled={!future.length}>Redo</button>
            </div>
            <label className={nx.checkRow}>
              <input type="checkbox" checked={twoWay} onChange={(e) => setTwoWay(e.target.checked)} />
              New roads are two-way
            </label>
            {toolHint && <div className={styles.toolHint}>{toolHint}</div>}
            {!tool && notice && <div className={styles.toolHint}>{notice}</div>}
            {!tool && <p className={nx.hint}>Click anything on the map to change, move or delete it.</p>}
            {graphChanged && <button type="button" className={nx.linkBtn} onClick={() => { restoreOriginal(); setSelection(null); }}>Restore extracted graph</button>}
            {city.issues.length > 0 && (
              <ul className={styles.issueList}>
                {city.issues.map((issue) => (
                  <li key={issue.text}>
                    <button
                      type="button"
                      disabled={!issue.nodeId}
                      onClick={() => {
                        const node = city.model.nodes.find((n) => n.id === issue.nodeId);
                        if (node) setSelection({ type: node.kind, id: node.id });
                      }}
                    >
                      {issue.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={nx.panel}>
            <h2>Run</h2>
            <div className={styles.runRow}>
              {isRunning
                ? <button type="button" className={nx.primaryBtn} onClick={pause}>Pause</button>
                : <button type="button" className={nx.primaryBtn} onClick={start} disabled={snapshot?.isComplete}>{snapshot && snapshot.time > 0 ? 'Resume' : 'Run'}</button>}
              <button type="button" className={nx.secondaryBtn} onClick={stepOnce} disabled={isRunning || snapshot?.isComplete}>Step</button>
              <button type="button" className={nx.secondaryBtn} onClick={runToEnd} disabled={isRunning || snapshot?.isComplete}>To end</button>
              <button type="button" className={nx.secondaryBtn} onClick={reset} disabled={!snapshot}>Reset</button>
            </div>
            <div className={styles.progress}><div style={{ width: `${progress * 100}%` }} /></div>
            <div className={styles.progressLabel}>
              Step {snapshot ? snapshot.time : 0} / {config.simDuration}
              {snapshot?.isComplete && ' · complete'}
            </div>
            <Field label={`Simulation Speed: ${speed} steps/s`}>
              <input type="range" min="1" max="120" value={speed} onChange={(e) => setSpeed(parseInt(e.target.value, 10))} />
            </Field>
            <Field label="Colour the map by">
              <Segmented options={{ fixed: 'Fixed cycle', greedy: 'Greedy' }} value={liveView} onChange={setLiveView} />
            </Field>
          </section>

          <section className={nx.panel}>
            <h2>Traffic</h2>
            <Field label="Default Inflow per Source (cars/step)">
              <NumberField
                value={defaultCarsPerStep}
                min={0}
                onChange={(v) => {
                  const profile = makeConstantInflowProfile(Math.floor(v));
                  setConfig({ defaultBoundaryInflowProfiles: { N: profile, S: profile, E: profile, W: profile } });
                }}
              />
            </Field>
            <Field label="Global Inflow Cap (cars/step)">
              <NumberField value={config.inflowGlobalCap} min={0} onChange={(v) => setConfig({ inflowGlobalCap: Math.floor(v) })} />
            </Field>
            <div className={styles.subTitle}>Default Intersection Turning Ratios</div>
            <div className={styles.fieldGrid3}>
              <Field label="Through (T)"><NumberField value={config.defaultTurnProbT} max={1} step={0.05} onChange={(v) => setConfig({ defaultTurnProbT: v })} /></Field>
              <Field label="Right (R)"><NumberField value={config.defaultTurnProbR} max={1} step={0.05} onChange={(v) => setConfig({ defaultTurnProbR: v })} /></Field>
              <Field label="Left (L, free)"><NumberField value={config.defaultTurnProbL} max={1} step={0.05} onChange={(v) => setConfig({ defaultTurnProbL: v })} /></Field>
            </div>
            <div className={styles.ratioSum} style={{ color: turnBalanced ? '#10b981' : '#ef4444' }}>
              Ratio Sum {turnSum.toFixed(2)} {turnBalanced ? '(Balanced)' : '(Must sum to 1.0)'}
            </div>
            <Field label="Vehicles Served per Green Step (per lane)">
              <NumberField value={config.departurePerLane} min={1} onChange={(v) => setConfig({ departurePerLane: Math.max(1, Math.floor(v)) })} />
            </Field>
            {editedCount > 0 && (
              <div className={styles.editedRow}>
                <span>{editedCount} override{editedCount === 1 ? '' : 's'}</span>
                <button type="button" className={nx.linkBtn} onClick={clearOverrides}>Clear overrides</button>
                <button type="button" className={nx.linkBtn} onClick={() => setAllInflows({})}>Clear inflows</button>
              </div>
            )}
          </section>

          <section className={nx.panel}>
            <h2>Simulation</h2>
            <div className={styles.fieldGrid}>
              <Field label="Total Duration (Steps)"><NumberField value={config.simDuration} min={10} onChange={(v) => setConfig({ simDuration: Math.round(v) })} /></Field>
              <Field label="Simulation Seed"><NumberField value={config.seed} onChange={(v) => setConfig({ seed: Math.floor(v) })} /></Field>
              <Field label="Fixed-Cycle Phase-Change Interval"><NumberField value={config.fixedCycleInterval} min={1} onChange={(v) => setConfig({ fixedCycleInterval: Math.floor(v) })} /></Field>
              <Field label="Greedy Decision Interval">
                <NumberField
                  value={config.greedyDecisionInterval}
                  min={1}
                  onChange={(v) => {
                    const next = Math.max(1, Math.floor(v));
                    setConfig({ greedyDecisionInterval: next, ...(config.lookaheadH > next ? { lookaheadH: next } : {}) });
                  }}
                />
              </Field>
              <Field label="Lookahead Horizon (H)" hint={`Max ${config.greedyDecisionInterval}`}>
                <NumberField value={config.lookaheadH} min={1} max={config.greedyDecisionInterval} onChange={(v) => setConfig({ lookaheadH: Math.floor(v) })} />
              </Field>
            </div>
            <label className={nx.checkRow}>
              <input type="checkbox" checked={config.spillback} onChange={(e) => setConfig({ spillback: e.target.checked })} />
              Road capacity limit (spillback)
            </label>
            <button type="button" className={nx.collapseHead} onClick={() => setShowWeights((v) => !v)} aria-expanded={showWeights}>
              <span className={styles.subTitle}>Greedy Cost Function Penalty Weights</span><span>{showWeights ? '−' : '+'}</span>
            </button>
            {showWeights && (
              <>
                <div className={styles.formula}>
                  Score = <b>w1</b>·sum(Wait) + <b>w2</b>·std(Wait) + <b>w3</b>·sum(Queue) + <b>w4</b>·std(Queue)
                </div>
                <div className={styles.fieldGrid}>
                  <Field label="Total Wait Penalty (w1)"><NumberField value={config.totalWaitWeight} step={0.1} onChange={(v) => setConfig({ totalWaitWeight: v })} /></Field>
                  <Field label="Wait Variance Penalty (w2)"><NumberField value={config.totalWaitStdWeight} step={0.1} onChange={(v) => setConfig({ totalWaitStdWeight: v })} /></Field>
                  <Field label="Queue Length Penalty (w3)"><NumberField value={config.queueWeight} step={0.1} onChange={(v) => setConfig({ queueWeight: v })} /></Field>
                  <Field label="Queue Variance Penalty (w4)"><NumberField value={config.queueStdWeight} step={0.1} onChange={(v) => setConfig({ queueStdWeight: v })} /></Field>
                </div>
              </>
            )}
            <button type="button" className={nx.linkBtn} onClick={() => setConfig({ ...DEFAULT_CITY_SIM_CONFIG })}>Restore defaults</button>
          </section>
        </aside>

        <main className={styles.main}>
          <div className={styles.mapWrap}>
            <NetworkMap
              scene={scene}
              selection={activeSelection}
              onSelect={handleSelect}
              onMapClick={tool && tool !== 'road' ? handleMapClick : undefined}
              placing={Boolean(tool)}
              fitTarget={fitTarget}
              mapOpacity={MAP_OPACITY[mapMode]}
              mapStyle={mapStyle}
            />
            <div className={nx.mapControls} style={{ top: 12, flexWrap: 'wrap', maxWidth: 'calc(100% - 80px)' }}>
              <span>Roads</span>
              <Segmented options={{ straight: 'Straight', real: 'Real shape' }} value={shape} onChange={setShape} />
              <span>Map</span>
              <Segmented options={{ off: 'Off', dim: 'Dim', on: 'On' }} value={mapMode} onChange={setMapMode} />
              <Segmented options={MAP_STYLES} value={mapStyle} onChange={setMapStyle} />
              <Segmented options={{ on: 'Labels', off: 'No labels' }} value={showLabels ? 'on' : 'off'} onChange={(v) => setShowLabels(v === 'on')} />
              <button type="button" className={`${nx.secondaryBtn} ${showLegend ? nx.drawActive : ''}`} style={{ marginTop: 0, padding: '4px 10px' }} onClick={() => setShowLegend((v) => !v)}>Legend</button>
            </div>
            {showLegend && <div className={nx.legend}>
              {live ? (
                <>
                  <div className={nx.legendTitle}>Vehicles queued · {liveView === 'fixed' ? 'Fixed cycle' : 'Greedy'}</div>
                  {QUEUE_STOPS.map((st) => <div key={st.label} className={nx.legendRow}><span className={nx.legendDot} style={{ '--c': st.color }} />{st.label}</div>)}
                  <div className={nx.legendTitle}>Road fullness</div>
                  {LOAD_STOPS.map((st) => <div key={st.label} className={nx.legendRow}><span className={nx.legendLine} style={{ '--c': st.color }} />{st.label}</div>)}
                </>
              ) : (
                cityLegend().map((item) => (
                  <div key={item.label} className={nx.legendRow}>
                    <span
                      className={item.kind === 'line' ? nx.legendLine : item.kind === 'square' ? nx.legendSquare : item.ring ? nx.legendRingDot : nx.legendDot}
                      style={{ '--c': item.color, '--r': item.ring }}
                    />
                    {item.label}
                  </div>
                ))
              )}
              <div className={nx.legendNote}>White outline: edited</div>
            </div>}
            <CityEditPanel selection={activeSelection} onSelect={setSelection} tools={tools} />
          </div>

          <div className={`${styles.drawer} ${resultsOpen ? styles.drawerOpen : ''}`}>
            <button type="button" className={styles.drawerHead} onClick={() => setResultsOpen((v) => !v)} aria-expanded={resultsOpen}>
              <span>Results: <i style={{ background: POLICY_COLORS.fixed }} /> Fixed cycle vs <i style={{ background: POLICY_COLORS.greedy }} /> Greedy</span>
              <span>{resultsOpen ? 'Hide ▾' : 'Show ▴'}</span>
            </button>
            {resultsOpen && (
              <div className={styles.drawerBody}>
                <CityStatsDashboard snapshot={snapshot} config={config} city={city} />
                <div className={styles.seedSection}>
                  <MultiSeedPanel />
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
