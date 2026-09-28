// Runs the same city scenario with several random seeds, off the UI thread.
import { GraphSimulationEngine } from './graphEngine.js';
import { engineConfig } from './cityNetwork.js';
import { policySummary } from './cityMetrics.js';

self.onmessage = (event) => {
  const { city, config, overrides, inflows, seeds } = event.data;
  try {
    const runs = [];
    seeds.forEach((seed, k) => {
      const engine = new GraphSimulationEngine(engineConfig(city, { ...config, seed }, overrides, inflows));
      engine.init();
      engine.run();
      const snap = engine.getSnapshot();
      runs.push({
        seed,
        fixed: policySummary(snap.fixed, config.stepSeconds),
        greedy: policySummary(snap.greedy, config.stepSeconds),
      });
      self.postMessage({ type: 'progress', done: k + 1, total: seeds.length });
    });
    self.postMessage({ type: 'done', runs });
  } catch (error) {
    self.postMessage({ type: 'error', error: error?.message || 'Batch run failed' });
  }
};
