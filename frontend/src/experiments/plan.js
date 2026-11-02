// =====================================================
// EXTRACT DETAILS: WHAT TO RUN
// A batch of simulations that vary the traffic put into the network:
// how much (level), how it changes over time (pattern), how cars turn,
// and the random seed. Each run simulates Fixed cycle and Greedy on
// exactly the same traffic.
// =====================================================
import { makeDefaultDistributionConfig, makeDefaultFunctionConfig } from '../simulation/arrivalProfile.js';

export const LEVELS = [
  { key: 'light', label: 'Light', scale: 0.5 },
  { key: 'normal', label: 'Normal', scale: 1 },
  { key: 'busy', label: 'Busy', scale: 1.5 },
  { key: 'heavy', label: 'Heavy', scale: 2 },
];

export const PATTERNS = [
  { key: 'steady', label: 'Steady', description: 'the same flow throughout' },
  { key: 'rush', label: 'Rush hour', description: 'quiet, then a peak at twice the average, then quiet again' },
  { key: 'waves', label: 'Waves', description: 'flow rising and falling three times' },
  { key: 'random', label: 'Random', description: 'random arrivals around the average (Poisson)' },
];

export const TURN_MIXES = [
  { key: 'current', label: 'Your ratios', probs: null },
  { key: 'straight', label: 'Mostly straight', probs: { T: 0.8, R: 0.1, L: 0.1 } },
  { key: 'turns', label: 'Many turns', probs: { T: 0.5, R: 0.25, L: 0.25 } },
];

export const SEED_COUNTS = [1, 3, 5];

// How busy the pattern is at step t, relative to its average (mean 1).
export function patternShape(pattern, t, duration) {
  const third = duration / 3;
  if (pattern === 'rush') return t < third ? 0.5 : t < 2 * third ? 2 : 0.5;
  if (pattern === 'waves') return 1 + 0.8 * Math.sin((2 * Math.PI * t) / third);
  return 1;
}

// Inflow profile averaging `mean` cars per step over `duration` steps.
// Cars are whole numbers, so the running total is rounded step by step:
// over the run exactly the intended number of cars arrive.
export function makePatternProfile(pattern, mean, duration, seed = 1) {
  if (pattern === 'random') {
    const base = makeDefaultDistributionConfig();
    return {
      mode: 'distribution',
      constantValue: 0,
      functionConfig: makeDefaultFunctionConfig(),
      distributionConfig: { ...base, distributionType: 'poisson', seed, params: { ...base.params, lambda: Math.max(0, mean) } },
    };
  }
  const sequence = [];
  let total = 0;
  let sent = 0;
  for (let t = 0; t < duration; t++) {
    total += Math.max(0, mean * patternShape(pattern, t, duration));
    const now = Math.floor(total + 1e-9);
    sequence.push(now - sent);
    sent = now;
  }
  return {
    mode: 'function',
    constantValue: 0,
    functionConfig: { ...makeDefaultFunctionConfig(), profileType: 'sequence', sequence },
  };
}

/**
 * Every combination of the chosen options, each with `seeds` seeds.
 * The first seed of each scenario keeps its curves over time (for charts).
 */
export function buildRuns({ levels, patterns, turnMixes, seeds, baseSeed = 1 }) {
  const runs = [];
  for (const level of LEVELS.filter((x) => levels.includes(x.key))) {
    for (const pattern of PATTERNS.filter((x) => patterns.includes(x.key))) {
      for (const turn of TURN_MIXES.filter((x) => turnMixes.includes(x.key))) {
        for (let k = 0; k < seeds; k++) {
          runs.push({
            index: runs.length,
            scenario: `${level.key}|${pattern.key}|${turn.key}`,
            level: level.key,
            scale: level.scale,
            pattern: pattern.key,
            turn: turn.key,
            turnProbs: turn.probs,
            seed: Number(baseSeed) + k,
            keepSeries: k === 0,
          });
        }
      }
    }
  }
  return runs;
}

export const labelOf = {
  level: (key) => LEVELS.find((x) => x.key === key)?.label || key,
  pattern: (key) => PATTERNS.find((x) => x.key === key)?.label || key,
  turn: (key) => TURN_MIXES.find((x) => x.key === key)?.label || key,
};
