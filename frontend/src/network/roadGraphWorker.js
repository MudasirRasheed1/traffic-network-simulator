import { buildRoadGraph } from './buildRoadGraph.js';
import { buildSimulationNetwork } from './buildSimulationNetwork.js';
import { buildCityGraph } from './buildCityGraph.js';

// Full road graph (whole download) → simulation network → city graph
// (intersections inside the selected area + traced sources/sinks).
self.onmessage = (event) => {
  const { id, osmJson, area, downloadBox, options, simOptions } = event.data || {};
  try {
    const t0 = performance.now();
    const graph = buildRoadGraph(osmJson, { bbox: downloadBox, ...options });
    graph.summary.processing.buildMs = Math.round(performance.now() - t0);
    const t1 = performance.now();
    const simnet = buildSimulationNetwork(graph, simOptions);
    simnet.summary.processing.buildMs = Math.round(performance.now() - t1);
    const t2 = performance.now();
    const city = buildCityGraph(simnet, area);
    city.summary.buildMs = Math.round(performance.now() - t2);
    self.postMessage({ id, ok: true, graph, simnet, city });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || 'Graph build failed' });
  }
};

// Tell the page the code has loaded (see utils/backgroundWorker.js).
self.postMessage({ type: 'ready' });
