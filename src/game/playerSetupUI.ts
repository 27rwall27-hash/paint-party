import type { GameSession } from "./GameSession.ts";
import { PLAYER_DEFS } from "./constants.ts";
import { renderColorPicker } from "./colorPicker.ts";

/** Lets the one local (solo) player customize their name/color before a match starts. Local
 * play's GameSession lives for the whole tab (MENU -> GAME_OVER -> MENU loops reuse the same
 * one), and render.ts/scoring already read Player.name/color dynamically everywhere it matters,
 * so writing straight onto the live Player object here is all the wiring this needs — no extra
 * state, no "confirm" step, changes just take effect live. */
export function initPlayerSetupUI(session: GameSession): void {
  const nameInput = document.querySelector<HTMLInputElement>("#localNameInput");
  const colorPickerEl = document.querySelector<HTMLElement>("#localColorPicker");
  if (!nameInput || !colorPickerEl) return;

  const def = PLAYER_DEFS[0]!;
  const player = session.players[0];
  nameInput.value = player?.name ?? def.name;

  nameInput.addEventListener("input", () => {
    const p = session.players[0];
    if (p) p.name = nameInput.value.trim() || def.name;
  });

  const paint = (color: string) => {
    const p = session.players[0];
    if (p) p.color = color;
    renderColorPicker(colorPickerEl, color, paint);
  };
  renderColorPicker(colorPickerEl, player?.color ?? def.color, paint);
}
