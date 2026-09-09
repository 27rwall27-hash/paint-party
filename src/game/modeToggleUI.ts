/** Wires the top-level Local/Online segmented toggle — purely a panel-visibility concern, doesn't
 * touch which session actually drives the canvas (main.ts's onlineMode.active already decides
 * that on its own; a dormant local GameSession sitting at MENU in the background is harmless). */
export function initModeToggleUI(): void {
  const localBtn = document.querySelector<HTMLButtonElement>("#modeLocalBtn");
  const onlineBtn = document.querySelector<HTMLButtonElement>("#modeOnlineBtn");
  const localPanel = document.querySelector<HTMLElement>("#localPanel");
  const onlinePanel = document.querySelector<HTMLElement>("#online");
  if (!localBtn || !onlineBtn || !localPanel || !onlinePanel) return;

  function select(mode: "local" | "online"): void {
    localBtn!.classList.toggle("selected", mode === "local");
    onlineBtn!.classList.toggle("selected", mode === "online");
    localPanel!.hidden = mode !== "local";
    onlinePanel!.hidden = mode !== "online";
  }

  localBtn.addEventListener("click", () => select("local"));
  onlineBtn.addEventListener("click", () => select("online"));
}
