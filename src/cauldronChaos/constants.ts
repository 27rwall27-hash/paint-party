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
// A master pool of original potion ingredients — each round draws a random subset of these (no
// two rounds necessarily look the same). Everything is procedurally drawn (see bottleTexture.ts's
// glyph functions), no image assets.
export type Glyph = "flame" | "moon" | "cap" | "snowflake" | "skull" | "berry" | "leaf" | "star" | "feather" | "drop" | "thorn" | "spiral" | "sparkle" | "swirl";

export interface IngredientDef {
  id: number;
  name: string;
  color: string;
  glyph: Glyph;
}

export const INGREDIENTS: IngredientDef[] = [
  { id: 0, name: "Ember Root", color: "#e2572b", glyph: "flame" },
  { id: 1, name: "Moon Petal", color: "#9fb8e8", glyph: "moon" },
  { id: 2, name: "Glowcap", color: "#8fd14f", glyph: "cap" },
  { id: 3, name: "Frostvine", color: "#7fe3e0", glyph: "snowflake" },
  { id: 4, name: "Shadow Ash", color: "#6b4b8a", glyph: "skull" },
  { id: 5, name: "Sunberry", color: "#f4c53d", glyph: "berry" },
  { id: 6, name: "Bog Moss", color: "#5c7a3f", glyph: "leaf" },
  { id: 7, name: "Starshard", color: "#e8e8f0", glyph: "star" },
  { id: 8, name: "Crow Feather", color: "#3a3542", glyph: "feather" },
  { id: 9, name: "Honeydrop", color: "#e0a339", glyph: "drop" },
  { id: 10, name: "Thornbrier", color: "#a13a4a", glyph: "thorn" },
  { id: 11, name: "Swirlkelp", color: "#2f9e8f", glyph: "spiral" },
  { id: 12, name: "Cinderdust", color: "#8a7d6b", glyph: "sparkle" },
  { id: 13, name: "Wisproot", color: "#8a5ec9", glyph: "swirl" },
];

// --- Rounds -------------------------------------------------------------------------------
// Each round picks `distinctTypeCount` random ingredient types; each gets a random number of
// physical bottle copies on the shelf (1..maxCopiesPerType) — the SAME potion can sit on the
// shelf more than once, and can be safely poured once per physical copy. The witch's (now the
// cauldron's own) called list is drawn from those distinct types with replacement; how many
// times a type is called determines how many of its physical copies are safe to pour, capped by
// however many copies actually exist.
export interface RoundConfig {
  distinctTypeCount: number;
  maxCopiesPerType: number;
  callListLength: number;
  callIntervalMs: number;
}
export const ROUND_CONFIGS: RoundConfig[] = [
  { distinctTypeCount: 5, maxCopiesPerType: 2, callListLength: 7, callIntervalMs: 650 },
  { distinctTypeCount: 6, maxCopiesPerType: 2, callListLength: 8, callIntervalMs: 550 },
  { distinctTypeCount: 6, maxCopiesPerType: 3, callListLength: 10, callIntervalMs: 450 },
  { distinctTypeCount: 7, maxCopiesPerType: 3, callListLength: 11, callIntervalMs: 380 },
  { distinctTypeCount: 8, maxCopiesPerType: 3, callListLength: 13, callIntervalMs: 300 },
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
export const WALK_DURATION_MS = 1100;
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
export const SHELF_WIDTH = ROOM_WIDTH - 3;

export const CAULDRON_X = 0;
export const CAULDRON_Z = -1.2;
export const CAULDRON_RADIUS = 1.6;
// Where a carried bottle gets poured — just south (camera-side) of the cauldron's own rim.
export const CAULDRON_POUR_Z = CAULDRON_Z + CAULDRON_RADIUS + 0.9;

export const PLAYER_HOME_POSITIONS: { x: number; z: number }[] = [
  { x: -3.4, z: 5.6 },
  { x: 3.4, z: 5.6 },
  { x: -7.2, z: 2.4 },
  { x: 7.2, z: 2.4 },
];

export const BOTTLE_RADIUS = 0.32;
export const BOTTLE_HEIGHT = 0.85;
export const CHARACTER_RADIUS = 0.42;
export const CHARACTER_HEIGHT = 1.55;

export const CAMERA_FOV = 44;
export const CAMERA_HEIGHT = 11.5;
export const CAMERA_BACK = 12.5;
export const AMBIENT_LIGHT_INTENSITY = 1.3;
export const KEY_LIGHT_INTENSITY = 2.1;
export const ENVIRONMENT_INTENSITY = 0.6;
export const SHADOWS_ENABLED = true;
