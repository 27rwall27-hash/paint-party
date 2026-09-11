import { renderColorPicker } from "./colorPicker.ts";
import { PRESET_COLORS } from "./constants.ts";
import type { PlayerIdentity } from "./identities.ts";

/** Wires the setup screen's name input + color picker to the human identity (id 0) — same
 * "write straight onto the live object, no confirm step" pattern used across the suite. Picking
 * a color already assigned to a CPU swaps it away instead of leaving two players visually
 * identical. */
export function initSetupUI(identities: PlayerIdentity[]): void {
  const human = identities[0]!;
  const nameInput = document.querySelector<HTMLInputElement>("#playerNameInput");
  const colorPickerEl = document.querySelector<HTMLElement>("#playerColorPicker");
  if (!nameInput || !colorPickerEl) return;

  nameInput.value = human.name === "You" ? "" : human.name;
  nameInput.placeholder = "You";
  nameInput.addEventListener("input", () => {
    human.name = nameInput.value.trim() || "You";
  });

  const pick = (color: string) => {
    const previousColor = human.color;
    const collidingCpu = identities.find((i) => i.id !== human.id && i.color.toLowerCase() === color.toLowerCase());
    if (collidingCpu) collidingCpu.color = previousColor;
    human.color = color;
    renderColorPicker(colorPickerEl, color, pick);
  };
  renderColorPicker(colorPickerEl, human.color || PRESET_COLORS[0]!, pick);
}
