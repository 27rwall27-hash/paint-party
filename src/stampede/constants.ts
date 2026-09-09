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

// Obstacle pacing, per phase — spawn interval and scroll speed at the moment a race enters that
// phase (a brand-new race, e.g. the one created at a split, starts here); RACE_RAMP_* below then
// tightens both further over that race's own lifetime, capping at the floor/ceiling values.
export const PHASE_BASE_SPAWN_MS: Record<"SINGLE" | "TWO_WAY" | "THREE_WAY", number> = {
  SINGLE: 1800,
  TWO_WAY: 1500,
  THREE_WAY: 1150,
};
export const PHASE_BASE_SPEED: Record<"SINGLE" | "TWO_WAY" | "THREE_WAY", number> = {
  SINGLE: 380,
  TWO_WAY: 430,
  THREE_WAY: 500,
};
// A race's own spawn interval shrinks and speed grows linearly over its first RACE_RAMP_MS of
// life, then holds — so a long-lived continuing race (top/middle band) still gets meaningfully
// harder over time, not just at phase boundaries.
export const RACE_RAMP_MS = 20_000;
export const RACE_RAMP_SPAWN_FLOOR_MS = 750;
export const RACE_RAMP_SPEED_CEILING = 640;

// Total distance (px) an obstacle travels from spawning (off the right edge of its band) to the
// hit line where it resolves against the racers — same for every phase; only scroll SPEED (see
// PHASE_BASE_SPEED) changes how long that travel takes.
export const OBSTACLE_TRAVEL_PX = 900;
// Fixed x position (within a band, measured from its left edge) where the racers stand and an
// obstacle resolves against them once its remaining distance reaches 0.
export const HIT_LINE_X = 180;

// Per-identity base jump-success chance, randomized once at game start within this range — most
// CPUs usually clear a jump but occasionally fail, giving the human a real chance without making
// CPUs feel hapless.
export const CPU_BASE_SKILL_MIN = 0.72;
export const CPU_BASE_SKILL_MAX = 0.94;
// Each race clone re-rolls a fresh per-race skill for every CPU racer, jittered around their base
// skill by up to this much — so the same identity can genuinely diverge across parallel races
// instead of succeeding/failing in lockstep everywhere.
export const CPU_SKILL_JITTER = 0.08;
