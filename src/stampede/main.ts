import "./style.css";
import { CANVAS_H } from "./constants.ts";
import { createIdentities } from "./identities.ts";
import { render } from "./render.ts";
import { initSetupUI } from "./setupUI.ts";
import { createStampedeSession, updateStampedeSession, type StampedeSession } from "./StampedeSession.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#race")!;
const ctx = canvas.getContext("2d")!;
const setupPanel = document.querySelector<HTMLElement>("#setupPanel")!;
const startBtn = document.querySelector<HTMLButtonElement>("#startRaceBtn")!;
const raceAgainBtn = document.querySelector<HTMLButtonElement>("#raceAgainBtn")!;

const identities = createIdentities();
initSetupUI(identities);

let session: StampedeSession | null = null;
// One flag per currently-active race, edge-triggered by a click landing in that band — consumed
// (reset to false) at the end of every tick, regardless of whether it actually caused a jump.
let pendingJumps: boolean[] = [];

function bandIndexForY(y: number, bandCount: number): number {
  const hudHeight = 56;
  const bandH = (CANVAS_H - hudHeight) / bandCount;
  return Math.min(bandCount - 1, Math.max(0, Math.floor((y - hudHeight) / bandH)));
}

canvas.addEventListener("pointerdown", (e) => {
  if (!session || session.phase === "RESULTS") return;
  const rect = canvas.getBoundingClientRect();
  const scaleY = canvas.height / rect.height;
  const y = (e.clientY - rect.top) * scaleY;
  const band = bandIndexForY(y, session.races.length);
  pendingJumps[band] = true;
});

startBtn.addEventListener("click", () => {
  session = createStampedeSession(identities, performance.now());
  pendingJumps = session.races.map(() => false);
  setupPanel.hidden = true;
  raceAgainBtn.hidden = true;
});

raceAgainBtn.addEventListener("click", () => {
  session = null;
  setupPanel.hidden = false;
  raceAgainBtn.hidden = true;
});

let lastTime = performance.now();

function loop(time: number): void {
  const dt = Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;

  if (session) {
    if (pendingJumps.length !== session.races.length) {
      // A split just changed how many races/bands exist — grow the flag array to match (new
      // bands simply start with no pending jump).
      while (pendingJumps.length < session.races.length) pendingJumps.push(false);
    }
    updateStampedeSession(session, dt, time, pendingJumps);
    pendingJumps = pendingJumps.map(() => false);
    render(ctx, session, time);
    if (session.phase === "RESULTS") raceAgainBtn.hidden = false;
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
