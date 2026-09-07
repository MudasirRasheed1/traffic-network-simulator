import { PHASES, APPROACH_TO_HEADING } from '../simulation/constants.js';
import styles from './AlgorithmReasoningModal.module.css';

const DIR_LABELS = {
  N: 'Northbound',
  S: 'Southbound',
  E: 'Eastbound',
  W: 'Westbound',
};

const PHASE_DESCRIPTIONS = {
  NT_NR: 'Northbound Through + Right',
  ST_SR: 'Southbound Through + Right',
  ET_ER: 'Eastbound Through + Right',
  WT_WR: 'Westbound Through + Right',
  NT_ST: 'Northbound + Southbound Through',
  ET_WT: 'Eastbound + Westbound Through',
  NR_SR: 'Northbound + Southbound Right',
  ER_WR: 'Eastbound + Westbound Right',
};

function MovementTag({ approach, movement }) {
  const heading = APPROACH_TO_HEADING[approach];
  const label = `${DIR_LABELS[heading].charAt(0)}${movement}`;
  return <span className={styles.movementTag}>{label}</span>;
}

function sumDirMap(map) {
  if (!map) return 0;
  return (map.N || 0) + (map.S || 0) + (map.E || 0) + (map.W || 0);
}

function fmtDirMap(map) {
  const safe = map || { N: 0, S: 0, E: 0, W: 0 };
  return `${safe.N}/${safe.S}/${safe.E}/${safe.W}`;
}

function fmtIntentMap(intentMap) {
  if (!intentMap) return '-';
  const parts = [];
  for (const d of ['N', 'S', 'E', 'W']) {
    const x = intentMap[d];
    if (!x) continue;
    const total = (x.T || 0) + (x.R || 0) + (x.L || 0);
    if (total > 0) {
      parts.push(`${d}(T:${x.T || 0},R:${x.R || 0},L:${x.L || 0})`);
    }
  }
  return parts.length > 0 ? parts.join(' ') : '-';
}

function QueueBar({ label, valueBefore, valueAfter, maxVal, color }) {
  const pctBefore = maxVal > 0 ? (valueBefore / maxVal) * 100 : 0;
  const pctAfter = maxVal > 0 ? (valueAfter / maxVal) * 100 : 0;
  return (
    <div className={styles.queueBarRow}>
      <span className={styles.queueBarLabel} style={{ color }}>{label}</span>
      <div className={styles.queueBarTrack}>
        <div className={styles.queueBarBefore} style={{ width: `${pctBefore}%`, background: color, opacity: 0.35 }} />
        <div className={styles.queueBarAfter} style={{ width: `${pctAfter}%`, background: color }} />
      </div>
      <span className={styles.queueBarValues}>{valueBefore} &rarr; {valueAfter}</span>
    </div>
  );
}

function CostBreakdown({ result, weights }) {
  const terms = [
    { label: 'w1 * sumTotalWait', weight: weights.totalWaitWeight, value: result.sumTotalWait, term: result.costTerms?.termTotalWait },
    { label: 'w2 * stdTotalWait', weight: weights.totalWaitStdWeight, value: result.stdTotalWait, term: result.costTerms?.termStdTotalWait },
    { label: 'w3 * sumQ', weight: weights.queueWeight, value: result.sumQ, term: result.costTerms?.termSumQ },
    { label: 'w4 * stdQ', weight: weights.queueStdWeight, value: result.stdQ, term: result.costTerms?.termStdQ },
  ];

  return (
    <div className={styles.costBreakdown}>
      {terms.map((term, i) => (
        <div key={i} className={styles.costTerm}>
          <span className={styles.costLabel}>{term.label}</span>
          <span className={styles.costCalc}>
            {term.weight.toFixed(1)} x {term.value.toFixed(2)} = {Number.isFinite(term.term) ? term.term.toFixed(2) : (term.weight * term.value).toFixed(2)}
          </span>
        </div>
      ))}
      <div className={styles.costTotal}>
        <span>Total Score</span>
        <span className={styles.costTotalValue}>{result.totalScore.toFixed(2)}</span>
      </div>
    </div>
  );
}

function StepTraceTable({ traces }) {
  if (!Array.isArray(traces) || traces.length === 0) return null;

  return (
    <div className={styles.traceWrap}>
      <div className={styles.traceTitle}>Per-step lookahead trace (exact numbers used)</div>
      <div className={styles.traceScroller}>
        <table className={styles.traceTable}>
          <thead>
            <tr>
              <th>t</th>
              <th>Qstart N/S/E/W</th>
              <th>+Boundary N/S/E/W</th>
              <th>Boundary intents</th>
              <th>+Transit N/S/E/W</th>
              <th>-FreeLeft N/S/E/W</th>
              <th>-Phase N/S/E/W</th>
              <th>Qend N/S/E/W</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((row) => (
              <tr key={row.time}>
                <td>{row.time}</td>
                <td>{fmtDirMap(row.queueStart)}</td>
                <td>{fmtDirMap(row.boundaryToQueue)}</td>
                <td>{fmtIntentMap(row.boundaryArrivalsByIntent)}</td>
                <td>{fmtDirMap(row.transitToQueue)}</td>
                <td>{fmtDirMap(row.freeLeftDepartures)}</td>
                <td>{fmtDirMap(row.phaseDepartures)}</td>
                <td>{fmtDirMap(row.queueEnd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AlgorithmReasoningModal({ data, onClose, currentTime, greedyDecisionInterval }) {
  if (!data) return null;

  const dirs = ['N', 'S', 'E', 'W'];
  const dirColors = { N: '#ef4444', S: '#22c55e', E: '#3b82f6', W: '#f59e0b' };

  // Find max queue length for bar scaling
  let maxQ = 1;
  for (const d of dirs) {
    maxQ = Math.max(maxQ, data.queuesBefore[d]);
    for (const cr of data.candidateResults) {
      maxQ = Math.max(maxQ, cr.queuesAfter[d]);
    }
  }

  // Sort candidates by score for display (best first)
  const sortedCandidates = [...data.candidateResults].sort((a, b) => a.totalScore - b.totalScore);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>X</button>

        <div className={styles.modalHeader}>
          <h2>Algorithm Reasoning - Decision at t = {data.time}</h2>
          <div className={styles.headerMeta}>
            Decision state: {data.decisionState || 'end-of-step'} | Lookahead horizon: {data.lookaheadH} steps ({data.phaseAppliesFrom ?? (data.time + 1)} to {data.time + data.lookaheadH}) | Next decision at t = {data.time + greedyDecisionInterval}
          </div>
        </div>

        {/* Section 1: Input Data */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Input Data (State at Decision Time)</h3>
          <div className={styles.inputGrid}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Direction</th>
                  <th>Queue Length</th>
                  <th>Total Wait (steps)</th>
                  <th>Departure Cap / step</th>
                </tr>
              </thead>
              <tbody>
                {dirs.map((d) => (
                  <tr key={d}>
                    <td style={{ color: dirColors[APPROACH_TO_HEADING[d]] }}>
                      {DIR_LABELS[APPROACH_TO_HEADING[d]]}
                    </td>
                    <td>{data.queuesBefore[d]}</td>
                    <td>{(data.totalWaitBefore[d] || 0).toFixed(2)}</td>
                    <td>{data.departureRates[d]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.weightsBox}>
              <div className={styles.weightsTitle}>Objective Weights</div>
              <div className={styles.weightItem}>w1 (total wait) = {data.weights.totalWaitWeight}</div>
              <div className={styles.weightItem}>w2 (total wait std) = {data.weights.totalWaitStdWeight}</div>
              <div className={styles.weightItem}>w3 (queue len) = {data.weights.queueWeight}</div>
              <div className={styles.weightItem}>w4 (queue std) = {data.weights.queueStdWeight}</div>
            </div>
          </div>
        </div>

        {/* Section 2: Known Horizon Inputs */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Known Lookahead Inputs (Pre-sampled / configured)</h3>
          <div className={styles.traceScroller}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Future t</th>
                  <th>Boundary arrival rates N/S/E/W</th>
                  <th>Total boundary arrivals</th>
                  <th>Departure caps N/S/E/W</th>
                </tr>
              </thead>
              <tbody>
                {(data.horizonInputs || []).map((h) => (
                  <tr key={h.time}>
                    <td>{h.time}</td>
                    <td>{fmtDirMap(h.boundaryArrivalRates)}</td>
                    <td>{sumDirMap(h.boundaryArrivalRates)}</td>
                    <td>{fmtDirMap(h.departureCaps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 2: Phase Evaluations */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            Phase Evaluation (8 Candidates, {data.lookaheadH}-Step Lookahead)
          </h3>
          <div className={styles.phaseGrid}>
            {sortedCandidates.map((cr, idx) => {
              const phaseMovements = PHASES[cr.phase];
              return (
                <div
                  key={cr.phase}
                  className={`${styles.phaseCard} ${cr.isBest ? styles.bestPhase : ''}`}
                >
                  {cr.isBest && <div className={styles.bestBadge}>BEST</div>}
                  <div className={styles.phaseCardHeader}>
                    <span className={styles.phaseRank}>#{idx + 1}</span>
                    <span className={styles.phaseName}>{cr.phase}</span>
                    <span className={styles.phaseDesc}>{PHASE_DESCRIPTIONS[cr.phase]}</span>
                  </div>
                  <div className={styles.phaseMovements}>
                    {phaseMovements.map(([approach, movement], i) => (
                      <MovementTag key={i} approach={approach} movement={movement} />
                    ))}
                  </div>
                  <div className={styles.queuePrediction}>
                    <div className={styles.queuePredTitle}>Queue Prediction (before &rarr; after {data.lookaheadH} steps)</div>
                    {dirs.map((d) => (
                      <QueueBar
                        key={d}
                        label={DIR_LABELS[APPROACH_TO_HEADING[d]].charAt(0)}
                        valueBefore={data.queuesBefore[d]}
                        valueAfter={cr.queuesAfter[d]}
                        maxVal={maxQ}
                        color={dirColors[APPROACH_TO_HEADING[d]]}
                      />
                    ))}
                  </div>
                  <StepTraceTable traces={cr.stepTrace} />
                  <CostBreakdown result={cr} weights={data.weights} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Section 3: Decision */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Decision</h3>
          <div className={styles.decisionBox}>
            <div className={styles.decisionPhase}>
              Selected Phase: <strong>{data.bestPhase}</strong>
            </div>
            <div className={styles.decisionDesc}>
              {PHASE_DESCRIPTIONS[data.bestPhase]}
            </div>
            <div className={styles.decisionScore}>
              Minimum cost: {data.bestScore.toFixed(2)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
