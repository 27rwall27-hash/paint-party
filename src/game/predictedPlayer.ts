import { updatePlayer, type Player } from "./Player.ts";
import type { PlayerInputState } from "./Input.ts";

const POSITION_SNAP_THRESHOLD = 40; // px — roughly one splat radius, imperceptible to correct within
const RADIUS_SNAP_THRESHOLD = 12; // px

/** Runs the guest's own player locally every render frame (using the same deterministic
 * updatePlayer() physics local play and the host both use), independent of when the next
 * snapshot arrives, so a guest's own movement/charge feels instant instead of waiting a network
 * round trip. Only position and charge radius are predicted — everything else (debuffs, score,
 * confusion) is host-decided and always taken verbatim from the latest snapshot. */
export class PredictedPlayer {
  private predicted: Player | undefined;
  private lastUpdateAt: number | undefined;

  /** Call every render frame with the guest's own live input. Returns the predicted player to
   * render in place of the authoritative one. */
  update(authoritative: Player, input: PlayerInputState, now: number): Player {
    if (!this.predicted || this.lastUpdateAt === undefined) {
      this.predicted = { ...authoritative };
      this.lastUpdateAt = now;
    }
    const p = this.predicted;
    // Non-predicted fields always come straight from the host.
    p.score = authoritative.score;
    p.shrinkUntil = authoritative.shrinkUntil;
    p.machineGunUntil = authoritative.machineGunUntil;
    p.confusedUntil = authoritative.confusedUntil;
    p.confusedAngle = authoritative.confusedAngle;
    p.confusedAngleSetAt = authoritative.confusedAngleSetAt;
    p.bigShotPending = authoritative.bigShotPending;

    const dt = Math.min(0.05, (now - this.lastUpdateAt) / 1000);
    this.lastUpdateAt = now;
    updatePlayer(p, input, dt, now);
    return p;
  }

  /** Call whenever a new snapshot arrives, to reconcile predicted position/radius against the
   * host's authoritative values — correct-on-divergence only, never a routine overwrite (the
   * snapshot is already stale relative to input applied locally since it was sent). */
  reconcile(authoritative: Player, roundChanged: boolean): void {
    if (!this.predicted) return;
    const posDrift = Math.hypot(this.predicted.x - authoritative.x, this.predicted.y - authoritative.y);
    const radiusDrift = Math.abs(this.predicted.cursorRadius - authoritative.cursorRadius);

    if (roundChanged || posDrift > POSITION_SNAP_THRESHOLD) {
      this.predicted.x = authoritative.x;
      this.predicted.y = authoritative.y;
    }
    if (roundChanged || radiusDrift > RADIUS_SNAP_THRESHOLD) {
      this.predicted.cursorRadius = authoritative.cursorRadius;
    }
  }

  reset(): void {
    this.predicted = undefined;
    this.lastUpdateAt = undefined;
  }
}
