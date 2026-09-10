// Tuning for Battle Royale mode — kept separate from Classic mode's constants.ts so this mode's
// (very different) numbers don't get tangled up with Classic's already-many-times-tuned ones. All
// first-pass estimates, same spirit as every other constant in this project — expect retuning once
// actually played.

export const BR_SECTIONS = 3;
export const BR_SLOTS_PER_SECTION = 8;
export const BR_TOTAL_PLAYERS = BR_SECTIONS * BR_SLOTS_PER_SECTION; // 24

// Jump airtime/arc height are FIXED for every racer (no rank-based scaling — there's no rank here),
// set equal to Classic mode's rank-1 ("2nd place") value. See jumpAirtimeMsForRank(1)/
// jumpArcHeightPxForRank(1) in RaceInstance.ts — reused directly in BattleRoyaleSession.ts rather
// than duplicated as a number here, so it can never drift out of sync with Classic's own formula.
export const BR_JUMP_RANK_EQUIVALENT = 1;

// CPUs are noticeably better than Classic's (0.72-0.94) — a real elimination format needs most of
// the field clearing most hurdles, with failures still happening often enough (helped along by the
// escalating checkpoint speed below) that 23 CPUs actually do thin out over the course of a match.
export const BR_CPU_SKILL_MIN = 0.93;
export const BR_CPU_SKILL_MAX = 0.985;
export const BR_CPU_SKILL_JITTER = 0.03;

// Base obstacle timing (shared identically across all 3 sections — see BattleRoyaleSession.ts).
export const BR_LEAD_IN_BASE_MS = 1450;
export const BR_COLUMN_GAP_BASE_MS = 175;
export const BR_LEAD_IN_FLOOR_MS = 950;
export const BR_COLUMN_GAP_FLOOR_MS = 60;
// Wider than Classic's OBSTACLE_TIMING_JITTER (0.12) — "these hurdles will vary in speed more".
export const BR_TIMING_JITTER = 0.28;

export const BR_SPAWN_GAP_BASE_MS = 950;
export const BR_SPAWN_GAP_FLOOR_MS = 500;
export const BR_SPAWN_GAP_JITTER = 0.4;

// A wave has a chance of stacking 2 or 3 hurdles back-to-back instead of just 1 — staggered close
// enough that clearing them means genuinely quick back-to-back jumps, but still within reach of the
// fixed BR_JUMP_RANK_EQUIVALENT airtime.
export const BR_STACK_TWO_CHANCE = 0.3;
export const BR_STACK_THREE_CHANCE = 0.1; // on top of already stacking two
export const BR_STACK_STAGGER_MIN_MS = 480;
export const BR_STACK_STAGGER_MAX_MS = 700;

// Every this-many CUMULATIVE eliminations (across all 3 sections), the game pauses — no spawning,
// no resolution — for a beat of "X eliminated" messaging, then resumes with the base timing
// (leadIn/columnGap/spawnGap) multiplied down by (1 - BR_CHECKPOINT_SPEED_STEP_PCT) per checkpoint
// crossed so far, floor-clamped by the *_FLOOR_MS constants above. Jitter fractions stay the same —
// only the baseline speeds up.
export const BR_CHECKPOINT_EVERY_ELIMINATIONS = 4;
export const BR_CHECKPOINT_PAUSE_MS = 2600;
export const BR_CHECKPOINT_SPEED_STEP_PCT = 0.09;

// How long an eliminated racer's fly-off-screen animation takes before they stop being drawn
// entirely.
export const BR_ELIMINATION_FLY_MS = 650;

// Once the field is down to this many players or fewer, main.ts plays Paint Party's own countdown
// tick (sound.playTick) once per further elimination — "5 remaining", "4 remaining", ... "1
// remaining" — the same down-to-the-wire cue Paint Party uses for a round's last 5 seconds.
export const BR_TICK_REMAINING_THRESHOLD = 5;

// The sun's displayed position eases toward its "totalEliminated / (TOTAL-1)" target with this time
// constant (see BattleRoyaleSession's sunT), rather than snapping there the instant an elimination
// happens — a single elimination should nudge the sky along smoothly, not jump-cut it.
export const BR_SUN_EASE_TAU_MS = 3500;
