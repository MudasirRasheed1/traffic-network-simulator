// =====================================================
// PHASE DEFINITIONS
//
// Naming convention:
//   First letter = HEADING direction (where the vehicle is going)
//   NT = Northbound Through (vehicle approaches from South, heading North, going straight)
//   NR = Northbound Right (vehicle approaches from South, heading North, turning right)
//   NL = Northbound Left (vehicle approaches from South, heading North, turning left)
//   Whichever of R/L bypasses the signal (the "free" turn) depends on
//   driving side - see buildPhaseConfig below.
//
// Internal arrays still use APPROACH direction:
//   approach S = Northbound, approach N = Southbound,
//   approach W = Eastbound, approach E = Westbound
// =====================================================

// =====================================================
// DRIVING SIDE
//
// Turning geometry (LEFT_EXIT/RIGHT_EXIT below) is purely physical and
// never changes. What changes between left-hand and right-hand traffic
// is which turn is "free" (doesn't cross oncoming traffic, processed
// every step) and which turn is signal-controlled (grouped into phases
// alongside the through movement):
//   - Left-hand traffic (e.g. India, UK): Left turn is free, Right turn
//     is signal-controlled.
//   - Right-hand traffic (e.g. US, most of Europe): Right turn is free,
//     Left turn is signal-controlled.
// =====================================================
export function getControlledTurn(drivingSide) {
  return drivingSide === 'right' ? 'L' : 'R';
}

export function getFreeTurn(drivingSide) {
  return drivingSide === 'right' ? 'R' : 'L';
}

// Builds the signal phase table for the given driving side. The phase
// names/keys are generated dynamically so they always reflect which
// turn (R or L) is actually signal-controlled for that side.
export function buildPhaseConfig(drivingSide) {
  const turn = getControlledTurn(drivingSide);

  const PHASES = {
    // Same heading: both through + controlled turn (4 phases)
    [`NT_N${turn}`]: [['S', 'T'], ['S', turn]],
    [`ST_S${turn}`]: [['N', 'T'], ['N', turn]],
    [`ET_E${turn}`]: [['W', 'T'], ['W', turn]],
    [`WT_W${turn}`]: [['E', 'T'], ['E', turn]],
    // Opposite through movements (2 phases)
    NT_ST: [['S', 'T'], ['N', 'T']],
    ET_WT: [['W', 'T'], ['E', 'T']],
    // Opposite controlled turns (2 phases)
    [`N${turn}_S${turn}`]: [['S', turn], ['N', turn]],
    [`E${turn}_W${turn}`]: [['W', turn], ['E', turn]],
  };

  const PHASE_NAMES = Object.keys(PHASES);
  const FIXED_CYCLE = ['NT_ST', 'ET_WT', `N${turn}_S${turn}`, `E${turn}_W${turn}`];

  return { PHASES, PHASE_NAMES, FIXED_CYCLE, controlledTurn: turn, freeTurn: getFreeTurn(drivingSide) };
}

// Default (left-hand traffic) phase table, kept as the module-level
// export for any callers that have not been updated to pass drivingSide.
export const { PHASES, PHASE_NAMES, FIXED_CYCLE } = buildPhaseConfig('left');

export const DIRECTIONS = ['N', 'S', 'E', 'W'];

// Opposite direction map
export const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

// Approach direction to Heading direction
// approach N (from north) = heading South
// approach S (from south) = heading North
export const APPROACH_TO_HEADING = { N: 'S', S: 'N', E: 'W', W: 'E' };

// Heading direction to Approach direction (same mapping, symmetric)
export const HEADING_TO_APPROACH = { N: 'S', S: 'N', E: 'W', W: 'E' };

// When a vehicle goes Straight through from approach X, which direction does it exit?
// Approach N (coming from north, heading south) exits S
// Approach S (coming from south, heading north) exits N
export const THROUGH_EXIT = { N: 'S', S: 'N', E: 'W', W: 'E' };

// When a vehicle turns Right from approach X, which direction does it exit?
// Pure geometry - true regardless of driving side.
// Approach N (heading south) right turn exits W
// Approach S (heading north) right turn exits E
// Approach E (heading west) right turn exits N
// Approach W (heading east) right turn exits S
export const RIGHT_EXIT = { N: 'W', S: 'E', E: 'N', W: 'S' };

// When a vehicle turns Left from approach X, which direction does it exit?
// Pure geometry - true regardless of driving side.
// Approach N (heading south) left turn exits E
// Approach S (heading north) left turn exits W
// Approach E (heading west) left turn exits S
// Approach W (heading east) left turn exits N
export const LEFT_EXIT = { N: 'E', S: 'W', E: 'S', W: 'N' };

// Intent -> exit-direction map, indexed by movement letter (T/R/L).
// Which of R/L is "free" vs signal-controlled depends on driving side
// (see getFreeTurn/getControlledTurn above); the exit geometry itself does not.
export const EXIT_MAP = { T: THROUGH_EXIT, R: RIGHT_EXIT, L: LEFT_EXIT };

// UI labels for the driving-side toggle.
export const DRIVING_SIDE_LABELS = {
  left: 'Left-hand drive',
  right: 'Right-hand drive',
};

// Given an exit direction, which neighbor does the vehicle go to?
// Exit S = neighbor to the south (row+1)
// Exit N = neighbor to the north (row-1)
// Exit E = neighbor to the east (col+1)
// Exit W = neighbor to the west (col-1)
export const EXIT_TO_NEIGHBOR_DELTA = {
  N: [-1, 0],
  S: [1, 0],
  E: [0, 1],
  W: [0, -1],
};

// When arriving from a direction, which approach queue does the vehicle join?
// If exit direction from upstream is N (heading north), arrives at downstream from S approach
export const ARRIVAL_APPROACH = { N: 'S', S: 'N', E: 'W', W: 'E' };

// Heading direction labels for UI display
export const HEADING_LABELS = {
  N: 'Northbound',
  S: 'Southbound',
  E: 'Eastbound',
  W: 'Westbound',
};
