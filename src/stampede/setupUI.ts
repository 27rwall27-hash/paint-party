import { renderColorPicker } from "./colorPicker.ts";
import { PRESET_COLORS } from "./constants.ts";
import type { RacerIdentity } from "./identities.ts";

/** Wires the setup screen's name input + color picker to the human identity (id 0) — same
 * "write straight onto the live object, no confirm step" pattern as Paint Party's
 * playerSetupUI.ts. Takes the full roster (not just the human) so picking a color already
 * assigned to a CPU can swap it away instead of leaving two racers visually identical — with
 * exactly RACER_COUNT colors for RACER_COUNT identities, every color is always somebody's
 * default, so a plain "pick" would otherwise always collide with exactly one CPU. */
export function initSetupUI(identities: RacerIdentity[]): void {
  const human = identities[0]!;
  const nameInput = document.querySelector<HTMLInputElement>("#racerNameInput");
  const colorPickerEl = document.querySelector<HTMLElement>("#racerColorPicker");
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
