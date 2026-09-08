import type { GameSession } from "./GameSession.ts";
import { PLAYER_DEFS } from "./constants.ts";

/** Lets players customize their name/color before a local match starts. Local play's GameSession
 * lives for the whole tab (MENU -> GAME_OVER -> MENU loops reuse the same one), and render.ts/
 * scoring already read Player.name/color dynamically everywhere it matters, so writing straight
 * onto the live Player objects here is all the wiring this needs — no extra state, no "confirm"
 * step, changes just take effect live. */
export function initPlayerSetupUI(session: GameSession): void {
  PLAYER_DEFS.forEach((def, i) => {
    const nameInput = document.querySelector<HTMLInputElement>(`.playerNameInput[data-slot="${i}"]`);
    const colorInput = document.querySelector<HTMLInputElement>(`.playerColorInput[data-slot="${i}"]`);
    if (!nameInput || !colorInput) return;

    const player = session.players[i];
    nameInput.value = player?.name ?? def.name;
    colorInput.value = player?.color ?? def.color;

    nameInput.addEventListener("input", () => {
      const p = session.players[i];
      if (p) p.name = nameInput.value.trim() || def.name;
    });
    colorInput.addEventListener("input", () => {
      const p = session.players[i];
      if (p) p.color = colorInput.value;
    });
  });
}
