// Runs a batch of experiment scenarios off the main thread, for the city
// or the grid simulator, and reports each run as soon as it finishes.
import { runScenario } from './runner.js';

self.onmessage = (event) => {
  const { id, kind, base, runs } = event.data;
  try {
    runs.forEach((run, k) => {
      const result = runScenario(kind, base, run);
      self.postMessage({ id, type: 'progress', done: k + 1, total: runs.length, result });
    });
    self.postMessage({ id, type: 'done' });
  } catch (error) {
    self.postMessage({ id, type: 'error', error: error?.message || 'Experiment run failed' });
  }
};

// Tell the page the code has loaded (see utils/backgroundWorker.js).
self.postMessage({ type: 'ready' });
