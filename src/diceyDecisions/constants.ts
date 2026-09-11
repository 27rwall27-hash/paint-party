export const CANVAS_W = 1400;
export const CANVAS_H = 1000;
export const HUD_HEIGHT = 60;

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

// --- Rounds -------------------------------------------------------------------------------
// {sections, dicePerSection} per round. The first 5 are the user's own examples; round 6 is a
// filled-in finale (the user said "let's say 6 rounds" but only gave 5) — a clean 3x3 grid with
// a moderate dice count per section, first-pass and easy to swap. See layout.ts's
// SECTION_GRID_SHAPES for why every section count here was chosen to factor into a clean grid.
export interface RoundConfig {
  sections: number;
  dicePerSection: number;
}
export const ROUND_CONFIGS: RoundConfig[] = [
  { sections: 4, dicePerSection: 5 },
  { sections: 6, dicePerSection: 4 },
  { sections: 4, dicePerSection: 9 },
  { sections: 8, dicePerSection: 3 },
  { sections: 2, dicePerSection: 20 },
  { sections: 9, dicePerSection: 4 },
];

// 1st/2nd/3rd/4th CORRECT selection, ranked by speed — not by finishing position overall. Anyone
// wrong, or who never selects, gets 0 regardless of how fast they were.
export const POINTS_BY_RANK: number[] = [5, 3, 2, 1];

// --- Round phase timing (ms) ----------------------------------------------------------------
// Full round flow: SLIDING_IN (fresh box slides in from the right) -> SHAKING (closed box
// rattles in place, dice audibly tumbling inside) -> OPENING (lid swings up) -> PLAYING ->
// SCORED (winning section glows) -> CLOSING (lid swings shut) -> SLIDING_OUT (box slides off to
// the left) -> next round's SLIDING_IN, or RESULTS after the last round.
export const SLIDE_DURATION_MS = 700;
export const SHAKING_DURATION_MS = 1400;
export const LID_OPEN_DURATION_MS = 900;
// Generous but bounded — a round always ends even if someone never commits to an answer. Must
// comfortably clear the slowest possible CPU reaction (REACTION_SLOW_MS * (1+REACTION_JITTER)
// below) with room to spare for a human still counting pips on a dense round.
export const PLAYING_TIMEOUT_MS = 16_000;
export const SCORED_HOLD_MS = 2200;
export const LID_CLOSE_DURATION_MS = 800;

// How far off-center (world X) a box sits when fully slid out — comfortably outside the camera's
// frustum at this box's distance/tilt (verified visually, see sceneBuilder.ts's box-slide check).
export const SLIDE_DISTANCE = 26;

// --- Shake (SHAKING phase) ----------------------------------------------------------------------
export const SHAKE_AMPLITUDE_X = 0.18;
export const SHAKE_AMPLITUDE_Z = 0.12;
export const SHAKE_ROT_AMPLITUDE_RAD = 0.035;

// --- CPU pacing --------------------------------------------------------------------------------
// Each CPU rolls a persistent 0..1 "skill" once at game start (same convention as every other
// game's rollCpuSkill) that governs both how fast AND how accurately it answers. Unlike Light
// Maze's CPUs (which re-decide every tick while navigating), a Dicey Decisions CPU only ever
// makes ONE decision per round — computed the instant that round enters PLAYING. Slowed down
// from the first pass (900-4500ms) — CPUs were winning before a human could even finish scanning
// the board, which isn't a fair race.
export const REACTION_SLOW_MS = 9000;
export const REACTION_FAST_MS = 3500;
export const REACTION_JITTER = 0.3; // +/- fraction, so the same CPU doesn't answer on a metronome
export const MIN_REACTION_MS = 1800;
// Never 100% even at max skill — a "better" CPU is faster AND more accurate, but can still blink.
export const ACCURACY_MIN = 0.5;
export const ACCURACY_MAX = 0.92;

// --- Dice generation --------------------------------------------------------------------------
export const MAX_REROLL_ITERATIONS = 200;

// --- Scene geometry (world units — DIE_SIZE = 1 is the base unit everything else is scaled
// against) --------------------------------------------------------------------------------------
export const DIE_SIZE = 1;
export const PLACEMENT_JITTER_FRACTION = 0.7; // fraction of each slot's own remaining slack
export const OVERLAP_SAFETY_MARGIN = 1.18; // dice shrink (never grow) if a slot would be tighter than this
// Inset from a section's own edges (where the walls/dividers are) that dice placement never uses
// — keeps every die a visible gap clear of the walls regardless of round density.
export const DICE_WALL_MARGIN = 0.9;

export const FLOOR_WIDTH = 16;
export const FLOOR_DEPTH = 11;
export const WALL_HEIGHT = 2.2;
export const WALL_THICKNESS = 0.6;
export const FLOOR_THICKNESS = 0.5;
export const DIVIDER_HEIGHT = 0.9;
export const DIVIDER_THICKNESS = 0.3;

export const LID_OPEN_ANGLE_RAD = Math.PI * 0.62; // past vertical, so it visually clears the view

export const FELT_COLOR = 0x1f6b3a;
export const FELT_COLOR_HOVER = 0x2a8a4d;
// Deep mahogany/rosewood — a dark, saturated red-brown. Kept well clear of pink: low lightness,
// red channel meaningfully ahead of green/blue.
export const WOOD_COLOR = 0x431912;
export const WOOD_DARK_COLOR = 0x220c08;
export const WINNING_EMISSIVE = 0xffd60a;

// "Gleam" comes from MeshPhysicalMaterial's clearcoat layer (a glossy varnish coat on top of the
// wood grain) rather than an environment map — see boxMaterials.ts. Pushed high for a genuinely
// glossy, lacquered look.
export const BOX_CLEARCOAT = 0.95;
export const BOX_CLEARCOAT_ROUGHNESS = 0.045;
export const BOX_ROUGHNESS = 0.3;

export const SHADOWS_ENABLED = true;

// --- Peg wall (per-section selection markers) -----------------------------------------------
// Every section gets its own small dedicated pedestal wall standing on the felt just south of its
// north (far-from-camera) boundary — deliberately independent of whatever real wall/divider is at
// that boundary, so every section's peg wall is identically sized regardless of whether that
// boundary happens to be the outer box wall or a thinner interior divider. Holes are drilled
// straight through its flat top; pegs stand up out of them (0 = far left = first to pick that
// section).
export const PEG_RADIUS = 0.12;
export const PEG_LENGTH = 0.75;
export const PEG_WALL_HEIGHT = 0.5;
export const PEG_WALL_THICKNESS = 0.4;
// Gap between the exact grid boundary line and this pedestal — purely cosmetic breathing room,
// same for every section since the pedestal never actually touches the real wall/divider.
export const PEG_WALL_GAP = 0.2;
export const PEG_HOLE_RADIUS = 0.16;
export const PEG_HOLE_MARGIN_FRACTION = 0.18; // inset from each section's own edges

// --- Camera / lighting -------------------------------------------------------------------------
export const CAMERA_FOV = 38;
export const CAMERA_HEIGHT = 22;
export const CAMERA_BACK = 9; // offset behind box center, for a "near top-down" angle with real depth
export const AMBIENT_LIGHT_INTENSITY = 2.2;
export const KEY_LIGHT_INTENSITY = 2.6;
