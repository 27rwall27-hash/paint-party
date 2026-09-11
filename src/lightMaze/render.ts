import {
  CANVAS_H,
  CANVAS_W,
  DOOR_COLOR,
  DOOR_LENGTH_FRACTION,
  DOOR_SWING_OPEN_MS,
  DOOR_SWING_SHUT_MS,
  FAILED_MARKER_MS,
  GRID_MARGIN,
  GRID_SIZE,
  HUD_HEIGHT,
  MID_INDEX,
  OUTER_BORDER_WIDTH,
  PLAYER_RADIUS,
  STEP_DISTANCE,
  TOTAL_ROOMS,
  VESTIBULE_DEPTH,
  WALL_COLOR,
  WALL_WIDTH,
} from "./constants.ts";
import { directionFromTo, entranceRoomForSide, ENTRANCE_SIDE_BY_PLAYER, QUADRANT_BY_PLAYER, type DoorEdge, type Position, type RoomId } from "./grid.ts";
import type { PlayerIdentity } from "./identities.ts";
import type { LightMazeSession, PlayerState } from "./LightMazeSession.ts";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function lerpColor(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return `rgb(${Math.round(lerp(a.r, b.r, t))}, ${Math.round(lerp(a.g, b.g, t))}, ${Math.round(lerp(a.b, b.b, t))})`;
}

// Total room-units spanned by the drawable area — the grid itself, plus a vestibule margin
// reserved on ALL FOUR sides (since all 4 entrances/vestibules are in view simultaneously).
const WORLD_SIZE = GRID_SIZE + 2 * VESTIBULE_DEPTH;

interface Layout {
  cellSize: number;
  originX: number; // pixel position of room (row 0, col 0)'s CENTER
  originY: number;
}

function computeLayout(): Layout {
  const availW = CANVAS_W - GRID_MARGIN * 2;
  const availH = CANVAS_H - HUD_HEIGHT - GRID_MARGIN * 2;
  const cellSize = Math.min(availW, availH) / WORLD_SIZE;
  const worldPixelW = cellSize * WORLD_SIZE;
  const worldPixelH = cellSize * WORLD_SIZE;
  const boxLeft = (CANVAS_W - worldPixelW) / 2;
  const boxTop = HUD_HEIGHT + (CANVAS_H - HUD_HEIGHT - worldPixelH) / 2;
  return {
    cellSize,
    originX: boxLeft + (0.5 + VESTIBULE_DEPTH) * cellSize,
    originY: boxTop + (0.5 + VESTIBULE_DEPTH) * cellSize,
  };
}

function worldToPixel(layout: Layout, pos: Position): { x: number; y: number } {
  return { x: layout.originX + pos.col * layout.cellSize, y: layout.originY + pos.row * layout.cellSize };
}

function roomCenter(layout: Layout, room: RoomId): { x: number; y: number } {
  return worldToPixel(layout, { row: room.row, col: room.col });
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** Every interior edge's roomA is always the room immediately N or W of roomB (see
 * interiorEdgeKey's string-ordering, which — since every row/col is a single digit 0-4 — sorts
 * exactly the same as comparing (row,col) tuples). The door is a small section CENTERED in the
 * middle of the wall (see DOOR_LENGTH_FRACTION), flanked by a plain solid stub of ordinary wall on
 * each side — closed, it lies flush along its own wall, filling that middle gap (indistinguishable
 * from the stubs apart from its distinct color — see DOOR_COLOR); fully open, it's hinged at its
 * own near end and rotated 90° OUTWARD (away from roomA, toward roomB) to lie flush alongside the
 * wall it swept through — fully out of the passage, parallel to a wall at both ends of the swing. */
function computeEdgeGeom(
  layout: Layout,
  edge: DoorEdge,
): { doorStart: { x: number; y: number }; doorEnd: { x: number; y: number }; wallStart: { x: number; y: number }; wallEnd: { x: number; y: number }; wallDir: { x: number; y: number }; perpDir: { x: number; y: number }; doorLen: number } {
  const dir = directionFromTo(edge.roomA, edge.roomB);
  const isVertical = dir === "E";
  const a = roomCenter(layout, edge.roomA);
  const half = layout.cellSize / 2;
  const wallStart = isVertical ? { x: a.x + half, y: a.y - half } : { x: a.x - half, y: a.y + half };
  const wallDir = isVertical ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const perpDir = isVertical ? { x: 1, y: 0 } : { x: 0, y: 1 }; // OUT of roomA, toward roomB
  const wallEnd = { x: wallStart.x + wallDir.x * layout.cellSize, y: wallStart.y + wallDir.y * layout.cellSize };
  const doorLen = layout.cellSize * DOOR_LENGTH_FRACTION;
  const doorOffset = (layout.cellSize - doorLen) / 2;
  const doorStart = { x: wallStart.x + wallDir.x * doorOffset, y: wallStart.y + wallDir.y * doorOffset };
  const doorEnd = { x: doorStart.x + wallDir.x * doorLen, y: doorStart.y + wallDir.y * doorLen };
  return { doorStart, doorEnd, wallStart, wallEnd, wallDir, perpDir, doorLen };
}

/** 0 = fully closed/flush along the door's own wall, 1 = fully open/flush along the perpendicular
 * wall. `animStartedAt` marks the instant the edge's state LAST changed (see grid.ts) — whether
 * that was opening (swing 0->1) or a periodic reshut closing it again (swing 1->0), same field,
 * direction picked off the edge's CURRENT state. End-of-game is its own separate sweep, keyed off
 * the whole session's endingStartedAt rather than any one edge, since every open door closes at
 * once there regardless of when each one individually last opened. */
function doorSwingT(session: LightMazeSession, edge: DoorEdge, now: number): number {
  if (session.phase === "ENDING" && edge.state === "open") {
    const t = Math.min(1, Math.max(0, (now - session.endingStartedAt!) / DOOR_SWING_SHUT_MS));
    return 1 - t;
  }
  if (edge.animStartedAt === null) return 0;
  const elapsed = now - edge.animStartedAt;
  if (edge.state === "open") return Math.min(1, elapsed / DOOR_SWING_OPEN_MS);
  return Math.max(0, 1 - elapsed / DOOR_SWING_SHUT_MS);
}

function drawWallsAndDoors(ctx: CanvasRenderingContext2D, session: LightMazeSession, layout: Layout, now: number): void {
  ctx.lineCap = "round";
  // Once the game's over, every door that COULD have been opened (real, whether it happened to be
  // open or closed at the final instant) just disappears from the board entirely — a permanent
  // dead end stays visible as a reminder of which ones were traps, but the real doors that decided
  // the outcome fade out of the picture rather than lingering mid-swing or sitting there closed.
  const openableDoorsGone = session.phase === "RESULTS";
  for (const edge of session.grid.edges.values()) {
    const geom = computeEdgeGeom(layout, edge);

    // The two plain wall stubs flanking the door — always solid, never animate.
    ctx.strokeStyle = WALL_COLOR;
    ctx.lineWidth = WALL_WIDTH;
    line(ctx, geom.wallStart.x, geom.wallStart.y, geom.doorStart.x, geom.doorStart.y);
    line(ctx, geom.doorEnd.x, geom.doorEnd.y, geom.wallEnd.x, geom.wallEnd.y);

    if (openableDoorsGone && edge.state !== "closed-fake") continue;

    // The door itself, hinged at its own near end, distinctly colored.
    const swingT = doorSwingT(session, edge, now);
    const angle = swingT * (Math.PI / 2);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dirX = geom.wallDir.x * cos + geom.perpDir.x * sin;
    const dirY = geom.wallDir.y * cos + geom.perpDir.y * sin;
    ctx.strokeStyle = DOOR_COLOR;
    ctx.lineWidth = WALL_WIDTH + 1;
    line(ctx, geom.doorStart.x, geom.doorStart.y, geom.doorStart.x + dirX * geom.doorLen, geom.doorStart.y + dirY * geom.doorLen);
  }
}

function drawOuterBorder(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const half = layout.cellSize / 2;
  const left = layout.originX - half;
  const right = layout.originX + (GRID_SIZE - 1) * layout.cellSize + half;
  const top = layout.originY - half;
  const bottom = layout.originY + (GRID_SIZE - 1) * layout.cellSize + half;
  const gapHalf = half;

  ctx.strokeStyle = "#e8e2f2";
  ctx.lineWidth = OUTER_BORDER_WIDTH;
  ctx.lineCap = "square";

  const gapX = layout.originX + MID_INDEX * layout.cellSize;
  line(ctx, left, top, gapX - gapHalf, top);
  line(ctx, gapX + gapHalf, top, right, top);
  line(ctx, left, bottom, gapX - gapHalf, bottom);
  line(ctx, gapX + gapHalf, bottom, right, bottom);

  const gapY = layout.originY + MID_INDEX * layout.cellSize;
  line(ctx, left, top, left, gapY - gapHalf);
  line(ctx, left, gapY + gapHalf, left, bottom);
  line(ctx, right, top, right, gapY - gapHalf);
  line(ctx, right, gapY + gapHalf, right, bottom);
}

function entranceSwingT(session: LightMazeSession, now: number): number {
  if (session.phase !== "ENDING") return 1;
  const t = Math.min(1, Math.max(0, (now - session.endingStartedAt!) / DOOR_SWING_SHUT_MS));
  return 1 - t;
}

function drawEntrances(ctx: CanvasRenderingContext2D, session: LightMazeSession, layout: Layout, now: number): void {
  const swingT = entranceSwingT(session, now);
  const half = layout.cellSize / 2;
  for (let id = 0; id < session.players.length; id++) {
    const side = ENTRANCE_SIDE_BY_PLAYER[id]!;
    const room = entranceRoomForSide(side);
    const identity = session.identities[id]!;
    const center = roomCenter(layout, room);
    let x1: number, y1: number, x2: number, y2: number;
    if (side === "N") {
      x1 = center.x - half * 0.85;
      x2 = center.x + half * 0.85;
      y1 = y2 = layout.originY - half;
    } else if (side === "S") {
      x1 = center.x - half * 0.85;
      x2 = center.x + half * 0.85;
      y1 = y2 = layout.originY + (GRID_SIZE - 1) * layout.cellSize + half;
    } else if (side === "W") {
      y1 = center.y - half * 0.85;
      y2 = center.y + half * 0.85;
      x1 = x2 = layout.originX - half;
    } else {
      y1 = center.y - half * 0.85;
      y2 = center.y + half * 0.85;
      x1 = x2 = layout.originX + (GRID_SIZE - 1) * layout.cellSize + half;
    }
    ctx.strokeStyle = identity.color;
    ctx.lineWidth = OUTER_BORDER_WIDTH * 0.8;
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.5 + 0.5 * swingT;
    line(ctx, x1, y1, x2, y2);
    ctx.globalAlpha = 1;
  }
}

const QUADRANT_RECT: Record<string, [number, number]> = { TL: [0, 0], TR: [0.5, 0], BL: [0, 0.5], BR: [0.5, 0.5] };

function drawRooms(ctx: CanvasRenderingContext2D, session: LightMazeSession, layout: Layout): void {
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const cell = session.rooms[row]![col]!;
      const x = layout.originX + (col - 0.5) * layout.cellSize;
      const y = layout.originY + (row - 0.5) * layout.cellSize;
      const half = layout.cellSize / 2;
      const squareSize = layout.cellSize * 0.26;

      for (let playerId = 0; playerId < 4; playerId++) {
        const quadrant = QUADRANT_BY_PLAYER[playerId]!;
        const [qx, qy] = QUADRANT_RECT[quadrant]!;
        const quadCx = x + (qx + 0.25) * half * 2;
        const quadCy = y + (qy + 0.25) * half * 2;
        const visited = cell.visitedByPlayer[playerId];
        if (visited) {
          ctx.fillStyle = session.identities[playerId]!.color;
          ctx.fillRect(quadCx - squareSize / 2, quadCy - squareSize / 2, squareSize, squareSize);
        } else {
          ctx.strokeStyle = "rgba(255,255,255,0.08)";
          ctx.lineWidth = 2;
          ctx.strokeRect(quadCx - squareSize / 2, quadCy - squareSize / 2, squareSize, squareSize);
        }
      }

      const litFraction = cell.visitedByPlayer.filter(Boolean).length / 4;
      const center = roomCenter(layout, cell.room);
      ctx.beginPath();
      ctx.arc(center.x, center.y, Math.max(3, layout.cellSize * 0.045), 0, Math.PI * 2);
      ctx.fillStyle = lerpColor("#4a4456", "#ffe27a", litFraction);
      ctx.fill();
      if (litFraction >= 1) {
        ctx.save();
        ctx.shadowColor = "#ffe27a";
        ctx.shadowBlur = 14;
        ctx.fill();
        ctx.restore();
      }
    }
  }
}

function drawFailedMarker(ctx: CanvasRenderingContext2D, session: LightMazeSession, layout: Layout, now: number): void {
  const marker = session.failedAttemptMarker;
  if (!marker) return;
  const t = (now - marker.shownAt) / FAILED_MARKER_MS;
  if (t >= 1) return;
  const alpha = 1 - t;
  const center = roomCenter(layout, marker.room);
  const dirOffset = { N: { x: 0, y: -0.5 }, S: { x: 0, y: 0.5 }, E: { x: 0.5, y: 0 }, W: { x: -0.5, y: 0 } }[marker.dir];
  const x = center.x + dirOffset.x * layout.cellSize;
  const y = center.y + dirOffset.y * layout.cellSize;
  const size = layout.cellSize * 0.13;
  ctx.strokeStyle = `rgba(230, 57, 70, ${alpha.toFixed(2)})`;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - size, y - size);
  ctx.lineTo(x + size, y + size);
  ctx.moveTo(x + size, y - size);
  ctx.lineTo(x - size, y + size);
  ctx.stroke();
}

const FACING_VEC: Record<string, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
};

/** A small top-down "3D-ish" runner: a ground shadow that stays put, a body that bobs and casts
 * that shadow, and two feet that swing fore/aft in opposite phase — all driven by
 * `player.distanceMoved` (room-units actually covered, see LightMazeSession's trackFootsteps), so
 * the whole cycle — visual AND the footstep sound riding the same counter — advances exactly with
 * real movement and freezes the instant a player stops or is blocked, rather than animating on a
 * disconnected timer. */
function drawPlayerToken(ctx: CanvasRenderingContext2D, layout: Layout, player: PlayerState, identity: PlayerIdentity, now: number, showExitLabel: boolean): void {
  if (player.exited) return;
  const pos = worldToPixel(layout, player.pos);
  const radius = layout.cellSize * PLAYER_RADIUS;
  const facingVec = FACING_VEC[player.facing]!;
  const perpVec = { x: -facingVec.y, y: facingVec.x };

  const gaitPhase = (player.distanceMoved / STEP_DISTANCE) * Math.PI;
  const stride = Math.sin(gaitPhase);
  const bob = Math.abs(stride) * radius * 0.22;
  const bodyY = pos.y - bob;

  // Ground shadow — fixed on the floor (doesn't bob with the body), the main cue that the body
  // above it has some height rather than being flat.
  ctx.beginPath();
  ctx.ellipse(pos.x, pos.y + radius * 0.7, radius * 0.85, radius * 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fill();

  // Two feet, offset to either side of the facing axis, swinging fore/aft in opposite phase.
  const footSpread = radius * 0.5;
  const strideLen = radius * 0.65;
  for (const side of [-1, 1]) {
    const swing = side === 1 ? stride : -stride;
    const fx = pos.x + perpVec.x * footSpread * side + facingVec.x * strideLen * swing;
    const fy = pos.y + perpVec.y * footSpread * side + facingVec.y * strideLen * swing;
    ctx.beginPath();
    ctx.ellipse(fx, fy, radius * 0.24, radius * 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(15,12,18,0.6)";
    ctx.fill();
  }

  // Body — a radial gradient (bright upper-left, true color toward the rim) for a rounded, faintly
  // 3D "ball" look instead of a flat tinted disc.
  const grad = ctx.createRadialGradient(pos.x - radius * 0.35, bodyY - radius * 0.4, radius * 0.05, pos.x, bodyY, radius);
  grad.addColorStop(0, lerpColor(identity.color, "#ffffff", 0.55));
  grad.addColorStop(1, identity.color);
  ctx.beginPath();
  ctx.arc(pos.x, bodyY, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "#0a0a0a";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Facing notch — a small nudge toward the facing direction, still useful when stationary (feet
  // alone give no directional cue at rest).
  ctx.beginPath();
  ctx.arc(pos.x + facingVec.x * radius * 0.55, bodyY + facingVec.y * radius * 0.55, radius * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fill();

  if (identity.id === 0) {
    ctx.beginPath();
    ctx.arc(pos.x, bodyY, radius * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fill();
  }

  if (showExitLabel && player.coloredRoomCount >= TOTAL_ROOMS) drawHeadForExitLabel(ctx, pos.x, bodyY - radius, radius, now);
}

/** A small pulsing callout above a player's head once they've lit every room — the cue to go find
 * their own entrance again (see clampAxis's exit gate). */
function drawHeadForExitLabel(ctx: CanvasRenderingContext2D, x: number, topY: number, radius: number, now: number): void {
  const text = "Head for the exit!";
  ctx.font = "bold 12px 'Segoe UI', system-ui, sans-serif";
  const textWidth = ctx.measureText(text).width;
  const padX = 8;
  const boxW = textWidth + padX * 2;
  const boxH = 20;
  const labelY = topY - radius * 1.7;
  const pulse = 0.75 + 0.25 * Math.sin(now / 350);

  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.fillStyle = "rgba(20,16,26,0.88)";
  ctx.beginPath();
  ctx.roundRect(x - boxW / 2, labelY - boxH / 2, boxW, boxH, 6);
  ctx.fill();
  ctx.strokeStyle = "#ffe27a";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.fillStyle = "#ffe27a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, labelY + 1);
  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, session: LightMazeSession): void {
  ctx.fillStyle = "#1b1620";
  ctx.fillRect(0, 0, CANVAS_W, HUD_HEIGHT);

  ctx.font = "bold 17px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText("Light Maze", 20, HUD_HEIGHT / 2);

  const colW = 240;
  let x = 220;
  for (const player of session.players) {
    const identity = session.identities[player.id]!;
    ctx.beginPath();
    ctx.arc(x, HUD_HEIGHT / 2, 7, 0, Math.PI * 2);
    ctx.fillStyle = identity.color;
    ctx.fill();

    ctx.font = "13px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = player.id === session.loserId ? "#e63946" : player.exited ? "#7fd98a" : "#fff";
    ctx.textAlign = "left";
    const status = player.id === session.loserId ? "LOST" : player.exited ? "OUT" : player.outside ? "OUTSIDE" : "IN";
    ctx.fillText(`${identity.name} — ${status} — ${player.coloredRoomCount}/${TOTAL_ROOMS}`, x + 14, HUD_HEIGHT / 2);
    x += colW;
  }
}

function drawResults(ctx: CanvasRenderingContext2D, session: LightMazeSession): void {
  // Lighter than before, and only softly dimming rather than obscuring — the point of the board
  // underneath now (every openable door gone, see drawWallsAndDoors) is meant to actually be seen.
  ctx.fillStyle = "rgba(27, 22, 32, 0.45)";
  ctx.fillRect(0, HUD_HEIGHT, CANVAS_W, CANVAS_H - HUD_HEIGHT);

  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  const loser = session.identities[session.loserId!]!;

  ctx.fillStyle = "rgba(27, 22, 32, 0.85)";
  const boxW = 640;
  const boxH = 130;
  ctx.beginPath();
  ctx.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 14);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e63946";
  ctx.font = "bold 40px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(loser.id === 0 ? "You lose!" : `${loser.name} loses!`, cx, cy - 30);

  ctx.font = "16px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "#a99fb3";
  const summary = session.players.map((p) => `${session.identities[p.id]!.name}: ${p.coloredRoomCount}/${TOTAL_ROOMS}`).join("   ");
  ctx.fillText(summary, cx, cy + 30);
}

export function render(ctx: CanvasRenderingContext2D, session: LightMazeSession, now: number): void {
  ctx.fillStyle = "#17131c";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const layout = computeLayout();
  drawRooms(ctx, session, layout);
  drawWallsAndDoors(ctx, session, layout, now);
  drawOuterBorder(ctx, layout);
  drawEntrances(ctx, session, layout, now);
  for (const player of session.players) drawPlayerToken(ctx, layout, player, session.identities[player.id]!, now, session.phase === "PLAYING");
  drawFailedMarker(ctx, session, layout, now);
  drawHud(ctx, session);

  if (session.phase === "RESULTS") drawResults(ctx, session);
}
