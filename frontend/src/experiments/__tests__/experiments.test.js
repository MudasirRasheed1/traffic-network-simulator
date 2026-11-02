import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRuns, makePatternProfile, patternShape, LEVELS, PATTERNS } from '../plan.js';
import { runScenario } from '../runner.js';
import { analyze } from '../analysis.js';
import { evaluateArrivalAt, buildDistributionSeries } from '../../simulation/arrivalProfile.js';
import { buildRoadGraph } from '../../network/buildRoadGraph.js';
import { buildSimulationNetwork } from '../../network/buildSimulationNetwork.js';
import { buildCityGraph } from '../../network/buildCityGraph.js';
import { bboxAround } from '../../network/geo.js';
import { DEFAULT_CITY_SIM_CONFIG } from '../../simulation/cityNetwork.js';
import { makeConstantInflowProfile } from '../../simulation/arrivalProfile.js';

const seriesOf = (profile, duration) => (profile.mode === 'distribution'
  ? buildDistributionSeries(profile.distributionConfig, duration, 1, 'k')
  : Array.from({ length: duration }, (_, t) => evaluateArrivalAt({ ...profile.functionConfig, maxCap: 60 }, t, Math.random, {})));
const avg = (s) => s.reduce((a, b) => a + b, 0) / s.length;

describe('experiment plan', () => {
  it('builds every combination with the chosen number of seeds', () => {
    const runs = buildRuns({ levels: ['light', 'heavy'], patterns: ['steady', 'rush', 'random'], turnMixes: ['current'], seeds: 3, baseSeed: 7 });
    expect(runs).toHaveLength(2 * 3 * 3);
    expect(new Set(runs.map((r) => r.scenario)).size).toBe(6);
    expect(runs.filter((r) => r.keepSeries)).toHaveLength(6);
    expect([...new Set(runs.map((r) => r.seed))]).toEqual([7, 8, 9]);
  });

  it('gives every pattern the intended average, even below one car per step', () => {
    for (const pattern of PATTERNS.map((p) => p.key)) {
      for (const mean of [0.5, 1, 3.5]) {
        const s = seriesOf(makePatternProfile(pattern, mean, 600, 3), 600);
        expect(s.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
        expect(avg(s)).toBeCloseTo(mean, pattern === 'random' ? 0 : 1);
      }
    }
  });

  it('shapes rush hour as quiet, peak, quiet', () => {
    expect(patternShape('rush', 10, 300)).toBe(0.5);
    expect(patternShape('rush', 150, 300)).toBe(2);
    expect(patternShape('rush', 290, 300)).toBe(0.5);
    const s = seriesOf(makePatternProfile('rush', 2, 300), 300);
    expect(avg(s.slice(100, 200))).toBeGreaterThan(3 * avg(s.slice(0, 100)));
  });
});

describe('experiment runs', () => {
  it('runs a grid scenario: both policies see the same traffic', () => {
    const state = {
      config: {
        gridSize: 3, simDuration: 200, drivingSide: 'left', defaultRoadSpeed: 2, defaultRoadLength: 12,
        defaultTurnProbT: 0.7, defaultTurnProbR: 0.15, defaultTurnProbL: 0.15,
        fixedCycleInterval: 5, greedyDecisionInterval: 5, lookaheadH: 5,
        totalWaitWeight: 1, totalWaitStdWeight: 1, queueWeight: 1, queueStdWeight: 1,
        baseDepartureRate: 8, inflowGlobalCap: 60, seed: 2,
        defaultBoundaryInflowProfiles: { N: makeConstantInflowProfile(4), S: makeConstantInflowProfile(0), E: makeConstantInflowProfile(0), W: makeConstantInflowProfile(0) },
      },
      boundaryInflowOverrides: {}, departureRateOverrides: {}, roadOverrides: {}, boundaryRoadOverrides: {},
    };
    const runs = buildRuns({ levels: ['normal', 'heavy'], patterns: ['steady'], turnMixes: ['current'], seeds: 1 });
    const results = runs.map((run) => runScenario('grid', { state, activeSides: ['N'], duration: 200, baseRate: 4 }, run));
    for (const r of results) {
      expect(r.fixed.entered).toBe(r.greedy.entered);
      expect(r.fixed.entered).toBeGreaterThan(0);
      expect(Object.keys(r.intersections)).toHaveLength(9);
    }
    // Heavy traffic puts twice the cars in.
    expect(results[1].fixed.entered).toBeGreaterThan(1.8 * results[0].fixed.entered);
  });

  it('runs city scenarios and sums them up', () => {
    const data = JSON.parse(readFileSync(new URL('../../network/__tests__/fixtures/chandigarh-sector17.json', import.meta.url)));
    const download = { south: 30.730, west: 76.770, north: 30.748, east: 76.791 };
    const city = buildCityGraph(buildSimulationNetwork(buildRoadGraph(data, { bbox: download })), bboxAround(30.739, 76.7805, 1.6));
    const runs = buildRuns({ levels: LEVELS.map((l) => l.key), patterns: ['steady', 'rush'], turnMixes: ['current', 'turns'], seeds: 1 });
    const base = { city, config: DEFAULT_CITY_SIM_CONFIG, overrides: {}, duration: 150, baseRate: 1 };
    const results = runs.map((run) => runScenario('city', base, run));
    expect(results).toHaveLength(4 * 2 * 2);
    for (const r of results) expect(r.fixed.entered).toBe(r.greedy.entered);

    const a = analyze(results, { kind: 'city', intersectionNames: { I1: 'Test' } });
    expect(a.total).toBe(results.length);
    expect(a.byLevel.map((g) => g.key)).toEqual(['light', 'normal', 'busy', 'heavy']);
    expect(a.byPattern).toHaveLength(2);
    expect(a.byTurn).toHaveLength(2);
    expect(a.scenarios).toHaveLength(16);
    expect(a.showcase.series.fixed.length).toBeGreaterThan(0);
    expect(a.intersections.length).toBe(city.intersections.length);
    expect(a.metrics.map((m) => m.key)).toContain('avgTripSteps');
    expect(a.verdict).toMatch(/Greedy/);
    expect(a.findings.length).toBeGreaterThan(2);
    const stats = a.overall.avgQueued.stats;
    expect(stats.n).toBe(results.length);
    expect(stats.wins).toBeLessThanOrEqual(results.length);
  }, 60000);
});
