// =====================================================
// EXTRACT DETAILS: CHARTS
// Chart.js definitions used both on screen (dark) and, rendered to
// images, in the PDF report (light).
// =====================================================
import Chart from 'chart.js/auto';
import { LEVELS, PATTERNS } from './plan.js';

export const POLICY_COLORS = { fixed: '#f59e0b', greedy: '#22c55e' };
const LEVEL_COLORS = { light: '#38bdf8', normal: '#a78bfa', busy: '#f472b6', heavy: '#ef4444' };

const THEMES = {
  dark: { text: '#cbd5e1', muted: '#94a3b8', grid: 'rgba(148, 163, 184, 0.15)' },
  light: { text: '#1e293b', muted: '#475569', grid: '#e2e8f0' },
};

function baseOptions(theme, { title, xTitle, yTitle, horizontal = false, percent = false, stacked = false } = {}) {
  const t = THEMES[theme];
  const valueAxis = {
    title: yTitle ? { display: true, text: yTitle, color: t.muted } : undefined,
    ticks: { color: t.muted, ...(percent ? { callback: (v) => `${v}%` } : {}) },
    grid: { color: t.grid },
    beginAtZero: true,
    stacked,
  };
  const categoryAxis = {
    title: xTitle ? { display: true, text: xTitle, color: t.muted } : undefined,
    ticks: { color: t.muted },
    grid: { color: t.grid, display: !horizontal },
    stacked,
  };
  return {
    indexAxis: horizontal ? 'y' : 'x',
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      title: title ? { display: true, text: title, color: t.text, font: { size: 14, weight: 'bold' } } : { display: false },
      legend: { labels: { color: t.text, boxWidth: 14 } },
      tooltip: { enabled: true },
    },
    scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
  };
}

const policyBars = (labels, fixed, greedy) => ({
  labels,
  datasets: [
    { label: 'Fixed cycle', data: fixed, backgroundColor: POLICY_COLORS.fixed, borderRadius: 4 },
    { label: 'Greedy (adaptive)', data: greedy, backgroundColor: POLICY_COLORS.greedy, borderRadius: 4 },
  ],
});

const signedColors = (values) => values.map((v) => (v >= 0 ? POLICY_COLORS.greedy : '#ef4444'));

// Average vehicles waiting, Fixed vs Greedy, for each traffic level.
export function levelChart(a, theme = 'dark') {
  const m = a.headline.key;
  return {
    type: 'bar',
    data: policyBars(a.byLevel.map((g) => g.label), a.byLevel.map((g) => g.byMetric[m].fixed), a.byLevel.map((g) => g.byMetric[m].greedy)),
    options: baseOptions(theme, { title: `${a.headline.label} by traffic level`, xTitle: 'Traffic level', yTitle: 'Vehicles waiting (average)' }),
  };
}

// Vehicles that got through, Fixed vs Greedy, for each traffic level.
export function throughputChart(a, theme = 'dark') {
  return {
    type: 'bar',
    data: policyBars(a.byLevel.map((g) => g.label), a.byLevel.map((g) => g.byMetric.throughput.fixed), a.byLevel.map((g) => g.byMetric.throughput.greedy)),
    options: baseOptions(theme, { title: 'Vehicles that got through by traffic level', xTitle: 'Traffic level', yTitle: 'Vehicles (average per run)' }),
  };
}

// Greedy's improvement for each traffic pattern (positive = Greedy better).
export function patternChart(a, theme = 'dark') {
  const m = a.headline.key;
  const values = a.byPattern.map((g) => +(g.byMetric[m].stats.mean * 100).toFixed(1));
  return {
    type: 'bar',
    data: { labels: a.byPattern.map((g) => g.label), datasets: [{ label: 'Improvement with Greedy', data: values, backgroundColor: signedColors(values), borderRadius: 4 }] },
    options: { ...baseOptions(theme, { title: 'Less waiting with Greedy, by traffic pattern', xTitle: 'Traffic pattern', yTitle: 'Change in waiting', percent: true }), plugins: { ...baseOptions(theme, { title: 'Less waiting with Greedy, by traffic pattern' }).plugins, legend: { display: false } } },
  };
}

// Every scenario, best to worst.
export function scenarioChart(a, theme = 'dark') {
  const values = a.ranked.map((s) => +(s.improvement * 100).toFixed(1));
  const base = baseOptions(theme, { title: 'Less waiting with Greedy, every scenario', yTitle: '', horizontal: true, percent: true });
  return {
    type: 'bar',
    data: { labels: a.ranked.map((s) => s.label), datasets: [{ label: 'Improvement with Greedy', data: values, backgroundColor: signedColors(values), borderRadius: 3 }] },
    options: { ...base, plugins: { ...base.plugins, legend: { display: false } } },
  };
}

// Every run as a point: Fixed waiting (x) against Greedy waiting (y).
// Points under the diagonal are runs Greedy won.
export function runsChart(a, results, theme = 'dark') {
  const m = a.headline.key;
  const max = Math.max(1, ...results.flatMap((r) => [r.fixed[m], r.greedy[m]]));
  const base = baseOptions(theme, { title: 'Every run: below the line means Greedy did better', xTitle: 'Fixed cycle: vehicles waiting (average)', yTitle: 'Greedy: vehicles waiting (average)' });
  const t = THEMES[theme];
  return {
    type: 'scatter',
    data: {
      datasets: [
        ...LEVELS.filter((l) => results.some((r) => r.level === l.key)).map((l) => ({
          label: l.label,
          data: results.filter((r) => r.level === l.key).map((r) => ({ x: +r.fixed[m].toFixed(2), y: +r.greedy[m].toFixed(2) })),
          backgroundColor: LEVEL_COLORS[l.key],
          pointRadius: 4,
        })),
        { label: 'Equal', type: 'line', data: [{ x: 0, y: 0 }, { x: max, y: max }], borderColor: t.muted, borderDash: [5, 5], pointRadius: 0, borderWidth: 1 },
      ],
    },
    options: { ...base, scales: { x: { ...base.scales.x, type: 'linear', beginAtZero: true }, y: base.scales.y } },
  };
}

// Waiting over time in the most demanding scenario.
export function timeChart(a, theme = 'dark') {
  const s = a.showcase;
  if (!s?.series) return null;
  const n = s.series.fixed.length;
  const labels = s.series.fixed.map((_, k) => Math.round(((k + 0.5) * s.series.steps) / n));
  const base = baseOptions(theme, { title: `Vehicles waiting over time: ${s.label}`, xTitle: 'Step', yTitle: 'Vehicles waiting' });
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Fixed cycle', data: s.series.fixed.map((v) => +v.toFixed(1)), borderColor: POLICY_COLORS.fixed, backgroundColor: 'rgba(245, 158, 11, 0.12)', fill: true, pointRadius: 0, borderWidth: 2, tension: 0.2 },
        { label: 'Greedy (adaptive)', data: s.series.greedy.map((v) => +v.toFixed(1)), borderColor: POLICY_COLORS.greedy, backgroundColor: 'rgba(34, 197, 94, 0.12)', fill: true, pointRadius: 0, borderWidth: 2, tension: 0.2 },
      ],
    },
    options: { ...base, scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: 10 } } } },
  };
}

// The intersections where waiting differs most.
export function intersectionChart(a, theme = 'dark', limit = 12) {
  const top = a.intersections.slice(0, limit);
  if (!top.length) return null;
  return {
    type: 'bar',
    // Grid intersections are 'row,col'; city ones get their street names.
    data: policyBars(top.map((i) => (/^\d+,\d+$/.test(i.id) ? `(${i.id})` : i.name ? `${i.id} ${i.name.slice(0, 26)}` : i.id)), top.map((i) => +i.fixed.toFixed(1)), top.map((i) => +i.greedy.toFixed(1))),
    options: baseOptions(theme, { title: 'Vehicles waiting at each intersection (average over all runs)', yTitle: '', horizontal: true }),
  };
}

export const PATTERN_NOTES = PATTERNS;

// Draw a chart definition into a JPEG (for the PDF), on white. JPEG keeps
// the report a few hundred kilobytes; PNG charts are stored uncompressed.
export function chartImage(config, width = 1000, height = 460) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const chart = new Chart(canvas.getContext('2d'), {
    ...config,
    options: { ...config.options, responsive: false, maintainAspectRatio: false, animation: false, devicePixelRatio: 1.6 },
    plugins: [{
      id: 'whiteBackground',
      beforeDraw: (c) => {
        const ctx = c.canvas.getContext('2d');
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.restore();
      },
    }],
  });
  const url = chart.toBase64Image('image/jpeg', 0.88);
  chart.destroy();
  return url;
}
