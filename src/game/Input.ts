import * as sound from "./sound.ts";
import { ALL_BOUND_KEYS, PLAYER_DEFS, type KeyBinding } from "./constants.ts";

export interface PlayerInputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  paint: boolean;
}

/** True while a real text-entry control (the room-code field, a name input, ...) has focus — the
 * bound keys cover most of the alphabet across all 4 players (W/A/S/D, I/J/K/L/O, T/G/F/H/R, ...),
 * so without this check, typing nearly any room code or player name into a form field would have
 * individual letters silently eaten by preventDefault() before they ever reached the input. */
function isTypingIntoField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

/** Tracks raw key state and exposes it per-player via each player's key bindings. */
export class InputManager {
  private keysDown = new Set<string>();

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (isTypingIntoField(e.target)) return;
      if (ALL_BOUND_KEYS.has(e.code)) e.preventDefault();
      sound.unlock();
      this.keysDown.add(e.code);
    });
    window.addEventListener("keyup", (e) => {
      if (isTypingIntoField(e.target)) return;
      if (ALL_BOUND_KEYS.has(e.code)) e.preventDefault();
      this.keysDown.delete(e.code);
    });
    window.addEventListener("blur", () => this.keysDown.clear());
  }

  anyPaintPressed(): boolean {
    return PLAYER_DEFS.some((p) => this.keysDown.has(p.keys.paint));
  }

  getInput(keys: KeyBinding): PlayerInputState {
    return {
      up: this.keysDown.has(keys.up),
      down: this.keysDown.has(keys.down),
      left: this.keysDown.has(keys.left),
      right: this.keysDown.has(keys.right),
      paint: this.keysDown.has(keys.paint),
    };
  }
}
