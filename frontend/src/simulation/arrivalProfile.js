import seedrandom from 'seedrandom';

export const ARRIVAL_PROFILE_TYPES = [
  { value: 'constant', label: 'Constant', description: 'Same integer inflow at every time step.', wikiUrl: 'https://en.wikipedia.org/wiki/Constant_function' },
  { value: 'step', label: 'Step Function', description: 'Low value before a start time, high value after it.', wikiUrl: 'https://en.wikipedia.org/wiki/Step_function' },
  { value: 'piecewiseLinear', label: 'Piecewise Linear', description: 'User-defined integer segments with linear interpolation.', wikiUrl: 'https://en.wikipedia.org/wiki/Piecewise_linear_function' },
  { value: 'triangular', label: 'Triangular Wave', description: 'Repeating up-and-down ramp between min and max.', wikiUrl: 'https://en.wikipedia.org/wiki/Triangle_wave' },
  { value: 'square', label: 'Square Wave', description: 'Alternates between high and low values each half period.', wikiUrl: 'https://en.wikipedia.org/wiki/Square_wave' },
  { value: 'sawtooth', label: 'Sawtooth Ramp', description: 'Ramps up and resets periodically.', wikiUrl: 'https://en.wikipedia.org/wiki/Sawtooth_wave' },
  { value: 'pulseTrain', label: 'Pulse Train', description: 'Short bursts every fixed interval.', wikiUrl: 'https://en.wikipedia.org/wiki/Pulse_wave' },
  { value: 'exponentialLookup', label: 'Exponential Decay', description: 'Deterministic decay toward a floor.', wikiUrl: 'https://en.wikipedia.org/wiki/Exponential_decay' },
  { value: 'logisticLookup', label: 'Logistic-like Growth', description: 'Deterministic S-shaped growth.', wikiUrl: 'https://en.wikipedia.org/wiki/Logistic_function' },
  { value: 'cycle7', label: '7-Step Weekly Cycle', description: 'Seven explicit integer values repeated in order.', wikiUrl: 'https://en.wikipedia.org/wiki/Periodic_function' },
  { value: 'randomSeeded', label: 'Random with Seed', description: 'Seeded deterministic random integer in [min, max].', wikiUrl: 'https://en.wikipedia.org/wiki/Discrete_uniform_distribution' },
  { value: 'sinCos', label: 'Sine + Cosine', description: 'offset + A*sin(.) + B*cos(.), floored at integer timesteps.', wikiUrl: 'https://en.wikipedia.org/wiki/Trigonometric_functions' },
];

export function makeDefaultFunctionConfig() {
  return {
    profileType: 'step',
    params: {
      constantValue: 3,
      stepStart: 30,
      stepLow: 2,
      stepHigh: 8,
      triangleMin: 1,
      triangleMax: 9,
      trianglePeriod: 24,
      squareLow: 2,
      squareHigh: 10,
      squarePeriod: 20,
      sawMin: 0,
      sawMax: 12,
      sawPeriod: 24,
      pulseBase: 1,
      pulsePeak: 12,
      pulseEvery: 16,
      pulseWidth: 3,
      expStart: 16,
      expFloor: 2,
      expDecayEvery: 8,
      expDecayStep: 1,
      logisticMin: 0,
      logisticMax: 16,
      logisticMid: 40,
      logisticSlope: 8,
      cycleValues: [2, 2, 4, 5, 7, 6, 3],
      randomMin: 0,
      randomMax: 10,
      randomSeedOffset: 101,
      sinCosMode: 'period',
      sinCosPhaseUnit: 'rad',
      sinCosOffset: 4,
      sinCosA: 2,
      sinCosB: 1,
      sinCosPeriod: 24,
      sinCosOmega: 0.261799,
      sinCosPhi: 0,
      sinCosPsi: 0,
    },
    piecewiseSegments: [
      { start: 0, end: 25, fromValue: 2, toValue: 2 },
      { start: 26, end: 60, fromValue: 2, toValue: 8 },
    ],
  };
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toRadians(value, phaseUnit) {
  const v = toNum(value, 0);
  if (phaseUnit === 'deg') return (Math.PI * v) / 180;
  return v;
}

function getOmega(params, modeKey, periodKey, omegaKey) {
  const mode = params?.[modeKey] || 'period';
  if (mode === 'omega') {
    return Math.max(0, toNum(params?.[omegaKey], 0));
  }
  const period = Math.max(1, toNum(params?.[periodKey], 1));
  return (2 * Math.PI) / period;
}

function evaluateSinCos(params, t) {
  const phaseUnit = params.sinCosPhaseUnit || 'rad';
  const omega = getOmega(params, 'sinCosMode', 'sinCosPeriod', 'sinCosOmega');
  const a = Math.max(0, toNum(params.sinCosA, 0));
  const b = Math.max(0, toNum(params.sinCosB, 0));
  const phi = toRadians(params.sinCosPhi, phaseUnit);
  const psi = toRadians(params.sinCosPsi, phaseUnit);
  const userOffset = toNum(params.sinCosOffset, 0);
  const autoShift = Math.sqrt(a * a + b * b);
  const offset = Math.max(userOffset, autoShift);
  const raw = offset + a * Math.sin(omega * t + phi) + b * Math.cos(omega * t + psi);
  return Math.floor(raw);
}

export function makeConstantInflowProfile(value = 0) {
  return {
    mode: 'constant',
    constantValue: Math.max(0, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0),
    functionConfig: makeDefaultFunctionConfig(),
  };
}

export function makeFunctionInflowProfile() {
  return {
    mode: 'function',
    constantValue: 0,
    functionConfig: makeDefaultFunctionConfig(),
  };
}

function toNonNegativeInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function clampInt(value, minValue, maxValue) {
  return Math.min(maxValue, Math.max(minValue, toNonNegativeInt(value)));
}

function normalizeSegment(segment) {
  const start = toNonNegativeInt(segment.start);
  const end = Math.max(start, toNonNegativeInt(segment.end, start));
  return {
    start,
    end,
    fromValue: toNonNegativeInt(segment.fromValue),
    toValue: toNonNegativeInt(segment.toValue),
  };
}

function evaluatePiecewiseLinear(segments, t) {
  if (!segments || segments.length === 0) return 0;
  const normalized = segments.map(normalizeSegment).sort((a, b) => a.start - b.start);
  const seg = normalized.find((s) => t >= s.start && t <= s.end);
  if (!seg) {
    if (t < normalized[0].start) return normalized[0].fromValue;
    return normalized[normalized.length - 1].toValue;
  }
  const span = Math.max(1, seg.end - seg.start);
  const progress = t - seg.start;
  const delta = seg.toValue - seg.fromValue;
  if (delta >= 0) {
    return seg.fromValue + Math.floor((delta * progress) / span);
  }
  return seg.fromValue - Math.floor((Math.abs(delta) * progress) / span);
}

function evaluateTriangular(params, t) {
  const minV = toNonNegativeInt(params.triangleMin);
  const maxV = Math.max(minV, toNonNegativeInt(params.triangleMax));
  const period = Math.max(2, toNonNegativeInt(params.trianglePeriod, 2));
  const half = Math.max(1, Math.floor(period / 2));
  const phase = t % period;
  const range = maxV - minV;
  if (phase <= half) {
    return minV + Math.floor((range * phase) / half);
  }
  const downPhase = phase - half;
  const downLen = Math.max(1, period - half);
  return maxV - Math.floor((range * downPhase) / downLen);
}

function evaluateSquare(params, t) {
  const low = toNonNegativeInt(params.squareLow);
  const high = Math.max(low, toNonNegativeInt(params.squareHigh));
  const period = Math.max(2, toNonNegativeInt(params.squarePeriod, 2));
  const phase = t % period;
  return phase < Math.floor(period / 2) ? high : low;
}

function evaluateSawtooth(params, t) {
  const minV = toNonNegativeInt(params.sawMin);
  const maxV = Math.max(minV, toNonNegativeInt(params.sawMax));
  const period = Math.max(2, toNonNegativeInt(params.sawPeriod, 2));
  const phase = t % period;
  const range = maxV - minV;
  return minV + Math.floor((range * phase) / (period - 1));
}

function evaluatePulseTrain(params, t) {
  const base = toNonNegativeInt(params.pulseBase);
  const peak = Math.max(base, toNonNegativeInt(params.pulsePeak));
  const every = Math.max(1, toNonNegativeInt(params.pulseEvery, 1));
  const width = Math.max(1, toNonNegativeInt(params.pulseWidth, 1));
  return (t % every) < width ? peak : base;
}

function buildLookupSeries(length, generator) {
  const out = [];
  for (let t = 0; t < length; t++) {
    out.push(toNonNegativeInt(generator(t)));
  }
  return out;
}

function buildExponentialLookup(length, params) {
  const start = toNonNegativeInt(params.expStart);
  const floorV = Math.min(start, toNonNegativeInt(params.expFloor));
  const decayEvery = Math.max(1, toNonNegativeInt(params.expDecayEvery, 1));
  const decayStep = Math.max(1, toNonNegativeInt(params.expDecayStep, 1));
  return buildLookupSeries(length, (t) => {
    const drops = Math.floor(t / decayEvery) * decayStep;
    return Math.max(floorV, start - drops);
  });
}

function buildLogisticLookup(length, params) {
  const minV = toNonNegativeInt(params.logisticMin);
  const maxV = Math.max(minV, toNonNegativeInt(params.logisticMax));
  const mid = toNonNegativeInt(params.logisticMid, Math.floor(length / 2));
  const slope = Math.max(1, toNonNegativeInt(params.logisticSlope, 1));
  const range = maxV - minV;

  // Build a deterministic integer lookup using a sigmoid-shaped real curve,
  // then quantize to integer outputs.
  return buildLookupSeries(length, (t) => {
    const x = (t - mid) / slope;
    const y = 1 / (1 + Math.exp(-x));
    return minV + Math.round(range * y);
  });
}

function evaluateFromLookup(lookup, t) {
  if (!lookup || lookup.length === 0) return 0;
  if (t < lookup.length) return lookup[t];
  return lookup[lookup.length - 1];
}

function evaluateRawArrivalAt(config, t, randomFn, lookupCache) {
  const profileType = config?.profileType || 'constant';
  const params = config?.params || {};
  const piecewiseSegments = config?.piecewiseSegments || [];

  if (profileType === 'constant') {
    return toNonNegativeInt(params.constantValue, 0);
  }

  if (profileType === 'step') {
    const stepStart = toNonNegativeInt(params.stepStart, 0);
    const low = toNonNegativeInt(params.stepLow, 0);
    const high = Math.max(low, toNonNegativeInt(params.stepHigh, low));
    return t < stepStart ? low : high;
  }

  if (profileType === 'piecewiseLinear') {
    return evaluatePiecewiseLinear(piecewiseSegments, t);
  }

  if (profileType === 'triangular') {
    return evaluateTriangular(params, t);
  }

  if (profileType === 'square') {
    return evaluateSquare(params, t);
  }

  if (profileType === 'sawtooth') {
    return evaluateSawtooth(params, t);
  }

  if (profileType === 'pulseTrain') {
    return evaluatePulseTrain(params, t);
  }

  if (profileType === 'exponentialLookup') {
    const lookup = lookupCache.exponential || (lookupCache.exponential = buildExponentialLookup(4096, params));
    return evaluateFromLookup(lookup, t);
  }

  if (profileType === 'logisticLookup') {
    const lookup = lookupCache.logistic || (lookupCache.logistic = buildLogisticLookup(4096, params));
    return evaluateFromLookup(lookup, t);
  }

  if (profileType === 'cycle7') {
    const cycle = Array.isArray(params.cycleValues) ? params.cycleValues : [];
    const fallback = [0, 0, 0, 0, 0, 0, 0];
    const values = (cycle.length === 7 ? cycle : fallback).map((v) => toNonNegativeInt(v));
    return values[t % 7];
  }

  if (profileType === 'randomSeeded') {
    const minV = toNonNegativeInt(params.randomMin, 0);
    const maxV = Math.max(minV, toNonNegativeInt(params.randomMax, minV));
    const u = randomFn();
    const span = maxV - minV + 1;
    return minV + Math.floor(u * span);
  }

  if (profileType === 'sinCos') {
    return evaluateSinCos(params, t);
  }

  return 0;
}

export function evaluateArrivalAt(config, t, randomFn, lookupCache = {}) {
  const maxCap = Math.max(0, toNonNegativeInt(config?.maxCap, 60));
  const freezeAfterT = config?.freezeAfterT == null || config?.freezeAfterT === ''
    ? null
    : toNonNegativeInt(config.freezeAfterT);

  let evalT = toNonNegativeInt(t);
  if (freezeAfterT != null) {
    evalT = Math.min(evalT, freezeAfterT);
  }

  const raw = evaluateRawArrivalAt(config, evalT, randomFn, lookupCache);
  return clampInt(raw, 0, maxCap);
}

export function buildArrivalSeries(config, duration, seed) {
  const steps = Math.max(0, toNonNegativeInt(duration));
  const series = [];
  const lookupCache = {};
  const seedOffset = toNonNegativeInt(config?.params?.randomSeedOffset, 0);
  const rng = seedrandom(`${seed}_arrival_${seedOffset}`);

  for (let t = 0; t < steps; t++) {
    series.push(evaluateArrivalAt(config, t, rng, lookupCache));
  }
  return series;
}

// =====================================================
// DISTRIBUTION TYPES FOR BOUNDARY INFLOW
// =====================================================

export const DISTRIBUTION_TYPES = [
  {
    value: 'normal', label: 'Normal (Gaussian)',
    description: 'Continuous symmetric bell curve, rounded to non-negative integers.',
    wikiUrl: 'https://en.wikipedia.org/wiki/Normal_distribution',
    params: [
      { name: 'mean', label: 'μ (mean)', default: 4, min: 0, step: 0.1 },
      { name: 'stdDev', label: 'σ (std dev)', default: 1.5, min: 0.1, step: 0.1 },
    ],
  },
  {
    value: 'poisson', label: 'Poisson',
    description: 'Classic arrival model. Mean = λ.',
    wikiUrl: 'https://en.wikipedia.org/wiki/Poisson_distribution',
    params: [
      { name: 'lambda', label: 'λ (rate)', default: 3, min: 0.01, step: 0.1 },
    ],
  },
  {
    value: 'geometric', label: 'Geometric',
    description: 'Number of failures before first success. Support: {0,1,2,...}.',
    wikiUrl: 'https://en.wikipedia.org/wiki/Geometric_distribution',
    params: [
      { name: 'p', label: 'p (success prob)', default: 0.3, min: 0.01, max: 1, step: 0.01 },
    ],
  },
  {
    value: 'negativeBinomial', label: 'Negative Binomial',
    description: 'Number of failures before r successes.',
    wikiUrl: 'https://en.wikipedia.org/wiki/Negative_binomial_distribution',
    params: [
      { name: 'r', label: 'r (successes)', default: 3, min: 1, step: 1 },
      { name: 'p', label: 'p (success prob)', default: 0.5, min: 0.01, max: 1, step: 0.01 },
    ],
  },
  {
    value: 'discreteUniform', label: 'Discrete Uniform',
    description: 'Uniform integer in [min, max].',
    wikiUrl: 'https://en.wikipedia.org/wiki/Discrete_uniform_distribution',
    params: [
      { name: 'min', label: 'Min', default: 0, min: 0, step: 1 },
      { name: 'max', label: 'Max', default: 8, min: 0, step: 1 },
    ],
  },
  {
    value: 'binomial', label: 'Binomial',
    description: 'Number of successes in n independent trials.',
    wikiUrl: 'https://en.wikipedia.org/wiki/Binomial_distribution',
    params: [
      { name: 'n', label: 'n (trials)', default: 10, min: 1, step: 1 },
      { name: 'p', label: 'p (success prob)', default: 0.3, min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    value: 'logarithmic', label: 'Logarithmic (Log-Series)',
    description: 'Heavy-tailed discrete distribution. Support: {1,2,3,...}, shifted to {0,1,...}.',
    wikiUrl: 'https://en.wikipedia.org/wiki/Logarithmic_distribution',
    params: [
      { name: 'p', label: 'p (param)', default: 0.5, min: 0.01, max: 0.99, step: 0.01 },
    ],
  },
  {
    value: 'zeta', label: 'Zeta (Zipf)',
    description: 'Power-law distribution. Support shifted to {0,1,2,...}.',
    wikiUrl: 'https://en.wikipedia.org/wiki/Zeta_distribution',
    params: [
      { name: 's', label: 's (exponent)', default: 2.5, min: 1.01, step: 0.1 },
    ],
  },
  {
    value: 'skellam', label: 'Skellam (shifted)',
    description: 'Difference of two Poissons, shifted so minimum ≈ 0.',
    wikiUrl: 'https://en.wikipedia.org/wiki/Skellam_distribution',
    params: [
      { name: 'mu1', label: 'μ₁', default: 5, min: 0.01, step: 0.1 },
      { name: 'mu2', label: 'μ₂', default: 2, min: 0.01, step: 0.1 },
    ],
  },
  {
    value: 'zeroinflatedPoisson', label: 'Zero-Inflated Poisson',
    description: 'Poisson with extra mass at zero. Models low-traffic periods.',
    wikiUrl: 'https://en.wikipedia.org/wiki/Zero-inflated_model',
    params: [
      { name: 'lambda', label: 'λ (rate)', default: 4, min: 0.01, step: 0.1 },
      { name: 'pi', label: 'π (zero inflation)', default: 0.3, min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    value: 'conwayMaxwellPoisson', label: 'Conway-Maxwell-Poisson',
    description: 'Generalised Poisson: ν<1 over-dispersed, ν>1 under-dispersed.',
    wikiUrl: 'https://en.wikipedia.org/wiki/Conway%E2%80%93Maxwell%E2%80%93Poisson_distribution',
    params: [
      { name: 'lambda', label: 'λ (rate)', default: 3, min: 0.01, step: 0.1 },
      { name: 'nu', label: 'ν (dispersion)', default: 1, min: 0.1, step: 0.1 },
    ],
  },
  {
    value: 'betaBinomial', label: 'Beta-Binomial',
    description: 'Over-dispersed binomial with beta-distributed success probability.',
    wikiUrl: 'https://en.wikipedia.org/wiki/Beta-binomial_distribution',
    params: [
      { name: 'n', label: 'n (trials)', default: 10, min: 1, step: 1 },
      { name: 'alpha', label: 'α', default: 2, min: 0.1, step: 0.1 },
      { name: 'beta', label: 'β', default: 3, min: 0.1, step: 0.1 },
    ],
  },
  {
    value: 'hypergeometric', label: 'Hypergeometric',
    description: 'Sampling without replacement from a finite population.',
    wikiUrl: 'https://en.wikipedia.org/wiki/Hypergeometric_distribution',
    params: [
      { name: 'N', label: 'N (population)', default: 50, min: 1, step: 1 },
      { name: 'K', label: 'K (success states)', default: 20, min: 0, step: 1 },
      { name: 'n', label: 'n (draws)', default: 10, min: 1, step: 1 },
    ],
  },
];

export function makeDefaultDistributionConfig() {
  return {
    distributionType: 'poisson',
    seed: 42,
    params: {
      lambda: 3,
      p: 0.3,
      r: 3,
      min: 0,
      max: 8,
      n: 10,
      s: 2.5,
      mu1: 5,
      mu2: 2,
      pi: 0.3,
      nu: 1,
      alpha: 2,
      beta: 3,
      N: 50,
      K: 20,
    },
  };
}

export function makeDistributionInflowProfile() {
  return {
    mode: 'distribution',
    constantValue: 0,
    functionConfig: makeDefaultFunctionConfig(),
    distributionConfig: makeDefaultDistributionConfig(),
  };
}

// =====================================================
// DISTRIBUTION SAMPLING IMPLEMENTATIONS
// =====================================================

function samplePoisson(lambda, rng) {
  // Knuth's algorithm for small lambda, rejection for large
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng();
    } while (p > L);
    return k - 1;
  }
  // Normal approximation for large lambda
  const u1 = rng();
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
}

function sampleGeometric(p, rng) {
  // Number of failures before first success: support {0,1,2,...}
  const u = rng();
  return Math.floor(Math.log(1 - u) / Math.log(1 - p));
}

function sampleNegativeBinomial(r, p, rng) {
  // Number of failures before r successes
  let failures = 0;
  let successes = 0;
  while (successes < r) {
    if (rng() < p) {
      successes++;
    } else {
      failures++;
    }
  }
  return failures;
}

function sampleDiscreteUniform(min, max, rng) {
  const range = Math.max(0, max - min) + 1;
  return min + Math.floor(rng() * range);
}

function sampleBinomial(n, p, rng) {
  let successes = 0;
  for (let i = 0; i < n; i++) {
    if (rng() < p) successes++;
  }
  return successes;
}

function sampleLogarithmic(p, rng) {
  // Log-series distribution, support {1,2,3,...}, we shift to {0,1,...}
  const u = rng();
  const v = rng();
  const logP = Math.log(1 - p);
  const x = Math.floor(1 + Math.log(v) / Math.log(1 - Math.pow(1 - p, u)));
  return Math.max(0, x - 1); // shift to {0,1,...}
}

function sampleZeta(s, rng) {
  // Rejection sampling for Zeta/Zipf, support {1,2,...}, shifted to {0,1,...}
  const b = Math.pow(2, s - 1);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const u = rng();
    const v = rng();
    const x = Math.floor(Math.pow(u, -1 / (s - 1)));
    const t = Math.pow(1 + 1 / x, s - 1);
    if (v * x * (t - 1) / (b - 1) <= t / b) {
      return Math.max(0, x - 1); // shift to {0,1,...}
    }
  }
  return 0; // fallback
}

function sampleSkellam(mu1, mu2, rng) {
  // Difference of two Poissons, shifted so support starts near 0
  const x1 = samplePoisson(mu1, rng);
  const x2 = samplePoisson(mu2, rng);
  return Math.max(0, x1 - x2);
}

function sampleZeroInflatedPoisson(lambda, pi, rng) {
  if (rng() < pi) return 0;
  return samplePoisson(lambda, rng);
}

function sampleConwayMaxwellPoisson(lambda, nu, rng) {
  // CMP via rejection: build CDF up to reasonable truncation
  const maxK = Math.max(100, Math.ceil(lambda * 3 + 20));
  const probs = [];
  let sum = 0;
  for (let k = 0; k <= maxK; k++) {
    // log P(X=k) = k*log(lambda) - nu*sum(log(j) for j=1..k) - log(Z)
    let logP = k * Math.log(lambda);
    for (let j = 1; j <= k; j++) logP -= nu * Math.log(j);
    const p = Math.exp(logP);
    probs.push(p);
    sum += p;
  }
  // Normalize and sample via inverse CDF
  const u = rng() * sum;
  let cumulative = 0;
  for (let k = 0; k <= maxK; k++) {
    cumulative += probs[k];
    if (u <= cumulative) return k;
  }
  return 0;
}

function sampleBetaBinomial(n, alpha, beta, rng) {
  // Sample p from Beta(alpha, beta) using Jöhnk's algorithm, then sample Binomial(n, p)
  const betaSample = sampleBeta(alpha, beta, rng);
  return sampleBinomial(n, betaSample, rng);
}

function sampleBeta(alpha, beta, rng) {
  // Generate Beta(alpha, beta) via Gamma ratio
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

function sampleGamma(shape, rng) {
  // Marsaglia & Tsang's method for shape >= 1, shift for shape < 1
  if (shape < 1) {
    return sampleGamma(shape + 1, rng) * Math.pow(rng(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let attempt = 0; attempt < 1000; attempt++) {
    let x, v;
    do {
      const u1 = rng();
      const u2 = rng();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = Math.pow(1 + c * x, 3);
    } while (v <= 0);
    const u = rng();
    if (u < 1 - 0.0331 * Math.pow(x, 4)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return shape; // fallback
}

function sampleHypergeometric(N, K, n, rng) {
  // Direct sampling
  const safeN = Math.max(1, Math.floor(N));
  const safeK = Math.min(safeN, Math.max(0, Math.floor(K)));
  const safeN2 = Math.min(safeN, Math.max(1, Math.floor(n)));
  let successes = 0;
  let popSize = safeN;
  let successStates = safeK;
  for (let i = 0; i < safeN2; i++) {
    if (popSize <= 0) break;
    if (rng() < successStates / popSize) {
      successes++;
      successStates--;
    }
    popSize--;
  }
  return successes;
}

export function sampleFromDistribution(distributionType, params, rng) {
  const p = params || {};
  switch (distributionType) {
    case 'normal': {
      const mean = Math.max(0, Number(p.mean) || 4);
      const stdDev = Math.max(0.1, Number(p.stdDev) || 1.5);
      const u1 = Math.max(1e-9, rng());
      const u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.max(0, Math.round(mean + stdDev * z));
    }
    case 'poisson':
      return samplePoisson(Math.max(0.01, Number(p.lambda) || 3), rng);
    case 'geometric':
      return sampleGeometric(Math.min(1, Math.max(0.01, Number(p.p) || 0.3)), rng);
    case 'negativeBinomial':
      return sampleNegativeBinomial(
        Math.max(1, Math.floor(Number(p.r) || 3)),
        Math.min(1, Math.max(0.01, Number(p.p) || 0.5)),
        rng
      );
    case 'discreteUniform':
      return sampleDiscreteUniform(
        Math.max(0, Math.floor(Number(p.min) || 0)),
        Math.max(0, Math.floor(Number(p.max) || 8)),
        rng
      );
    case 'binomial':
      return sampleBinomial(
        Math.max(1, Math.floor(Number(p.n) || 10)),
        Math.min(1, Math.max(0, Number(p.p) || 0.3)),
        rng
      );
    case 'logarithmic':
      return sampleLogarithmic(Math.min(0.99, Math.max(0.01, Number(p.p) || 0.5)), rng);
    case 'zeta':
      return sampleZeta(Math.max(1.01, Number(p.s) || 2.5), rng);
    case 'skellam':
      return sampleSkellam(
        Math.max(0.01, Number(p.mu1) || 5),
        Math.max(0.01, Number(p.mu2) || 2),
        rng
      );
    case 'zeroinflatedPoisson':
      return sampleZeroInflatedPoisson(
        Math.max(0.01, Number(p.lambda) || 4),
        Math.min(1, Math.max(0, Number(p.pi) || 0.3)),
        rng
      );
    case 'conwayMaxwellPoisson':
      return sampleConwayMaxwellPoisson(
        Math.max(0.01, Number(p.lambda) || 3),
        Math.max(0.1, Number(p.nu) || 1),
        rng
      );
    case 'betaBinomial':
      return sampleBetaBinomial(
        Math.max(1, Math.floor(Number(p.n) || 10)),
        Math.max(0.1, Number(p.alpha) || 2),
        Math.max(0.1, Number(p.beta) || 3),
        rng
      );
    case 'hypergeometric':
      return sampleHypergeometric(
        Math.max(1, Math.floor(Number(p.N) || 50)),
        Math.max(0, Math.floor(Number(p.K) || 20)),
        Math.max(1, Math.floor(Number(p.n) || 10)),
        rng
      );
    default:
      return samplePoisson(3, rng);
  }
}

export function buildDistributionSeries(distributionConfig, duration, globalSeed, boundaryKey) {
  const cfg = distributionConfig || makeDefaultDistributionConfig();
  const steps = Math.max(0, toNonNegativeInt(duration));
  const distSeed = toNonNegativeInt(cfg.seed, 42);
  const rng = seedrandom(`${globalSeed}_dist_${distSeed}_${boundaryKey || ''}`);
  const series = [];
  for (let t = 0; t < steps; t++) {
    const val = sampleFromDistribution(cfg.distributionType, cfg.params, rng);
    series.push(Math.max(0, Math.floor(val)));
  }
  return series;
}
