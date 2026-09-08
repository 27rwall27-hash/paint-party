import { CANVAS_H, CANVAS_W, POWERUP_LIFETIME_MS, POWERUP_RADIUS, POWERUP_TOP_CLEARANCE, POWERUP_TYPES, type PowerupType } from "./constants.ts";
import { Powerup, type PowerupSpec } from "./Outline.ts";
import type { ShapeKind } from "./shapes.ts";

const POWERUP_SHAPE: ShapeKind = "circle";
const MARGIN = 60; // clear of the ~44px decorative picture frame, with real breathing room
const MAX_ATTEMPTS = 60;

export interface Obstacle {
  cx: number;
  cy: number;
  radius: number;
}

function randRange(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function overlapsAny(x: number, y: number, r: number, obstacles: Obstacle[]): boolean {
  return obstacles.some((o) => Math.hypot(x - o.cx, y - o.cy) < r + o.radius + MARGIN);
}

/**
 * Places one power-up clear of the round's big outlines and any other active power-ups, and
 * clear of the very top of the canvas (so it never sits right under the round/timer HUD).
 * Random type unless `forceType` is given.
 */
export function spawnOnePowerup(obstacles: Obstacle[], now: number, forceType?: PowerupType): Powerup | null {
  const topBound = POWERUP_RADIUS + Math.max(MARGIN, POWERUP_TOP_CLEARANCE);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const x = randRange(POWERUP_RADIUS + MARGIN, CANVAS_W - POWERUP_RADIUS - MARGIN);
    const y = randRange(topBound, CANVAS_H - POWERUP_RADIUS - MARGIN);
    if (overlapsAny(x, y, POWERUP_RADIUS, obstacles)) continue;
    const type = forceType ?? POWERUP_TYPES[randRange(0, POWERUP_TYPES.length - 1)]!;
    const spec: PowerupSpec = { kind: POWERUP_SHAPE, cx: x, cy: y, radius: POWERUP_RADIUS, type };
    const powerup = new Powerup(spec);
    powerup.spawnedAt = now;
    powerup.expiresAt = now + POWERUP_LIFETIME_MS;
    return powerup;
  }
  return null;
}
