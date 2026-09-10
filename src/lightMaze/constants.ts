export const CANVAS_W = 1400;
export const CANVAS_H = 1480;
export const HUD_HEIGHT = 60;

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
// A handful become extra real loop-edges (so it's not one fragile single path). EVERY remaining
// edge becomes a locked (fake) door rather than a plain invisible wall — every wall in the maze
// is a door you can walk up to and try, real or not, so a dead end always reads as "several doors
// here, all locked" rather than "no doors here at all" (per direct feedback).
export const EXTRA_LOOP_EDGE_COUNT = 4;
export const FAKE_DOOR_FRACTION = 1;

// --- Movement / collision (room-units — 1.0 = one room width/height, independent of pixel
// rendering scale) -----------------------------------------------------------------------------
export const PLAYER_RADIUS = 0.16;
// Free (not grid-locked) movement speed, in room-units per second — held WASD keys combine into a
// real direction vector (diagonals included), resolved against walls/closed doors per axis.
export const PLAYER_SPEED = 2.4;
export const CPU_MOVE_SPEED = 2.1;
// How far outside the grid each player's own starting "vestibule" extends, and how tightly their
// lateral position is held near their own entrance while out there.
export const VESTIBULE_DEPTH = 0.85;
export const VESTIBULE_LATERAL_CLAMP = 0.6;
// How close (along the wall-facing axis, in room-units) a player must stand to actually attempt
// opening the door they're facing — "right in front of it", not just anywhere in the room.
export const DOOR_INTERACT_DISTANCE = 0.42;

// --- Door swing animation ----------------------------------------------------------------------
// Closed doors span (almost) the FULL wall, hinged at one corner — visually identical to a solid
// wall whether real, fake, or (structurally still possible, just unused by mazeGen now)
// unassigned. Opening swings the whole panel 90°, from flush along its own wall to flush along
// the room's OTHER wall at that same corner — fully out of the passage and parallel to a wall the
// entire time, at both ends of the swing.
export const DOOR_LENGTH_FRACTION = 0.96;
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
export const CPU_DECISION_INTERVAL_SLOW_MS = 650;
export const CPU_DECISION_INTERVAL_FAST_MS = 220;
export const CPU_DECISION_JITTER = 0.35; // +/- fraction, so the same CPU doesn't tick metronomically
// CPUs wait a little before their very first decision, so the game doesn't look like it's racing
// ahead of the human before they've even gotten their bearings.
export const CPU_FIRST_DECISION_DELAY_MS = 900;

// --- Rendering --------------------------------------------------------------------------------
export const GRID_MARGIN = 20; // px of breathing room around the full (grid + vestibule) layout
export const OUTER_BORDER_WIDTH = 12; // px — thick, high-contrast frame around the grid perimeter
export const WALL_WIDTH = 5; // px — regular interior door/wall line weight
