import {
  CANVAS_H,
  CANVAS_W,
  CURTAIN_OPEN_MS,
  DEFAULT_MAX_RADIUS,
  GUN_BASE_Y,
  GUN_BODY_RADIUS,
  GUN_LENGTH,
  gunStationX,
  IMPACT_FLASH_MS,
  POWERUP_ICONS,
  PROJECTILE_ARC_HEIGHT,
  PROJECTILE_DURATION_MS,
  PROJECTILE_MIN_SCALE,
  ROUND_INTRO_MS,
  TICK_WINDOW_MS,
} from "./constants.ts";
import type { GameSession } from "./GameSession.ts";
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

  drawOutlines(ctx, session);
  drawPowerups(ctx, session, now);
  drawSweeps(ctx, session, now);
  drawErasers(ctx, session, now);
  drawImpacts(ctx, session, now);
  drawProjectiles(ctx, session, now);
  drawPaintGuns(ctx, session);
  drawCursors(ctx, session, now);

  if (session.state === "ROUND_RESULTS") drawRoundResults(ctx, session, now);
  if (session.state === "GAME_OVER") drawGameOver(ctx, session);

  drawFrame(ctx);

  if (session.state === "ROUND_INTRO") drawCurtain(ctx, session, now);

  updateDomHud(session, now);
}

/** Thick, ornate gallery picture frame around the whole canvas — HUD lives outside it, in the DOM. */
function drawFrame(ctx: CanvasRenderingContext2D): void {
  const outer = 44;
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

function drawPowerups(ctx: CanvasRenderingContext2D, session: GameSession, now: number): void {
  for (const p of session.visiblePowerups(now)) {
    const claimed = p.state === "claimed";
    const owner = claimed ? session.players.find((pl) => pl.id === p.claimedBy) : undefined;
    ctx.save();
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
    const t = Math.min(1, (now - proj.startedAt) / PROJECTILE_DURATION_MS);
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
    const t = Math.min(1, (now - impact.at) / IMPACT_FLASH_MS);
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
    hudRoundEl.textContent = cfg ? `${cfg.label} (${session.roundIndex + 1}/${ROUNDS.length})` : "";
    if (session.state === "PLAYING") {
      const msLeft = session.roundEndAt - now;
      hudTimerEl.textContent = `${Math.max(0, Math.ceil(msLeft / 1000))}s`;
      hudTimerEl.classList.toggle("hud-timer-urgent", msLeft > 0 && msLeft <= TICK_WINDOW_MS);
    } else {
      hudTimerEl.textContent = "";
      hudTimerEl.classList.remove("hud-timer-urgent");
    }
  }

  hudScoresEl.innerHTML = session.players
    .map((p) => `<span style="color:${p.color}">${p.name} ${p.score}</span>`)
    .join("");
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

function drawCurtain(ctx: CanvasRenderingContext2D, session: GameSession, now: number): void {
  const elapsed = now - session.stateEnteredAt;
  const progress = Math.min(1, elapsed / CURTAIN_OPEN_MS);
  const half = CANVAS_W / 2;
  const panelW = half * (1 - progress);

  drawVelvetPanel(ctx, 0, panelW);
  drawVelvetPanel(ctx, CANVAS_W - panelW, panelW);

  ctx.save();
  ctx.fillStyle = "#3a2312";
  ctx.fillRect(0, 0, CANVAS_W, 24);
  ctx.restore();

  const cfg = ROUNDS[session.roundIndex];
  const secsLeft = Math.max(0, Math.ceil((ROUND_INTRO_MS - elapsed) / 1000));

  ctx.save();
  ctx.textAlign = "center";
  const boxW = 620;
  ctx.fillStyle = "rgba(20,17,24,0.55)";
  ctx.fillRect(CANVAS_W / 2 - boxW / 2, CANVAS_H / 2 - 100, boxW, 190);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 46px 'Segoe UI', sans-serif";
  ctx.fillText(cfg?.label ?? "", CANVAS_W / 2, CANVAS_H / 2 - 30);
  ctx.font = "bold 70px 'Segoe UI', sans-serif";
  ctx.fillText(String(secsLeft || 1), CANVAS_W / 2, CANVAS_H / 2 + 60);
  ctx.restore();
}

function drawRoundResults(ctx: CanvasRenderingContext2D, session: GameSession, now: number): void {
  drawPanel(ctx, 0.78);
  const elapsed = now - session.stateEnteredAt;
  const n = session.lastResults.length;
  const cycleEnd = n * session.resultsPerOutlineMs;

  ctx.textAlign = "center";

  if (n === 0 || elapsed >= cycleEnd) {
    drawRoundTotals(ctx, session);
  } else {
    const idx = Math.max(0, Math.min(n - 1, Math.floor(elapsed / session.resultsPerOutlineMs)));
    const result = session.lastResults[idx]!;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 32px 'Segoe UI', sans-serif";
    ctx.fillText(`Outline ${idx + 1} of ${n} — ${result.kind}`, CANVAS_W / 2, 130);

    const sorted = [...result.ranking].sort((a, b) => b.pixels - a.pixels);
    sorted.forEach((entry, row) => {
      const player = session.players.find((p) => p.id === entry.playerId);
      const y = 200 + row * 60;
      ctx.fillStyle = player?.color ?? "#fff";
      ctx.beginPath();
      ctx.arc(CANVAS_W / 2 - 220, y - 8, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = "left";
      ctx.font = "bold 22px 'Segoe UI', sans-serif";
      ctx.fillText(player?.name ?? "?", CANVAS_W / 2 - 195, y);
      ctx.font = "20px 'Segoe UI', sans-serif";
      ctx.fillStyle = entry.pixels > 0 ? "#fff" : "rgba(255,255,255,0.5)";
      ctx.fillText(`${entry.percent.toFixed(1)}% covered`, CANVAS_W / 2 - 30, y);
      ctx.textAlign = "right";
      ctx.fillStyle = entry.points > 0 ? "#ffd60a" : "rgba(255,255,255,0.5)";
      ctx.font = "bold 22px 'Segoe UI', sans-serif";
      ctx.fillText(`+${entry.points}`, CANVAS_W / 2 + 220, y);
      ctx.textAlign = "center";
    });

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "16px 'Segoe UI', sans-serif";
    if (n <= 20) {
      const dots = Array.from({ length: n }, (_, i) => (i === idx ? "●" : "○")).join("  ");
      ctx.fillText(dots, CANVAS_W / 2, CANVAS_H - 90);
    } else {
      ctx.fillText(`Outline ${idx + 1} / ${n}`, CANVAS_W / 2, CANVAS_H - 90);
    }
  }

  const totalDuration = Math.max(session.resultsDurationMs, 1);
  const secsLeft = Math.max(0, Math.ceil((totalDuration - elapsed) / 1000));
  ctx.fillStyle = "#fff";
  ctx.font = "18px 'Segoe UI', sans-serif";
  ctx.fillText(`Next round in ${secsLeft}s`, CANVAS_W / 2, CANVAS_H - 40);
}

function drawRoundTotals(ctx: CanvasRenderingContext2D, session: GameSession): void {
  ctx.fillStyle = "#fff";
  ctx.font = "bold 36px 'Segoe UI', sans-serif";
  ctx.fillText("Round Total", CANVAS_W / 2, 130);

  const totals = session.players.map((p) => {
    const gained = session.lastResults.reduce(
      (sum, r) => sum + (r.ranking.find((e) => e.playerId === p.id)?.points ?? 0),
      0,
    );
    return { player: p, gained };
  });
  totals.sort((a, b) => b.gained - a.gained);

  totals.forEach(({ player, gained }, i) => {
    const y = 210 + i * 54;
    ctx.fillStyle = player.color;
    ctx.font = "bold 26px 'Segoe UI', sans-serif";
    ctx.fillText(`${player.name}  +${gained}  (${player.score} total)`, CANVAS_W / 2, y);
  });
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
