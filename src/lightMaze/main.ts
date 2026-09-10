import "./style.css";
import { createIdentities } from "./identities.ts";
import { createLightMazeSession, updateLightMazeSession, type LightMazeSession } from "./LightMazeSession.ts";
import type { Side } from "./grid.ts";
import { render } from "./render.ts";
import * as sound from "./sound.ts";
import { initSetupUI } from "./setupUI.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#maze")!;
const ctx = canvas.getContext("2d")!;
const setupPanel = document.querySelector<HTMLElement>("#setupPanel")!;
const startBtn = document.querySelector<HTMLButtonElement>("#startMazeBtn")!;
const playAgainBtn = document.querySelector<HTMLButtonElement>("#playAgainBtn")!;

const identities = createIdentities();
initSetupUI(identities);

let session: LightMazeSession | null = null;

const KEY_TO_DIR: Record<string, Side> = { w: "N", a: "W", s: "S", d: "E" };
// Free movement combines every currently-held direction key into a (possibly diagonal) vector —
// see the Set below. `facing` is separate: it's just whichever direction key was most recently
// pressed, sticky until another is pressed, and only ever used to pick which door a click
// attempts (not tied to the movement vector at all).
const heldDirs = new Set<Side>();
let facing: Side | null = null;
let pendingClicked = false;
let wasEnding = false;

window.addEventListener("keydown", (e) => {
  const dir = KEY_TO_DIR[e.key.toLowerCase()];
  if (!dir) return;
  e.preventDefault();
  heldDirs.add(dir);
  facing = dir;
});
window.addEventListener("keyup", (e) => {
  const dir = KEY_TO_DIR[e.key.toLowerCase()];
  if (dir) heldDirs.delete(dir);
});

canvas.addEventListener("pointerdown", () => {
  if (!session || session.phase !== "PLAYING") return;
  pendingClicked = true;
});

startBtn.addEventListener("click", () => {
  setupPanel.hidden = true;
  playAgainBtn.hidden = true;
  heldDirs.clear();
  facing = null;
  pendingClicked = false;
  wasEnding = false;
  sound.init();
  session = createLightMazeSession(identities, performance.now());
});

playAgainBtn.addEventListener("click", () => {
  session = null;
  setupPanel.hidden = false;
  playAgainBtn.hidden = true;
});

function loop(time: number): void {
  if (session) {
    updateLightMazeSession(session, time, {
      up: heldDirs.has("N"),
      down: heldDirs.has("S"),
      left: heldDirs.has("W"),
      right: heldDirs.has("E"),
      facing,
      clicked: pendingClicked,
    });
    facing = null; // consumed — updateLightMazeSession only updates player.facing when this is non-null
    pendingClicked = false;

    for (const event of session.doorOpenedThisTick) sound.playDoorOpen(event.byPlayerId === 0);
    if (session.humanDoorFailedThisTick) sound.playDoorFail();
    for (const playerId of session.exitedThisTick) sound.playExit(playerId === 0);
    if (session.phase === "ENDING" && !wasEnding) sound.playGameOver();
    wasEnding = session.phase === "ENDING";

    render(ctx, session, time);
    if (session.phase === "RESULTS") playAgainBtn.hidden = false;
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
