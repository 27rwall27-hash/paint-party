interface InterpState {
  /** Last confirmed real position, and the velocity estimated from the update before it. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  receivedAt: number;
  /** Where the previous extrapolation predicted we'd be right when this update landed — the
   * correction below blends from here, not from the raw new x/y, so a mispredicted extrapolation
   * eases out instead of visibly snapping. */
  correctFromX: number;
  correctFromY: number;
  correctStartAt: number;
}

// Never extrapolate further than this past the last real update — a genuine network stall
// (dropped connection, backgrounded tab) shouldn't send a player careening off in a straight line
// forever; better to just hold the last known position.
const MAX_EXTRAPOLATE_MS = 150;
// How long a misprediction correction takes to fully blend in, rather than snapping instantly.
const CORRECTION_MS = 80;

/** Smooths remote (non-locally-controlled) players' movement between position updates — a
 * lighter-weight complement to PredictedPlayer, which only applies to the guest's own player.
 *
 * This is dead reckoning, not fixed-window lerping: each update's velocity is estimated from how
 * far the player actually moved since the previous update (not assumed), and currentPosition()
 * projects forward from the latest known position using that velocity, the same way a player
 * holding a direction key actually moves. Real Realtime delivery is jittery (a nominal 30Hz tick
 * doesn't arrive every 33ms on the dot) — lerping between two old/new points over a fixed or even
 * measured window still shows the past, arriving late and unevenly; extrapolating from the latest
 * point tracks the present far more closely and doesn't compound timing jitter into visible
 * stutter. Any misprediction (e.g. the player just changed direction) gets caught and blended in
 * smoothly over CORRECTION_MS rather than snapped, so it still never looks like a teleport. */
export class RemoteInterpolator {
  private states = new Map<number, InterpState>();

  /** Call once per remote player on each incoming position update. */
  onSnapshot(playerId: number, x: number, y: number, now: number): void {
    const prev = this.states.get(playerId);
    const predicted = this.currentPosition(playerId, now) ?? { x, y };
    if (prev) {
      const dt = Math.max(0.001, (now - prev.receivedAt) / 1000);
      const vx = (x - prev.x) / dt;
      const vy = (y - prev.y) / dt;
      this.states.set(playerId, {
        x,
        y,
        vx,
        vy,
        receivedAt: now,
        correctFromX: predicted.x,
        correctFromY: predicted.y,
        correctStartAt: now,
      });
    } else {
      this.states.set(playerId, { x, y, vx: 0, vy: 0, receivedAt: now, correctFromX: x, correctFromY: y, correctStartAt: now });
    }
  }

  /** Call every render frame to get the smoothed position for a player id. */
  currentPosition(playerId: number, now: number): { x: number; y: number } | undefined {
    const s = this.states.get(playerId);
    if (!s) return undefined;

    const extrapolateMs = Math.max(0, Math.min(MAX_EXTRAPOLATE_MS, now - s.receivedAt));
    const extrapolatedX = s.x + s.vx * (extrapolateMs / 1000);
    const extrapolatedY = s.y + s.vy * (extrapolateMs / 1000);

    const correctionT = Math.max(0, Math.min(1, (now - s.correctStartAt) / CORRECTION_MS));
    return {
      x: s.correctFromX + (extrapolatedX - s.correctFromX) * correctionT,
      y: s.correctFromY + (extrapolatedY - s.correctFromY) * correctionT,
    };
  }

  reset(): void {
    this.states.clear();
  }
}
