import { updatePlayer, type Player } from "./Player.ts";
import type { PlayerInputState } from "./Input.ts";

// Below this drift, don't bother correcting at all — the snapshot reconcile() reads from is
// already stale relative to what's been predicted locally since it was sent, so some baseline
// disagreement is normal and correcting it would just be routine overwriting, defeating the whole
// point of predicting locally in the first place.
const POSITION_DRIFT_THRESHOLD = 40; // px — roughly one splat radius, imperceptible to correct within
const RADIUS_DRIFT_THRESHOLD = 12; // px

// How long a correction takes to fully resolve once one is needed. Deliberately NOT an instant
// snap: reconcile() runs off the throttled ~10Hz snapshot, and cursorRadius grows at GROW_RATE
// (60px/s) — normal network round-trip latency alone (150-300ms is common) is often already
// enough on its own to exceed RADIUS_DRIFT_THRESHOLD (12px = only 200ms of growth) every single
// time a guest charges for a moment, which used to snap the cursor's *size* instantly, over and
// over, for as long as the charge lasted. A sudden size change reads as far more jarring than the
// same-magnitude position correction, which mostly blends into the player's own ongoing motion —
// this is very likely why the jitter kept showing up specifically around charging/firing. Both are
// smoothed the same way now for consistency, and because there was no strong reason to believe
// position could never suffer the same issue, just that it wasn't as noticeable.
const CORRECTION_MS = 150;

/** Runs the guest's own player locally every render frame (using the same deterministic
 * updatePlayer() physics local play and the host both use), independent of when the next
 * snapshot arrives, so a guest's own movement/charge feels instant instead of waiting a network
 * round trip. Only position and charge radius are predicted — everything else (debuffs, score,
 * confusion) is host-decided and always taken verbatim from the latest snapshot. */
export class PredictedPlayer {
  private predicted: Player | undefined;
  private lastUpdateAt: number | undefined;
  /** Remaining correction to bleed off each frame, decaying toward zero over CORRECTION_MS
   * instead of applying it all at once — see the comment on CORRECTION_MS for why. */
  private errorX = 0;
  private errorY = 0;
  private errorRadius = 0;

  /** Call every render frame with the guest's own live input. Returns the predicted player to
   * render in place of the authoritative one. */
  update(authoritative: Player, input: PlayerInputState, now: number): Player {
    if (!this.predicted || this.lastUpdateAt === undefined) {
      this.predicted = { ...authoritative };
      this.lastUpdateAt = now;
    }
    const p = this.predicted;
    // Non-predicted fields always come straight from the host. name/color in particular were
    // only ever copied once, in the {...authoritative} spread above the first time this ran — a
    // guest who customized their name/color right when joining could have that first snapshot
    // race ahead of the host applying their presence-driven name/color, permanently freezing this
    // guest's own on-screen label/cursor at whatever the very first snapshot happened to say.
    p.name = authoritative.name;
    p.color = authoritative.color;
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

    // Bleed off whatever fraction of the outstanding correction is due this frame, on top of
    // the locally-predicted physics above — local movement/charging still feels immediate, it's
    // just also drifting toward the true value at the same time instead of waiting to jump.
    const resolveFrac = Math.min(1, dt / (CORRECTION_MS / 1000));
    if (this.errorX !== 0 || this.errorY !== 0) {
      const dx = this.errorX * resolveFrac;
      const dy = this.errorY * resolveFrac;
      p.x -= dx;
      p.y -= dy;
      this.errorX -= dx;
      this.errorY -= dy;
    }
    if (this.errorRadius !== 0) {
      const dr = this.errorRadius * resolveFrac;
      p.cursorRadius = Math.max(0, p.cursorRadius - dr);
      this.errorRadius -= dr;
    }
    return p;
  }

  /** Call whenever a new snapshot arrives, to reconcile predicted position/radius against the
   * host's authoritative values — correct-on-divergence only (below DRIFT_THRESHOLD, the gap is
   * just normal snapshot staleness, not a real desync), and even then the actual correction is
   * applied gradually in update() above, never snapped in here. */
  reconcile(authoritative: Player, roundChanged: boolean): void {
    if (!this.predicted) return;

    if (roundChanged) {
      this.predicted.x = authoritative.x;
      this.predicted.y = authoritative.y;
      this.predicted.cursorRadius = authoritative.cursorRadius;
      this.errorX = 0;
      this.errorY = 0;
      this.errorRadius = 0;
      return;
    }

    const posDrift = Math.hypot(this.predicted.x - authoritative.x, this.predicted.y - authoritative.y);
    if (posDrift > POSITION_DRIFT_THRESHOLD) {
      this.errorX = this.predicted.x - authoritative.x;
      this.errorY = this.predicted.y - authoritative.y;
    }

    const radiusDrift = Math.abs(this.predicted.cursorRadius - authoritative.cursorRadius);
    if (radiusDrift > RADIUS_DRIFT_THRESHOLD) {
      this.errorRadius = this.predicted.cursorRadius - authoritative.cursorRadius;
    }
  }

  reset(): void {
    this.predicted = undefined;
    this.lastUpdateAt = undefined;
    this.errorX = 0;
    this.errorY = 0;
    this.errorRadius = 0;
  }
}
