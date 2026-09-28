import { describe, expect, it } from 'vitest';
import { improvement, pairedStats } from '../cityMetrics.js';

describe('comparison statistics', () => {
  it('measures improvement in the right direction', () => {
    expect(improvement(100, 75, true)).toBeCloseTo(0.25); // less waiting is better
    expect(improvement(100, 120, false)).toBeCloseTo(0.2); // more trips is better
    expect(improvement(100, 130, true)).toBeCloseTo(-0.3);
    expect(improvement(0, 5)).toBeNull();
  });

  it('gives a 95% range using the t-distribution', () => {
    const s = pairedStats([0.1, 0.2, 0.3]);
    expect(s.mean).toBeCloseTo(0.2);
    expect(s.sd).toBeCloseTo(0.1);
    // t(2) = 4.303 → half-width 4.303 × 0.1 / √3
    expect(s.high - s.mean).toBeCloseTo((4.303 * 0.1) / Math.sqrt(3), 4);
    expect(s.wins).toBe(3);
  });

  it('counts wins and handles a single run', () => {
    expect(pairedStats([0.2, -0.1, 0.05]).wins).toBe(2);
    const one = pairedStats([0.3]);
    expect(one.mean).toBeCloseTo(0.3);
    expect(Number.isNaN(one.low)).toBe(true);
  });
});
