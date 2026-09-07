// =====================================================
// NETWORK SIMULATION ENGINE - CAR-OBJECT BASED
//
// Each car is a first-class object with unique ID.
// Both policies (Fixed / Greedy) run in lockstep.
// Intent synchronization: if one policy is ahead for
// a car at an intersection, the other mirrors the intent.
// Greedy lookahead deep-copies all data - never mutates originals.
// =====================================================

import {
  DIRECTIONS,
  PHASES,
  PHASE_NAMES,
  FIXED_CYCLE,
  EXIT_TO_NEIGHBOR_DELTA,
  ARRIVAL_APPROACH,
  APPROACH_TO_HEADING,
  LEFT_EXIT,
  THROUGH_EXIT,
  RIGHT_EXIT,
} from './constants.js';
import { PolicyRng } from './rng.js';
import { evaluateArrivalAt, buildDistributionSeries } from './arrivalProfile.js';

// =====================================================
// CAR FACTORY
// =====================================================
let globalCarId = 0;
function resetCarId() { globalCarId = 0; }
function nextCarId() { return ++globalCarId; }

// =====================================================
// INTENT REGISTRY  (shared between both policies)
// Key: `carId_r,c`  -> intent string (T/R/L)
// When a car departs intersection (r,c) in one policy,
// we record its intent. The other policy must use the same.
// =====================================================
class IntentRegistry {
  constructor() { this.map = new Map(); }
  key(carId, r, c) { return `${carId}_${r},${c}`; }
  has(carId, r, c) { return this.map.has(this.key(carId, r, c)); }
  get(carId, r, c) { return this.map.get(this.key(carId, r, c)); }
  set(carId, r, c, intent) { this.map.set(this.key(carId, r, c), intent); }
}

// =====================================================
// UTILITY
// =====================================================
function pstdev(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function deepCopyQueues(queues) {
  const copy = {};
  for (const d of DIRECTIONS) {
    copy[d] = queues[d].map(car => ({ ...car }));
  }
  return copy;
}

function deepCopyTransitList(transitList) {
  return transitList.map(car => ({ ...car }));
}

// =====================================================
// BUILD GRID  (one per policy)
// =====================================================
function buildGrid(gridSize, config) {
  const grid = [];
  for (let r = 0; r < gridSize; r++) {
    const row = [];
    for (let c = 0; c < gridSize; c++) {
      const isBoundary = r === 0 || r === gridSize - 1 || c === 0 || c === gridSize - 1;
      const boundaryDirs = [];
      if (r === 0) boundaryDirs.push('N');
      if (r === gridSize - 1) boundaryDirs.push('S');
      if (c === 0) boundaryDirs.push('W');
      if (c === gridSize - 1) boundaryDirs.push('E');

      // Boundary arrival rates
      const arrivalRates = { N: 0, S: 0, E: 0, W: 0 };
      if (isBoundary) {
        const p = config.boundaryInflowProfiles?.[r]?.[c] || {};
        if (r === 0) arrivalRates.N = p.N?.constantValue ?? 0;
        if (r === gridSize - 1) arrivalRates.S = p.S?.constantValue ?? 0;
        if (c === 0) arrivalRates.W = p.W?.constantValue ?? 0;
        if (c === gridSize - 1) arrivalRates.E = p.E?.constantValue ?? 0;
      }

      // Per direction departure rate
      const deptDefault = config.baseDepartureRate ?? 8;
      const deptOverride = config.departureRates?.[r]?.[c];
      const departureRate = deptOverride ?? { N: deptDefault, S: deptDefault, E: deptDefault, W: deptDefault };

      // Boundary turn probs
      const boundaryTurnProbs = {};
      for (const d of DIRECTIONS) {
        const bndKey = `bnd_${d}_${r},${c}`;
        const bndProps = config.boundaryRoadProps?.[bndKey];
        boundaryTurnProbs[d] = {
          T: bndProps?.turnT ?? config.defaultTurnProbT ?? 0.7,
          R: bndProps?.turnR ?? config.defaultTurnProbR ?? 0.15,
          L: bndProps?.turnL ?? config.defaultTurnProbL ?? 0.15,
        };
      }

      row.push({
        row: r, col: c,
        // 4 waiting queues (arrays of car objects)
        queues: { N: [], S: [], E: [], W: [] },
        currentPhase: null,
        phaseIdx: 0,
        arrivalRates,
        departureRate,
        boundaryTurnProbs,
        isBoundary,
        boundaryDirs,
      });
    }
    grid.push(row);
  }
  return grid;
}

// =====================================================
// ROAD PROPERTIES & TRANSIT QUEUES
// =====================================================
function buildRoadData(gridSize, config) {
  const roadProps = {};
  const transitQueues = {};  // key -> array of car objects with .transitCountdown
  const defaultSpeed = config.defaultRoadSpeed || 2;
  const defaultLength = config.defaultRoadLength || 12;
  const defaultTurnT = config.defaultTurnProbT ?? 0.7;
  const defaultTurnR = config.defaultTurnProbR ?? 0.15;
  const defaultTurnL = config.defaultTurnProbL ?? 0.15;

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      for (const dir of DIRECTIONS) {
        const [dr, dc] = EXIT_TO_NEIGHBOR_DELTA[dir];
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize) {
          const key = `${r},${c}->${nr},${nc}`;
          transitQueues[key] = [];

          const override = config.roadOverrides?.[key];
          const speed = override?.speed ?? defaultSpeed;
          const length = override?.length ?? defaultLength;
          const travelTime = Math.max(1, Math.round(length / speed));
          const turnT = override?.turnT ?? defaultTurnT;
          const turnR = override?.turnR ?? defaultTurnR;
          const turnL = override?.turnL ?? defaultTurnL;

          roadProps[key] = { speed, length, travelTime, turnT, turnR, turnL };
        }
      }
    }
  }
  return { roadProps, transitQueues };
}

function buildBoundaryRoadProps(gridSize, config) {
  const props = {};
  const defaultTurnT = config.defaultTurnProbT ?? 0.7;
  const defaultTurnR = config.defaultTurnProbR ?? 0.15;
  const defaultTurnL = config.defaultTurnProbL ?? 0.15;

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const dirs = [];
      if (r === 0) dirs.push('N');
      if (r === gridSize - 1) dirs.push('S');
      if (c === 0) dirs.push('W');
      if (c === gridSize - 1) dirs.push('E');
      for (const d of dirs) {
        const bndKey = `bnd_${d}_${r},${c}`;
        const override = config.boundaryRoadOverrides?.[bndKey];
        props[bndKey] = {
          turnT: override?.turnT ?? defaultTurnT,
          turnR: override?.turnR ?? defaultTurnR,
          turnL: override?.turnL ?? defaultTurnL,
        };
      }
    }
  }
  return props;
}

// =====================================================
// SAMPLE INTENT
// =====================================================
function sampleIntent(turnT, turnR, turnL, rngFn) {
  const r = rngFn();
  if (r < turnR) return 'R';
  if (r < turnR + turnL) return 'L';
  return 'T';
}

// =====================================================
// MAIN ENGINE CLASS
// =====================================================
export class SimulationEngine {
  constructor(config) {
    this.config = {
      gridSize: Math.floor(config.gridSize || 3),
      simDuration: Math.floor(config.simDuration || 200),
      defaultRoadSpeed: config.defaultRoadSpeed ?? 2,
      defaultRoadLength: config.defaultRoadLength ?? 12,
      defaultTurnProbT: config.defaultTurnProbT ?? 0.7,
      defaultTurnProbR: config.defaultTurnProbR ?? 0.15,
      defaultTurnProbL: config.defaultTurnProbL ?? 0.15,
      roadOverrides: config.roadOverrides || null,
      boundaryRoadOverrides: config.boundaryRoadOverrides || null,
      fixedCycleInterval: Math.floor(config.fixedCycleInterval || 5),
      greedyDecisionInterval: Math.floor(config.greedyDecisionInterval || 5),
      lookaheadH: Math.floor(config.lookaheadH || 5),
      alpha: config.alpha ?? 1.0,
      beta: config.beta ?? 1.0,
      gamma: config.gamma ?? 1.0,
      totalWaitWeight: config.totalWaitWeight ?? config.waitWeight ?? 1.0,
      totalWaitStdWeight: config.totalWaitStdWeight ?? config.waitStdWeight ?? 1.0,
      queueWeight: config.queueWeight ?? 1.0,
      queueStdWeight: config.queueStdWeight ?? 1.0,
      baseDepartureRate: Math.floor(config.baseDepartureRate || 8),
      departureRates: config.departureRates || null,
      inflowGlobalCap: Math.max(0, Math.floor(config.inflowGlobalCap ?? 60)),
      boundaryInflowProfiles: config.boundaryInflowProfiles || null,
      debug: {
        enabled: Boolean(config.debug?.enabled),
        sampleInterval: Math.max(1, Math.floor(config.debug?.sampleInterval || 5)),
      },
      seed: config.seed ?? 2,
    };
    this.currentTime = 0;
    this.isComplete = false;
    this.fixedState = null;
    this.greedyState = null;
    this.intentRegistry = null;
    this.routeHistory = null;   // carId -> [roadSegmentKey, ...]
    this.boundaryArrivals = []; // pre-generated per step
    this.arrivalRateSeriesByKey = {};
    this.boundaryKeys = [];
    this.boundaryKeyLabels = {};
    this.plannedBoundaryArrivalsTotalSeries = [];
    this.plannedBoundaryArrivalsByApproachSeries = { N: [], S: [], E: [], W: [] };
    this.globalMetrics = null;
  }

  shouldDebugLog(t) {
    const dbg = this.config.debug;
    return Boolean(dbg?.enabled) && (t % Math.max(1, dbg.sampleInterval) === 0);
  }

  debugLog(t, message, payload) {
    if (!this.shouldDebugLog(t)) return;
    if (payload === undefined) {
      console.log(`[SimDebug t=${t}] ${message}`);
      return;
    }
    console.log(`[SimDebug t=${t}] ${message}`, payload);
  }

  boundaryKey(row, col, approach) {
    return `${row},${col},${approach}`;
  }

  evaluateBoundaryRate(profile, t, rngState, lookupCache) {
    if (!profile) return 0;
    const cap = Math.max(0, this.config.inflowGlobalCap ?? 60);
    if (profile.mode === 'function') {
      return evaluateArrivalAt({
        ...(profile.functionConfig || {}),
        maxCap: cap,
      }, t, () => rngState.random(), lookupCache);
    }
    // Distribution mode is handled via pre-built series in arrivalRateSeriesByKey,
    // so this branch should not normally be reached for distribution profiles.
    // But handle it gracefully just in case:
    if (profile.mode === 'distribution') {
      return 0; // series is pre-built
    }
    const constVal = Number.isFinite(Number(profile.constantValue)) ? Math.floor(Number(profile.constantValue)) : 0;
    return Math.min(cap, Math.max(0, constVal));
  }

  init() {
    const cfg = this.config;
    resetCarId();
    this.currentTime = 0;
    this.isComplete = false;
    this.intentRegistry = new IntentRegistry();
    this.routeHistory = new Map();
    this.greedyDecisionData = {};  // "r,c" -> latest decision reasoning

    const boundaryRoadProps = buildBoundaryRoadProps(cfg.gridSize, cfg);
    const cfgWithBndProps = { ...cfg, boundaryRoadProps };

    const fixedRoad = buildRoadData(cfg.gridSize, cfg);
    const greedyRoad = buildRoadData(cfg.gridSize, cfg);

    this.fixedState = {
      grid: buildGrid(cfg.gridSize, cfgWithBndProps),
      transitQueues: fixedRoad.transitQueues,
      roadProps: fixedRoad.roadProps,
      boundaryRoadProps,
      rng: new PolicyRng(String(cfg.seed) + '_fixed'),
      policy: 'fixed',
    };
    this.greedyState = {
      grid: buildGrid(cfg.gridSize, cfgWithBndProps),
      transitQueues: greedyRoad.transitQueues,
      roadProps: greedyRoad.roadProps,
      boundaryRoadProps,
      rng: new PolicyRng(String(cfg.seed) + '_greedy'),
      policy: 'greedy',
    };
    // Greedy phases are now selected at end-of-step decision times.
    // Seed an initial phase so step 0 can serve vehicles before the first decision.
    for (let r = 0; r < cfg.gridSize; r++) {
      for (let c = 0; c < cfg.gridSize; c++) {
        this.greedyState.grid[r][c].currentPhase = PHASE_NAMES[0];
      }
    }

    // Pre-generate boundary arrivals (deterministic, shared car IDs,
    // intent sampled from boundary road turn probs using a shared RNG).
    const genRng = new PolicyRng(cfg.seed);
    this.boundaryArrivals = [];
    this.arrivalRateSeriesByKey = {};
    this.boundaryKeys = [];
    this.boundaryKeyLabels = {};
    this.plannedBoundaryArrivalsTotalSeries = [];
    this.plannedBoundaryArrivalsByApproachSeries = { N: [], S: [], E: [], W: [] };
    const inflowRngByKey = {};
    const inflowLookupByKey = {};

    for (let r = 0; r < cfg.gridSize; r++) {
      for (let c = 0; c < cfg.gridSize; c++) {
        const isBoundary = r === 0 || r === cfg.gridSize - 1 || c === 0 || c === cfg.gridSize - 1;
        if (!isBoundary) continue;
        const dirs = [];
        if (r === 0) dirs.push('N');
        if (r === cfg.gridSize - 1) dirs.push('S');
        if (c === 0) dirs.push('W');
        if (c === cfg.gridSize - 1) dirs.push('E');
        const profileCell = cfg.boundaryInflowProfiles?.[r]?.[c] || {};
        for (const d of dirs) {
          const key = this.boundaryKey(r, c, d);
          const profile = profileCell[d];
          this.arrivalRateSeriesByKey[key] = [];
          this.boundaryKeys.push(key);
          this.boundaryKeyLabels[key] = `(${r},${c}) ${d}`;

          if (profile && profile.mode === 'distribution' && profile.distributionConfig) {
            // Pre-sample entire distribution series at init, capped by inflowGlobalCap
            const cap = Math.max(0, cfg.inflowGlobalCap ?? 60);
            const rawSeries = buildDistributionSeries(
              profile.distributionConfig, cfg.simDuration, cfg.seed, key
            );
            this.arrivalRateSeriesByKey[key] = rawSeries.map(v => Math.min(cap, v));
          } else {
            inflowRngByKey[key] = new PolicyRng(`${cfg.seed}_inflow_${key}`);
            inflowLookupByKey[key] = {};

            for (let t = 0; t < cfg.simDuration; t++) {
              const rate = this.evaluateBoundaryRate(profile, t, inflowRngByKey[key], inflowLookupByKey[key]);
              this.arrivalRateSeriesByKey[key].push(rate);
            }
          }
        }
      }
    }

    this.debugLog(0, 'Initialization config', {
      inflowGlobalCap: cfg.inflowGlobalCap,
      boundaryKeys: this.boundaryKeys.length,
      debug: cfg.debug,
    });

    for (let t = 0; t < cfg.simDuration; t++) {
      const stepArrivals = [];
      const byApproach = { N: 0, S: 0, E: 0, W: 0 };
      const refGrid = this.fixedState.grid;

      for (let r = 0; r < cfg.gridSize; r++) {
        for (let c = 0; c < cfg.gridSize; c++) {
          const inter = refGrid[r][c];
          if (!inter.isBoundary) continue;

          for (const d of inter.boundaryDirs) {
            const key = this.boundaryKey(r, c, d);
            const rate = this.arrivalRateSeriesByKey[key]?.[t] ?? 0;

            const bndKey = `bnd_${d}_${r},${c}`;
            const bndProps = boundaryRoadProps[bndKey];
            const turnT = bndProps?.turnT ?? cfg.defaultTurnProbT;
            const turnR = bndProps?.turnR ?? cfg.defaultTurnProbR;
            const turnL = bndProps?.turnL ?? cfg.defaultTurnProbL;

            for (let i = 0; i < rate; i++) {
              const id = nextCarId();
              const intent = sampleIntent(turnT, turnR, turnL, () => genRng.random());
              stepArrivals.push({
                row: r, col: c, approach: d,
                car: { id, spawnTime: t, intent, enteredQueueAt: t, arrivalApproach: d },
              });
              byApproach[d]++;
            }
          }
        }
      }

      this.plannedBoundaryArrivalsTotalSeries.push(stepArrivals.length);
      for (const d of DIRECTIONS) {
        this.plannedBoundaryArrivalsByApproachSeries[d].push(byApproach[d]);
      }

      this.debugLog(t, 'Planned boundary arrivals', {
        total: stepArrivals.length,
        byApproach,
      });

      this.boundaryArrivals.push(stepArrivals);
    }

    // Per-intersection per-policy time-series metrics storage
    this.perIntersectionMetrics = { fixed: {}, greedy: {} };
    for (let r = 0; r < cfg.gridSize; r++) {
      for (let c = 0; c < cfg.gridSize; c++) {
        const key = `${r},${c}`;
        for (const pol of ['fixed', 'greedy']) {
          this.perIntersectionMetrics[pol][key] = {
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
    }

    this.globalMetrics = {
      fixed: {
        throughput: 0,
        totalVehiclesEntered: 0,
        throughputTimeSeries: [],
        enteredTimeSeries: [],
        vehiclesInNetwork: [],
        sumQueueSizes: [],
        sumAvgWaitTimes: [],
        sumTotalWaitTimes: [],
        sumStdTotalWaitTimes: [],
        realizedBoundaryArrivalsTotalSeries: [],
        realizedBoundaryArrivalsByApproachSeries: { N: [], S: [], E: [], W: [] },
        realizedBoundaryArrivalsByKeySeries: this.boundaryKeys.reduce((acc, key) => ({ ...acc, [key]: [] }), {}),
      },
      greedy: {
        throughput: 0,
        totalVehiclesEntered: 0,
        throughputTimeSeries: [],
        enteredTimeSeries: [],
        vehiclesInNetwork: [],
        sumQueueSizes: [],
        sumAvgWaitTimes: [],
        sumTotalWaitTimes: [],
        sumStdTotalWaitTimes: [],
        realizedBoundaryArrivalsTotalSeries: [],
        realizedBoundaryArrivalsByApproachSeries: { N: [], S: [], E: [], W: [] },
        realizedBoundaryArrivalsByKeySeries: this.boundaryKeys.reduce((acc, key) => ({ ...acc, [key]: [] }), {}),
      },
    };
  }

  // =====================================================
  // FREE LEFT TURN PROCESSING
  // Process free-left cars from all queues (every time step, any phase)
  // =====================================================
  processFreeLefts(state, t) {
    const cfg = this.config;
    const { grid, transitQueues, roadProps, rng: policyRng } = state;
    const gridSize = cfg.gridSize;

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const inter = grid[r][c];
        for (const approach of DIRECTIONS) {
          const queue = inter.queues[approach];
          const maxLeave = inter.departureRate[approach] || 1;
          let leftCount = 0;
          const remaining = [];

          for (const car of queue) {
            if (car.intent === 'L' && leftCount < maxLeave) {
              leftCount++;
              const exitDir = LEFT_EXIT[approach];
              this.routeCar(state, r, c, car, approach, exitDir, t);
            } else {
              remaining.push(car);
            }
          }
          inter.queues[approach] = remaining;
        }
      }
    }
  }

  // =====================================================
  // ROUTE CAR: from intersection to transit or boundary exit
  // =====================================================
  routeCar(state, r, c, car, approach, exitDir, t) {
    const cfg = this.config;
    const { grid, transitQueues, roadProps, rng: policyRng } = state;
    const gridSize = cfg.gridSize;
    const [dr, dc] = EXIT_TO_NEIGHBOR_DELTA[exitDir];
    const nr = r + dr;
    const nc = c + dc;

    if (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize) {
      // Internal road - enter transit queue
      const roadKey = `${r},${c}->${nr},${nc}`;
      const rp = roadProps[roadKey];
      const travelTime = rp?.travelTime ?? Math.max(1, Math.round((cfg.defaultRoadLength || 12) / (cfg.defaultRoadSpeed || 2)));

      // Sample new intent for next intersection - or mirror from registry
      const nextApproach = ARRIVAL_APPROACH[exitDir];
      let newIntent;
      if (this.intentRegistry.has(car.id, nr, nc)) {
        newIntent = this.intentRegistry.get(car.id, nr, nc);
      } else {
        newIntent = sampleIntent(rp.turnT, rp.turnR, rp.turnL, () => policyRng.random());
        this.intentRegistry.set(car.id, nr, nc, newIntent);
      }

      const transitCar = {
        id: car.id,
        spawnTime: car.spawnTime,
        intent: newIntent,
        arrivalApproach: nextApproach,
        transitCountdown: travelTime,
        enteredQueueAt: -1, // will be set when arriving at queue
      };
      transitQueues[roadKey].push(transitCar);

      this.debugLog(t, `${state.policy}: vehicle routed to transit`, {
        carId: car.id,
        from: `${r},${c}`,
        to: `${nr},${nc}`,
        approach,
        exitDir,
        nextApproach,
        nextIntent: newIntent,
        travelTime,
      });

      // Record route history
      if (!this.routeHistory.has(car.id)) this.routeHistory.set(car.id, []);
      this.routeHistory.get(car.id).push(roadKey);
    } else {
      // Boundary exit - car leaves network immediately
      const pKey = `${r},${c}`;
      const pol = state.policy;
      this.perIntersectionMetrics[pol][pKey].vehiclesExited++;
      this.debugLog(t, `${state.policy}: vehicle exited network`, {
        carId: car.id,
        at: pKey,
        approach,
        exitDir,
      });
    }
  }

  // =====================================================
  // STEP ONE POLICY STATE
  // =====================================================
  stepState(state, t) {
    const cfg = this.config;
    const { grid, transitQueues, roadProps, rng: policyRng, policy } = state;
    const gridSize = cfg.gridSize;
    const queueTotalsBefore = { N: 0, S: 0, E: 0, W: 0 };

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const inter = grid[r][c];
        for (const d of DIRECTIONS) {
          queueTotalsBefore[d] += inter.queues[d].length;
        }
      }
    }

    this.debugLog(t, `${policy}: step start queue snapshot`, queueTotalsBefore);

    // -------------------------------------------------------
    // STEP 1: Decrement transit countdowns.
    //         Move cars with countdown=0 to waiting queues.
    // -------------------------------------------------------
    for (const [roadKey, cars] of Object.entries(transitQueues)) {
      const remaining = [];
      for (const car of cars) {
        car.transitCountdown--;
        if (car.transitCountdown <= 0) {
          // Parse destination from roadKey "r1,c1->r2,c2"
          const parts = roadKey.split('->');
          const [dr, dc] = parts[1].split(',').map(Number);
          const destInter = grid[dr][dc];
          const approach = car.arrivalApproach;

          // If intent is L, route immediately as free-left
          if (car.intent === 'L') {
            // Set enteredQueueAt for tracking even though it doesn't really queue
            car.enteredQueueAt = t;
            this.routeCar(state, dr, dc, car, approach, LEFT_EXIT[approach], t);
          } else {
            car.enteredQueueAt = t;
            destInter.queues[approach].push(car);
          }
        } else {
          remaining.push(car);
        }
      }
      transitQueues[roadKey] = remaining;
    }

    // -------------------------------------------------------
    // STEP 2: Add boundary arrivals (direct to waiting queue)
    // -------------------------------------------------------
    const arrivals = this.boundaryArrivals[t];
    const realizedByApproach = { N: 0, S: 0, E: 0, W: 0 };
    const realizedByKey = this.boundaryKeys.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    if (arrivals) {
      for (const { row, col, approach, car: template } of arrivals) {
        const car = {
          id: template.id,
          spawnTime: template.spawnTime,
          intent: template.intent,
          enteredQueueAt: t,
          arrivalApproach: approach,
        };
        if (car.intent === 'L') {
          this.routeCar(state, row, col, car, approach, LEFT_EXIT[approach], t);
        } else {
          grid[row][col].queues[approach].push(car);
        }
        realizedByApproach[approach]++;
        const key = this.boundaryKey(row, col, approach);
        if (Object.prototype.hasOwnProperty.call(realizedByKey, key)) {
          realizedByKey[key]++;
        }
      }
    }
    const realizedTotal = DIRECTIONS.reduce((s, d) => s + realizedByApproach[d], 0);
    this.globalMetrics[policy].realizedBoundaryArrivalsTotalSeries.push(realizedTotal);
    for (const d of DIRECTIONS) {
      this.globalMetrics[policy].realizedBoundaryArrivalsByApproachSeries[d].push(realizedByApproach[d]);
    }
    for (const key of this.boundaryKeys) {
      this.globalMetrics[policy].realizedBoundaryArrivalsByKeySeries[key].push(realizedByKey[key] || 0);
    }

    this.debugLog(t, `${policy}: realized boundary arrivals`, {
      total: realizedTotal,
      byApproach: realizedByApproach,
      byKey: realizedByKey,
    });

    // -------------------------------------------------------
    // STEP 3: Process free-left turns (every step, all queues)
    // -------------------------------------------------------
    this.processFreeLefts(state, t);

    // -------------------------------------------------------
    // STEP 4: Signal phase decisions (fixed policy only, pre-service)
    // Greedy decisions are taken at end-of-step so they use end state.
    // -------------------------------------------------------
    const policyInterval = policy === 'fixed' ? cfg.fixedCycleInterval : cfg.greedyDecisionInterval;
    if (policy === 'fixed' && t % policyInterval === 0) {
      for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
          const inter = grid[r][c];
          const pKey = `${r},${c}`;
          inter.currentPhase = FIXED_CYCLE[inter.phaseIdx % FIXED_CYCLE.length];
          inter.phaseIdx++;

          this.debugLog(t, `${policy}: signal phase update @${pKey}`, {
            phase: inter.currentPhase,
            interval: policyInterval,
          });

          this.perIntersectionMetrics[policy][pKey].phaseTimeline.push(inter.currentPhase);
          this.perIntersectionMetrics[policy][pKey].decisionTimes.push(t);
        }
      }
    }

    // Ensure greedy always has an active phase before service.
    if (policy === 'greedy') {
      for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
          if (!grid[r][c].currentPhase) {
            grid[r][c].currentPhase = PHASE_NAMES[0];
          }
        }
      }
    }

    // -------------------------------------------------------
    // STEP 5: Apply current phase - serve matching-intent cars
    //         Scan whole queue (not strict FIFO)
    // -------------------------------------------------------
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const inter = grid[r][c];
        if (!inter.currentPhase) continue;

        const phase = PHASES[inter.currentPhase];
        if (!phase) continue;

        // Build allowed set: { approach -> Set of movements }
        const allowed = {};
        for (const [approach, movement] of phase) {
          if (!allowed[approach]) allowed[approach] = new Set();
          allowed[approach].add(movement);
        }

        for (const approach of DIRECTIONS) {
          if (!allowed[approach]) continue;
          const capacity = inter.departureRate[approach] || 1;
          let served = 0;
          const remaining = [];

          for (const car of inter.queues[approach]) {
            if (served < capacity && allowed[approach].has(car.intent)) {
              served++;
              const exitDir = car.intent === 'T' ? THROUGH_EXIT[approach] : RIGHT_EXIT[approach];
              this.routeCar(state, r, c, car, approach, exitDir, t);
              const pKey = `${r},${c}`;
              this.perIntersectionMetrics[policy][pKey].vehiclesServed++;
              this.debugLog(t, `${policy}: vehicle served @${pKey}`, {
                carId: car.id,
                approach,
                intent: car.intent,
                exitDir,
                phase: inter.currentPhase,
              });
            } else {
              remaining.push(car);
            }
          }
          inter.queues[approach] = remaining;
        }
      }
    }

    // -------------------------------------------------------
    // STEP 5.5: Greedy phase decisions (end-of-step state)
    // Decision at time t now uses the post-service state at t,
    // then applies selected phase from step t+1 onward.
    // -------------------------------------------------------
    if (policy === 'greedy' && t % policyInterval === 0) {
      for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
          const inter = grid[r][c];
          const pKey = `${r},${c}`;
          inter.currentPhase = this.greedySelectPhase(state, r, c, t);

          this.debugLog(t, `${policy}: signal phase update @${pKey}`, {
            phase: inter.currentPhase,
            interval: policyInterval,
            decisionState: 'end-of-step',
          });

          this.perIntersectionMetrics[policy][pKey].phaseTimeline.push(inter.currentPhase);
          this.perIntersectionMetrics[policy][pKey].decisionTimes.push(t);
        }
      }
    }

    // -------------------------------------------------------
    // STEP 6: Record per-intersection metrics
    // -------------------------------------------------------
    let sumQueueSize = 0;
    let sumAvgWait = 0;
    let sumTotalWait = 0;
    let sumStdTotalWait = 0;
    let totalVehiclesInQueues = 0;
    let totalVehiclesInTransit = 0;

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const inter = grid[r][c];
        const pKey = `${r},${c}`;
        const m = this.perIntersectionMetrics[policy][pKey];

        const avgWaits = [];
        const totalWaits = [];
        for (const d of DIRECTIONS) {
          const q = inter.queues[d];
          m.queueLengths[d].push(q.length);
          totalVehiclesInQueues += q.length;

          // Waiting metrics for this queue
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
        m.stdQueueSizes.push(pstdev(DIRECTIONS.map(d => inter.queues[d].length)));
      }
    }

    // Count vehicles in transit
    for (const cars of Object.values(transitQueues)) {
      totalVehiclesInTransit += cars.length;
    }

    const queueTotalsAfter = { N: 0, S: 0, E: 0, W: 0 };
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const inter = grid[r][c];
        for (const d of DIRECTIONS) {
          queueTotalsAfter[d] += inter.queues[d].length;
        }
      }
    }

    this.debugLog(t, `${policy}: step end aggregate`, {
      queueBefore: queueTotalsBefore,
      queueAfter: queueTotalsAfter,
      totalVehiclesInQueues,
      totalVehiclesInTransit,
      vehiclesInNetwork: totalVehiclesInQueues + totalVehiclesInTransit,
      sumQueueSize,
      sumAvgWait,
      sumTotalWait,
      sumStdTotalWait,
    });

    return {
      totalVehiclesInQueues,
      totalVehiclesInTransit,
      vehiclesInNetwork: totalVehiclesInQueues + totalVehiclesInTransit,
      sumQueueSize,
      sumAvgWait,
      sumTotalWait,
      sumStdTotalWait,
    };
  }

  // =====================================================
  // GREEDY LOOKAHEAD PHASE SELECTION
  // Deep-copies all data, never mutates originals.
  // =====================================================
  greedySelectPhase(state, r, c, t) {
    const cfg = this.config;
    const { grid, transitQueues, rng: policyRng } = state;
    const gridSize = cfg.gridSize;
    const inter = grid[r][c];

    const savedRngState = policyRng.getState();
    let bestScore = Infinity;
    let bestPhase = PHASE_NAMES[0];
    const makeDirMap = () => ({ N: 0, S: 0, E: 0, W: 0 });
    const makeIntentMap = () => ({
      N: { T: 0, R: 0, L: 0 },
      S: { T: 0, R: 0, L: 0 },
      E: { T: 0, R: 0, L: 0 },
      W: { T: 0, R: 0, L: 0 },
    });

    // Capture queue state at decision time (end-of-step state)
    const queuesBefore = {};
    const totalWaitBefore = {};
    for (const d of DIRECTIONS) {
      const q = inter.queues[d];
      queuesBefore[d] = q.length;
      if (q.length > 0) {
        const totalW = q.reduce((s, car) => s + (t - car.enteredQueueAt), 0);
        totalWaitBefore[d] = totalW;
      } else {
        totalWaitBefore[d] = 0;
      }
    }

    const horizonInputs = [];
    for (let h = 1; h <= cfg.lookaheadH; h++) {
      const futureT = t + h;
      const boundaryArrivalRates = makeDirMap();
      if (inter.isBoundary) {
        for (const d of inter.boundaryDirs) {
          const key = this.boundaryKey(r, c, d);
          boundaryArrivalRates[d] = this.arrivalRateSeriesByKey[key]?.[futureT] ?? 0;
        }
      }
      horizonInputs.push({
        time: futureT,
        boundaryArrivalRates,
        departureCaps: { ...inter.departureRate },
      });
    }

    // Collect results for all candidate phases
    const candidateResults = [];

    for (const candidatePhase of PHASE_NAMES) {
      policyRng.setState(savedRngState);

      // Deep copy this intersection's queues
      const simQueues = deepCopyQueues(inter.queues);

      // Deep copy transit queues feeding INTO this intersection
      const feedingTransit = {};
      for (const dir of DIRECTIONS) {
        const [dr, dc] = EXIT_TO_NEIGHBOR_DELTA[dir];
        const srcR = r - dr;
        const srcC = c - dc;
        if (srcR >= 0 && srcR < gridSize && srcC >= 0 && srcC < gridSize) {
          const roadKey = `${srcR},${srcC}->${r},${c}`;
          feedingTransit[roadKey] = deepCopyTransitList(transitQueues[roadKey] || []);
        }
      }

      const stepTrace = [];

      // Run lookahead for H steps
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
        for (const d of DIRECTIONS) {
          trace.queueStart[d] = simQueues[d].length;
        }

        // 1. Decrement transit countdowns, move arrivals to simQueues
        for (const [roadKey, cars] of Object.entries(feedingTransit)) {
          const remaining = [];
          for (const car of cars) {
            car.transitCountdown--;
            if (car.transitCountdown <= 0) {
              if (car.intent !== 'L') {
                car.enteredQueueAt = futureT;
                simQueues[car.arrivalApproach].push(car);
                trace.transitToQueue[car.arrivalApproach]++;
              }
              // L cars just removed (routed away in lookahead)
            } else {
              remaining.push(car);
            }
          }
          feedingTransit[roadKey] = remaining;
        }

        // 2. For boundary intersections, add deterministic arrivals
        if (inter.isBoundary) {
          for (const d of inter.boundaryDirs) {
            const key = this.boundaryKey(r, c, d);
            const rate = this.arrivalRateSeriesByKey[key]?.[futureT] ?? 0;
            const btp = inter.boundaryTurnProbs[d];
            for (let i = 0; i < rate; i++) {
              const intent = sampleIntent(btp.T, btp.R, btp.L, () => policyRng.random());
              trace.boundaryArrivalsByIntent[d][intent]++;
              if (intent !== 'L') {
                simQueues[d].push({
                  id: -1, // temp, not real
                  spawnTime: futureT,
                  intent,
                  enteredQueueAt: futureT,
                  arrivalApproach: d,
                });
                trace.boundaryToQueue[d]++;
              }
            }
          }
        }

        // 3. Process free lefts in simQueues (remove them)
        for (const approach of DIRECTIONS) {
          const maxLeave = inter.departureRate[approach] || 1;
          let leftCount = 0;
          const remaining = [];
          for (const car of simQueues[approach]) {
            if (car.intent === 'L' && leftCount < maxLeave) {
              leftCount++;
              trace.freeLeftDepartures[approach]++;
              // removed from queue
            } else {
              remaining.push(car);
            }
          }
          simQueues[approach] = remaining;
        }

        // 4. Apply candidate phase
        const phase = PHASES[candidatePhase];
        if (phase) {
          const allowed = {};
          for (const [approach, movement] of phase) {
            if (!allowed[approach]) allowed[approach] = new Set();
            allowed[approach].add(movement);
          }

          for (const approach of DIRECTIONS) {
            if (!allowed[approach]) continue;
            const capacity = inter.departureRate[approach] || 1;
            let served = 0;
            const remaining = [];
            for (const car of simQueues[approach]) {
              if (served < capacity && allowed[approach].has(car.intent)) {
                served++;
                trace.phaseDepartures[approach]++;
                // removed from queue (local only, don't push to neighbors)
              } else {
                remaining.push(car);
              }
            }
            simQueues[approach] = remaining;
          }
        }

        for (const d of DIRECTIONS) {
          trace.queueEnd[d] = simQueues[d].length;
        }
        stepTrace.push(trace);
      }

      // Compute objective:
      //   score = w1*sum(totalWait) + w2*stdev(totalWait) + w3*sum(qLen) + w4*stdev(qLen)
      const totalWaits = [];
      const qLens = [];
      const queuesAfter = {};
      const totalWaitAfter = {};
      const futureT = t + cfg.lookaheadH;
      for (const d of DIRECTIONS) {
        const q = simQueues[d];
        qLens.push(q.length);
        queuesAfter[d] = q.length;
        if (q.length > 0) {
          const totalW = q.reduce((s, car) => s + (futureT - car.enteredQueueAt), 0);
          totalWaits.push(totalW);
          totalWaitAfter[d] = totalW;
        } else {
          totalWaits.push(0);
          totalWaitAfter[d] = 0;
        }
      }
      const sumTotalWait = totalWaits.reduce((a, b) => a + b, 0);
      const stdTotalWait = pstdev(totalWaits);
      const sumQ = qLens.reduce((a, b) => a + b, 0);
      const stdQ = pstdev(qLens);
      const termTotalWait = cfg.totalWaitWeight * sumTotalWait;
      const termStdTotalWait = cfg.totalWaitStdWeight * stdTotalWait;
      const termSumQ = cfg.queueWeight * sumQ;
      const termStdQ = cfg.queueStdWeight * stdQ;
      const score = termTotalWait + termStdTotalWait + termSumQ + termStdQ;

      candidateResults.push({
        phase: candidatePhase,
        queuesAfter,
        totalWaitAfter,
        sumTotalWait,
        stdTotalWait,
        sumQ,
        stdQ,
        totalScore: score,
        stepTrace,
        costTerms: {
          termTotalWait,
          termStdTotalWait,
          termSumQ,
          termStdQ,
        },
      });

      if (score < bestScore) {
        bestScore = score;
        bestPhase = candidatePhase;
      }
    }

    // Mark the best candidate
    for (const cr of candidateResults) {
      cr.isBest = (cr.phase === bestPhase);
    }

    // Store decision reasoning data for transparency UI
    const pKey = `${r},${c}`;
    this.greedyDecisionData[pKey] = {
      time: t,
      queuesBefore,
      totalWaitBefore,
      departureRates: { ...inter.departureRate },
      horizonInputs,
      candidateResults,
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

    this.debugLog(t, `greedy: decision summary @${pKey}`, {
      bestPhase,
      bestScore,
      queuesBefore,
      totalWaitBefore,
      candidates: candidateResults.map((cr) => ({
        phase: cr.phase,
        score: cr.totalScore,
        isBest: cr.isBest,
      })),
    });

    policyRng.setState(savedRngState);
    return bestPhase;
  }

  // =====================================================
  // STEP BOTH POLICIES (lockstep)
  // =====================================================
  step() {
    if (this.isComplete) return null;
    const t = this.currentTime;

    const fixedResult = this.stepState(this.fixedState, t);
    const greedyResult = this.stepState(this.greedyState, t);

    // Update global metrics
    const totalEnteredSoFar = this.boundaryArrivals
      .slice(0, t + 1)
      .reduce((sum, step) => sum + step.length, 0);

    for (const [pol, state, result] of [
      ['fixed', this.fixedState, fixedResult],
      ['greedy', this.greedyState, greedyResult],
    ]) {
      const gm = this.globalMetrics[pol];
      gm.totalVehiclesEntered = totalEnteredSoFar;
      gm.enteredTimeSeries.push(totalEnteredSoFar);
      gm.vehiclesInNetwork.push(result.vehiclesInNetwork);
      gm.sumQueueSizes.push(result.sumQueueSize);
      gm.sumAvgWaitTimes.push(result.sumAvgWait);
      gm.sumTotalWaitTimes.push(result.sumTotalWait);
      gm.sumStdTotalWaitTimes.push(result.sumStdTotalWait);

      // Throughput = total exited across all intersections
      let totalExited = 0;
      const gridSize = this.config.gridSize;
      for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
          const pKey = `${r},${c}`;
          totalExited += this.perIntersectionMetrics[pol][pKey].vehiclesExited;
        }
      }
      gm.throughput = totalExited;
      gm.throughputTimeSeries.push(totalExited);

      this.debugLog(t, `${pol}: global metrics`, {
        totalVehiclesEntered: gm.totalVehiclesEntered,
        throughput: gm.throughput,
        vehiclesInNetwork: result.vehiclesInNetwork,
        sumQueueSize: result.sumQueueSize,
        sumAvgWait: result.sumAvgWait,
        sumTotalWait: result.sumTotalWait,
        sumStdTotalWait: result.sumStdTotalWait,
      });
    }

    this.currentTime++;
    if (this.currentTime >= this.config.simDuration) {
      this.isComplete = true;
    }

    return this.getSnapshot();
  }

  // =====================================================
  // SNAPSHOT FOR UI
  // =====================================================
  getSnapshot() {
    const cfg = this.config;
    const gridSize = cfg.gridSize;

    const makeGridSnapshot = (state) => {
      const snapshot = [];
      for (let r = 0; r < gridSize; r++) {
        const row = [];
        for (let c = 0; c < gridSize; c++) {
          const inter = state.grid[r][c];
          row.push({
            row: r, col: c,
            queueLengths: {
              N: inter.queues.N.length,
              S: inter.queues.S.length,
              E: inter.queues.E.length,
              W: inter.queues.W.length,
            },
            totalQueued: DIRECTIONS.reduce((s, d) => s + inter.queues[d].length, 0),
            currentPhase: inter.currentPhase,
            vehiclesServed: this.perIntersectionMetrics[state.policy][`${r},${c}`].vehiclesServed,
            vehiclesExited: this.perIntersectionMetrics[state.policy][`${r},${c}`].vehiclesExited,
          });
        }
        snapshot.push(row);
      }
      return snapshot;
    };

    const makeRoadSnapshot = (state) => {
      const roads = {};
      for (const [key, cars] of Object.entries(state.transitQueues)) {
        if (cars.length > 0) roads[key] = cars.length;
      }
      return roads;
    };

    return {
      time: this.currentTime,
      isComplete: this.isComplete,
      gridSize: gridSize,
      fixed: {
        grid: makeGridSnapshot(this.fixedState),
        roads: makeRoadSnapshot(this.fixedState),
        throughput: this.globalMetrics.fixed.throughput,
        totalVehiclesEntered: this.globalMetrics.fixed.totalVehiclesEntered,
        throughputTimeSeries: this.globalMetrics.fixed.throughputTimeSeries,
        enteredTimeSeries: this.globalMetrics.fixed.enteredTimeSeries,
        vehiclesInNetwork: this.globalMetrics.fixed.vehiclesInNetwork,
        sumQueueSizes: this.globalMetrics.fixed.sumQueueSizes,
        sumAvgWaitTimes: this.globalMetrics.fixed.sumAvgWaitTimes,
        sumTotalWaitTimes: this.globalMetrics.fixed.sumTotalWaitTimes,
        sumStdTotalWaitTimes: this.globalMetrics.fixed.sumStdTotalWaitTimes,
      },
      greedy: {
        grid: makeGridSnapshot(this.greedyState),
        roads: makeRoadSnapshot(this.greedyState),
        throughput: this.globalMetrics.greedy.throughput,
        totalVehiclesEntered: this.globalMetrics.greedy.totalVehiclesEntered,
        throughputTimeSeries: this.globalMetrics.greedy.throughputTimeSeries,
        enteredTimeSeries: this.globalMetrics.greedy.enteredTimeSeries,
        vehiclesInNetwork: this.globalMetrics.greedy.vehiclesInNetwork,
        sumQueueSizes: this.globalMetrics.greedy.sumQueueSizes,
        sumAvgWaitTimes: this.globalMetrics.greedy.sumAvgWaitTimes,
        sumTotalWaitTimes: this.globalMetrics.greedy.sumTotalWaitTimes,
        sumStdTotalWaitTimes: this.globalMetrics.greedy.sumStdTotalWaitTimes,
      },
      perIntersectionMetrics: this.perIntersectionMetrics,
      roadProps: this.fixedState.roadProps,
      boundaryRoadProps: this.fixedState.boundaryRoadProps,
      greedyDecisionData: this.greedyDecisionData,
      inflowSeries: {
        globalCap: cfg.inflowGlobalCap,
        boundaryKeys: this.boundaryKeys,
        boundaryKeyLabels: this.boundaryKeyLabels,
        plannedRateSeriesByKey: this.arrivalRateSeriesByKey,
        plannedBoundaryArrivalsTotalSeries: this.plannedBoundaryArrivalsTotalSeries,
        plannedBoundaryArrivalsByApproachSeries: this.plannedBoundaryArrivalsByApproachSeries,
        realizedBoundaryArrivals: {
          fixed: {
            totalSeries: this.globalMetrics.fixed.realizedBoundaryArrivalsTotalSeries,
            byApproachSeries: this.globalMetrics.fixed.realizedBoundaryArrivalsByApproachSeries,
            byKeySeries: this.globalMetrics.fixed.realizedBoundaryArrivalsByKeySeries,
          },
          greedy: {
            totalSeries: this.globalMetrics.greedy.realizedBoundaryArrivalsTotalSeries,
            byApproachSeries: this.globalMetrics.greedy.realizedBoundaryArrivalsByApproachSeries,
            byKeySeries: this.globalMetrics.greedy.realizedBoundaryArrivalsByKeySeries,
          },
        },
      },
    };
  }
}
