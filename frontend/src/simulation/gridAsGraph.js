// =====================================================
// GRID → GRAPH
// Expresses a grid-simulator configuration as a graph network for
// GraphSimulationEngine, element-for-element in the same order the
// grid engine uses, so both engines produce identical results.
// =====================================================

import { DIRECTIONS, EXIT_TO_NEIGHBOR_DELTA, ARRIVAL_APPROACH, FIXED_CYCLE, PHASE_NAMES } from './constants.js';

export function gridAsGraph(config) {
  const n = Math.floor(config.gridSize || 3);
  const defaultSpeed = config.defaultRoadSpeed || 2;
  const defaultLength = config.defaultRoadLength || 12;
  const defaultTurn = {
    T: config.defaultTurnProbT ?? 0.7,
    R: config.defaultTurnProbR ?? 0.15,
    L: config.defaultTurnProbL ?? 0.15,
  };
  const inside = (r, c) => r >= 0 && r < n && c >= 0 && c < n;
  const id = (r, c) => `${r},${c}`;

  const edges = [];
  const arms = new Map();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const base = config.baseDepartureRate ?? 8;
      const rates = config.departureRates?.[r]?.[c] ?? { N: base, S: base, E: base, W: base };
      arms.set(id(r, c), Object.fromEntries(DIRECTIONS.map((d) => [d, { inEdgeIds: [], outEdgeIds: [], departureRate: Math.floor(rates[d] ?? base) }])));
    }
  }

  // Internal roads, in the grid engine's transit order.
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      for (const dir of DIRECTIONS) {
        const [dr, dc] = EXIT_TO_NEIGHBOR_DELTA[dir];
        const nr = r + dr;
        const nc = c + dc;
        if (!inside(nr, nc)) continue;
        const key = `${r},${c}->${nr},${nc}`;
        const o = config.roadOverrides?.[key];
        const toArm = ARRIVAL_APPROACH[dir];
        edges.push({
          id: key,
          from: id(r, c),
          to: id(nr, nc),
          fromArm: dir,
          toArm,
          kind: 'internal',
          travelSteps: Math.max(1, Math.round((o?.length ?? defaultLength) / (o?.speed ?? defaultSpeed))),
          turnProbs: { T: o?.turnT ?? defaultTurn.T, R: o?.turnR ?? defaultTurn.R, L: o?.turnL ?? defaultTurn.L },
        });
        arms.get(id(r, c))[dir].outEdgeIds.push(key);
        arms.get(id(nr, nc))[toArm].inEdgeIds.push(key);
      }
    }
  }

  // Boundary entries (feed straight into the queue) and exits (leave at once).
  const entries = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const dirs = [];
      if (r === 0) dirs.push('N');
      if (r === n - 1) dirs.push('S');
      if (c === 0) dirs.push('W');
      if (c === n - 1) dirs.push('E');
      for (const d of dirs) {
        const bndKey = `bnd_${d}_${r},${c}`;
        const o = config.boundaryRoadOverrides?.[bndKey];
        edges.push({
          id: bndKey,
          from: `gate_${d}_${r},${c}`,
          to: id(r, c),
          toArm: d,
          kind: 'feeder',
          travelSteps: 0,
          turnProbs: { T: o?.turnT ?? defaultTurn.T, R: o?.turnR ?? defaultTurn.R, L: o?.turnL ?? defaultTurn.L },
        });
        arms.get(id(r, c))[d].inEdgeIds.push(bndKey);
        entries.push({ key: `${r},${c},${d}`, edgeId: bndKey, profile: config.boundaryInflowProfiles?.[r]?.[c]?.[d] || null });

        const exitId = `exit_${d}_${r},${c}`;
        edges.push({ id: exitId, from: id(r, c), to: `gate_${d}_${r},${c}`, fromArm: d, kind: 'exit', travelSteps: 0 });
        arms.get(id(r, c))[d].outEdgeIds.push(exitId);
      }
    }
  }

  const intersections = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      intersections.push({ id: id(r, c), arms: arms.get(id(r, c)), phases: PHASE_NAMES, fixedCycle: FIXED_CYCLE });
    }
  }
  return { intersections, edges, entries };
}
