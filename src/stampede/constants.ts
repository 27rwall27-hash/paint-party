export const CANVAS_W = 1280;
export const CANVAS_H = 720;

export const RACER_COUNT = 8;

// A small, distinct palette for 8 racers — copied (not imported) from Paint Party's own preset
// list so the two games stay fully decoupled, per the suite's isolation principle.
export const PRESET_COLORS: string[] = [
  "#e63946", // red
  "#f3722c", // orange
  "#ffd60a", // gold
  "#90be6d", // light green
  "#2ecc71", // green
  "#277da1", // steel blue
  "#3a86ff", // bright blue
  "#9d4edd", // purple
];

export const CPU_NAME_PREFIX = "CPU";

// Phase durations — mid-range of the user's given windows (35-45s, 35-45s, 25-30s). First-pass
// estimates; expect these to need live-playtest tuning, same as every difficulty constant in
// Paint Party's own CpuController did this session.
export const SINGLE_PHASE_MS = 40_000;
export const TWO_WAY_PHASE_MS = 40_000;
export const THREE_WAY_PHASE_MS = 27_000;

// Placement -> points, index 0 = 1st place ... index 7 = 8th place. Only ever applied at the end
// of the three simultaneous final races (see StampedeSession) — the earlier single/two-way phases
// are pure setup, no scoring.
export const POINTS_BY_RANK: number[] = [10, 8, 6, 5, 4, 3, 1, 0];

// How long a jump keeps a racer airborne (and thus safe from the current obstacle) once triggered.
export const JUMP_AIRTIME_MS = 550;
// A jump's upward arc peaks at this fraction of the way through its airtime.
export const JUMP_ARC_HEIGHT_PX = 46;

// Each of the 8 racers in a race has their OWN independently-scheduled obstacle stream (spawns at
// different times per racer — see RaceInstance) but every obstacle in a given race travels at the
// same shared pace: expressed directly as a travel TIME (spawn -> hit-line), not a pixel speed, so
// it's automatically scale-invariant as bands shrink across phases (a column half as tall doesn't
// implicitly make the game harder on top of the intentional difficulty ramp below).
export const PHASE_BASE_REACTION_MS: Record<"SINGLE" | "TWO_WAY" | "THREE_WAY", number> = {
  SINGLE: 2200,
  TWO_WAY: 1850,
  THREE_WAY: 1450,
};
// A race's own reaction time shrinks linearly over its first RACE_RAMP_MS of life, then holds at
// the floor — so a long-lived continuing race (top/middle band) still gets meaningfully harder
// over time, not just at phase boundaries.
export const RACE_RAMP_MS = 20_000;
export const RACE_RAMP_REACTION_FLOOR_MS = 950;

// Base gap between one obstacle and the next FOR THE SAME RACER, per phase — RACE_RAMP_MS tightens
// this too, down to RACE_RAMP_SPAWN_FLOOR_MS. Each actual spawn jitters this by +/-
// SPAWN_INTERVAL_JITTER so 8 racers sharing the same formula still desync from each other over
// time instead of just drifting by whatever fixed offset they happened to start with.
export const PHASE_BASE_SPAWN_MS: Record<"SINGLE" | "TWO_WAY" | "THREE_WAY", number> = {
  SINGLE: 1800,
  TWO_WAY: 1500,
  THREE_WAY: 1150,
};
export const RACE_RAMP_SPAWN_FLOOR_MS = 750;
export const SPAWN_INTERVAL_JITTER = 0.3;

// Ground level within a band — a fraction of the band's own height where every runner stands and
// every obstacle travels, matching the classic endless-runner convention (the T-Rex game this is
// modeled on): characters and obstacles share one ground line, obstacles move HORIZONTALLY along
// it, and jumping is the only thing that moves a runner off it (briefly, vertically).
export const GROUND_Y_FRACTION = 0.8;
// Where a column's obstacle track sits, as a fraction of the COLUMN'S OWN WIDTH — 0 = the
// column's left edge, 1 = its right edge. The hit-line (where the runner stands, and where an
// obstacle resolves) sits near the left; the obstacle "spawns" (progress 0) near the right and
// slides toward it — same left-to-right-facing motion as the original game, just miniaturized to
// fit inside one racer's own ~150px-wide column instead of the full screen. Fractions, not
// pixels, so this scales automatically with column width too.
export const OBSTACLE_SPAWN_FRACTION = 0.94;
export const HIT_LINE_FRACTION = 0.24;

// Per-identity base jump-success chance, randomized once at game start within this range — most
// CPUs usually clear a jump but occasionally fail, giving the human a real chance without making
// CPUs feel hapless.
export const CPU_BASE_SKILL_MIN = 0.72;
export const CPU_BASE_SKILL_MAX = 0.94;
// Each race clone re-rolls a fresh per-race skill for every CPU racer, jittered around their base
// skill by up to this much — so the same identity can genuinely diverge across parallel races
// instead of succeeding/failing in lockstep everywhere.
export const CPU_SKILL_JITTER = 0.08;
