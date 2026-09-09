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

// How long a jump keeps a racer airborne (and thus safe from the current obstacle) once triggered
// — 550 * 1.3, a deliberately generous tolerance bump so mistimed-but-close clicks/CPU jumps
// still clear the obstacle more often.
export const JUMP_AIRTIME_MS = 715;
// A jump's upward arc peaks at this fraction of the way through its airtime.
export const JUMP_ARC_HEIGHT_PX = 46;

// ONE shared obstacle per race — not one per racer. It sweeps across the whole band once per
// wave, right to left, so it reaches the current 1st place (rightmost column) almost immediately
// and the current last place (leftmost column) last — each racer still jumps at a different
// moment, purely because they're standing at a different x, exactly like a single hurdle passing
// down a lined-up row of people. LEAD_IN is the time from spawn to reaching the FIRST column —
// every racer's guaranteed minimum reaction window, regardless of rank — and COLUMN_GAP is the
// extra time between reaching each successive column after that (so a straggler in back gets
// progressively more warning, having watched it clear everyone ahead of them first). Both are
// travel TIMES, not pixel speeds, so this stays scale-invariant as bands shrink across phases.
export const PHASE_BASE_LEAD_IN_MS: Record<"SINGLE" | "TWO_WAY" | "THREE_WAY", number> = {
  SINGLE: 3200,
  TWO_WAY: 2600,
  THREE_WAY: 2000,
};
export const PHASE_BASE_COLUMN_GAP_MS: Record<"SINGLE" | "TWO_WAY" | "THREE_WAY", number> = {
  SINGLE: 220,
  TWO_WAY: 190,
  THREE_WAY: 160,
};
// A race's own lead-in/column-gap shrink linearly over its first RACE_RAMP_MS of life, then hold
// at the floor — so a long-lived continuing race (top/middle band) still gets meaningfully harder
// over time, not just at phase boundaries.
export const RACE_RAMP_MS = 20_000;
export const RACE_RAMP_LEAD_IN_FLOOR_MS = 1400;
export const RACE_RAMP_COLUMN_GAP_FLOOR_MS = 100;

// Gap between one wave fully clearing the last column and the next wave spawning.
export const PHASE_BASE_SPAWN_MS: Record<"SINGLE" | "TWO_WAY" | "THREE_WAY", number> = {
  SINGLE: 900,
  TWO_WAY: 700,
  THREE_WAY: 500,
};
export const RACE_RAMP_SPAWN_FLOOR_MS = 350;

// Ground level within a band — a fraction of the band's own height where every runner stands and
// the shared obstacle travels, matching the classic endless-runner convention (the T-Rex game
// this is modeled on): characters and the obstacle share one ground line, the obstacle moves
// HORIZONTALLY along it (right to left, across the WHOLE band width now — see RaceInstance), and
// jumping is the only thing that moves a runner off it (briefly, vertically).
export const GROUND_Y_FRACTION = 0.8;

// The 8 racers cluster together near the LEFT of the band (not spread across its full width) —
// leaves a long, clearly visible runway on the right for the obstacle to approach across before
// it ever reaches anyone, and keeps the pack itself tight instead of spanning the whole screen.
// Both fractions of the band's own width.
export const PACK_LEFT_FRACTION = 0.03;
export const PACK_WIDTH_FRACTION = 0.42;

// How fast a racer's drawn position slides toward their current rank's column when it changes,
// in pack-column-widths per second — rank changes used to snap instantly, which was disorienting
// to watch while also trying to time your own jump (someone failing elsewhere in the line could
// silently teleport YOUR column sideways). At this rate the most extreme case (last place to
// first, all in one motion) takes a bit over 2 seconds to visibly settle instead of happening in
// a single frame.
export const SLIDE_SPEED_SLOTS_PER_SEC = 3;

// A racer who fails doesn't reorder (or even start sliding to their new last-place spot)
// immediately — that used to mean rank changes trickled out DURING a sweep, so a racer's own
// column could shift out from under them mid-obstacle for a reason that had nothing to do with
// their own jump. Instead a failure now only flies that one racer's drawn position OFF-SCREEN to
// the left (fast — see KNOCKOUT_FLY_SPEED_SLOTS_PER_SEC), and the ENTIRE wave's actual rank
// reordering happens as one batch once every racer has been resolved (see updateRace) — only
// then do the knocked-out racers reappear from off-screen and everyone (not just them) glides to
// their real new position together.
export const KNOCKOUT_OFFSCREEN_SLOT = -2.5;
export const KNOCKOUT_FLY_SPEED_SLOTS_PER_SEC = 14;

// Per-identity base jump-success chance, randomized once at game start within this range — most
// CPUs usually clear a jump but occasionally fail, giving the human a real chance without making
// CPUs feel hapless.
export const CPU_BASE_SKILL_MIN = 0.72;
export const CPU_BASE_SKILL_MAX = 0.94;
// Each race clone re-rolls a fresh per-race skill for every CPU racer, jittered around their base
// skill by up to this much — so the same identity can genuinely diverge across parallel races
// instead of succeeding/failing in lockstep everywhere.
export const CPU_SKILL_JITTER = 0.08;
