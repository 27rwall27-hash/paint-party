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

// Once a phase reaches its nominal duration, every currently active race stops spawning NEW
// obstacle waves (updateRace's `suppressSpawns`) — whatever's already in flight is left to finish
// naturally, but nothing new starts. This is what actually guarantees the races go quiet in a
// bounded amount of time: earlier this waited for every race's independent obstacle cycle to
// happen to be simultaneously clear at the same instant, which for 2+ races is a real coincidence
// that isn't guaranteed to turn up quickly (measured up to 100+ seconds, and once in testing not
// at all in 10 simulated minutes) - suppressing new spawns instead of hoping for a lucky alignment
// means "quiet" is just "however long the LAST obstacle already in flight takes to finish," a
// bounded few seconds, not a coincidence. Once every race is confirmed clear, PRE_SPLIT_QUIET_MS
// of genuine silence (see StampedeSession.maybeSplit) plays out — nothing left to dodge, players
// get a real beat to see the split coming — before the split actually executes.
export const PRE_SPLIT_QUIET_MS = 5000;
// Defensive-only hard ceiling on the total pending-split wait (from becoming eligible to the
// split actually firing) — not expected to matter in practice now that spawning is suppressed
// rather than waited-out, but keeps a bound in place regardless of any future change to this
// logic.
export const ABSOLUTE_MAX_SPLIT_WAIT_MS = 16_000;

// Placement -> points, index 0 = 1st place ... index 7 = 8th place. Only ever applied at the end
// of the three simultaneous final races (see StampedeSession) — the earlier single/two-way phases
// are pure setup, no scoring.
export const POINTS_BY_RANK: number[] = [10, 8, 6, 5, 4, 3, 1, 0];

// How long a jump keeps a racer airborne (and thus safe from the current obstacle), and how high
// the leap visually arcs — both now scale with RANK rather than being flat. 1st place gets the
// tightest, least forgiving window and the lowest hop (a bit tighter than the old flat 715ms —
// holding 1st shouldn't just mean faster/clustered obstacles, the jump itself needs to stay hard
// too), while last place leaps dramatically higher and stays airborne much longer — falling behind
// isn't just "more warning," it's also physically easier to clear the thing. See
// jumpAirtimeMsForRank/jumpArcHeightPxForRank in RaceInstance.ts.
export const JUMP_AIRTIME_FIRST_MS = 550;
export const JUMP_AIRTIME_LAST_MS = 1050;
export const JUMP_ARC_HEIGHT_FIRST_PX = 28;
export const JUMP_ARC_HEIGHT_LAST_PX = 82;

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
// over time, not just at phase boundaries. Ramps faster and to a tighter floor than the first pass
// did — staying comfortably in 1st for a while was feeling too easy, and this is the lever that
// specifically punishes that (rather than a second simultaneous obstacle, which read as too hard).
export const RACE_RAMP_MS = 14_000;
export const RACE_RAMP_LEAD_IN_FLOOR_MS = 1100;
export const RACE_RAMP_COLUMN_GAP_FLOOR_MS = 75;

// Gap between one wave fully clearing the last column and the next wave spawning.
export const PHASE_BASE_SPAWN_MS: Record<"SINGLE" | "TWO_WAY" | "THREE_WAY", number> = {
  SINGLE: 900,
  TWO_WAY: 700,
  THREE_WAY: 500,
};
export const RACE_RAMP_SPAWN_FLOOR_MS = 280;
// Each spawn gap is jittered by +/- this fraction. Without ANY randomness here, once two or more
// races have both fully ramped to their floor pacing their obstacle cycles become perfectly fixed
// periods with a FIXED relative phase to each other — if that phase never happens to put both
// races between obstacles at the same instant, they never will (a real, permanent soft-lock this
// surfaced in testing: a session sat in TWO_WAY for 10+ simulated minutes waiting for a split that
// was never coming). This jitter keeps the relative phase between races perpetually drifting
// instead of frozen, so an overlapping "both clear" moment is guaranteed eventually.
export const SPAWN_INTERVAL_JITTER = 0.35;

// A second simultaneous obstacle was tried as a rare difficulty spike and turned out to feel too
// hard rather than "occasionally spicy" — back to a single obstacle per wave, always. Left at 0
// (rather than ripping out the RaceInstance.obstacles[] plumbing) so the wave/multi-obstacle
// machinery stays available to dial back up later without another rewrite.
export const MULTI_OBSTACLE_CHANCE = 0;
export const MULTI_OBSTACLE_STAGGER_MIN_MS = 350;
export const MULTI_OBSTACLE_STAGGER_MAX_MS = 750;

// Cross-band clustering: when a race's wave finishes and it schedules its NEXT obstacle, there's a
// good chance it instead snaps to line up with another currently-idle race's already-upcoming
// obstacle (still exactly one obstacle per band — this never stacks two obstacles in the SAME
// race). With 2 or 3 active bands, this means holding 1st place everywhere stops being one easy,
// fully predictable reflex repeated in isolation — obstacles across bands land close together
// often enough that clearing all of them means genuinely dividing attention between
// near-simultaneous threats in different bands, the same kind of challenge that naturally shows up
// when you're at different ranks in different races.
export const CLUSTER_CHANCE = 0.6;
// Only clusters onto another race's spawn if it's already scheduled within this many ms.
export const CLUSTER_WINDOW_MS = 900;
// Small random offset applied even when clustering, so aligned obstacles aren't literally
// frame-identical every time.
export const CLUSTER_STAGGER_MAX_MS = 80;

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
