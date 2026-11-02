// =====================================================
// EXTRACT DETAILS: ONE RUN
// Builds the engine for one scenario (city or grid), runs both policies
// on the same traffic and keeps what the analysis needs.
// =====================================================
import { GraphSimulationEngine } from '../simulation/graphEngine.js';
import { SimulationEngine } from '../simulation/engine.js';
import { engineConfig, inflowFor, sourceGateways } from '../simulation/cityNetwork.js';
import { isDataProfile, scaleDataProfile } from '../simulation/dataInflow.js';
import { gridEngineConfig } from '../simulation/gridEngineConfig.js';
import { makeConstantInflowProfile } from '../simulation/arrivalProfile.js';
import { makePatternProfile } from './plan.js';
import { downsample, intersectionQueues, summarizePolicy } from './metrics.js';

const withTurns = (config, probs) => (probs ? { ...config, defaultTurnProbT: probs.T, defaultTurnProbR: probs.R, defaultTurnProbL: probs.L } : config);

// base: { city, config, overrides, inflows, duration, baseRate }
// Sources fed from a data file keep their data, scaled by the level; the
// others get the scenario's pattern.
export function cityEngine(base, run) {
  const { city, config, overrides = {}, inflows: own = {}, duration, baseRate } = base;
  const cfg = withTurns({ ...config, seed: run.seed, simDuration: duration }, run.turnProbs);
  // A turning mix replaces the per-arm ratios set by hand.
  const runOverrides = run.turnProbs ? { ...overrides, turns: {} } : overrides;
  const inflows = Object.fromEntries(sourceGateways(city).map((g) => {
    const profile = inflowFor(g, city, config, own);
    return [g.id, isDataProfile(profile) ? scaleDataProfile(profile, run.scale) : makePatternProfile(run.pattern, baseRate * run.scale, duration, run.seed)];
  }));
  return new GraphSimulationEngine(engineConfig(city, cfg, runOverrides, inflows));
}

// base: { state: grid store state, activeSides, duration, baseRate }
export function gridEngine(base, run) {
  const { state, activeSides, duration, baseRate } = base;
  const profile = makePatternProfile(run.pattern, baseRate * run.scale, duration, run.seed);
  const ownSides = state.config.defaultBoundaryInflowProfiles || {};
  const sides = Object.fromEntries(['N', 'S', 'E', 'W'].map((d) => [d, isDataProfile(ownSides[d]) ? scaleDataProfile(ownSides[d], run.scale) : activeSides.includes(d) ? profile : makeConstantInflowProfile(0)]));
  // Entry points fed from a data file keep it; other overrides give way to the scenario.
  const dataOverrides = Object.fromEntries(Object.entries(state.boundaryInflowOverrides || {})
    .map(([cell, byDir]) => [cell, Object.fromEntries(Object.entries(byDir || {}).filter(([, p]) => isDataProfile(p)).map(([d, p]) => [d, scaleDataProfile(p, run.scale)]))])
    .filter(([, byDir]) => Object.keys(byDir).length));
  const config = withTurns({ ...state.config, seed: run.seed, simDuration: duration, defaultBoundaryInflowProfiles: sides }, run.turnProbs);
  const stripTurns = (map) => Object.fromEntries(Object.entries(map || {}).map(([k, v]) => {
    const { turnT, turnR, turnL, ...rest } = v;
    return [k, rest];
  }));
  return new SimulationEngine(gridEngineConfig({
    ...state,
    config,
    // Every scenario puts the same traffic on every active side.
    boundaryInflowOverrides: dataOverrides,
    roadOverrides: run.turnProbs ? stripTurns(state.roadOverrides) : (state.roadOverrides || {}),
    boundaryRoadOverrides: run.turnProbs ? stripTurns(state.boundaryRoadOverrides) : (state.boundaryRoadOverrides || {}),
    departureRateOverrides: state.departureRateOverrides || {},
  }));
}

export function runScenario(kind, base, run) {
  const started = Date.now();
  const engine = kind === 'city' ? cityEngine(base, run) : gridEngine(base, run);
  engine.init();
  // The grid engine only steps; the city engine can also run to the end.
  if (typeof engine.run === 'function') engine.run();
  else while (!engine.isComplete) engine.step();
  const snap = engine.getSnapshot();
  return {
    ...run,
    ms: Date.now() - started,
    fixed: summarizePolicy(snap.fixed),
    greedy: summarizePolicy(snap.greedy),
    intersections: intersectionQueues(snap.perIntersectionMetrics, base.duration),
    series: run.keepSeries ? {
      fixed: downsample(snap.fixed.sumQueueSizes),
      greedy: downsample(snap.greedy.sumQueueSizes),
      fixedThroughput: downsample(snap.fixed.throughputTimeSeries),
      greedyThroughput: downsample(snap.greedy.throughputTimeSeries),
      steps: base.duration,
    } : null,
  };
}
