import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../engine.js';
import { GraphSimulationEngine } from '../graphEngine.js';
import { gridAsGraph } from '../gridAsGraph.js';
import { makeConstantInflowProfile, makeFunctionInflowProfile, makeDistributionInflowProfile } from '../arrivalProfile.js';

// Grid config in the same shape the store builds (useSimStore.buildEngineFromStoreState).
function gridConfig({ gridSize, inflow, departure, ...rest }) {
  const boundaryInflowProfiles = [];
  const departureRates = [];
  for (let r = 0; r < gridSize; r++) {
    boundaryInflowProfiles.push([]);
    departureRates.push([]);
    for (let c = 0; c < gridSize; c++) {
      const cell = {};
      for (const d of ['N', 'S', 'E', 'W']) cell[d] = inflow(r, c, d);
      boundaryInflowProfiles[r].push(cell);
      departureRates[r].push(departure ? departure(r, c) : undefined);
    }
  }
  return { gridSize, boundaryInflowProfiles, departureRates, ...rest };
}

function runBoth(config) {
  const grid = new SimulationEngine(config);
  grid.init();
  while (!grid.isComplete) grid.step();
  const graph = new GraphSimulationEngine({ ...config, network: gridAsGraph(config) });
  graph.init();
  while (!graph.isComplete) graph.step();
  return { grid, graph };
}

const SERIES = ['throughputTimeSeries', 'enteredTimeSeries', 'vehiclesInNetwork', 'sumQueueSizes', 'sumAvgWaitTimes', 'sumTotalWaitTimes', 'sumStdTotalWaitTimes'];

function expectIdentical({ grid, graph }) {
  for (const pol of ['fixed', 'greedy']) {
    for (const key of SERIES) {
      expect(graph.globalMetrics[pol][key], `${pol}.${key}`).toEqual(grid.globalMetrics[pol][key]);
    }
    for (const [id, m] of Object.entries(grid.perIntersectionMetrics[pol])) {
      const g = graph.perIntersectionMetrics[pol][id];
      expect(g.queueLengths, `${pol} ${id} queues`).toEqual(m.queueLengths);
      expect(g.phaseTimeline, `${pol} ${id} phases`).toEqual(m.phaseTimeline);
      expect(g.vehiclesServed, `${pol} ${id} served`).toBe(m.vehiclesServed);
      expect(g.vehiclesExited, `${pol} ${id} exited`).toBe(m.vehiclesExited);
    }
  }
  // The last greedy decision at every intersection, number for number.
  const pick = (d) => ({
    time: d.time,
    bestPhase: d.bestPhase,
    bestScore: d.bestScore,
    queuesBefore: d.queuesBefore,
    horizon: d.horizonInputs.map((h) => h.boundaryArrivalRates),
    candidates: d.candidateResults.map((c) => ({ phase: c.phase, score: c.totalScore, after: c.queuesAfter, trace: c.stepTrace })),
  });
  for (const [id, d] of Object.entries(grid.greedyDecisionData)) {
    expect(pick(graph.greedyDecisionData[id]), `decision ${id}`).toEqual(pick(d));
  }
}

describe('graph engine reproduces the grid engine exactly', () => {
  it('default 3×3 scenario (constant inflow from the north)', () => {
    const config = gridConfig({
      gridSize: 3,
      simDuration: 200,
      seed: 2,
      inflow: (r, c, d) => makeConstantInflowProfile(d === 'N' ? 4 : 0),
    });
    const result = runBoth(config);
    expect(result.grid.globalMetrics.fixed.throughput).toBeGreaterThan(0);
    expectIdentical(result);
  });

  it('4×4 with inflow from all sides, custom roads, turns and departure rates', () => {
    const config = gridConfig({
      gridSize: 4,
      simDuration: 300,
      seed: 17,
      fixedCycleInterval: 6,
      greedyDecisionInterval: 4,
      lookaheadH: 7,
      defaultRoadSpeed: 3,
      defaultRoadLength: 20,
      defaultTurnProbT: 0.6,
      defaultTurnProbR: 0.25,
      defaultTurnProbL: 0.15,
      inflow: (r, c, d) => makeConstantInflowProfile((r + c + d.charCodeAt(0)) % 4),
      departure: (r, c) => ({ N: 6, S: 7, E: 5 + (r % 2), W: 8 - (c % 3) }),
      roadOverrides: { '1,1->1,2': { speed: 1, length: 30, turnT: 0.3, turnR: 0.5, turnL: 0.2 } },
      boundaryRoadOverrides: { 'bnd_W_2,0': { turnT: 0.5, turnR: 0.3, turnL: 0.2 } },
      totalWaitWeight: 1.3,
      queueStdWeight: 0.4,
    });
    expectIdentical(runBoth(config));
  });

  it('time-varying function inflow and random distribution inflow', () => {
    const fn = makeFunctionInflowProfile();
    fn.functionConfig = { ...fn.functionConfig, profileType: 'triangular' };
    const dist = makeDistributionInflowProfile();
    const config = gridConfig({
      gridSize: 3,
      simDuration: 250,
      seed: 99,
      inflow: (r, c, d) => (d === 'W' ? fn : d === 'N' ? dist : makeConstantInflowProfile(1)),
    });
    const result = runBoth(config);
    expect(result.grid.globalMetrics.greedy.totalVehiclesEntered).toBeGreaterThan(100);
    expectIdentical(result);
  });
});

describe('graph engine sanity', () => {
  it('conserves vehicles: entered = exited + in network, every step', () => {
    const config = gridConfig({ gridSize: 3, simDuration: 150, seed: 5, inflow: () => makeConstantInflowProfile(2) });
    const engine = new GraphSimulationEngine({ ...config, network: gridAsGraph(config) });
    engine.init();
    while (!engine.isComplete) engine.step();
    for (const pol of ['fixed', 'greedy']) {
      const gm = engine.globalMetrics[pol];
      gm.enteredTimeSeries.forEach((entered, t) => {
        expect(gm.throughputTimeSeries[t] + gm.vehiclesInNetwork[t]).toBe(entered);
      });
    }
  });

  it('is deterministic for a given seed', () => {
    const config = gridConfig({ gridSize: 3, simDuration: 120, seed: 8, inflow: () => makeConstantInflowProfile(3) });
    const run = () => {
      const e = new GraphSimulationEngine({ ...config, network: gridAsGraph(config) });
      e.init();
      while (!e.isComplete) e.step();
      return e.globalMetrics;
    };
    expect(run()).toEqual(run());
  });
});
