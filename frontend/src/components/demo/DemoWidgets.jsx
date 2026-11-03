// =====================================================
// START HERE: SMALL LIVE VIEWS
// InflowChart: the cars entering per step on each side, from the run
// itself, with a marker at the current step.
// PhaseTimeline: which signal phase Fixed and Greedy chose at one
// intersection, step by step.
// =====================================================
import styles from './DemoWidgets.module.css';

// Inflow from a side travels the other way: cars entering from the north
// are southbound.
export const HEADINGS = [
  { key: 'south', label: 'Southbound', side: 'N', color: '#38bdf8' },
  { key: 'north', label: 'Northbound', side: 'S', color: '#a78bfa' },
  { key: 'west', label: 'Westbound', side: 'E', color: '#2dd4bf' },
  { key: 'east', label: 'Eastbound', side: 'W', color: '#f472b6' },
];

export function InflowChart({ engine, time = 0 }) {
  const series = engine?.arrivalRateSeriesByKey;
  if (!series) return null;
  const perSide = HEADINGS.map((h) => {
    const keys = Object.keys(series).filter((k) => k.endsWith(`,${h.side}`));
    if (!keys.length) return null;
    const n = series[keys[0]].length;
    const avg = Array.from({ length: n }, (_, t) => keys.reduce((s, k) => s + (series[k][t] || 0), 0) / keys.length);
    return avg.some((v) => v > 0) ? { ...h, values: avg } : null;
  }).filter(Boolean);
  // Directions with exactly the same traffic share one line.
  const lines = [];
  for (const side of perSide) {
    const same = lines.find((l) => l.values.length === side.values.length && l.values.every((v, t) => v === side.values[t]));
    if (same) same.label = perSide.length > 1 && same.count + 1 === perSide.length && perSide.length === 4 ? 'All directions' : `${same.label}, ${side.label}`;
    if (same) same.count += 1;
    else lines.push({ ...side, count: 1 });
  }
  if (!lines.length) return null;
  const n = Math.max(...lines.map((l) => l.values.length));
  const max = Math.max(1, ...lines.flatMap((l) => l.values));
  const x = (t) => (t / Math.max(1, n - 1)) * 100;
  const y = (v) => 38 - (v / max) * 34;
  return (
    <div className={styles.box}>
      <div className={styles.head}>
        <strong>Cars entering per step, per road</strong>
        <span className={styles.keys}>
          {lines.map((l) => <span key={l.key}><i style={{ background: l.color }} />{l.label}</span>)}
        </span>
      </div>
      <svg className={styles.chart} viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Cars entering per step">
        {lines.map((l) => (
          <polyline key={l.key} points={l.values.map((v, t) => `${x(t)},${y(v)}`).join(' ')} fill="none" stroke={l.color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={x(time)} x2={x(time)} y1="0" y2="40" className={styles.now} />
      </svg>
      <div className={styles.axis}><span>Step 0</span><span>up to {Math.round(max * 10) / 10} cars</span><span>Step {n}</span></div>
    </div>
  );
}

// Phase names: NT_ST, ET_WT, NR_SR, ER_WR, and one heading at a time
// (NT_NR and so on; the turn letter depends on the driving side).
const HEADING_NAMES = { N: 'Northbound', S: 'Southbound', E: 'Eastbound', W: 'Westbound' };
const HEADING_COLORS = { N: '#a78bfa', S: '#38bdf8', E: '#f472b6', W: '#2dd4bf' };

export function phaseInfo(name) {
  if (!name) return { label: 'None', color: '#334155' };
  if (name === 'NT_ST') return { label: 'North and south, straight', color: '#22c55e' };
  if (name === 'ET_WT') return { label: 'East and west, straight', color: '#eab308' };
  const one = /^([NSEW])T_\1[LR]$/.exec(name);
  if (one) return { label: `${HEADING_NAMES[one[1]]}, all moves`, color: HEADING_COLORS[one[1]] };
  if (/^N[LR]_S[LR]$/.test(name)) return { label: 'North and south, turns', color: '#f97316' };
  if (/^E[LR]_W[LR]$/.test(name)) return { label: 'East and west, turns', color: '#ef4444' };
  return { label: name, color: '#64748b' };
}

function TimelineRow({ label, phases, steps }) {
  const w = 100 / Math.max(1, steps);
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <svg className={styles.track} viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label={`${label} phases`}>
        {phases.map((p, t) => (p ? <rect key={t} x={t * w} y="0" width={w + 0.05} height="10" fill={phaseInfo(p).color} /> : null))}
      </svg>
    </div>
  );
}

/**
 * history[t] = { fixed: phase[r][c], greedy: phase[r][c] }
 * cell = [r, c]; onCell picks another intersection.
 */
export function PhaseTimeline({ history, gridSize, steps, cell, onCell }) {
  const [r, c] = cell;
  const at = (pol) => history.map((h) => h?.[pol]?.[r]?.[c] || null);
  const fixed = at('fixed');
  const greedy = at('greedy');
  const used = [...new Set([...fixed, ...greedy].filter(Boolean))];
  return (
    <div className={styles.box}>
      <div className={styles.head}>
        <strong>Signal phases over time</strong>
        <span className={styles.picker}>
          Intersection
          <span className={styles.cells} style={{ gridTemplateColumns: `repeat(${gridSize}, 1fr)` }}>
            {Array.from({ length: gridSize * gridSize }, (_, k) => {
              const rr = Math.floor(k / gridSize);
              const cc = k % gridSize;
              return (
                <button key={k} type="button" className={rr === r && cc === c ? styles.cellOn : ''} onClick={() => onCell([rr, cc])} title={`Row ${rr}, column ${cc}`} />
              );
            })}
          </span>
        </span>
      </div>
      <TimelineRow label="Fixed cycle" phases={fixed} steps={steps} />
      <TimelineRow label="Greedy" phases={greedy} steps={steps} />
      <div className={styles.legend}>
        {used.map((p) => <span key={p}><i style={{ background: phaseInfo(p).color }} />{phaseInfo(p).label}</span>)}
      </div>
    </div>
  );
}
