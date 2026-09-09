import type { InputSource } from "./GameSession.ts";
import { InputManager, type PlayerInputState } from "./Input.ts";
import { PLAYER_DEFS, type KeyBinding } from "./constants.ts";
import type { CpuController } from "./cpuController.ts";

/** Feeds GameSession's per-player input from the local browser's own keyboard (slot 0) merged
 * with whatever's reported for every other active slot — a guest's network-reported state online,
 * or a CPU bot's computed input, whichever applies to that slot. Used identically by local solo
 * play and by the host's authoritative simulation in online play — the only difference between
 * the two is whether setGuestInput() ever gets called (never, for local). */
export class CompositeInputSource implements InputSource {
  private readonly localInput: InputManager;
  private readonly cpu: CpuController;
  private readonly guestStates = new Map<number, PlayerInputState>();
  private startRequested = false;

  constructor(localInput: InputManager, cpu: CpuController) {
    this.localInput = localInput;
    this.cpu = cpu;
  }

  setGuestInput(slot: number, state: PlayerInputState): void {
    this.guestStates.set(slot, state);
  }

  requestStart(): void {
    this.startRequested = true;
  }

  anyPaintPressed(): boolean {
    if (this.startRequested) {
      this.startRequested = false;
      return true;
    }
    // MENU->start is (also) gated behind the explicit "Start Match" button for online, but every
    // other menu-style advance GameSession drives off this (VICTORY->GAME_OVER, GAME_OVER->MENU)
    // has no button at all online — it was only ever reachable via requestStart(), which meant
    // those screens were stuck forever online. Real held-paint state from the host and any guest
    // now counts too, same as local play's InputManager.anyPaintPressed(). Bots never count here
    // — they shouldn't be the ones advancing a human-facing menu screen.
    if (this.localInput.anyPaintPressed()) return true;
    for (const state of this.guestStates.values()) {
      if (state.paint) return true;
    }
    return false;
  }

  getInput(keys: KeyBinding): PlayerInputState {
    const slot = PLAYER_DEFS.findIndex((d) => d.keys.paint === keys.paint);
    if (slot === 0) return this.localInput.getInput(keys);
    const guestState = this.guestStates.get(slot);
    if (guestState) return guestState;
    return this.cpu.getInput(slot);
  }
}
