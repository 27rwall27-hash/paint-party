import "./style.css";
import { ORE_TIERS, ROUND_CONFIGS } from "./constants.ts";
import { createIdentities } from "./identities.ts";
import { createBoulderStrikeSession, updateBoulderStrikeSession, type BoulderStrikeSession } from "./BoulderStrikeSession.ts";
import { drawGleamShape } from "./gleamShapes.ts";
import { createSceneContext, renderBoulderScene, type SceneContext } from "./sceneBuilder.ts";
import * as sound from "./sound.ts";
import { initSetupUI } from "./setupUI.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#boulderScene")!;
const setupPanel = document.querySelector<HTMLElement>("#setupPanel")!;
const startBtn = document.querySelector<HTMLButtonElement>("#startBtn")!;
const playAgainBtn = document.querySelector<HTMLButtonElement>("#playAgainBtn")!;
const hud = document.querySelector<HTMLElement>("#hud")!;
const banner = document.querySelector<HTMLElement>("#banner")!;
const previewIcon = document.querySelector<HTMLCanvasElement>("#previewIcon")!;

const identities = createIdentities();
initSetupUI(identities);

let session: BoulderStrikeSession | null = null;
let sceneCtx: SceneContext | null = null;

let pendingRelease = false;
let wasResults = false;

canvas.addEventListener("pointerdown", () => {
  if (!session) return;
  sound.init();
});
window.addEventListener("pointerup", () => {
  if (!session) return;
  pendingRelease = true;
});

startBtn.addEventListener("click", () => {
  setupPanel.hidden = true;
  playAgainBtn.hidden = true;
  pendingRelease = false;
  wasResults = false;
  sound.init();
  session = createBoulderStrikeSession(identities, performance.now());
  sceneCtx = createSceneContext(canvas, session);
});

playAgainBtn.addEventListener("click", () => {
  session = null;
  sceneCtx = null;
  setupPanel.hidden = false;
  playAgainBtn.hidden = true;
});

const PHASE_LABELS: Partial<Record<BoulderStrikeSession["phase"], string>> = {
  PREVIEW: "Memorize the gleam...",
  RAISE: "Raise your pickaxe!",
  GLEAMING: "Watch closely...",
  REVEAL: "Results!",
  SCORED: "Round over!",
  RESULTS: "Final results",
};

function updateHud(s: BoulderStrikeSession): void {
  const roundLabel = `Round ${s.roundIndex + 1} / ${ROUND_CONFIGS.length}`;
  const phaseLabel = PHASE_LABELS[s.phase] ?? "";
  const yourScore = `You: ${s.totalScores[0]}`;
  hud.textContent = `${roundLabel}   ${phaseLabel}   —   ${yourScore}`;
}

function updateBanner(s: BoulderStrikeSession): void {
  if (s.phase === "INTRO") {
    banner.hidden = false;
    previewIcon.hidden = true;
    banner.querySelector(".bannerTitle")!.textContent = `Round ${s.roundIndex + 1}`;
    banner.querySelector(".bannerSub")!.textContent = "New rocks ahead...";
    return;
  }
  if (s.phase === "PREVIEW") {
    banner.hidden = false;
    previewIcon.hidden = false;
    const ctx2d = previewIcon.getContext("2d")!;
    ctx2d.clearRect(0, 0, previewIcon.width, previewIcon.height);
    ctx2d.fillStyle = "#1c1712";
    ctx2d.fillRect(0, 0, previewIcon.width, previewIcon.height);
    drawGleamShape(ctx2d, s.round.targetCombo.shape, previewIcon.width / 2, previewIcon.height / 2, previewIcon.width * 0.36, s.round.targetCombo.color.hex);
    banner.querySelector(".bannerTitle")!.textContent = "Watch for this gleam";
    banner.querySelector(".bannerSub")!.textContent = "Swing the instant it appears";
    return;
  }
  if (s.phase === "RAISE") {
    banner.hidden = false;
    previewIcon.hidden = true;
    banner.querySelector(".bannerTitle")!.textContent = "Raise your pickaxe!";
    banner.querySelector(".bannerSub")!.textContent = "Hold the mouse button down";
    return;
  }
  if (s.phase === "SCORED" && s.round.scoresAwarded) {
    banner.hidden = false;
    previewIcon.hidden = true;
    const lines = s.round.rankedPlayerIds.map((playerId, rank) => `${ORE_TIERS[rank]!.name}: ${s.identities[playerId]!.name}`);
    banner.querySelector(".bannerTitle")!.textContent = lines.length > 0 ? "Ore awarded!" : "No one struck true";
    banner.querySelector(".bannerSub")!.textContent = lines.join("  ·  ");
    return;
  }
  if (s.phase === "RESULTS") {
    banner.hidden = false;
    previewIcon.hidden = true;
    const ranked = s.identities.map((identity, i) => ({ identity, score: s.totalScores[i]! })).sort((a, b) => b.score - a.score);
    banner.querySelector(".bannerTitle")!.textContent = "Final Results";
    banner.querySelector(".bannerSub")!.textContent = ranked
      .slice(0, 5)
      .map((r) => `${r.identity.name}: ${r.score}`)
      .join("  ·  ");
    return;
  }
  banner.hidden = true;
  previewIcon.hidden = true;
}

function loop(time: number): void {
  if (session && sceneCtx) {
    updateBoulderStrikeSession(session, time, { released: pendingRelease });
    pendingRelease = false;

    for (const event of session.playersResolvedThisTick) {
      if (event.success) sound.playShatter(event.playerId === 0);
      else if (event.playerId === 0) sound.playWhiff();
    }
    if (session.phase === "RESULTS" && !wasResults) sound.playFanfare();
    wasResults = session.phase === "RESULTS";

    updateHud(session);
    updateBanner(session);
    renderBoulderScene(sceneCtx, session, time);

    if (session.phase === "RESULTS") playAgainBtn.hidden = false;
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
