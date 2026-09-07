import type { GameSession } from "./GameSession.ts";
import type { PlayerInputState } from "./Input.ts";

/** Shared hand-off point between onlineUI.ts (owns the NetworkClient/lobby flow) and main.ts's
 * render loop (just needs to know whether to render+drive a local or online session). */
export interface OnlineMode {
  active: boolean;
  session: GameSession | undefined;
  sendInput: ((state: PlayerInputState) => void) | undefined;
}

export const onlineMode: OnlineMode = {
  active: false,
  session: undefined,
  sendInput: undefined,
};
