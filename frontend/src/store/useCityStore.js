// =====================================================
// CITY SIMULATOR STORE
// The imported city graph (and the user's edits to it), the settings /
// overrides / inflows (persisted in this browser), and the running
// engine. Run controls behave like the grid simulator's store.
// =====================================================
import { create } from 'zustand';
import { GraphSimulationEngine } from '../simulation/graphEngine.js';
import { emptyOverrides, engineConfig, normalizeCityConfig } from '../simulation/cityNetwork.js';
import { CITY_SCHEMA_VERSION, deriveCity } from '../network/cityModel.js';

const STORAGE_KEY = 'urbangrid-city-scenario-v2';
const HISTORY_LIMIT = 60;

// Only the editable model is stored; everything else is derived from it.
const baseOf = (city) => ({ area: city.area, downloadBox: city.downloadBox, extraction: city.extraction, model: city.model });

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (!saved?.base?.model || saved.schemaVersion !== CITY_SCHEMA_VERSION) return null;
    return { ...saved, city: deriveCity(saved.base) };
  } catch {
    return null;
  }
}

function persist(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: CITY_SCHEMA_VERSION,
      base: state.city ? baseOf(state.city) : null,
      original: state.original,
      meta: state.meta,
      config: state.config,
      overrides: state.overrides,
      inflows: state.inflows,
    }));
  } catch {
    // storage full or unavailable: the scenario still works in memory
  }
}

const saved = loadSaved();

function buildEngine(state) {
  const engine = new GraphSimulationEngine(engineConfig(state.city, state.config, state.overrides, state.inflows));
  engine.init();
  return engine;
}

const pick = (obj = {}, keep) => Object.fromEntries(Object.entries(obj).filter(([id]) => keep.has(id)));

// Settings that point at roads or intersections the edit removed are dropped.
function pruneSettings(city, overrides, inflows) {
  const linkIds = new Set(city.links.map((l) => l.id));
  const intersectionIds = new Set(city.intersections.map((i) => i.id));
  return {
    overrides: {
      links: pick(overrides.links, linkIds),
      turns: pick(overrides.turns, intersectionIds),
      departure: pick(overrides.departure, intersectionIds),
    },
    inflows: pick(inflows, linkIds),
  };
}

const withoutEmpty = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null));

export const useCityStore = create((set, get) => ({
  city: saved?.city || null,
  original: saved?.original || null, // the model as extracted, for "restore"
  meta: saved?.meta || null,
  config: normalizeCityConfig(saved?.config || {}),
  overrides: { ...emptyOverrides(), ...(saved?.overrides || {}) },
  inflows: saved?.inflows || {},
  history: [],
  future: [],

  engine: null,
  snapshot: null,
  isRunning: false,
  isPaused: false,
  speed: 12, // steps per second
  timerId: null,
  nextDueAt: null,

  loadCity: (city, meta) => {
    get().stopTimer();
    set({ city, original: city.model, meta, overrides: emptyOverrides(), inflows: {}, history: [], future: [], engine: null, snapshot: null, isRunning: false, isPaused: false });
    persist(get());
  },

  // Any change to the scenario invalidates a run in progress.
  updateScenario: (patch) => {
    get().stopTimer();
    set({ ...patch, engine: null, snapshot: null, isRunning: false, isPaused: false });
    persist(get());
  },
  setConfig: (patch) => get().updateScenario({ config: { ...get().config, ...patch } }),

  // ---- Editing the graph ----
  // `change` gets the model and returns a new model, or { model, id }.
  // Returns that id (of the node or road just made), if any.
  editModel: (change) => {
    const { city, history, overrides, inflows } = get();
    if (!city) return null;
    const result = change(city.model);
    const model = result?.model || result;
    if (!model || model === city.model) return result?.id ?? null;
    const next = deriveCity({ ...baseOf(city), model });
    get().updateScenario({ city: next, history: [...history, city.model].slice(-HISTORY_LIMIT), future: [], ...pruneSettings(next, overrides, inflows) });
    return result?.id ?? null;
  },
  undo: () => {
    const { city, history, future, overrides, inflows } = get();
    if (!history.length) return;
    const next = deriveCity({ ...baseOf(city), model: history[history.length - 1] });
    get().updateScenario({ city: next, history: history.slice(0, -1), future: [city.model, ...future], ...pruneSettings(next, overrides, inflows) });
  },
  redo: () => {
    const { city, history, future, overrides, inflows } = get();
    if (!future.length) return;
    const next = deriveCity({ ...baseOf(city), model: future[0] });
    get().updateScenario({ city: next, history: [...history, city.model], future: future.slice(1), ...pruneSettings(next, overrides, inflows) });
  },
  restoreOriginal: () => {
    const { original } = get();
    if (original) get().editModel(() => original);
  },

  // ---- Settings on top of the graph ----
  setLinkOverride: (linkId, patch) => {
    const links = { ...get().overrides.links };
    const next = withoutEmpty({ ...(links[linkId] || {}), ...patch });
    if (Object.keys(next).length) links[linkId] = next;
    else delete links[linkId];
    get().updateScenario({ overrides: { ...get().overrides, links } });
  },
  setTurnOverride: (intersectionId, arm, probs) => {
    const turns = { ...get().overrides.turns };
    const node = withoutEmpty({ ...(turns[intersectionId] || {}), [arm]: probs });
    if (Object.keys(node).length) turns[intersectionId] = node;
    else delete turns[intersectionId];
    get().updateScenario({ overrides: { ...get().overrides, turns } });
  },
  setDepartureOverride: (intersectionId, dir, value) => {
    const departure = { ...get().overrides.departure };
    const node = withoutEmpty({ ...(departure[intersectionId] || {}), [dir]: value });
    if (Object.keys(node).length) departure[intersectionId] = node;
    else delete departure[intersectionId];
    get().updateScenario({ overrides: { ...get().overrides, departure } });
  },
  clearOverrides: () => get().updateScenario({ overrides: emptyOverrides() }),
  setInflow: (linkId, profile) => {
    const inflows = { ...get().inflows };
    if (profile) inflows[linkId] = profile;
    else delete inflows[linkId];
    get().updateScenario({ inflows });
  },
  setAllInflows: (inflows) => get().updateScenario({ inflows }),

  // ---- Run controls (same behaviour as the grid simulator) ----
  setSpeed: (speed) => set({ speed }),
  stopTimer: () => {
    const { timerId } = get();
    if (timerId) clearTimeout(timerId);
    set({ timerId: null, nextDueAt: null });
  },
  ensureEngine: () => {
    let { engine } = get();
    if (!engine) {
      engine = buildEngine(get());
      set({ engine, snapshot: engine.getSnapshot() });
    }
    return engine;
  },
  start: () => {
    const engine = get().ensureEngine();
    if (engine.isComplete) return;
    get().stopTimer();
    const loop = () => {
      const { engine: eng, isRunning, speed } = get();
      if (!eng || !isRunning || eng.isComplete) {
        get().stopTimer();
        set({ isRunning: false, isPaused: false });
        return;
      }
      const stepMs = Math.max(1000 / Math.max(1, speed), 1);
      let now = performance.now();
      let due = get().nextDueAt ?? now;
      if (now >= due) {
        set({ snapshot: eng.step() });
        due += stepMs;
      }
      if (eng.isComplete) {
        get().stopTimer();
        set({ isRunning: false, isPaused: false });
        return;
      }
      now = performance.now();
      if (due < now) due = now + stepMs;
      set({ timerId: setTimeout(loop, Math.max(0, Math.round(due - now))), nextDueAt: due });
    };
    set({ isRunning: true, isPaused: false, nextDueAt: performance.now() });
    loop();
  },
  pause: () => {
    get().stopTimer();
    set({ isRunning: false, isPaused: true });
  },
  resume: () => get().start(),
  reset: () => {
    get().stopTimer();
    set({ engine: null, snapshot: null, isRunning: false, isPaused: false });
  },
  stepOnce: () => {
    const engine = get().ensureEngine();
    if (engine.isComplete) return;
    set({ snapshot: engine.step(), isPaused: true });
  },
  stepBackOnce: () => {
    const { snapshot } = get();
    if (!snapshot || snapshot.time <= 0) return;
    get().stopTimer();
    const engine = buildEngine(get());
    for (let i = 0; i < snapshot.time - 1 && !engine.isComplete; i++) engine.step();
    set({ engine, snapshot: engine.getSnapshot(), isRunning: false, isPaused: true });
  },
  runToEnd: () => {
    get().stopTimer();
    const engine = get().ensureEngine();
    engine.run();
    set({ snapshot: engine.getSnapshot(), isRunning: false, isPaused: true });
  },
}));
