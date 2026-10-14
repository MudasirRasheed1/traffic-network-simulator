// Runs the same city scenario with several random seeds, off the UI thread.
import { GraphSimulationEngine } from './graphEngine.js';
import { engineConfig } from './cityNetwork.js';
import { policySummary } from './cityMetrics.js';

self.onmessage = (event) => {
  const { id, city, config, overrides, inflows, seeds } = event.data;
  try {
    const runs = [];
    seeds.forEach((seed, k) => {
      const engine = new GraphSimulationEngine(engineConfig(city, { ...config, seed }, overrides, inflows));
      engine.init();
      engine.run();
      const snap = engine.getSnapshot();
      runs.push({
        seed,
        fixed: policySummary(snap.fixed),
        greedy: policySummary(snap.greedy),
      });
      self.postMessage({ id, type: 'progress', done: k + 1, total: seeds.length });
    });
    self.postMessage({ id, type: 'done', runs });
  } catch (error) {
    self.postMessage({ id, type: 'error', error: error?.message || 'Batch run failed' });
  }
};

// Tell the page the code has loaded (see utils/backgroundWorker.js).
self.postMessage({ type: 'ready' });
