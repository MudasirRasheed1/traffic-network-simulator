// =====================================================
// EXTRACT DETAILS: WHAT THE RUNS SAY
// Turns the list of finished runs into the numbers, groups and plain
// sentences shown on screen and in the PDF report.
// Improvement is always "how much better Greedy did than Fixed cycle"
// in the same run (same traffic, same seed), so positive = Greedy wins.
// =====================================================
import { improvement, pairedStats } from '../simulation/cityMetrics.js';
import { LEVELS, PATTERNS, TURN_MIXES, labelOf } from './plan.js';
import { metricsFor } from './metrics.js';

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
// '44.0% less waiting' / '5.0% more waiting' (improvement > 0 means less).
const lessWaiting = (v) => `${Math.abs(v * 100).toFixed(1)}% ${v >= 0 ? 'less' : 'more'} waiting`;

export const pct = (v, digits = 1) => (v == null || !Number.isFinite(v) ? '-' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(digits)}%`);

function improvementsOf(runs, metric) {
  return runs
    .map((r) => improvement(r.fixed[metric.key], r.greedy[metric.key], metric.lowerIsBetter))
    .filter((v) => v != null && Number.isFinite(v));
}

// Fixed and Greedy averages and the paired improvement of one metric over some runs.
function compare(runs, metric) {
  const values = improvementsOf(runs, metric);
  return {
    fixed: mean(runs.map((r) => r.fixed[metric.key] ?? 0)),
    greedy: mean(runs.map((r) => r.greedy[metric.key] ?? 0)),
    stats: pairedStats(values),
  };
}

function groupBy(runs, key, order) {
  return order
    .map((item) => ({ key: item.key, label: item.label, runs: runs.filter((r) => r[key] === item.key) }))
    .filter((g) => g.runs.length);
}

export function analyze(results, { kind, intersectionNames = {} }) {
  const runs = results.slice().sort((a, b) => a.index - b.index);
  const metrics = metricsFor(kind).filter((m) => runs.some((r) => r.fixed[m.key] != null));
  const headline = metrics[0];

  const overall = Object.fromEntries(metrics.map((m) => [m.key, compare(runs, m)]));

  const groups = (key, order) => groupBy(runs, key, order).map((g) => ({
    ...g,
    count: g.runs.length,
    byMetric: Object.fromEntries(metrics.map((m) => [m.key, compare(g.runs, m)])),
  }));
  const byLevel = groups('level', LEVELS);
  const byPattern = groups('pattern', PATTERNS);
  const byTurn = groups('turn', TURN_MIXES);

  // One row per scenario (level × pattern × turning), averaged over its seeds.
  const scenarioKeys = Array.from(new Set(runs.map((r) => r.scenario)));
  const scenarios = scenarioKeys.map((key) => {
    const rs = runs.filter((r) => r.scenario === key);
    const c = compare(rs, headline);
    return {
      key,
      level: rs[0].level,
      pattern: rs[0].pattern,
      turn: rs[0].turn,
      label: `${labelOf.level(rs[0].level)} · ${labelOf.pattern(rs[0].pattern)}${rs[0].turn !== 'current' ? ` · ${labelOf.turn(rs[0].turn)}` : ''}`,
      seeds: rs.length,
      fixed: c.fixed,
      greedy: c.greedy,
      improvement: c.stats.mean,
      wins: c.stats.wins,
      throughputFixed: mean(rs.map((r) => r.fixed.throughput)),
      throughputGreedy: mean(rs.map((r) => r.greedy.throughput)),
      series: rs.find((r) => r.series)?.series || null,
    };
  });
  const ranked = scenarios.slice().sort((a, b) => b.improvement - a.improvement);

  // Where in the network Greedy helps most (average queue over all runs).
  const ids = Object.keys(runs[0]?.intersections || {});
  const intersections = ids.map((id) => {
    const fixed = mean(runs.map((r) => r.intersections[id]?.fixed ?? 0));
    const greedy = mean(runs.map((r) => r.intersections[id]?.greedy ?? 0));
    return {
      id,
      name: intersectionNames[id] || '',
      fixed,
      greedy,
      change: fixed > 0 ? (fixed - greedy) / fixed : 0,
      greedyBetterRuns: runs.filter((r) => (r.intersections[id]?.greedy ?? 0) < (r.intersections[id]?.fixed ?? 0)).length,
    };
  }).sort((a, b) => (b.fixed - b.greedy) - (a.fixed - a.greedy));

  // Curves over time for the most demanding scenario run.
  const heaviestLevel = LEVELS.slice().reverse().find((l) => scenarios.some((s) => s.level === l.key))?.key;
  const showcase = scenarios.find((s) => s.level === heaviestLevel && s.pattern === 'rush' && s.series)
    || scenarios.find((s) => s.level === heaviestLevel && s.series)
    || scenarios.find((s) => s.series);

  const h = overall[headline.key].stats;
  const total = runs.length;
  const verdict = h.mean > 0
    ? `Greedy reduced the average number of waiting vehicles by ${pct(h.mean).replace('+', '')} compared with the fixed cycle, and did better in ${h.wins} of ${total} runs.`
    : `Greedy did not reduce waiting on average (${pct(h.mean)}); it did better in ${h.wins} of ${total} runs.`;
  const confidence = Number.isFinite(h.low)
    ? (h.low > 0
      ? `Across the runs the improvement is between ${pct(h.low).replace('+', '')} and ${pct(h.high).replace('+', '')} (95% range), so it is not down to chance.`
      : h.high < 0
        ? `Across the runs Greedy is worse by between ${pct(-h.high).replace('+', '')} and ${pct(-h.low).replace('+', '')} (95% range).`
        : `The 95% range (${pct(h.low)} to ${pct(h.high)}) includes zero, so the difference is not clear-cut.`)
    : 'Run more than one scenario to get a 95% range.';
  const findings = [];
  if (byLevel.length > 1) {
    const first = byLevel[0];
    const last = byLevel[byLevel.length - 1];
    const a = first.byMetric[headline.key].stats.mean;
    const b = last.byMetric[headline.key].stats.mean;
    findings.push(`With ${first.label.toLowerCase()} traffic Greedy gives ${lessWaiting(a)}; with ${last.label.toLowerCase()} traffic ${lessWaiting(b)}.`);
  }
  if (byPattern.length > 1) {
    const best = byPattern.slice().sort((x, y) => y.byMetric[headline.key].stats.mean - x.byMetric[headline.key].stats.mean)[0];
    findings.push(`Greedy helps most with ${best.label.toLowerCase()} traffic (${lessWaiting(best.byMetric[headline.key].stats.mean)} on average).`);
  }
  if (overall.throughput) {
    const t = overall.throughput.stats.mean;
    findings.push(`${Math.abs(t * 100).toFixed(1)}% ${t >= 0 ? 'more' : 'fewer'} vehicles got through with Greedy on average.`);
  }
  if (ranked.length > 1) {
    const worst = ranked[ranked.length - 1];
    findings.push(`Best scenario for Greedy: ${ranked[0].label} (${lessWaiting(ranked[0].improvement)}). Weakest: ${worst.label} (${lessWaiting(worst.improvement)}).`);
  }
  if (intersections.length) {
    const top = intersections[0];
    findings.push(`The biggest gain is at ${top.id}${top.name ? ` (${top.name})` : ''}: ${top.fixed.toFixed(1)} vehicles waiting on average with the fixed cycle, ${top.greedy.toFixed(1)} with Greedy.`);
  }

  return {
    kind,
    total,
    metrics,
    headline,
    overall,
    byLevel,
    byPattern,
    byTurn,
    scenarios,
    ranked,
    intersections,
    showcase,
    verdict,
    confidence,
    findings,
  };
}
