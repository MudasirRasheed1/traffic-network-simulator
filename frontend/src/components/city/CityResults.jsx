import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { improvement, policySummary as summarize } from '../../simulation/cityMetrics.js';
import MultiSeedPanel from './MultiSeedPanel.jsx';
import styles from './CitySimulator.module.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

export const POLICY_COLORS = { fixed: '#f472b6', greedy: '#38bdf8' };
const DIRS = ['N', 'S', 'E', 'W'];

function Tile({ label, fixed, greedy, format, lowerIsBetter = true, hint }) {
  const imp = improvement(fixed, greedy, lowerIsBetter);
  const good = imp != null && imp > 0.005;
  const bad = imp != null && imp < -0.005;
  return (
    <div className={styles.resultTile} title={hint}>
      <span className={styles.resultLabel}>{label}</span>
      <div className={styles.resultValues}>
        <span><i style={{ background: POLICY_COLORS.fixed }} />{format(fixed)}</span>
        <span><i style={{ background: POLICY_COLORS.greedy }} />{format(greedy)}</span>
      </div>
      <span className={good ? styles.better : bad ? styles.worse : styles.same}>
        {imp == null ? '—' : `${good ? '▼' : bad ? '▲' : '='} ${Math.abs(imp * 100).toFixed(1)}% ${good ? 'better' : bad ? 'worse' : ''}`}
      </span>
    </div>
  );
}

function SeriesChart({ title, fixed, greedy, stepSeconds, unit }) {
  const labels = fixed.map((_, t) => ((t * stepSeconds) / 60).toFixed(1));
  const data = {
    labels,
    datasets: [
      { label: 'Fixed cycle', data: fixed, borderColor: POLICY_COLORS.fixed, backgroundColor: 'rgba(244,114,182,0.08)', borderWidth: 1.6, pointRadius: 0, fill: true, tension: 0.2 },
      { label: 'Your policy', data: greedy, borderColor: POLICY_COLORS.greedy, backgroundColor: 'rgba(56,189,248,0.08)', borderWidth: 1.6, pointRadius: 0, fill: true, tension: 0.2 },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { title: (items) => `minute ${items[0].label}`, label: (item) => `${item.dataset.label}: ${Number(item.raw).toFixed(1)} ${unit}` } },
    },
    scales: {
      x: { ticks: { color: '#94a3b8', maxTicksLimit: 8, callback: (v, i) => `${labels[i]}′` }, grid: { color: 'rgba(148,163,184,0.08)' } },
      y: { beginAtZero: true, ticks: { color: '#94a3b8', maxTicksLimit: 5 }, grid: { color: 'rgba(148,163,184,0.1)' } },
    },
  };
  return (
    <div className={styles.chartCard}>
      <div className={styles.chartTitle}>{title}</div>
      <div className={styles.chartBody}><Line data={data} options={options} /></div>
    </div>
  );
}

export default function CityResults({ snapshot, stepSeconds, city, onSelect }) {
  const summary = useMemo(() => (snapshot?.fixed.sumQueueSizes.length ? {
    fixed: summarize(snapshot.fixed, stepSeconds),
    greedy: summarize(snapshot.greedy, stepSeconds),
  } : null), [snapshot, stepSeconds]);

  const ranking = useMemo(() => {
    if (!snapshot?.fixed.sumQueueSizes.length) return [];
    const avgQueue = (pol, id) => {
      const q = snapshot.perIntersectionMetrics[pol][id].queueLengths;
      const n = q.N.length || 1;
      let total = 0;
      for (const d of DIRS) total += q[d].reduce((a, b) => a + b, 0);
      return total / n;
    };
    return city.intersections
      .map((i) => ({ id: i.id, name: i.name, fixed: avgQueue('fixed', i.id), greedy: avgQueue('greedy', i.id) }))
      .sort((a, b) => b.fixed - a.fixed);
  }, [snapshot, city]);

  if (!summary) {
    return (
      <div className={styles.results}>
        <div className={styles.resultsEmpty}>Press <strong>Run</strong> — Fixed cycle and your policy run side by side on exactly the same traffic, and the comparison appears here.</div>
        <MultiSeedPanel />
      </div>
    );
  }
  const f = summary.fixed;
  const g = summary.greedy;
  const minutes = ((snapshot.time * stepSeconds) / 60).toFixed(1);
  const avgWait = (pol) => snapshot[pol].sumTotalWaitTimes.map((tw, t) => {
    const q = snapshot[pol].sumQueueSizes[t];
    return q ? (tw / q) * stepSeconds : 0;
  });

  return (
    <div className={styles.results}>
      <div className={styles.resultsHead}>
        <span>After <strong>{minutes} min</strong> of simulated traffic</span>
        <span className={styles.policyKey}><i style={{ background: POLICY_COLORS.fixed }} />Fixed cycle <i style={{ background: POLICY_COLORS.greedy }} />Your policy (greedy lookahead)</span>
      </div>
      <div className={styles.resultTiles}>
        <Tile label="Avg vehicles waiting" fixed={f.avgQueued} greedy={g.avgQueued} format={(v) => v.toFixed(1)} hint="Average number of vehicles queued at all intersections" />
        <Tile label="Total delay" fixed={f.delayVehHours} greedy={g.delayVehHours} format={(v) => `${v.toFixed(1)} veh·h`} hint="Vehicle-hours spent waiting in queues" />
        <Tile label="Peak queue" fixed={f.peakQueued} greedy={g.peakQueued} format={(v) => v.toFixed(0)} hint="Most vehicles queued at one moment" />
        <Tile label="Trips completed" fixed={f.completed} greedy={g.completed} format={(v) => v.toFixed(0)} lowerIsBetter={false} hint="Vehicles that crossed the network and left" />
        <Tile label="Avg trip time" fixed={f.avgTripMin} greedy={g.avgTripMin} format={(v) => `${v.toFixed(1)} min`} hint="From entering at a source to leaving at a sink" />
      </div>
      <div className={styles.chartGrid}>
        <SeriesChart title="Vehicles waiting at intersections" fixed={snapshot.fixed.sumQueueSizes} greedy={snapshot.greedy.sumQueueSizes} stepSeconds={stepSeconds} unit="vehicles" />
        <SeriesChart title="Average wait of queued vehicles (s)" fixed={avgWait('fixed')} greedy={avgWait('greedy')} stepSeconds={stepSeconds} unit="s" />
        <SeriesChart title="Vehicles in the network" fixed={snapshot.fixed.vehiclesInNetwork} greedy={snapshot.greedy.vehiclesInNetwork} stepSeconds={stepSeconds} unit="vehicles" />
        <SeriesChart title="Trips completed (cumulative)" fixed={snapshot.fixed.throughputTimeSeries} greedy={snapshot.greedy.throughputTimeSeries} stepSeconds={stepSeconds} unit="trips" />
      </div>
      <MultiSeedPanel />
      <div className={styles.rankCard}>
        <div className={styles.chartTitle}>Intersections by average queue <span>(click to inspect)</span></div>
        <table className={styles.rankTable}>
          <thead><tr><th>Intersection</th><th>Fixed</th><th>Yours</th><th>Change</th></tr></thead>
          <tbody>
            {ranking.map((r) => {
              const imp = improvement(r.fixed, r.greedy);
              return (
                <tr key={r.id} onClick={() => onSelect({ type: 'intersection', id: r.id })}>
                  <td><code>{r.id}</code> {r.name || <span className={styles.muted}>unnamed</span>}</td>
                  <td>{r.fixed.toFixed(1)}</td>
                  <td>{r.greedy.toFixed(1)}</td>
                  <td className={imp == null ? '' : imp > 0.005 ? styles.better : imp < -0.005 ? styles.worse : styles.same}>
                    {imp == null ? '—' : `${imp > 0 ? '−' : '+'}${Math.abs(imp * 100).toFixed(0)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
