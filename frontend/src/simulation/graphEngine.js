// =====================================================
// GRAPH SIMULATION ENGINE
//
// The grid engine (engine.js) generalised to any network of
// intersections and directed edges. Same car objects, same step
// order, same Fixed vs Greedy lockstep with shared car IDs and
// intent synchronisation, same 8 phases, same lookahead objective.
// Given a grid expressed as a graph (gridAsGraph.js) it reproduces
// the grid engine's numbers exactly — that is tested.
//
// Network format (see cityNetwork.js / gridAsGraph.js):
//   intersections: [{ id, arms: { N|E|S|W: { inEdgeIds, outEdgeIds,
//                    departureRate } }, phases: [name], fixedCycle: [name] }]
//   edges:         [{ id, from, to, toArm, kind: internal|feeder|exit,
//                    travelSteps, storageVeh, share, turnProbs: {T,R,L} }]
//   entries:       [{ key, edgeId, profile, edges? }]   inflow per source;
//                  edges: [{ edgeId, share }] when its road later splits
//   edge.linkEnds (optional): [{ linkId, end }] road pieces along the edge,
//                  only used to report where cars are (snapshot.links)
//
// Edges are processed in array order (this matters for exact parity).
// =====================================================

import {
  DIRECTIONS,
  PHASES,
  PHASE_NAMES,
  LEFT_EXIT,
  THROUGH_EXIT,
  RIGHT_EXIT,
} from './constants.js';
import { PolicyRng } from './rng.js';
import { evaluateArrivalAt, buildDistributionSeries } from './arrivalProfile.js';

const EXIT_FOR_INTENT = { T: THROUGH_EXIT, R: RIGHT_EXIT, L: LEFT_EXIT };

function pstdev(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Same draw order as the grid engine: R, then L, then T.
function sampleIntent(probs, rngFn) {
  const r = rngFn();
  if (r < probs.R) return 'R';
  if (r < probs.R + probs.L) return 'L';
  return 'T';
}

// Cars an approach may release at step t. Integer rates behave exactly
// like the grid; fractional rates (from real saturation flows) are
// spread evenly over time so the long-run average is exact.
function capacityAt(rate, t) {
  if (!(rate > 0)) return 1;
  if (Number.isInteger(rate)) return rate;
  return Math.floor(rate * (t + 1)) - Math.floor(rate * t);
}

class IntentRegistry {
  constructor() { this.map = new Map(); }
  get(key) { return this.map.get(key); }
  has(key) { return this.map.has(key); }
  set(key, value) { this.map.set(key, value); }
}

export class GraphSimulationEngine {
  constructor(config) {
    this.config = {
      simDuration: Math.floor(config.simDuration || 200),
      fixedCycleInterval: Math.floor(config.fixedCycleInterval || 5),
      greedyDecisionInterval: Math.floor(config.greedyDecisionInterval || 5),
      lookaheadH: Math.floor(config.lookaheadH || 5),
      totalWaitWeight: config.totalWaitWeight ?? 1.0,
      totalWaitStdWeight: config.totalWaitStdWeight ?? 1.0,
      queueWeight: config.queueWeight ?? 1.0,
      queueStdWeight: config.queueStdWeight ?? 1.0,
      inflowGlobalCap: Math.max(0, Math.floor(config.inflowGlobalCap ?? 60)),
      spillback: Boolean(config.spillback),
      stepSeconds: config.stepSeconds ?? 1, // only used by 'rate' (veh/h) inflows
      seed: config.seed ?? 2,
    };
    this.network = config.network;
    this.currentTime = 0;
    this.isComplete = false;
  }

  // ---------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------
  init() {
    const cfg = this.config;
    const net = this.network;
    this.carSeq = 0;
    this.currentTime = 0;
    this.isComplete = false;
    this.intentRegistry = new IntentRegistry();
    this.greedyDecisionData = {};

    this.edgeById = new Map(net.edges.map((e) => [e.id, e]));
    this.intersectionById = new Map(net.intersections.map((i) => [i.id, i]));
    this.inEdgesOf = new Map(net.intersections.map((i) => [i.id, net.edges.filter((e) => e.to === i.id)]));
    // Movements that exist at each intersection (for intent renormalising).
    this.availableTurns = new Map();
    for (const i of net.intersections) {
      const byApproach = {};
      for (const d of DIRECTIONS) {
        byApproach[d] = { T: false, R: false, L: false };
        if (!i.arms[d]?.inEdgeIds?.length) continue;
        for (const turn of ['T', 'R', 'L']) {
          const exitArm = i.arms[EXIT_FOR_INTENT[turn][d]];
          const blocked = i.blockedMovements?.includes(`${d}${turn}`);
          byApproach[d][turn] = Boolean(exitArm?.outEdgeIds?.length) && !blocked;
        }
      }
      this.availableTurns.set(i.id, byApproach);
    }

    this.fixedState = this.makeState('fixed');
    this.greedyState = this.makeState('greedy');
    for (const i of net.intersections) {
      this.greedyState.nodes.get(i.id).currentPhase = this.usablePhases(i)[0] || PHASE_NAMES[0];
    }

    // Inflow series per entry (same seeding as the grid engine).
    const genRng = new PolicyRng(cfg.seed);
    this.entryKeys = net.entries.map((en) => en.key);
    this.arrivalRateSeriesByKey = {};
    for (const en of net.entries) {
      const profile = en.profile;
      if (profile && profile.mode === 'rate') {
        // Steady flow in vehicles/hour, spread evenly over the steps.
        const perStep = Math.max(0, Number(profile.vehPerHour) || 0) * cfg.stepSeconds / 3600;
        this.arrivalRateSeriesByKey[en.key] = Array.from({ length: cfg.simDuration }, (_, t) => (
          Math.min(cfg.inflowGlobalCap, Math.floor(perStep * (t + 1)) - Math.floor(perStep * t))
        ));
      } else if (profile && profile.mode === 'distribution' && profile.distributionConfig) {
        const raw = buildDistributionSeries(profile.distributionConfig, cfg.simDuration, cfg.seed, en.key);
        this.arrivalRateSeriesByKey[en.key] = raw.map((v) => Math.min(cfg.inflowGlobalCap, v));
      } else {
        const rng = new PolicyRng(`${cfg.seed}_inflow_${en.key}`);
        const lookup = {};
        const series = [];
        for (let t = 0; t < cfg.simDuration; t++) series.push(this.evaluateRate(profile, t, rng, lookup));
        this.arrivalRateSeriesByKey[en.key] = series;
      }
    }

    this.plannedArrivals = [];
    this.plannedTotalSeries = [];
    // A source whose road splits further on: each car takes one of its
    // routes. This uses its own random stream, so sources with a single
    // route draw exactly as before.
    const routeRngs = new Map();
    const pickRoute = (en) => {
      if (!routeRngs.has(en.key)) routeRngs.set(en.key, new PolicyRng(`${cfg.seed}_route_${en.key}`));
      const total = en.edges.reduce((sum, x) => sum + (x.share ?? 1), 0) || 1;
      let r = routeRngs.get(en.key).random() * total;
      const chosen = en.edges.find((x) => (r -= (x.share ?? 1)) < 0) || en.edges[en.edges.length - 1];
      return chosen.edgeId;
    };
    for (let t = 0; t < cfg.simDuration; t++) {
      const stepArrivals = [];
      for (const en of net.entries) {
        const rate = this.arrivalRateSeriesByKey[en.key][t] ?? 0;
        const splits = en.edges?.length > 1;
        const edge = this.edgeById.get(en.edgeId);
        const probs = this.turnProbsFor(edge);
        for (let k = 0; k < rate; k++) {
          const id = ++this.carSeq;
          const edgeId = splits ? pickRoute(en) : en.edgeId;
          const intent = sampleIntent(splits ? this.turnProbsFor(this.edgeById.get(edgeId)) : probs, () => genRng.random());
          stepArrivals.push({ entryKey: en.key, edgeId, car: { id, spawnTime: t, intent } });
        }
      }
      this.plannedArrivals.push(stepArrivals);
      this.plannedTotalSeries.push(stepArrivals.length);
    }

    this.perIntersectionMetrics = { fixed: {}, greedy: {} };
    for (const pol of ['fixed', 'greedy']) {
      for (const i of net.intersections) {
        this.perIntersectionMetrics[pol][i.id] = {
          queueLengths: { N: [], S: [], E: [], W: [] },
          avgWait: { N: [], S: [], E: [], W: [] },
          totalWait: { N: [], S: [], E: [], W: [] },
          stdWaitTimes: [],
          stdTotalWaitTimes: [],
          stdQueueSizes: [],
          phaseTimeline: [],
          decisionTimes: [],
          vehiclesServed: 0,
          vehiclesExited: 0,
        };
      }
    }
    const emptyGlobal = () => ({
      throughput: 0,
      totalVehiclesEntered: 0,
      throughputTimeSeries: [],
      enteredTimeSeries: [],
      vehiclesInNetwork: [],
      sumQueueSizes: [],
      sumAvgWaitTimes: [],
      sumTotalWaitTimes: [],
      sumStdTotalWaitTimes: [],
      realizedArrivalsTotalSeries: [],
      realizedArrivalsByKeySeries: {},
      waitingToEnterSeries: [],
      completedTrips: 0,
      totalTravelSteps: 0,
    });
    this.globalMetrics = { fixed: emptyGlobal(), greedy: emptyGlobal() };
    for (const gm of Object.values(this.globalMetrics)) {
      for (const en of net.entries) gm.realizedArrivalsByKeySeries[en.key] = [];
    }
  }

  makeState(policy) {
    const nodes = new Map();
    for (const i of this.network.intersections) {
      nodes.set(i.id, { queues: { N: [], S: [], E: [], W: [] }, currentPhase: null, phaseIdx: 0 });
    }
    const transit = new Map(this.network.edges.map((e) => [e.id, []]));
    return {
      policy,
      nodes,
      transit,
      occupancy: new Map(this.network.edges.map((e) => [e.id, 0])),
      backlog: new Map(this.network.entries.map((en) => [en.key, []])),
      rng: new PolicyRng(`${String(this.config.seed)}_${policy}`),
    };
  }

  evaluateRate(profile, t, rng, lookup) {
    const cap = this.config.inflowGlobalCap;
    if (!profile) return 0;
    if (profile.mode === 'function') {
      return evaluateArrivalAt({ ...(profile.functionConfig || {}), maxCap: cap }, t, () => rng.random(), lookup);
    }
    if (profile.mode === 'distribution') return 0;
    const v = Number.isFinite(Number(profile.constantValue)) ? Math.floor(Number(profile.constantValue)) : 0;
    return Math.min(cap, Math.max(0, v));
  }

  usablePhases(intersection) {
    return intersection.phases?.length ? intersection.phases : PHASE_NAMES;
  }

  // Turn probabilities for cars on `edge`, at its downstream intersection.
  // Movements that do not exist there are removed and the rest rescaled.
  turnProbsFor(edge) {
    const p = edge.turnProbs || { T: 0.7, R: 0.15, L: 0.15 };
    const avail = this.availableTurns.get(edge.to)?.[edge.toArm];
    if (!avail || (avail.T && avail.R && avail.L)) return p;
    const kept = { T: avail.T ? p.T : 0, R: avail.R ? p.R : 0, L: avail.L ? p.L : 0 };
    const sum = kept.T + kept.R + kept.L;
    if (sum > 0) return { T: kept.T / sum, R: kept.R / sum, L: kept.L / sum };
    // Nothing configured is possible: spread evenly over what exists.
    const n = (avail.T ? 1 : 0) + (avail.R ? 1 : 0) + (avail.L ? 1 : 0) || 1;
    return { T: avail.T ? 1 / n : 0, R: avail.R ? 1 / n : 0, L: avail.L ? 1 / n : 0 };
  }

  // ---------------------------------------------------------------
  // Movement of cars
  // ---------------------------------------------------------------
  hasSpace(state, edge) {
    if (!this.config.spillback) return true;
    return state.occupancy.get(edge.id) < (edge.storageVeh ?? Infinity);
  }

  // Pick which road a car takes when its exit arm has several.
  chooseOutEdge(state, nodeId, car, exitArm) {
    const node = this.intersectionById.get(nodeId);
    const ids = node.arms[exitArm]?.outEdgeIds || [];
    if (ids.length <= 1) return ids[0] ? this.edgeById.get(ids[0]) : null;
    const key = `${car.id}_${nodeId}_edge`;
    let idx = this.intentRegistry.get(key);
    if (idx == null) {
      const edges = ids.map((id) => this.edgeById.get(id));
      const total = edges.reduce((s, e) => s + (e.share ?? 1), 0) || 1;
      let r = state.rng.random() * total;
      idx = edges.findIndex((e) => (r -= (e.share ?? 1)) < 0);
      if (idx < 0) idx = edges.length - 1;
      this.intentRegistry.set(key, idx);
    }
    return this.edgeById.get(ids[idx]);
  }

  // Put a car onto `edge` (from intersection `fromId`, or from an entry).
  enterEdge(state, edge, car, fromId, t) {
    const pol = state.policy;
    if (edge.kind === 'exit') {
      if ((edge.travelSteps ?? 0) <= 0) {
        this.perIntersectionMetrics[pol][fromId].vehiclesExited++;
        this.recordTrip(state, car, t);
        return;
      }
      state.transit.get(edge.id).push({ ...car, edgeId: edge.id, exitFrom: fromId, exiting: true, transitCountdown: edge.travelSteps });
      state.occupancy.set(edge.id, state.occupancy.get(edge.id) + 1);
      return;
    }
    const key = `${car.id}_${edge.to}`;
    let intent;
    if (this.intentRegistry.has(key)) intent = this.intentRegistry.get(key);
    else {
      intent = sampleIntent(this.turnProbsFor(edge), () => state.rng.random());
      this.intentRegistry.set(key, intent);
    }
    state.transit.get(edge.id).push({
      id: car.id,
      spawnTime: car.spawnTime,
      intent,
      arrivalApproach: edge.toArm,
      edgeId: edge.id,
      transitCountdown: Math.max(1, edge.travelSteps ?? 1),
      enteredQueueAt: -1,
    });
    state.occupancy.set(edge.id, state.occupancy.get(edge.id) + 1);
  }

  recordTrip(state, car, t) {
    const gm = this.globalMetrics[state.policy];
    gm.completedTrips += 1;
    gm.totalTravelSteps += t - car.spawnTime;
  }

  // Route a car out of intersection `nodeId`. Returns false if blocked.
  routeCar(state, nodeId, car, approach, exitArm, t) {
    const edge = this.chooseOutEdge(state, nodeId, car, exitArm);
    if (!edge) {
      // No road that way (should not happen with renormalised intents).
      this.perIntersectionMetrics[state.policy][nodeId].vehiclesExited++;
      this.recordTrip(state, car, t);
      return true;
    }
    if (!this.hasSpace(state, edge)) return false;
    if (car.edgeId) state.occupancy.set(car.edgeId, state.occupancy.get(car.edgeId) - 1);
    this.enterEdge(state, edge, car, nodeId, t);
    return true;
  }

  // A car reaching the end of an edge.
  arrive(state, edge, car, t) {
    if (car.exiting) {
      state.occupancy.set(edge.id, state.occupancy.get(edge.id) - 1);
      this.perIntersectionMetrics[state.policy][car.exitFrom].vehiclesExited++;
      this.recordTrip(state, car, t);
      return;
    }
    const node = state.nodes.get(edge.to);
    car.enteredQueueAt = t;
    if (car.intent === 'L') {
      if (!this.routeCar(state, edge.to, car, car.arrivalApproach, LEFT_EXIT[car.arrivalApproach], t)) {
        node.queues[car.arrivalApproach].push(car);
      }
    } else {
      node.queues[car.arrivalApproach].push(car);
    }
  }

  // ---------------------------------------------------------------
  // One policy, one step (same order as the grid engine)
  // ---------------------------------------------------------------
  stepState(state, t) {
    const cfg = this.config;
    const net = this.network;
    const pol = state.policy;

    // 1. Travel: cars reaching the end of their edge.
    for (const edge of net.edges) {
      const cars = state.transit.get(edge.id);
      const remaining = [];
      state.transit.set(edge.id, remaining);
      for (const car of cars) {
        car.transitCountdown--;
        if (car.transitCountdown <= 0) this.arrive(state, edge, car, t);
        else remaining.push(car);
      }
    }

    // 2. New arrivals from the entries.
    let realized = 0;
    const realizedByKey = {};
    const pending = [...(this.plannedArrivals[t] || [])];
    if (cfg.spillback) {
      // Cars that could not enter earlier go first.
      const held = [];
      for (const en of net.entries) held.push(...state.backlog.get(en.key).map((car) => ({ entryKey: en.key, edgeId: car.edgeId ?? en.edgeId, car })));
      for (const en of net.entries) state.backlog.set(en.key, []);
      pending.unshift(...held);
    }
    for (const { entryKey, edgeId, car: template } of pending) {
      const edge = this.edgeById.get(edgeId);
      const car = { id: template.id, spawnTime: template.spawnTime, intent: template.intent, enteredQueueAt: t, arrivalApproach: edge.toArm };
      if ((edge.travelSteps ?? 0) <= 0) {
        // Grid-style entry: straight into the intersection queue.
        const node = state.nodes.get(edge.to);
        if (car.intent === 'L') {
          if (!this.routeCar(state, edge.to, car, car.arrivalApproach, LEFT_EXIT[car.arrivalApproach], t)) node.queues[car.arrivalApproach].push(car);
        } else {
          node.queues[car.arrivalApproach].push(car);
        }
        realized++;
        realizedByKey[entryKey] = (realizedByKey[entryKey] || 0) + 1;
      } else if (this.hasSpace(state, edge)) {
        state.transit.get(edge.id).push({ ...car, edgeId: edge.id, transitCountdown: edge.travelSteps, enteredQueueAt: -1 });
        state.occupancy.set(edge.id, state.occupancy.get(edge.id) + 1);
        realized++;
        realizedByKey[entryKey] = (realizedByKey[entryKey] || 0) + 1;
      } else {
        state.backlog.get(entryKey).push({ ...template, edgeId });
      }
    }
    this.globalMetrics[pol].realizedArrivalsTotalSeries.push(realized);
    for (const en of net.entries) this.globalMetrics[pol].realizedArrivalsByKeySeries[en.key].push(realizedByKey[en.key] || 0);
    let waiting = 0;
    for (const list of state.backlog.values()) waiting += list.length;
    this.globalMetrics[pol].waitingToEnterSeries.push(waiting);

    // 3. Free left turns.
    for (const inter of net.intersections) {
      const node = state.nodes.get(inter.id);
      for (const approach of DIRECTIONS) {
        const maxLeave = capacityAt(inter.arms[approach]?.departureRate ?? 0, t);
        let leftCount = 0;
        const remaining = [];
        for (const car of node.queues[approach]) {
          if (car.intent === 'L' && leftCount < maxLeave && this.routeCar(state, inter.id, car, approach, LEFT_EXIT[approach], t)) {
            leftCount++;
          } else {
            remaining.push(car);
          }
        }
        node.queues[approach] = remaining;
      }
    }

    // 4. Fixed-cycle phase changes.
    if (pol === 'fixed' && t % cfg.fixedCycleInterval === 0) {
      for (const inter of net.intersections) {
        const node = state.nodes.get(inter.id);
        const cycle = inter.fixedCycle?.length ? inter.fixedCycle : this.usablePhases(inter);
        node.currentPhase = cycle[node.phaseIdx % cycle.length];
        node.phaseIdx++;
        this.perIntersectionMetrics[pol][inter.id].phaseTimeline.push(node.currentPhase);
        this.perIntersectionMetrics[pol][inter.id].decisionTimes.push(t);
      }
    }
    if (pol === 'greedy') {
      for (const inter of net.intersections) {
        const node = state.nodes.get(inter.id);
        if (!node.currentPhase) node.currentPhase = this.usablePhases(inter)[0];
      }
    }

    // 5. Serve the green phase (whole queue scanned, not strict FIFO).
    for (const inter of net.intersections) {
      const node = state.nodes.get(inter.id);
      const phase = PHASES[node.currentPhase];
      if (!phase) continue;
      const allowed = {};
      for (const [approach, movement] of phase) {
        if (!allowed[approach]) allowed[approach] = new Set();
        allowed[approach].add(movement);
      }
      for (const approach of DIRECTIONS) {
        if (!allowed[approach]) continue;
        const capacity = capacityAt(inter.arms[approach]?.departureRate ?? 0, t);
        let served = 0;
        const remaining = [];
        for (const car of node.queues[approach]) {
          if (served < capacity && allowed[approach].has(car.intent)) {
            const exitArm = car.intent === 'T' ? THROUGH_EXIT[approach] : RIGHT_EXIT[approach];
            if (this.routeCar(state, inter.id, car, approach, exitArm, t)) {
              served++;
              this.perIntersectionMetrics[pol][inter.id].vehiclesServed++;
              continue;
            }
          }
          remaining.push(car);
        }
        node.queues[approach] = remaining;
      }
    }

    // 5.5 Greedy decisions on the end-of-step state.
    if (pol === 'greedy' && t % cfg.greedyDecisionInterval === 0) {
      for (const inter of net.intersections) {
        const node = state.nodes.get(inter.id);
        node.currentPhase = this.greedySelectPhase(state, inter, t);
        this.perIntersectionMetrics[pol][inter.id].phaseTimeline.push(node.currentPhase);
        this.perIntersectionMetrics[pol][inter.id].decisionTimes.push(t);
      }
    }

    // 6. Metrics.
    let sumQueueSize = 0;
    let sumAvgWait = 0;
    let sumTotalWait = 0;
    let sumStdTotalWait = 0;
    let inQueues = 0;
    let inTransit = 0;
    for (const inter of net.intersections) {
      const node = state.nodes.get(inter.id);
      const m = this.perIntersectionMetrics[pol][inter.id];
      const avgWaits = [];
      const totalWaits = [];
      for (const d of DIRECTIONS) {
        const q = node.queues[d];
        m.queueLengths[d].push(q.length);
        inQueues += q.length;
        let totalW = 0;
        let avgW = 0;
        if (q.length > 0) {
          totalW = q.reduce((s, car) => s + (t - car.enteredQueueAt), 0);
          avgW = totalW / q.length;
        }
        m.totalWait[d].push(totalW);
        m.avgWait[d].push(avgW);
        avgWaits.push(avgW);
        totalWaits.push(totalW);
        sumAvgWait += avgW;
        sumTotalWait += totalW;
        sumQueueSize += q.length;
      }
      m.stdWaitTimes.push(pstdev(avgWaits));
      const stdTotalWait = pstdev(totalWaits);
      m.stdTotalWaitTimes.push(stdTotalWait);
      sumStdTotalWait += stdTotalWait;
      m.stdQueueSizes.push(pstdev(DIRECTIONS.map((d) => node.queues[d].length)));
    }
    for (const cars of state.transit.values()) inTransit += cars.length;

    return { vehiclesInNetwork: inQueues + inTransit, sumQueueSize, sumAvgWait, sumTotalWait, sumStdTotalWait };
  }

  // ---------------------------------------------------------------
  // Greedy lookahead (local to one intersection, never mutates state).
  // Records the same decision data as the grid engine, so the
  // "algorithm reasoning" view can show every number used.
  // ---------------------------------------------------------------
  greedySelectPhase(state, inter, t) {
    const cfg = this.config;
    const node = state.nodes.get(inter.id);
    const savedRngState = state.rng.getState();
    const candidates = this.usablePhases(inter);
    const directEntries = this.network.entries.filter((en) => {
      const e = this.edgeById.get(en.edgeId);
      return e.to === inter.id && (e.travelSteps ?? 0) <= 0;
    });
    const feedingEdges = this.inEdgesOf.get(inter.id);
    const makeDirMap = () => ({ N: 0, S: 0, E: 0, W: 0 });
    const makeIntentMap = () => ({ N: { T: 0, R: 0, L: 0 }, S: { T: 0, R: 0, L: 0 }, E: { T: 0, R: 0, L: 0 }, W: { T: 0, R: 0, L: 0 } });
    const capsAt = (time) => Object.fromEntries(DIRECTIONS.map((d) => [d, capacityAt(inter.arms[d]?.departureRate ?? 0, time)]));

    const queuesBefore = {};
    const totalWaitBefore = {};
    for (const d of DIRECTIONS) {
      queuesBefore[d] = node.queues[d].length;
      totalWaitBefore[d] = node.queues[d].reduce((s, car) => s + (t - car.enteredQueueAt), 0);
    }
    const horizonInputs = [];
    for (let h = 1; h <= cfg.lookaheadH; h++) {
      const futureT = t + h;
      const boundaryArrivalRates = makeDirMap();
      for (const en of directEntries) {
        const e = this.edgeById.get(en.edgeId);
        boundaryArrivalRates[e.toArm] += this.arrivalRateSeriesByKey[en.key]?.[futureT] ?? 0;
      }
      horizonInputs.push({ time: futureT, boundaryArrivalRates, departureCaps: capsAt(futureT) });
    }

    let bestScore = Infinity;
    let bestPhase = candidates[0];
    const candidateResults = [];

    for (const candidatePhase of candidates) {
      state.rng.setState(savedRngState);
      const simQueues = {};
      for (const d of DIRECTIONS) simQueues[d] = node.queues[d].map((car) => ({ ...car }));
      const feeding = feedingEdges.map((e) => state.transit.get(e.id).map((car) => ({ ...car })));
      const stepTrace = [];

      for (let h = 1; h <= cfg.lookaheadH; h++) {
        const futureT = t + h;
        const trace = {
          time: futureT,
          queueStart: makeDirMap(),
          transitToQueue: makeDirMap(),
          boundaryArrivalRates: { ...horizonInputs[h - 1].boundaryArrivalRates },
          boundaryArrivalsByIntent: makeIntentMap(),
          boundaryToQueue: makeDirMap(),
          freeLeftDepartures: makeDirMap(),
          phaseDepartures: makeDirMap(),
          queueEnd: makeDirMap(),
        };
        for (const d of DIRECTIONS) trace.queueStart[d] = simQueues[d].length;

        // Arrivals from edges feeding this intersection.
        feeding.forEach((cars, k) => {
          const remaining = [];
          for (const car of cars) {
            car.transitCountdown--;
            if (car.transitCountdown <= 0) {
              if (car.intent !== 'L' && !car.exiting) {
                car.enteredQueueAt = futureT;
                simQueues[car.arrivalApproach].push(car);
                trace.transitToQueue[car.arrivalApproach]++;
              }
            } else {
              remaining.push(car);
            }
          }
          feeding[k] = remaining;
        });
        // Entries that feed the queue directly.
        for (const en of directEntries) {
          const e = this.edgeById.get(en.edgeId);
          const rate = this.arrivalRateSeriesByKey[en.key]?.[futureT] ?? 0;
          const probs = this.turnProbsFor(e);
          for (let k = 0; k < rate; k++) {
            const intent = sampleIntent(probs, () => state.rng.random());
            trace.boundaryArrivalsByIntent[e.toArm][intent]++;
            if (intent !== 'L') {
              simQueues[e.toArm].push({ id: -1, spawnTime: futureT, intent, enteredQueueAt: futureT, arrivalApproach: e.toArm });
              trace.boundaryToQueue[e.toArm]++;
            }
          }
        }
        // Free lefts.
        for (const approach of DIRECTIONS) {
          const maxLeave = capacityAt(inter.arms[approach]?.departureRate ?? 0, futureT);
          let leftCount = 0;
          simQueues[approach] = simQueues[approach].filter((car) => {
            if (car.intent === 'L' && leftCount < maxLeave) { leftCount++; return false; }
            return true;
          });
          trace.freeLeftDepartures[approach] = leftCount;
        }
        // Candidate phase service.
        const phase = PHASES[candidatePhase];
        const allowed = {};
        for (const [approach, movement] of phase) {
          if (!allowed[approach]) allowed[approach] = new Set();
          allowed[approach].add(movement);
        }
        for (const approach of DIRECTIONS) {
          if (!allowed[approach]) continue;
          const capacity = capacityAt(inter.arms[approach]?.departureRate ?? 0, futureT);
          let served = 0;
          simQueues[approach] = simQueues[approach].filter((car) => {
            if (served < capacity && allowed[approach].has(car.intent)) { served++; return false; }
            return true;
          });
          trace.phaseDepartures[approach] = served;
        }
        for (const d of DIRECTIONS) trace.queueEnd[d] = simQueues[d].length;
        stepTrace.push(trace);
      }

      const futureT = t + cfg.lookaheadH;
      const totalWaits = DIRECTIONS.map((d) => simQueues[d].reduce((s, car) => s + (futureT - car.enteredQueueAt), 0));
      const qLens = DIRECTIONS.map((d) => simQueues[d].length);
      const sumTotalWait = totalWaits.reduce((a, b) => a + b, 0);
      const stdTotalWait = pstdev(totalWaits);
      const sumQ = qLens.reduce((a, b) => a + b, 0);
      const stdQ = pstdev(qLens);
      const costTerms = {
        termTotalWait: cfg.totalWaitWeight * sumTotalWait,
        termStdTotalWait: cfg.totalWaitStdWeight * stdTotalWait,
        termSumQ: cfg.queueWeight * sumQ,
        termStdQ: cfg.queueStdWeight * stdQ,
      };
      const score = costTerms.termTotalWait + costTerms.termStdTotalWait + costTerms.termSumQ + costTerms.termStdQ;
      candidateResults.push({
        phase: candidatePhase,
        queuesAfter: Object.fromEntries(DIRECTIONS.map((d, k) => [d, qLens[k]])),
        totalWaitAfter: Object.fromEntries(DIRECTIONS.map((d, k) => [d, totalWaits[k]])),
        sumTotalWait,
        stdTotalWait,
        sumQ,
        stdQ,
        totalScore: score,
        stepTrace,
        costTerms,
      });
      if (score < bestScore) {
        bestScore = score;
        bestPhase = candidatePhase;
      }
    }

    this.greedyDecisionData[inter.id] = {
      time: t,
      queuesBefore,
      totalWaitBefore,
      departureRates: capsAt(t),
      horizonInputs,
      candidateResults: candidateResults.map((c) => ({ ...c, isBest: c.phase === bestPhase })),
      bestPhase,
      bestScore,
      weights: {
        totalWaitWeight: cfg.totalWaitWeight,
        totalWaitStdWeight: cfg.totalWaitStdWeight,
        queueWeight: cfg.queueWeight,
        queueStdWeight: cfg.queueStdWeight,
      },
      lookaheadH: cfg.lookaheadH,
      decisionState: 'end-of-step',
      phaseAppliesFrom: t + 1,
    };
    state.rng.setState(savedRngState);
    return bestPhase;
  }

  // ---------------------------------------------------------------
  // Both policies in lockstep
  // ---------------------------------------------------------------
  step() {
    if (this.isComplete) return null;
    const t = this.currentTime;
    const results = {
      fixed: this.stepState(this.fixedState, t),
      greedy: this.stepState(this.greedyState, t),
    };
    for (const pol of ['fixed', 'greedy']) {
      const gm = this.globalMetrics[pol];
      const r = results[pol];
      // Vehicles actually on the network (with capacity limits, some may
      // still be waiting at a full entry). Without limits this equals the
      // planned arrivals, exactly as in the grid engine.
      const entered = (gm.enteredTimeSeries.at(-1) || 0) + gm.realizedArrivalsTotalSeries[t];
      gm.totalVehiclesEntered = entered;
      gm.enteredTimeSeries.push(entered);
      gm.vehiclesInNetwork.push(r.vehiclesInNetwork);
      gm.sumQueueSizes.push(r.sumQueueSize);
      gm.sumAvgWaitTimes.push(r.sumAvgWait);
      gm.sumTotalWaitTimes.push(r.sumTotalWait);
      gm.sumStdTotalWaitTimes.push(r.sumStdTotalWait);
      let exited = 0;
      for (const m of Object.values(this.perIntersectionMetrics[pol])) exited += m.vehiclesExited;
      gm.throughput = exited;
      gm.throughputTimeSeries.push(exited);
    }
    this.currentTime++;
    if (this.currentTime >= this.config.simDuration) this.isComplete = true;
    return this.getSnapshot();
  }

  run() {
    while (!this.isComplete) this.step();
    return this.getSnapshot();
  }

  getSnapshot() {
    const nodeSnapshot = (state) => {
      const out = {};
      for (const inter of this.network.intersections) {
        const node = state.nodes.get(inter.id);
        const q = Object.fromEntries(DIRECTIONS.map((d) => [d, node.queues[d].length]));
        out[inter.id] = {
          queueLengths: q,
          totalQueued: DIRECTIONS.reduce((s, d) => s + q[d], 0),
          currentPhase: node.currentPhase,
          vehiclesServed: this.perIntersectionMetrics[state.policy][inter.id].vehiclesServed,
          vehiclesExited: this.perIntersectionMetrics[state.policy][inter.id].vehiclesExited,
        };
      }
      return out;
    };
    const edgeSnapshot = (state) => {
      const out = {};
      for (const [id, cars] of state.transit.entries()) out[id] = cars.length;
      return out;
    };
    // Cars per road piece, for edges that say which pieces they run along.
    const linkSnapshot = (state) => {
      const out = {};
      for (const edge of this.network.edges) {
        const ends = edge.linkEnds;
        if (!ends?.length) continue;
        for (const car of state.transit.get(edge.id)) {
          const elapsed = edge.travelSteps - car.transitCountdown;
          let k = 0;
          while (k < ends.length - 1 && elapsed >= ends[k].end) k += 1;
          out[ends[k].linkId] = (out[ends[k].linkId] || 0) + 1;
        }
      }
      return out;
    };
    const policySnapshot = (pol, state) => {
      const gm = this.globalMetrics[pol];
      return {
        intersections: nodeSnapshot(state),
        edges: edgeSnapshot(state),
        links: linkSnapshot(state),
        throughput: gm.throughput,
        totalVehiclesEntered: gm.totalVehiclesEntered,
        throughputTimeSeries: gm.throughputTimeSeries,
        enteredTimeSeries: gm.enteredTimeSeries,
        vehiclesInNetwork: gm.vehiclesInNetwork,
        sumQueueSizes: gm.sumQueueSizes,
        sumAvgWaitTimes: gm.sumAvgWaitTimes,
        sumTotalWaitTimes: gm.sumTotalWaitTimes,
        sumStdTotalWaitTimes: gm.sumStdTotalWaitTimes,
        realizedArrivalsTotalSeries: gm.realizedArrivalsTotalSeries,
        waitingToEnterSeries: gm.waitingToEnterSeries,
        completedTrips: gm.completedTrips,
        avgTripSteps: gm.completedTrips ? gm.totalTravelSteps / gm.completedTrips : 0,
      };
    };
    return {
      time: this.currentTime,
      isComplete: this.isComplete,
      fixed: policySnapshot('fixed', this.fixedState),
      greedy: policySnapshot('greedy', this.greedyState),
      perIntersectionMetrics: this.perIntersectionMetrics,
      greedyDecisionData: this.greedyDecisionData,
      inflowSeries: {
        globalCap: this.config.inflowGlobalCap,
        entryKeys: this.entryKeys,
        boundaryKeys: this.entryKeys,
        boundaryKeyLabels: Object.fromEntries(this.network.entries.map((en) => [en.key, en.label || en.key])),
        plannedRateSeriesByKey: this.arrivalRateSeriesByKey,
        plannedTotalSeries: this.plannedTotalSeries,
        plannedBoundaryArrivalsTotalSeries: this.plannedTotalSeries,
        realizedBoundaryArrivals: {
          fixed: { totalSeries: this.globalMetrics.fixed.realizedArrivalsTotalSeries, byKeySeries: this.globalMetrics.fixed.realizedArrivalsByKeySeries },
          greedy: { totalSeries: this.globalMetrics.greedy.realizedArrivalsTotalSeries, byKeySeries: this.globalMetrics.greedy.realizedArrivalsByKeySeries },
        },
      },
    };
  }
}
