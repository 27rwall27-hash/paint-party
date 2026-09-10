export const CANVAS_W = 1280;
export const CANVAS_H = 720;
export const HUD_HEIGHT = 56;

export const PLAYER_COUNT = 4;
export const GRID_SIZE = 5;
export const MID_INDEX = 2; // the middle row/col index of a 5-wide grid — where each entrance sits

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
// A 5x5 grid has 40 total interior edges; the spanning tree that guarantees full connectivity
// always uses exactly GRID_SIZE*GRID_SIZE - 1 = 24 of them, leaving 16 "non-tree" candidates.
// First-pass split of those 16, same "expect retuning" spirit as every other constant in this
// suite: a handful become extra real loop-edges (so it's not one fragile single path), and of
// what's left, roughly half become permanently-fake trap doors rather than plain invisible walls
// — visible, temptable, and useless, which is the deliberate "remember which doors don't open"
// mechanic — with the rest staying plain solid walls.
export const EXTRA_LOOP_EDGE_COUNT = 4;
export const FAKE_DOOR_FRACTION = 0.5;

// --- Movement / animation --------------------------------------------------------------------
// How long it takes to glide from one room's center to an adjacent one's, for both the human and
// CPUs — one room at a time, no skipping.
export const MOVE_DURATION_MS = 420;
// How long a door's hinge takes to swing fully open once opened, and how long the end-of-game
// "every open door slams shut" sweep takes.
export const DOOR_SWING_OPEN_MS = 260;
export const DOOR_SWING_SHUT_MS = 900;
// How long the small red "X" stays on screen after a failed (fake-door) open attempt.
export const FAILED_MARKER_MS = 550;
// How long the results overlay waits after the door-swing-shut sweep finishes before appearing —
// a beat to let the shutting animation actually read before the screen changes again.
export const ENDING_HOLD_MS = 700;

// --- CPU pacing -------------------------------------------------------------------------------
// Each CPU rolls a persistent 0..1 "skill" once at game start (Stampede's rollCpuSkill
// convention) that governs how quickly it acts — higher skill = faster, more confident decisions.
// Interpolated the same way Stampede's rank-based jump timing is: skill 0 -> SLOW, skill 1 -> FAST.
export const CPU_DECISION_INTERVAL_SLOW_MS = 950;
export const CPU_DECISION_INTERVAL_FAST_MS = 420;
export const CPU_DECISION_JITTER = 0.35; // +/- fraction, so the same CPU doesn't tick metronomically
// CPUs wait a little before their very first decision, so the game doesn't look like it's racing
// ahead of the human before they've even gotten their bearings.
export const CPU_FIRST_DECISION_DELAY_MS = 900;

// --- Rendering --------------------------------------------------------------------------------
export const GRID_MARGIN = 24; // px of breathing room around the 5x5 grid within the canvas
