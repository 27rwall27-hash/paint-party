import "./style.css";
import { type BattleRoyaleRacerState, type BattleRoyaleSession, createBattleRoyaleSession, updateBattleRoyaleSession } from "./BattleRoyaleSession.ts";
import { renderBattleRoyale } from "./battleRoyaleRender.ts";
import { CANVAS_H } from "./constants.ts";
import { createBattleRoyaleIdentities, createIdentities } from "./identities.ts";
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
const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="gameMode"]');
const classicHint = document.querySelector<HTMLElement>("#classicHint")!;
const battleRoyaleHint = document.querySelector<HTMLElement>("#battleRoyaleHint")!;

sound.init();

const identities = createIdentities();
initSetupUI(identities);

type Mode = "classic" | "battleRoyale";
let mode: Mode = "classic";
modeRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    mode = radio.value as Mode;
    classicHint.hidden = mode !== "classic";
    battleRoyaleHint.hidden = mode !== "battleRoyale";
  });
});

let session: StampedeSession | null = null;
let brSession: BattleRoyaleSession | null = null;
// One flag per currently-active Classic race, edge-triggered by a click landing in that band —
// consumed (reset to false) at the end of every tick, regardless of whether it actually caused a
// jump. Battle Royale has only ever one human racer total, so it just needs a single flag, not an
// array routed by band.
let pendingJumps: boolean[] = [];
let brHumanJumpRequested = false;
let musicStartedAt = 0;
// A separate, speed-ramped clock (see sound.speedMultiplierAt) that drives ONLY the sprinting-in-
// place run cycle's visual speed — accumulates dt*currentMultiplier every frame rather than being
// derived directly from real time, so it integrates correctly as the multiplier ramps up instead
// of jumping discontinuously. Real jump timing/difficulty stays on the real clock untouched.
let animClockMs = 0;
// Tracks each racer's airborne state as of the last tick, so a leap sound plays exactly once per
// jump — the instant a racer actually leaves the ground, not when a CPU's jump is merely scheduled
// ahead of time. A WeakMap naturally handles racers cloned/created fresh (new objects just aren't
// in it yet, correctly treated as "not airborne" until proven otherwise) without needing any
// manual cleanup. Separate maps/flags per mode since the two sessions' racer objects are unrelated.
const wasAirborne = new WeakMap<RaceRacerState, boolean>();
const wasAirborneBr = new WeakMap<BattleRoyaleRacerState, boolean>();
let wasFinishing = false;
let wasFinishingBr = false;

function bandIndexForY(y: number, bandCount: number): number {
  const hudHeight = 56;
  const bandH = (CANVAS_H - hudHeight) / bandCount;
  return Math.min(bandCount - 1, Math.max(0, Math.floor((y - hudHeight) / bandH)));
}

canvas.addEventListener("pointerdown", (e) => {
  if (mode === "classic") {
    if (!session || session.phase === "RESULTS") return;
    const rect = canvas.getBoundingClientRect();
    const scaleY = canvas.height / rect.height;
    const y = (e.clientY - rect.top) * scaleY;
    const band = bandIndexForY(y, session.races.length);
    pendingJumps[band] = true;
  } else {
    if (!brSession || brSession.phase === "RESULTS") return;
    // Only one human racer total in Battle Royale — no band routing needed, any click anywhere is
    // simply "jump attempt".
    brHumanJumpRequested = true;
  }
});

startBtn.addEventListener("click", () => {
  setupPanel.hidden = true;
  raceAgainBtn.hidden = true;
  musicStartedAt = performance.now();
  animClockMs = 0;
  wasFinishing = false;
  wasFinishingBr = false;
  sound.startMusic();
  sound.playStart();

  if (mode === "classic") {
    brSession = null;
    session = createStampedeSession(identities, performance.now());
    pendingJumps = session.races.map(() => false);
  } else {
    session = null;
    const brIdentities = createBattleRoyaleIdentities();
    // Carry over whatever name/color the player picked on the shared setup screen.
    brIdentities[0]!.name = identities[0]!.name;
    brIdentities[0]!.color = identities[0]!.color;
    brHumanJumpRequested = false;
    brSession = createBattleRoyaleSession(brIdentities, performance.now());
  }
});

raceAgainBtn.addEventListener("click", () => {
  session = null;
  brSession = null;
  setupPanel.hidden = false;
  raceAgainBtn.hidden = true;
  sound.stopMusic();
  sound.stopAlarm();
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

    // Same condition render.ts uses to draw the split-warning sign — the alarm plays for exactly
    // as long as that sign is on screen.
    if (session.pendingSplitAt !== null || session.transition !== null) sound.startAlarm();
    else sound.stopAlarm();

    render(ctx, session, time, animClockMs);
    if (session.phase === "RESULTS") raceAgainBtn.hidden = false;
  } else if (brSession) {
    updateBattleRoyaleSession(brSession, time, brHumanJumpRequested);
    brHumanJumpRequested = false;

    for (const racer of brSession.racers) {
      const airborneNow = isAirborne(racer, time);
      if (airborneNow && !wasAirborneBr.get(racer)) sound.playLeap(racer.identityId === 0);
      wasAirborneBr.set(racer, airborneNow);
    }

    const speedMultiplier = sound.speedMultiplierAt(time - musicStartedAt);
    sound.updateMusicSpeed(time - musicStartedAt);
    animClockMs += dt * 1000 * speedMultiplier;

    const isFinishingBr = brSession.phase === "RESULTS";
    if (isFinishingBr && !wasFinishingBr) sound.playFinish();
    wasFinishingBr = isFinishingBr;

    // Same window battleRoyaleRender.ts draws the checkpoint banner in.
    if (brSession.checkpointPauseUntil !== null) sound.startAlarm();
    else sound.stopAlarm();

    renderBattleRoyale(ctx, brSession, time, animClockMs);
    if (brSession.phase === "RESULTS") raceAgainBtn.hidden = false;
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
