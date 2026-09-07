import { useState, useMemo, useEffect } from 'react';
import { useSimStore } from '../store/useSimStore.js';
import AlgorithmReasoningModal from './AlgorithmReasoningModal.jsx';
import styles from './GridVisualization.module.css';

const DIRECTION_CONFIG = {
  N: {
    name: 'North',
    label: 'Northbound',
    color: '#38bdf8', // Sky Cyan
  },
  S: {
    name: 'South',
    label: 'Southbound',
    color: '#a78bfa', // Violet Purple
  },
  E: {
    name: 'East',
    label: 'Eastbound',
    color: '#2dd4bf', // Emerald Teal
  },
  W: {
    name: 'West',
    label: 'Westbound',
    color: '#f472b6', // Coral Pink
  },
};

function getQueueLevel(total) {
  if (total <= 5) return 'low';
  if (total <= 15) return 'medium';
  if (total <= 30) return 'high';
  return 'critical';
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { r: 26, g: 26, b: 46 };
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

function lerpColor(baseHex, targetHex, t) {
  const base = hexToRgb(baseHex);
  const target = hexToRgb(targetHex);
  const x = Math.max(0, Math.min(1, t));
  const r = Math.round(base.r + (target.r - base.r) * x);
  const g = Math.round(base.g + (target.g - base.g) * x);
  const b = Math.round(base.b + (target.b - base.b) * x);
  return `rgb(${r}, ${g}, ${b})`;
}

function getRelativeNodeStyle(sign, normDiff) {
  const base = '#1a1a2e';
  const redTarget = '#7f1d1d';
  const greenTarget = '#14532d';
  const blueNeutral = '#2a3550';

  const strength = Math.pow(Math.max(0, Math.min(1, normDiff)), 1.6);

  if (sign > 0) {
    return {
      background: lerpColor(base, redTarget, strength),
      borderColor: lerpColor('#333355', '#ef4444', Math.min(1, strength + 0.15)),
    };
  }
  if (sign < 0) {
    return {
      background: lerpColor(base, greenTarget, strength),
      borderColor: lerpColor('#333355', '#22c55e', Math.min(1, strength + 0.15)),
    };
  }
  return {
    background: lerpColor(base, blueNeutral, 0.45),
    borderColor: '#4f5d82',
  };
}

function IntersectionNode({ data, isGreedy, decisionData, currentTime, greedyDecisionInterval, onOpenReasoning, relativeDiff, maxAbsDiff, coordLabel, gridSize = 3 }) {
  const [hovered, setHovered] = useState(false);
  if (!data) return <div className={styles.intersection} />;
  const nodeCoordLabel = coordLabel || `(${data.row},${data.col})`;
  const level = getQueueLevel(data.totalQueued);
  const signedDiff = isGreedy ? relativeDiff : -relativeDiff;
  const normalized = maxAbsDiff > 0 ? Math.abs(relativeDiff) / maxAbsDiff : 0;
  const tie = relativeDiff === 0;
  const relativeStyle = getRelativeNodeStyle(signedDiff, normalized);

  let stepsUntilDecision = null;
  if (isGreedy && greedyDecisionInterval > 0 && currentTime != null) {
    const elapsed = currentTime % greedyDecisionInterval;
    stepsUntilDecision = elapsed === 0 ? 0 : greedyDecisionInterval - elapsed;
  }

  const isDecisionTime = stepsUntilDecision === 0;

  // Smart boundary-aware tooltip positioning
  const placeBelow = data.row < Math.ceil(gridSize / 2);
  const isLeftEdge = data.col === 0;
  const isRightEdge = data.col === gridSize - 1 && gridSize > 1;

  const horizontalAlignClass = isLeftEdge
    ? styles.tooltipAlignLeft
    : (isRightEdge ? styles.tooltipAlignRight : styles.tooltipAlignCenter);
  const verticalPlacementClass = placeBelow ? styles.tooltipBottom : styles.tooltipTop;

  return (
    <div
      className={`${styles.intersection} ${tie ? styles[level] : ''}`}
      style={!tie ? relativeStyle : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={styles.intersectionHeader}>
        <span className={styles.intersectionLabel}>{nodeCoordLabel}</span>
      </div>

      <div className={styles.queueCount}>{data.totalQueued}</div>
      <div className={styles.phaseLabel}>{data.currentPhase || ''}</div>

      {/* Sleek directional queue bars with full tooltips */}
      <div className={styles.queueBars}>
        {['N', 'S', 'E', 'W'].map((d) => (
          <div
            key={d}
            className={styles.queueBar}
            style={{
              background: DIRECTION_CONFIG[d].color,
              opacity: Math.min(1, 0.35 + data.queueLengths[d] / 8),
            }}
            title={`${DIRECTION_CONFIG[d].name} Queue: ${data.queueLengths[d]}`}
          />
        ))}
      </div>

      {hovered && (
        <div className={`${styles.tooltip} ${verticalPlacementClass} ${horizontalAlignClass} ${isGreedy ? styles.tooltipGreedy : ''}`}>
          <div className={styles.tooltipTitle}>Intersection {nodeCoordLabel}</div>
          
          <div className={styles.tooltipQueueHeader}>Approach Queues</div>
          {['N', 'S', 'E', 'W'].map((d) => (
            <div key={d} className={styles.tooltipQueueRow}>
              <div className={styles.tooltipQueueLabel}>
                <div
                  className={styles.tooltipColorSwatch}
                  style={{ background: DIRECTION_CONFIG[d].color }}
                />
                <span style={{ color: DIRECTION_CONFIG[d].color, fontWeight: 700 }}>
                  {DIRECTION_CONFIG[d].name}
                </span>
              </div>
              <div className={styles.tooltipQueueValGroup}>
                <div className={styles.tooltipBarTrack}>
                  <div
                    className={styles.tooltipBarFill}
                    style={{
                      background: DIRECTION_CONFIG[d].color,
                      width: `${Math.min(100, (data.queueLengths[d] / 12) * 100)}%`,
                    }}
                  />
                </div>
                <span className={styles.tooltipQueueCount}>{data.queueLengths[d]}</span>
              </div>
            </div>
          ))}

          <div className={styles.tooltipDivider} />
          <div className={styles.tooltipRow}><span>Active Phase</span><span>{data.currentPhase || 'None'}</span></div>
          <div className={styles.tooltipRow}><span>Vehicles Served</span><span>{data.vehiclesServed}</span></div>
          <div className={styles.tooltipRow}><span>Vehicles Exited</span><span>{data.vehiclesExited}</span></div>
          {isGreedy && stepsUntilDecision != null && (
            <>
              <div className={styles.tooltipDivider} />
              <div className={styles.tooltipRow}>
                <span>Next decision in</span>
                <span className={isDecisionTime ? styles.decisionNow : ''}>
                  {isDecisionTime ? 'NOW' : `${stepsUntilDecision} steps`}
                </span>
              </div>
              {decisionData && (
                <button
                  className={styles.reasoningBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenReasoning(data.row, data.col);
                  }}
                >
                  Visualize Algorithm Reasoning
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function HRoad({ count, fromR, fromC, toR, toC, roadsData }) {
  const keyE = fromC < toC ? `${fromR},${fromC}->${toR},${toC}` : `${toR},${toC}->${fromR},${fromC}`;
  const keyW = fromC < toC ? `${toR},${toC}->${fromR},${fromC}` : `${fromR},${fromC}->${toR},${toC}`;
  const countE = roadsData[keyE] || 0;
  const countW = roadsData[keyW] || 0;

  return (
    <div className={styles.roadH}>
      <div className={styles.roadLine} style={{ background: DIRECTION_CONFIG.E.color, top: '35%' }} />
      <div className={styles.roadLine} style={{ background: DIRECTION_CONFIG.W.color, top: '55%' }} />
      {countE > 0 && <span className={styles.vehicleCountDir} style={{ color: DIRECTION_CONFIG.E.color, top: '20%' }}>{countE}</span>}
      {countW > 0 && <span className={styles.vehicleCountDir} style={{ color: DIRECTION_CONFIG.W.color, top: '62%' }}>{countW}</span>}
    </div>
  );
}

function VRoad({ fromR, fromC, toR, toC, roadsData }) {
  const keyS = fromR < toR ? `${fromR},${fromC}->${toR},${toC}` : `${toR},${toC}->${fromR},${fromC}`;
  const keyN = fromR < toR ? `${toR},${toC}->${fromR},${fromC}` : `${fromR},${fromC}->${toR},${toC}`;
  const countN = roadsData[keyN] || 0;
  const countS = roadsData[keyS] || 0;

  return (
    <div className={styles.roadV}>
      <div className={styles.roadLineV} style={{ background: DIRECTION_CONFIG.N.color, left: '35%' }} />
      <div className={styles.roadLineV} style={{ background: DIRECTION_CONFIG.S.color, left: '55%' }} />
      {countN > 0 && <span className={styles.vehicleCountDir} style={{ color: DIRECTION_CONFIG.N.color, left: '8%' }}>{countN}</span>}
      {countS > 0 && <span className={styles.vehicleCountDir} style={{ color: DIRECTION_CONFIG.S.color, left: '72%' }}>{countS}</span>}
    </div>
  );
}

function EdgeRoadH({ approach, side }) {
  return (
    <div className={`${styles.edgeRoadH} ${styles[side]}`}>
      <div className={styles.edgeRoadLine} style={{ background: DIRECTION_CONFIG.E.color, top: '35%' }} />
      <div className={styles.edgeRoadLine} style={{ background: DIRECTION_CONFIG.W.color, top: '55%' }} />
    </div>
  );
}

function EdgeRoadV({ approach, side }) {
  return (
    <div className={`${styles.edgeRoadV} ${styles[side]}`}>
      <div className={styles.edgeRoadLineV} style={{ background: DIRECTION_CONFIG.N.color, left: '35%' }} />
      <div className={styles.edgeRoadLineV} style={{ background: DIRECTION_CONFIG.S.color, left: '55%' }} />
    </div>
  );
}

function NetworkGridView({ gridData, roadsData, gridSize, isGreedy, greedyDecisionData, currentTime, greedyDecisionInterval, onOpenReasoning, relativeDiffByKey, maxAbsDiff, importedGridLabels, importedCoordLabels, importedOriginGridKey }) {
  if (!gridData || !gridData.length) {
    return <div className={styles.noData}>No simulation data</div>;
  }

  const rows = [];

  // Top edge roads
  const topEdgeRow = [];
  for (let c = 0; c < gridSize; c++) {
    topEdgeRow.push(<EdgeRoadV key={`top-edge-${c}`} approach="N" side="top" />);
    if (c < gridSize - 1) topEdgeRow.push(<div key={`top-spacer-${c}`} className={styles.roadVSpacer} />);
  }
  rows.push(<div key="top-edge" className={styles.roadVRow}>{topEdgeRow}</div>);

  for (let r = 0; r < gridSize; r++) {
    const interRow = [];

    // Left edge road
    interRow.push(<EdgeRoadH key={`left-edge-${r}`} approach="W" side="left" />);

    for (let c = 0; c < gridSize; c++) {
      const pKey = `${r},${c}`;
      interRow.push(
        <IntersectionNode
          key={`inter-${r}-${c}`}
          data={gridData[r][c]}
          isGreedy={isGreedy}
          decisionData={isGreedy ? greedyDecisionData?.[pKey] : null}
          currentTime={currentTime}
          greedyDecisionInterval={greedyDecisionInterval}
          onOpenReasoning={onOpenReasoning}
          relativeDiff={relativeDiffByKey?.[pKey] ?? 0}
          maxAbsDiff={maxAbsDiff}
          coordLabel={importedCoordLabels?.[pKey] || null}
          gridSize={gridSize}
        />
      );
      if (c < gridSize - 1) {
        interRow.push(
          <HRoad
            key={`hroad-${r}-${c}`}
            fromR={r} fromC={c} toR={r} toC={c + 1}
            roadsData={roadsData}
            count={0}
          />
        );
      }
    }

    // Right edge road
    interRow.push(<EdgeRoadH key={`right-edge-${r}`} approach="E" side="right" />);

    rows.push(<div key={`row-${r}`} className={styles.gridRow}>{interRow}</div>);

    if (r < gridSize - 1) {
      const vRoadItems = [];
      for (let c = 0; c < gridSize; c++) {
        vRoadItems.push(
          <VRoad
            key={`vroad-${r}-${c}`}
            fromR={r} fromC={c} toR={r + 1} toC={c}
            roadsData={roadsData}
          />
        );
        if (c < gridSize - 1) {
          vRoadItems.push(<div key={`spacer-${r}-${c}`} className={styles.roadVSpacer} />);
        }
      }
      rows.push(<div key={`vrow-${r}`} className={styles.roadVRow}>{vRoadItems}</div>);
    }
  }

  // Bottom edge roads
  const bottomEdgeRow = [];
  for (let c = 0; c < gridSize; c++) {
    bottomEdgeRow.push(<EdgeRoadV key={`bottom-edge-${c}`} approach="S" side="bottom" />);
    if (c < gridSize - 1) bottomEdgeRow.push(<div key={`bottom-spacer-${c}`} className={styles.roadVSpacer} />);
  }
  rows.push(<div key="bottom-edge" className={styles.roadVRow}>{bottomEdgeRow}</div>);

  return (
    <div className={styles.networkScrollWrapper}>
      <div className={styles.compassFrame}>
        <div className={styles.compassBannerTop}>
          <span style={{ color: DIRECTION_CONFIG.N.color }}>North</span>
        </div>
        <div className={styles.compassMiddleRow}>
          <div className={styles.compassBannerLeft}>
            <span style={{ color: DIRECTION_CONFIG.W.color }}>West</span>
          </div>
          <div className={styles.networkGrid}>{rows}</div>
          <div className={styles.compassBannerRight}>
            <span style={{ color: DIRECTION_CONFIG.E.color }}>East</span>
          </div>
        </div>
        <div className={styles.compassBannerBottom}>
          <span style={{ color: DIRECTION_CONFIG.S.color }}>South</span>
        </div>
      </div>
    </div>
  );
}

function PolicySummary({ data }) {
  if (!data) return null;

  return (
    <div className={styles.summaryRow}>
      <div className={styles.summaryItem}>
        <span className={styles.summaryLabel}>Throughput</span>
        <span className={`${styles.summaryValue} ${styles.good}`}>{data.throughput}</span>
      </div>
      <div className={styles.summaryItem}>
        <span className={styles.summaryLabel}>Entered</span>
        <span className={styles.summaryValue}>{data.totalVehiclesEntered}</span>
      </div>
    </div>
  );
}

export default function GridVisualization() {
  const snapshot = useSimStore((s) => s.snapshot);
  const config = useSimStore((s) => s.config);
  const scenarioMode = useSimStore((s) => s.scenarioMode);
  const isRunning = useSimStore((s) => s.isRunning);
  const importedGridLabels = useSimStore((s) => s.importedScenarioMeta?.gridLabels || null);
  const importedCoordLabels = useSimStore((s) => s.importedScenarioMeta?.coordLabels || null);
  const importedOriginGridKey = useSimStore((s) => s.importedScenarioMeta?.originGridKey || null);
  const [reasoningModal, setReasoningModal] = useState(null);

  const gridSize = snapshot?.gridSize || Math.floor(config.gridSize) || 3;

  // Auto-switch to stacked when grid is 5x5 or larger, unless user explicitly toggles
  const [layoutMode, setLayoutMode] = useState(gridSize >= 5 ? 'stacked' : 'sideBySide');

  useEffect(() => {
    if (gridSize >= 5) {
      setLayoutMode('stacked');
    }
  }, [gridSize]);

  const handleOpenReasoning = (row, col) => {
    setReasoningModal({ row, col });
  };

  const handleCloseReasoning = () => {
    setReasoningModal(null);
  };

  const { relativeDiffByKey, maxAbsDiff } = useMemo(() => {
    if (!snapshot) {
      return { relativeDiffByKey: {}, maxAbsDiff: 0 };
    }

    const diffMap = {};
    let maxAbs = 0;
    const n = gridSize;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const key = `${r},${c}`;
        const f = snapshot.fixed.grid[r][c]?.totalQueued ?? 0;
        const g = snapshot.greedy.grid[r][c]?.totalQueued ?? 0;
        const d = g - f;
        diffMap[key] = d;
        maxAbs = Math.max(maxAbs, Math.abs(d));
      }
    }
    return { relativeDiffByKey: diffMap, maxAbsDiff: maxAbs };
  }, [snapshot, gridSize]);

  if (!snapshot) {
    return (
      <div className={styles.gridVisualization}>
        <h2>Traffic Network</h2>
        <div className={styles.noData}>
          Configure parameters above and click Start to begin simulation
        </div>
      </div>
    );
  }

  const modalDecisionData = reasoningModal
    ? snapshot.greedyDecisionData?.[`${reasoningModal.row},${reasoningModal.col}`]
    : null;

  // Dynamic size tier
  const sizeTierClass = gridSize <= 3 ? styles.sizeNormal : gridSize <= 5 ? styles.sizeMedium : styles.sizeCompact;

  return (
    <div className={styles.gridVisualization}>
      <div className={styles.headerRow}>
        <div className={styles.titleWithToggle}>
          <h2>Traffic Network</h2>
          <div className={styles.layoutToggleGroup}>
            <button
              className={`${styles.layoutBtn} ${layoutMode === 'sideBySide' ? styles.layoutBtnActive : ''}`}
              onClick={() => setLayoutMode('sideBySide')}
              title="Show Fixed and Greedy controllers side-by-side"
            >
              Side-by-Side
            </button>
            <button
              className={`${styles.layoutBtn} ${layoutMode === 'stacked' ? styles.layoutBtnActive : ''}`}
              onClick={() => setLayoutMode('stacked')}
              title="Stack Fixed and Greedy controllers vertically (Recommended for large 5x5 to 8x8 grids)"
            >
              Stacked View
            </button>
          </div>
        </div>

        <div className={styles.clock}>
          <span className={styles.clockLabel}>Step</span>
          <span className={styles.clockValue}>{snapshot.time}</span>
          <span className={styles.clockSep}>/</span>
          <span className={styles.clockTotal}>{config.simDuration}</span>
          {snapshot.isComplete && <span className={styles.clockDone}>Complete</span>}
        </div>
      </div>

      {/* Compass Guide & Legend */}
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <div className={styles.legendDot} style={{ background: '#14532d' }} /> Lower queue at same node
        </div>
        <div className={styles.legendItem}>
          <div className={styles.legendDot} style={{ background: '#2a3550' }} /> Equal queues
        </div>
        <div className={styles.legendItem}>
          <div className={styles.legendDot} style={{ background: '#7f1d1d' }} /> Higher queue at same node
        </div>
        <div className={styles.legendSep} />
        
        {/* Full Cardinal Direction Labels */}
        <div className={styles.legendItem}>
          <span className={styles.compassTag} style={{ color: DIRECTION_CONFIG.N.color, borderColor: DIRECTION_CONFIG.N.color }}>North</span> Northbound
        </div>
        <div className={styles.legendItem}>
          <span className={styles.compassTag} style={{ color: DIRECTION_CONFIG.S.color, borderColor: DIRECTION_CONFIG.S.color }}>South</span> Southbound
        </div>
        <div className={styles.legendItem}>
          <span className={styles.compassTag} style={{ color: DIRECTION_CONFIG.E.color, borderColor: DIRECTION_CONFIG.E.color }}>East</span> Eastbound
        </div>
        <div className={styles.legendItem}>
          <span className={styles.compassTag} style={{ color: DIRECTION_CONFIG.W.color, borderColor: DIRECTION_CONFIG.W.color }}>West</span> Westbound
        </div>
      </div>

      <div className={`${styles.comparison} ${layoutMode === 'stacked' ? styles.comparisonStacked : ''} ${sizeTierClass}`}>
        <div className={styles.policySection}>
          <div className={`${styles.policyTitle} ${styles.fixed}`}>Fixed Cycle Schedule</div>
          <NetworkGridView
            gridData={snapshot.fixed.grid}
            roadsData={snapshot.fixed.roads}
            gridSize={gridSize}
            isGreedy={false}
            greedyDecisionData={null}
            currentTime={snapshot.time}
            greedyDecisionInterval={config.greedyDecisionInterval}
            onOpenReasoning={() => {}}
            relativeDiffByKey={relativeDiffByKey}
            maxAbsDiff={maxAbsDiff}
            importedGridLabels={scenarioMode === 'imported' ? importedGridLabels : null}
          />
          <PolicySummary data={snapshot.fixed} />
        </div>
        <div className={styles.policySection}>
          <div className={`${styles.policyTitle} ${styles.greedy}`}>Greedy Adaptive Controller</div>
          <NetworkGridView
            gridData={snapshot.greedy.grid}
            roadsData={snapshot.greedy.roads}
            gridSize={gridSize}
            isGreedy={true}
            greedyDecisionData={snapshot.greedyDecisionData}
            currentTime={snapshot.time}
            greedyDecisionInterval={config.greedyDecisionInterval}
            onOpenReasoning={handleOpenReasoning}
            relativeDiffByKey={relativeDiffByKey}
            maxAbsDiff={maxAbsDiff}
            importedGridLabels={scenarioMode === 'imported' ? importedGridLabels : null}
            importedCoordLabels={scenarioMode === 'imported' ? importedCoordLabels : null}
            importedOriginGridKey={scenarioMode === 'imported' ? importedOriginGridKey : null}
          />
          <PolicySummary data={snapshot.greedy} />
        </div>
      </div>

      {reasoningModal && modalDecisionData && (
        <AlgorithmReasoningModal
          data={modalDecisionData}
          onClose={handleCloseReasoning}
          currentTime={snapshot.time}
          greedyDecisionInterval={config.greedyDecisionInterval}
        />
      )}
    </div>
  );
}
