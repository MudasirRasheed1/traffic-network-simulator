// =====================================================
// CITY SIMULATOR STORE
// The imported city graph, the user's settings / overrides /
// inflows (persisted in this browser), and the running engine.
// =====================================================
import { create } from 'zustand';
import { GraphSimulationEngine } from '../simulation/graphEngine.js';
import { DEFAULT_CITY_SIM_CONFIG, engineConfig } from '../simulation/cityNetwork.js';

const STORAGE_KEY = 'urbangrid-city-scenario-v1';

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      city: state.city,
      meta: state.meta,
      config: state.config,
      overrides: state.overrides,
      inflows: state.inflows,
    }));
  } catch {
    // storage full or unavailable — the scenario still works in memory
  }
}

const saved = loadSaved();

export const useCityStore = create((set, get) => ({
  city: saved?.city || null,
  meta: saved?.meta || null,
  config: { ...DEFAULT_CITY_SIM_CONFIG, ...(saved?.config || {}) },
  overrides: saved?.overrides || { edges: {} },
  inflows: saved?.inflows || {},

  engine: null,
  snapshot: null,
  isRunning: false,
  stepsPerTick: 2,

  loadCity: (city, meta) => {
    set({ city, meta, overrides: { edges: {} }, inflows: {}, engine: null, snapshot: null, isRunning: false });
    persist(get());
  },

  // Any change to the scenario invalidates a run in progress.
  updateScenario: (patch) => {
    set({ ...patch, engine: null, snapshot: null, isRunning: false });
    persist(get());
  },
  setConfig: (patch) => get().updateScenario({ config: { ...get().config, ...patch } }),
  setEdgeOverride: (edgeId, patch) => {
    const edges = { ...get().overrides.edges };
    const next = { ...(edges[edgeId] || {}), ...patch };
    for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
    if (Object.keys(next).length) edges[edgeId] = next;
    else delete edges[edgeId];
    get().updateScenario({ overrides: { ...get().overrides, edges } });
  },
  setInflow: (edgeId, profile) => {
    const inflows = { ...get().inflows };
    if (profile) inflows[edgeId] = profile;
    else delete inflows[edgeId];
    get().updateScenario({ inflows });
  },
  setAllInflows: (inflows) => get().updateScenario({ inflows }),

  ensureEngine: () => {
    const { engine, city, config, overrides, inflows } = get();
    if (engine) return engine;
    const fresh = new GraphSimulationEngine(engineConfig(city, config, overrides, inflows));
    fresh.init();
    set({ engine: fresh, snapshot: fresh.getSnapshot() });
    return fresh;
  },
  start: () => {
    const engine = get().ensureEngine();
    if (engine.isComplete) return;
    set({ isRunning: true });
  },
  pause: () => set({ isRunning: false }),
  reset: () => set({ engine: null, snapshot: null, isRunning: false }),
  setStepsPerTick: (n) => set({ stepsPerTick: n }),
  // Advance `steps` steps (or to the end); used by the run loop and "Step".
  advance: (steps) => {
    const engine = get().ensureEngine();
    let snap = null;
    for (let k = 0; k < steps && !engine.isComplete; k++) snap = engine.step();
    set({ snapshot: snap || engine.getSnapshot(), isRunning: get().isRunning && !engine.isComplete });
  },
  runToEnd: () => {
    const engine = get().ensureEngine();
    engine.run();
    set({ snapshot: engine.getSnapshot(), isRunning: false });
  },
}));
