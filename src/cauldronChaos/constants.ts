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
// two rounds necessarily look the same), never the full list at once for the early, easier
// rounds. Everything is procedurally drawn (see render.ts's glyph functions), no image assets.
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
// {poolSize, callListLength, callIntervalMs} per round — pool grows, the called list gets both
// longer AND faster, mirroring the source minigame's own difficulty curve (a rapid-fire list
// where the final items are barely readable). poolSize is always <= INGREDIENTS.length.
export interface RoundConfig {
  poolSize: number;
  callListLength: number;
  callIntervalMs: number;
}
export const ROUND_CONFIGS: RoundConfig[] = [
  { poolSize: 8, callListLength: 9, callIntervalMs: 650 },
  { poolSize: 8, callListLength: 10, callIntervalMs: 520 },
  { poolSize: 10, callListLength: 12, callIntervalMs: 430 },
  { poolSize: 10, callListLength: 13, callIntervalMs: 350 },
  { poolSize: 12, callListLength: 15, callIntervalMs: 280 },
];

// Survivor (last one un-eliminated) scores highest, then by how long each eliminated player
// lasted — same points-by-rank convention as the rest of the suite.
export const POINTS_BY_SURVIVAL_RANK: number[] = [5, 3, 2, 1];

// --- Phase timing (ms) ------------------------------------------------------------------------
export const INTRO_HOLD_MS = 1400;
export const CALLING_LEAD_MS = 500; // brief pause before the first item flashes
export const CALLING_TAIL_MS = 500; // brief pause after the last item, before picking begins
export const HUMAN_TURN_TIMEOUT_MS = 7000;
export const TURN_REVEAL_HOLD_MS = 900; // how long the safe-glow / backfire plays before advancing
export const SCORED_HOLD_MS = 2400;

// --- CPU pacing --------------------------------------------------------------------------------
// Each CPU rolls a persistent 0..1 "skill" once at game start (same convention as every other
// game's rollCpuSkill) governing both recall accuracy and how fast it commits to a pick.
export const ACCURACY_MIN = 0.45;
export const ACCURACY_MAX = 0.93;
export const THINK_SLOW_MS = 2600;
export const THINK_FAST_MS = 900;
export const THINK_JITTER = 0.25;

export const SHELF_COLS = 4;
