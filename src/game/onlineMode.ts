import type { GameSession } from "./GameSession.ts";
import type { PlayerInputState } from "./Input.ts";
import type { Player } from "./Player.ts";
import type { PredictedPlayer } from "./predictedPlayer.ts";
import type { RemoteInterpolator } from "./interpolation.ts";

/** Shared hand-off point between onlineUI.ts (owns the NetworkClient/lobby flow, and the host
 * loop when this client is the host) and main.ts's render loop. */
export interface OnlineMode {
  active: boolean;
  role: "host" | "guest" | undefined;
  session: GameSession | undefined;
  mySlot: number | undefined;
  sendInput: ((state: PlayerInputState) => void) | undefined;
  /** Guest-only: predicts this client's own player locally between snapshots. */
  predictedPlayer: PredictedPlayer | undefined;
  /** Guest-only: smooths everyone else's movement between snapshots. */
  interpolator: RemoteInterpolator | undefined;
  /** Guest-only: the host's last-known-true state for this client's own player, kept separate
   * from `session.players` (which gets overwritten with the *predicted* player each render frame
   * for display) so PredictedPlayer always reconciles against real network truth, never against
   * its own previous prediction. */
  lastAuthoritativePlayer: Player | undefined;
  /** Guest-only: estimated (host clock - my clock), so guest-side "now" can be adjusted to match
   * the host's clock domain before comparing against host-stamped timestamps. Two different
   * physical machines' clocks are never guaranteed to agree — this is not optional polish, a
   * meaningfully-skewed guest clock produces negative elapsed times that break animation math and
   * can throw (see hostNow in netProtocol.ts). Undefined until the first snapshot arrives. */
  clockOffset: number | undefined;
  /** Mirrors NetworkClient's ConnectionStatus, kept here so render.ts can draw a banner off it —
   * a dropped Realtime channel with no visible feedback used to look exactly like a frozen game
   * (session state stays on-screen at whatever it last received, while any already-playing local
   * audio keeps going, since that's a plain HTMLAudioElement unrelated to the network). Undefined
   * before the first connect and once a session starts fresh. */
  connectionStatus: "connected" | "reconnecting" | "disconnected" | undefined;
}

export const onlineMode: OnlineMode = {
  active: false,
  role: undefined,
  session: undefined,
  mySlot: undefined,
  sendInput: undefined,
  predictedPlayer: undefined,
  interpolator: undefined,
  lastAuthoritativePlayer: undefined,
  clockOffset: undefined,
  connectionStatus: undefined,
};

/** Guest-only: "now" adjusted into the host's clock domain — use this instead of raw Date.now()
 * anywhere a guest compares against host-stamped session timestamps. Host role always returns
 * raw Date.now() (it IS the clock authority, offset is always 0 for itself). */
export function onlineNow(): number {
  return Date.now() + (onlineMode.role === "guest" ? (onlineMode.clockOffset ?? 0) : 0);
}
