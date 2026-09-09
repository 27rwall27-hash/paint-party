import { PRESET_COLORS } from "./constants.ts";

/** Renders a grid of preset-color swatch buttons into `container`, replacing whatever was there,
 * and highlights whichever one matches `selected`. Reused everywhere a player picks a color
 * (local setup, the online join form, in-room rename) instead of a free native color input, so
 * "no duplicate colors" only ever has to compare against this same fixed, known set. */
export function renderColorPicker(container: HTMLElement, selected: string, onSelect: (color: string) => void): void {
  container.innerHTML = "";
  container.classList.add("colorPicker");
  for (const color of PRESET_COLORS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "colorSwatch";
    btn.style.background = color;
    btn.setAttribute("aria-label", color);
    if (color.toLowerCase() === selected.toLowerCase()) btn.classList.add("selected");
    btn.addEventListener("click", () => onSelect(color));
    container.appendChild(btn);
  }
}
