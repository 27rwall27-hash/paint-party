export const CANVAS_W = 1600;
export const CANVAS_H = 1660;
export const HUD_HEIGHT = 60;

export const PLAYER_COUNT = 4;
export const GRID_SIZE = 7;
export const TOTAL_ROOMS = GRID_SIZE * GRID_SIZE;
export const MID_INDEX = 3; // the middle row/col index of a 7-wide grid — where each entrance sits

// A small, distinct 4-color palette — copied (not imported) from the other games' own preset
// lists so every game in the suite stays fully decoupled, per the suite's isolation principle.
export const PRESET_COLORS: string[] = [
  "#e63946", // red
  "#3a86ff", // bright blue
  "#ffd60a", // gold
  "#2ecc71", // green
];

export const CPU_NAME_PREFIX = "CPU";

// --- Maze generation (mazeGen.ts) -----------------------------------------------------------
// A 7x7 grid has 2*7*6 = 84 total interior edges; the spanning tree that guarantees full
// connectivity always uses exactly GRID_SIZE*GRID_SIZE - 1 = 48 of them, leaving 36 "non-tree"
// candidates. A handful become extra real loop-edges (so it's not one fragile single path). EVERY
// remaining edge becomes a locked (fake) door rather than a plain invisible wall — every wall in
// the maze is a door you can walk up to and try, real or not, so a dead end always reads as
// "several doors here, all locked" rather than "no doors here at all" (per direct feedback).
export const EXTRA_LOOP_EDGE_COUNT = 8;
export const FAKE_DOOR_FRACTION = 1;

// --- Movement / collision (room-units — 1.0 = one room width/height, independent of pixel
// rendering scale) -----------------------------------------------------------------------------
export const PLAYER_RADIUS = 0.16;
// Free (not grid-locked) movement speed, in room-units per second — held WASD keys combine into a
// real direction vector (diagonals included), resolved against walls/closed doors per axis.
export const PLAYER_SPEED = 1.5;
// Noticeably faster than the human's own (deliberately slow) pace — "better" CPUs, per direct
// feedback, combining this with the quicker decision pacing below.
export const CPU_MOVE_SPEED = 1.9;
// How far outside the grid each player's own starting "vestibule" extends, and how tightly their
// lateral position is held near their own entrance while out there.
export const VESTIBULE_DEPTH = 0.85;
export const VESTIBULE_LATERAL_CLAMP = 0.6;
// How close (along the wall-facing axis, in room-units) a player must stand to actually attempt
// opening the nearest closed door — doesn't matter which way they're currently facing, just
// proximity to the wall itself.
export const DOOR_INTERACT_DISTANCE = 0.42;

// --- Door swing animation ----------------------------------------------------------------------
// Each door is a small SECTION centered in the middle of its wall (not the whole wall), flanked on
// both sides by a plain, permanently solid stub of ordinary wall — and rendered in DOOR_COLOR, a
// distinct color from the wall itself, so a door is visually obvious at a glance even before it's
// tried (real vs. fake still looks identical — only "is this a door at all" is now visible, not
// "will it open"). Opening swings the door panel a full 90°, from flush along its own wall to
// flush along the room's OTHER wall (hinged at the near end of the door's own short span) — fully
// out of the passage and parallel to a wall at both ends of the swing.
//
// Kept at or below 1/3: a centered door's hinge sits DOOR_OFFSET = (1-DOOR_LENGTH_FRACTION)/2 of a
// cell away from its nearest corner, and the swing never reaches closer to that corner than
// DOOR_OFFSET while its perpendicular reach never exceeds DOOR_LENGTH_FRACTION — so
// DOOR_OFFSET >= DOOR_LENGTH_FRACTION (i.e. length <= 1/3) guarantees a door's swept arc can never
// reach far enough to cross an adjacent wall's own door swinging open into the same shared corner.
// Above 1/3 this was visibly happening — two doors on adjacent walls of the same room, both open,
// overlapping near the corner they share.
export const DOOR_LENGTH_FRACTION = 0.3;
export const WALL_COLOR = "#4a4256";
export const DOOR_COLOR = "#b08968";
export const DOOR_SWING_OPEN_MS = 320;
export const DOOR_SWING_SHUT_MS = 900;
// How long the small red "X" stays on screen after a failed (fake-door) open attempt.
export const FAILED_MARKER_MS = 550;
// How long the results overlay waits after the door-swing-shut sweep finishes before appearing —
// a beat to let the shutting animation actually read before the screen changes again.
export const ENDING_HOLD_MS = 700;

// --- CPU pacing -------------------------------------------------------------------------------
// Each CPU rolls a persistent 0..1 "skill" once at game start (Stampede's rollCpuSkill
// convention) that governs how quickly it decides what to do next — higher skill = faster, more
// confident decisions. Actual movement speed (CPU_MOVE_SPEED) is fixed/shared, matching the
// human's own movement physics; only the THINKING pace varies.
export const CPU_DECISION_INTERVAL_SLOW_MS = 450;
export const CPU_DECISION_INTERVAL_FAST_MS = 130;
export const CPU_DECISION_JITTER = 0.35; // +/- fraction, so the same CPU doesn't tick metronomically
// CPUs wait a little before their very first decision, so the game doesn't look like it's racing
// ahead of the human before they've even gotten their bearings.
export const CPU_FIRST_DECISION_DELAY_MS = 900;

// --- Rendering --------------------------------------------------------------------------------
export const GRID_MARGIN = 25; // px of breathing room around the full (grid + vestibule) layout
export const OUTER_BORDER_WIDTH = 12; // px — thick, high-contrast frame around the grid perimeter
export const WALL_WIDTH = 5; // px — regular interior door/wall line weight
