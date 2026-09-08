export const CANVAS_W = 1280;
export const CANVAS_H = 720;

// The ornate picture frame's border thickness — shared between render.ts (drawing it, and sizing
// the curtain to fully mask it) and Player.ts (keeping players from wandering behind it).
export const FRAME_THICKNESS = 44;

export type PowerupType = "shrink" | "sweep" | "machinegun" | "clear" | "eraser" | "bigshot" | "confuse";

export interface KeyBinding {
  up: string;
  down: string;
  left: string;
  right: string;
  paint: string;
}

export interface PlayerDef {
  name: string;
  color: string;
  keys: KeyBinding;
}

export const PLAYER_DEFS: PlayerDef[] = [
  {
    name: "P1",
    color: "#e63946",
    keys: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", paint: "Space" },
  },
  {
    name: "P2",
    color: "#3a86ff",
    keys: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", paint: "Slash" },
  },
  {
    name: "P3",
    color: "#ffd60a",
    keys: { up: "KeyI", down: "KeyK", left: "KeyJ", right: "KeyL", paint: "KeyO" },
  },
  {
    name: "P4",
    color: "#2ecc71",
    keys: { up: "KeyT", down: "KeyG", left: "KeyF", right: "KeyH", paint: "KeyR" },
  },
];

/** Every key referenced by any player's bindings — used to know which keys to preventDefault(). */
export const ALL_BOUND_KEYS = new Set(
  PLAYER_DEFS.flatMap((p) => [p.keys.up, p.keys.down, p.keys.left, p.keys.right, p.keys.paint]),
);

export const MIN_RADIUS = 8;
export const DEFAULT_MAX_RADIUS = 42.78; // 46 * 0.93 (7% smaller)
export const GROW_RATE = 60; // px/sec while paint held (charging)
export const MOVE_SPEED = 338; // px/sec (30% faster than the original 260)
// Cursors are frozen for this long once a round actually starts, so the "START!" flash has time
// to register before anyone can react — paint charging still works during this window.
export const MOVE_LOCK_MS = 250;

export const SPLAT_INTERVAL_MS = 60; // machine-gun auto-fire cadence
// A very slight cap on manual release-to-fire spamming — still ~7 shots/sec at the limit, clearly
// short of the machine gun's ~16.7/sec, so spamming stays viable without rivaling the power-up.
export const MANUAL_FIRE_COOLDOWN_MS = 140;

export const POWERUP_RADIUS = 16;
export const POWERUP_CLAIM_SLACK = 6; // extra px of forgiveness when checking overlap
export const POWERUP_LIFETIME_MS = 5000; // race window before an unclaimed power-up despawns
export const POWERUP_SPAWN_MIN_MS = 2500; // min delay before the next power-up appears
export const POWERUP_SPAWN_MAX_MS = 5500; // max delay before the next power-up appears
// Extra clearance at the very top of the canvas so power-ups never sit right under the frame,
// keeping them clearly separate from the round/timer HUD sitting just above it.
export const POWERUP_TOP_CLEARANCE = 100;

// Last-ditch finale event: with this much time left in the very last round, force-spawn a burst
// of machine-gun power-ups all at once, outside the normal paced/random spawn budget.
export const FINAL_BURST_AT_MS = 10000;
export const FINAL_BURST_COUNT = 4;

export const SHRINK_MULTIPLIER = 0.4;
export const SHRINK_DURATION_MS = 6000;
export const MACHINEGUN_DURATION_MS = 5000;
export const SWEEP_DURATION_MS = 1500;
export const SWEEP_WIDTH = 46;
export const SWEEP_BAND_HEIGHT = Math.round(CANVAS_H * 0.2);

export const POWERUP_CLAIMED_FLASH_MS = 500;
export const POWERUP_PULSE_PERIOD_MS = 900; // continuous "notice me" pulse for as long as it's on screen
export const POWERUP_AURA_MS = 500; // one-time bright shine ring right when it spawns

// Between-round sequence, in order: score tallying happens with the curtain still open (see
// RESULTS_TALLY_DELAY_MS/RESULTS_PER_OUTLINE_MS below) — once that finishes the curtain closes
// (CURTAIN_CLOSE_MS), a leaderboard holds on the closed curtain (RESULTS_LEADERBOARD_MS) then
// clears, the closed curtain then shows just the round number (ROUND_NUMBER_MS), and finally it
// opens (CURTAIN_OPEN_MS) straight into the next round — no countdown, no extra dwell once open.
export const CURTAIN_CLOSE_MS = 1200;
export const RESULTS_LEADERBOARD_MS = 1800;
export const ROUND_NUMBER_MS = 1300;
export const CURTAIN_OPEN_MS = 1400;
export const ROUND_INTRO_MS = ROUND_NUMBER_MS + CURTAIN_OPEN_MS;
export const RESULTS_PER_OUTLINE_MS = 3100; // was 2600 — +500ms more pacing between each point reveal
// A beat of silence after the "Finish!" cue before the score tallying starts.
export const RESULTS_TALLY_DELAY_MS = 1500;
// The finale gets its own, shorter version of that same pause — its reveal cycles fast once it
// starts, so the full normal-round delay would feel disproportionately long before anything happens.
export const FINALE_TALLY_DELAY_MS = 1000;
// Rounds with more outlines than this reveal much faster so a 30-outline finale doesn't drag on.
export const RESULTS_MANY_OUTLINES_THRESHOLD = 10;
export const RESULTS_MANY_OUTLINES_TOTAL_MS = 6500;

// The "Player X Wins!" reveal after the finale's results: a longer, drum-roll-backed curtain hold
// and a slower open than a normal between-round transition, to build extra suspense — then holds
// open with continuous confetti for as long as players want, moving on to the final-scores screen
// only once someone presses paint (no auto-timeout).
export const VICTORY_CURTAIN_HOLD_MS = 1800;
export const VICTORY_CURTAIN_OPEN_MS = 1800; // was 2200 — a bit faster than the suspense-hold beat

export const DEFAULT_POINTS_BY_RANK = [3, 2, 1, 0];
export const FINALE_POINTS_BY_RANK = [1, 0.5, 0.25, 0];
// "The big one" — the single giant-rectangle round — pays out bigger to match its higher stakes.
export const BIG_ONE_POINTS_BY_RANK = [5, 3, 1, 0];

// Release-to-fire paint blob
export const PROJECTILE_DURATION_MS = 380;
export const PROJECTILE_ARC_HEIGHT = 70;
export const MACHINEGUN_SHOT_RADIUS = 18;
export const LAST_CHANCE_MS = 10000; // final stretch of a round where the music gets urgent
export const PROJECTILE_MIN_SCALE = 0.32;
export const IMPACT_FLASH_MS = 260;

// Paint guns sit at a fixed station along the bottom edge, one per player, always aimed at that
// player's cursor. Shots launch from the gun's muzzle tip rather than an invisible point.
export const GUN_BASE_Y = CANVAS_H - 60;
export const GUN_BODY_RADIUS = 16;
export const GUN_LENGTH = 42;

export function gunStationX(playerId: number, playerCount: number): number {
  return (CANVAS_W / (playerCount + 1)) * (playerId + 1);
}

// A landed splat is always a fully solid circle at the charged radius (so it faithfully matches
// what the cursor promised while charging) with a few rounded lobes bulging outward on top —
// SPLAT_VARIANCE controls how far those lobes can bulge beyond the core, as a fraction of radius.
export const SPLAT_VARIANCE = 0.5;
export const SPLAT_LOBES = 7;
export const SPLAT_DROPLET_MIN = 3;
export const SPLAT_DROPLET_MAX = 6;

export const CLEAR_FRACTION = 0.3; // Wipe Out only erases this fraction of an opponent's paint

// "Big" reference eraser stats — the power-up now spawns ERASER_SPLIT_COUNT smaller/faster
// erasers derived from these rather than one big one.
export const ERASER_DURATION_MS = 7000;
export const ERASER_RADIUS = 51;
export const ERASER_SPEED = 370; // px/sec
export const ERASER_REDIRECT_MS = 650; // how often each one picks a new random heading
export const ERASER_SPLIT_COUNT = 3;
export const ERASER_SPLIT_SIZE_MULT = 0.8; // 20% smaller than ERASER_RADIUS
export const ERASER_SPLIT_SPEED_MULT = 1.15; // 15% faster than ERASER_SPEED

// Custom shapes read better a bit bigger than their built-in fallback's base radius.
export const CUSTOM_SHAPE_SIZE_BOOST = 1.3;

export const BIGSHOT_MULTIPLIER = 2.0625; // next splat only (1.5 * 1.25 * 1.1 — +10% bigger)

export const CONFUSE_DURATION_MS = 3500;
export const CONFUSE_REDIRECT_MS = 400; // how often a confused player's forced heading changes

// Last stretch of a round: a tick plays each second and the HUD timer grows + turns red.
export const TICK_WINDOW_MS = 5000;

export const POWERUP_LABELS: Record<PowerupType, string> = {
  shrink: "Shrink Ray",
  sweep: "Sweep Brush",
  machinegun: "Machine Gun",
  clear: "Wipe Out",
  eraser: "Random Eraser",
  bigshot: "Big Shot",
  confuse: "Confusion",
};

export const POWERUP_ICONS: Record<PowerupType, string> = {
  shrink: "↓",
  sweep: "→",
  machinegun: "✱",
  clear: "✖",
  eraser: "◌",
  bigshot: "◉",
  confuse: "↯",
};

export const POWERUP_TYPES: PowerupType[] = ["shrink", "sweep", "machinegun", "clear", "eraser", "bigshot", "confuse"];
