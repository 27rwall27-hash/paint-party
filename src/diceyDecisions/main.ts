import "./style.css";
import { ROUND_CONFIGS } from "./constants.ts";
import { createIdentities } from "./identities.ts";
import {
  createDiceyDecisionsSession,
  updateDiceyDecisionsSession,
  type DiceyDecisionsSession,
} from "./DiceyDecisionsSession.ts";
import { pickSection } from "./raycast.ts";
import { createSceneContext, renderDiceyScene, type SceneContext } from "./sceneBuilder.ts";
import * as sound from "./sound.ts";
import { initSetupUI } from "./setupUI.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#diceyScene")!;
const reticleEl = document.querySelector<HTMLElement>("#reticle")!;
const setupPanel = document.querySelector<HTMLElement>("#setupPanel")!;
const startBtn = document.querySelector<HTMLButtonElement>("#startBtn")!;
const playAgainBtn = document.querySelector<HTMLButtonElement>("#playAgainBtn")!;
const hud = document.querySelector<HTMLElement>("#hud")!;

const identities = createIdentities();
initSetupUI(identities);

let session: DiceyDecisionsSession | null = null;
let sceneCtx: SceneContext | null = null;

const heldKeys = { up: false, down: false, left: false, right: false };
const KEY_TO_DIR: Record<string, keyof typeof heldKeys> = { w: "up", a: "left", s: "down", d: "right" };
let pendingClicked = false;
let wasResults = false;

window.addEventListener("keydown", (e) => {
  const dir = KEY_TO_DIR[e.key.toLowerCase()];
  if (!dir) return;
  e.preventDefault();
  heldKeys[dir] = true;
});
window.addEventListener("keyup", (e) => {
  const dir = KEY_TO_DIR[e.key.toLowerCase()];
  if (dir) heldKeys[dir] = false;
});
canvas.addEventListener("pointerdown", () => {
  if (!session || session.phase !== "PLAYING") return;
  pendingClicked = true;
});

startBtn.addEventListener("click", () => {
  setupPanel.hidden = true;
  playAgainBtn.hidden = true;
  heldKeys.up = heldKeys.down = heldKeys.left = heldKeys.right = false;
  pendingClicked = false;
  wasResults = false;
  sound.init();
  session = createDiceyDecisionsSession(identities, performance.now());
  sceneCtx = createSceneContext(canvas, session);
});

playAgainBtn.addEventListener("click", () => {
  session = null;
  sceneCtx = null;
  setupPanel.hidden = false;
  playAgainBtn.hidden = true;
});

function updateReticleDom(s: DiceyDecisionsSession): void {
  reticleEl.style.left = `${s.humanReticle.x * 100}%`;
  reticleEl.style.top = `${s.humanReticle.y * 100}%`;
  reticleEl.hidden = s.phase !== "PLAYING";
}

function updateHud(s: DiceyDecisionsSession): void {
  const roundLabel = `Round ${s.roundIndex + 1} / ${ROUND_CONFIGS.length}`;
  const phaseLabel = s.phase === "PLAYING" ? "Pick the highest total!" : s.phase === "SCORED" ? "Round over!" : s.phase === "RESULTS" ? "Final results" : "";
  const scores = s.identities.map((identity, i) => `${identity.name}: ${s.totalScores[i]}`).join("  ·  ");
  hud.textContent = `${roundLabel}   ${phaseLabel}   —   ${scores}`;
}

function loop(time: number): void {
  if (session && sceneCtx) {
    const hoveredSection = pickSection(sceneCtx, session.humanReticle);
    updateDiceyDecisionsSession(session, time, {
      up: heldKeys.up,
      down: heldKeys.down,
      left: heldKeys.left,
      right: heldKeys.right,
      hoveredSection,
      clicked: pendingClicked,
    });
    pendingClicked = false;

    if (session.lidOpenedThisTick) sound.playLidOpen();
    if (session.lidClosedThisTick) sound.playLidClose();
    for (const event of session.selectionsThisTick) {
      if (event.playerId === 0) {
        if (event.correct) sound.playCorrect(true);
        else sound.playWrong();
      } else {
        sound.playSelectClick(false);
      }
    }
    if (session.phase === "RESULTS" && !wasResults) sound.playFanfare();
    wasResults = session.phase === "RESULTS";

    updateReticleDom(session);
    updateHud(session);
    renderDiceyScene(sceneCtx, session, time);

    if (session.phase === "RESULTS") playAgainBtn.hidden = false;
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
