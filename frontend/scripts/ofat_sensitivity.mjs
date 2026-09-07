import fs from 'node:fs';
import path from 'node:path';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { SimulationEngine } from '../src/simulation/engine.js';
import { makeConstantInflowProfile, makeDistributionInflowProfile } from '../src/simulation/arrivalProfile.js';

const OUTPUT_ROOT = path.resolve('analysis', 'ofat_sensitivity');
const DATA_DIR = path.join(OUTPUT_ROOT, 'data');
const PLOTS_DIR = path.join(OUTPUT_ROOT, 'plots');

const REGIMES = {
  arrivals_eq_departures: 'Arrivals = Departures',
  arrivals_gt_departures: 'Arrivals > Departures',
  arrivals_lt_departures: 'Arrivals < Departures',
};

const REGIME_ORDER = [
  'arrivals_lt_departures',
  'arrivals_eq_departures',
  'arrivals_gt_departures',
];

const ARRIVAL_MIN = 0;
const REGIME_BASELINE_ARRIVAL_MAX = {
  arrivals_lt_departures: 10,
  arrivals_eq_departures: 16,
  arrivals_gt_departures: 24,
};

const REGIME_BASELINE_DEPARTURE_RATE = {
  arrivals_lt_departures: 8,
  arrivals_eq_departures: 8,
  arrivals_gt_departures: 8,
};

const DEFAULT_PLOT_MIN_SIMS = 20;

const METRICS = [
  { key: 'throughput', label: 'Network Throughput (Final)' },
  { key: 'totalVehiclesEntered', label: 'Total Vehicles Entered (Final)' },
  { key: 'vehiclesInNetwork', label: 'Vehicles In Network (Final)' },
  { key: 'sumQueueSizes', label: 'Total Queue Size (Final)' },
  { key: 'sumAvgWaitTimes', label: 'Sum of Average Wait Times (Final)' },
  { key: 'sumTotalWaitTimes', label: 'Sum of Total Wait Times (Final)' },
  { key: 'sumStdTotalWaitTimes', label: 'Sum of Std Total Wait Times (Final)' },
];

const BASE_CONFIG = {
  gridSize: 5,
  simDuration: 500,
  defaultRoadSpeed: 2,
  defaultRoadLength: 12,
  defaultTurnProbT: 0.7,
  defaultTurnProbR: 0.15,
  defaultTurnProbL: 0.15,
  fixedCycleInterval: 5,
  greedyDecisionInterval: 5,
  lookaheadH: 5,
  alpha: 1.0,
  beta: 1.0,
  gamma: 1.0,
  totalWaitWeight: 1.0,
  totalWaitStdWeight: 1.0,
  queueWeight: 1.0,
  queueStdWeight: 1.0,
  baseDepartureRate: 8,
  inflowGlobalCap: 60,
  seed: 2,
};

const FACTORS = [
  { key: 'arrivalUniformMax', label: 'Uniform Arrival Max (veh/step/boundary stream)', min: 0, max: 40, integer: true, preferredPoints: 20, plotEnabled: false },
  { key: 'throughTurnProb', label: 'Through Turn Probability (T)', min: 0, max: 1, integer: false, preferredPoints: 20 },
  { key: 'leftTurnProb', label: 'Left Turn Probability (L)', min: 0, max: 1, integer: false, preferredPoints: 20 },
  { key: 'rightTurnProb', label: 'Right Turn Probability (R)', min: 0, max: 1, integer: false, preferredPoints: 20 },
  { key: 'defaultRoadSpeed', label: 'Default Road Speed (cells/step)', min: 1, max: 20, integer: false, preferredPoints: 20 },
  { key: 'defaultRoadLength', label: 'Default Road Length (cells)', min: 2, max: 100, integer: true, preferredPoints: 30 },
  { key: 'fixedCycleInterval', label: 'Fixed Cycle Interval (steps)', min: 1, max: 30, integer: true, preferredPoints: 20 },
  { key: 'greedyDecisionInterval', label: 'Greedy Decision Interval (steps)', min: 1, max: 30, integer: true, preferredPoints: 20 },
  { key: 'lookaheadH', label: 'Greedy Lookahead Horizon H (steps)', min: 1, max: 20, integer: true, preferredPoints: 20 },
  { key: 'totalWaitWeight', label: 'Total Wait Weight', min: 0, max: 20, integer: false, preferredPoints: 20 },
  { key: 'totalWaitStdWeight', label: 'Total Wait Std Weight', min: 0, max: 20, integer: false, preferredPoints: 20 },
  { key: 'queueWeight', label: 'Queue Size Weight', min: 0, max: 20, integer: false, preferredPoints: 20 },
  { key: 'queueStdWeight', label: 'Queue Std Weight', min: 0, max: 20, integer: false, preferredPoints: 20 },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, 'true');
    }
  }

  const minPoints = Math.max(10, Number(flags.get('min-points') || flags.get('points') || 20));
  const seeds = Math.max(1, Number(flags.get('seed-runs') || flags.get('seeds') || 2));
  const quick = flags.get('quick') === 'true';
  const onlyFactor = flags.get('factor') || null;
  const dryRun = flags.get('dry-run') === 'true';
  const plotMinSims = Math.max(1, Number(flags.get('plot-min-sims') || DEFAULT_PLOT_MIN_SIMS));
  const requestedRegimesRaw = (flags.get('regimes') || 'all').trim();
  let regimes;
  if (requestedRegimesRaw.toLowerCase() === 'all') {
    regimes = [...REGIME_ORDER];
  } else {
    regimes = requestedRegimesRaw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => Object.prototype.hasOwnProperty.call(REGIMES, x));
  }

  if (!regimes.length) {
    throw new Error(`Invalid --regimes value: ${requestedRegimesRaw}. Use one or more of: ${Object.keys(REGIMES).join(', ')}, or all.`);
  }

  return {
    minPoints: quick ? Math.min(minPoints, 4) : minPoints,
    seeds: quick ? Math.min(seeds, 2) : seeds,
    onlyFactor,
    quick,
    dryRun,
    plotMinSims,
    regimes,
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clearDirContents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

function linspace(min, max, count, integer) {
  if (count <= 1) return [integer ? Math.round(min) : min];

  if (!integer) {
    const out = [];
    const step = (max - min) / (count - 1);
    for (let i = 0; i < count; i++) {
      const v = min + i * step;
      out.push(Number(v.toFixed(4)));
    }
    return out;
  }

  const intMin = Math.round(min);
  const intMax = Math.round(max);
  const span = Math.max(0, intMax - intMin);

  if (count > span + 1) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const v = intMin + Math.round((i * span) / Math.max(1, count - 1));
      out.push(v);
    }
    return out;
  }

  const out = [];
  for (let i = 0; i < count; i++) {
    const v = intMin + Math.floor((i * span) / Math.max(1, count - 1));
    out.push(v);
  }

  out[0] = intMin;
  out[out.length - 1] = intMax;
  return out;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function buildUniformProfile(min, max, seedOffset) {
  const p = makeDistributionInflowProfile();
  p.mode = 'distribution';
  p.constantValue = 0;
  p.distributionConfig.distributionType = 'discreteUniform';
  p.distributionConfig.seed = 42 + seedOffset;
  p.distributionConfig.params = {
    ...p.distributionConfig.params,
    min: Math.max(0, Math.floor(min)),
    max: Math.max(0, Math.floor(max)),
  };
  return p;
}

function buildBoundaryInflowProfilesGrid(gridSize, minArrival, maxArrival, seedOffset) {
  const grid = [];
  for (let r = 0; r < gridSize; r++) {
    const row = [];
    for (let c = 0; c < gridSize; c++) {
      row.push({
        N: makeConstantInflowProfile(0),
        S: makeConstantInflowProfile(0),
        E: makeConstantInflowProfile(0),
        W: makeConstantInflowProfile(0),
      });
    }
    grid.push(row);
  }

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (r === 0) grid[r][c].N = buildUniformProfile(minArrival, maxArrival, seedOffset + 11);
      if (r === gridSize - 1) grid[r][c].S = buildUniformProfile(minArrival, maxArrival, seedOffset + 23);
      if (c === 0) grid[r][c].W = buildUniformProfile(minArrival, maxArrival, seedOffset + 37);
      if (c === gridSize - 1) grid[r][c].E = buildUniformProfile(minArrival, maxArrival, seedOffset + 53);
    }
  }

  return grid;
}

function countBoundaryStreams(gridSize) {
  let count = 0;
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (r === 0) count += 1;
      if (r === gridSize - 1) count += 1;
      if (c === 0) count += 1;
      if (c === gridSize - 1) count += 1;
    }
  }
  return count;
}

function getBoundaryNodeStats(gridSize) {
  const boundaryNodeCount = Math.max(0, (4 * gridSize) - 4);
  const cornerNodeCount = gridSize > 1 ? 4 : (gridSize === 1 ? 1 : 0);
  const edgeBoundaryNodeCount = Math.max(0, boundaryNodeCount - cornerNodeCount);
  const streamCount = countBoundaryStreams(gridSize);
  return {
    boundaryNodeCount,
    cornerNodeCount,
    edgeBoundaryNodeCount,
    streamCount,
  };
}

function expectedArrivalPerStep(gridSize, minArrival, maxArrival) {
  const boundaryStreamCount = countBoundaryStreams(gridSize);
  const avgPerStream = (minArrival + maxArrival) / 2;
  return boundaryStreamCount * avgPerStream;
}

function expectedDeparturePerStep(gridSize, baseDepartureRate) {
  return countBoundaryStreams(gridSize) * baseDepartureRate;
}

function classifyRegime(arrivals, departures) {
  if (arrivals === departures) return 'arrivals_eq_departures';
  if (arrivals > departures) return 'arrivals_gt_departures';
  return 'arrivals_lt_departures';
}

function regimeSpecificArrivalValues(regimeKey, factor, defaultValues) {
  if (factor.key !== 'arrivalUniformMax') return defaultValues;

  // Keep one fixed arrival max per regime so each regime condition is enforced
  // by a single constant setup that is easy to verify later.
  return [REGIME_BASELINE_ARRIVAL_MAX[regimeKey]];
}

function buildEffectiveFactorPlanByRegime({ factorPlan, regimes, seeds }) {
  const byRegime = {};
  for (const regimeKey of regimes) {
    byRegime[regimeKey] = factorPlan.map(({ factor, values }) => {
      const effectiveValues = regimeSpecificArrivalValues(regimeKey, factor, values);
      const numericValues = effectiveValues.map((v) => Number(v));
      const min = numericValues.length ? Math.min(...numericValues) : null;
      const max = numericValues.length ? Math.max(...numericValues) : null;
      const simCount = effectiveValues.length * seeds;
      const requiredSimsToPlot = Math.max(1, effectiveValues.length);
      return {
        factorKey: factor.key,
        label: factor.label,
        plotEnabled: factor.plotEnabled !== false,
        nominalPoints: values.length,
        effectivePoints: effectiveValues.length,
        effectiveMin: min,
        effectiveMax: max,
        simCount,
        requiredSimsToPlot,
      };
    });
  }
  return byRegime;
}

function buildRegimeArrivalDeparture(regimeKey, factorKey, value) {
  const arrivalMin = ARRIVAL_MIN;
  const arrivalMax = factorKey === 'arrivalUniformMax'
    ? REGIME_BASELINE_ARRIVAL_MAX[regimeKey]
    : REGIME_BASELINE_ARRIVAL_MAX[regimeKey];
  const departureRate = REGIME_BASELINE_DEPARTURE_RATE[regimeKey];

  return { arrivalMin, arrivalMax, departureRate, requestedValue: value };
}

function ratio(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

function getFinalMetric(snapshot, metricKey) {
  if (metricKey === 'throughput' || metricKey === 'totalVehiclesEntered') {
    return {
      fixed: snapshot.fixed[metricKey],
      greedy: snapshot.greedy[metricKey],
    };
  }

  if (metricKey === 'vehiclesInNetwork' || metricKey === 'sumQueueSizes' || metricKey === 'sumAvgWaitTimes' || metricKey === 'sumTotalWaitTimes' || metricKey === 'sumStdTotalWaitTimes') {
    const fixedSeries = snapshot.fixed[metricKey] || [];
    const greedySeries = snapshot.greedy[metricKey] || [];
    return {
      fixed: fixedSeries.length ? fixedSeries[fixedSeries.length - 1] : 0,
      greedy: greedySeries.length ? greedySeries[greedySeries.length - 1] : 0,
    };
  }

  return { fixed: null, greedy: null };
}

function runSimulation(config) {
  const engine = new SimulationEngine(config);
  engine.init();
  while (!engine.isComplete) {
    engine.step();
  }
  return engine.getSnapshot();
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function renderLineChart({ title, xLabel, yLabel, xValues, yValues, outFile }) {
  const width = 1600;
  const height = 900;
  const canvas = new ChartJSNodeCanvas({ width, height, backgroundColour: 'white' });

  const labels = xValues.map((x) => Number.isInteger(x) ? String(x) : x.toFixed(3));

  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: yLabel,
          data: yValues,
          borderColor: '#0f766e',
          backgroundColor: '#0f766e',
          borderWidth: 3,
          tension: 0.15,
          pointRadius: 3,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: { display: true, position: 'top' },
        title: {
          display: true,
          text: title,
          color: '#111827',
          font: { size: 20, weight: 'bold' },
          padding: { top: 20, bottom: 20 },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: xLabel,
            color: '#111827',
            font: { size: 15, weight: 'bold' },
          },
          ticks: { color: '#374151', maxTicksLimit: 10 },
          grid: { color: '#e5e7eb' },
        },
        y: {
          title: {
            display: true,
            text: yLabel,
            color: '#111827',
            font: { size: 15, weight: 'bold' },
          },
          ticks: { color: '#374151' },
          grid: { color: '#e5e7eb' },
        },
      },
    },
  };

  const buffer = await canvas.renderToBuffer(config, 'image/png');
  fs.writeFileSync(outFile, buffer);
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replaceAll('"', '""') + '"';
    }
    return s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

function buildDetailsMarkdown({
  generatedAt,
  opts,
  totalSimulationRuns,
  factorPlan,
  effectiveFactorPlanByRegime,
  boundaryStats,
  regimeResolvedConditions,
  outputRoot,
}) {
  const lines = [];
  lines.push('# OFAT Analysis Details');
  lines.push('');
  lines.push(`Generated At: ${generatedAt}`);
  lines.push(`Output Root: ${outputRoot}`);
  lines.push('');
  lines.push('## Run Plan');
  lines.push('');
  lines.push(`- Regimes: ${opts.regimes.join(', ')}`);
  lines.push(`- Seeds Per Point: ${opts.seeds}`);
  lines.push(`- Plot Minimum Simulations (global floor): ${opts.plotMinSims}`);
  lines.push(`- Total Simulation Runs: ${totalSimulationRuns}`);
  lines.push('');
  lines.push('## Boundary Model');
  lines.push('');
  lines.push(`- Grid Size: ${BASE_CONFIG.gridSize}`);
  lines.push(`- Boundary Nodes: ${boundaryStats.boundaryNodeCount}`);
  lines.push(`- Corner Boundary Nodes: ${boundaryStats.cornerNodeCount}`);
  lines.push(`- Edge Boundary Nodes: ${boundaryStats.edgeBoundaryNodeCount}`);
  lines.push(`- Boundary Streams (Pipes): ${boundaryStats.streamCount}`);
  lines.push('');
  lines.push('Formulas:');
  lines.push(`- arrivalsPerStep = boundaryStreamCount * ((arrivalMin + arrivalMax) / 2)`);
  lines.push(`- departuresPerStep = boundaryStreamCount * baseDepartureRate`);
  lines.push(`- Compare arrivalsPerStep vs departuresPerStep for lt/eq/gt`);
  lines.push('');
  lines.push('## Fixed Regime Conditions');
  lines.push('');
  for (const regimeKey of opts.regimes) {
    const cond = regimeResolvedConditions[regimeKey];
    lines.push(`### ${regimeKey}`);
    lines.push(`- arrivalMin: ${cond.resolvedArrivalMin}`);
    lines.push(`- arrivalMax: ${cond.resolvedArrivalMax}`);
    lines.push(`- departureRatePerBoundaryPipe: ${cond.resolvedDepartureRatePerBoundaryPipe}`);
    lines.push(`- arrivalsPerStep: ${cond.arrivalsPerStep}`);
    lines.push(`- departuresPerStep: ${cond.departuresPerStep}`);
    lines.push(`- classificationCheck: ${cond.classificationCheck}`);
    lines.push(`- classificationMatchesTarget: ${cond.classificationMatchesTarget}`);
    lines.push('');
  }
  lines.push('## Nominal Factor Point Plan');
  lines.push('');
  for (const fp of factorPlan) {
    lines.push(`- ${fp.factor.key}: points=${fp.values.length}, range=[${fp.factor.min}, ${fp.factor.max}]`);
  }
  lines.push('');
  lines.push('## Effective Factor Plan By Regime');
  lines.push('');
  for (const regimeKey of opts.regimes) {
    lines.push(`### ${regimeKey}`);
    for (const item of effectiveFactorPlanByRegime[regimeKey]) {
      const required = item.requiredSimsToPlot;
      const eligible = item.plotEnabled && (item.simCount >= required);
      lines.push(`- ${item.factorKey}: effectivePoints=${item.effectivePoints}, effectiveRange=[${item.effectiveMin}, ${item.effectiveMax}], simCount=${item.simCount}, requiredSimsToPlot=${required}, plotEnabled=${item.plotEnabled}, plotEligible=${eligible}`);
    }
    lines.push('');
  }
  lines.push('');
  lines.push('## Seed Policy');
  lines.push('');
  lines.push(`- baseSeed: ${BASE_CONFIG.seed}`);
  lines.push(`- runSeed = baseSeed + seedRep`);
  lines.push(`- inflowSeedOffset = seedRep * 101`);
  lines.push('');
  lines.push('## Runtime Output Behavior');
  lines.push('');
  lines.push('- Script logs every simulation completion with progress and ETA.');
  lines.push('- Partial CSVs and plots are written as factors complete.');
  lines.push('- Plots are created under analysis/ofat_sensitivity/plots/<regime>.');
  return lines.join('\n');
}

function aggregateRows(rawRows) {
  const grouped = new Map();
  for (const row of rawRows) {
    const k = [row.regime, row.factorKey, row.factorValue, row.metricKey].join('||');
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(row.ratio);
  }

  const aggRows = [];
  for (const [key, ratios] of grouped.entries()) {
    const [regime, factorKey, factorValueStr, metricKey] = key.split('||');
    const factor = FACTORS.find((f) => f.key === factorKey);
    const metric = METRICS.find((m) => m.key === metricKey);
    aggRows.push({
      regime,
      regimeLabel: REGIMES[regime],
      factorKey,
      factorLabel: factor?.label || factorKey,
      factorValue: Number(factorValueStr),
      metricKey,
      metricLabel: metric?.label || metricKey,
      ratioMean: mean(ratios.filter((x) => x != null)),
      ratioCount: ratios.filter((x) => x != null).length,
    });
  }

  aggRows.sort((a, b) => {
    if (a.regime !== b.regime) return a.regime.localeCompare(b.regime);
    if (a.factorKey !== b.factorKey) return a.factorKey.localeCompare(b.factorKey);
    if (a.metricKey !== b.metricKey) return a.metricKey.localeCompare(b.metricKey);
    return a.factorValue - b.factorValue;
  });

  return aggRows;
}

async function renderPlots(aggRows, factors, regimes, plotEligibility) {
  for (const regimeKey of regimes) {
    ensureDir(path.join(PLOTS_DIR, regimeKey));
    for (const factor of factors) {
      const eligibilityKey = `${regimeKey}::${factor.key}`;
      if (!plotEligibility.get(eligibilityKey)) {
        continue;
      }

      let renderedForFactor = 0;
      for (const metric of METRICS) {
        const rows = aggRows.filter((r) => r.regime === regimeKey && r.factorKey === factor.key && r.metricKey === metric.key);
        if (!rows.length) continue;
        const xValues = rows.map((r) => r.factorValue);
        const yValues = rows.map((r) => r.ratioMean);

        const safeMetric = metric.key.replace(/[^a-zA-Z0-9_]+/g, '_');
        const safeFactor = factor.key.replace(/[^a-zA-Z0-9_]+/g, '_');
        const outFile = path.join(PLOTS_DIR, regimeKey, `${safeMetric}__vs__${safeFactor}.png`);

        await renderLineChart({
          title: `${REGIMES[regimeKey]} | OFAT Sensitivity`,
          xLabel: factor.label,
          yLabel: `Greedy / Fixed Ratio - ${metric.label}`,
          xValues,
          yValues,
          outFile,
        });
        renderedForFactor += 1;
      }
      if (renderedForFactor > 0) {
        console.log(`[OFAT] Rendered plots | regime=${regimeKey} | factor=${factor.key} | charts=${renderedForFactor}`);
      }
    }
  }
}

async function main() {
  const opts = parseArgs();
  const factors = opts.onlyFactor
    ? FACTORS.filter((f) => f.key === opts.onlyFactor)
    : FACTORS;

  if (!factors.length) {
    throw new Error('No factors selected.');
  }

  const factorPlan = factors.map((f) => {
    const pointCount = opts.quick ? Math.min(4, opts.minPoints) : Math.max(opts.minPoints, f.preferredPoints || opts.minPoints);
    const values = linspace(f.min, f.max, pointCount, f.integer);
    return { factor: f, values };
  });

  const totalSimulationRuns = opts.regimes.reduce((acc, regimeKey) => {
    return acc + factorPlan.reduce((inner, fp) => {
      const effectiveValues = regimeSpecificArrivalValues(regimeKey, fp.factor, fp.values);
      return inner + (effectiveValues.length * opts.seeds);
    }, 0);
  }, 0);

  const effectiveFactorPlanByRegime = buildEffectiveFactorPlanByRegime({
    factorPlan,
    regimes: opts.regimes,
    seeds: opts.seeds,
  });

  const plotEligibility = new Map();
  for (const regimeKey of opts.regimes) {
    for (const item of effectiveFactorPlanByRegime[regimeKey]) {
      const requiredSims = Math.max(1, item.requiredSimsToPlot);
      const canPlot = item.plotEnabled && (item.simCount >= requiredSims);
      plotEligibility.set(`${regimeKey}::${item.factorKey}`, canPlot);
    }
  }

  const startedAt = Date.now();
  let completedRuns = 0;

  console.log(`[OFAT] Starting analysis | factors=${factorPlan.length} | regimes=${opts.regimes.length} | seedsPerPoint=${opts.seeds} | totalRuns=${totalSimulationRuns}`);
  console.log(`[OFAT] Regimes selected: ${opts.regimes.join(', ')}`);
  for (const fp of factorPlan) {
    console.log(`[OFAT] Factor planned: ${fp.factor.key} | points=${fp.values.length} | range=[${fp.factor.min}, ${fp.factor.max}]`);
  }

  ensureDir(OUTPUT_ROOT);
  ensureDir(DATA_DIR);
  ensureDir(PLOTS_DIR);

  // Remove stale files from previous runs so live outputs reflect only current run progress.
  clearDirContents(DATA_DIR);

  for (const regimeKey of opts.regimes) {
    ensureDir(path.join(PLOTS_DIR, regimeKey));
    clearDirContents(path.join(PLOTS_DIR, regimeKey));
  }

  const boundaryStats = getBoundaryNodeStats(BASE_CONFIG.gridSize);
  const boundaryStreams = boundaryStats.streamCount;
  const regimeResolvedConditions = {};
  for (const regimeKey of opts.regimes) {
    const arrivalMin = ARRIVAL_MIN;
    const arrivalMax = REGIME_BASELINE_ARRIVAL_MAX[regimeKey];
    const departureRate = REGIME_BASELINE_DEPARTURE_RATE[regimeKey];
    const arrivalsPerStep = expectedArrivalPerStep(BASE_CONFIG.gridSize, arrivalMin, arrivalMax);
    const departuresPerStepRegime = expectedDeparturePerStep(BASE_CONFIG.gridSize, departureRate);
    const classifiedRegime = classifyRegime(arrivalsPerStep, departuresPerStepRegime);

    regimeResolvedConditions[regimeKey] = {
      targetRegime: regimeKey,
      resolvedArrivalMin: arrivalMin,
      resolvedArrivalMax: arrivalMax,
      resolvedDepartureRatePerBoundaryPipe: departureRate,
      boundaryStreamCount: boundaryStreams,
      arrivalsPerStep,
      departuresPerStep: departuresPerStepRegime,
      classificationCheck: classifiedRegime,
      classificationMatchesTarget: classifiedRegime === regimeKey,
    };
  }

  const detailsMarkdown = buildDetailsMarkdown({
    generatedAt: new Date().toISOString(),
    opts,
    totalSimulationRuns,
    factorPlan,
    effectiveFactorPlanByRegime,
    boundaryStats,
    regimeResolvedConditions,
    outputRoot: OUTPUT_ROOT,
  });
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'DETAILS.md'), detailsMarkdown);
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'regime_conditions.json'), JSON.stringify(regimeResolvedConditions, null, 2));
  console.log('[OFAT] Wrote analysis details files: DETAILS.md and regime_conditions.json');

  if (opts.dryRun) {
    const summary = {
      mode: 'dry-run',
      factors: factorPlan.length,
      regimes: opts.regimes,
      seedsPerPoint: opts.seeds,
      plotMinSims: opts.plotMinSims,
      totalSimulationRuns,
      factorPointPlan: factorPlan.map((fp) => ({ key: fp.factor.key, points: fp.values.length })),
      effectiveFactorPlanByRegime,
      baseline: BASE_CONFIG,
      arrivalUniformMin: ARRIVAL_MIN,
      regimeBaselineArrivalMax: REGIME_BASELINE_ARRIVAL_MAX,
      regimeBaselineDepartureRate: REGIME_BASELINE_DEPARTURE_RATE,
    };
    fs.writeFileSync(path.join(OUTPUT_ROOT, 'dry_run_plan.json'), JSON.stringify(summary, null, 2));
    console.log('[OFAT] Dry run complete. No simulations executed.');
    return;
  }

  const rawRows = [];

  for (const regimeKey of opts.regimes) {
    console.log(`[OFAT] Running targeted regime ${regimeKey}...`);

    for (const { factor, values } of factorPlan) {
      const effectiveValues = regimeSpecificArrivalValues(regimeKey, factor, values);
      console.log(`[OFAT] Running factor ${factor.key} with ${effectiveValues.length} points for regime ${regimeKey}...`);

      for (const value of effectiveValues) {
        for (let seedRep = 0; seedRep < opts.seeds; seedRep++) {
          const cfg = clone(BASE_CONFIG);
          const regimeSetup = buildRegimeArrivalDeparture(regimeKey, factor.key, value);

          if (factor.key === 'throughTurnProb') {
            const t = Math.max(0, Math.min(1, Number(value)));
            const side = (1 - t) / 2;
            cfg.defaultTurnProbT = t;
            cfg.defaultTurnProbL = side;
            cfg.defaultTurnProbR = side;
          } else if (factor.key === 'leftTurnProb') {
            const l = Math.max(0, Math.min(1, Number(value)));
            const rem = 1 - l;
            cfg.defaultTurnProbL = l;
            cfg.defaultTurnProbT = rem / 2;
            cfg.defaultTurnProbR = rem / 2;
          } else if (factor.key === 'rightTurnProb') {
            const r = Math.max(0, Math.min(1, Number(value)));
            const rem = 1 - r;
            cfg.defaultTurnProbR = r;
            cfg.defaultTurnProbT = rem / 2;
            cfg.defaultTurnProbL = rem / 2;
          } else if (factor.key !== 'arrivalUniformMax') {
            cfg[factor.key] = value;
          }

          cfg.baseDepartureRate = regimeSetup.departureRate;
          const runSeed = BASE_CONFIG.seed + seedRep;
          const inflowSeedOffset = seedRep * 101;
          cfg.seed = runSeed;
          cfg.boundaryInflowProfiles = buildBoundaryInflowProfilesGrid(cfg.gridSize, regimeSetup.arrivalMin, regimeSetup.arrivalMax, inflowSeedOffset);

          const arrivalsPerStep = expectedArrivalPerStep(cfg.gridSize, regimeSetup.arrivalMin, regimeSetup.arrivalMax);
          const departuresPerStep = expectedDeparturePerStep(cfg.gridSize, cfg.baseDepartureRate);
          const classifiedRegime = classifyRegime(arrivalsPerStep, departuresPerStep);
          if (classifiedRegime !== regimeKey) {
            console.warn(`[OFAT] Regime mismatch | target=${regimeKey} | classified=${classifiedRegime} | factor=${factor.key} | value=${value}`);
          }

          const snapshot = runSimulation(cfg);

          completedRuns += 1;
          const elapsedSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
          const runsPerSec = completedRuns / elapsedSec;
          const remaining = totalSimulationRuns - completedRuns;
          const etaSec = runsPerSec > 0 ? Math.round(remaining / runsPerSec) : null;
          console.log(`[OFAT] Completed run ${completedRuns}/${totalSimulationRuns} | factor=${factor.key} | value=${value} | seedRep=${seedRep} | regime=${regimeKey} | arrivalsPerStep=${arrivalsPerStep.toFixed(4)} | departuresPerStep=${departuresPerStep.toFixed(4)} | elapsed=${elapsedSec}s | eta=${etaSec ?? 'NA'}s`);

          for (const metric of METRICS) {
            const finalMetric = getFinalMetric(snapshot, metric.key);
            rawRows.push({
              regime: regimeKey,
              factorKey: factor.key,
              factorLabel: factor.label,
              factorValue: value,
              seedRep,
              metricKey: metric.key,
              metricLabel: metric.label,
              fixedValue: finalMetric.fixed,
              greedyValue: finalMetric.greedy,
              ratio: ratio(finalMetric.greedy, finalMetric.fixed),
              arrivalsPerStep,
              departuresPerStep,
              gridSize: cfg.gridSize,
              simDuration: cfg.simDuration,
              arrivalMin: regimeSetup.arrivalMin,
              arrivalMax: regimeSetup.arrivalMax,
              departureRate: cfg.baseDepartureRate,
              requestedFactorValue: regimeSetup.requestedValue,
              runSeed,
              inflowSeedOffset,
            });
          }
        }
      }

      const partialAggRows = aggregateRows(rawRows);
      await renderPlots(partialAggRows, [factor], [regimeKey], plotEligibility);
      fs.writeFileSync(path.join(DATA_DIR, 'raw_runs.csv'), toCsv(rawRows));
      fs.writeFileSync(path.join(DATA_DIR, 'aggregated_means.csv'), toCsv(partialAggRows));
      console.log(`[OFAT] Saved partial outputs after factor ${factor.key} in regime ${regimeKey}.`);
    }
  }

  const aggRows = aggregateRows(rawRows);
  fs.writeFileSync(path.join(DATA_DIR, 'raw_runs.csv'), toCsv(rawRows));
  fs.writeFileSync(path.join(DATA_DIR, 'aggregated_means.csv'), toCsv(aggRows));

  console.log('[OFAT] Rendering final PNG plots...');
  await renderPlots(aggRows, factors, opts.regimes, plotEligibility);

  const boundaryStreamsFinal = boundaryStats.streamCount;
  const departuresPerStep = expectedDeparturePerStep(BASE_CONFIG.gridSize, BASE_CONFIG.baseDepartureRate);
  const eqArrivalMax = (2 * departuresPerStep) / boundaryStreamsFinal;

  const summary = {
    generatedAt: new Date().toISOString(),
    baseline: BASE_CONFIG,
    minPointsPerFactor: opts.minPoints,
    plotMinSims: opts.plotMinSims,
    arrivalUniformMin: ARRIVAL_MIN,
    regimeBaselineArrivalMax: REGIME_BASELINE_ARRIVAL_MAX,
    regimeBaselineDepartureRate: REGIME_BASELINE_DEPARTURE_RATE,
    regimes: opts.regimes,
    boundaryNodeCount: boundaryStats.boundaryNodeCount,
    cornerBoundaryNodeCount: boundaryStats.cornerNodeCount,
    edgeBoundaryNodeCount: boundaryStats.edgeBoundaryNodeCount,
    boundaryStreamCount: boundaryStreamsFinal,
    factorPointPlan: factorPlan.map((fp) => ({ key: fp.factor.key, points: fp.values.length, min: fp.factor.min, max: fp.factor.max })),
    effectiveFactorPlanByRegime,
    seedsPerPoint: opts.seeds,
    factorCount: factors.length,
    metricCount: METRICS.length,
    runCount: totalSimulationRuns,
    metricRows: rawRows.length,
    outputRoot: OUTPUT_ROOT,
    regimesDescription: {
      arrivals_lt_departures: 'Sum of expected arrivals per step is less than sum of expected departures per step.',
      arrivals_eq_departures: 'Sum of expected arrivals per step equals sum of expected departures per step.',
      arrivals_gt_departures: 'Sum of expected arrivals per step is greater than sum of expected departures per step.',
    },
    formulas: {
      boundaryNodeCount: '4*gridSize - 4',
      boundaryStreamCount: 'sum of exposed boundary directions over all boundary nodes (for gridSize=5: corners=4 with 2 streams each, edge nodes=12 with 1 stream each, total=20)',
      arrivalsPerStep: 'boundaryStreamCount * ((arrivalMin + arrivalMax)/2)',
      departuresPerStep: 'boundaryStreamCount * baseDepartureRate',
      regimeComparison: 'compare arrivalsPerStep and departuresPerStep to assign lt / eq / gt',
      forArrivalMinZero: 'arrivalsPerStep = boundaryStreamCount*(arrivalMax/2)',
      ltConditionArrivalMax: 'arrivalMax < 2*baseDepartureRate',
      eqConditionArrivalMax: 'arrivalMax = 2*baseDepartureRate',
      gtConditionArrivalMax: 'arrivalMax > 2*baseDepartureRate',
    },
    baselineValuesForComparison: {
      gridSize: BASE_CONFIG.gridSize,
      baseDepartureRate: BASE_CONFIG.baseDepartureRate,
      boundaryStreamCount: boundaryStreamsFinal,
      departuresPerStep,
      equalityArrivalMaxWhenMinZero: eqArrivalMax,
    },
    regimeResolvedConditions,
    seedPolicy: {
      seedsPerPoint: opts.seeds,
      seedRunsDescription: 'Each point is simulated seed-runs times; runSeed = baseSeed + seedRep.',
      baseSeed: BASE_CONFIG.seed,
      runSeedFormula: 'runSeed = baseSeed + seedRep',
      inflowSeedOffsetFormula: 'inflowSeedOffset = seedRep * 101',
    },
    notes: [
      'Arrival min is fixed to 0 for all runs as requested.',
      'Arrivals are sampled from a discrete uniform distribution per boundary pipe using the regime-specific [arrivalMin, arrivalMax].',
      'Arrival max is swept only for arrivalUniformMax factor; all other factors use regime baseline arrival max.',
      'Runs are generated separately for each regime so all three regime plot folders are populated.',
      'Each regime uses one fixed resolved arrival/departure setup for all runs in that regime.',
      'Regime fixed values and computed sums are recorded under regimeResolvedConditions for verification.',
      'Arrival and departure comparisons are based on boundary streams, not total node count.',
      'With gridSize=5 and baseDepartureRate=8: boundaryStreamCount=20 and departuresPerStep=160.',
      'With arrival min=0 and departureRate=8, equality is at arrival max=16; below is lt and above is gt.',
      'Through turn probability factor enforces Left = Right = (1 - Through)/2.',
      'Left turn probability factor enforces Through = Right = (1 - Left)/2.',
      'Right turn probability factor enforces Through = Left = (1 - Right)/2.',
      'Partial CSVs and factor plots are written during the run so outputs appear before completion.',
    ],
  };

  fs.writeFileSync(path.join(OUTPUT_ROOT, 'README.json'), JSON.stringify(summary, null, 2));

  console.log('OFAT sensitivity analysis complete.');
  console.log(`Output: ${OUTPUT_ROOT}`);
}

main().catch((err) => {
  console.error('OFAT sensitivity analysis failed:', err);
  process.exit(1);
});
