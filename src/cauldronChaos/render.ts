import {
  CALLING_LEAD_MS,
  CANVAS_H,
  CANVAS_W,
  INGREDIENTS,
  INTRO_HOLD_MS,
  PLAYER_COUNT,
  SCORED_HOLD_MS,
  TURN_REVEAL_HOLD_MS,
  type Glyph,
} from "./constants.ts";
import { currentTurnPlayerId, isHumanTurnAwaitingInput, type CauldronChaosSession } from "./CauldronChaosSession.ts";
import { shelfLayout } from "./layout.ts";

const INGREDIENT_BY_ID = new Map(INGREDIENTS.map((i) => [i.id, i]));

const CAULDRON_CX = CANVAS_W / 2;
const CAULDRON_CY = 430;

const PLAYER_POSITIONS: { x: number; y: number }[] = [
  { x: 260, y: 530 },
  { x: CANVAS_W - 260, y: 530 },
  { x: 300, y: 230 },
  { x: CANVAS_W - 300, y: 230 },
];

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// --- Glyphs -------------------------------------------------------------------------------------

function drawGlyph(ctx: CanvasRenderingContext2D, glyph: Glyph, cx: number, cy: number, s: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.09);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (glyph) {
    case "flame":
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.5);
      ctx.bezierCurveTo(s * 0.4, -s * 0.1, s * 0.25, s * 0.3, 0, s * 0.5);
      ctx.bezierCurveTo(-s * 0.25, s * 0.3, -s * 0.4, -s * 0.1, 0, -s * 0.5);
      ctx.fill();
      break;
    case "moon":
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(s * 0.2, -s * 0.05, s * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      break;
    case "cap":
      ctx.beginPath();
      ctx.arc(0, s * 0.05, s * 0.4, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.rect(-s * 0.08, s * 0.05, s * 0.16, s * 0.32);
      ctx.fill();
      break;
    case "snowflake":
      for (let a = 0; a < 3; a++) {
        ctx.save();
        ctx.rotate((a * Math.PI) / 3);
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.42);
        ctx.lineTo(0, s * 0.42);
        ctx.moveTo(0, -s * 0.22);
        ctx.lineTo(-s * 0.14, -s * 0.36);
        ctx.moveTo(0, -s * 0.22);
        ctx.lineTo(s * 0.14, -s * 0.36);
        ctx.stroke();
        ctx.restore();
      }
      break;
    case "skull":
      ctx.beginPath();
      ctx.arc(0, -s * 0.05, s * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.rect(-s * 0.18, s * 0.15, s * 0.36, s * 0.16);
      ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(-s * 0.13, -s * 0.08, s * 0.09, 0, Math.PI * 2);
      ctx.arc(s * 0.13, -s * 0.08, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      break;
    case "berry":
      for (const [bx, by] of [
        [0, -s * 0.22],
        [-s * 0.2, s * 0.12],
        [s * 0.2, s * 0.12],
      ] as const) {
        ctx.beginPath();
        ctx.arc(bx, by, s * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "leaf":
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.45);
      ctx.quadraticCurveTo(s * 0.38, 0, 0, s * 0.45);
      ctx.quadraticCurveTo(-s * 0.38, 0, 0, -s * 0.45);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.4);
      ctx.lineTo(0, s * 0.4);
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.stroke();
      break;
    case "star": {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const outerA = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const innerA = outerA + Math.PI / 5;
        const ox = Math.cos(outerA) * s * 0.45;
        const oy = Math.sin(outerA) * s * 0.45;
        const ix = Math.cos(innerA) * s * 0.18;
        const iy = Math.sin(innerA) * s * 0.18;
        if (i === 0) ctx.moveTo(ox, oy);
        else ctx.lineTo(ox, oy);
        ctx.lineTo(ix, iy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "feather":
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.45);
      ctx.quadraticCurveTo(s * 0.26, -s * 0.1, 0, s * 0.45);
      ctx.quadraticCurveTo(-s * 0.26, -s * 0.1, 0, -s * 0.45);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = Math.max(1, s * 0.035);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.4);
      ctx.lineTo(0, s * 0.4);
      ctx.stroke();
      break;
    case "drop":
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.45);
      ctx.bezierCurveTo(s * 0.32, s * 0.05, s * 0.24, s * 0.45, 0, s * 0.45);
      ctx.bezierCurveTo(-s * 0.24, s * 0.45, -s * 0.32, s * 0.05, 0, -s * 0.45);
      ctx.fill();
      break;
    case "thorn":
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.45);
      ctx.lineTo(s * 0.2, s * 0.4);
      ctx.lineTo(-s * 0.2, s * 0.4);
      ctx.closePath();
      ctx.fill();
      break;
    case "spiral":
    case "swirl": {
      ctx.beginPath();
      const turns = glyph === "spiral" ? 2.1 : 1.4;
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = t * Math.PI * 2 * turns;
        const r = t * s * 0.42;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    }
    case "sparkle":
      for (let a = 0; a < 4; a++) {
        ctx.save();
        ctx.rotate((a * Math.PI) / 2);
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.45);
        ctx.lineTo(s * 0.08, -s * 0.08);
        ctx.lineTo(s * 0.45, 0);
        ctx.lineTo(s * 0.08, s * 0.08);
        ctx.lineTo(0, s * 0.45);
        ctx.lineTo(-s * 0.08, s * 0.08);
        ctx.lineTo(-s * 0.45, 0);
        ctx.lineTo(-s * 0.08, -s * 0.08);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      break;
  }
  ctx.restore();
}

// --- Background / cauldron / witch --------------------------------------------------------------

function drawBackground(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  g.addColorStop(0, "#241238");
  g.addColorStop(0.55, "#1a0f2c");
  g.addColorStop(1, "#100a1c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // A round window with a crescent moon, upper right.
  ctx.save();
  ctx.beginPath();
  ctx.arc(CANVAS_W - 140, 120, 70, 0, Math.PI * 2);
  ctx.fillStyle = "#3a2454";
  ctx.fill();
  ctx.strokeStyle = "#6a4a8a";
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = "#f4e9c9";
  drawGlyph(ctx, "moon", CANVAS_W - 140, 120, 70, "#f4e9c9");
  ctx.restore();

  // Hanging herb bundles, upper corners — simple decorative shapes.
  for (const x of [90, CANVAS_W - 90]) {
    ctx.strokeStyle = "#5a4030";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 55);
    ctx.stroke();
    ctx.fillStyle = "#4a6a3a";
    for (let i = 0; i < 5; i++) {
      const a = -0.9 + i * 0.45;
      ctx.beginPath();
      ctx.ellipse(x + Math.sin(a) * 22, 60 + Math.cos(a) * 10, 16, 7, a, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Floorboards.
  ctx.fillStyle = "#241a30";
  ctx.fillRect(0, CANVAS_H - 60, CANVAS_W, 60);
}

function drawCauldron(ctx: CanvasRenderingContext2D, now: number): void {
  const cx = CAULDRON_CX;
  const cy = CAULDRON_CY;

  // Warm fire glow underneath.
  const glow = ctx.createRadialGradient(cx, cy + 150, 10, cx, cy + 150, 140);
  glow.addColorStop(0, "rgba(255,150,60,0.55)");
  glow.addColorStop(1, "rgba(255,150,60,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 160, cy + 40, 320, 220);

  // Pot body.
  ctx.fillStyle = "#26262e";
  ctx.beginPath();
  ctx.moveTo(cx - 150, cy - 20);
  ctx.quadraticCurveTo(cx - 160, cy + 130, cx, cy + 150);
  ctx.quadraticCurveTo(cx + 160, cy + 130, cx + 150, cy - 20);
  ctx.closePath();
  ctx.fill();

  // Rim.
  ctx.fillStyle = "#3a3a44";
  ctx.beginPath();
  ctx.ellipse(cx, cy - 20, 155, 34, 0, 0, Math.PI * 2);
  ctx.fill();

  // Bubbling brew.
  ctx.fillStyle = "#3fae5a";
  ctx.beginPath();
  ctx.ellipse(cx, cy - 20, 132, 24, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy - 20, 132, 24, 0, 0, Math.PI * 2);
  ctx.clip();
  for (let i = 0; i < 7; i++) {
    const seed = i * 91.7;
    const t = (now / 1000 + seed) % 1.6;
    const bx = cx + Math.sin(seed) * 100;
    const r = 6 + ((seed * 13) % 10);
    const by = cy - 20 + 18 - t * 22;
    ctx.globalAlpha = clamp01(1 - t / 1.6);
    ctx.fillStyle = "#7be08f";
    ctx.beginPath();
    ctx.arc(bx, by, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // Legs.
  ctx.fillStyle = "#26262e";
  for (const dx of [-90, 0, 90]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx, cy + 150, 14, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWitch(ctx: CanvasRenderingContext2D): void {
  const cx = CAULDRON_CX;
  const cy = CAULDRON_CY - 130;

  // Robe.
  ctx.fillStyle = "#2f5f42";
  ctx.beginPath();
  ctx.moveTo(cx - 46, cy + 70);
  ctx.quadraticCurveTo(cx, cy + 10, cx + 46, cy + 70);
  ctx.closePath();
  ctx.fill();

  // Head.
  ctx.fillStyle = "#d9b48a";
  ctx.beginPath();
  ctx.arc(cx, cy, 26, 0, Math.PI * 2);
  ctx.fill();

  // Hat.
  ctx.fillStyle = "#3a2454";
  ctx.beginPath();
  ctx.moveTo(cx - 34, cy - 14);
  ctx.lineTo(cx + 34, cy - 14);
  ctx.lineTo(cx, cy - 90);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy - 14, 40, 9, 0, 0, Math.PI * 2);
  ctx.fill();
}

// --- Shelf / bottles -------------------------------------------------------------------------

function drawBottle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ingredientId: number,
  opts: { used: boolean; clickable: boolean; flash: "safe" | "wrong" | null; flashT: number },
): void {
  const def = INGREDIENT_BY_ID.get(ingredientId)!;
  const cx = x + w / 2;
  ctx.save();

  if (opts.flash) {
    const pulse = 1 - opts.flashT;
    ctx.save();
    ctx.globalAlpha = 0.55 * pulse;
    ctx.fillStyle = opts.flash === "safe" ? "#8fe0a0" : "#e06b6b";
    ctx.beginPath();
    ctx.ellipse(cx, y + h / 2, w * (0.75 + 0.35 * (1 - pulse)), h * (0.75 + 0.35 * (1 - pulse)), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.globalAlpha = opts.used ? 0.28 : 1;

  // Neck.
  ctx.fillStyle = "#cfd6df";
  ctx.fillRect(cx - w * 0.11, y, w * 0.22, h * 0.22);
  // Cork.
  ctx.fillStyle = "#8a6238";
  ctx.fillRect(cx - w * 0.13, y - h * 0.06, w * 0.26, h * 0.1);

  // Body (glass).
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.roundRect(x, y + h * 0.18, w, h * 0.82, w * 0.22);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 2;
  ctx.stroke();

  if (!opts.used) {
    // Liquid fill.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y + h * 0.18, w, h * 0.82, w * 0.22);
    ctx.clip();
    ctx.fillStyle = def.color;
    ctx.fillRect(x, y + h * 0.42, w, h * 0.6);
    ctx.restore();

    drawGlyph(ctx, def.glyph, cx, y + h * 0.62, w * 0.5, "rgba(255,255,255,0.92)");
  }

  if (opts.clickable) {
    ctx.strokeStyle = "#ffd60a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x - 3, y + h * 0.18 - 3, w + 6, h * 0.82 + 6, w * 0.24);
    ctx.stroke();
  }

  ctx.restore();
}

function drawShelf(ctx: CanvasRenderingContext2D, session: CauldronChaosSession): void {
  const round = session.round;
  const slots = shelfLayout(round.poolIds);
  const clickable = isHumanTurnAwaitingInput(session);
  const lastPick = round.turnSubPhase === "REVEAL" ? round.lastPick : null;
  const flashT = lastPick && round.turnRevealUntil ? clamp01(1 - (round.turnRevealUntil - session.phaseStartedAt) / TURN_REVEAL_HOLD_MS) : 0;

  for (const slot of slots) {
    const flash = lastPick?.ingredientId === slot.id ? (lastPick.safe ? "safe" : "wrong") : null;
    drawBottle(ctx, slot.x, slot.y, slot.w, slot.h, slot.id, {
      used: round.usedIds.includes(slot.id),
      clickable,
      flash,
      flashT: flash ? flashT : 0,
    });
  }
}

// --- Call banner ----------------------------------------------------------------------------

function drawCallBanner(ctx: CanvasRenderingContext2D, session: CauldronChaosSession, now: number): void {
  const round = session.round;
  if (session.callIndexRevealed === 0) return;
  const ingredientId = round.calledIds[session.callIndexRevealed - 1]!;
  const def = INGREDIENT_BY_ID.get(ingredientId)!;

  const elapsedInStep = (now - session.phaseStartedAt - CALLING_LEAD_MS) % round.config.callIntervalMs;
  const pop = clamp01(1 - elapsedInStep / 140);
  const scale = 1 + pop * 0.25;

  const cx = CAULDRON_CX;
  const cy = CAULDRON_CY - 250;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.fillStyle = "rgba(20,12,30,0.85)";
  ctx.beginPath();
  ctx.roundRect(-140, -54, 280, 108, 18);
  ctx.fill();
  ctx.strokeStyle = def.color;
  ctx.lineWidth = 4;
  ctx.stroke();
  drawGlyph(ctx, def.glyph, -80, 0, 52, def.color);
  ctx.fillStyle = "#f4ecff";
  ctx.font = "700 27px 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(def.name, -32, 2);
  ctx.restore();
}

// --- Player tokens ---------------------------------------------------------------------------

function drawPlayerTokens(ctx: CanvasRenderingContext2D, session: CauldronChaosSession, now: number): void {
  const round = session.round;
  const isPicking = session.phase === "PICKING";
  const turnPlayer = isPicking ? currentTurnPlayerId(round) : -1;
  const revealT =
    round.turnSubPhase === "REVEAL" && round.turnRevealUntil ? clamp01(1 - (round.turnRevealUntil - now) / TURN_REVEAL_HOLD_MS) : null;

  for (let playerId = 0; playerId < PLAYER_COUNT; playerId++) {
    const pos = PLAYER_POSITIONS[playerId]!;
    const identity = session.identities[playerId]!;
    const active = round.activePlayers[playerId];
    const isTurn = isPicking && turnPlayer === playerId && round.turnSubPhase === "AWAITING";
    const justResolved = round.lastPick?.playerId === playerId && round.turnSubPhase === "REVEAL";

    ctx.save();
    ctx.globalAlpha = active ? 1 : 0.35;

    if (isTurn) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 46 + pulse * 6, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffd60a";
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    if (justResolved && revealT !== null) {
      const burstColor = round.lastPick!.safe ? "#7be08f" : "#ff6b5e";
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 40 + revealT * 34, 0, Math.PI * 2);
      ctx.strokeStyle = burstColor;
      ctx.globalAlpha *= 1 - revealT;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.globalAlpha = active ? 1 : 0.35;
    }

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 34, 0, Math.PI * 2);
    ctx.fillStyle = identity.color;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 3;
    ctx.stroke();

    if (!active) {
      // A simple "out" mark.
      ctx.strokeStyle = "rgba(20,10,10,0.75)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(pos.x - 16, pos.y - 16);
      ctx.lineTo(pos.x + 16, pos.y + 16);
      ctx.moveTo(pos.x + 16, pos.y - 16);
      ctx.lineTo(pos.x - 16, pos.y + 16);
      ctx.stroke();
    }

    ctx.fillStyle = "#fff";
    ctx.font = "700 15px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(identity.name, pos.x, pos.y + 42);
    ctx.restore();
  }
}

// --- Intro / scored banners --------------------------------------------------------------------

function drawCenterBanner(ctx: CanvasRenderingContext2D, lines: string[], alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(15,9,22,0.82)";
  const w = 520;
  const h = 60 + lines.length * 46;
  ctx.beginPath();
  ctx.roundRect(CANVAS_W / 2 - w / 2, CANVAS_H / 2 - h / 2, w, h, 20);
  ctx.fill();
  ctx.strokeStyle = "#ffd60a";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.font = i === 0 ? "800 36px 'Segoe UI', sans-serif" : "600 22px 'Segoe UI', sans-serif";
    ctx.fillText(line, CANVAS_W / 2, CANVAS_H / 2 - h / 2 + 44 + i * 46);
  });
  ctx.restore();
}

export function render(ctx: CanvasRenderingContext2D, session: CauldronChaosSession, now: number): void {
  drawBackground(ctx);
  drawCauldron(ctx, now);
  drawWitch(ctx);
  drawPlayerTokens(ctx, session, now);
  drawShelf(ctx, session);

  if (session.phase === "CALLING") drawCallBanner(ctx, session, now);

  if (session.phase === "INTRO") {
    const t = clamp01((now - session.phaseStartedAt) / INTRO_HOLD_MS);
    const alpha = t < 0.15 ? t / 0.15 : t > 0.75 ? clamp01((1 - t) / 0.25) : 1;
    drawCenterBanner(ctx, [`Round ${session.roundIndex + 1}`, "Watch the witch's list..."], alpha);
  }

  if (session.phase === "SCORED" && session.round.scoresAwarded) {
    const survivorId = session.round.survivor!;
    const survivorName = session.identities[survivorId]!.name;
    const t = clamp01((now - session.phaseStartedAt) / SCORED_HOLD_MS);
    const alpha = t < 0.12 ? t / 0.12 : t > 0.85 ? clamp01((1 - t) / 0.15) : 1;
    drawCenterBanner(ctx, [`${survivorName} survives!`, "+5 points"], alpha);
  }

  if (session.phase === "RESULTS") {
    const ranked = session.identities
      .map((identity, i) => ({ identity, score: session.totalScores[i]! }))
      .sort((a, b) => b.score - a.score);
    const lines = ["Final Results", ...ranked.map((r) => `${r.identity.name}: ${r.score}`)];
    drawCenterBanner(ctx, lines, 1);
  }
}
