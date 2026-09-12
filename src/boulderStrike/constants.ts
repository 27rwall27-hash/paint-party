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
// Both shrink round to round for escalating difficulty. Slowed a second time — even round 1 needs
// to give a fresh player time to actually register a shape+color before it's gone.
export interface RoundConfig {
  decoyCount: number;
  windowMs: number;
  gapMs: number;
}
export const ROUND_CONFIGS: RoundConfig[] = [
  { decoyCount: 4, windowMs: 1450, gapMs: 850 },
  { decoyCount: 5, windowMs: 1250, gapMs: 750 },
  { decoyCount: 6, windowMs: 1100, gapMs: 650 },
  { decoyCount: 7, windowMs: 950, gapMs: 550 },
  { decoyCount: 8, windowMs: 820, gapMs: 470 },
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
// Narrowed from 3.4 — at the old spacing the outer two lanes (players 0 and 9) fell outside the
// camera's horizontal field of view entirely, so player 0 (always the human) could be invisible
// depending on which edge they landed on. Narrower lanes keep all 10 players on screen without
// having to back the camera off far enough to hurt gleam readability.
export const LANE_SPACING = 2.9;
export const BOULDER_SPACING = 3.1;
export const BOULDER_RADIUS = 0.75;
// How far south (camera-side) of the boulder a player stands. At 1.5, the leftover clearance to
// the NEXT round's boulder once a player finishes walking up to it — offset minus both radii —
// worked out to only ~0.3 world units, which read as walking straight into it. Widened to 2.0;
// TOOL_SWING_POS.z below is extended by the same amount so the swing still visibly reaches the
// player's OWN (closer, not the next) boulder.
export const PLAYER_STAND_OFFSET = 2.0;
export const CHARACTER_RADIUS = 0.4;
export const CHARACTER_HEIGHT = 1.5;

// Lowered from the first pass (height 30 / back 9, ~73deg off horizontal — steep enough that the
// pickaxe's gleam face, which stands roughly vertical, was seen almost edge-on). This is closer
// to ~48deg, shallow enough that gleams actually read, while the camera still re-centers on
// whichever round is currently active (see sceneBuilder.ts) so the current boulder/pickaxes stay
// framed regardless of how far down the line play has gotten. FOV also widened alongside the
// LANE_SPACING narrowing above, to fully close the "can't see player 0" gap.
export const CAMERA_FOV = 52;
export const CAMERA_HEIGHT = 15;
export const CAMERA_BACK = 17;
export const AMBIENT_LIGHT_INTENSITY = 1.4;
export const KEY_LIGHT_INTENSITY = 2.2;
export const ENVIRONMENT_INTENSITY = 0.55;
export const SHADOWS_ENABLED = true;

// --- Pickaxe pose (world-ish offsets from the shoulder, world units / radians) ------------------
// Raised: pulled back and up, over the shoulder, both arms up — a real windup, not a one-armed
// half-raise. Swing: whips forward and down onto the boulder. Rest: hangs loosely.
//
// Rotation is around the toolGrip's local X axis, which (given the pickaxe geometry extends
// along +Y from the grip) sends +Y toward +Z (back, toward the player/camera) for positive
// angles and toward -Z (forward, toward the boulder) for negative angles. The previous pass had
// RAISED using a *negative* angle — tilting the head forward, toward the boulder, while the grip
// position simultaneously moved backward — the two fought each other and read as a limp,
// horizontal-ish tilt instead of a proper windup. RAISED now uses a positive angle (up and back,
// agreeing with its backward grip-position offset below); SWING uses a negative angle past
// vertical (down and forward, agreeing with its forward grip-position offset) so the head
// visibly arcs up-and-back -> overhead -> down-and-forward into the rock.
export const TOOL_REST_ROT_X = 2.6;
export const TOOL_RAISED_ROT_X = 0.62;
export const TOOL_SWING_ROT_X = -2.25;
export const TOOL_REST_POS = { y: 0.75, z: 0.18 };
export const TOOL_RAISED_POS = { y: 1.55, z: 0.4 };
export const TOOL_SWING_POS = { y: 0.85, z: -1.05 };

// The arm stubs get their own raised/swing targets (rather than tracking a fraction of the tool's
// rotation delta) because their rest orientation — hanging straight down at rotation 0 — isn't the
// same baseline the tool's rest orientation is built from, so a shared delta didn't cover enough
// angular distance to actually reach "up": it left the arms swung out sideways/backward instead of
// over the shoulder. These values independently trace the same down -> up-and-back -> down-and-
// forward arc the tool takes (see the direction-convention note above).
export const ARM_REST_ROT_X = 0;
export const ARM_RAISED_ROT_X = -2.5;
export const ARM_SWING_ROT_X = 0.9;

// --- char1 (player 0's real model) bone-driven animation ---------------------------------------
// Additive offsets on top of the model's own bind-pose rotation (never overwrite it outright —
// the bind pose also encodes axes we're not animating). Scale factors are first-pass guesses,
// tuned by screenshot since the source rig's local axis conventions aren't something we can read
// off the file — this is the same "implement, screenshot, correct the sign/axis" loop used to fix
// the generic rig's own tool rotation above.
export const MARIO_ARM_SWING_SCALE = 0.7;

// The swing plays immediately off each player's own release timestamp (not gated behind the
// round's global REVEAL phase), so a fast reflex doesn't have to wait for slower players/CPUs to
// finish out the rest of the gleam sequence before its swing animation even starts.
export const SWING_DURATION_MS = 260;

// --- Rubble (a successfully-struck boulder crumbles into a small pile, rather than just
// shrinking away) ---------------------------------------------------------------------------
export const RUBBLE_CHUNK_COUNT = 7;
export const RUBBLE_SETTLE_MS = 420;
