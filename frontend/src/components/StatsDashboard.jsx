import { useMemo, useState, useRef } from 'react';
import { useSimStore } from '../store/useSimStore.js';
import { DIRECTIONS, APPROACH_TO_HEADING, HEADING_LABELS } from '../simulation/constants.js';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import styles from './StatsDashboard.module.css';
import JSZip from 'jszip';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

const CHART_COLORS = {
  fixed: '#f59e0b',
  greedy: '#22c55e',
  fixedBg: 'rgba(245, 158, 11, 0.1)',
  greedyBg: 'rgba(34, 197, 94, 0.1)',
  diff: '#38bdf8',
  diffBg: 'rgba(56, 189, 248, 0.08)',
};

const DIR_COLORS_MAP = { N: '#ef4444', S: '#22c55e', E: '#3b82f6', W: '#f59e0b' };
const DARK_GRID = { color: 'rgba(100, 100, 150, 0.15)' };
const DARK_TICKS = { color: '#7777aa', font: { size: 10, family: 'Inter' } };

const commonOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 0 },
  plugins: { legend: { labels: { color: '#9999bb', font: { size: 11, family: 'Inter' } } } },
  scales: { x: { grid: DARK_GRID, ticks: DARK_TICKS }, y: { grid: DARK_GRID, ticks: DARK_TICKS } },
};

const throughputDiffOptions = {
  ...commonOptions,
  plugins: {
    ...commonOptions.plugins,
    legend: {
      labels: {
        color: '#9aa3c8',
        font: { size: 10, family: 'Inter' },
      },
    },
  },
  scales: {
    x: { ...commonOptions.scales.x, ticks: { ...DARK_TICKS, maxTicksLimit: 8 } },
    y: { ...commonOptions.scales.y, ticks: { ...DARK_TICKS, maxTicksLimit: 6 } },
  },
};

function full(arr) {
  return arr || [];
}

function labelsFor(arr) {
  return (arr || []).map((_, i) => i);
}

function parseIntersectionLabel(label) {
  if (!label || typeof label !== 'string') return null;
  const m = label.match(/^\((\d+),(\d+)\)$/);
  if (!m) return null;
  return { r: parseInt(m[1], 10), c: parseInt(m[2], 10) };
}

function IntersectionCharts({ r, c, perMetrics, policy1, policy2 }) {
  const key = `${r},${c}`;
  const m1 = perMetrics[policy1]?.[key];
  const m2 = perMetrics[policy2]?.[key];
  if (!m1 || !m2) return null;

  const charts = [];

  const qlLabels = labelsFor(m1.queueLengths.N);
  const qlDatasets = [];
  for (const d of DIRECTIONS) {
    const heading = APPROACH_TO_HEADING[d];
    qlDatasets.push({
      label: `Fixed ${HEADING_LABELS[heading]}`,
      data: full(m1.queueLengths[d]),
      borderColor: DIR_COLORS_MAP[heading],
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 0,
    });
    qlDatasets.push({
      label: `Greedy ${HEADING_LABELS[heading]}`,
      data: full(m2.queueLengths[d]),
      borderColor: DIR_COLORS_MAP[heading],
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 0,
      borderDash: [5, 3],
    });
  }
  charts.push(
    <div key="ql" className={styles.chartCard}>
      <h3>Queue Lengths (per approach) - ({r},{c})</h3>
      <div className={styles.chartWrapper}>
        <Line data={{ labels: qlLabels, datasets: qlDatasets }} options={commonOptions} />
      </div>
    </div>
  );

  const avgWaitLabels = labelsFor(m1.avgWait.N);
  const avgWaitDatasets = [];
  for (const d of DIRECTIONS) {
    const heading = APPROACH_TO_HEADING[d];
    avgWaitDatasets.push({
      label: `Fixed ${HEADING_LABELS[heading]}`,
      data: full(m1.avgWait[d]),
      borderColor: DIR_COLORS_MAP[heading],
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 0,
    });
    avgWaitDatasets.push({
      label: `Greedy ${HEADING_LABELS[heading]}`,
      data: full(m2.avgWait[d]),
      borderColor: DIR_COLORS_MAP[heading],
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 0,
      borderDash: [5, 3],
    });
  }
  charts.push(
    <div key="aw" className={styles.chartCard}>
      <h3>Average Waiting Time (per approach) - ({r},{c})</h3>
      <div className={styles.chartWrapper}>
        <Line data={{ labels: avgWaitLabels, datasets: avgWaitDatasets }} options={commonOptions} />
      </div>
    </div>
  );

  const totalWaitLabels = labelsFor(m1.totalWait.N);
  const totalWaitDatasets = [];
  for (const d of DIRECTIONS) {
    const heading = APPROACH_TO_HEADING[d];
    totalWaitDatasets.push({
      label: `Fixed ${HEADING_LABELS[heading]}`,
      data: full(m1.totalWait[d]),
      borderColor: DIR_COLORS_MAP[heading],
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 0,
    });
    totalWaitDatasets.push({
      label: `Greedy ${HEADING_LABELS[heading]}`,
      data: full(m2.totalWait[d]),
      borderColor: DIR_COLORS_MAP[heading],
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 0,
      borderDash: [5, 3],
    });
  }
  charts.push(
    <div key="tw" className={styles.chartCard}>
      <h3>Total Waiting Time (per approach) - ({r},{c})</h3>
      <div className={styles.chartWrapper}>
        <Line data={{ labels: totalWaitLabels, datasets: totalWaitDatasets }} options={commonOptions} />
      </div>
    </div>
  );

  const swLabels = labelsFor(m1.stdWaitTimes);
  charts.push(
    <div key="sw" className={styles.chartCard}>
      <h3>Std Dev of Average Waiting Time - ({r},{c})</h3>
      <div className={styles.chartWrapper}>
        <Line
          data={{
            labels: swLabels,
            datasets: [
              { label: 'Fixed', data: full(m1.stdWaitTimes), borderColor: CHART_COLORS.fixed, backgroundColor: CHART_COLORS.fixedBg, borderWidth: 1.5, pointRadius: 0, fill: true },
              { label: 'Greedy', data: full(m2.stdWaitTimes), borderColor: CHART_COLORS.greedy, backgroundColor: CHART_COLORS.greedyBg, borderWidth: 1.5, pointRadius: 0, fill: true },
            ],
          }}
          options={commonOptions}
        />
      </div>
    </div>
  );

  const stwLabels = labelsFor(m1.stdTotalWaitTimes);
  charts.push(
    <div key="stw" className={styles.chartCard}>
      <h3>Std Dev of Total Waiting Time - ({r},{c})</h3>
      <div className={styles.chartWrapper}>
        <Line
          data={{
            labels: stwLabels,
            datasets: [
              { label: 'Fixed', data: full(m1.stdTotalWaitTimes), borderColor: CHART_COLORS.fixed, backgroundColor: CHART_COLORS.fixedBg, borderWidth: 1.5, pointRadius: 0, fill: true },
              { label: 'Greedy', data: full(m2.stdTotalWaitTimes), borderColor: CHART_COLORS.greedy, backgroundColor: CHART_COLORS.greedyBg, borderWidth: 1.5, pointRadius: 0, fill: true },
            ],
          }}
          options={commonOptions}
        />
      </div>
    </div>
  );

  const allPhases = [...new Set([...(m1.phaseTimeline || []), ...(m2.phaseTimeline || [])])];
  const ptLabels = (m1.decisionTimes && m1.decisionTimes.length > 0)
    ? m1.decisionTimes
    : labelsFor(m1.phaseTimeline || []);
  charts.push(
    <div key="pt" className={styles.chartCard}>
      <h3>Phase Timeline - ({r},{c})</h3>
      <div className={styles.chartWrapperTall}>
        <Line
          data={{
            labels: ptLabels,
            datasets: [
              {
                label: 'Fixed',
                data: full(m1.phaseTimeline),
                borderColor: CHART_COLORS.fixed,
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 0,
                stepped: true,
              },
              {
                label: 'Greedy',
                data: full(m2.phaseTimeline),
                borderColor: CHART_COLORS.greedy,
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 0,
                stepped: true,
              },
            ],
          }}
          options={{
            ...commonOptions,
            scales: {
              ...commonOptions.scales,
              x: {
                ...commonOptions.scales.x,
                ticks: {
                  ...DARK_TICKS,
                  maxTicksLimit: 14,
                  maxRotation: 60,
                  minRotation: 40,
                },
              },
              y: {
                type: 'category',
                labels: allPhases,
                grid: DARK_GRID,
                ticks: {
                  ...DARK_TICKS,
                  callback: (_value, idx) => allPhases[idx] || '',
                },
              },
            },
          }}
        />
      </div>
    </div>
  );

  return charts;
}

export default function StatsDashboard() {
  const chartsRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const snapshot = useSimStore((s) => s.snapshot);
  const config = useSimStore((s) => s.config);
  const [selectedIntersection, setSelectedIntersection] = useState(null);
  const [selectedInflowSeries, setSelectedInflowSeries] = useState('aggregate');
  const [selectedHeatMetric, setSelectedHeatMetric] = useState('queueNow');
  const [activeTab, setActiveTab] = useState('live');

  const sumQueueData = useMemo(() => {
    if (!snapshot) return null;
    const labels = labelsFor(snapshot.fixed.sumQueueSizes);
    return {
      labels,
      datasets: [
        { label: 'Fixed', data: full(snapshot.fixed.sumQueueSizes), borderColor: CHART_COLORS.fixed, backgroundColor: CHART_COLORS.fixedBg, borderWidth: 1.5, pointRadius: 0, fill: true },
        { label: 'Greedy', data: full(snapshot.greedy.sumQueueSizes), borderColor: CHART_COLORS.greedy, backgroundColor: CHART_COLORS.greedyBg, borderWidth: 1.5, pointRadius: 0, fill: true },
      ],
    };
  }, [snapshot]);

  const sumAvgWaitData = useMemo(() => {
    if (!snapshot) return null;
    const labels = labelsFor(snapshot.fixed.sumAvgWaitTimes);
    return {
      labels,
      datasets: [
        { label: 'Fixed', data: full(snapshot.fixed.sumAvgWaitTimes), borderColor: CHART_COLORS.fixed, backgroundColor: CHART_COLORS.fixedBg, borderWidth: 1.5, pointRadius: 0, fill: true },
        { label: 'Greedy', data: full(snapshot.greedy.sumAvgWaitTimes), borderColor: CHART_COLORS.greedy, backgroundColor: CHART_COLORS.greedyBg, borderWidth: 1.5, pointRadius: 0, fill: true },
      ],
    };
  }, [snapshot]);

  const sumTotalWaitData = useMemo(() => {
    if (!snapshot) return null;
    const labels = labelsFor(snapshot.fixed.sumTotalWaitTimes);
    return {
      labels,
      datasets: [
        { label: 'Fixed', data: full(snapshot.fixed.sumTotalWaitTimes), borderColor: CHART_COLORS.fixed, backgroundColor: CHART_COLORS.fixedBg, borderWidth: 1.5, pointRadius: 0, fill: true },
        { label: 'Greedy', data: full(snapshot.greedy.sumTotalWaitTimes), borderColor: CHART_COLORS.greedy, backgroundColor: CHART_COLORS.greedyBg, borderWidth: 1.5, pointRadius: 0, fill: true },
      ],
    };
  }, [snapshot]);

  const vehiclesInNetworkData = useMemo(() => {
    if (!snapshot) return null;
    const labels = labelsFor(snapshot.fixed.vehiclesInNetwork);
    return {
      labels,
      datasets: [
        { label: 'Fixed In Network', data: full(snapshot.fixed.vehiclesInNetwork), borderColor: CHART_COLORS.fixed, backgroundColor: CHART_COLORS.fixedBg, borderWidth: 1.5, pointRadius: 0, fill: true },
        { label: 'Greedy In Network', data: full(snapshot.greedy.vehiclesInNetwork), borderColor: CHART_COLORS.greedy, backgroundColor: CHART_COLORS.greedyBg, borderWidth: 1.5, pointRadius: 0, fill: true },
        { label: 'Total Entered', data: full(snapshot.fixed.enteredTimeSeries), borderColor: '#8b5cf6', backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, borderDash: [5, 3] },
      ],
    };
  }, [snapshot]);

  const throughputData = useMemo(() => {
    if (!snapshot) return null;
    const labels = labelsFor(snapshot.fixed.throughputTimeSeries);
    return {
      labels,
      datasets: [
        { label: 'Fixed Exited', data: full(snapshot.fixed.throughputTimeSeries), borderColor: CHART_COLORS.fixed, backgroundColor: CHART_COLORS.fixedBg, borderWidth: 1.5, pointRadius: 0, fill: true },
        { label: 'Greedy Exited', data: full(snapshot.greedy.throughputTimeSeries), borderColor: CHART_COLORS.greedy, backgroundColor: CHART_COLORS.greedyBg, borderWidth: 1.5, pointRadius: 0, fill: true },
      ],
    };
  }, [snapshot]);

  const throughputDiffData = useMemo(() => {
    if (!snapshot) return null;
    const f = snapshot.fixed.throughputTimeSeries || [];
    const g = snapshot.greedy.throughputTimeSeries || [];
    const n = Math.min(f.length, g.length);
    const diff = [];
    for (let i = 0; i < n; i++) diff.push((g[i] || 0) - (f[i] || 0));
    return {
      labels: labelsFor(diff),
      datasets: [
        {
          label: 'Greedy - Fixed',
          data: diff,
          borderColor: CHART_COLORS.diff,
          backgroundColor: CHART_COLORS.diffBg,
          borderWidth: 1.2,
          pointRadius: 0,
          fill: true,
        },
      ],
    };
  }, [snapshot]);

  const throughputDiffCurrent = useMemo(() => {
    if (!snapshot) return 0;
    return (snapshot.greedy.throughput || 0) - (snapshot.fixed.throughput || 0);
  }, [snapshot]);

  const throughputDiffMessage = useMemo(() => {
    if (throughputDiffCurrent > 0) return `Greedy ahead by ${throughputDiffCurrent}`;
    if (throughputDiffCurrent < 0) return `Fixed ahead by ${Math.abs(throughputDiffCurrent)}`;
    return 'Both equal right now';
  }, [throughputDiffCurrent]);

  const inflowOptions = useMemo(() => {
    const base = [{ value: 'aggregate', label: 'Aggregate (All Boundary Arrivals)' }];
    const keyLabels = snapshot?.inflowSeries?.boundaryKeyLabels || {};
    const keyValues = snapshot?.inflowSeries?.boundaryKeys || [];
    for (const key of keyValues) base.push({ value: key, label: `Selected ${keyLabels[key] || key}` });
    return base;
  }, [snapshot]);

  const inflowChartData = useMemo(() => {
    if (!snapshot?.inflowSeries) return null;
    const inflow = snapshot.inflowSeries;
    const fixed = inflow.realizedBoundaryArrivals?.fixed || {};
    const greedy = inflow.realizedBoundaryArrivals?.greedy || {};

    if (selectedInflowSeries === 'aggregate') {
      return {
        labels: labelsFor(inflow.plannedBoundaryArrivalsTotalSeries || []),
        datasets: [
          { label: 'Planned Aggregate', data: full(inflow.plannedBoundaryArrivalsTotalSeries || []), borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.12)', borderWidth: 1.8, pointRadius: 0, fill: true },
          { label: 'Realized Aggregate (Fixed)', data: full(fixed.totalSeries || []), borderColor: CHART_COLORS.fixed, backgroundColor: 'transparent', borderWidth: 1.6, pointRadius: 0 },
          { label: 'Realized Aggregate (Greedy)', data: full(greedy.totalSeries || []), borderColor: CHART_COLORS.greedy, backgroundColor: 'transparent', borderWidth: 1.6, pointRadius: 0 },
        ],
      };
    }

    const planned = inflow.plannedRateSeriesByKey?.[selectedInflowSeries] || [];
    const realizedFixed = fixed.byKeySeries?.[selectedInflowSeries] || [];
    const realizedGreedy = greedy.byKeySeries?.[selectedInflowSeries] || [];
    return {
      labels: labelsFor(planned),
      datasets: [
        { label: 'Planned Selected Item', data: full(planned), borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.12)', borderWidth: 1.8, pointRadius: 0, fill: true },
        { label: 'Realized Selected (Fixed)', data: full(realizedFixed), borderColor: CHART_COLORS.fixed, backgroundColor: 'transparent', borderWidth: 1.6, pointRadius: 0 },
        { label: 'Realized Selected (Greedy)', data: full(realizedGreedy), borderColor: CHART_COLORS.greedy, backgroundColor: 'transparent', borderWidth: 1.6, pointRadius: 0 },
      ],
    };
  }, [snapshot, selectedInflowSeries]);

  const gridSize = snapshot?.gridSize || config.gridSize;
  const intersections = useMemo(() => {
    const items = [];
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) items.push({ r, c, label: `(${r},${c})` });
    }
    return items;
  }, [gridSize]);

  const queueBarData = useMemo(() => {
    if (!snapshot) return null;
    const MAX_BARS = 36;
    const rows = [];
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const fixedQ = snapshot.fixed.grid?.[r]?.[c]?.totalQueued ?? 0;
        const greedyQ = snapshot.greedy.grid?.[r]?.[c]?.totalQueued ?? 0;
        rows.push({ label: `(${r},${c})`, fixedQ, greedyQ, total: fixedQ + greedyQ });
      }
    }

    let reduced = rows;
    if (rows.length > MAX_BARS) {
      reduced = [...rows].sort((a, b) => b.total - a.total).slice(0, MAX_BARS);
    }

    return {
      labels: reduced.map((x) => x.label),
      datasets: [
        { label: 'Fixed', data: reduced.map((x) => x.fixedQ), backgroundColor: 'rgba(245,158,11,0.65)', borderColor: CHART_COLORS.fixed, borderWidth: 1 },
        { label: 'Greedy', data: reduced.map((x) => x.greedyQ), backgroundColor: 'rgba(34,197,94,0.65)', borderColor: CHART_COLORS.greedy, borderWidth: 1 },
      ],
      limited: rows.length > MAX_BARS,
      originalCount: rows.length,
      shownCount: reduced.length,
    };
  }, [snapshot, gridSize]);

  const heatMetricOptions = [
    { value: 'queueNow', label: 'Current Total Queue (lower is better)' },
    { value: 'avgWaitNow', label: 'Current Avg Wait Sum (lower is better)' },
    { value: 'totalWaitNow', label: 'Current Total Wait Sum (lower is better)' },
    { value: 'vehiclesExited', label: 'Vehicles Exited (higher is better)' },
  ];

  const heatmapData = useMemo(() => {
    if (!snapshot?.perIntersectionMetrics) return null;
    const cells = [];
    let greedyBetter = 0;
    let fixedBetter = 0;
    let tied = 0;

    const latest = (arr) => (arr && arr.length > 0 ? arr[arr.length - 1] : 0);

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const key = `${r},${c}`;
        let fixedVal = 0;
        let greedyVal = 0;

        if (selectedHeatMetric === 'queueNow') {
          fixedVal = snapshot.fixed.grid?.[r]?.[c]?.totalQueued ?? 0;
          greedyVal = snapshot.greedy.grid?.[r]?.[c]?.totalQueued ?? 0;
        } else if (selectedHeatMetric === 'avgWaitNow') {
          const fm = snapshot.perIntersectionMetrics.fixed?.[key];
          const gm = snapshot.perIntersectionMetrics.greedy?.[key];
          fixedVal = DIRECTIONS.reduce((s, d) => s + latest(fm?.avgWait?.[d]), 0);
          greedyVal = DIRECTIONS.reduce((s, d) => s + latest(gm?.avgWait?.[d]), 0);
        } else if (selectedHeatMetric === 'totalWaitNow') {
          const fm = snapshot.perIntersectionMetrics.fixed?.[key];
          const gm = snapshot.perIntersectionMetrics.greedy?.[key];
          fixedVal = DIRECTIONS.reduce((s, d) => s + latest(fm?.totalWait?.[d]), 0);
          greedyVal = DIRECTIONS.reduce((s, d) => s + latest(gm?.totalWait?.[d]), 0);
        } else if (selectedHeatMetric === 'vehiclesExited') {
          fixedVal = snapshot.fixed.grid?.[r]?.[c]?.vehiclesExited ?? 0;
          greedyVal = snapshot.greedy.grid?.[r]?.[c]?.vehiclesExited ?? 0;
        }

        let status = 'tie';
        if (selectedHeatMetric === 'vehiclesExited') {
          if (greedyVal > fixedVal) status = 'greedy';
          else if (greedyVal < fixedVal) status = 'fixed';
        } else {
          if (greedyVal < fixedVal) status = 'greedy';
          else if (greedyVal > fixedVal) status = 'fixed';
        }

        if (status === 'greedy') greedyBetter++;
        else if (status === 'fixed') fixedBetter++;
        else tied++;

        cells.push({
          key,
          fixedVal,
          greedyVal,
          status,
        });
      }
    }

    return { cells, greedyBetter, fixedBetter, tied, total: cells.length };
  }, [snapshot, gridSize, selectedHeatMetric]);

  if (!snapshot) {
    return (
      <div className={styles.dashboard}>
        <h2>Statistics</h2>
        <div className={styles.noData}>Start the simulation to see live statistics</div>
      </div>
    );
  }

  return (
    <div ref={chartsRef} className={styles.dashboard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2>Simulation Analytics</h2>
        <button
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              const zip = new JSZip();

              // Helper to sanitize filenames
              const sanitize = (s) => (s || 'chart').replace(/[^a-z0-9\-_ ]/gi, '').replace(/\s+/g, '_').slice(0, 120);

              // Collect chart configs programmatically to ensure none are missed
              const chartsToRender = [];

              // Live/top bar chart
              if (queueBarData) chartsToRender.push({ folder: 'overview', name: 'Live_Per_Intersection_Queues', type: 'bar', data: queueBarData, options: { ...commonOptions, plugins: { ...commonOptions.plugins, title: { display: true, text: 'Live Per-Intersection Queued Vehicles' } } } });

              // Overview charts
              if (inflowChartData) chartsToRender.push({ folder: 'overview', name: 'Boundary_Inflow', type: 'line', data: inflowChartData, options: { ...commonOptions, plugins: { ...commonOptions.plugins, title: { display: true, text: 'Boundary Inflow (Planned vs Realized)' } } } });
              if (throughputDiffData) chartsToRender.push({ folder: 'overview', name: 'Throughput_Difference', type: 'line', data: throughputDiffData, options: { ...throughputDiffOptions, plugins: { ...throughputDiffOptions.plugins, title: { display: true, text: 'Throughput Difference Over Time' } } } });
              if (sumQueueData) chartsToRender.push({ folder: 'overview', name: 'Sum_Queue_Sizes', type: 'line', data: sumQueueData, options: { ...commonOptions, plugins: { ...commonOptions.plugins, title: { display: true, text: 'Sum of Queue Sizes (All Intersections)' } } } });
              if (sumAvgWaitData) chartsToRender.push({ folder: 'overview', name: 'Sum_Avg_Wait', type: 'line', data: sumAvgWaitData, options: { ...commonOptions, plugins: { ...commonOptions.plugins, title: { display: true, text: 'Sum of Average Waiting Time' } } } });
              if (sumTotalWaitData) chartsToRender.push({ folder: 'overview', name: 'Sum_Total_Wait', type: 'line', data: sumTotalWaitData, options: { ...commonOptions, plugins: { ...commonOptions.plugins, title: { display: true, text: 'Sum of Total Waiting Time' } } } });
              if (vehiclesInNetworkData) chartsToRender.push({ folder: 'overview', name: 'Vehicles_In_Network', type: 'line', data: vehiclesInNetworkData, options: { ...commonOptions, plugins: { ...commonOptions.plugins, title: { display: true, text: 'Total Cars in Network and Entered' } } } });
              if (throughputData) chartsToRender.push({ folder: 'overview', name: 'Cumulative_Throughput', type: 'line', data: throughputData, options: { ...commonOptions, plugins: { ...commonOptions.plugins, title: { display: true, text: 'Cumulative Throughput (Exited)' } } } });

              // Per-intersection charts: ensure we include every intersection's data
              const perMetrics = snapshot?.perIntersectionMetrics || {};
              const fixedMetrics = perMetrics.fixed || {};
              const greedyMetrics = perMetrics.greedy || {};
              const keys = new Set([...Object.keys(fixedMetrics), ...Object.keys(greedyMetrics)]);

              for (const key of Array.from(keys)) {
                const m1 = fixedMetrics[key];
                const m2 = greedyMetrics[key];
                if (!m1 && !m2) continue;
                const folder = `per_intersection/${key}`;

                // Queue lengths per approach
                const qlLabels = labelsFor((m1 && m1.queueLengths && m1.queueLengths.N) || (m2 && m2.queueLengths && m2.queueLengths.N) || []);
                const qlDatasets = [];
                for (const d of DIRECTIONS) {
                  const heading = APPROACH_TO_HEADING[d];
                  qlDatasets.push({ label: `Fixed ${HEADING_LABELS[heading]}`, data: full(m1?.queueLengths?.[d]), borderColor: DIR_COLORS_MAP[heading], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0 });
                  qlDatasets.push({ label: `Greedy ${HEADING_LABELS[heading]}`, data: full(m2?.queueLengths?.[d]), borderColor: DIR_COLORS_MAP[heading], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, borderDash: [5, 3] });
                }
                chartsToRender.push({ folder, name: `Queue_Lengths_${key.replace(/\W+/g, '_')}`, type: 'line', data: { labels: qlLabels, datasets: qlDatasets }, options: { ...commonOptions, plugins: { ...commonOptions.plugins, title: { display: true, text: `Queue Lengths (${key})` } } } });

                // Average waiting time per approach
                const awLabels = labelsFor((m1 && m1.avgWait && m1.avgWait.N) || (m2 && m2.avgWait && m2.avgWait.N) || []);
                const awDatasets = [];
                for (const d of DIRECTIONS) {
                  const heading = APPROACH_TO_HEADING[d];
                  awDatasets.push({ label: `Fixed ${HEADING_LABELS[heading]}`, data: full(m1?.avgWait?.[d]), borderColor: DIR_COLORS_MAP[heading], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0 });
                  awDatasets.push({ label: `Greedy ${HEADING_LABELS[heading]}`, data: full(m2?.avgWait?.[d]), borderColor: DIR_COLORS_MAP[heading], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, borderDash: [5, 3] });
                }
                chartsToRender.push({ folder, name: `Avg_Wait_${key.replace(/\W+/g, '_')}`, type: 'line', data: { labels: awLabels, datasets: awDatasets }, options: { ...commonOptions, plugins: { ...commonOptions.plugins, title: { display: true, text: `Average Waiting Time (${key})` } } } });

                // Total waiting time per approach
                const twLabels = labelsFor((m1 && m1.totalWait && m1.totalWait.N) || (m2 && m2.totalWait && m2.totalWait.N) || []);
                const twDatasets = [];
                for (const d of DIRECTIONS) {
                  const heading = APPROACH_TO_HEADING[d];
                  twDatasets.push({ label: `Fixed ${HEADING_LABELS[heading]}`, data: full(m1?.totalWait?.[d]), borderColor: DIR_COLORS_MAP[heading], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0 });
                  twDatasets.push({ label: `Greedy ${HEADING_LABELS[heading]}`, data: full(m2?.totalWait?.[d]), borderColor: DIR_COLORS_MAP[heading], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, borderDash: [5, 3] });
                }
                chartsToRender.push({ folder, name: `Total_Wait_${key.replace(/\W+/g, '_')}`, type: 'line', data: { labels: twLabels, datasets: twDatasets }, options: { ...commonOptions, plugins: { ...commonOptions.plugins, title: { display: true, text: `Total Waiting Time (${key})` } } } });

                // Std dev charts
                chartsToRender.push({ folder, name: `Std_Avg_Wait_${key.replace(/\W+/g, '_')}`, type: 'line', data: { labels: labelsFor(m1?.stdWaitTimes), datasets: [ { label: 'Fixed', data: full(m1?.stdWaitTimes), borderColor: CHART_COLORS.fixed, backgroundColor: CHART_COLORS.fixedBg, borderWidth: 1.5, pointRadius: 0, fill: true }, { label: 'Greedy', data: full(m2?.stdWaitTimes), borderColor: CHART_COLORS.greedy, backgroundColor: CHART_COLORS.greedyBg, borderWidth: 1.5, pointRadius: 0, fill: true }, ] }, options: { ...commonOptions, plugins: { ...commonOptions.plugins, title: { display: true, text: `Sid Dev Avg Wait (${key})` } } } });

                chartsToRender.push({ folder, name: `Std_Total_Wait_${key.replace(/\W+/g, '_')}`, type: 'line', data: { labels: labelsFor(m1?.stdTotalWaitTimes), datasets: [ { label: 'Fixed', data: full(m1?.stdTotalWaitTimes), borderColor: CHART_COLORS.fixed, backgroundColor: CHART_COLORS.fixedBg, borderWidth: 1.5, pointRadius: 0, fill: true }, { label: 'Greedy', data: full(m2?.stdTotalWaitTimes), borderColor: CHART_COLORS.greedy, backgroundColor: CHART_COLORS.greedyBg, borderWidth: 1.5, pointRadius: 0, fill: true }, ] }, options: { ...commonOptions, plugins: { ...commonOptions.plugins, title: { display: true, text: `Std Dev Total Wait (${key})` } } } });

                // Phase timeline
                const ptLabels = (m1?.decisionTimes && m1.decisionTimes.length > 0) ? m1.decisionTimes : labelsFor(m1?.phaseTimeline || []);
                chartsToRender.push({
                  folder,
                  name: `Phase_Timeline_${key.replace(/\W+/g, '_')}`,
                  type: 'line',
                  data: {
                    labels: ptLabels,
                    datasets: [
                      {
                        label: 'Fixed',
                        data: full(m1?.phaseTimeline),
                        borderColor: CHART_COLORS.fixed,
                        backgroundColor: 'transparent',
                        borderWidth: 1.5,
                        stepped: true,
                        pointRadius: 0,
                      },
                      {
                        label: 'Greedy',
                        data: full(m2?.phaseTimeline),
                        borderColor: CHART_COLORS.greedy,
                        backgroundColor: 'transparent',
                        borderWidth: 1.5,
                        stepped: true,
                        pointRadius: 0,
                        borderDash: [5, 3],
                      },
                    ],
                  },
                  options: {
                    ...commonOptions,
                    plugins: {
                      ...commonOptions.plugins,
                      title: { display: true, text: `Active Phase Timeline (${key})` },
                      tooltip: {
                        callbacks: {
                          label: (context) => {
                            const val = context.raw;
                            return `${context.dataset.label}: Phase ${val === 0 ? 'N/S' : 'E/W'}`;
                          },
                        },
                      },
                    },
                    scales: {
                      ...commonOptions.scales,
                      y: {
                        ...commonOptions.scales.y,
                        ticks: {
                          callback: (value) => (value === 0 ? 'N/S' : 'E/W'),
                        },
                      },
                    },
                  },
                });
              }

              // Render off-screen canvases in sequence to build the output ZIP
              const W = 1000;
              const H = 600;
              const academicOptions = {
                responsive: false,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    labels: {
                      color: '#000000',
                      font: { size: 13, family: 'DejaVu Sans, Arial', weight: 'bold' },
                    },
                  },
                  title: {
                    display: true,
                    color: '#000000',
                    font: { size: 16, family: 'DejaVu Sans, Arial', weight: 'bold' },
                  },
                },
                scales: {
                  x: {
                    grid: { color: 'rgba(0,0,0,0.1)' },
                    ticks: { color: '#000000', font: { size: 11, family: 'DejaVu Sans, Arial' } },
                  },
                  y: {
                    grid: { color: 'rgba(0,0,0,0.1)' },
                    ticks: { color: '#000000', font: { size: 11, family: 'DejaVu Sans, Arial' } },
                  },
                },
              };

              for (const item of chartsToRender) {
                const canvas = document.createElement('canvas');
                canvas.width = W;
                canvas.height = H;
                const ctx = canvas.getContext('2d');

                // Make deep copy of datasets so color edits don't bleed back into screen view
                const exportData = JSON.parse(JSON.stringify(item.data));
                if (exportData.datasets) {
                  for (const ds of exportData.datasets) {
                    ds.borderColor = ds.borderColor === CHART_COLORS.fixed ? '#111111' : ds.borderColor === CHART_COLORS.greedy ? '#555555' : ds.borderColor;
                    if (ds.backgroundColor && ds.backgroundColor.startsWith && ds.backgroundColor.startsWith('rgba')) {
                      ds.backgroundColor = ds.borderColor === '#111111' ? 'rgba(17,17,17,0.05)' : 'rgba(85,85,85,0.05)';
                    }
                    ds.borderWidth = Math.max(ds.borderWidth || 1.5, 2);
                    ds.pointRadius = 0;
                  }
                }

                // Create a hidden container and attach to DOM so Chart.js can compute layout
                const hiddenContainer = document.createElement('div');
                hiddenContainer.style.position = 'fixed';
                hiddenContainer.style.left = '-10000px';
                hiddenContainer.style.top = '0px';
                hiddenContainer.style.width = `${W}px`;
                hiddenContainer.style.height = `${H}px`;
                hiddenContainer.style.overflow = 'hidden';
                hiddenContainer.style.background = '#ffffff';
                canvas.style.background = '#ffffff';
                try { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); } catch (e) { /* ignore */ }
                hiddenContainer.appendChild(canvas);
                document.body.appendChild(hiddenContainer);

                try {
                  const paramsFolder = zip.folder('parameters') || zip.folder('parameters');
                  const paramsObj = {
                    exportedAt: new Date().toISOString(),
                    selectedInflowSeries,
                    gridSize: snapshot?.gridSize || (config && config.gridSize),
                    config: config || null,
                  };
                  paramsFolder.file('simulation_parameters.json', JSON.stringify(paramsObj, null, 2));
                } catch (e) {
                  console.error('Failed to write simulation parameters into ZIP', e);
                }

                const opts = JSON.parse(JSON.stringify(academicOptions || {}));
                opts.responsive = false;
                opts.animation = false;
                opts.maintainAspectRatio = false;
                let chart = null;
                try {
                  const whiteBgPlugin = {
                    id: 'whiteBg',
                    beforeDraw: (chartInstance) => {
                      try {
                        const ctx = chartInstance.ctx;
                        ctx.save();
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, chartInstance.width, chartInstance.height);
                        ctx.restore();
                      } catch (e) { /* ignore */ }
                    },
                  };

                  chart = new ChartJS(canvas, { type: item.type || 'line', data: exportData, options: opts, plugins: [whiteBgPlugin] });
                  await new Promise((res) => setTimeout(res, 300));
                  try { await chart.update(); } catch (u) { /* ignore */ }
                } catch (e) {
                  console.error('ChartJS construct/update failed', e);
                }

                let dataUrl = null;
                try {
                  if (chart && typeof chart.toBase64Image === 'function') dataUrl = chart.toBase64Image();
                } catch (e) {
                  console.warn('chart.toBase64Image failed, falling back to canvas.toDataURL', e);
                }
                if (!dataUrl) {
                  try {
                    dataUrl = canvas.toDataURL('image/png');
                  } catch (e) {
                    console.error('canvas.toDataURL failed', e);
                    dataUrl = null;
                  }
                }
                const base64 = dataUrl ? dataUrl.split(',')[1] : '';
                const folder = zip.folder(item.folder || 'charts');
                const filename = `${sanitize(item.name)}.png`;
                if (base64 && base64.length > 100) {
                  folder.file(filename, base64, { base64: true });
                } else {
                  folder.file(filename, '', { base64: true });
                  const dbg = `FAILED EXPORT\nchart: ${item.name}\nfolder: ${item.folder}\nbase64Length: ${base64 ? base64.length : 0}\nDataURLPrefix: ${dataUrl ? dataUrl.slice(0,200) : 'null'}\n`;
                  zip.file(`${sanitize(item.name)}.debug.txt`, dbg);
                }
                try { if (chart) chart.destroy(); } catch (e) { /* ignore */ }
                try { document.body.removeChild(hiddenContainer); } catch (e) { /* ignore */ }
              }

              const content = await zip.generateAsync({ type: 'blob' });
              if (!content || !content.size) {
                alert('Export failed: created ZIP is empty (0 bytes). Check console for errors.');
                console.error('ZIP generation returned empty blob', content);
                return;
              }

              let url;
              try {
                url = URL.createObjectURL(content);
              } catch (uErr) {
                console.error('URL.createObjectURL failed', uErr);
                try {
                  const fr = new FileReader();
                  const dataUrl = await new Promise((resolve, reject) => {
                    fr.onload = () => resolve(fr.result);
                    fr.onerror = reject;
                    fr.readAsDataURL(content);
                  });
                  url = dataUrl;
                } catch (rErr) {
                  console.error('Data URL fallback failed', rErr);
                  alert('Export failed: unable to create download URL. See console for details.');
                  return;
                }
              }

              const a = document.createElement('a');
              a.href = url;
              a.download = `sim_charts_${Date.now()}.zip`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              if (url && url.startsWith && url.startsWith('blob:')) URL.revokeObjectURL(url);
            } catch (err) {
              console.error(err);
              alert(`Failed to export charts: ${err && err.message ? err.message : err}`);
            } finally {
              setExporting(false);
            }
          }}
          className={styles.exportBtn}
        >
          {exporting ? 'Exporting…' : 'Export Charts (ZIP)'}
        </button>
      </div>

      {/* KPI Stats Grid */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Throughput (Exited)</div>
          <div className={styles.statCompare}>
            <span className={`${styles.statValue} ${styles.fixed}`}>{snapshot.fixed.throughput}</span>
            <span className={styles.statSep}>vs</span>
            <span className={`${styles.statValue} ${styles.greedy}`}>{snapshot.greedy.throughput}</span>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Throughput Gap</div>
          <div className={styles.statValueRow}>
            <span className={`${styles.statValue} ${throughputDiffCurrent >= 0 ? styles.greedy : styles.fixed}`}>
              {Math.abs(throughputDiffCurrent)}
            </span>
            <span className={styles.statTiny}>{throughputDiffMessage}</span>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>In Network Now</div>
          <div className={styles.statCompare}>
            <span className={`${styles.statValue} ${styles.fixed}`}>{(snapshot.fixed.vehiclesInNetwork || []).slice(-1)[0] || 0}</span>
            <span className={styles.statSep}>vs</span>
            <span className={`${styles.statValue} ${styles.greedy}`}>{(snapshot.greedy.vehiclesInNetwork || []).slice(-1)[0] || 0}</span>
          </div>
        </div>
      </div>

      {/* Analytics Tabs Row */}
      <div className={styles.tabRow}>
        <button 
          className={`${styles.tabBtn} ${activeTab === 'live' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('live')}
        >
          Queue Metrics
        </button>
        <button 
          className={`${styles.tabBtn} ${activeTab === 'congestion' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('congestion')}
        >
          Congestion Trends
        </button>
        <button 
          className={`${styles.tabBtn} ${activeTab === 'inflows' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('inflows')}
        >
          Traffic Inflows
        </button>
        <button 
          className={`${styles.tabBtn} ${activeTab === 'intersections' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('intersections')}
        >
          Intersection Details
        </button>
      </div>

      {/* Tab: Queue Metrics */}
      {activeTab === 'live' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className={styles.liveTopSection}>
            <h2>Live Per-Intersection Queued Vehicles (Fixed vs Greedy)</h2>
            {queueBarData?.limited && (
              <div className={styles.liveHint}>
                Showing top {queueBarData.shownCount} of {queueBarData.originalCount} intersections by current queue total.
              </div>
            )}
            <div className={styles.liveChartWrapper}>
              {queueBarData && (
                <div
                  className={styles.liveChartScroller}
                  style={{ minWidth: `${Math.max(760, queueBarData.labels.length * 34)}px` }}
                >
                  <Bar
                    data={{ labels: queueBarData.labels, datasets: queueBarData.datasets }}
                    options={{
                      ...commonOptions,
                      scales: {
                        ...commonOptions.scales,
                        x: {
                          ...commonOptions.scales.x,
                          ticks: { ...DARK_TICKS, maxRotation: 55, minRotation: 35 },
                        },
                      },
                      datasets: {
                        bar: {
                          maxBarThickness: 22,
                          categoryPercentage: 0.82,
                          barPercentage: 0.9,
                        },
                      },
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          <div className={styles.chartCard}>
            <h3>Per-Intersection Win/Loss Heatmap</h3>
            <div style={{ marginBottom: '8px' }}>
              <select
                value={selectedHeatMetric}
                onChange={(e) => setSelectedHeatMetric(e.target.value)}
              >
                {heatMetricOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className={styles.heatmapSummary}>
              <span className={styles.heatGreedy}>Greedy better: {heatmapData?.greedyBetter ?? 0}</span>
              <span className={styles.heatFixed}>Fixed better: {heatmapData?.fixedBetter ?? 0}</span>
              <span className={styles.heatTie}>Tie: {heatmapData?.tied ?? 0}</span>
              <span className={styles.heatTotal}>Total intersections: {heatmapData?.total ?? 0}</span>
            </div>
            <div className={styles.heatmapGrid}>
              {(heatmapData?.cells || []).map((cell) => (
                <div
                  key={cell.key}
                  className={`${styles.heatCell} ${cell.status === 'greedy' ? styles.heatCellGreedy : cell.status === 'fixed' ? styles.heatCellFixed : styles.heatCellTie}`}
                  title={`${cell.key} | Fixed: ${cell.fixedVal.toFixed(2)} | Greedy: ${cell.greedyVal.toFixed(2)}`}
                >
                  <div className={styles.heatCellKey}>{cell.key}</div>
                  <div className={styles.heatCellVals}>F: {cell.fixedVal.toFixed(1)} | G: {cell.greedyVal.toFixed(1)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Congestion Trends */}
      {activeTab === 'congestion' && (
        <div className={styles.chartsGrid}>
          <div className={styles.chartCard}>
            <h3>Sum of Queue Sizes (All Intersections)</h3>
            <div className={styles.chartWrapper}>
              {sumQueueData && <Line data={sumQueueData} options={commonOptions} />}
            </div>
          </div>

          <div className={styles.chartCard}>
            <h3>Sum of Average Waiting Time (All Intersections)</h3>
            <div className={styles.chartWrapper}>
              {sumAvgWaitData && <Line data={sumAvgWaitData} options={commonOptions} />}
            </div>
          </div>

          <div className={styles.chartCard}>
            <h3>Sum of Total Waiting Time (All Intersections)</h3>
            <div className={styles.chartWrapper}>
              {sumTotalWaitData && <Line data={sumTotalWaitData} options={commonOptions} />}
            </div>
          </div>

          <div className={styles.chartCard}>
            <h3>Cumulative Throughput (Exited)</h3>
            <div className={styles.chartWrapper}>
              {throughputData && <Line data={throughputData} options={commonOptions} />}
            </div>
          </div>

          <div className={styles.chartCard}>
            <h3>Throughput Difference Over Time</h3>
            <div className={styles.chartWrapperCompact}>
              {throughputDiffData && <Line data={throughputDiffData} options={throughputDiffOptions} />}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Traffic Inflows */}
      {activeTab === 'inflows' && (
        <div className={styles.chartsGrid}>
          <div className={styles.chartCard}>
            <h3>Boundary Inflow Function (Planned vs Realized)</h3>
            <div style={{ marginBottom: '8px' }}>
              <select
                value={selectedInflowSeries}
                onChange={(e) => setSelectedInflowSeries(e.target.value)}
              >
                {inflowOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className={styles.chartWrapper}>
              {inflowChartData && <Line data={inflowChartData} options={commonOptions} />}
            </div>
          </div>

          <div className={styles.chartCard}>
            <h3>Total Cars in Network and Entered</h3>
            <div className={styles.chartWrapper}>
              {vehiclesInNetworkData && <Line data={vehiclesInNetworkData} options={commonOptions} />}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Intersection Details */}
      {activeTab === 'intersections' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className={styles.chartCard}>
            <h3>Select Intersection for Detailed Analysis</h3>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {intersections.map(({ label }) => (
                <button
                  key={label}
                  onClick={() => setSelectedIntersection(selectedIntersection === label ? null : label)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: selectedIntersection === label ? '2px solid #3b82f6' : '1px solid #1e293b',
                    background: selectedIntersection === label ? 'rgba(59, 130, 246, 0.2)' : '#0b0f19',
                    color: selectedIntersection === label ? '#60a5fa' : '#cbd5e1',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    transition: 'all 0.2s',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {selectedIntersection && snapshot.perIntersectionMetrics && parseIntersectionLabel(selectedIntersection) && (
            <div className={styles.chartsGrid}>
              {(() => {
                const rc = parseIntersectionLabel(selectedIntersection);
                return (
                  <IntersectionCharts
                    r={rc.r}
                    c={rc.c}
                    perMetrics={snapshot.perIntersectionMetrics}
                    policy1="fixed"
                    policy2="greedy"
                  />
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
