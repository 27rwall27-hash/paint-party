interface InterpState {
  prevX: number;
  prevY: number;
  targetX: number;
  targetY: number;
  receivedAt: number;
}

// Matches hostLoop's broadcast interval (30Hz simulation / 3 = ~10Hz, i.e. ~100ms apart).
const EXPECTED_INTERVAL_MS = 100;

/** Smooths remote (non-locally-controlled) players' movement between snapshots so it doesn't
 * look like discrete teleport-steps — a lighter-weight complement to PredictedPlayer, which only
 * applies to the guest's own player. */
export class RemoteInterpolator {
  private states = new Map<number, InterpState>();

  /** Call once per remote player on each incoming snapshot. */
  onSnapshot(playerId: number, x: number, y: number, now: number): void {
    const current = this.currentPosition(playerId, now) ?? { x, y };
    this.states.set(playerId, { prevX: current.x, prevY: current.y, targetX: x, targetY: y, receivedAt: now });
  }

  /** Call every render frame to get the smoothed position for a player id. */
  currentPosition(playerId: number, now: number): { x: number; y: number } | undefined {
    const s = this.states.get(playerId);
    if (!s) return undefined;
    const t = Math.max(0, Math.min(1, (now - s.receivedAt) / EXPECTED_INTERVAL_MS));
    return { x: s.prevX + (s.targetX - s.prevX) * t, y: s.prevY + (s.targetY - s.prevY) * t };
  }

  reset(): void {
    this.states.clear();
  }
}
