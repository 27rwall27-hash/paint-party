import { MOVE_SPEED } from "./constants.ts";

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

// Positions broadcast every host tick (~33ms), so under normal conditions a fresh update always
// lands well inside this window — full velocity is trusted the whole time here, so ordinary
// continuous movement is never held back or lagged by the decay below.
const FULL_TRUST_MS = 45;
// Past FULL_TRUST_MS (an update running late — network jitter, a congested tick, ...), the
// extrapolated distance tapers down to zero by this point instead of coasting at full velocity
// indefinitely. A player who was moving and then stops dead (the common "move up to a target,
// stop, charge, fire" pattern) has zero *new* velocity the instant they stop, but that only
// becomes known once the next update lands; if it's delayed, decaying the stale velocity's
// contribution avoids projecting them further and further past where they actually stopped.
const MAX_EXTRAPOLATE_MS = 120;
// How long a misprediction correction takes to fully blend in, rather than snapping instantly.
// Deliberately shorter than the normal ~33ms update interval — a value longer than that (80ms,
// the original choice here) means a correction from one update is still only partly blended in by
// the time the *next* update already wants to start a new correction, which never fully resolves
// and instead compounds into a steady lag behind the true position for as long as a player keeps
// moving continuously — exactly the case that's supposed to need no smoothing help at all.
const CORRECTION_MS = 20;
// A floor on dt when estimating velocity between two updates — real Realtime delivery can arrive
// in tight bursts (a brief hiccup catching up all at once), and dividing a normal position delta
// by a near-zero elapsed time inflates the estimated velocity wildly, flinging the extrapolated
// position far off screen. Ticks are nominally ~33ms apart, so anything tighter than this is
// almost certainly burst delivery, not a genuinely faster update rate.
const MIN_VELOCITY_DT_MS = 30;
// Belt-and-suspenders hard ceiling on the estimated speed itself: no player can legitimately move
// faster than MOVE_SPEED, so any estimate above that (from a round change, a reconnect, or any
// other source of a bad sample) is definitely bogus and gets capped rather than trusted. Only a
// small margin over MOVE_SPEED, not a generous one — the whole point is to bound the worst case.
const MAX_ESTIMATED_SPEED = MOVE_SPEED * 1.1;

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
      const dt = Math.max(MIN_VELOCITY_DT_MS / 1000, (now - prev.receivedAt) / 1000);
      let vx = (x - prev.x) / dt;
      let vy = (y - prev.y) / dt;
      const speed = Math.hypot(vx, vy);
      if (speed > MAX_ESTIMATED_SPEED) {
        const scale = MAX_ESTIMATED_SPEED / speed;
        vx *= scale;
        vy *= scale;
      }
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
    // Full trust (decay=1) through FULL_TRUST_MS, then tapers linearly to 0 by MAX_EXTRAPOLATE_MS
    // — see the comments above for why. Ordinary continuous movement never leaves the full-trust
    // zone (a new update always arrives well before FULL_TRUST_MS under normal conditions), so
    // this only ever softens a genuinely late/missing update, never routine steady-state motion.
    const decay = extrapolateMs <= FULL_TRUST_MS ? 1 : 1 - (extrapolateMs - FULL_TRUST_MS) / (MAX_EXTRAPOLATE_MS - FULL_TRUST_MS);
    const extrapolatedX = s.x + s.vx * (extrapolateMs / 1000) * decay;
    const extrapolatedY = s.y + s.vy * (extrapolateMs / 1000) * decay;

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
