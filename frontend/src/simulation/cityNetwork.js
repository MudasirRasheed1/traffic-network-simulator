// =====================================================
// CITY GRAPH → ENGINE NETWORK
// Applies the user's overrides to the map-derived city graph and
// converts real-world units into simulation steps.
// =====================================================

import { FIXED_CYCLE, PHASE_NAMES } from './constants.js';
import { MODEL_CONSTANTS } from '../network/roadDefaults.js';

export const DEFAULT_CITY_SIM_CONFIG = {
  stepSeconds: 5,
  durationMin: 60,
  seed: 2,
  fixedCycleInterval: 6, // steps → 30 s per phase
  greedyDecisionInterval: 6,
  lookaheadH: 6,
  totalWaitWeight: 1.0,
  totalWaitStdWeight: 1.0,
  queueWeight: 1.0,
  queueStdWeight: 1.0,
  inflowGlobalCap: 60,
  spillback: false,
  defaultTurn: { T: 0.7, R: 0.15, L: 0.15 },
  defaultInflowVphPerLane: 300,
};

export function makeRateProfile(vehPerHour) {
  return { mode: 'rate', vehPerHour: Math.max(0, Math.round(vehPerHour)) };
}

// Effective value of an edge parameter after overrides.
export function effectiveEdge(edge, overrides = {}) {
  const o = overrides[edge.id] || {};
  const lanes = o.lanes ?? edge.lanes.value;
  const speedKmh = o.speedKmh ?? edge.speedKmh.value;
  const saturationFlowVph = o.saturationFlowVph ?? lanes * MODEL_CONSTANTS.saturationFlowPerLaneVph;
  const freeFlowTimeS = edge.lengthM / (speedKmh / 3.6);
  const storageVeh = Math.max(1, Math.floor((edge.lengthM * lanes) / MODEL_CONSTANTS.jamSpacingM));
  return { lanes, speedKmh, saturationFlowVph, freeFlowTimeS, storageVeh, turnProbs: o.turnProbs || null, share: o.share ?? edge.share };
}

export function defaultInflowFor(edge, config, overrides) {
  const lanes = effectiveEdge(edge, overrides).lanes;
  return makeRateProfile(lanes * config.defaultInflowVphPerLane);
}

/**
 * @param city       city graph (buildCityGraph output)
 * @param config     DEFAULT_CITY_SIM_CONFIG-shaped settings
 * @param overrides  { edges: { [edgeId]: {...} } }
 * @param inflows    { [feederEdgeId]: profile }
 */
export function buildEngineNetwork(city, config, overrides = {}, inflows = {}) {
  const edgeOverrides = overrides.edges || {};
  const stepHours = config.stepSeconds / 3600;
  const eff = new Map(city.edges.map((e) => [e.id, effectiveEdge(e, edgeOverrides)]));

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
      travelSteps: Math.max(1, Math.round(x.freeFlowTimeS / config.stepSeconds)),
      storageVeh: x.storageVeh,
      share: x.share,
      turnProbs: x.turnProbs || config.defaultTurn,
    };
  });

  const intersections = city.intersections.map((i) => {
    const arms = {};
    for (const [dir, a] of Object.entries(i.arms)) {
      const satFlow = a.inEdgeIds.reduce((s, id) => s + eff.get(id).saturationFlowVph, 0);
      arms[dir] = {
        inEdgeIds: a.inEdgeIds,
        outEdgeIds: a.outEdgeIds,
        // Vehicles per step one approach can discharge on green.
        departureRate: Math.round(satFlow * stepHours * 1000) / 1000,
      };
    }
    const phases = PHASE_NAMES.filter((name) => i.phases.some((p) => p.name === name));
    const fixedCycle = FIXED_CYCLE.filter((name) => phases.includes(name));
    return {
      id: i.id,
      arms,
      phases,
      fixedCycle: fixedCycle.length ? fixedCycle : phases,
      blockedMovements: i.movements.filter((m) => !m.allowed).map((m) => `${m.from}${m.turn}`),
    };
  });

  const entries = city.edges
    .filter((e) => e.kind === 'feeder')
    .map((e) => ({ key: e.id, edgeId: e.id, profile: inflows[e.id] || defaultInflowFor(e, config, edgeOverrides) }));

  return { intersections, edges, entries };
}

export function engineConfig(city, config, overrides, inflows) {
  return {
    network: buildEngineNetwork(city, config, overrides, inflows),
    simDuration: Math.max(1, Math.round((config.durationMin * 60) / config.stepSeconds)),
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
