// =====================================================
// CITY GRAPH → ENGINE NETWORK
// Applies the user's settings and overrides to the map-derived
// city graph and converts real-world units into simulation steps.
// Setting names follow the grid simulator's where they mean the
// same thing (simDuration, defaultTurnProbT/R/L, inflowGlobalCap…).
// =====================================================

import { FIXED_CYCLE, PHASE_NAMES } from './constants.js';
import { MODEL_CONSTANTS } from '../network/roadDefaults.js';
import { bearingDeg } from '../network/geo.js';
import { makeConstantInflowProfile } from './arrivalProfile.js';
import { alignDataEntries, dataTimeline } from './dataInflow.js';

export const SIDES = ['N', 'S', 'E', 'W'];

export function makeRateProfile(vehPerHour) {
  return { mode: 'rate', vehPerHour: Math.max(0, Math.round(vehPerHour)) };
}

export const DEFAULT_CITY_SIM_CONFIG = {
  // Network dimensions & seed
  simDuration: 720, // steps
  // Internal only: converts real road length ÷ speed into travel steps.
  stepSeconds: 5,
  seed: 2,
  // Turning ratios at every intersection (unless overridden per arm)
  defaultTurnProbT: 0.7,
  defaultTurnProbR: 0.15,
  defaultTurnProbL: 0.15,
  // Vehicles served per green step, per lane of the approach road
  // (the grid's "vehicles served per green step", scaled by real lanes).
  departurePerLane: 2,
  // Algorithm
  fixedCycleInterval: 6,
  greedyDecisionInterval: 6,
  lookaheadH: 6,
  totalWaitWeight: 1.0,
  totalWaitStdWeight: 1.0,
  queueWeight: 1.0,
  queueStdWeight: 1.0,
  // Inflows
  inflowGlobalCap: 60,
  // Default inflow (cars/step) for sources, by the side of the area they lie on.
  defaultBoundaryInflowProfiles: {
    N: makeConstantInflowProfile(1),
    S: makeConstantInflowProfile(1),
    E: makeConstantInflowProfile(1),
    W: makeConstantInflowProfile(1),
  },
  // City-only
  spillback: false,
};

// Bring settings saved by an older version up to date.
export function normalizeCityConfig(saved = {}) {
  const cfg = { ...DEFAULT_CITY_SIM_CONFIG, ...saved };
  if (saved.durationMin != null && saved.simDuration == null) {
    cfg.simDuration = Math.round((saved.durationMin * 60) / (cfg.stepSeconds || 5));
  }
  if (saved.defaultTurn && saved.defaultTurnProbT == null) {
    cfg.defaultTurnProbT = saved.defaultTurn.T;
    cfg.defaultTurnProbR = saved.defaultTurn.R;
    cfg.defaultTurnProbL = saved.defaultTurn.L;
  }
  // Older versions used vehicles/hour and saturation flow; the simulator
  // now works in cars/step and vehicles per green step, like the grid.
  for (const side of SIDES) {
    if (!cfg.defaultBoundaryInflowProfiles?.[side] || cfg.defaultBoundaryInflowProfiles[side].mode === 'rate') {
      cfg.defaultBoundaryInflowProfiles = { ...cfg.defaultBoundaryInflowProfiles, [side]: makeConstantInflowProfile(1) };
    }
  }
  delete cfg.durationMin;
  delete cfg.defaultTurn;
  delete cfg.defaultInflowVphPerLane;
  delete cfg.departureMode;
  delete cfg.saturationFlowPerLaneVph;
  delete cfg.baseDepartureRate;
  return cfg;
}

export const defaultTurnProbs = (config) => ({ T: config.defaultTurnProbT, R: config.defaultTurnProbR, L: config.defaultTurnProbL });

export const emptyOverrides = () => ({ links: {}, turns: {}, departure: {} });

const round1 = (v) => Math.round(v * 10) / 10;
const linkIndex = (city) => city.linkById || new Map(city.links.map((l) => [l.id, l]));

// Effective values of one road piece after the user's overrides.
// Speed is in metres per step and length in metres, like the grid's
// units per step and units.
export function effectiveLink(link, linkOverrides = {}, config = DEFAULT_CITY_SIM_CONFIG) {
  const o = linkOverrides?.[link.id] || {};
  const stepSeconds = config.stepSeconds || DEFAULT_CITY_SIM_CONFIG.stepSeconds;
  const lanes = o.lanes ?? link.lanes.value;
  const lengthM = o.lengthM ?? link.lengthM;
  const mapSpeedPerStep = round1((link.speedKmh.value / 3.6) * stepSeconds);
  const speedPerStep = o.speedPerStep ?? mapSpeedPerStep;
  return {
    lanes,
    lengthM,
    speedPerStep,
    mapSpeedPerStep,
    speedKmh: (speedPerStep / stepSeconds) * 3.6,
    // Steps to drive this piece on its own (shown to the user).
    travelSteps: Math.max(1, Math.ceil(lengthM / speedPerStep)),
    storageVeh: Math.max(1, Math.floor((lengthM * lanes) / MODEL_CONSTANTS.jamSpacingM)),
  };
}

// Effective values of a route: the road pieces a car drives between two
// deciding nodes. Travel time is ceil(total length / speed) over the whole
// route, the grid's rule, so cutting a road into pieces does not slow it.
export function effectiveEdge(edge, city, overrides = {}, config = DEFAULT_CITY_SIM_CONFIG) {
  const linkById = linkIndex(city);
  const parts = edge.linkIds.map((id) => ({ id, ...effectiveLink(linkById.get(id), overrides.links, config) }));
  const lengthM = parts.reduce((sum, x) => sum + x.lengthM, 0);
  const exactSteps = parts.reduce((sum, x) => sum + x.lengthM / x.speedPerStep, 0);
  const travelSteps = Math.max(1, Math.ceil(exactSteps - 1e-9));
  // Step, counted from the start of the route, at which each piece ends.
  let reached = 0;
  const linkEnds = parts.map((x) => {
    reached += x.lengthM / x.speedPerStep;
    return { linkId: x.id, end: (reached / (exactSteps || 1)) * travelSteps };
  });
  return {
    lanes: Math.min(...parts.map((x) => x.lanes)),
    lengthM,
    travelSteps,
    storageVeh: parts.reduce((sum, x) => sum + x.storageVeh, 0),
    linkEnds,
    share: edge.share,
  };
}

// Turning ratios used by cars arriving on one arm of an intersection.
export function turnProbsFor(intersectionId, arm, config, overrides = {}) {
  return overrides.turns?.[intersectionId]?.[arm] || defaultTurnProbs(config);
}

// Which side of the area (N/S/E/W) a source lies on.
export function sourceSide(city, gatewayId) {
  const g = city.gateways.find((x) => x.id === gatewayId);
  const area = city.area;
  if (!g || !area) return 'N';
  const b = bearingDeg((area.south + area.north) / 2, (area.west + area.east) / 2, g.lat, g.lon);
  return ['N', 'E', 'S', 'W'][Math.round(b / 90) % 4];
}

// Sources: the squares from which traffic reaches an intersection.
export function sourceGateways(city) {
  return city.gateways.filter((g) => g.feederEdgeIds.length);
}

// Inflow of a source: its own, else the default for its side of the area.
export function inflowFor(gateway, city, config, inflows = {}) {
  if (inflows?.[gateway.id]) return inflows[gateway.id];
  return config.defaultBoundaryInflowProfiles?.[sourceSide(city, gateway.id)] || makeConstantInflowProfile(0);
}

// Vehicles per step an arm can release on green: set by hand, else the
// lanes of the roads that arrive on it, at most the lanes the arm really
// has (the simple graph can bring several direct roads onto one arm).
export function armDepartureRate(intersection, dir, city, config, overrides = {}) {
  const manual = overrides.departure?.[intersection.id]?.[dir];
  if (manual != null) return manual;
  const linkById = linkIndex(city);
  const perLane = config.departurePerLane ?? DEFAULT_CITY_SIM_CONFIG.departurePerLane;
  const lanes = intersection.arms[dir].inLinkIds.reduce((sum, id) => sum + effectiveLink(linkById.get(id), overrides.links, config).lanes, 0);
  const physical = intersection.armLanes?.[dir];
  return (physical ? Math.min(lanes, physical) : lanes) * perLane;
}

export function entryLabel(gateway) {
  return `${gateway.id} · ${gateway.junctionName || gateway.roadName || 'source'}`;
}

/**
 * @param city       city graph (deriveCity output)
 * @param config     DEFAULT_CITY_SIM_CONFIG-shaped settings
 * @param overrides  { links: { [linkId]: { lanes, speedPerStep, lengthM } },
 *                     turns: { [intersectionId]: { [arm]: { T, R, L } } },
 *                     departure: { [intersectionId]: { [arm]: vehPerStep } } }
 * @param inflows    { [sourceGatewayId]: profile }
 */
export function buildEngineNetwork(city, config, overrides = {}, inflows = {}) {
  const indexed = { ...city, linkById: new Map(city.links.map((l) => [l.id, l])) };
  const eff = new Map(city.edges.map((e) => [e.id, effectiveEdge(e, indexed, overrides, config)]));

  const ordered = [
    ...city.edges.filter((e) => e.kind === 'internal'),
    ...city.edges.filter((e) => e.kind === 'feeder'),
    ...city.edges.filter((e) => e.kind === 'exit'),
  ];
  const edges = ordered.map((e) => {
    const x = eff.get(e.id);
    return {
      id: e.id,
      from: e.from,
      to: e.to,
      fromArm: e.fromArm,
      toArm: e.toArm,
      kind: e.kind,
      travelSteps: x.travelSteps,
      storageVeh: x.storageVeh,
      share: x.share,
      linkEnds: x.linkEnds,
      turnProbs: e.toArm ? turnProbsFor(e.to, e.toArm, config, overrides) : defaultTurnProbs(config),
    };
  });

  const intersections = city.intersections.map((i) => {
    const arms = {};
    for (const [dir, arm] of Object.entries(i.arms)) {
      arms[dir] = {
        inEdgeIds: arm.inEdgeIds,
        outEdgeIds: arm.outEdgeIds,
        departureRate: armDepartureRate(i, dir, indexed, config, overrides),
      };
    }
    const phases = PHASE_NAMES.filter((name) => i.phases.some((ph) => ph.name === name));
    const fixedCycle = FIXED_CYCLE.filter((name) => phases.includes(name));
    return {
      id: i.id,
      arms,
      phases,
      fixedCycle: fixedCycle.length ? fixedCycle : phases,
      blockedMovements: i.movements.filter((m) => !m.allowed).map((m) => `${m.from}${m.turn}`),
    };
  });

  // One inflow per source. Where its roads lead to several intersections,
  // each car takes one of them in proportion to their shares.
  const edgeById = new Map(city.edges.map((e) => [e.id, e]));
  const entries = sourceGateways(city).map((g) => {
    const routes = g.feederEdgeIds.map((id) => edgeById.get(id));
    return {
      key: g.id,
      edgeId: routes[0].id,
      edges: routes.length > 1 ? routes.map((r) => ({ edgeId: r.id, share: r.share })) : null,
      label: entryLabel(g),
      profile: inflowFor(g, city, config, inflows),
    };
  });

  return { intersections, edges, entries };
}

// Data-file sources on one clock: step 0 at the earliest data (or the
// start set by the user), each step as long as the simulator's step.
export function cityDataTimeline(city, config, inflows) {
  return dataTimeline(
    sourceGateways(city).map((g) => ({ label: g.id, profile: inflowFor(g, city, config, inflows) })),
    { stepSeconds: config.stepSeconds, start: config.dataStart, spread: config.dataSpread },
  );
}

export function engineConfig(city, config, overrides, inflows) {
  const network = buildEngineNetwork(city, config, overrides, inflows);
  const { entries, timeline } = alignDataEntries(network.entries, { stepSeconds: config.stepSeconds, start: config.dataStart, spread: config.dataSpread });
  return {
    network: { ...network, entries },
    dataError: timeline.error,
    simDuration: Math.max(1, Math.round(config.simDuration)),
    stepSeconds: config.stepSeconds,
    seed: config.seed,
    fixedCycleInterval: config.fixedCycleInterval,
    greedyDecisionInterval: config.greedyDecisionInterval,
    lookaheadH: config.lookaheadH,
    totalWaitWeight: config.totalWaitWeight,
    totalWaitStdWeight: config.totalWaitStdWeight,
    queueWeight: config.queueWeight,
    queueStdWeight: config.queueStdWeight,
    inflowGlobalCap: config.inflowGlobalCap,
    spillback: config.spillback,
  };
}
