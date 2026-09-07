import { useState, useCallback, useMemo } from 'react';
import { useSimStore } from '../store/useSimStore.js';
import { DIRECTIONS, EXIT_TO_NEIGHBOR_DELTA, APPROACH_TO_HEADING, HEADING_LABELS } from '../simulation/constants.js';
import { ARRIVAL_PROFILE_TYPES, makeConstantInflowProfile, makeFunctionInflowProfile, makeDefaultDistributionConfig } from '../simulation/arrivalProfile.js';
import CityImportPanel from './CityImportPanel.jsx';
import styles from './ConfigPanel.module.css';

const DIR_HEADING = { N: 'Northbound', S: 'Southbound', E: 'Eastbound', W: 'Westbound' };

const BOUNDARY_APPROACH_INFO = {
  N: {
    title: 'North Boundary Inflow',
    badge: 'North Boundary (Heading South)',
    color: '#38bdf8',
    desc: 'Traffic entering the city grid from the North perimeter (heading Southbound towards row 0).',
  },
  S: {
    title: 'South Boundary Inflow',
    badge: 'South Boundary (Heading North)',
    color: '#a78bfa',
    desc: 'Traffic entering the city grid from the South perimeter (heading Northbound towards row N-1).',
  },
  E: {
    title: 'East Boundary Inflow',
    badge: 'East Boundary (Heading West)',
    color: '#2dd4bf',
    desc: 'Traffic entering the city grid from the East perimeter (heading Westbound towards col N-1).',
  },
  W: {
    title: 'West Boundary Inflow',
    badge: 'West Boundary (Heading East)',
    color: '#f472b6',
    desc: 'Traffic entering the city grid from the West perimeter (heading Eastbound towards col 0).',
  },
};

function getRoadDirection(fromR, fromC, toR, toC) {
  if (toR < fromR) return 'N';
  if (toR > fromR) return 'S';
  if (toC > fromC) return 'E';
  return 'W';
}

function toInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return n;
}

const HIDDEN_FUNCTION_TYPES = new Set(['exponentialLookup', 'logisticLookup', 'cycle7']);
const ALLOWED_FUNCTION_TYPES = new Set([
  'step',
  'piecewiseLinear',
  'triangular',
  'square',
  'sawtooth',
  'pulseTrain',
  'randomSeeded',
  'sinCos',
]);

function cloneProfile(profile) {
  if (!profile) return makeConstantInflowProfile(0);
  return {
    ...profile,
    functionConfig: {
      ...(profile.functionConfig || makeFunctionInflowProfile().functionConfig),
      params: { ...(profile.functionConfig?.params || {}) },
      piecewiseSegments: (profile.functionConfig?.piecewiseSegments || []).map((s) => ({ ...s })),
    },
    distributionConfig: profile.distributionConfig
      ? { ...profile.distributionConfig, params: { ...(profile.distributionConfig.params || {}) } }
      : undefined,
  };
}

function InflowFunctionEditor({ profile, onChange, disabled }) {
  const fnCfg = profile.functionConfig || makeFunctionInflowProfile().functionConfig;
  const params = fnCfg.params || {};

  const patchFnCfg = (patch) => {
    onChange({
      ...profile,
      functionConfig: {
        ...fnCfg,
        ...patch,
      },
    });
  };

  const patchParams = (patch) => {
    patchFnCfg({ params: { ...params, ...patch } });
  };

  const setSegment = (idx, patch) => {
    const next = (fnCfg.piecewiseSegments || []).map((seg, i) => (i === idx ? { ...seg, ...patch } : seg));
    patchFnCfg({ piecewiseSegments: next });
  };

  const addSegment = () => {
    const segs = fnCfg.piecewiseSegments || [];
    const last = segs[segs.length - 1] || { end: 0, toValue: 0 };
    patchFnCfg({ piecewiseSegments: [...segs, { start: toInt(last.end, 0) + 1, end: toInt(last.end, 0) + 10, fromValue: toInt(last.toValue, 0), toValue: toInt(last.toValue, 0) }] });
  };

  const removeSegment = (idx) => {
    const segs = fnCfg.piecewiseSegments || [];
    if (segs.length <= 1) return;
    patchFnCfg({ piecewiseSegments: segs.filter((_, i) => i !== idx) });
  };

  const profileInfo = ARRIVAL_PROFILE_TYPES.find((p) => p.value === fnCfg.profileType);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', padding: '10px', background: '#0b0f19', border: '1px dashed #334155', borderRadius: '6px' }}>
      <div className={styles.roadField}>
        <span>Function Type</span>
        <select
          value={fnCfg.profileType}
          title={profileInfo?.description || ''}
          onChange={(e) => patchFnCfg({ profileType: e.target.value })}
          disabled={disabled}
        >
          {ARRIVAL_PROFILE_TYPES.filter((p) => p.value !== 'constant' && !HIDDEN_FUNCTION_TYPES.has(p.value) && ALLOWED_FUNCTION_TYPES.has(p.value)).map((p) => (
            <option key={p.value} value={p.value} title={p.description}>{p.label}</option>
          ))}
        </select>
      </div>
      <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{profileInfo?.description}</div>

      {fnCfg.profileType === 'step' && (
        <div className={styles.roadFields}>
          <div className={styles.roadField}><span>t0</span><input type="number" min="0" value={params.stepStart ?? 0} onChange={(e) => patchParams({ stepStart: toInt(e.target.value, 0) })} disabled={disabled} /></div>
          <div className={styles.roadField}><span>Low</span><input type="number" min="0" value={params.stepLow ?? 0} onChange={(e) => patchParams({ stepLow: toInt(e.target.value, 0) })} disabled={disabled} /></div>
          <div className={styles.roadField}><span>High</span><input type="number" min="0" value={params.stepHigh ?? 0} onChange={(e) => patchParams({ stepHigh: toInt(e.target.value, 0) })} disabled={disabled} /></div>
        </div>
      )}

      {fnCfg.profileType === 'piecewiseLinear' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {(fnCfg.piecewiseSegments || []).map((seg, idx) => (
            <div key={`seg-${idx}`} className={styles.roadFields}>
              <div className={styles.roadField}><span>Start</span><input type="number" min="0" value={seg.start} onChange={(e) => setSegment(idx, { start: toInt(e.target.value, 0) })} disabled={disabled} /></div>
              <div className={styles.roadField}><span>End</span><input type="number" min="0" value={seg.end} onChange={(e) => setSegment(idx, { end: toInt(e.target.value, 0) })} disabled={disabled} /></div>
              <div className={styles.roadField}><span>From</span><input type="number" min="0" value={seg.fromValue} onChange={(e) => setSegment(idx, { fromValue: toInt(e.target.value, 0) })} disabled={disabled} /></div>
              <div className={styles.roadField}><span>To</span><input type="number" min="0" value={seg.toValue} onChange={(e) => setSegment(idx, { toValue: toInt(e.target.value, 0) })} disabled={disabled} /></div>
              <button className={`${styles.btn} ${styles.btnReset}`} type="button" onClick={() => removeSegment(idx)} disabled={disabled} style={{ padding: '4px 8px', fontSize: '0.75rem' }}>Del</button>
            </div>
          ))}
          <button className={`${styles.btn} ${styles.btnStep}`} type="button" onClick={addSegment} disabled={disabled} style={{ padding: '4px 8px', fontSize: '0.75rem', width: 'fit-content' }}>Add Segment</button>
        </div>
      )}

      {fnCfg.profileType === 'triangular' && (
        <div className={styles.roadFields}>
          <div className={styles.roadField}><span>Min</span><input type="number" min="0" value={params.triangleMin ?? 0} onChange={(e) => patchParams({ triangleMin: toInt(e.target.value, 0) })} disabled={disabled} /></div>
          <div className={styles.roadField}><span>Max</span><input type="number" min="0" value={params.triangleMax ?? 0} onChange={(e) => patchParams({ triangleMax: toInt(e.target.value, 0) })} disabled={disabled} /></div>
          <div className={styles.roadField}><span>Period</span><input type="number" min="2" value={params.trianglePeriod ?? 2} onChange={(e) => patchParams({ trianglePeriod: toInt(e.target.value, 2) })} disabled={disabled} /></div>
        </div>
      )}

      {fnCfg.profileType === 'square' && (
        <div className={styles.roadFields}>
          <div className={styles.roadField}><span>Low</span><input type="number" min="0" value={params.squareLow ?? 0} onChange={(e) => patchParams({ squareLow: toInt(e.target.value, 0) })} disabled={disabled} /></div>
          <div className={styles.roadField}><span>High</span><input type="number" min="0" value={params.squareHigh ?? 0} onChange={(e) => patchParams({ squareHigh: toInt(e.target.value, 0) })} disabled={disabled} /></div>
          <div className={styles.roadField}><span>Period</span><input type="number" min="2" value={params.squarePeriod ?? 2} onChange={(e) => patchParams({ squarePeriod: toInt(e.target.value, 2) })} disabled={disabled} /></div>
        </div>
      )}

      {fnCfg.profileType === 'sawtooth' && (
        <div className={styles.roadFields}>
          <div className={styles.roadField}><span>Min</span><input type="number" min="0" value={params.sawMin ?? 0} onChange={(e) => patchParams({ sawMin: toInt(e.target.value, 0) })} disabled={disabled} /></div>
          <div className={styles.roadField}><span>Max</span><input type="number" min="0" value={params.sawMax ?? 0} onChange={(e) => patchParams({ sawMax: toInt(e.target.value, 0) })} disabled={disabled} /></div>
          <div className={styles.roadField}><span>Period</span><input type="number" min="2" value={params.sawPeriod ?? 2} onChange={(e) => patchParams({ sawPeriod: toInt(e.target.value, 2) })} disabled={disabled} /></div>
        </div>
      )}

      {fnCfg.profileType === 'pulseTrain' && (
        <div className={styles.roadFields}>
          <div className={styles.roadField}><span>Base</span><input type="number" min="0" value={params.pulseBase ?? 0} onChange={(e) => patchParams({ pulseBase: toInt(e.target.value, 0) })} disabled={disabled} /></div>
          <div className={styles.roadField}><span>Peak</span><input type="number" min="0" value={params.pulsePeak ?? 0} onChange={(e) => patchParams({ pulsePeak: toInt(e.target.value, 0) })} disabled={disabled} /></div>
          <div className={styles.roadField}><span>Every</span><input type="number" min="1" value={params.pulseEvery ?? 1} onChange={(e) => patchParams({ pulseEvery: toInt(e.target.value, 1) })} disabled={disabled} /></div>
          <div className={styles.roadField}><span>Width</span><input type="number" min="1" value={params.pulseWidth ?? 1} onChange={(e) => patchParams({ pulseWidth: toInt(e.target.value, 1) })} disabled={disabled} /></div>
        </div>
      )}

      {fnCfg.profileType === 'randomSeeded' && (
        <div className={styles.roadFields}>
          <div className={styles.roadField}><span>Min</span><input type="number" min="0" value={params.randomMin ?? 0} onChange={(e) => patchParams({ randomMin: toInt(e.target.value, 0) })} disabled={disabled} /></div>
          <div className={styles.roadField}><span>Max</span><input type="number" min="0" value={params.randomMax ?? 0} onChange={(e) => patchParams({ randomMax: toInt(e.target.value, 0) })} disabled={disabled} /></div>
          <div className={styles.roadField}><span>Seed+</span><input type="number" min="0" value={params.randomSeedOffset ?? 0} onChange={(e) => patchParams({ randomSeedOffset: toInt(e.target.value, 0) })} disabled={disabled} /></div>
        </div>
      )}

      {fnCfg.profileType === 'sinCos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div className={styles.roadFields}>
            <div className={styles.roadField}>
              <span>Freq</span>
              <select value={params.sinCosMode ?? 'period'} onChange={(e) => patchParams({ sinCosMode: e.target.value })} disabled={disabled}>
                <option value="period">Period</option>
                <option value="omega">Omega</option>
              </select>
            </div>
            <div className={styles.roadField}>
              <span>Phase</span>
              <select value={params.sinCosPhaseUnit ?? 'rad'} onChange={(e) => patchParams({ sinCosPhaseUnit: e.target.value })} disabled={disabled}>
                <option value="rad">rad</option>
                <option value="deg">deg</option>
              </select>
            </div>
          </div>
          <div className={styles.roadFields}>
            <div className={styles.roadField}><span>Off</span><input type="number" min="0" step="0.1" value={params.sinCosOffset ?? 4} onChange={(e) => patchParams({ sinCosOffset: Number(e.target.value) || 0 })} disabled={disabled} /></div>
            <div className={styles.roadField}><span>A</span><input type="number" min="0" step="0.1" value={params.sinCosA ?? 2} onChange={(e) => patchParams({ sinCosA: Math.max(0, Number(e.target.value) || 0) })} disabled={disabled} /></div>
            <div className={styles.roadField}><span>B</span><input type="number" min="0" step="0.1" value={params.sinCosB ?? 1} onChange={(e) => patchParams({ sinCosB: Math.max(0, Number(e.target.value) || 0) })} disabled={disabled} /></div>
            {(params.sinCosMode ?? 'period') === 'period' ? (
              <div className={styles.roadField}><span>P</span><input type="number" min="1" step="0.1" value={params.sinCosPeriod ?? 24} onChange={(e) => patchParams({ sinCosPeriod: Math.max(1, Number(e.target.value) || 1) })} disabled={disabled} /></div>
            ) : (
              <div className={styles.roadField}><span>w</span><input type="number" min="0" step="0.01" value={params.sinCosOmega ?? 0.261799} onChange={(e) => patchParams({ sinCosOmega: Math.max(0, Number(e.target.value) || 0) })} disabled={disabled} /></div>
            )}
            <div className={styles.roadField}><span>phi</span><input type="number" step="0.1" value={params.sinCosPhi ?? 0} onChange={(e) => patchParams({ sinCosPhi: Number(e.target.value) || 0 })} disabled={disabled} /></div>
            <div className={styles.roadField}><span>psi</span><input type="number" step="0.1" value={params.sinCosPsi ?? 0} onChange={(e) => patchParams({ sinCosPsi: Number(e.target.value) || 0 })} disabled={disabled} /></div>
          </div>
        </div>
      )}
    </div>
  );
}

function InflowDistributionEditor({ profile, onChange, disabled }) {
  const distCfg = profile.distributionConfig || makeDefaultDistributionConfig();
  const distParams = distCfg.params || {};

  const patchDistCfg = (patch) => {
    onChange({
      ...profile,
      distributionConfig: {
        ...distCfg,
        ...patch,
      },
    });
  };

  const patchDistParams = (patch) => {
    patchDistCfg({ params: { ...distParams, ...patch } });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', padding: '10px', background: '#0b0f19', border: '1px dashed #334155', borderRadius: '6px' }}>
      <div className={styles.roadField}>
        <span>Distribution</span>
        <select value={distCfg.distributionType || 'poisson'} onChange={(e) => patchDistCfg({ distributionType: e.target.value })} disabled={disabled}>
          <option value="poisson">Poisson Distribution</option>
          <option value="normal">Normal (Gaussian) Distribution</option>
          <option value="binomial">Binomial Distribution</option>
          <option value="uniform">Uniform Distribution</option>
          <option value="bernoulli">Bernoulli Distribution</option>
          <option value="geometric">Geometric Distribution</option>
        </select>
      </div>

      <div className={styles.roadFields}>
        {distCfg.distributionType === 'poisson' && (
          <div className={styles.roadField}><span>Lambda (Mean)</span><input type="number" min="0" step="0.1" value={distParams.lambda ?? 2} onChange={(e) => patchDistParams({ lambda: Number(e.target.value) || 0 })} disabled={disabled} /></div>
        )}
        {distCfg.distributionType === 'normal' && (
          <>
            <div className={styles.roadField}><span>Mean (μ)</span><input type="number" min="0" step="0.1" value={distParams.mean ?? 5} onChange={(e) => patchDistParams({ mean: Number(e.target.value) || 0 })} disabled={disabled} /></div>
            <div className={styles.roadField}><span>Std Dev (σ)</span><input type="number" min="0.1" step="0.1" value={distParams.stdDev ?? 1.5} onChange={(e) => patchDistParams({ stdDev: Number(e.target.value) || 0.1 })} disabled={disabled} /></div>
          </>
        )}
        {distCfg.distributionType === 'binomial' && (
          <>
            <div className={styles.roadField}><span>Trials (n)</span><input type="number" min="1" value={distParams.trials ?? 10} onChange={(e) => patchDistParams({ trials: toInt(e.target.value, 1) })} disabled={disabled} /></div>
            <div className={styles.roadField}><span>Probability (p)</span><input type="number" min="0" max="1" step="0.05" value={distParams.probability ?? 0.5} onChange={(e) => patchDistParams({ probability: Number(e.target.value) || 0 })} disabled={disabled} /></div>
          </>
        )}
        {distCfg.distributionType === 'uniform' && (
          <>
            <div className={styles.roadField}><span>Min</span><input type="number" min="0" value={distParams.min ?? 0} onChange={(e) => patchDistParams({ min: toInt(e.target.value, 0) })} disabled={disabled} /></div>
            <div className={styles.roadField}><span>Max</span><input type="number" min="0" value={distParams.max ?? 10} onChange={(e) => patchDistParams({ max: toInt(e.target.value, 0) })} disabled={disabled} /></div>
          </>
        )}
        {distCfg.distributionType === 'bernoulli' && (
          <div className={styles.roadField}><span>Probability</span><input type="number" min="0" max="1" step="0.05" value={distParams.probability ?? 0.5} onChange={(e) => patchDistParams({ probability: Number(e.target.value) || 0 })} disabled={disabled} /></div>
        )}
        {distCfg.distributionType === 'geometric' && (
          <div className={styles.roadField}><span>Probability</span><input type="number" min="0.01" max="1" step="0.05" value={distParams.probability ?? 0.5} onChange={(e) => patchDistParams({ probability: Number(e.target.value) || 0.1 })} disabled={disabled} /></div>
        )}
      </div>

      <div className={styles.roadFields}>
        <div className={styles.roadField}>
          <span>Random Seed</span>
          <input type="number" min="0" value={distCfg.seed ?? 42} onChange={(e) => patchDistCfg({ seed: toInt(e.target.value, 42) })} disabled={disabled} />
        </div>
      </div>
    </div>
  );
}

export default function ConfigPanel() {
  const config = useSimStore((s) => s.config);
  const updateConfig = useSimStore((s) => s.updateConfig);
  const isRunning = useSimStore((s) => s.isRunning);
  const isPaused = useSimStore((s) => s.isPaused);

  const boundaryInflowOverrides = useSimStore((s) => s.boundaryInflowOverrides);
  const setBoundaryInflowOverride = useSimStore((s) => s.setBoundaryInflowOverride);
  const departureRateOverrides = useSimStore((s) => s.departureRateOverrides);
  const setDepartureRateOverride = useSimStore((s) => s.setDepartureRateOverride);
  const roadOverrides = useSimStore((s) => s.roadOverrides);
  const setRoadOverride = useSimStore((s) => s.setRoadOverride);
  const boundaryRoadOverrides = useSimStore((s) => s.boundaryRoadOverrides);
  const setBoundaryRoadOverride = useSimStore((s) => s.setBoundaryRoadOverride);

  const [showBoundaryInflow, setShowBoundaryInflow] = useState(false);
  const [showDepartureRate, setShowDepartureRate] = useState(false);
  const [showRoads, setShowRoads] = useState(false);
  const [activeTab, setActiveTab] = useState('network');

  const simActive = isRunning || isPaused;

  const handleNumField = useCallback(
    (key, value) => {
      const num = parseFloat(value);
      if (!isNaN(num) && num >= 0) {
        updateConfig({ [key]: num });
      }
    },
    [updateConfig]
  );

  const setDefaultBoundaryProfile = useCallback((dir, nextProfile) => {
    updateConfig({
      defaultBoundaryInflowProfiles: {
        ...config.defaultBoundaryInflowProfiles,
        [dir]: nextProfile,
      },
    });
  }, [config.defaultBoundaryInflowProfiles, updateConfig]);

  const gridSize = config.gridSize;

  const internalRoads = useMemo(() => {
    const roads = [];
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        for (const dir of DIRECTIONS) {
          const [dr, dc] = EXIT_TO_NEIGHBOR_DELTA[dir];
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize) {
            const key = `${r},${c}->${nr},${nc}`;
            const heading = getRoadDirection(r, c, nr, nc);
            roads.push({ key, fromR: r, fromC: c, toR: nr, toC: nc, heading, label: `${DIR_HEADING[heading]}: (${r},${c}) to (${nr},${nc})` });
          }
        }
      }
    }
    return roads;
  }, [gridSize]);

  const boundaryRoads = useMemo(() => {
    const roads = [];
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const dirs = [];
        if (r === 0) dirs.push('N');
        if (r === gridSize - 1) dirs.push('S');
        if (c === 0) dirs.push('W');
        if (c === gridSize - 1) dirs.push('E');
        for (const d of dirs) {
          const heading = APPROACH_TO_HEADING[d];
          const bndKey = `bnd_${d}_${r},${c}`;
          roads.push({ bndKey, r, c, approach: d, heading, label: `${DIR_HEADING[heading]}: boundary into (${r},${c})` });
        }
      }
    }
    return roads;
  }, [gridSize]);

  const boundaryIntersections = useMemo(() => {
    const items = [];
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const dirs = [];
        if (r === 0) dirs.push('N');
        if (r === gridSize - 1) dirs.push('S');
        if (c === 0) dirs.push('W');
        if (c === gridSize - 1) dirs.push('E');
        if (dirs.length > 0) items.push({ r, c, dirs });
      }
    }
    return items;
  }, [gridSize]);

  return (
    <div className={styles.configPanel}>
      <h2>Simulation Parameters</h2>
      
      {/* Visual Navigation Tabs */}
      <div className={styles.tabRow}>
        <button className={`${styles.tabBtn} ${activeTab === 'network' ? styles.activeTab : ''}`} onClick={() => setActiveTab('network')}>
          Network & City Import
        </button>
        <button className={`${styles.tabBtn} ${activeTab === 'control' ? styles.activeTab : ''}`} onClick={() => setActiveTab('control')}>
          Algorithm Weights & Horizon
        </button>
        <button className={`${styles.tabBtn} ${activeTab === 'overrides' ? styles.activeTab : ''}`} onClick={() => setActiveTab('overrides')}>
          Boundary Inflow & Road Overrides
        </button>
      </div>

      {activeTab === 'network' && (
        <>
          <CityImportPanel />
          
          <div className={styles.sectionTitle}>Network Dimensions & Global Seed</div>
          <div className={styles.configGrid}>
            <div className={styles.fieldGroup}>
              <label>Grid Size (N × N Intersections)</label>
              <input type="number" min="2" max="10" value={config.gridSize} onChange={(e) => handleNumField('gridSize', e.target.value)} disabled={simActive} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Total Duration (Steps)</label>
              <input type="number" min="10" max="5000" value={config.simDuration} onChange={(e) => handleNumField('simDuration', e.target.value)} disabled={simActive} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Simulation Seed</label>
              <input type="number" min="0" value={config.seed} onChange={(e) => handleNumField('seed', e.target.value)} disabled={simActive} />
            </div>
          </div>

          <div className={styles.sectionTitle}>Standard Road Properties</div>
          <div className={styles.configGrid}>
            <div className={styles.fieldGroup}>
              <label>Default Speed (units/step)</label>
              <input type="number" min="0.1" max="20" step="0.1" value={config.defaultRoadSpeed} onChange={(e) => handleNumField('defaultRoadSpeed', e.target.value)} disabled={simActive} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Default Road Length (units)</label>
              <input type="number" min="1" max="100" step="1" value={config.defaultRoadLength} onChange={(e) => handleNumField('defaultRoadLength', e.target.value)} disabled={simActive} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Computed Free-Flow Travel Time</label>
              <div className={styles.computedValue}>{Math.max(1, Math.ceil(config.defaultRoadLength / config.defaultRoadSpeed))} simulation steps</div>
            </div>
          </div>

          <div className={styles.sectionTitle}>Default Intersection Turning Ratios</div>
          <div className={styles.configGrid}>
            <div className={styles.fieldGroup}>
              <label>Straight / Through (T)</label>
              <input type="number" min="0" max="1" step="0.05" value={config.defaultTurnProbT} onChange={(e) => handleNumField('defaultTurnProbT', e.target.value)} disabled={simActive} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Right Turn (R)</label>
              <input type="number" min="0" max="1" step="0.05" value={config.defaultTurnProbR} onChange={(e) => handleNumField('defaultTurnProbR', e.target.value)} disabled={simActive} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Left Turn (L, free turn)</label>
              <input type="number" min="0" max="1" step="0.05" value={config.defaultTurnProbL} onChange={(e) => handleNumField('defaultTurnProbL', e.target.value)} disabled={simActive} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Ratio Sum</label>
              <div className={styles.computedValue} style={{ color: Math.abs(config.defaultTurnProbT + config.defaultTurnProbR + config.defaultTurnProbL - 1) < 0.01 ? '#10b981' : '#ef4444' }}>
                {(config.defaultTurnProbT + config.defaultTurnProbR + config.defaultTurnProbL).toFixed(2)} {Math.abs(config.defaultTurnProbT + config.defaultTurnProbR + config.defaultTurnProbL - 1) < 0.01 ? '(Balanced)' : '(Must sum to 1.0)'}
              </div>
            </div>
          </div>

          <div className={styles.sectionTitle}>Default Intersection Departure Rate</div>
          <div className={styles.configGrid}>
            <div className={styles.fieldGroup}>
              <label>Vehicles served per green step</label>
              <input type="number" min="1" max="50" value={config.baseDepartureRate} onChange={(e) => handleNumField('baseDepartureRate', e.target.value)} disabled={simActive} />
            </div>
          </div>
        </>
      )}

      {activeTab === 'control' && (
        <>
          <div className={styles.sectionTitle}>Intervals & Decision Horizon</div>
          <div className={styles.configGrid}>
            <div className={styles.fieldGroup}>
              <label>Fixed-Cycle Phase-Change Interval</label>
              <input type="number" min="1" max="20" value={config.fixedCycleInterval} onChange={(e) => handleNumField('fixedCycleInterval', e.target.value)} disabled={simActive} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Greedy Decision Interval</label>
              <input type="number" min="1" max="20" value={config.greedyDecisionInterval} onChange={(e) => {
                const num = parseInt(e.target.value, 10);
                if (!isNaN(num) && num >= 1) {
                  updateConfig({ greedyDecisionInterval: num });
                  if (config.lookaheadH > num) {
                    updateConfig({ lookaheadH: num });
                  }
                }
              }} disabled={simActive} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Lookahead Horizon (H)</label>
              <input type="number" min="1" max={config.greedyDecisionInterval} value={config.lookaheadH} onChange={(e) => {
                const num = parseInt(e.target.value, 10);
                if (!isNaN(num) && num >= 1) {
                  if (num > config.greedyDecisionInterval) return;
                  updateConfig({ lookaheadH: num });
                }
              }} disabled={simActive} />
            </div>
          </div>

          <div className={styles.sectionTitle}>Greedy Cost Function Penalty Weights</div>
          <div style={{ color: '#94a3b8', fontSize: '0.78rem', fontFamily: 'monospace', marginBottom: '12px', padding: '10px 14px', background: '#0b0f19', borderRadius: '8px', border: '1px solid #1e293b', lineHeight: 1.6 }}>
            Objective Score = <strong style={{ color: '#38bdf8' }}>w1</strong>·sum(Wait) + <strong style={{ color: '#38bdf8' }}>w2</strong>·std(Wait) + <strong style={{ color: '#38bdf8' }}>w3</strong>·sum(Queue) + <strong style={{ color: '#38bdf8' }}>w4</strong>·std(Queue)
          </div>
          <div className={styles.configGrid}>
            <div className={styles.fieldGroup}>
              <label>Total Wait Penalty (w1)</label>
              <input type="number" min="0" max="10" step="0.1" value={config.totalWaitWeight} onChange={(e) => handleNumField('totalWaitWeight', e.target.value)} disabled={simActive} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Wait Variance Penalty (w2)</label>
              <input type="number" min="0" max="10" step="0.1" value={config.totalWaitStdWeight} onChange={(e) => handleNumField('totalWaitStdWeight', e.target.value)} disabled={simActive} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Queue Length Penalty (w3)</label>
              <input type="number" min="0" max="10" step="0.1" value={config.queueWeight} onChange={(e) => handleNumField('queueWeight', e.target.value)} disabled={simActive} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Queue Variance Penalty (w4)</label>
              <input type="number" min="0" max="10" step="0.1" value={config.queueStdWeight} onChange={(e) => handleNumField('queueStdWeight', e.target.value)} disabled={simActive} />
            </div>
          </div>
        </>
      )}

      {activeTab === 'overrides' && (
        <>
          <div className={styles.sectionTitle}>City Perimeter Inflow Approaches (Incoming Traffic from Outside)</div>
          <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '-4px', marginBottom: '16px' }}>
            Configure default vehicle generation rates at each outer boundary of the road network:
          </p>

          <div className={styles.configGrid} style={{ gridTemplateColumns: '1fr' }}>
            <div className={styles.fieldGroup}>
              <label>Global Inflow Cap (Max vehicles allowed into city per step)</label>
              <input type="number" min="0" max="500" value={config.inflowGlobalCap} onChange={(e) => updateConfig({ inflowGlobalCap: Math.max(0, toInt(e.target.value, 0)) })} disabled={simActive} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
            {['N', 'S', 'E', 'W'].map((dir) => {
              const info = BOUNDARY_APPROACH_INFO[dir];
              const baseProfile = cloneProfile(config.defaultBoundaryInflowProfiles[dir]);
              return (
                <div key={dir} style={{ background: '#0b0f19', border: `1px solid #1e293b`, borderTop: `3px solid ${info.color}`, borderRadius: '8px', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: info.color }}>
                      {info.title}
                    </span>
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8', background: '#0f172a', border: '1px solid #1e293b', padding: '2px 6px', borderRadius: '4px' }}>
                      {dir === 'N' ? 'Row 0' : dir === 'S' ? `Row ${gridSize - 1}` : dir === 'W' ? 'Col 0' : `Col ${gridSize - 1}`}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: '0 0 10px 0', lineHeight: 1.35 }}>
                    {info.desc}
                  </p>

                  <div className={styles.roadFields}>
                    <div className={styles.roadField} style={{ width: '100%' }}>
                      <span>Profile Mode</span>
                      <select
                        value={baseProfile.mode || 'constant'}
                        onChange={(e) => {
                          const mode = e.target.value;
                          if (mode === 'constant') {
                            setDefaultBoundaryProfile(dir, { ...baseProfile, mode: 'constant' });
                          } else if (mode === 'distribution') {
                            setDefaultBoundaryProfile(dir, {
                              ...baseProfile,
                              mode: 'distribution',
                              distributionConfig: baseProfile.distributionConfig || makeDefaultDistributionConfig(),
                            });
                          } else {
                            setDefaultBoundaryProfile(dir, { ...baseProfile, mode: 'function' });
                          }
                        }}
                        disabled={simActive}
                      >
                        <option value="constant">Constant Inflow Rate</option>
                        <option value="function">Mathematical Function</option>
                        <option value="distribution">Stochastic Distribution</option>
                      </select>
                    </div>
                  </div>

                  {baseProfile.mode === 'constant' && (
                    <div className={styles.roadFields} style={{ marginTop: '8px' }}>
                      <div className={styles.roadField} style={{ width: '100%' }}>
                        <span>Rate (cars/step)</span>
                        <input
                          type="number"
                          min="0"
                          value={baseProfile.constantValue ?? 0}
                          onChange={(e) => setDefaultBoundaryProfile(dir, { ...baseProfile, constantValue: Math.max(0, toInt(e.target.value, 0)) })}
                          disabled={simActive}
                        />
                      </div>
                    </div>
                  )}

                  {baseProfile.mode === 'function' && (
                    <InflowFunctionEditor
                      profile={baseProfile}
                      onChange={(nextProfile) => setDefaultBoundaryProfile(dir, nextProfile)}
                      disabled={simActive}
                    />
                  )}

                  {baseProfile.mode === 'distribution' && (
                    <InflowDistributionEditor
                      profile={baseProfile}
                      onChange={(nextProfile) => setDefaultBoundaryProfile(dir, nextProfile)}
                      disabled={simActive}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Collapsible Specific Per-Road Overrides */}
          <div className={`${styles.collapsible} ${showRoads ? styles.open : ''}`} onClick={() => setShowRoads(!showRoads)}>
            <span className={styles.sectionTitle}>Specific Per-Road Overrides (Speed limits, Lengths, Turns)</span>
          </div>
          <div className={`${styles.advancedSection} ${showRoads ? styles.open : ''}`}>
            <div className={styles.roadSubTitle}>Internal Road Segments (Between Intersections)</div>
            <div className={styles.roadList}>
              {internalRoads.map(({ key, label }) => {
                const ov = roadOverrides[key] || {};
                return (
                  <div key={key} className={styles.roadItem}>
                    <div className={styles.roadLabel}>{label}</div>
                    <div className={styles.roadFields}>
                      <div className={styles.roadField}>
                        <span>Speed</span>
                        <input type="number" min="0.1" max="20" step="0.1" placeholder={String(config.defaultRoadSpeed)} value={ov.speed ?? ''} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setRoadOverride(key, 'speed', v); }} disabled={simActive} />
                      </div>
                      <div className={styles.roadField}>
                        <span>Length</span>
                        <input type="number" min="1" max="100" step="1" placeholder={String(config.defaultRoadLength)} value={ov.length ?? ''} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setRoadOverride(key, 'length', v); }} disabled={simActive} />
                      </div>
                      <div className={styles.roadField}>
                        <span>Through (T)</span>
                        <input type="number" min="0" max="1" step="0.05" placeholder={String(config.defaultTurnProbT)} value={ov.turnT ?? ''} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setRoadOverride(key, 'turnT', v); }} disabled={simActive} />
                      </div>
                      <div className={styles.roadField}>
                        <span>Right (R)</span>
                        <input type="number" min="0" max="1" step="0.05" placeholder={String(config.defaultTurnProbR)} value={ov.turnR ?? ''} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setRoadOverride(key, 'turnR', v); }} disabled={simActive} />
                      </div>
                      <div className={styles.roadField}>
                        <span>Left (L)</span>
                        <input type="number" min="0" max="1" step="0.05" placeholder={String(config.defaultTurnProbL)} value={ov.turnL ?? ''} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setRoadOverride(key, 'turnL', v); }} disabled={simActive} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={styles.roadSubTitle}>Boundary Incoming Roads (Entering City from Edges)</div>
            <div className={styles.roadList}>
              {boundaryRoads.map(({ bndKey, label }) => {
                const ov = boundaryRoadOverrides[bndKey] || {};
                return (
                  <div key={bndKey} className={styles.roadItem}>
                    <div className={styles.roadLabel}>{label}</div>
                    <div className={styles.roadFields}>
                      <div className={styles.roadField}>
                        <span>Through (T)</span>
                        <input type="number" min="0" max="1" step="0.05" placeholder={String(config.defaultTurnProbT)} value={ov.turnT ?? ''} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setBoundaryRoadOverride(bndKey, 'turnT', v); }} disabled={simActive} />
                      </div>
                      <div className={styles.roadField}>
                        <span>Right (R)</span>
                        <input type="number" min="0" max="1" step="0.05" placeholder={String(config.defaultTurnProbR)} value={ov.turnR ?? ''} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setBoundaryRoadOverride(bndKey, 'turnR', v); }} disabled={simActive} />
                      </div>
                      <div className={styles.roadField}>
                        <span>Left (L)</span>
                        <input type="number" min="0" max="1" step="0.05" placeholder={String(config.defaultTurnProbL)} value={ov.turnL ?? ''} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setBoundaryRoadOverride(bndKey, 'turnL', v); }} disabled={simActive} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Collapsible Specific Per-Intersection Inflow Overrides */}
          <div className={`${styles.collapsible} ${showBoundaryInflow ? styles.open : ''}`} onClick={() => setShowBoundaryInflow(!showBoundaryInflow)}>
            <span className={styles.sectionTitle}>Specific Per-Intersection Inflow Overrides</span>
          </div>
          <div className={`${styles.advancedSection} ${showBoundaryInflow ? styles.open : ''}`}>
            <div className={styles.roadList}>
              {boundaryIntersections.map(({ r, c, dirs }) => {
                const key = `${r},${c}`;
                return (
                  <div key={key} className={styles.roadItem}>
                    <div className={styles.roadLabel}>Intersection ({r},{c})</div>
                    <div className={styles.roadFields}>
                      {dirs.map((dir) => {
                        const overrideProfile = boundaryInflowOverrides[key]?.[dir] || null;
                        const heading = APPROACH_TO_HEADING[dir];
                        const effectiveProfile = overrideProfile ? cloneProfile(overrideProfile) : cloneProfile(config.defaultBoundaryInflowProfiles[dir]);
                        return (
                          <div key={dir} style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
                            <div className={styles.roadFields}>
                              <div className={styles.roadField}>
                                <span>{HEADING_LABELS[heading]}</span>
                                <select
                                  value={overrideProfile ? effectiveProfile.mode : 'default'}
                                  onChange={(e) => {
                                    const mode = e.target.value;
                                    if (mode === 'default') {
                                      setBoundaryInflowOverride(r, c, dir, null);
                                      return;
                                    }
                                    if (mode === 'constant') {
                                      setBoundaryInflowOverride(r, c, dir, { ...cloneProfile(config.defaultBoundaryInflowProfiles[dir]), mode: 'constant' });
                                      return;
                                    }
                                    if (mode === 'distribution') {
                                      const base = cloneProfile(config.defaultBoundaryInflowProfiles[dir]);
                                      setBoundaryInflowOverride(r, c, dir, {
                                        ...base,
                                        mode: 'distribution',
                                        distributionConfig: base.distributionConfig || makeDefaultDistributionConfig(),
                                      });
                                      return;
                                    }
                                    setBoundaryInflowOverride(r, c, dir, { ...cloneProfile(config.defaultBoundaryInflowProfiles[dir]), mode: 'function' });
                                  }}
                                  disabled={simActive}
                                >
                                  <option value="default">Default</option>
                                  <option value="constant">Constant</option>
                                  <option value="function">Function</option>
                                  <option value="distribution">Distribution</option>
                                </select>
                              </div>

                              {overrideProfile && effectiveProfile.mode === 'constant' && (
                                <div className={styles.roadField}>
                                  <span>Val</span>
                                  <input
                                    type="number"
                                    min="0"
                                    value={effectiveProfile.constantValue ?? 0}
                                    onChange={(e) => {
                                      setBoundaryInflowOverride(r, c, dir, { ...effectiveProfile, constantValue: Math.max(0, toInt(e.target.value, 0)) });
                                    }}
                                    disabled={simActive}
                                  />
                                </div>
                              )}
                            </div>

                            {overrideProfile && effectiveProfile.mode === 'function' && (
                              <InflowFunctionEditor
                                profile={effectiveProfile}
                                onChange={(nextProfile) => setBoundaryInflowOverride(r, c, dir, nextProfile)}
                                disabled={simActive}
                              />
                            )}

                            {overrideProfile && effectiveProfile.mode === 'distribution' && (
                              <InflowDistributionEditor
                                profile={effectiveProfile}
                                onChange={(nextProfile) => setBoundaryInflowOverride(r, c, dir, nextProfile)}
                                disabled={simActive}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Collapsible Specific Per-Intersection Departure Rates */}
          <div className={`${styles.collapsible} ${showDepartureRate ? styles.open : ''}`} onClick={() => setShowDepartureRate(!showDepartureRate)}>
            <span className={styles.sectionTitle}>Specific Per-Intersection Departure Rates</span>
          </div>
          <div className={`${styles.advancedSection} ${showDepartureRate ? styles.open : ''}`}>
            <div className={styles.roadList}>
              {Array.from({ length: gridSize * gridSize }, (_, i) => {
                const r = Math.floor(i / gridSize);
                const c = i % gridSize;
                const key = `${r},${c}`;
                const ov = departureRateOverrides[key] || {};
                return (
                  <div key={key} className={styles.roadItem}>
                    <div className={styles.roadLabel}>Intersection ({r},{c})</div>
                    <div className={styles.roadFields}>
                      {[
                        { dir: 'N', label: 'North' },
                        { dir: 'S', label: 'South' },
                        { dir: 'E', label: 'East' },
                        { dir: 'W', label: 'West' }
                      ].map(({ dir, label }) => (
                        <div key={dir} className={styles.roadField}>
                          <span>{label}</span>
                          <input 
                            type="number" 
                            min="1" 
                            max="50" 
                            placeholder={String(config.baseDepartureRate)} 
                            value={ov[dir] ?? ''} 
                            onChange={(e) => { 
                              const v = parseInt(e.target.value, 10); 
                              if (!isNaN(v) && v > 0) setDepartureRateOverride(r, c, dir, v); 
                            }} 
                            disabled={simActive} 
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
