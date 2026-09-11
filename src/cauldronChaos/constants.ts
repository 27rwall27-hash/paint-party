export const CANVAS_W = 1400;
export const CANVAS_H = 1000;

export const PLAYER_COUNT = 4;

// A small, distinct 4-color palette — copied (not imported) from the other games' own preset
// lists so every game in the suite stays fully decoupled, per the suite's isolation principle.
export const PRESET_COLORS: string[] = [
  "#e63946", // red
  "#3a86ff", // bright blue
  "#ffd60a", // gold
  "#2ecc71", // green
];

export const CPU_NAME_PREFIX = "CPU";

// --- Ingredients -----------------------------------------------------------------------------
// Exactly 10 potions, every round, each a maximally distinct hue — no symbols, the color alone is
// the thing to remember. Names are kept for the call banner/flavor only.
export interface IngredientDef {
  id: number;
  name: string;
  color: string;
}

export const INGREDIENTS: IngredientDef[] = [
  { id: 0, name: "Ember Root", color: "#e63946" }, // red
  { id: 1, name: "Moon Petal", color: "#3a86ff" }, // blue
  { id: 2, name: "Glowcap", color: "#ffd60a" }, // yellow
  { id: 3, name: "Bog Moss", color: "#2ecc71" }, // green
  { id: 4, name: "Shadow Ash", color: "#8e44ad" }, // purple
  { id: 5, name: "Sunberry", color: "#f77f00" }, // orange
  { id: 6, name: "Frostvine", color: "#06b6d4" }, // cyan
  { id: 7, name: "Wisproot", color: "#e0479e" }, // magenta
  { id: 8, name: "Starshard", color: "#e8e8f0" }, // white
  { id: 9, name: "Cinderdust", color: "#8a5a34" }, // brown
];

// --- Rounds -------------------------------------------------------------------------------
// The shelf always shows all 10 potions, and the cauldron's vision always calls out 12 of them
// (with replacement, so some repeat — that's what lets a color be safely poured more than once).
// Every bottle taken off the shelf refills immediately, so the shelf itself never runs dry; only
// the call-count bookkeeping decides whether a given pour is actually safe. Difficulty ramps
// purely through the call speed getting faster round to round.
export interface RoundConfig {
  callListLength: number;
  callIntervalMs: number;
}
export const ROUND_CONFIGS: RoundConfig[] = [
  { callListLength: 12, callIntervalMs: 700 },
  { callListLength: 12, callIntervalMs: 580 },
  { callListLength: 12, callIntervalMs: 480 },
  { callListLength: 12, callIntervalMs: 400 },
  { callListLength: 12, callIntervalMs: 320 },
];

// Survivor (last one un-eliminated) scores highest, then by how long each eliminated player
// lasted — same points-by-rank convention as the rest of the suite.
export const POINTS_BY_SURVIVAL_RANK: number[] = [5, 3, 2, 1];

// --- Phase timing (ms) ------------------------------------------------------------------------
export const INTRO_HOLD_MS = 1400;
export const CALLING_LEAD_MS = 500; // brief pause before the first item flashes
export const CALLING_TAIL_MS = 500; // brief pause after the last item, before picking begins
export const HUMAN_TURN_TIMEOUT_MS = 7000;
export const SCORED_HOLD_MS = 2400;

// --- Turn choreography (ms) -------------------------------------------------------------------
// Every turn — human or CPU — is a real walk: to the shelf, pick up the chosen bottle, carry it
// to the cauldron, pour (resolved here), then walk back. Exactly one player animates at a time.
export const WALK_DURATION_MS = 1300;
export const PICKUP_HOLD_MS = 350;
export const POUR_HOLD_MS = 750;

// --- CPU pacing --------------------------------------------------------------------------------
// Each CPU rolls a persistent 0..1 "skill" once at game start (same convention as every other
// game's rollCpuSkill) governing both recall accuracy and how long it pauses (deciding, at its
// home spot) before setting off toward the shelf.
export const ACCURACY_MIN = 0.45;
export const ACCURACY_MAX = 0.93;
export const DECIDE_SLOW_MS = 1300;
export const DECIDE_FAST_MS = 350;
export const DECIDE_JITTER = 0.25;

// --- 3D world layout (world units) -------------------------------------------------------------
export const ROOM_WIDTH = 22;
export const ROOM_DEPTH = 17;
export const WALL_HEIGHT = 6.5;

export const SHELF_Z = -ROOM_DEPTH / 2 + 1.6;
export const SHELF_Y = 1.15;
export const SHELF_WIDTH = ROOM_WIDTH - 4;
// A character walks to (and stands at) a point this far in FRONT of the shelf counter to reach
// for a bottle — not the bottle's own position, which sits on top of/inside the counter volume.
export const SHELF_APPROACH_OFFSET = 1.5;

export const CAULDRON_X = 0;
export const CAULDRON_Z = -1.2;
export const CAULDRON_RADIUS = 1.5;
// Where a carried bottle gets poured — just south (camera-side) of the cauldron's own rim.
export const CAULDRON_POUR_Z = CAULDRON_Z + CAULDRON_RADIUS + 1.0;
// How far out (world X, at the cauldron's own Z) a walking path bows around the cauldron's own
// footprint — every leg of a turn's walk routes via this detour point instead of a straight line,
// so nobody ever cuts straight through the pot.
export const CAULDRON_DETOUR_MARGIN = CAULDRON_RADIUS + 2.1;

export const PLAYER_HOME_POSITIONS: { x: number; z: number }[] = [
  { x: -3.4, z: 6.4 },
  { x: 3.4, z: 6.4 },
  { x: -7.6, z: 3.6 },
  { x: 7.6, z: 3.6 },
];

export const BOTTLE_RADIUS = 0.32;
export const BOTTLE_HEIGHT = 0.85;
export const CHARACTER_RADIUS = 0.42;
export const CHARACTER_HEIGHT = 1.6;
export const WALK_CYCLE_PERIOD_MS = 260;
export const WALK_SWING_RAD = 0.6;

export const CAMERA_FOV = 42;
export const CAMERA_HEIGHT = 12.5;
export const CAMERA_BACK = 14;
export const AMBIENT_LIGHT_INTENSITY = 1.3;
export const KEY_LIGHT_INTENSITY = 2.2;
export const ENVIRONMENT_INTENSITY = 0.55;
export const SHADOWS_ENABLED = true;
