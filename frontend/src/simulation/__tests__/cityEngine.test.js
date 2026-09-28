import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRoadGraph } from '../../network/buildRoadGraph.js';
import { buildSimulationNetwork } from '../../network/buildSimulationNetwork.js';
import { buildCityGraph } from '../../network/buildCityGraph.js';
import { bboxAround } from '../../network/geo.js';
import { GraphSimulationEngine } from '../graphEngine.js';
import { DEFAULT_CITY_SIM_CONFIG, engineConfig, makeRateProfile } from '../cityNetwork.js';

const download = { south: 28.622776, west: 77.209134, north: 28.640763, east: 77.229627 };
const data = JSON.parse(readFileSync(new URL('../../network/__tests__/fixtures/delhi-connaught-place.json', import.meta.url)));
const area = bboxAround((download.south + download.north) / 2, (download.west + download.east) / 2, 1.2);
const city = buildCityGraph(buildSimulationNetwork(buildRoadGraph(data, { bbox: download })), area);

function run(config = DEFAULT_CITY_SIM_CONFIG, overrides = {}, inflows = {}) {
  const engine = new GraphSimulationEngine(engineConfig(city, config, overrides, inflows));
  engine.init();
  engine.run();
  return engine;
}

describe('city simulation (Connaught Place)', () => {
  const engine = run();

  it('runs an hour of traffic and conserves every vehicle', () => {
    expect(engine.plannedTotalSeries.length).toBe(720);
    for (const pol of ['fixed', 'greedy']) {
      const gm = engine.globalMetrics[pol];
      expect(gm.totalVehiclesEntered).toBeGreaterThan(1000);
      gm.enteredTimeSeries.forEach((entered, t) => {
        expect(gm.throughputTimeSeries[t] + gm.vehiclesInNetwork[t]).toBe(entered);
      });
    }
  });

  it('feeds both policies exactly the same traffic', () => {
    expect(engine.globalMetrics.greedy.enteredTimeSeries).toEqual(engine.globalMetrics.fixed.enteredTimeSeries);
  });

  it('steady veh/h inflow averages out exactly', () => {
    const feeder = city.edges.find((e) => e.kind === 'feeder');
    const e = run(DEFAULT_CITY_SIM_CONFIG, {}, { [feeder.id]: makeRateProfile(900) });
    const series = e.arrivalRateSeriesByKey[feeder.id];
    expect(series.reduce((a, b) => a + b, 0)).toBe(900);
  });

  it('zero inflow means an empty network', () => {
    const inflows = Object.fromEntries(city.edges.filter((e) => e.kind === 'feeder').map((e) => [e.id, makeRateProfile(0)]));
    const e = run(DEFAULT_CITY_SIM_CONFIG, {}, inflows);
    expect(e.globalMetrics.fixed.totalVehiclesEntered).toBe(0);
    expect(Math.max(...e.globalMetrics.greedy.vehiclesInNetwork)).toBe(0);
  });

  it('with road capacity limits on, vehicles never exceed road storage', () => {
    const e = run({ ...DEFAULT_CITY_SIM_CONFIG, spillback: true, durationMin: 20 });
    for (const state of [e.fixedState, e.greedyState]) {
      for (const edge of e.network.edges) expect(state.occupancy.get(edge.id)).toBeLessThanOrEqual(edge.storageVeh);
    }
    for (const pol of ['fixed', 'greedy']) {
      const gm = e.globalMetrics[pol];
      gm.enteredTimeSeries.forEach((entered, t) => expect(gm.throughputTimeSeries[t] + gm.vehiclesInNetwork[t]).toBe(entered));
    }
  });
});
