// =====================================================
// ZUSTAND STORE
// Central state management for the simulation app
// =====================================================

import { create } from 'zustand';
import { SimulationEngine } from '../simulation/engine.js';
import { makeConstantInflowProfile } from '../simulation/arrivalProfile.js';

const DEFAULT_CONFIG = {
  gridSize: 3,
  simDuration: 200,
  defaultRoadSpeed: 2,
  defaultRoadLength: 12,
  defaultTurnProbT: 0.7,
  defaultTurnProbR: 0.15,
  defaultTurnProbL: 0.15,
  fixedCycleInterval: 5,
  greedyDecisionInterval: 5,
  lookaheadH: 5,
  alpha: 1.0,
  beta: 1.0,
  gamma: 1.0,
  totalWaitWeight: 1.0,
  totalWaitStdWeight: 1.0,
  queueWeight: 1.0,
  queueStdWeight: 1.0,
  baseDepartureRate: 8,
  inflowGlobalCap: 60,
  defaultBoundaryInflowProfiles: {
    N: makeConstantInflowProfile(4),
    S: makeConstantInflowProfile(0),
    E: makeConstantInflowProfile(0),
    W: makeConstantInflowProfile(0),
  },
  debug: {
    enabled: false,
    sampleInterval: 5,
  },
  seed: 2,
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildEngineFromStoreState(state) {
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

  const engine = new SimulationEngine({
    ...config,
    boundaryInflowProfiles,
    departureRates,
    roadOverrides: Object.keys(roadOverrides).length > 0 ? roadOverrides : null,
    boundaryRoadOverrides: Object.keys(boundaryRoadOverrides).length > 0 ? boundaryRoadOverrides : null,
  });
  engine.init();
  return engine;
}

export const useSimStore = create((set, get) => ({
  // Config
  config: { ...DEFAULT_CONFIG },

  // Scenario mode
  scenarioMode: 'manual',
  manualScenarioSnapshot: null,
  importedScenarioMeta: null,
  mapPreview: null,
  apiLogs: [],
  isApplyingImportedScenario: false,

  // Per-intersection boundary inflow overrides: { "r,c": { N: profile, S: profile, ... } }
  boundaryInflowOverrides: {},

  // Per-intersection departure rate overrides (4 dirs): { "r,c": { N, S, E, W } }
  departureRateOverrides: {},

  // Per-road property overrides: { "r1,c1->r2,c2": { speed, length, turnT, turnR, turnL } }
  roadOverrides: {},

  // Boundary road turn prob overrides: { "bnd_D_r,c": { turnT, turnR, turnL } }
  boundaryRoadOverrides: {},

  // Simulation state
  engine: null,
  snapshot: null,
  isRunning: false,
  isPaused: false,
  speed: 5,
  intervalId: null,
  nextDueAt: null,

  // ===== Config Actions =====
  updateConfig: (partial) => set((state) => ({
    config: { ...state.config, ...partial },
  })),

  setBoundaryInflowOverride: (row, col, dir, value) => set((state) => {
    const key = `${row},${col}`;
    const existing = state.boundaryInflowOverrides[key] || {};
    return {
      boundaryInflowOverrides: {
        ...state.boundaryInflowOverrides,
        [key]: { ...existing, [dir]: value },
      },
    };
  }),

  setDepartureRateOverride: (row, col, dir, value) => set((state) => {
    const key = `${row},${col}`;
    const base = state.config.baseDepartureRate;
    const existing = state.departureRateOverrides[key] || { N: base, S: base, E: base, W: base };
    return {
      departureRateOverrides: {
        ...state.departureRateOverrides,
        [key]: { ...existing, [dir]: value },
      },
    };
  }),

  setRoadOverride: (roadKey, prop, value) => set((state) => {
    const existing = state.roadOverrides[roadKey] || {};
    return {
      roadOverrides: {
        ...state.roadOverrides,
        [roadKey]: { ...existing, [prop]: value },
      },
    };
  }),

  setBoundaryRoadOverride: (bndKey, prop, value) => set((state) => {
    const existing = state.boundaryRoadOverrides[bndKey] || {};
    return {
      boundaryRoadOverrides: {
        ...state.boundaryRoadOverrides,
        [bndKey]: { ...existing, [prop]: value },
      },
    };
  }),

  setSpeed: (speed) => {
    set({ speed });
    const { isRunning } = get();
    if (isRunning) {
      get().startSimulation();
    }
  },

  appendApiLog: (entry) => set((state) => ({
    apiLogs: [
      ...state.apiLogs,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: new Date().toISOString(),
        ...entry,
      },
    ],
  })),

  clearApiLogs: () => set({ apiLogs: [] }),

  setMapPreview: (preview) => set({ mapPreview: preview }),

  applyImportedScenario: ({ configPatch, roadOverrides, boundaryRoadOverrides, departureRateOverrides, boundaryInflowOverrides, meta }) => {
    const state = get();
    const manualSnapshot = state.scenarioMode === 'manual'
      ? {
          config: deepClone(state.config),
          boundaryInflowOverrides: deepClone(state.boundaryInflowOverrides),
          departureRateOverrides: deepClone(state.departureRateOverrides),
          roadOverrides: deepClone(state.roadOverrides),
          boundaryRoadOverrides: deepClone(state.boundaryRoadOverrides),
        }
      : state.manualScenarioSnapshot;

    set({
      scenarioMode: 'imported',
      manualScenarioSnapshot: manualSnapshot,
      importedScenarioMeta: meta || null,
      config: {
        ...state.config,
        ...(configPatch || {}),
      },
      boundaryInflowOverrides: {},
      roadOverrides: {},
      boundaryRoadOverrides: {},
      departureRateOverrides: {},
      engine: null,
      snapshot: null,
      isRunning: false,
      isPaused: false,
      intervalId: null,
      nextDueAt: null,
      isApplyingImportedScenario: true,
    });

    const roadEntries = Object.entries(roadOverrides || {});
    const bndRoadEntries = Object.entries(boundaryRoadOverrides || {});
    const depEntries = Object.entries(departureRateOverrides || {});
    const inflowEntries = Object.entries(boundaryInflowOverrides || {});

    let rIdx = 0;
    let brIdx = 0;
    let dIdx = 0;
    let iIdx = 0;

    const ROAD_CHUNK = 600;
    const NODE_CHUNK = 220;

    const applyNextChunk = () => {
      const roadChunk = Object.fromEntries(roadEntries.slice(rIdx, rIdx + ROAD_CHUNK));
      const bndRoadChunk = Object.fromEntries(bndRoadEntries.slice(brIdx, brIdx + NODE_CHUNK));
      const depChunk = Object.fromEntries(depEntries.slice(dIdx, dIdx + NODE_CHUNK));
      const inflowChunk = Object.fromEntries(inflowEntries.slice(iIdx, iIdx + NODE_CHUNK));

      const hasMore =
        rIdx < roadEntries.length ||
        brIdx < bndRoadEntries.length ||
        dIdx < depEntries.length ||
        iIdx < inflowEntries.length;

      if (!hasMore) {
        set({ isApplyingImportedScenario: false });
        return;
      }

      set((s) => ({
        roadOverrides: Object.keys(roadChunk).length ? { ...s.roadOverrides, ...roadChunk } : s.roadOverrides,
        boundaryRoadOverrides: Object.keys(bndRoadChunk).length ? { ...s.boundaryRoadOverrides, ...bndRoadChunk } : s.boundaryRoadOverrides,
        departureRateOverrides: Object.keys(depChunk).length ? { ...s.departureRateOverrides, ...depChunk } : s.departureRateOverrides,
        boundaryInflowOverrides: Object.keys(inflowChunk).length ? { ...s.boundaryInflowOverrides, ...inflowChunk } : s.boundaryInflowOverrides,
      }));

      rIdx += ROAD_CHUNK;
      brIdx += NODE_CHUNK;
      dIdx += NODE_CHUNK;
      iIdx += NODE_CHUNK;

      setTimeout(applyNextChunk, 0);
    };

    setTimeout(applyNextChunk, 0);
  },

  restoreManualScenario: () => set((state) => {
    const snap = state.manualScenarioSnapshot;
    if (!snap) {
      return {
        scenarioMode: 'manual',
        importedScenarioMeta: null,
      };
    }

    return {
      scenarioMode: 'manual',
      importedScenarioMeta: null,
      config: deepClone(snap.config),
      boundaryInflowOverrides: deepClone(snap.boundaryInflowOverrides),
      departureRateOverrides: deepClone(snap.departureRateOverrides),
      roadOverrides: deepClone(snap.roadOverrides),
      boundaryRoadOverrides: deepClone(snap.boundaryRoadOverrides),
      engine: null,
      snapshot: null,
      isRunning: false,
      isPaused: false,
      intervalId: null,
      nextDueAt: null,
    };
  }),

  loadSavedConfiguration: (savedConfig) => {
    get().resetSimulation();
    const cfg = savedConfig.config ? { ...DEFAULT_CONFIG, ...savedConfig.config } : get().config;
    set({
      config: cfg,
      scenarioMode: savedConfig.scenarioMode || 'manual',
      importedScenarioMeta: savedConfig.importedScenarioMeta || null,
      boundaryInflowOverrides: savedConfig.boundaryInflowOverrides || {},
      departureRateOverrides: savedConfig.departureRateOverrides || {},
      roadOverrides: savedConfig.roadOverrides || {},
      boundaryRoadOverrides: savedConfig.boundaryRoadOverrides || {},
      engine: null,
      snapshot: null,
      isRunning: false,
      isPaused: false,
      intervalId: null,
      nextDueAt: null,
    });
    get().initSimulation();
  },

  // ===== Simulation Actions =====
  initSimulation: () => {
    const engine = buildEngineFromStoreState(get());

    set({
      engine,
      snapshot: engine.getSnapshot(),
      isRunning: false,
      isPaused: false,
    });
  },

  startSimulation: () => {
    const state = get();
    if (!state.engine) {
      get().initSimulation();
    }

    const existingInterval = get().intervalId;
    if (existingInterval) clearTimeout(existingInterval);

    const runLoop = () => {
      const loopState = get();
      const { engine, isRunning, speed } = loopState;
      if (!engine || !isRunning || engine.isComplete) {
        get().stopSimulation();
        return;
      }

      const stepMs = Math.max(1000 / Math.max(1, speed), 1);
      let now = performance.now();
      let nextDueAt = loopState.nextDueAt ?? now;

      // Keep grid and charts visually in sync by advancing at most one step per scheduler tick.
      // Multiple same-tick state updates can be batched by React and hide intermediate phase changes.
      if (now >= nextDueAt && !engine.isComplete) {
        const snapshot = engine.step();
        set({ snapshot });
        nextDueAt += stepMs;
      }

      if (engine.isComplete) {
        get().stopSimulation();
        return;
      }

      now = performance.now();
      if (nextDueAt < now) nextDueAt = now + stepMs;
      const delay = Math.max(0, Math.round(nextDueAt - now));
      const timeoutId = setTimeout(runLoop, delay);
      set({ intervalId: timeoutId, nextDueAt });
    };

    set({ isRunning: true, isPaused: false, nextDueAt: performance.now() });
    runLoop();
  },

  pauseSimulation: () => {
    const intervalId = get().intervalId;
    if (intervalId) clearTimeout(intervalId);
    set({ isRunning: false, isPaused: true, intervalId: null, nextDueAt: null });
  },

  resumeSimulation: () => {
    get().startSimulation();
  },

  stopSimulation: () => {
    const intervalId = get().intervalId;
    if (intervalId) clearTimeout(intervalId);
    set({ isRunning: false, isPaused: false, intervalId: null, nextDueAt: null });
  },

  resetSimulation: () => {
    const intervalId = get().intervalId;
    if (intervalId) clearTimeout(intervalId);
    set({
      engine: null,
      snapshot: null,
      isRunning: false,
      isPaused: false,
      intervalId: null,
      nextDueAt: null,
    });
  },

  stepOnce: () => {
    const { engine } = get();
    if (!engine) {
      get().initSimulation();
      const snapshot = get().engine.step();
      set({ snapshot });
      return;
    }
    if (engine.isComplete) return;
    const snapshot = engine.step();
    set({ snapshot });
  },

  stepBackOnce: () => {
    const { snapshot, isRunning } = get();
    if (!snapshot || snapshot.time <= 0) return;

    if (isRunning) {
      get().pauseSimulation();
    }

    const targetTime = Math.max(0, snapshot.time - 1);
    const rebuiltEngine = buildEngineFromStoreState(get());

    for (let i = 0; i < targetTime; i++) {
      if (rebuiltEngine.isComplete) break;
      rebuiltEngine.step();
    }

    set({
      engine: rebuiltEngine,
      snapshot: rebuiltEngine.getSnapshot(),
      isRunning: false,
      isPaused: true,
      intervalId: null,
      nextDueAt: null,
    });
  },
}));
