import { CANVAS_H, CANVAS_W, DOOR_SWING_OPEN_MS, DOOR_SWING_SHUT_MS, FAILED_MARKER_MS, GRID_MARGIN, GRID_SIZE, HUD_HEIGHT, MOVE_DURATION_MS } from "./constants.ts";
import { directionFromTo, entranceRoomForSide, ENTRANCE_SIDE_BY_PLAYER, QUADRANT_BY_PLAYER, type DoorEdge, type RoomId } from "./grid.ts";
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

interface Layout {
  cellSize: number;
  originX: number;
  originY: number;
}

function computeLayout(): Layout {
  const availW = CANVAS_W - GRID_MARGIN * 2;
  const availH = CANVAS_H - HUD_HEIGHT - GRID_MARGIN * 2;
  const cellSize = Math.min(availW, availH) / GRID_SIZE;
  const gridPixelSize = cellSize * GRID_SIZE;
  return {
    cellSize,
    originX: (CANVAS_W - gridPixelSize) / 2,
    originY: HUD_HEIGHT + (CANVAS_H - HUD_HEIGHT - gridPixelSize) / 2,
  };
}

function roomCenter(layout: Layout, room: RoomId): { x: number; y: number } {
  return {
    x: layout.originX + (room.col + 0.5) * layout.cellSize,
    y: layout.originY + (room.row + 0.5) * layout.cellSize,
  };
}

interface EdgeGeom {
  hinge: { x: number; y: number };
  wallStart: { x: number; y: number };
  wallEnd: { x: number; y: number };
  wallDir: { x: number; y: number };
  perpDir: { x: number; y: number };
  gapLen: number;
}

/** Every interior edge's roomA is always the room immediately N or W of roomB (see
 * interiorEdgeKey's string-ordering, which — since every row/col is a single digit 0-4 — sorts
 * exactly the same as comparing (row,col) tuples), so the wall is always vertical (roomB is east
 * of roomA) or horizontal (roomB is south of roomA). The door "panel" pivots at a hinge point
 * centered in the wall segment, swinging from flush-with-the-wall (closed, blocking the gap) to
 * perpendicular, into roomA's side (open). */
function computeEdgeGeom(layout: Layout, edge: DoorEdge): EdgeGeom {
  const dir = directionFromTo(edge.roomA, edge.roomB);
  const isVertical = dir === "E";
  const wallStart = isVertical
    ? { x: layout.originX + (edge.roomA.col + 1) * layout.cellSize, y: layout.originY + edge.roomA.row * layout.cellSize }
    : { x: layout.originX + edge.roomA.col * layout.cellSize, y: layout.originY + (edge.roomA.row + 1) * layout.cellSize };
  const wallDir = isVertical ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const perpDir = isVertical ? { x: -1, y: 0 } : { x: 0, y: -1 }; // points toward roomA's side
  const wallEnd = { x: wallStart.x + wallDir.x * layout.cellSize, y: wallStart.y + wallDir.y * layout.cellSize };
  const gapLen = layout.cellSize * 0.55;
  const gapOffset = (layout.cellSize - gapLen) / 2;
  const hinge = { x: wallStart.x + wallDir.x * gapOffset, y: wallStart.y + wallDir.y * gapOffset };
  return { hinge, wallStart, wallEnd, wallDir, perpDir, gapLen };
}

function doorSwingT(session: LightMazeSession, edge: DoorEdge, now: number): number {
  if (session.phase === "ENDING" && edge.state === "open") {
    const t = Math.min(1, Math.max(0, (now - session.endingStartedAt!) / DOOR_SWING_SHUT_MS));
    return 1 - t;
  }
  if (edge.state !== "open" || edge.animStartedAt === null) return 0;
  return Math.min(1, (now - edge.animStartedAt) / DOOR_SWING_OPEN_MS);
}

function drawWallsAndDoors(ctx: CanvasRenderingContext2D, session: LightMazeSession, layout: Layout, now: number): void {
  ctx.lineCap = "round";
  for (const edge of session.grid.edges.values()) {
    const geom = computeEdgeGeom(layout, edge);
    if (edge.state === "none") {
      ctx.strokeStyle = "#3a3242";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(geom.wallStart.x, geom.wallStart.y);
      ctx.lineTo(geom.wallEnd.x, geom.wallEnd.y);
      ctx.stroke();
      continue;
    }
    // Two short stub posts flanking the gap — same color/weight as a plain wall, since a
    // closed-real and closed-fake door must look IDENTICAL from the outside.
    ctx.strokeStyle = "#3a3242";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(geom.wallStart.x, geom.wallStart.y);
    ctx.lineTo(geom.hinge.x, geom.hinge.y);
    ctx.stroke();
    const gapEnd = { x: geom.hinge.x + geom.wallDir.x * geom.gapLen, y: geom.hinge.y + geom.wallDir.y * geom.gapLen };
    ctx.beginPath();
    ctx.moveTo(gapEnd.x, gapEnd.y);
    ctx.lineTo(geom.wallEnd.x, geom.wallEnd.y);
    ctx.stroke();

    // The door panel itself, pivoting at the hinge from flush (angle 0, blocking) to perpendicular
    // (angle 90°, swung open into roomA's side).
    const swingT = doorSwingT(session, edge, now);
    const angle = swingT * (Math.PI / 2);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const panelDirX = geom.wallDir.x * cos + geom.perpDir.x * sin;
    const panelDirY = geom.wallDir.y * cos + geom.perpDir.y * sin;
    ctx.strokeStyle = "#8a7fa0";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(geom.hinge.x, geom.hinge.y);
    ctx.lineTo(geom.hinge.x + panelDirX * geom.gapLen, geom.hinge.y + panelDirY * geom.gapLen);
    ctx.stroke();
  }
}

function entranceSwingT(session: LightMazeSession, now: number): number {
  if (session.phase !== "ENDING") return 1;
  const t = Math.min(1, Math.max(0, (now - session.endingStartedAt!) / DOOR_SWING_SHUT_MS));
  return 1 - t;
}

function drawEntrances(ctx: CanvasRenderingContext2D, session: LightMazeSession, layout: Layout, now: number): void {
  const swingT = entranceSwingT(session, now);
  for (let id = 0; id < session.players.length; id++) {
    const side = ENTRANCE_SIDE_BY_PLAYER[id]!;
    const room = entranceRoomForSide(side);
    const identity = session.identities[id]!;
    const center = roomCenter(layout, room);
    const half = layout.cellSize * 0.28;
    let gapCenter: { x: number; y: number };
    let alongX: boolean;
    if (side === "N") {
      gapCenter = { x: center.x, y: layout.originY + room.row * layout.cellSize };
      alongX = true;
    } else if (side === "S") {
      gapCenter = { x: center.x, y: layout.originY + (room.row + 1) * layout.cellSize };
      alongX = true;
    } else if (side === "W") {
      gapCenter = { x: layout.originX + room.col * layout.cellSize, y: center.y };
      alongX = false;
    } else {
      gapCenter = { x: layout.originX + (room.col + 1) * layout.cellSize, y: center.y };
      alongX = false;
    }
    ctx.strokeStyle = identity.color;
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.55 + 0.45 * swingT;
    ctx.beginPath();
    if (alongX) {
      ctx.moveTo(gapCenter.x - half, gapCenter.y);
      ctx.lineTo(gapCenter.x + half, gapCenter.y);
    } else {
      ctx.moveTo(gapCenter.x, gapCenter.y - half);
      ctx.lineTo(gapCenter.x, gapCenter.y + half);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

const QUADRANT_RECT: Record<string, [number, number]> = { TL: [0, 0], TR: [0.5, 0], BL: [0, 0.5], BR: [0.5, 0.5] };

function drawRooms(ctx: CanvasRenderingContext2D, session: LightMazeSession, layout: Layout): void {
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const cell = session.rooms[row]![col]!;
      const x = layout.originX + col * layout.cellSize;
      const y = layout.originY + row * layout.cellSize;
      const half = layout.cellSize / 2;

      for (let playerId = 0; playerId < 4; playerId++) {
        const quadrant = QUADRANT_BY_PLAYER[playerId]!;
        const [qx, qy] = QUADRANT_RECT[quadrant]!;
        const visited = cell.visitedByPlayer[playerId];
        ctx.fillStyle = visited ? session.identities[playerId]!.color : "#211c28";
        ctx.globalAlpha = visited ? 0.85 : 1;
        ctx.fillRect(x + qx * layout.cellSize, y + qy * layout.cellSize, half, half);
        ctx.globalAlpha = 1;
      }

      const litFraction = cell.visitedByPlayer.filter(Boolean).length / 4;
      const center = roomCenter(layout, cell.room);
      ctx.beginPath();
      ctx.arc(center.x, center.y, Math.max(3, layout.cellSize * 0.06), 0, Math.PI * 2);
      ctx.fillStyle = lerpColor("#4a4456", "#ffe27a", litFraction);
      ctx.fill();
      if (litFraction >= 1) {
        ctx.save();
        ctx.shadowColor = "#ffe27a";
        ctx.shadowBlur = 12;
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
  const size = layout.cellSize * 0.14;
  ctx.strokeStyle = `rgba(230, 57, 70, ${alpha.toFixed(2)})`;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - size, y - size);
  ctx.lineTo(x + size, y + size);
  ctx.moveTo(x + size, y - size);
  ctx.lineTo(x - size, y + size);
  ctx.stroke();
}

function drawPlayerToken(ctx: CanvasRenderingContext2D, layout: Layout, player: PlayerState, identity: PlayerIdentity, now: number): void {
  if (player.exited) return;
  const from = roomCenter(layout, player.room);
  let pos = from;
  if (player.moveTarget && player.moveStartedAt !== null) {
    const to = roomCenter(layout, player.moveTarget);
    const t = Math.min(1, (now - player.moveStartedAt) / MOVE_DURATION_MS);
    pos = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
  }
  const radius = layout.cellSize * 0.16;

  const facingVec = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } }[player.facing];
  ctx.beginPath();
  ctx.moveTo(pos.x + facingVec.x * radius * 1.9, pos.y + facingVec.y * radius * 1.9);
  ctx.lineTo(pos.x + facingVec.x * radius * 0.9 - facingVec.y * radius * 0.5, pos.y + facingVec.y * radius * 0.9 + facingVec.x * radius * 0.5);
  ctx.lineTo(pos.x + facingVec.x * radius * 0.9 + facingVec.y * radius * 0.5, pos.y + facingVec.y * radius * 0.9 - facingVec.x * radius * 0.5);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = identity.color;
  ctx.fill();
  ctx.strokeStyle = "#0a0a0a";
  ctx.lineWidth = 2;
  ctx.stroke();

  if (identity.id === 0) {
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fill();
  }
}

function drawHud(ctx: CanvasRenderingContext2D, session: LightMazeSession): void {
  ctx.fillStyle = "#1b1620";
  ctx.fillRect(0, 0, CANVAS_W, HUD_HEIGHT);

  ctx.font = "bold 16px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText("Light Maze", 20, HUD_HEIGHT / 2);

  const colW = 220;
  let x = 210;
  for (const player of session.players) {
    const identity = session.identities[player.id]!;
    ctx.beginPath();
    ctx.arc(x, HUD_HEIGHT / 2, 7, 0, Math.PI * 2);
    ctx.fillStyle = identity.color;
    ctx.fill();

    ctx.font = "13px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = player.id === session.loserId ? "#e63946" : player.exited ? "#7fd98a" : "#fff";
    ctx.textAlign = "left";
    const status = player.id === session.loserId ? "LOST" : player.exited ? "OUT" : "IN";
    ctx.fillText(`${identity.name} — ${status} — ${player.coloredRoomCount}/25`, x + 14, HUD_HEIGHT / 2);
    x += colW;
  }
}

function drawResults(ctx: CanvasRenderingContext2D, session: LightMazeSession): void {
  ctx.fillStyle = "rgba(27, 22, 32, 0.92)";
  ctx.fillRect(0, HUD_HEIGHT, CANVAS_W, CANVAS_H - HUD_HEIGHT);

  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  const loser = session.identities[session.loserId!]!;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e63946";
  ctx.font = "bold 40px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(loser.id === 0 ? "You lose!" : `${loser.name} loses!`, cx, cy - 30);

  ctx.font = "16px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "#a99fb3";
  const summary = session.players.map((p) => `${session.identities[p.id]!.name}: ${p.coloredRoomCount}/25`).join("   ");
  ctx.fillText(summary, cx, cy + 30);
}

export function render(ctx: CanvasRenderingContext2D, session: LightMazeSession, now: number): void {
  ctx.fillStyle = "#17131c";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const layout = computeLayout();
  drawRooms(ctx, session, layout);
  drawWallsAndDoors(ctx, session, layout, now);
  drawEntrances(ctx, session, layout, now);
  for (const player of session.players) drawPlayerToken(ctx, layout, player, session.identities[player.id]!, now);
  drawFailedMarker(ctx, session, layout, now);
  drawHud(ctx, session);

  if (session.phase === "RESULTS") drawResults(ctx, session);
}
