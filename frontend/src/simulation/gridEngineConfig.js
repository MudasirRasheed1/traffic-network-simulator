// =====================================================
// GRID SETTINGS → ENGINE CONFIG
// What the grid simulator's store turns into a SimulationEngine config.
// Shared by the store and by the experiment runner, so experiments build
// exactly the engine the grid simulator would.
// =====================================================
import { makeConstantInflowProfile } from './arrivalProfile.js';
import { alignDataEntries, dataTimeline } from './dataInflow.js';

export const gridTimelineSettings = (config) => ({ stepSeconds: config.dataStepSeconds ?? 5, start: config.dataStart, spread: config.dataSpread });

// The shared clock of the grid's data-file sources (sides and single entries).
export function gridDataTimeline(state) {
  const { config, boundaryInflowOverrides = {} } = state;
  const entries = [
    ...['N', 'S', 'E', 'W'].map((d) => ({ label: `${d} side`, profile: config.defaultBoundaryInflowProfiles?.[d] })),
    ...Object.entries(boundaryInflowOverrides).flatMap(([cell, byDir]) => Object.entries(byDir || {}).map(([d, profile]) => ({ label: `(${cell}) ${d}`, profile }))),
  ];
  return dataTimeline(entries, gridTimelineSettings(config));
}

/**
 * @param state { config, boundaryInflowOverrides, departureRateOverrides,
 *                roadOverrides, boundaryRoadOverrides }
 */
export function gridEngineConfig(state) {
  const { config, boundaryInflowOverrides, departureRateOverrides, roadOverrides, boundaryRoadOverrides } = state;
  const gridSize = config.gridSize;

  // Build boundary inflow profile array with intersection override priority.
  const boundaryInflowProfiles = [];
  for (let r = 0; r < gridSize; r++) {
    boundaryInflowProfiles.push([]);
    for (let c = 0; c < gridSize; c++) {
      const key = `${r},${c}`;
      const overrides = boundaryInflowOverrides[key] || {};
      const isBoundary = r === 0 || r === gridSize - 1 || c === 0 || c === gridSize - 1;
      const profileByDir = { N: makeConstantInflowProfile(0), S: makeConstantInflowProfile(0), E: makeConstantInflowProfile(0), W: makeConstantInflowProfile(0) };

      if (isBoundary) {
        if (r === 0) profileByDir.N = overrides.N || config.defaultBoundaryInflowProfiles.N;
        if (r === gridSize - 1) profileByDir.S = overrides.S || config.defaultBoundaryInflowProfiles.S;
        if (c === 0) profileByDir.W = overrides.W || config.defaultBoundaryInflowProfiles.W;
        if (c === gridSize - 1) profileByDir.E = overrides.E || config.defaultBoundaryInflowProfiles.E;
      }

      boundaryInflowProfiles[r].push(profileByDir);
    }
  }

  // Data-file entry points on one clock.
  const cells = [];
  boundaryInflowProfiles.forEach((row, r) => row.forEach((byDir, c) => {
    for (const d of Object.keys(byDir)) cells.push({ label: `(${r},${c}) ${d}`, r, c, d, profile: byDir[d] });
  }));
  const { entries, timeline } = alignDataEntries(cells, gridTimelineSettings(config));
  for (const e of entries) boundaryInflowProfiles[e.r][e.c][e.d] = e.profile;

  // Build departure rates array (per direction per intersection).
  const departureRates = [];
  for (let r = 0; r < gridSize; r++) {
    departureRates.push([]);
    for (let c = 0; c < gridSize; c++) {
      const key = `${r},${c}`;
      const base = config.baseDepartureRate;
      departureRates[r].push(
        departureRateOverrides[key] ?? { N: base, S: base, E: base, W: base }
      );
    }
  }

  return {
    ...config,
    dataError: timeline.error,
    boundaryInflowProfiles,
    departureRates,
    roadOverrides: Object.keys(roadOverrides).length > 0 ? roadOverrides : null,
    boundaryRoadOverrides: Object.keys(boundaryRoadOverrides).length > 0 ? boundaryRoadOverrides : null,
  };
}
