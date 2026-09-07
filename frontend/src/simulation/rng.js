// =====================================================
// Seeded Random Number Generator
// Uses seedrandom for reproducible simulations
// =====================================================
import seedrandom from 'seedrandom';

/**
 * Per-policy RNG instance with state save/restore.
 * Each simulation policy (fixed, greedy) gets its own independent instance
 * so they don't interfere with each other.
 */
export class PolicyRng {
  constructor(seed) {
    this.rng = seedrandom(String(seed), { state: true });
  }

  /** Get a random number in [0, 1) */
  random() {
    return this.rng();
  }

  /** Save the current RNG state (for greedy lookahead save/restore) */
  getState() {
    return this.rng.state();
  }

  /** Restore RNG to a previously saved state */
  setState(state) {
    this.rng = seedrandom('', { state });
  }
}
