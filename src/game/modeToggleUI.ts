import type { OnlineUIHandle } from "./onlineUI.ts";

/** Wires the top-level Local/Online segmented toggle. Mostly a panel-visibility concern (main.ts's
 * onlineMode.active already decides which session drives the canvas), except switching away from
 * Online has to actually leave any room in progress first — otherwise onlineMode.active stays
 * true behind the scenes, main.ts keeps driving the (now hidden) online session, and Local's own
 * settings never take effect even though the Local panel is what's showing. */
export function initModeToggleUI(onlineUI: OnlineUIHandle | undefined): void {
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

  localBtn.addEventListener("click", () => {
    onlineUI?.leaveIfActive();
    select("local");
  });
  onlineBtn.addEventListener("click", () => select("online"));
}
