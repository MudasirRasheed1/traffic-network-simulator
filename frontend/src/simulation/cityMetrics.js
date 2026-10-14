// Headline metrics for comparing policies (shared by the live results
// panel and the multi-seed comparison).

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

// `s` is one policy's part of an engine snapshot. Everything is in
// simulation steps, like the grid simulator.
export function policySummary(s) {
  const steps = s.sumQueueSizes.length;
  return {
    avgQueued: mean(s.sumQueueSizes),
    peakQueued: steps ? Math.max(...s.sumQueueSizes) : 0,
    // Every queued vehicle waits one step per step: total vehicle-steps waited.
    totalWaitSteps: s.sumQueueSizes.reduce((a, b) => a + b, 0),
    completed: s.throughput,
    avgTripSteps: s.avgTripSteps,
    inNetwork: s.vehiclesInNetwork.at(-1) ?? 0,
  };
}

export const METRICS = [
  { key: 'avgQueued', label: 'Avg vehicles waiting', lowerIsBetter: true, format: (v) => v.toFixed(1) },
  { key: 'totalWaitSteps', label: 'Total waiting (vehicle-steps)', lowerIsBetter: true, format: (v) => v.toFixed(0) },
  { key: 'peakQueued', label: 'Peak queue', lowerIsBetter: true, format: (v) => v.toFixed(0) },
  { key: 'completed', label: 'Throughput (exited)', lowerIsBetter: false, format: (v) => v.toFixed(0) },
  { key: 'avgTripSteps', label: 'Avg trip time (steps)', lowerIsBetter: true, format: (v) => v.toFixed(1) },
];

// Relative improvement of `ours` over `baseline` (positive = better).
export function improvement(baseline, ours, lowerIsBetter = true) {
  if (!baseline) return null;
  const change = (baseline - ours) / baseline;
  return lowerIsBetter ? change : -change;
}

// Two-sided 95% Student-t critical values for n-1 degrees of freedom.
const T95 = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 14: 2.145, 19: 2.093, 29: 2.045 };
function tCritical(df) {
  if (df <= 0) return NaN;
  const keys = Object.keys(T95).map(Number).sort((a, b) => a - b);
  const k = keys.find((x) => x >= df) ?? null;
  return k == null ? 1.96 : T95[k];
}

// Paired comparison over runs: each run gives one improvement value.
export function pairedStats(values) {
  const n = values.length;
  const m = mean(values);
  const sd = n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)) : 0;
  const half = n > 1 ? tCritical(n - 1) * sd / Math.sqrt(n) : NaN;
  return { n, mean: m, sd, low: m - half, high: m + half, wins: values.filter((v) => v > 0).length };
}
