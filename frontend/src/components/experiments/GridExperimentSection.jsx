// Extract Details for the grid simulator: the experiment panel fed with
// the grid's current settings.
import { useMemo } from 'react';
import { useSimStore } from '../../store/useSimStore.js';
import ExperimentPanel from './ExperimentPanel.jsx';
import { isDataProfile } from '../../simulation/dataInflow.js';

const SIDE_NAMES = { N: 'north', S: 'south', E: 'east', W: 'west' };

// Sides that currently send traffic in, and their usual rate.
function activeSidesOf(config) {
  const profiles = config.defaultBoundaryInflowProfiles || {};
  const active = ['N', 'S', 'E', 'W'].filter((d) => {
    const p = profiles[d];
    if (!p) return false;
    return p.mode !== 'constant' || Number(p.constantValue) > 0;
  });
  const sides = active.length ? active : ['N', 'S', 'E', 'W'];
  const rates = sides.map((d) => profiles[d]).filter((p) => p?.mode === 'constant').map((p) => Number(p.constantValue) || 0);
  return { sides, baseRate: Math.max(1, ...rates) };
}

export default function GridExperimentSection() {
  const config = useSimStore((s) => s.config);
  const boundaryInflowOverrides = useSimStore((s) => s.boundaryInflowOverrides);
  const departureRateOverrides = useSimStore((s) => s.departureRateOverrides);
  const roadOverrides = useSimStore((s) => s.roadOverrides);
  const boundaryRoadOverrides = useSimStore((s) => s.boundaryRoadOverrides);
  const { sides, baseRate } = useMemo(() => activeSidesOf(config), [config]);
  const names = useMemo(() => Object.fromEntries(Array.from({ length: config.gridSize * config.gridSize }, (_, k) => {
    const r = Math.floor(k / config.gridSize);
    const c = k % config.gridSize;
    return [`${r},${c}`, `row ${r}, column ${c}`];
  })), [config.gridSize]);
  // Entry points fed from a data file (whole sides and single entries).
  const dataSources = useMemo(() => [
    ...['N', 'S', 'E', 'W'].filter((d) => isDataProfile(config.defaultBoundaryInflowProfiles?.[d])).map((d) => ({ label: `${SIDE_NAMES[d]} side`, profile: config.defaultBoundaryInflowProfiles[d] })),
    ...Object.entries(boundaryInflowOverrides || {}).flatMap(([cell, byDir]) => Object.entries(byDir || {}).filter(([, p]) => isDataProfile(p)).map(([d, p]) => ({ label: `(${cell}) ${d}`, profile: p }))),
  ], [config.defaultBoundaryInflowProfiles, boundaryInflowOverrides]);
  const label = `${config.gridSize} × ${config.gridSize} grid, traffic entering from the ${sides.map((d) => SIDE_NAMES[d]).join(', ')}`;

  return (
    <div style={{ padding: '0 24px 40px' }}>
      <ExperimentPanel
        kind="grid"
        title="Fixed cycle vs Greedy: grid experiment report"
        networkLabel={label}
        intersectionNames={names}
        dataSources={dataSources}
        makeBase={() => ({ state: { config, boundaryInflowOverrides, departureRateOverrides, roadOverrides, boundaryRoadOverrides }, activeSides: sides })}
        defaults={{ duration: config.simDuration, baseRate, baseSeed: config.seed }}
        rateHint={`Cars per step at each entry point on the ${sides.map((d) => SIDE_NAMES[d]).join(', ')} side (Normal level).`}
        setupRows={[
          ['Grid size', `${config.gridSize} × ${config.gridSize} intersections`],
          ['Road length / speed', `${config.defaultRoadLength} units / ${config.defaultRoadSpeed} units per step`],
          ['Fixed-cycle phase-change interval', `${config.fixedCycleInterval} steps`],
          ['Greedy decision interval / lookahead', `${config.greedyDecisionInterval} / ${config.lookaheadH} steps`],
          ['Greedy weights w1 to w4', [config.totalWaitWeight, config.totalWaitStdWeight, config.queueWeight, config.queueStdWeight].join(', ')],
          ['Vehicles served per green step', `${config.baseDepartureRate}`],
          ['Driving side', config.drivingSide === 'right' ? 'Right-hand' : 'Left-hand'],
        ]}
      />
    </div>
  );
}
