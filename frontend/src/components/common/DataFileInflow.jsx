// =====================================================
// 'FROM DATA FILE' INFLOW
// The fields of the data-file inflow function: load a file of counted
// traffic, choose its column and step length, and for periods how the
// cars are spread. Shows cars per step and warns when the run is longer
// than the data. Used by the grid and the city simulator.
// =====================================================
import { useMemo, useRef, useState } from 'react';
import seedrandom from 'seedrandom';
import {
  DATA_FILE_ACCEPT, DATA_KINDS, SKEW_DIRECTIONS, SKEW_STRENGTHS, SPREADS, skewWeights,
  buildDataSeries, buildDataset, dataStepCount, describeSteps, formatDataTime, makeDataConfig, readDataFile,
} from '../../simulation/dataInflow.js';
import styles from './DataFileInflow.module.css';

const BARS = 90;

function Preview({ series, runSteps }) {
  const n = series.length;
  if (!n) return null;
  const per = Math.max(1, Math.ceil(n / BARS));
  const bars = [];
  for (let k = 0; k < n; k += per) {
    const part = series.slice(k, k + per);
    bars.push(part.reduce((s, v) => s + v, 0) / part.length);
  }
  const max = Math.max(1, ...bars);
  const w = 100 / bars.length;
  const runX = runSteps != null && runSteps < n ? (runSteps / n) * 100 : null;
  return (
    <svg className={styles.chart} viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Cars per step from the file">
      {bars.map((v, k) => (
        <rect key={k} x={k * w} y={40 - (v / max) * 38} width={Math.max(w - 0.15, 0.1)} height={(v / max) * 38} />
      ))}
      {runX != null && <line x1={runX} x2={runX} y1="0" y2="40" className={styles.runLine} />}
    </svg>
  );
}

// timeline: the scenario's shared clock (dataTimeline); onTimelineChange
// changes its step length or start for every source.
// How a skewed period's cars fall across it: a small bar picture.
function ShapePreview({ peak, strength }) {
  const w = skewWeights(24, peak, strength);
  const max = Math.max(...w);
  return (
    <svg className={styles.shape} viewBox="0 0 96 28" preserveAspectRatio="none" role="img" aria-label="Cars across the windows of one period">
      {w.map((v, k) => <rect key={k} x={k * 4} y={28 - (v / max) * 26} width="3.2" height={(v / max) * 26} />)}
    </svg>
  );
}

export default function DataFileInflow({ data, onChange, disabled, sourceNames = [], runSteps, timeline = null, onTimelineChange, stepNote }) {
  const inputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [problems, setProblems] = useState(null); // { fileName, errors }

  // This source on the shared clock.
  // The default spread is shared by every source when the page has one.
  const spreadSet = timeline?.spread || data || {};
  const distribution = spreadSet.spread === 'skewed' ? 'skewed' : 'even';
  const setSpread = (p) => (onTimelineChange && timeline?.spread ? onTimelineChange({ spread: { ...timeline.spread, ...p } }) : onChange({ ...data, ...p }));
  const placed = useMemo(() => (data?.times?.length
    ? { ...data, ...(timeline?.spread || {}), origin: timeline?.origin ?? undefined, stepSeconds: timeline?.stepSeconds ?? data.stepSeconds }
    : null), [data, timeline?.origin, timeline?.stepSeconds, timeline?.spread]);
  const series = useMemo(() => (placed ? buildDataSeries(placed, seedrandom('preview')) : []), [placed]);
  const steps = placed ? dataStepCount(placed) : 0;
  const firstStep = series.findIndex((v) => v > 0);
  const ownSpreads = data?.spreads ? data.spreads.filter(Boolean).length : 0;
  const [startDraft, setStartDraft] = useState(timeline?.start ?? '');
  const total = series.reduce((s, v) => s + v, 0);
  const patch = (p) => onChange({ ...data, ...p });

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLoading(true);
    setProblems(null);
    try {
      const dataset = buildDataset(await readDataFile(file), file.name);
      if (dataset.errors.length) setProblems({ fileName: file.name, errors: dataset.errors });
      else onChange(makeDataConfig(dataset, sourceNames, data || {}));
    } catch (err) {
      setProblems({ fileName: file.name, errors: [{ row: null, text: err.message }] });
    } finally {
      setLoading(false);
    }
  };

  const loaded = Boolean(data?.times?.length);

  return (
    <div className={styles.box}>
      <div className={styles.fileRow}>
        {loaded && <span className={styles.fileName} title={data.fileName}>{data.fileName}</span>}
        <button type="button" className={styles.fileBtn} onClick={() => inputRef.current?.click()} disabled={disabled || loading}>
          {loading ? 'Reading…' : loaded ? 'Replace file' : 'Choose file'}
        </button>
        <input ref={inputRef} type="file" accept={DATA_FILE_ACCEPT} hidden onChange={onFile} aria-label="Traffic data file" />
      </div>
      {!loaded && !problems && (
        <p className={styles.note}>
          CSV, Excel (.xlsx), JSON or text. A time or period column and a cars column.{' '}
          <a href="/docs#traffic-data" target="_blank" rel="noreferrer">File format</a>
        </p>
      )}

      {problems && (
        <div className={styles.errors}>
          <strong>{problems.fileName} was not applied. Fix these rows and load it again:</strong>
          <ul>
            {problems.errors.slice(0, 8).map((er, k) => <li key={k}>{er.row ? `Row ${er.row}: ` : ''}{er.text}</li>)}
          </ul>
          {problems.errors.length > 8 && <span>and {problems.errors.length - 8} more.</span>}
        </div>
      )}

      {loaded && (
        <>
          <div className={styles.fields}>
            <label>
              <span>Rows are</span>
              <select value={data.kind} onChange={(e) => patch({ kind: e.target.value })} disabled={disabled}>
                {Object.entries(DATA_KINDS).map(([k, label]) => (
                  <option key={k} value={k}>{label}{k === data.detectedKind ? ' (detected)' : ''}</option>
                ))}
              </select>
            </label>
            {data.columns?.length > 1 || Object.keys(data.counts || {}).length > 1 ? (
              <label>
                <span>Cars column</span>
                <select value={data.column} onChange={(e) => patch({ column: e.target.value })} disabled={disabled}>
                  {Object.keys(data.counts).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            ) : (
              <label>
                <span>Cars column</span>
                <input value={data.column} readOnly />
              </label>
            )}
          </div>

          {timeline && (
            <div className={styles.timeline}>
              {timeline.origin != null && <p>
                <strong>Shared clock</strong>: step 0 is{' '}
                <strong>{formatDataTime(timeline.origin, timeline.timeKind)}</strong>
                {timeline.start ? ' (set by you)' : timeline.earliestLabel ? ` (earliest data, ${timeline.earliestLabel})` : ''}.
                {firstStep > 0 && ` This source starts at step ${firstStep}.`}
              </p>}
              <div className={styles.fields}>
                <label>
                  <span>1 step = seconds (all sources)</span>
                  <input
                    type="number"
                    min="0.1"
                    step="0.5"
                    value={timeline.stepSeconds}
                    onChange={(e) => { const v = Number(e.target.value); if (v > 0) onTimelineChange?.({ stepSeconds: v }); }}
                    disabled={disabled || !onTimelineChange}
                    title={stepNote || ''}
                  />
                </label>
                <label>
                  <span>Start at (empty = earliest)</span>
                  <input
                    value={startDraft}
                    placeholder={formatDataTime(timeline.earliest, timeline.timeKind)}
                    onChange={(e) => setStartDraft(e.target.value)}
                    onBlur={() => onTimelineChange?.({ start: startDraft.trim() || null })}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    disabled={disabled || !onTimelineChange}
                  />
                </label>
              </div>
              {stepNote && <p className={styles.note}>{stepNote}</p>}
              {timeline.error && <div className={styles.errors}>{timeline.error}</div>}
            </div>
          )}

          {data.kind === 'periods' && (
            <div className={styles.spread}>
              <p>How each period's cars are shared across its windows (all sources).</p>
              {ownSpreads > 0 && (
                <p className={styles.note}>{ownSpreads} of {data.times.length} rows in this file set their own spread; the default is for the rest.</p>
              )}
              <div className={styles.segmented}>
                {Object.entries(SPREADS).map(([k, label]) => (
                  <button key={k} type="button" className={distribution === k ? styles.segActive : ''} onClick={() => setSpread({ spread: k })} disabled={disabled}>
                    {label}
                  </button>
                ))}
              </div>
              <p className={styles.note}>
                {distribution === 'even' && 'Every window gets the average, rounded down or up; the extra cars go to random windows. The seed fixes them, so both policies get the same cars.'}
                {distribution === 'skewed' && 'More cars in some windows than others.'}
              </p>
              {distribution === 'skewed' && (
                <div className={styles.skew}>
                  <div className={styles.skewRow}>
                    <span>Direction: where most cars land</span>
                    <div className={styles.segmented}>
                      {SKEW_DIRECTIONS.map((d) => (
                        <button key={d.key} type="button" className={spreadSet.skewPeak === d.peak ? styles.segActive : ''} onClick={() => setSpread({ skewPeak: d.peak })} disabled={disabled}>{d.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.skewRow}>
                    <span>Skewness</span>
                    <div className={styles.segmented}>
                      {Object.entries(SKEW_STRENGTHS).map(([k, st]) => (
                        <button key={k} type="button" className={spreadSet.skewStrength === k ? styles.segActive : ''} onClick={() => setSpread({ skewStrength: k })} disabled={disabled}>{st.label}</button>
                      ))}
                    </div>
                  </div>
                  <ShapePreview peak={spreadSet.skewPeak ?? 0.5} strength={spreadSet.skewStrength} />
                  <p className={styles.note}>The windows of one period, first to last. Low leans gently; High packs most cars into a few windows.</p>
                </div>
              )}
            </div>
          )}

          <Preview series={series} runSteps={runSteps} />
          <div className={styles.summary}>
            <strong>{total.toLocaleString()} cars</strong> over <strong>{steps.toLocaleString()} steps</strong> ({describeSteps(steps, placed.stepSeconds)}), {data.times.length.toLocaleString()} rows
          </div>
          {runSteps != null && steps < runSteps && (
            <p className={styles.note}>The run is {runSteps} steps; after step {steps} this source sends no cars.</p>
          )}
          {runSteps != null && steps > runSteps && (
            <p className={styles.note}>Data after step {runSteps} is not used.</p>
          )}
        </>
      )}
    </div>
  );
}
