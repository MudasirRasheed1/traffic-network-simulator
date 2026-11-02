// =====================================================
// EXTRACT DETAILS: WHAT IS MEASURED
// The same measures for the grid and the city simulators, all in steps
// and vehicles like the rest of the app.
// =====================================================

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

// One policy's part of an engine snapshot (grid or city).
export function summarizePolicy(s) {
  const q = s.sumQueueSizes || [];
  return {
    avgQueued: mean(q),
    peakQueued: q.length ? Math.max(...q) : 0,
    // Every waiting vehicle waits one step per step.
    waitSteps: q.reduce((a, b) => a + b, 0),
    throughput: s.throughput ?? 0,
    entered: s.totalVehiclesEntered ?? 0,
    inNetwork: s.vehiclesInNetwork?.at(-1) ?? 0,
    avgTripSteps: s.avgTripSteps ?? null,
  };
}

const fmt1 = (v) => (v == null ? '-' : Number(v).toFixed(1));
const fmt0 = (v) => (v == null ? '-' : Math.round(Number(v)).toLocaleString());

export const EXPERIMENT_METRICS = [
  { key: 'avgQueued', label: 'Average vehicles waiting', short: 'Avg waiting', lowerIsBetter: true, format: fmt1 },
  { key: 'waitSteps', label: 'Total waiting (vehicle-steps)', short: 'Total waiting', lowerIsBetter: true, format: fmt0 },
  { key: 'peakQueued', label: 'Peak vehicles waiting', short: 'Peak waiting', lowerIsBetter: true, format: fmt0 },
  { key: 'throughput', label: 'Vehicles that got through', short: 'Throughput', lowerIsBetter: false, format: fmt0 },
  { key: 'avgTripSteps', label: 'Average trip time (steps)', short: 'Trip time', lowerIsBetter: true, format: fmt1, cityOnly: true },
];

export const metricsFor = (kind) => EXPERIMENT_METRICS.filter((m) => kind === 'city' || !m.cityOnly);

// Average queue of each intersection over the run, per policy.
export function intersectionQueues(perIntersectionMetrics, steps) {
  const out = {};
  for (const [id, m] of Object.entries(perIntersectionMetrics.fixed || {})) {
    const avg = (pm) => ['N', 'E', 'S', 'W'].reduce((sum, d) => sum + (pm.queueLengths[d] || []).reduce((a, b) => a + b, 0), 0) / Math.max(1, steps);
    out[id] = { fixed: avg(m), greedy: avg(perIntersectionMetrics.greedy[id]) };
  }
  return out;
}

// At most `points` evenly spaced values of a long series (for charts).
export function downsample(series, points = 240) {
  if (!series || series.length <= points) return series ? series.slice() : [];
  const out = [];
  const step = series.length / points;
  for (let k = 0; k < points; k++) {
    const from = Math.floor(k * step);
    const to = Math.max(from + 1, Math.floor((k + 1) * step));
    out.push(mean(series.slice(from, to)));
  }
  return out;
}
