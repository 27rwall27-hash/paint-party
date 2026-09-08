import {
  CANVAS_H,
  CANVAS_W,
  CURTAIN_CLOSE_MS,
  CURTAIN_OPEN_MS,
  DEFAULT_MAX_RADIUS,
  FRAME_THICKNESS,
  GUN_BASE_Y,
  GUN_BODY_RADIUS,
  GUN_LENGTH,
  gunStationX,
  IMPACT_FLASH_MS,
  POWERUP_AURA_MS,
  POWERUP_ICONS,
  POWERUP_PULSE_PERIOD_MS,
  PROJECTILE_ARC_HEIGHT,
  PROJECTILE_DURATION_MS,
  PROJECTILE_MIN_SCALE,
  RESULTS_LEADERBOARD_MS,
  ROUND_NUMBER_MS,
  TICK_WINDOW_MS,
  VICTORY_CURTAIN_HOLD_MS,
  VICTORY_CURTAIN_OPEN_MS,
} from "./constants.ts";
import type { GameSession } from "./GameSession.ts";
import type { Powerup } from "./Outline.ts";
import { currentMaxRadius, isMachineGunActive } from "./Player.ts";
import { ROUNDS } from "./rounds.ts";

const BG = "#eef0f4";
const INK = "#241f29";

let canvasTexture: CanvasPattern | null | undefined;

/** A subtle woven-canvas texture (like an artist's canvas board) for the playfield background. */
function getCanvasTexture(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (canvasTexture !== undefined) return canvasTexture;

  const size = 10;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const tctx = tile.getContext("2d");
  if (!tctx) {
    canvasTexture = null;
    return null;
  }

  tctx.fillStyle = BG;
  tctx.fillRect(0, 0, size, size);
  tctx.lineWidth = 1;
  tctx.strokeStyle = "rgba(90,85,100,0.10)";
  tctx.beginPath();
  tctx.moveTo(-1, size - 1);
  tctx.lineTo(size - 1, -1);
  tctx.moveTo(-1, size * 2 - 1);
  tctx.lineTo(size * 2 - 1, -1);
  tctx.stroke();
  tctx.strokeStyle = "rgba(255,255,255,0.55)";
  tctx.beginPath();
  tctx.moveTo(-1, 1);
  tctx.lineTo(size + 1, size + 1);
  tctx.stroke();

  canvasTexture = ctx.createPattern(tile, "repeat");
  return canvasTexture;
}

export function render(ctx: CanvasRenderingContext2D, session: GameSession, now: number): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = getCanvasTexture(ctx) ?? BG;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  if (session.state === "MENU") {
    drawMenu(ctx);
    drawFrame(ctx);
    updateDomHud(session, now);
    return;
  }

  // The victory reveal is deliberately its own clean scene — not the finale's frozen board with a
  // banner pasted over it — so it skips every board-drawing call above and starts from the same
  // blank textured background this function already painted, behind a closed curtain.
  if (session.state === "VICTORY") {
    drawFrame(ctx);
    drawVictory(ctx, session, now);
    updateDomHud(session, now);
    return;
  }

  drawOutlines(ctx, session);
  drawPowerups(ctx, session, now);
  drawSweeps(ctx, session, now);
  drawErasers(ctx, session, now);
  drawImpacts(ctx, session, now);
  drawProjectiles(ctx, session, now);
  drawPaintGuns(ctx, session);
  drawCursors(ctx, session, now);

  // The point-reveal ("+N") draws while the board is still fully visible, before the curtain has
  // any part in this state — everything after that (the closing curtain and what's shown on it)
  // has to be drawn after drawFrame() below so it covers the frame too, not just the canvas.
  if (session.state === "ROUND_RESULTS") drawResultsReveal(ctx, session, now);
  if (session.state === "GAME_OVER") drawGameOver(ctx, session);

  drawFrame(ctx);

  if (session.state === "ROUND_INTRO") drawCurtain(ctx, session, now);
  if (session.state === "ROUND_RESULTS") drawResultsCurtain(ctx, session, now);

  updateDomHud(session, now);
}

/** Thick, ornate gallery picture frame around the whole canvas — HUD lives outside it, in the DOM.
 * FRAME_THICKNESS (constants.ts) is shared with drawCurtainPanels and the player-movement clamp,
 * so the curtain always covers exactly this same border and players can't wander behind it. */
function drawFrame(ctx: CanvasRenderingContext2D): void {
  const outer = FRAME_THICKNESS;
  ctx.save();

  const grad = ctx.createLinearGradient(0, 0, outer, outer);
  grad.addColorStop(0, "#7a5220");
  grad.addColorStop(0.35, "#e8c874");
  grad.addColorStop(0.55, "#fff3c9");
  grad.addColorStop(0.75, "#c99a3f");
  grad.addColorStop(1, "#6b4718");
  ctx.strokeStyle = grad;
  ctx.lineWidth = outer;
  ctx.strokeRect(outer / 2, outer / 2, CANVAS_W - outer, CANVAS_H - outer);

  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 4;
  ctx.strokeRect(outer - 10, outer - 10, CANVAS_W - (outer - 10) * 2, CANVAS_H - (outer - 10) * 2);
  ctx.strokeStyle = "rgba(60,35,10,0.6)";
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, CANVAS_W - 20, CANVAS_H - 20);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, CANVAS_W - 8, CANVAS_H - 8);
  ctx.restore();
}

function drawMenu(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.font = "bold 64px 'Segoe UI', sans-serif";
  ctx.fillText("PAINT PARTY", CANVAS_W / 2, 180);
  ctx.font = "24px 'Segoe UI', sans-serif";
  ctx.fillText("Hold your paint key to charge, release to fling a paint blob.", CANVAS_W / 2, 230);
  ctx.fillText("Grab power-up circles before their timer runs out for a bonus.", CANVAS_W / 2, 262);

  const cols = [
    { name: "P1", color: "#e63946", move: "W A S D", paint: "Space" },
    { name: "P2", color: "#3a86ff", move: "Arrow Keys", paint: "/" },
    { name: "P3", color: "#ffd60a", move: "I J K L", paint: "O" },
    { name: "P4", color: "#2ecc71", move: "T F G H", paint: "R" },
  ];
  const startX = CANVAS_W / 2 - ((cols.length - 1) * 220) / 2;
  cols.forEach((c, i) => {
    const x = startX + i * 220;
    const y = 380;
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = "bold 20px 'Segoe UI', sans-serif";
    ctx.fillText(c.name, x, y + 55);
    ctx.font = "16px 'Segoe UI', sans-serif";
    ctx.fillText(`Move: ${c.move}`, x, y + 80);
    ctx.fillText(`Paint: ${c.paint}`, x, y + 102);
  });

  ctx.font = "bold 26px 'Segoe UI', sans-serif";
  ctx.fillText("Press any PAINT key to start", CANVAS_W / 2, 540);
  ctx.font = "18px 'Segoe UI', sans-serif";
  ctx.fillText(
    `${ROUNDS.length} rounds • ranked by coverage each outline • 1st = 3pts, 2nd = 2pts, 3rd = 1pt`,
    CANVAS_W / 2,
    580,
  );
}

function drawOutlines(ctx: CanvasRenderingContext2D, session: GameSession): void {
  for (const outline of session.outlines) {
    ctx.drawImage(outline.paintCanvas, 0, 0);
    ctx.save();
    ctx.strokeStyle = "#8a8594";
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.stroke(outline.path);
    ctx.restore();
  }
}

/** A brief bright ring that expands and fades out right when a power-up spawns — separate from
 * the continuous pulse, a one-time "look here" flash for the first half second on screen. */
function drawPowerupAura(ctx: CanvasRenderingContext2D, p: Powerup, now: number): void {
  const t = (now - p.spawnedAt) / POWERUP_AURA_MS;
  if (t < 0 || t >= 1) return;
  const radius = p.radius * (1 + t * 1.8);
  const alpha = (1 - t) * 0.7;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "#fff9d6";
  ctx.lineWidth = 4 * (1 - t) + 1;
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPowerups(ctx: CanvasRenderingContext2D, session: GameSession, now: number): void {
  for (const p of session.visiblePowerups(now)) {
    const claimed = p.state === "claimed";
    const owner = claimed ? session.players.find((pl) => pl.id === p.claimedBy) : undefined;

    if (!claimed) drawPowerupAura(ctx, p, now);

    ctx.save();
    if (!claimed) {
      // Continuous "notice me" pulse for as long as it's on screen (not just a moment after
      // spawning) — purely a function of elapsed time, like every other animated effect here.
      const phase = ((now - p.spawnedAt) / POWERUP_PULSE_PERIOD_MS) * Math.PI * 2;
      const pulseScale = 1 + 0.12 * Math.sin(phase);
      ctx.translate(p.cx, p.cy);
      ctx.scale(pulseScale, pulseScale);
      ctx.translate(-p.cx, -p.cy);
    }
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = claimed ? (owner?.color ?? "#999") : "#ffffff";
    ctx.globalAlpha = claimed ? 0.9 : 0.95;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#5b5566";
    ctx.setLineDash(claimed ? [] : [4, 3]);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (p.type === "eraser") {
      drawEraserIcon(ctx, p.cx, p.cy, p.radius * 1.5, -Math.PI / 5);
    } else {
      ctx.fillStyle = "#241f29";
      ctx.font = "bold 14px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(POWERUP_ICONS[p.type], p.cx, p.cy + 1);
      ctx.textBaseline = "alphabetic";
    }
    ctx.restore();

    if (!claimed) {
      const secsLeft = Math.max(0, (p.expiresAt - now) / 1000);
      ctx.save();
      ctx.fillStyle = secsLeft <= 1.5 ? "#e63946" : "#241f29";
      ctx.font = "bold 15px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(secsLeft.toFixed(1), p.cx, p.cy - p.radius - 10);
      ctx.restore();
    }
  }
}

function drawSweeps(ctx: CanvasRenderingContext2D, session: GameSession, now: number): void {
  for (const s of session.sweeps) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = s.color;
    ctx.fillRect(0, s.bandY, CANVAS_W, s.bandH);
    ctx.globalAlpha = 0.4;
    ctx.fillRect(s.x - 3, s.bandY, 6, s.bandH);
    ctx.restore();

    const bob = Math.sin(now / 60) * 4;
    ctx.save();
    ctx.font = "28px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(s.x, s.bandY + s.bandH / 2 + bob);
    ctx.rotate(Math.PI / 4);
    ctx.fillText("🖌️", 0, 0);
    ctx.restore();
  }
}

function drawProjectiles(ctx: CanvasRenderingContext2D, session: GameSession, now: number): void {
  for (const proj of session.projectiles) {
    // Lower-clamped, not just upper — `now` can be a hair behind `startedAt` in rare timing edge
    // cases (rAF timestamp semantics, clock-sync slop in online play), and an unclamped negative
    // t here corrupts the scale math below into a negative radius, which crashes ctx.ellipse().
    const t = Math.max(0, Math.min(1, (now - proj.startedAt) / PROJECTILE_DURATION_MS));
    const arcScale = Math.max(0.35, proj.radius / DEFAULT_MAX_RADIUS);
    const hop = Math.sin(t * Math.PI) * PROJECTILE_ARC_HEIGHT * arcScale * 0.4;
    // Travels in from each player's launch station rather than popping straight up —
    // reads as fired at the canvas from a distance instead of dropped from overhead.
    const curX = proj.launchX + (proj.x - proj.launchX) * t;
    const curY = proj.launchY + (proj.y - proj.launchY) * t - hop;
    const scale = PROJECTILE_MIN_SCALE + (1 - PROJECTILE_MIN_SCALE) * t;
    const r = proj.radius * 0.7 * scale;

    if (t < 0.85) {
      const trailT = Math.max(0, t - 0.08);
      const trailX = proj.launchX + (proj.x - proj.launchX) * trailT;
      const trailY = proj.launchY + (proj.y - proj.launchY) * trailT - Math.sin(trailT * Math.PI) * PROJECTILE_ARC_HEIGHT * arcScale * 0.4;
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = proj.color;
      ctx.lineWidth = Math.max(1, r * 0.5);
      ctx.beginPath();
      ctx.moveTo(trailX, trailY);
      ctx.lineTo(curX, curY);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = 0.22 * scale;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(proj.x, proj.y, proj.radius * 0.5 * scale, proj.radius * 0.2 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = proj.color;
    ctx.beginPath();
    ctx.arc(curX, curY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.arc(curX - r * 0.3, curY - r * 0.3, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** The little pink rubber-eraser glyph, shared by the roaming hazard and its power-up icon. */
function drawEraserIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rotation: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = "#ffb6c9";
  ctx.strokeStyle = "#8a3350";
  ctx.lineWidth = Math.max(1, size * 0.06);
  const w = size * 0.9;
  const h = size * 0.55;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, Math.max(2, size * 0.1));
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#8a3350";
  ctx.fillRect(-w / 2, -h / 2, w * 0.3, h);
  ctx.restore();
}

function drawErasers(ctx: CanvasRenderingContext2D, session: GameSession, now: number): void {
  for (const eraser of session.erasers) {
    const spin = (now / 140) % (Math.PI * 2);
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#ff3b6b";
    ctx.beginPath();
    ctx.arc(eraser.x, eraser.y, eraser.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawEraserIcon(ctx, eraser.x, eraser.y, eraser.radius, spin);
  }
}

function drawImpacts(ctx: CanvasRenderingContext2D, session: GameSession, now: number): void {
  for (const impact of session.impacts) {
    const t = Math.max(0, Math.min(1, (now - impact.at) / IMPACT_FLASH_MS));
    const ringR = impact.radius * (0.9 + t * 1.4);
    ctx.save();
    ctx.globalAlpha = 0.5 * (1 - t);
    ctx.strokeStyle = impact.color;
    ctx.lineWidth = Math.max(1.5, impact.radius * 0.18 * (1 - t));
    ctx.beginPath();
    ctx.arc(impact.x, impact.y, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    if (t < 0.5) {
      const spikeAlpha = 1 - t * 2;
      const spikes = 8;
      ctx.save();
      ctx.globalAlpha = 0.6 * spikeAlpha;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      for (let i = 0; i < spikes; i++) {
        const angle = (i / spikes) * Math.PI * 2;
        const inner = impact.radius * (0.5 + t * 0.6);
        const outer = inner + impact.radius * 0.5;
        ctx.beginPath();
        ctx.moveTo(impact.x + Math.cos(angle) * inner, impact.y + Math.sin(angle) * inner);
        ctx.lineTo(impact.x + Math.cos(angle) * outer, impact.y + Math.sin(angle) * outer);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

function drawPaintGuns(ctx: CanvasRenderingContext2D, session: GameSession): void {
  const count = session.players.length;
  for (const player of session.players) {
    const baseX = gunStationX(player.id, count);
    const angle = Math.atan2(player.y - GUN_BASE_Y, player.x - baseX);

    ctx.save();
    ctx.translate(baseX, GUN_BASE_Y);

    ctx.fillStyle = "#2a2530";
    ctx.beginPath();
    ctx.arc(0, 0, GUN_BODY_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(angle);
    ctx.fillStyle = player.color;
    ctx.strokeStyle = "#241f29";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(0, -7, GUN_LENGTH, 14, 5);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(baseX, GUN_BASE_Y, GUN_BODY_RADIUS * 0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = INK;
    ctx.font = "bold 11px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(player.name, baseX, GUN_BASE_Y + GUN_BODY_RADIUS + 16);
  }
}

function drawCursors(ctx: CanvasRenderingContext2D, session: GameSession, now: number): void {
  for (const player of session.players) {
    const maxR = currentMaxRadius(player, now);
    ctx.save();
    ctx.strokeStyle = player.color;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(player.x, player.y, maxR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = player.color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.cursorRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#241f29";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = INK;
    ctx.font = "bold 13px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(player.name, player.x, player.y - maxR - 8);

    if (isMachineGunActive(player, now)) {
      ctx.fillStyle = "#e63946";
      ctx.fillText("🔫", player.x, player.y - maxR - 24);
    }
    if (now < player.shrinkUntil) {
      ctx.fillStyle = "#5b5566";
      ctx.fillText("shrunk", player.x, player.y + maxR + 16);
    }
    if (now < player.confusedUntil) {
      ctx.fillStyle = "#8a3ba8";
      ctx.fillText("💫 dizzy", player.x, player.y + maxR + 32);
    }
    if (player.bigShotPending) {
      ctx.fillStyle = "#e6a63c";
      ctx.fillText("big shot ready", player.x, player.y - maxR - 24);
    }
  }
}

const hudRoundEl = document.querySelector<HTMLElement>("#hudRound");
const hudTimerEl = document.querySelector<HTMLElement>("#hudTimer");
const hudScoresEl = document.querySelector<HTMLElement>("#hudScores");

/** Updates the real DOM header bar above the canvas — kept outside the picture frame entirely. */
export function updateDomHud(session: GameSession, now: number): void {
  if (!hudRoundEl || !hudTimerEl || !hudScoresEl) return;

  if (session.state === "MENU") {
    hudRoundEl.textContent = "Paint Party";
    hudTimerEl.textContent = "";
    hudTimerEl.classList.remove("hud-timer-urgent");
  } else {
    const cfg = ROUNDS[session.roundIndex];
    hudRoundEl.textContent = cfg ? `Round ${session.roundIndex + 1} of ${ROUNDS.length}` : "";
    if (session.state === "PLAYING") {
      const msLeft = session.roundEndAt - now;
      hudTimerEl.textContent = `${Math.max(0, Math.ceil(msLeft / 1000))}s`;
      hudTimerEl.classList.toggle("hud-timer-urgent", msLeft > 0 && msLeft <= TICK_WINDOW_MS);
    } else {
      hudTimerEl.textContent = "";
      hudTimerEl.classList.remove("hud-timer-urgent");
    }
  }

  // The finale keeps the leaderboard hidden entirely — from the moment its curtain opens right up
  // through the "Player X Wins!" reveal — so the standings stay a secret until that big moment.
  const isFinaleBlackout =
    session.roundIndex === ROUNDS.length - 1 && session.state !== "GAME_OVER" && session.state !== "MENU";

  if (isFinaleBlackout) {
    hudScoresEl.innerHTML = "";
  } else {
    // Sorted by score so it reads as an actual leaderboard, with whoever's currently in the lead
    // (ties included) visually called out — otherwise it's hard to tell who's winning at a glance.
    const sorted = [...session.players].sort((a, b) => b.score - a.score);
    const topScore = sorted[0]?.score ?? 0;
    hudScoresEl.innerHTML = sorted
      .map((p) => {
        const isLeader = topScore > 0 && p.score === topScore;
        const scoreText = Number.isInteger(p.score) ? String(p.score) : p.score.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
        return `<span class="hudScoreItem${isLeader ? " is-leader" : ""}" style="--player-color:${p.color}">${
          isLeader ? '<span class="hudCrown">👑</span>' : ""
        }<span class="hudName">${p.name}</span><span class="hudPts">${scoreText}</span></span>`;
      })
      .join("");
  }
}

function drawPanel(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.save();
  ctx.fillStyle = `rgba(20,17,24,${alpha})`;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();
}

function drawVelvetPanel(ctx: CanvasRenderingContext2D, x: number, w: number): void {
  if (w <= 0) return;
  ctx.save();
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, "#5c0f18");
  grad.addColorStop(0.5, "#8a1c28");
  grad.addColorStop(1, "#5c0f18");
  ctx.fillStyle = grad;
  ctx.fillRect(x, 0, w, CANVAS_H);

  ctx.globalAlpha = 0.25;
  const foldW = 26;
  for (let fx = x; fx < x + w; fx += foldW) {
    ctx.fillStyle = (fx / foldW) % 2 === 0 ? "#000" : "#fff";
    ctx.fillRect(fx, 0, foldW / 2, CANVAS_H);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#c9a227";
  for (let sx = x + 12; sx < x + w; sx += 30) {
    ctx.beginPath();
    ctx.arc(sx, CANVAS_H - 6, 12, 0, Math.PI, false);
    ctx.fill();
  }
  ctx.restore();
}

/** Draws the velvet side panels at a given "how closed" amount (0 = fully open/no panel, 1 =
 * fully closed/meeting in the middle) — shared by the round-intro opening, the results-screen
 * closing tail, and the victory reveal's opening, so the motion is visually continuous across all
 * three (a close always ends exactly where the next open begins). Always called after drawFrame();
 * each panel already fills the full canvas height (see drawVelvetPanel), so the two panels alone
 * fully mask the picture frame's border — top and bottom included — the instant they meet in the
 * middle, with no separate full-width bar needed (a full-width bar here would sit as a static
 * "shadow band" across the top/bottom that doesn't recede as the panels open — the bug this
 * comment used to describe fixing, badly). The valance strip below is purely decorative and scoped
 * to each panel's own width so it opens and closes in step with the rest of the curtain. */
function drawCurtainPanels(ctx: CanvasRenderingContext2D, closedAmount: number): void {
  const half = CANVAS_W / 2;
  const panelW = half * Math.max(0, Math.min(1, closedAmount));
  if (panelW <= 0) return;

  drawVelvetPanel(ctx, 0, panelW);
  drawVelvetPanel(ctx, CANVAS_W - panelW, panelW);

  ctx.save();
  ctx.fillStyle = "#3a2312";
  ctx.fillRect(0, 0, panelW, 24);
  ctx.fillRect(CANVAS_W - panelW, 0, panelW, 24);
  ctx.restore();
}

/** The closed curtain shows just the round number (fading in, holding, fading out — no countdown)
 * for ROUND_NUMBER_MS, then opens over CURTAIN_OPEN_MS straight into the round with nothing drawn
 * over it — PLAYING (and the "Start!" cue) begins right as the curtain finishes opening. */
function drawCurtain(ctx: CanvasRenderingContext2D, session: GameSession, now: number): void {
  const elapsed = now - session.stateEnteredAt;
  const progress = Math.max(0, Math.min(1, (elapsed - ROUND_NUMBER_MS) / CURTAIN_OPEN_MS));
  drawCurtainPanels(ctx, 1 - progress);

  if (elapsed < ROUND_NUMBER_MS) {
    const fadeMs = 250;
    let alpha = 1;
    if (elapsed < fadeMs) alpha = elapsed / fadeMs;
    else if (elapsed > ROUND_NUMBER_MS - fadeMs) alpha = Math.max(0, (ROUND_NUMBER_MS - elapsed) / fadeMs);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.font = "bold 64px 'Segoe UI', sans-serif";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(20,17,24,0.6)";
    ctx.strokeText(`Round ${session.roundIndex + 1}`, CANVAS_W / 2, CANVAS_H / 2 + 20);
    ctx.fillStyle = "#fff";
    ctx.fillText(`Round ${session.roundIndex + 1}`, CANVAS_W / 2, CANVAS_H / 2 + 20);
    ctx.restore();
  }
}

const CONFETTI_COUNT = 60;
const CONFETTI_COLORS = ["#e63946", "#3a86ff", "#ffd60a", "#2ecc71", "#ff8fab", "#9b5de5"];

/** Continuous confetti shower — each particle loops back to the top as soon as it falls past the
 * bottom, so it keeps falling for as long as the caller keeps drawing it (the victory screen).
 * Deterministic pseudo-random motion seeded only by particle index, so every call this frame (and
 * every frame after it) computes the same particle at the same elapsed time without render.ts
 * needing to own any mutable confetti state — same "pure function of elapsed time" pattern as
 * every other animated effect here. */
function drawConfetti(ctx: CanvasRenderingContext2D, elapsed: number): void {
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const seed = i * 12.9898;
    const rand = (n: number) => {
      const x = Math.sin(seed + n) * 43758.5453;
      return x - Math.floor(x);
    };

    const fallSpeed = 90 + rand(2) * 140;
    const cycleMs = ((CANVAS_H + 40) / fallSpeed) * 1000;
    const offsetMs = rand(8) * cycleMs;
    const particleT = (((elapsed + offsetMs) % cycleMs) + cycleMs) % cycleMs / 1000;
    const y = -20 + particleT * fallSpeed;

    const x0 = rand(1) * CANVAS_W;
    const sway = 20 + rand(3) * 30;
    const swayFreq = 1.5 + rand(4) * 2;
    const x = x0 + Math.sin(particleT * swayFreq) * sway;
    const size = 5 + rand(5) * 6;
    const color = CONFETTI_COLORS[Math.floor(rand(6) * CONFETTI_COLORS.length)]!;
    const rotation = particleT * ((rand(7) - 0.5) * 6);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.fillStyle = color;
    ctx.fillRect(-size / 2, -size / 4, size, size / 2);
    ctx.restore();
  }
}

/** Phase 1 of ROUND_RESULTS: the in-place "+N" point reveal, drawn while the board is still fully
 * visible (called before drawFrame/the curtain — see render()). A no-op once the reveal phase is
 * over (session.resultsRevealEndMs), so this and drawResultsCurtain never draw at the same time. */
function drawResultsReveal(ctx: CanvasRenderingContext2D, session: GameSession, now: number): void {
  const elapsed = now - session.stateEnteredAt;
  if (session.lastResults.length === 0 || elapsed >= session.resultsRevealEndMs) return;
  ctx.textAlign = "center";
  drawResultsInPlaceReveal(ctx, session, elapsed);
}

/** Phase 2+3 of ROUND_RESULTS, drawn after drawFrame so it covers the frame too: the curtain
 * closes (CURTAIN_CLOSE_MS) once the reveal is done, then a leaderboard holds on the fully closed
 * curtain (RESULTS_LEADERBOARD_MS) before this state ends — the next state (round intro, or
 * victory after the finale) picks up from that same closed curtain. */
function drawResultsCurtain(ctx: CanvasRenderingContext2D, session: GameSession, now: number): void {
  const elapsed = now - session.stateEnteredAt;
  const revealEnd = session.resultsRevealEndMs;
  if (elapsed < revealEnd) return;

  const closeProgress = Math.max(0, Math.min(1, (elapsed - revealEnd) / CURTAIN_CLOSE_MS));
  drawCurtainPanels(ctx, closeProgress);

  const leaderboardElapsed = elapsed - revealEnd - CURTAIN_CLOSE_MS;
  if (leaderboardElapsed >= 0 && leaderboardElapsed < RESULTS_LEADERBOARD_MS) {
    drawResultsLeaderboard(ctx, session, leaderboardElapsed);
  }
}

const REVEAL_HOLD_MS = 750; // sits in place, readable, before it starts moving
const REVEAL_TRAVEL_MS = 550; // then floats up toward the leaderboard in the HUD

/** Animates each scoring player's "+N" appearing just above its own outline's real position,
 * holding there briefly, then floating up toward the leaderboard at the top of the screen —
 * purely a function of elapsed time against session.revealTimeline, same pattern as every other
 * animated effect in this file (impacts, projectiles, the curtain). A stroke outline keeps it
 * legible over whatever's already painted there, since there's no dimming panel behind it. */
function drawResultsInPlaceReveal(ctx: CanvasRenderingContext2D, session: GameSession, elapsed: number): void {
  const totalMs = REVEAL_HOLD_MS + REVEAL_TRAVEL_MS;
  // boundingRadius is calibrated conservatively for overlap/collision checks, not visual size —
  // a tall thin custom shape can report one big enough to push "just above it" off the top of the
  // canvas entirely, so the hold position is clamped clear of the frame/HUD regardless of size.
  const MIN_HOLD_Y = 110;
  const ARRIVAL_Y = 22; // near the top edge, right where the HUD leaderboard sits just above

  for (const step of session.revealTimeline) {
    const local = elapsed - step.atMs;
    if (local < 0 || local >= totalMs) continue;
    const outline = session.outlines[step.outlineIndex];
    if (!outline) continue;

    const player = session.players.find((p) => p.id === step.playerId);
    const holdY = Math.max(MIN_HOLD_Y, outline.cy - outline.boundingRadius - 16);

    let y: number;
    let scale: number;
    let alpha = 1;
    if (local < REVEAL_HOLD_MS) {
      const popT = Math.min(1, local / 200);
      scale = 1 + 0.3 * Math.sin(popT * Math.PI);
      y = holdY;
    } else {
      const travelT = (local - REVEAL_HOLD_MS) / REVEAL_TRAVEL_MS;
      const eased = travelT * travelT * (3 - 2 * travelT); // smoothstep
      y = holdY - (holdY - ARRIVAL_Y) * eased;
      scale = 1 - 0.35 * eased; // shrinks a little as it arrives, reads as receding toward the HUD
      alpha = travelT < 0.55 ? 1 : Math.max(0, 1 - (travelT - 0.55) / 0.45);
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${Math.round(24 * scale)}px 'Segoe UI', sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(20,17,24,0.65)";
    ctx.strokeText(`+${step.points}`, outline.cx, y);
    ctx.fillStyle = player?.color ?? "#fff";
    ctx.fillText(`+${step.points}`, outline.cx, y);
    ctx.restore();
  }
}

const LEADERBOARD_FADE_MS = 250;

/** The standings, shown on the fully closed curtain between rounds — fades in, holds, fades out.
 * The finale keeps the standings a secret right up to the "Player X Wins!" reveal, so it shows the
 * same vague suspense message it always has instead of real scores for that one round. */
function drawResultsLeaderboard(ctx: CanvasRenderingContext2D, session: GameSession, elapsed: number): void {
  let alpha = 1;
  if (elapsed < LEADERBOARD_FADE_MS) alpha = elapsed / LEADERBOARD_FADE_MS;
  else if (elapsed > RESULTS_LEADERBOARD_MS - LEADERBOARD_FADE_MS) {
    alpha = Math.max(0, (RESULTS_LEADERBOARD_MS - elapsed) / LEADERBOARD_FADE_MS);
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.font = "bold 36px 'Segoe UI', sans-serif";

  if (session.roundIndex === ROUNDS.length - 1) {
    ctx.fillText("Final Scores Are In...", CANVAS_W / 2, 130);
    ctx.font = "22px 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("The results are revealed after the curtain falls.", CANVAS_W / 2, 190);
    ctx.restore();
    return;
  }

  ctx.fillText("Leaderboard", CANVAS_W / 2, 130);

  const sorted = [...session.players].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? 0;
  sorted.forEach((player, i) => {
    const isLeader = topScore > 0 && player.score === topScore;
    const y = 210 + i * 60;
    ctx.fillStyle = player.color;
    ctx.font = `bold ${isLeader ? 30 : 26}px 'Segoe UI', sans-serif`;
    ctx.fillText(`${isLeader ? "\u{1F451} " : ""}${player.name}  ${player.score} pts`, CANVAS_W / 2, y);
  });
  ctx.restore();
}

/** A longer, drum-roll-backed hold with the curtain fully closed, then a slower open (both longer
 * than a normal round-intro's) onto a "Player X Wins!" reveal in the winner's color, with
 * continuous confetti for as long as this screen is up — the dramatic payoff for the finale's
 * hidden scoreboard. The text is a stage-style reveal: an outlined, color-filled headline under a
 * soft radial spotlight, not a dimmed banner — drawn *before* the curtain panels, so the curtain
 * genuinely masks it until it opens. Falls through into the existing final-scores screen after. */
function drawVictory(ctx: CanvasRenderingContext2D, session: GameSession, now: number): void {
  const elapsed = now - session.stateEnteredAt;
  const revealElapsed = Math.max(0, elapsed - VICTORY_CURTAIN_HOLD_MS);
  const progress = Math.max(0, Math.min(1, revealElapsed / VICTORY_CURTAIN_OPEN_MS));

  drawConfetti(ctx, revealElapsed);

  const topScore = Math.max(0, ...session.players.map((p) => p.score));
  const winners = session.players.filter((p) => p.score === topScore);
  const winnerColor = winners[0]?.color ?? "#fff";
  const text =
    winners.length > 1 ? `${winners.map((p) => p.name).join(" & ")} Win!` : `${winners[0]?.name ?? "?"} Wins!`;

  ctx.save();
  // A dark vignette with a bright pool left uncovered in the middle reads as an actual stage
  // spotlight (dims everything but the text) rather than a faint glow — a plain white glow was
  // nearly invisible against the light canvas background underneath.
  const spotlightY = CANVAS_H / 2 + 10;
  const vignette = ctx.createRadialGradient(CANVAS_W / 2, spotlightY, 40, CANVAS_W / 2, spotlightY, 480);
  vignette.addColorStop(0, "rgba(10,8,16,0)");
  vignette.addColorStop(0.45, "rgba(10,8,16,0.35)");
  vignette.addColorStop(1, "rgba(10,8,16,0.82)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.textAlign = "center";
  ctx.font = "bold 66px 'Segoe UI', sans-serif";
  ctx.lineWidth = 7;
  ctx.strokeStyle = "#1a1520";
  ctx.strokeText(text, CANVAS_W / 2, CANVAS_H / 2 + 22);
  ctx.fillStyle = winnerColor;
  ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2 + 22);
  ctx.restore();

  drawCurtainPanels(ctx, 1 - progress);
}

function drawGameOver(ctx: CanvasRenderingContext2D, session: GameSession): void {
  drawPanel(ctx, 0.82);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.font = "bold 48px 'Segoe UI', sans-serif";
  ctx.fillText("Final Scores", CANVAS_W / 2, 140);

  const ranked = [...session.players].sort((a, b) => b.score - a.score);
  ranked.forEach((p, i) => {
    ctx.fillStyle = p.color;
    ctx.font = "bold 30px 'Segoe UI', sans-serif";
    ctx.fillText(`${i + 1}. ${p.name} — ${p.score} pts`, CANVAS_W / 2, 220 + i * 50);
  });

  ctx.fillStyle = "#fff";
  ctx.font = "22px 'Segoe UI', sans-serif";
  ctx.fillText("Press any PAINT key to play again", CANVAS_W / 2, CANVAS_H - 60);
}
