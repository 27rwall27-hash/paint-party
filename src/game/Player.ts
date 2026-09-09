import {
  CANVAS_H,
  CANVAS_W,
  CONFUSE_REDIRECT_MS,
  DEFAULT_MAX_RADIUS,
  FRAME_THICKNESS,
  GROW_RATE,
  MIN_RADIUS,
  MOVE_SPEED,
  PLAYER_DEFS,
  PRESET_COLORS,
} from "./constants.ts";
import type { PlayerInputState } from "./Input.ts";

export interface Player {
  id: number;
  name: string;
  color: string;
  x: number;
  y: number;
  cursorRadius: number;
  score: number;
  /** Timestamp (ms) until which maxRadius is reduced by a Shrink Ray power-up. */
  shrinkUntil: number;
  /** Timestamp (ms) until which paint auto-fires without holding the paint key. */
  machineGunUntil: number;
  lastSplatAt: number;
  /** Paint-key state on the previous frame, used to detect the release edge that fires a blob. */
  wasPaintHeld: boolean;
  /** True for exactly one shot — that shot's radius gets multiplied by BIGSHOT_MULTIPLIER. */
  bigShotPending: boolean;
  /** Timestamp (ms) until which movement direction is hijacked by a Confusion power-up. */
  confusedUntil: number;
  confusedAngle: number;
  confusedAngleSetAt: number;
  /** Whether this slot is actually occupied by a real player right now. `session.players` is
   * always a fixed 4-slot array (both local and online) so slot numbers never move around — see
   * the comment on this in the plan/commit history — everything that renders or scores players
   * filters to `activePlayers()` first instead of iterating the raw array. Only ever mutated by
   * the host while the session is in "MENU"; locked for the rest of a match once it starts, so a
   * mid-match disconnect freezes a player in place rather than removing them. */
  active: boolean;
  /** True for a CPU-controlled seat — CompositeInputSource feeds it CpuController's computed
   * input instead of real/reported input. Only ever set by fillWithBots(). */
  isBot: boolean;
}

const START_POSITIONS: Array<[number, number]> = [
  [120, 120],
  [CANVAS_W - 120, 120],
  [120, CANVAS_H - 120],
  [CANVAS_W - 120, CANVAS_H - 120],
];

export function createPlayers(): Player[] {
  return PLAYER_DEFS.map((def, i) => {
    const [x, y] = START_POSITIONS[i]!;
    return {
      id: i,
      name: def.name,
      color: def.color,
      x,
      y,
      cursorRadius: MIN_RADIUS,
      score: 0,
      shrinkUntil: 0,
      machineGunUntil: 0,
      lastSplatAt: 0,
      wasPaintHeld: false,
      bigShotPending: false,
      confusedUntil: 0,
      confusedAngle: 0,
      confusedAngleSetAt: 0,
      active: true,
      isBot: false,
    };
  });
}

/** The subset of `players` actually occupied right now — everything that renders or scores
 * players should iterate this, not the raw fixed-length array. See the comment on `Player.active`
 * for why the array itself never shrinks/reorders. */
export function activePlayers(players: Player[]): Player[] {
  return players.filter((p) => p.active);
}

/** Fills every still-empty slot with a CPU bot — "there should always be 4 in a room." Picks a
 * name/color that doesn't collide with anyone already active, same rule real players follow.
 * Local calls this once, immediately (slots 1-3 are bots from the start, no lobby to wait on).
 * Online calls this right before a match actually starts, so any slot a real guest didn't claim
 * in time gets backfilled instead of leaving the room short-handed. */
export function fillWithBots(players: Player[]): void {
  const usedColors = new Set(players.filter((p) => p.active).map((p) => p.color.toLowerCase()));
  const usedNames = new Set(players.filter((p) => p.active).map((p) => p.name.toLowerCase()));
  const availableColors = PRESET_COLORS.filter((c) => !usedColors.has(c.toLowerCase()));
  let colorCursor = 0;
  players.forEach((p, slot) => {
    if (p.active) return;
    let name = `CPU ${slot + 1}`;
    while (usedNames.has(name.toLowerCase())) name = `${name}*`;
    usedNames.add(name.toLowerCase());
    const color = availableColors[colorCursor++] ?? PRESET_COLORS[slot % PRESET_COLORS.length]!;
    usedColors.add(color.toLowerCase());
    p.name = name;
    p.color = color;
    p.active = true;
    p.isBot = true;
  });
}

export function resetForRound(players: Player[]): void {
  players.forEach((p, i) => {
    const [x, y] = START_POSITIONS[i]!;
    p.x = x;
    p.y = y;
    p.cursorRadius = MIN_RADIUS;
    p.shrinkUntil = 0;
    p.machineGunUntil = 0;
    p.lastSplatAt = 0;
    p.wasPaintHeld = false;
    p.bigShotPending = false;
    p.confusedUntil = 0;
    p.confusedAngleSetAt = 0;
  });
}

export function currentMaxRadius(player: Player, now: number): number {
  return now < player.shrinkUntil ? DEFAULT_MAX_RADIUS * 0.4 : DEFAULT_MAX_RADIUS;
}

export function isMachineGunActive(player: Player, now: number): boolean {
  return now < player.machineGunUntil;
}

export function updatePlayer(
  player: Player,
  input: PlayerInputState,
  dt: number,
  now: number,
): void {
  let dx = 0;
  let dy = 0;
  if (now < player.confusedUntil) {
    if (now - player.confusedAngleSetAt >= CONFUSE_REDIRECT_MS) {
      player.confusedAngle = Math.random() * Math.PI * 2;
      player.confusedAngleSetAt = now;
    }
    dx = Math.cos(player.confusedAngle);
    dy = Math.sin(player.confusedAngle);
  } else {
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
  }
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    player.x += (dx / len) * MOVE_SPEED * dt;
    player.y += (dy / len) * MOVE_SPEED * dt;
    // Clamped to the picture frame's inner edge, not the raw canvas edge, so players can't wander
    // behind the frame border — applies to confused movement too, since it's the same code path.
    player.x = Math.max(FRAME_THICKNESS, Math.min(CANVAS_W - FRAME_THICKNESS, player.x));
    player.y = Math.max(FRAME_THICKNESS, Math.min(CANVAS_H - FRAME_THICKNESS, player.y));
  }

  const maxR = currentMaxRadius(player, now);
  if (isMachineGunActive(player, now)) {
    // Machine gun auto-fires on its own cadence (see GameSession) — no charging needed.
    player.cursorRadius = MIN_RADIUS;
  } else if (input.paint) {
    player.cursorRadius = Math.min(maxR, player.cursorRadius + GROW_RATE * dt);
  }
  // On release the charge is consumed by firing a projectile (handled in GameSession),
  // which resets cursorRadius back to MIN_RADIUS itself.
}
