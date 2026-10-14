import { useEffect, useRef, useState } from 'react';
import { useCityStore } from '../../store/useCityStore.js';
import { METRICS, improvement, pairedStats } from '../../simulation/cityMetrics.js';
import nx from '../network/NetworkExplorer.module.css';
import styles from './CitySimulator.module.css';
import { createBackgroundWorker } from '../../utils/backgroundWorker.js';

// Runs several seeds off the main thread; loaded once and reused.
const batchRunner = createBackgroundWorker(() => new Worker(new URL('../../simulation/cityBatchWorker.js', import.meta.url), { type: 'module' }));

const RUN_COUNTS = [5, 10, 20];
const pct = (v) => `${v >= 0 ? '' : '−'}${Math.abs(v * 100).toFixed(1)}%`;

// Runs the current scenario with N different seeds and reports how
// consistently your policy beats the fixed cycle.
export default function MultiSeedPanel() {
  const { city, config, overrides, inflows } = useCityStore();
  const [count, setCount] = useState(10);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const workerRef = useRef(null);
  const scenarioKey = JSON.stringify({ config, overrides, inflows });
  const [resultKey, setResultKey] = useState(null);

  // Load the runner as soon as the panel shows; stop waiting when it closes.
  useEffect(() => {
    batchRunner.warm();
    return () => { if (workerRef.current) batchRunner.forget(workerRef.current); };
  }, []);

  const run = () => {
    if (workerRef.current) batchRunner.forget(workerRef.current);
    const seeds = Array.from({ length: count }, (_, k) => Number(config.seed) + k);
    setProgress({ done: 0, total: count });
    setError('');
    setResult(null);
    const job = batchRunner.run(
      { city, config, overrides, inflows, seeds },
      { onProgress: (msg) => setProgress({ done: msg.done, total: msg.total }) },
    );
    workerRef.current = job.id;
    job.promise.then(
      (msg) => {
        setResult(msg.runs);
        setResultKey(scenarioKey);
        setProgress(null);
        workerRef.current = null;
      },
      (err) => {
        setError(err.message);
        setProgress(null);
        workerRef.current = null;
      },
    );
  };

  const stale = result && resultKey !== scenarioKey;
  const rows = result
    ? METRICS.map((m) => {
      const values = result.map((r) => improvement(r.fixed[m.key], r.greedy[m.key], m.lowerIsBetter)).filter((v) => v != null);
      const meanOf = (pol) => result.reduce((s, r) => s + r[pol][m.key], 0) / result.length;
      return { ...m, fixed: meanOf('fixed'), greedy: meanOf('greedy'), stats: pairedStats(values) };
    })
    : [];

  return (
    <div className={styles.rankCard}>
      <div className={styles.chartTitle}>
        Multi-Seed Comparison <span>(same scenario, different seeds)</span>
      </div>
      <div className={styles.seedControls}>
        <div className={nx.segmented}>
          {RUN_COUNTS.map((n) => (
            <button key={n} type="button" className={count === n ? nx.segActive : ''} onClick={() => setCount(n)} disabled={Boolean(progress)}>
              {n} runs
            </button>
          ))}
        </div>
        <button type="button" className={nx.primaryBtn} style={{ flex: 'none' }} onClick={run} disabled={Boolean(progress)}>
          {progress ? `Running ${progress.done}/${progress.total}…` : result ? 'Run again' : 'Run comparison'}
        </button>
        {progress && (
          <button type="button" className={nx.secondaryBtn} style={{ marginTop: 0 }} onClick={() => { if (workerRef.current) batchRunner.forget(workerRef.current); workerRef.current = null; setProgress(null); }}>
            Cancel
          </button>
        )}
      </div>
      {progress && <div className={styles.progress}><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>}
      {error && <div className={nx.errorText}>{error}</div>}
      {stale && <div className={nx.warnText}>Scenario changed. Run again to update.</div>}
      {result && (
        <>
          <table className={styles.rankTable}>
            <thead>
              <tr><th>Metric</th><th>Fixed (avg)</th><th>Greedy (avg)</th><th>Improvement</th><th>95% range</th><th>Runs won</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = r.stats;
                const cls = s.low > 0 ? styles.better : s.high < 0 ? styles.worse : styles.same;
                return (
                  <tr key={r.key} style={{ cursor: 'default' }}>
                    <td>{r.label}</td>
                    <td>{r.format(r.fixed)}</td>
                    <td>{r.format(r.greedy)}</td>
                    <td className={cls}>{pct(s.mean)}</td>
                    <td className={cls}>{Number.isFinite(s.low) ? `${pct(s.low)} to ${pct(s.high)}` : '-'}</td>
                    <td>{s.wins} / {s.n}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={nx.paramDetail}>
            Paired by seed. Green: the full 95% range is above zero. Seeds {result[0].seed} to {result.at(-1).seed}.
          </p>
        </>
      )}
    </div>
  );
}
