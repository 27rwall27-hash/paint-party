import { GameSession } from "./GameSession.ts";
import { Outline, Powerup } from "./Outline.ts";
import type { ServerMessage } from "./netProtocol.ts";

/** A GameSession driven entirely by server snapshots rather than its own update() loop — render.ts
 * reads it exactly the same way as a local session, so it needs zero changes for online play. */
export function createOnlineSession(): GameSession {
  return new GameSession();
}

/** Applies one incoming server message's effects onto a client-side GameSession in place.
 * Outlines are only rebuilt when the server says the round changed (see `outlineSpecs`) — every
 * other snapshot field just overwrites in place, and paint events are replayed onto whichever
 * outline they target so each client's local paint canvas visually matches the server's. */
export function applyServerMessage(session: GameSession, msg: ServerMessage): void {
  if (msg.type === "snapshot") {
    session.state = msg.state;
    session.roundIndex = msg.roundIndex;
    session.roundEndAt = msg.roundEndAt;
    session.stateEnteredAt = msg.stateEnteredAt;
    session.resultsDurationMs = msg.resultsDurationMs;
    session.resultsPerOutlineMs = msg.resultsPerOutlineMs;
    if (msg.outlineSpecs) {
      session.outlines = msg.outlineSpecs.map((spec) => new Outline(spec));
    }
    session.players = msg.players;
    session.powerups = msg.powerups.map((p) => {
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
    session.sweeps = msg.sweeps;
    session.projectiles = msg.projectiles;
    session.erasers = msg.erasers;
    session.impacts = msg.impacts;
    session.lastResults = msg.lastResults;
  } else if (msg.type === "paint") {
    for (const event of msg.events) {
      const outline = session.outlines[event.outlineIndex];
      if (!outline) continue;
      if (event.kind === "splat") outline.paintSplat(event.x, event.y, event.radius, event.color);
      else if (event.kind === "rect") outline.paintRect(event.x, event.y, event.w, event.h, event.color);
      else if (event.kind === "erase") outline.eraseColor(event.x, event.y, event.radius, event.excludeColor);
      else if (event.kind === "clear") outline.clearOtherColors(event.color, event.fraction);
    }
  }
}
