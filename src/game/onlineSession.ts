import { GameSession } from "./GameSession.ts";
import { Outline, Powerup } from "./Outline.ts";
import type { PaintBatchPayload, SnapshotPayload } from "./netProtocol.ts";

/** A GameSession driven entirely by host snapshots rather than its own update() loop — render.ts
 * reads it exactly the same way as a local session, so it needs zero changes for online play. */
export function createOnlineSession(): GameSession {
  return new GameSession();
}

/** Applies one incoming snapshot onto a guest's client-side GameSession in place. Outlines are
 * only rebuilt when the round actually changed (compared locally, not trusted from a one-shot
 * flag — a guest whose join is still settling right as a round starts could otherwise miss the
 * one broadcast that had it and be stuck with no outlines for the rest of that round) — every
 * other field just overwrites. Returns whether the round changed, so callers can decide whether
 * to hard-reset prediction/interpolation too. */
export function applySnapshot(session: GameSession, payload: SnapshotPayload): boolean {
  const roundChanged = session.roundIndex !== payload.roundIndex || session.outlines.length === 0;

  session.state = payload.state;
  session.roundIndex = payload.roundIndex;
  session.roundEndAt = payload.roundEndAt;
  session.stateEnteredAt = payload.stateEnteredAt;
  session.resultsDurationMs = payload.resultsDurationMs;
  session.resultsPerOutlineMs = payload.resultsPerOutlineMs;
  if (roundChanged) {
    session.outlines = payload.outlineSpecs.map((spec) => new Outline(spec));
  }
  session.players = payload.players;
  session.powerups = payload.powerups.map((p) => {
    // "circle" here is just to satisfy Powerup's constructor — render.ts draws power-ups as
    // plain circles via ctx.arc, never via this path, so the shape choice is inert visually.
    const instance = new Powerup({ type: p.type, kind: "circle", cx: p.cx, cy: p.cy, radius: p.radius });
    instance.state = p.state;
    instance.claimedBy = p.claimedBy;
    instance.claimedAt = p.claimedAt;
    instance.spawnedAt = p.spawnedAt;
    instance.expiresAt = p.expiresAt;
    return instance;
  });
  session.sweeps = payload.sweeps;
  session.projectiles = payload.projectiles;
  session.erasers = payload.erasers;
  session.impacts = payload.impacts;
  session.lastResults = payload.lastResults;

  return roundChanged;
}

/** Replays a batch of paint events onto a guest's local outline canvases so they visually match
 * the host's, without ever needing to send actual pixel data over the wire. */
export function applyPaint(session: GameSession, payload: PaintBatchPayload): void {
  for (const event of payload.events) {
    const outline = session.outlines[event.outlineIndex];
    if (!outline) continue;
    if (event.kind === "splat") outline.paintSplat(event.x, event.y, event.radius, event.color);
    else if (event.kind === "rect") outline.paintRect(event.x, event.y, event.w, event.h, event.color);
    else if (event.kind === "erase") outline.eraseColor(event.x, event.y, event.radius, event.excludeColor);
    else if (event.kind === "clear") outline.clearOtherColors(event.color, event.fraction);
  }
}
