export const CANVAS_W = 1400;
export const CANVAS_H = 1000;

export const PLAYER_COUNT = 10;

// A 10-color palette, distinct enough to tell apart across a wide near-top-down scene — copied
// (not imported) from nowhere else, per the suite's isolation principle; every other game in this
// suite only ever needed 4.
export const PRESET_COLORS: string[] = [
  "#e63946", // red
  "#3a86ff", // blue
  "#ffd60a", // yellow
  "#2ecc71", // green
  "#8e44ad", // purple
  "#f77f00", // orange
  "#06b6d4", // cyan
  "#e0479e", // magenta
  "#e8e8f0", // white
  "#8a5a34", // brown
];

export const CPU_NAME_PREFIX = "CPU";

// --- Gleams ------------------------------------------------------------------------------------
// 4 shapes x 3 colors = 12 distinct gleams. Every round randomly picks one as the target (shown
// to players in a preview banner beforehand) and draws decoys from the other 11 — both the shape
// AND the color have to match for a release to count, so a decoy sharing just one trait (e.g. the
// right color, wrong shape) is a deliberate trap.
export type GleamShape = "diamond" | "star" | "circle" | "square";
export const GLEAM_SHAPES: GleamShape[] = ["diamond", "star", "circle", "square"];

export interface GleamColorDef {
  id: "gold" | "blue" | "crimson";
  hex: string;
}
export const GLEAM_COLORS: GleamColorDef[] = [
  { id: "gold", hex: "#ffd23f" },
  { id: "blue", hex: "#3aa0ff" },
  { id: "crimson", hex: "#e6314f" },
];

export interface GleamCombo {
  id: number;
  shape: GleamShape;
  color: GleamColorDef;
}
export const GLEAM_COMBOS: GleamCombo[] = GLEAM_SHAPES.flatMap((shape, si) =>
  GLEAM_COLORS.map((color, ci) => ({ id: si * GLEAM_COLORS.length + ci, shape, color })),
);

// --- Ore rewards ---------------------------------------------------------------------------------
export interface OreTier {
  name: string;
  color: string;
  points: number;
}
export const ORE_TIERS: OreTier[] = [
  { name: "Gold", color: "#ffd23f", points: 8 },
  { name: "Silver", color: "#d7dee5", points: 5 },
  { name: "Bronze", color: "#c17a3a", points: 3 },
  { name: "Verdite", color: "#3fae5a", points: 1 },
];

// --- Rounds -------------------------------------------------------------------------------
// Each round flashes `decoyCount` wrong gleams plus the 1 real target, in a random order (the
// target's position in the sequence is never fixed, so counting flashes doesn't help — every one
// has to actually be read). windowMs is how long each gleam stays lit (and, for the target
// specifically, how long the release window stays valid); gapMs is the dark pause between flashes.
// Both shrink round to round for escalating difficulty.
export interface RoundConfig {
  decoyCount: number;
  windowMs: number;
  gapMs: number;
}
export const ROUND_CONFIGS: RoundConfig[] = [
  { decoyCount: 4, windowMs: 900, gapMs: 500 },
  { decoyCount: 5, windowMs: 800, gapMs: 450 },
  { decoyCount: 6, windowMs: 700, gapMs: 400 },
  { decoyCount: 7, windowMs: 620, gapMs: 350 },
  { decoyCount: 8, windowMs: 550, gapMs: 300 },
];

// --- Phase timing (ms) ------------------------------------------------------------------------
export const INTRO_HOLD_MS = 1200;
export const PREVIEW_HOLD_MS = 1900;
export const RAISE_HOLD_MS = 1400;
export const LEAD_GAP_MS = 400; // dark pause after "raise your pickaxe" before the first gleam
export const TAIL_GRACE_MS = 500; // grace period after the last gleam before the round is forced closed
export const REVEAL_HOLD_MS = 1700;
export const SCORED_HOLD_MS = 1100;
export const WALK_DURATION_MS = 900;

// --- CPU pacing --------------------------------------------------------------------------------
// Each CPU rolls a persistent 0..1 "skill" once at game start (same convention as every other
// game's rollCpuSkill). Higher skill means both a better chance of catching the real target at
// all, and — when it does — releasing closer to the exact instant the gleam appears.
export const ACCURACY_MIN = 0.35;
export const ACCURACY_MAX = 0.94;
export const PRECISION_SKEW_MIN = 1; // low skill: release time ~uniform across the window
export const PRECISION_SKEW_MAX = 4; // high skill: release time skewed hard toward instant-0

// --- 3D world layout (world units) -------------------------------------------------------------
export const LANE_SPACING = 3.4;
export const BOULDER_SPACING = 3.1;
export const BOULDER_RADIUS = 0.75;
export const PLAYER_STAND_OFFSET = 1.5; // how far south (camera-side) of the boulder a player stands
export const CHARACTER_RADIUS = 0.4;
export const CHARACTER_HEIGHT = 1.5;

// Lowered from the first pass (height 30 / back 9, ~73deg off horizontal — steep enough that the
// pickaxe's gleam face, which stands roughly vertical, was seen almost edge-on). This is closer
// to ~48deg, shallow enough that gleams actually read, while the camera still re-centers on
// whichever round is currently active (see sceneBuilder.ts) so the current boulder/pickaxes stay
// framed regardless of how far down the line play has gotten.
export const CAMERA_FOV = 46;
export const CAMERA_HEIGHT = 15;
export const CAMERA_BACK = 17;
export const AMBIENT_LIGHT_INTENSITY = 1.4;
export const KEY_LIGHT_INTENSITY = 2.2;
export const ENVIRONMENT_INTENSITY = 0.55;
export const SHADOWS_ENABLED = true;

// --- Pickaxe pose (world-ish offsets from the shoulder, world units / radians) ------------------
// Raised: pulled back and up, over the shoulder, both arms up — a real windup, not a one-armed
// half-raise. Swing: whips forward and down onto the boulder. Rest: hangs loosely.
export const TOOL_REST_ROT_X = 2.6;
export const TOOL_RAISED_ROT_X = -0.55;
export const TOOL_SWING_ROT_X = 1.85;
export const TOOL_REST_POS = { y: 0.75, z: 0.18 };
export const TOOL_RAISED_POS = { y: 1.55, z: 0.4 };
export const TOOL_SWING_POS = { y: 0.85, z: -0.55 };
export const ARM_RAISE_FOLLOW = 0.8; // how much the arm stubs mirror the tool's own rotation
