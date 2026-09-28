import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../utils/api.js';
import Logo from '../Logo.jsx';
import NetworkMap from '../network/NetworkMap.jsx';
import { buildCityScene, cityLegend, LOAD_STOPS, QUEUE_STOPS } from '../network/scenes.js';
import { useCityStore } from '../../store/useCityStore.js';
import { DEFAULT_CITY_SIM_CONFIG } from '../../simulation/cityNetwork.js';
import CityEditPanel from './CityEditPanel.jsx';
import CityResults, { POLICY_COLORS } from './CityResults.jsx';
import { MAP_STYLES, useMapStyle } from '../network/useMapStyle.js';
import nx from '../network/NetworkExplorer.module.css';
import styles from './CitySimulator.module.css';

const SPEEDS = { 1: '1×', 3: '3×', 10: '10×', 30: '30×' };
const MAP_OPACITY = { off: 0, dim: 0.35, on: 1 };

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

  const {
    city, meta, config, overrides, inflows, snapshot, isRunning, stepsPerTick, engine,
    setConfig, setAllInflows, updateScenario, start, pause, reset, advance, runToEnd, setStepsPerTick,
  } = useCityStore();

  useEffect(() => {
    if (!api.isAuthenticated()) navigate('/');
    else setAuthChecked(true);
  }, [navigate]);

  // Run loop.
  useEffect(() => {
    if (!isRunning) return undefined;
    const timer = setInterval(() => advance(stepsPerTick), 80);
    return () => clearInterval(timer);
  }, [isRunning, stepsPerTick, advance]);

  const totalSteps = Math.max(1, Math.round((config.durationMin * 60) / config.stepSeconds));
  const edited = useMemo(() => new Set([
    ...Object.keys(overrides.edges || {}).map((id) => city?.edges.find((e) => e.id === id)?.roadId),
    ...Object.keys(overrides.edges || {}).map((id) => city?.edges.find((e) => e.id === id)?.to),
    ...Object.keys(inflows || {}).map((id) => city?.edges.find((e) => e.id === id)?.from),
  ].filter(Boolean)), [overrides, inflows, city]);

  const live = useMemo(() => {
    if (!snapshot || !engine) return null;
    const s = snapshot[liveView];
    return {
      queues: Object.fromEntries(Object.entries(s.intersections).map(([id, v]) => [id, v.totalQueued])),
      phases: Object.fromEntries(Object.entries(s.intersections).map(([id, v]) => [id, v.currentPhase])),
      edgeCars: s.edges,
      edgeStorage: Object.fromEntries(engine.network.edges.map((e) => [e.id, e.storageVeh])),
    };
  }, [snapshot, liveView, engine]);

  const scene = useMemo(
    () => (city ? buildCityScene(city, { shape, showLabels, live, marked: edited, lightMap: mapStyle === 'light' && mapMode !== 'off' }) : null),
    [city, shape, showLabels, live, edited, mapStyle, mapMode],
  );
  const fitTarget = useMemo(() => {
    if (!city) return null;
    const nodes = [...city.intersections, ...city.gateways];
    const lats = nodes.map((n) => n.lat);
    const lons = nodes.map((n) => n.lon);
    return { box: { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) }, key: meta?.placeName || 'city' };
  }, [city, meta]);

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
          <p>Select an area in the Network Explorer, extract its city graph and press “Open in City Simulator”.</p>
          <Link to="/network" className={nx.primaryBtn}>Open the Network Explorer</Link>
        </div>
      </div>
    );
  }

  const s = city.summary;
  const progress = snapshot ? snapshot.time / totalSteps : 0;
  const editedCount = Object.keys(overrides.edges || {}).length + Object.keys(inflows || {}).length;
  const secondsLabel = (steps) => `${steps * config.stepSeconds} s`;

  return (
    <div className={nx.page}>
      {header}
      <div className={nx.body}>
        <aside className={nx.sidebar}>
          <section className={nx.panel}>
            <h2>{meta?.placeName || 'City network'}</h2>
            <div className={nx.statGrid}>
              <div className={nx.statTile}><span className={nx.statValue}>{s.intersections}</span><span className={nx.statLabel}>Intersections</span></div>
              <div className={nx.statTile}><span className={nx.statValue}>{s.sources}</span><span className={nx.statLabel}>Sources</span></div>
              <div className={nx.statTile}><span className={nx.statValue}>{s.sinks}</span><span className={nx.statLabel}>Sinks</span></div>
            </div>
            <Link to="/network" className={nx.linkBtn}>Choose a different area…</Link>
          </section>

          <section className={nx.panel}>
            <h2>Run</h2>
            <div className={styles.runRow}>
              {isRunning
                ? <button type="button" className={nx.primaryBtn} onClick={pause}>Pause</button>
                : <button type="button" className={nx.primaryBtn} onClick={start} disabled={snapshot?.isComplete}>{snapshot && snapshot.time > 0 ? 'Resume' : 'Run'}</button>}
              <button type="button" className={nx.secondaryBtn} onClick={() => advance(1)} disabled={isRunning || snapshot?.isComplete}>Step</button>
              <button type="button" className={nx.secondaryBtn} onClick={runToEnd} disabled={isRunning || snapshot?.isComplete}>To end</button>
              <button type="button" className={nx.secondaryBtn} onClick={reset} disabled={!snapshot}>Reset</button>
            </div>
            <div className={styles.progress}><div style={{ width: `${progress * 100}%` }} /></div>
            <div className={styles.progressLabel}>
              minute {snapshot ? ((snapshot.time * config.stepSeconds) / 60).toFixed(1) : '0.0'} of {config.durationMin}
              {snapshot?.isComplete && ' · finished'}
            </div>
            <Field label="Speed"><Segmented options={SPEEDS} value={stepsPerTick} onChange={(v) => setStepsPerTick(Number(v))} /></Field>
            <Field label="Colour the map by">
              <Segmented options={{ fixed: 'Fixed cycle', greedy: 'Your policy' }} value={liveView} onChange={setLiveView} />
            </Field>
          </section>

          <section className={nx.panel}>
            <h2>Traffic</h2>
            <Field label="Default inflow per feeder lane" hint="Used for every feeder you have not edited">
              <div className={styles.inline}>
                <NumberField value={config.defaultInflowVphPerLane} step={50} onChange={(v) => setConfig({ defaultInflowVphPerLane: v })} />
                <span className={styles.unit}>veh/h</span>
              </div>
            </Field>
            <Field label="Default turn shares (left / through / right %)">
              <div className={styles.inline}>
                {['L', 'T', 'R'].map((turn) => (
                  <NumberField
                    key={turn}
                    value={Math.round(config.defaultTurn[turn] * 100)}
                    max={100}
                    step={5}
                    onChange={(v) => setConfig({ defaultTurn: { ...config.defaultTurn, [turn]: v / 100 } })}
                  />
                ))}
              </div>
            </Field>
            <p className={nx.hint}>Click a green source square to set the inflow of each feeder road, an intersection for its turn shares, or a road for lanes and speed.</p>
            {editedCount > 0 && (
              <div className={styles.editedRow}>
                <span>{editedCount} edited value{editedCount === 1 ? '' : 's'}</span>
                <button type="button" className={nx.linkBtn} onClick={() => updateScenario({ overrides: { edges: {} } })}>clear road edits</button>
                <button type="button" className={nx.linkBtn} onClick={() => setAllInflows({})}>clear inflow edits</button>
              </div>
            )}
          </section>

          <section className={nx.panel}>
            <h2>Timing</h2>
            <div className={styles.fieldGrid}>
              <Field label="Step length">
                <select className={styles.select} value={config.stepSeconds} onChange={(e) => {
                  const next = Number(e.target.value);
                  const scale = config.stepSeconds / next;
                  setConfig({
                    stepSeconds: next,
                    fixedCycleInterval: Math.max(1, Math.round(config.fixedCycleInterval * scale)),
                    greedyDecisionInterval: Math.max(1, Math.round(config.greedyDecisionInterval * scale)),
                    lookaheadH: Math.max(1, Math.round(config.lookaheadH * scale)),
                  });
                }}>
                  {[1, 2, 5, 10].map((v) => <option key={v} value={v}>{v} s</option>)}
                </select>
              </Field>
              <Field label="Duration (min)"><NumberField value={config.durationMin} min={1} onChange={(v) => setConfig({ durationMin: v })} /></Field>
              <Field label="Fixed phase (steps)" hint={secondsLabel(config.fixedCycleInterval)}><NumberField value={config.fixedCycleInterval} min={1} onChange={(v) => setConfig({ fixedCycleInterval: v })} /></Field>
              <Field label="Decision every (steps)" hint={secondsLabel(config.greedyDecisionInterval)}><NumberField value={config.greedyDecisionInterval} min={1} onChange={(v) => setConfig({ greedyDecisionInterval: v })} /></Field>
              <Field label="Lookahead (steps)" hint={secondsLabel(config.lookaheadH)}><NumberField value={config.lookaheadH} min={1} onChange={(v) => setConfig({ lookaheadH: v })} /></Field>
              <Field label="Random seed"><NumberField value={config.seed} onChange={(v) => setConfig({ seed: v })} /></Field>
            </div>
            <label className={nx.checkRow}>
              <input type="checkbox" checked={config.spillback} onChange={(e) => setConfig({ spillback: e.target.checked })} />
              Full roads block traffic behind them
            </label>
            <p className={nx.hint}>Off = same behaviour as the grid simulator. On = a road holds at most length × lanes ÷ 7.5 m vehicles.</p>
            <button type="button" className={nx.collapseHead} onClick={() => setShowWeights((v) => !v)} aria-expanded={showWeights}>
              <span className={styles.subTitle}>Policy weights</span><span>{showWeights ? '−' : '+'}</span>
            </button>
            {showWeights && (
              <div className={styles.fieldGrid}>
                <Field label="Total wait"><NumberField value={config.totalWaitWeight} step={0.1} onChange={(v) => setConfig({ totalWaitWeight: v })} /></Field>
                <Field label="Wait imbalance"><NumberField value={config.totalWaitStdWeight} step={0.1} onChange={(v) => setConfig({ totalWaitStdWeight: v })} /></Field>
                <Field label="Queue length"><NumberField value={config.queueWeight} step={0.1} onChange={(v) => setConfig({ queueWeight: v })} /></Field>
                <Field label="Queue imbalance"><NumberField value={config.queueStdWeight} step={0.1} onChange={(v) => setConfig({ queueStdWeight: v })} /></Field>
              </div>
            )}
            <button type="button" className={nx.linkBtn} onClick={() => setConfig({ ...DEFAULT_CITY_SIM_CONFIG })}>restore default settings</button>
          </section>
        </aside>

        <main className={styles.main}>
          <div className={styles.mapWrap}>
            <NetworkMap
              scene={scene}
              selection={selection}
              onSelect={setSelection}
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
                  <div className={nx.legendTitle}>Vehicles queued · {liveView === 'fixed' ? 'Fixed cycle' : 'Your policy'}</div>
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
              <div className={nx.legendNote}>White outline = edited by you</div>
            </div>}
            <CityEditPanel selection={selection} onSelect={setSelection} />
          </div>

          <div className={`${styles.drawer} ${resultsOpen ? styles.drawerOpen : ''}`}>
            <button type="button" className={styles.drawerHead} onClick={() => setResultsOpen((v) => !v)} aria-expanded={resultsOpen}>
              <span>Results: <i style={{ background: POLICY_COLORS.fixed }} /> Fixed cycle vs <i style={{ background: POLICY_COLORS.greedy }} /> your policy</span>
              <span>{resultsOpen ? 'Hide ▾' : 'Show ▴'}</span>
            </button>
            {resultsOpen && (
              <div className={styles.drawerBody}>
                <CityResults snapshot={snapshot} stepSeconds={config.stepSeconds} city={city} onSelect={setSelection} />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
