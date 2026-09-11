import "./style.css";
import { INGREDIENTS, ROUND_CONFIGS } from "./constants.ts";
import { createIdentities } from "./identities.ts";
import {
  createCauldronChaosSession,
  isHumanTurnAwaitingInput,
  updateCauldronChaosSession,
  type CauldronChaosSession,
} from "./CauldronChaosSession.ts";
import { pickShelfSlot } from "./raycast.ts";
import { createSceneContext, renderCauldronScene, type SceneContext } from "./sceneBuilder.ts";
import * as sound from "./sound.ts";
import { initSetupUI } from "./setupUI.ts";

const INGREDIENT_BY_ID = new Map(INGREDIENTS.map((i) => [i.id, i]));

const canvas = document.querySelector<HTMLCanvasElement>("#cauldronScene")!;
const setupPanel = document.querySelector<HTMLElement>("#setupPanel")!;
const startBtn = document.querySelector<HTMLButtonElement>("#startBtn")!;
const playAgainBtn = document.querySelector<HTMLButtonElement>("#playAgainBtn")!;
const hud = document.querySelector<HTMLElement>("#hud")!;
const banner = document.querySelector<HTMLElement>("#banner")!;

const identities = createIdentities();
initSetupUI(identities);

let session: CauldronChaosSession | null = null;
let sceneCtx: SceneContext | null = null;

const mouseNormalized = { x: 0.5, y: 0.5 };
let pendingPick: number | null = null;
let wasResults = false;

canvas.addEventListener("pointermove", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseNormalized.x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  mouseNormalized.y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
});
canvas.addEventListener("pointerdown", () => {
  if (!session || !sceneCtx || !isHumanTurnAwaitingInput(session)) return;
  const slotId = pickShelfSlot(sceneCtx, mouseNormalized);
  if (slotId !== null) pendingPick = slotId;
});

startBtn.addEventListener("click", () => {
  setupPanel.hidden = true;
  playAgainBtn.hidden = true;
  pendingPick = null;
  wasResults = false;
  sound.init();
  session = createCauldronChaosSession(identities, performance.now());
  sceneCtx = createSceneContext(canvas, session);
});

playAgainBtn.addEventListener("click", () => {
  session = null;
  sceneCtx = null;
  setupPanel.hidden = false;
  playAgainBtn.hidden = true;
});

function updateHud(s: CauldronChaosSession): void {
  const roundLabel = `Round ${s.roundIndex + 1} / ${ROUND_CONFIGS.length}`;
  const phaseLabel = s.phase === "CALLING" ? "Listen closely..." : s.phase === "PICKING" ? "Carry a safe ingredient!" : s.phase === "SCORED" ? "Round over!" : s.phase === "RESULTS" ? "Final results" : "";
  const scores = s.identities.map((identity, i) => `${identity.name}: ${s.totalScores[i]}`).join("  ·  ");
  hud.textContent = `${roundLabel}   ${phaseLabel}   —   ${scores}`;
}

function updateBanner(s: CauldronChaosSession, now: number): void {
  if (s.phase === "INTRO") {
    banner.hidden = false;
    banner.innerHTML = `<div class="bannerTitle">Round ${s.roundIndex + 1}</div><div class="bannerSub">Watch closely...</div>`;
    return;
  }
  if (s.phase === "CALLING" && s.callIndexRevealed > 0) {
    const ingredientId = s.round.calledIds[s.callIndexRevealed - 1]!;
    const def = INGREDIENT_BY_ID.get(ingredientId)!;
    banner.hidden = false;
    banner.innerHTML = `<div class="bannerTitle" style="color:${def.color}">${def.name}</div>`;
    return;
  }
  if (s.phase === "SCORED" && s.round.scoresAwarded) {
    const names = s.round.survivors.map((id) => s.identities[id]!.name).join(" & ");
    const title = s.round.survivors.length > 1 ? `${names} survive!` : `${names} survives!`;
    banner.hidden = false;
    banner.innerHTML = `<div class="bannerTitle">${title}</div><div class="bannerSub">+5 points</div>`;
    return;
  }
  if (s.phase === "RESULTS") {
    const ranked = s.identities.map((identity, i) => ({ identity, score: s.totalScores[i]! })).sort((a, b) => b.score - a.score);
    banner.hidden = false;
    banner.innerHTML = `<div class="bannerTitle">Final Results</div>` + ranked.map((r) => `<div class="bannerSub">${r.identity.name}: ${r.score}</div>`).join("");
    return;
  }
  banner.hidden = true;
  void now;
}

function loop(time: number): void {
  if (session && sceneCtx) {
    updateCauldronChaosSession(session, time, { pickedSlotId: pendingPick });
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
    updateBanner(session, time);
    renderCauldronScene(sceneCtx, session, time);

    if (session.phase === "RESULTS") playAgainBtn.hidden = false;
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
