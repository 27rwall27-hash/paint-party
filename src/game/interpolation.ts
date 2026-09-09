interface InterpState {
  prevX: number;
  prevY: number;
  targetX: number;
  targetY: number;
  receivedAt: number;
  /** How long this particular lerp should take — the actual observed gap since the previous
   * update for this player, not a hardcoded assumption. Real Realtime delivery is jittery (a
   * nominal 30Hz tick doesn't arrive every 33ms on the dot), and lerping over a fixed window
   * regardless of how the data actually arrived either overshoots-and-freezes (window shorter than
   * the real gap) or drags behind (window longer) — both read as stutter. Tracking the real gap
   * (clamped to sane bounds) keeps the motion matching however the network is actually behaving. */
  intervalMs: number;
}

// Fallback for the very first update (no prior gap to measure yet) and the bounds any observed
// gap gets clamped to — a near-zero gap (a burst of messages) would make the lerp snap instantly,
// and a huge one (a dropped connection blip) would leave it crawling toward a now-stale target.
const DEFAULT_INTERVAL_MS = 34;
const MIN_INTERVAL_MS = 16;
const MAX_INTERVAL_MS = 200;

/** Smooths remote (non-locally-controlled) players' movement between snapshots so it doesn't
 * look like discrete teleport-steps — a lighter-weight complement to PredictedPlayer, which only
 * applies to the guest's own player. */
export class RemoteInterpolator {
  private states = new Map<number, InterpState>();

  /** Call once per remote player on each incoming snapshot. */
  onSnapshot(playerId: number, x: number, y: number, now: number): void {
    const prev = this.states.get(playerId);
    const current = this.currentPosition(playerId, now) ?? { x, y };
    const intervalMs = prev
      ? Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, now - prev.receivedAt))
      : DEFAULT_INTERVAL_MS;
    this.states.set(playerId, { prevX: current.x, prevY: current.y, targetX: x, targetY: y, receivedAt: now, intervalMs });
  }

  /** Call every render frame to get the smoothed position for a player id. */
  currentPosition(playerId: number, now: number): { x: number; y: number } | undefined {
    const s = this.states.get(playerId);
    if (!s) return undefined;
    const t = Math.max(0, Math.min(1, (now - s.receivedAt) / s.intervalMs));
    return { x: s.prevX + (s.targetX - s.prevX) * t, y: s.prevY + (s.targetY - s.prevY) * t };
  }

  reset(): void {
    this.states.clear();
  }
}
