import "./style.css";
import { ROUND_CONFIGS } from "./constants.ts";
import { createIdentities } from "./identities.ts";
import {
  createCauldronChaosSession,
  isHumanTurnAwaitingInput,
  updateCauldronChaosSession,
  type CauldronChaosSession,
} from "./CauldronChaosSession.ts";
import { shelfLayout } from "./layout.ts";
import { render } from "./render.ts";
import * as sound from "./sound.ts";
import { initSetupUI } from "./setupUI.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#cauldronScene")!;
const ctx2d = canvas.getContext("2d")!;
const setupPanel = document.querySelector<HTMLElement>("#setupPanel")!;
const startBtn = document.querySelector<HTMLButtonElement>("#startBtn")!;
const playAgainBtn = document.querySelector<HTMLButtonElement>("#playAgainBtn")!;
const hud = document.querySelector<HTMLElement>("#hud")!;

const identities = createIdentities();
initSetupUI(identities);

let session: CauldronChaosSession | null = null;
let pendingPick: number | null = null;
let wasResults = false;

function canvasPoint(e: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * canvas.width,
    y: ((e.clientY - rect.top) / rect.height) * canvas.height,
  };
}

canvas.addEventListener("pointerdown", (e) => {
  if (!session || !isHumanTurnAwaitingInput(session)) return;
  const p = canvasPoint(e);
  const round = session.round;
  for (const slot of shelfLayout(round.poolIds)) {
    if (round.usedIds.includes(slot.id)) continue;
    if (p.x >= slot.x && p.x <= slot.x + slot.w && p.y >= slot.y && p.y <= slot.y + slot.h) {
      pendingPick = slot.id;
      return;
    }
  }
});

startBtn.addEventListener("click", () => {
  setupPanel.hidden = true;
  playAgainBtn.hidden = true;
  pendingPick = null;
  wasResults = false;
  sound.init();
  session = createCauldronChaosSession(identities, performance.now());
});

playAgainBtn.addEventListener("click", () => {
  session = null;
  setupPanel.hidden = false;
  playAgainBtn.hidden = true;
});

const PHASE_LABELS: Partial<Record<CauldronChaosSession["phase"], string>> = {
  CALLING: "Listen closely...",
  PICKING: "Pour a safe ingredient!",
  SCORED: "Round over!",
  RESULTS: "Final results",
};

function updateHud(s: CauldronChaosSession): void {
  const roundLabel = `Round ${s.roundIndex + 1} / ${ROUND_CONFIGS.length}`;
  const phaseLabel = PHASE_LABELS[s.phase] ?? "";
  const scores = s.identities.map((identity, i) => `${identity.name}: ${s.totalScores[i]}`).join("  ·  ");
  hud.textContent = `${roundLabel}   ${phaseLabel}   —   ${scores}`;
}

function loop(time: number): void {
  if (session) {
    updateCauldronChaosSession(session, time, { pickedIngredientId: pendingPick });
    pendingPick = null;

    if (session.callItemRevealedThisTick) sound.playCallBlip(session.callItemRevealedThisTick.ingredientId);
    if (session.turnResolvedThisTick) {
      const { playerId, safe } = session.turnResolvedThisTick;
      if (safe) sound.playSafePour(playerId === 0);
      else {
        sound.playBackfire(playerId === 0);
        if (playerId === 0) sound.playEliminated();
      }
    }
    if (session.roundScoredThisTick) sound.playSurvive();
    if (session.phase === "RESULTS" && !wasResults) sound.playFanfare();
    wasResults = session.phase === "RESULTS";

    updateHud(session);
    render(ctx2d, session, time);

    if (session.phase === "RESULTS") playAgainBtn.hidden = false;
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
