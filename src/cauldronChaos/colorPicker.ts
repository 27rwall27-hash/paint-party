import { PRESET_COLORS } from "./constants.ts";

/** Renders a grid of preset-color swatch buttons into `container`, highlighting whichever one
 * matches `selected`. Same UI pattern as the other games' colorPicker.ts, reimplemented here
 * (rather than imported) to keep every game in the suite fully decoupled. */
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
