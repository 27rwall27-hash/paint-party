import "./style.css";
import { CANVAS_H } from "./constants.ts";
import { createIdentities } from "./identities.ts";
import { isAirborne, type RaceRacerState } from "./RaceInstance.ts";
import { render } from "./render.ts";
import * as sound from "./sound.ts";
import { initSetupUI } from "./setupUI.ts";
import { createStampedeSession, updateStampedeSession, type StampedeSession } from "./StampedeSession.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#race")!;
const ctx = canvas.getContext("2d")!;
const setupPanel = document.querySelector<HTMLElement>("#setupPanel")!;
const startBtn = document.querySelector<HTMLButtonElement>("#startRaceBtn")!;
const raceAgainBtn = document.querySelector<HTMLButtonElement>("#raceAgainBtn")!;

sound.init();

const identities = createIdentities();
initSetupUI(identities);

let session: StampedeSession | null = null;
// One flag per currently-active race, edge-triggered by a click landing in that band — consumed
// (reset to false) at the end of every tick, regardless of whether it actually caused a jump.
let pendingJumps: boolean[] = [];
let musicStartedAt = 0;
// A separate, speed-ramped clock (see sound.speedMultiplierAt) that drives ONLY the sprinting-in-
// place run cycle's visual speed — accumulates dt*currentMultiplier every frame rather than being
// derived directly from real time, so it integrates correctly as the multiplier ramps up instead
// of jumping discontinuously. Real jump timing/difficulty stays on the real clock untouched.
let animClockMs = 0;
// Tracks each racer's airborne state as of the last tick, so a leap sound plays exactly once per
// jump — the instant a racer actually leaves the ground, not when a CPU's jump is merely scheduled
// ahead of time (see RaceInstance.spawnObstacle). A WeakMap naturally handles racers cloned fresh
// at a split (new objects just aren't in it yet, correctly treated as "not airborne" until proven
// otherwise) without needing any manual cleanup.
const wasAirborne = new WeakMap<RaceRacerState, boolean>();
// Fires the finish cue exactly once, the instant the game ends (see StampedeSession.finishingAt).
let wasFinishing = false;

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
  musicStartedAt = performance.now();
  animClockMs = 0;
  wasFinishing = false;
  sound.startMusic();
  sound.playStart();
});

raceAgainBtn.addEventListener("click", () => {
  session = null;
  setupPanel.hidden = false;
  raceAgainBtn.hidden = true;
  sound.stopMusic();
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

    for (const race of session.races) {
      for (const racer of race.racers) {
        const airborneNow = isAirborne(racer, time);
        if (airborneNow && !wasAirborne.get(racer)) sound.playLeap(racer.identityId === 0);
        wasAirborne.set(racer, airborneNow);
      }
    }

    const speedMultiplier = sound.speedMultiplierAt(time - musicStartedAt);
    sound.updateMusicSpeed(time - musicStartedAt);
    animClockMs += dt * 1000 * speedMultiplier;

    const isFinishing = session.finishingAt !== null;
    if (isFinishing && !wasFinishing) sound.playFinish();
    wasFinishing = isFinishing;

    render(ctx, session, time, animClockMs);
    if (session.phase === "RESULTS") raceAgainBtn.hidden = false;
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
