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
};
