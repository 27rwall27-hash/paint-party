import "./style.css";
import { ROUND_CONFIGS, SHAKING_DURATION_MS } from "./constants.ts";
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
const setupPanel = document.querySelector<HTMLElement>("#setupPanel")!;
const startBtn = document.querySelector<HTMLButtonElement>("#startBtn")!;
const playAgainBtn = document.querySelector<HTMLButtonElement>("#playAgainBtn")!;
const hud = document.querySelector<HTMLElement>("#hud")!;

const identities = createIdentities();
initSetupUI(identities);

let session: DiceyDecisionsSession | null = null;
let sceneCtx: SceneContext | null = null;

// Normalized [0,1] canvas-space, tracked straight from the real cursor — works regardless of how
// the canvas is CSS-scaled since it's read off the canvas's own bounding rect every move.
const mouseNormalized = { x: 0.5, y: 0.5 };
let pendingClicked = false;
let wasResults = false;

canvas.addEventListener("pointermove", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseNormalized.x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  mouseNormalized.y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
});
canvas.addEventListener("pointerdown", () => {
  if (!session || session.phase !== "PLAYING") return;
  pendingClicked = true;
});

startBtn.addEventListener("click", () => {
  setupPanel.hidden = true;
  playAgainBtn.hidden = true;
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

const PHASE_LABELS: Partial<Record<DiceyDecisionsSession["phase"], string>> = {
  SHAKING: "Shaking...",
  PLAYING: "Pick the highest total!",
  SCORED: "Round over!",
  RESULTS: "Final results",
};

function updateHud(s: DiceyDecisionsSession): void {
  const roundLabel = `Round ${s.roundIndex + 1} / ${ROUND_CONFIGS.length}`;
  const phaseLabel = PHASE_LABELS[s.phase] ?? "";
  const scores = s.identities.map((identity, i) => `${identity.name}: ${s.totalScores[i]}`).join("  ·  ");
  hud.textContent = `${roundLabel}   ${phaseLabel}   —   ${scores}`;
}

function loop(time: number): void {
  if (session && sceneCtx) {
    const hoveredSection = pickSection(sceneCtx, mouseNormalized);
    updateDiceyDecisionsSession(session, time, { hoveredSection, clicked: pendingClicked });
    pendingClicked = false;

    if (session.lidOpenedThisTick) sound.playLidOpen();
    if (session.lidClosedThisTick) sound.playLidClose();
    if (session.shakingStartedThisTick) sound.playDiceShake(SHAKING_DURATION_MS);
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

    updateHud(session);
    renderDiceyScene(sceneCtx, session, time);

    if (session.phase === "RESULTS") playAgainBtn.hidden = false;
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
