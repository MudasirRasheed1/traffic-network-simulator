// =====================================================
// EXTRACT DETAILS
// Runs many simulations with different traffic (level, pattern, turning,
// seed), shows what they say about Fixed cycle vs Greedy, and downloads
// a PDF report. Used by both the grid and the city simulator.
// =====================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from 'react-chartjs-2';
import { LEVELS, PATTERNS, SEED_COUNTS, TURN_MIXES, buildRuns } from '../../experiments/plan.js';
import { analyze, pct } from '../../experiments/analysis.js';
import { intersectionChart, levelChart, patternChart, runsChart, scenarioChart, throughputChart, timeChart } from '../../experiments/charts.js';
import { downloadCsv, downloadReport } from '../../experiments/report.js';
import { createBackgroundWorker } from '../../utils/backgroundWorker.js';
import { missingDataMessage } from '../../simulation/dataInflow.js';
import styles from './ExperimentPanel.module.css';

// One runner for the page, loaded when the panel first shows.
const runner = createBackgroundWorker(() => new Worker(new URL('../../experiments/experimentWorker.js', import.meta.url), { type: 'module' }));

function Chips({ options, value, onChange }) {
  const toggle = (key) => {
    const next = value.includes(key) ? value.filter((k) => k !== key) : [...value, key];
    if (next.length) onChange(next);
  };
  return (
    <div className={styles.chips}>
      {options.map((o) => (
        <button key={o.key} type="button" className={value.includes(o.key) ? styles.chipOn : styles.chip} onClick={() => toggle(o.key)} title={o.description || ''}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ChartBox({ config, tall = false, wide = false }) {
  if (!config) return null;
  return (
    <div className={`${styles.chartBox} ${wide ? styles.wide : ''}`} style={{ height: tall ? Math.max(320, (config.data.labels?.length || 10) * 22 + 90) : 300 }}>
      <Chart type={config.type} data={config.data} options={config.options} />
    </div>
  );
}

// '76.7% less with Greedy' for waiting, '51.8% more with Greedy' for vehicles through.
const changeText = (metric, v) => {
  const better = v >= 0;
  const goesDown = metric.lowerIsBetter ? better : !better;
  return `${Math.abs(v * 100).toFixed(1)}% ${goesDown ? 'less' : 'more'} with Greedy`;
};

const seconds = (ms) => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60000)} min`);

/**
 * kind               'city' or 'grid'
 * title              report title
 * networkLabel       what the network is, for the report
 * makeBase()         what the runner needs: city: { city, config, overrides };
 *                    grid: { state, activeSides }
 * defaults           { duration, baseRate, baseSeed }
 * setupRows          extra [label, value] rows for the report
 * intersectionNames  { id: name } for the report
 * dataSources        [{ label, profile }] sources fed from a data file
 */
export default function ExperimentPanel({ kind, title, networkLabel, makeBase, defaults, setupRows = [], intersectionNames = {}, rateHint, dataSources = [] }) {
  const [levels, setLevels] = useState(LEVELS.map((l) => l.key));
  const [patterns, setPatterns] = useState(PATTERNS.map((p) => p.key));
  const [turns, setTurns] = useState(['current']);
  const [seeds, setSeeds] = useState(3);
  const [duration, setDuration] = useState(defaults.duration);
  const [baseRate, setBaseRate] = useState(defaults.baseRate);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [usedSetup, setUsedSetup] = useState(null);
  const jobRef = useRef(null);

  useEffect(() => {
    runner.warm();
    return () => { if (jobRef.current) runner.forget(jobRef.current); };
  }, []);
  // Follow the simulator's own settings until a batch has been run.
  useEffect(() => { if (!progress && !results.length) setDuration(defaults.duration); }, [defaults.duration]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!progress && !results.length) setBaseRate(defaults.baseRate); }, [defaults.baseRate]); // eslint-disable-line react-hooks/exhaustive-deps

  const runCount = levels.length * patterns.length * turns.length * seeds;
  const avgMs = results.length ? results.reduce((s, r) => s + r.ms, 0) / results.length : null;

  const start = () => {
    // A data-file source without a file: say so before running anything.
    const missing = missingDataMessage(dataSources);
    if (missing) { setError(missing); return; }
    if (jobRef.current) runner.forget(jobRef.current);
    const runs = buildRuns({ levels, patterns, turnMixes: turns, seeds, baseSeed: defaults.baseSeed ?? 1 });
    const base = { ...makeBase(), duration: Math.max(20, Math.round(duration)), baseRate: Number(baseRate) };
    setResults([]);
    setError('');
    setProgress({ done: 0, total: runs.length, startedAt: performance.now() });
    setUsedSetup({ levels, patterns, turns, seeds, duration: base.duration, baseRate: base.baseRate });
    const job = runner.run({ kind, base, runs }, {
      onProgress: (msg) => {
        setResults((prev) => [...prev, msg.result]);
        setProgress((p) => (p ? { ...p, done: msg.done } : p));
      },
    });
    jobRef.current = job.id;
    job.promise.then(
      () => { setProgress(null); jobRef.current = null; },
      (err) => { setError(err.message); setProgress(null); jobRef.current = null; },
    );
  };
  const cancel = () => {
    if (jobRef.current) runner.forget(jobRef.current);
    jobRef.current = null;
    setProgress(null);
  };

  const analysis = useMemo(() => (results.length ? analyze(results, { kind, intersectionNames }) : null), [results, kind, intersectionNames]);

  const reportSetup = () => ({
    title,
    network: networkLabel,
    rows: [
      ['Simulator', kind === 'city' ? 'City Simulator (real road network)' : 'Grid Simulator'],
      ['Network', networkLabel],
      ...setupRows,
      ...(dataSources.length ? [['Data file sources', `${dataSources.map((d) => `${d.label} (${d.profile.functionConfig.data.fileName})`).join(', ')}. Levels scale the file; patterns do not apply to them.`]] : []),
      ['Runs', `${results.length} (${usedSetup.levels.length} levels × ${usedSetup.patterns.length} patterns × ${usedSetup.turns.length} turning mix${usedSetup.turns.length > 1 ? 'es' : ''} × ${usedSetup.seeds} seed${usedSetup.seeds > 1 ? 's' : ''})`],
      ['Traffic levels', LEVELS.filter((l) => usedSetup.levels.includes(l.key)).map((l) => `${l.label} (${l.scale}×)`).join(', ')],
      ['Traffic patterns', PATTERNS.filter((p) => usedSetup.patterns.includes(p.key)).map((p) => p.label).join(', ')],
      ['Turning', TURN_MIXES.filter((t) => usedSetup.turns.includes(t.key)).map((t) => (t.probs ? `${t.label} (T ${t.probs.T}, R ${t.probs.R}, L ${t.probs.L})` : t.label)).join(', ')],
      ['Base inflow', `${usedSetup.baseRate} cars/step ${kind === 'city' ? 'per source' : 'per entry point on each active side'}`],
      ['Run length', `${usedSetup.duration} steps`],
    ],
  });

  const t = progress ? performance.now() - progress.startedAt : 0;
  const remaining = progress && progress.done ? (t / progress.done) * (progress.total - progress.done) : null;
  const h = analysis?.overall[analysis.headline.key].stats;

  return (
    <section className={styles.panel} id="extract-details">
      <div className={styles.header}>
        <div>
          <h2>Extract Details</h2>
          <p>Runs Fixed cycle and Greedy on many different kinds of traffic and sums up which one does better, where and by how much.</p>
        </div>
        {/* Always shown so it can be found; usable once a batch has run. */}
        <div className={styles.downloads}>
          <button
            type="button"
            className={styles.primary}
            disabled={!analysis || !!progress}
            title={analysis ? '' : 'Run the simulations below first'}
            onClick={() => downloadReport(analysis, results, reportSetup())}
          >
            Download PDF report
          </button>
          <button type="button" className={styles.secondary} disabled={!analysis || !!progress} onClick={() => downloadCsv(analysis, results)}>Download runs (CSV)</button>
          {!analysis && !progress && <span className={styles.downloadHint}>Run the simulations below to create the report.</span>}
        </div>
      </div>

      <div className={styles.setup}>
        <div className={styles.option}>
          <span>Traffic levels</span>
          <Chips options={LEVELS.map((l) => ({ ...l, description: `${l.scale}× the base inflow` }))} value={levels} onChange={setLevels} />
        </div>
        <div className={styles.option}>
          <span>Traffic patterns</span>
          <Chips options={PATTERNS} value={patterns} onChange={setPatterns} />
        </div>
        <div className={styles.option}>
          <span>Turning</span>
          <Chips options={TURN_MIXES} value={turns} onChange={setTurns} />
        </div>
        <div className={styles.option}>
          <span>Seeds per scenario</span>
          <Chips options={SEED_COUNTS.map((n) => ({ key: n, label: String(n) }))} value={[seeds]} onChange={(v) => setSeeds(v.find((x) => x !== seeds) ?? seeds)} />
        </div>
        <label className={styles.option}>
          <span>Base inflow (cars/step)</span>
          <input type="number" min="0.1" step="0.5" value={baseRate} onChange={(e) => { const v = Number(e.target.value); if (v > 0) setBaseRate(v); }} />
          {rateHint && <em>{rateHint}</em>}
        </label>
        <label className={styles.option}>
          <span>Run length (steps)</span>
          <input type="number" min="20" step="10" value={duration} onChange={(e) => { const v = Number(e.target.value); if (v >= 20) setDuration(v); }} />
        </label>
      </div>

      <div className={styles.runRow}>
        {progress
          ? <button type="button" className={styles.secondary} onClick={cancel}>Cancel</button>
          : <button type="button" className={styles.primary} onClick={start}>Run {runCount} simulation{runCount === 1 ? '' : 's'}</button>}
        <span className={styles.runInfo}>
          {progress
            ? `Run ${progress.done} of ${progress.total}${remaining != null ? ` · about ${seconds(remaining)} left` : ''}`
            : `${levels.length} level${levels.length === 1 ? '' : 's'} × ${patterns.length} pattern${patterns.length === 1 ? '' : 's'} × ${turns.length} turning × ${seeds} seed${seeds === 1 ? '' : 's'}${avgMs ? ` · about ${seconds(avgMs * runCount)}` : ''}`}
        </span>
      </div>
      {progress && <div className={styles.progress}><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>}
      {error && <div className={styles.error}>{error}</div>}

      {analysis && (
        <div className={styles.results}>
          <div className={`${styles.verdict} ${h.mean > 0 ? styles.good : styles.bad}`}>
            <strong>{analysis.verdict}</strong>
            <span>{analysis.confidence}</span>
            {progress && <em>Results so far: {results.length} of {progress.total} runs.</em>}
          </div>

          <div className={styles.kpis}>
            {analysis.metrics.map((m) => {
              const o = analysis.overall[m.key];
              return (
                <div key={m.key} className={styles.kpi}>
                  <span className={styles.kpiLabel}>{m.label}</span>
                  <div className={styles.kpiValues}>
                    <span className={styles.kpiFixed}>{m.format(o.fixed)}</span>
                    <span className={styles.kpiVs}>vs</span>
                    <span className={styles.kpiGreedy}>{m.format(o.greedy)}</span>
                  </div>
                  <span className={o.stats.mean >= 0 ? styles.up : styles.down}>{changeText(m, o.stats.mean)}</span>
                  <span className={styles.kpiNote}>better in {o.stats.wins} of {o.stats.n} runs</span>
                </div>
              );
            })}
          </div>

          {analysis.findings.length > 0 && (
            <ul className={styles.findings}>
              {analysis.findings.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}

          <div className={styles.charts}>
            {analysis.byLevel.length > 0 && <ChartBox config={levelChart(analysis)} />}
            {analysis.byPattern.length > 0 && <ChartBox config={patternChart(analysis)} />}
            <ChartBox config={runsChart(analysis, results)} />
            <ChartBox config={timeChart(analysis)} />
            {analysis.overall.throughput && analysis.byLevel.length > 0 && <ChartBox config={throughputChart(analysis)} />}
            <ChartBox config={intersectionChart(analysis)} tall />
            <ChartBox config={scenarioChart(analysis)} tall wide />
          </div>

          <h3 className={styles.tableTitle}>Scenarios</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Scenario</th><th>Seeds</th><th>Fixed: waiting</th><th>Greedy: waiting</th><th>Change</th><th>Greedy better</th><th>Fixed: through</th><th>Greedy: through</th></tr>
              </thead>
              <tbody>
                {analysis.scenarios.map((s) => (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    <td>{s.seeds}</td>
                    <td>{s.fixed.toFixed(1)}</td>
                    <td>{s.greedy.toFixed(1)}</td>
                    <td className={s.improvement >= 0 ? styles.up : styles.down}>{pct(s.improvement)}</td>
                    <td>{s.wins}/{s.seeds}</td>
                    <td>{Math.round(s.throughputFixed)}</td>
                    <td>{Math.round(s.throughputGreedy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
