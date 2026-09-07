// =====================================================
// PHASE DEFINITIONS (INDIAN CONVENTION)
//
// Naming convention:
//   First letter = HEADING direction (where the vehicle is going)
//   NT = Northbound Through (vehicle approaches from South, heading North, going straight)
//   NR = Northbound Right (vehicle approaches from South, heading North, turning right)
//   NL = Northbound Left (free left, bypasses signal)
//
// Internal arrays still use APPROACH direction:
//   approach S = Northbound, approach N = Southbound,
//   approach W = Eastbound, approach E = Westbound
// =====================================================

export const PHASES = {
  // Same heading: both through + right (4 phases)
  NT_NR: [['S', 'T'], ['S', 'R']],   // Northbound Through + Northbound Right
  ST_SR: [['N', 'T'], ['N', 'R']],   // Southbound Through + Southbound Right
  ET_ER: [['W', 'T'], ['W', 'R']],   // Eastbound Through + Eastbound Right
  WT_WR: [['E', 'T'], ['E', 'R']],   // Westbound Through + Westbound Right
  // Opposite through movements (2 phases)
  NT_ST: [['S', 'T'], ['N', 'T']],   // Northbound Through + Southbound Through
  ET_WT: [['W', 'T'], ['E', 'T']],   // Eastbound Through + Westbound Through
  // Opposite right turns (2 phases)
  NR_SR: [['S', 'R'], ['N', 'R']],   // Northbound Right + Southbound Right
  ER_WR: [['W', 'R'], ['E', 'R']],   // Eastbound Right + Westbound Right
};

export const PHASE_NAMES = Object.keys(PHASES);

export const FIXED_CYCLE = ['NT_ST', 'ET_WT', 'NR_SR', 'ER_WR'];

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
// Indian left-hand driving: right turn crosses opposing traffic
// Approach N (heading south) right turn exits W
// Approach S (heading north) right turn exits E
// Approach E (heading west) right turn exits N
// Approach W (heading east) right turn exits S
export const RIGHT_EXIT = { N: 'W', S: 'E', E: 'N', W: 'S' };

// When a vehicle turns Left from approach X, which direction does it exit?
// Indian left-hand driving: left turn is FREE (no signal needed)
// Approach N (heading south) left turn exits E
// Approach S (heading north) left turn exits W
// Approach E (heading west) left turn exits S
// Approach W (heading east) left turn exits N
export const LEFT_EXIT = { N: 'E', S: 'W', E: 'S', W: 'N' };

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
