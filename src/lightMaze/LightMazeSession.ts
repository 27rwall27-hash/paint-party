// Light Maze's core session: a GRID_SIZE x GRID_SIZE grid of rooms (see grid.ts/mazeGen.ts), 4 players (1 human +
// 3 CPU, see cpuBrain.ts) each permanently assigned one entrance side and one room-quadrant.
// Movement is free/continuous (room-units, not grid-locked steps) — see clampAxis. Real time, no
// turns. Every player starts OUTSIDE the maze, in a small vestibule by their own entrance, and
// must walk in. The instant the 3rd player exits back out their own entrance, the maze locks —
// every open door swings shut — and whoever's still inside is named the loser.

import {
  CPU_MOVE_SPEED,
  DOOR_INTERACT_DISTANCE,
  DOOR_SWING_SHUT_MS,
  ENDING_HOLD_MS,
  FAILED_MARKER_MS,
  GRID_SIZE,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  RESHUT_INTERVAL_MS,
  STEP_DISTANCE,
  TOTAL_ROOMS,
  VESTIBULE_DEPTH,
  VESTIBULE_LATERAL_CLAMP,
} from "./constants.ts";
import { decideCpuAction, createCpuBrain, type CpuBrain } from "./cpuBrain.ts";
import {
  ENTRANCE_SIDE_BY_PLAYER,
  QUADRANT_BY_PLAYER,
  entranceRoomForSide,
  getInteriorEdge,
  isOutsideGrid,
  isOwnExitAttempt,
  neighborRoom,
  oppositeSide,
  outsideStartPos,
  SIDES,
  type MazeGrid,
  type Position,
  type Quadrant,
  type RoomId,
  type Side,
} from "./grid.ts";
import type { PlayerIdentity } from "./identities.ts";
import { generateMaze } from "./mazeGen.ts";

export interface RoomState {
  room: RoomId;
  /** index = playerId (0-3); true once that player has ever entered this room. A quadrant's fill
   * color is fully derived from this + QUADRANT_BY_PLAYER — no separate field needed. */
  visitedByPlayer: [boolean, boolean, boolean, boolean];
}

export interface PlayerState {
  id: number;
  isBot: boolean;
  quadrant: Quadrant;
  entranceSide: Side;
  pos: Position;
  /** Nearest/current discrete room — meaningful for door/CPU logic. While `outside`, still holds
   * their own entrance room as a stable reference point for the vestibule and for re-entry. */
  room: RoomId;
  outside: boolean;
  facing: Side;
  /** CPU only — non-null while gliding in a straight line toward this (already-open, already
   * decided) room. */
  moveTarget: RoomId | null;
  /** CPU only — true once its brain has decided it's done exploring and is walking back out
   * through its own entrance; cleared implicitly once `exited` (see updateRoomTracking). */
  headingOutside: boolean;
  exited: boolean;
  exitedAt: number | null;
  coloredRoomCount: number;
  cpu: CpuBrain | null;
  /** Cumulative distance actually covered (room-units) — drives the running animation's gait
   * phase and, via STEP_DISTANCE crossings, the footstep sound (see trackFootsteps). Only ever
   * grows when `pos` actually moves, so it — and the animation/sound riding on it — naturally
   * freezes the instant a player stops or is blocked by a wall. */
  distanceMoved: number;
}

export type LightMazePhase = "PLAYING" | "ENDING" | "RESULTS";

export interface FailedAttemptMarker {
  room: RoomId;
  dir: Side;
  shownAt: number;
}

export interface LightMazeSession {
  identities: PlayerIdentity[];
  phase: LightMazePhase;
  startedAt: number;
  /** Real timestamp of the last updateLightMazeSession call — lets movement work in real
   * room-units-per-second regardless of the caller's own frame timing. */
  lastUpdateAt: number;
  grid: MazeGrid;
  rooms: RoomState[][];
  players: PlayerState[];
  exitOrder: number[];
  loserId: number | null;
  endingStartedAt: number | null;
  failedAttemptMarker: FailedAttemptMarker | null;
  /** Next real timestamp every currently-open door reshuts — see RESHUT_INTERVAL_MS. */
  nextReshutAt: number;
  // Edge-triggered, cleared at the start of every tick — main.ts reads these after each
  // updateLightMazeSession call to dispatch one-shot sounds.
  doorOpenedThisTick: { byPlayerId: number }[];
  humanDoorFailedThisTick: boolean;
  exitedThisTick: number[];
  doorsReshutThisTick: boolean;
  /** Player ids whose gait crossed a STEP_DISTANCE boundary this tick — see trackFootsteps. */
  footstepsThisTick: number[];
}

export interface LightMazeInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** Most recently pressed movement key — sticky (kept until another is pressed), used only to
   * pick which door a click attempts, independent of the (possibly diagonal, possibly zero)
   * current movement vector. */
  facing: Side | null;
  clicked: boolean;
}

function markRoomVisited(session: LightMazeSession, player: PlayerState): void {
  const cell = session.rooms[player.room.row]![player.room.col]!;
  if (cell.visitedByPlayer[player.id]) return;
  cell.visitedByPlayer[player.id] = true;
  player.coloredRoomCount++;
}

/** Flips every currently-open edge back to closed-real, all at once — still the same real door,
 * still always reopenable on the next attempt, just needs it again. Rooms already colored stay
 * colored; this only ever touches door state. */
function reshutAllOpenDoors(session: LightMazeSession, now: number): void {
  let any = false;
  for (const edge of session.grid.edges.values()) {
    if (edge.state !== "open") continue;
    edge.state = "closed-real";
    edge.animStartedAt = now;
    any = true;
  }
  if (any) session.doorsReshutThisTick = true;
}

function doExit(session: LightMazeSession, player: PlayerState, now: number): void {
  player.exited = true;
  player.exitedAt = now;
  session.exitOrder.push(player.id);
  session.exitedThisTick.push(player.id);
}

export function createLightMazeSession(identities: PlayerIdentity[], now: number): LightMazeSession {
  const grid = generateMaze();
  const rooms: RoomState[][] = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    const rowRooms: RoomState[] = [];
    for (let col = 0; col < GRID_SIZE; col++) {
      rowRooms.push({ room: { row, col }, visitedByPlayer: [false, false, false, false] });
    }
    rooms.push(rowRooms);
  }

  const players: PlayerState[] = identities.map((identity) => {
    const entranceSide = ENTRANCE_SIDE_BY_PLAYER[identity.id]!;
    const room = entranceRoomForSide(entranceSide);
    return {
      id: identity.id,
      isBot: identity.isBot,
      quadrant: QUADRANT_BY_PLAYER[identity.id]!,
      entranceSide,
      pos: outsideStartPos(entranceSide),
      room,
      outside: true,
      facing: oppositeSide(entranceSide), // starts facing INTO the maze, not back out
      moveTarget: null,
      headingOutside: false,
      exited: false,
      exitedAt: null,
      coloredRoomCount: 0,
      cpu: identity.isBot ? createCpuBrain(room, now) : null,
      distanceMoved: 0,
    };
  });

  return {
    identities,
    phase: "PLAYING",
    startedAt: now,
    lastUpdateAt: now,
    grid,
    rooms,
    players,
    exitOrder: [],
    loserId: null,
    endingStartedAt: null,
    failedAttemptMarker: null,
    nextReshutAt: now + RESHUT_INTERVAL_MS,
    doorOpenedThisTick: [],
    humanDoorFailedThisTick: false,
    exitedThisTick: [],
    doorsReshutThisTick: false,
    footstepsThisTick: [],
  };
}

function clampDeltaToBoundary(cur: number, boundary: number, delta: number): number {
  if (delta > 0) return Math.max(0, boundary - PLAYER_RADIUS - cur);
  return Math.min(0, boundary + PLAYER_RADIUS - cur);
}

/** Resolves movement along a single axis against the current room's own walls — the standard
 * axis-separated approach to circle-vs-grid collision, which naturally lets a player slide along
 * a wall instead of stopping dead the instant either axis alone would clip it. Only ever needs to
 * consult the player's OWN current room (see `player.room`), since a single tick's movement is
 * always far smaller than a room. */
function clampAxis(session: LightMazeSession, player: PlayerState, axis: "row" | "col", delta: number): number {
  if (delta === 0) return 0;
  const cur = player.pos[axis];
  const target = cur + delta;
  const currentCoord = axis === "row" ? player.room.row : player.room.col;
  const boundary = currentCoord + (delta > 0 ? 0.5 : -0.5);
  const crossing = delta > 0 ? target + PLAYER_RADIUS > boundary : target - PLAYER_RADIUS < boundary;
  if (!crossing) return delta;

  const dir: Side = axis === "row" ? (delta > 0 ? "S" : "N") : delta > 0 ? "E" : "W";
  const edge = getInteriorEdge(session.grid, player.room, dir);
  if (edge === null) {
    // Your own entrance is only passable OUTWARD once every room is lit — otherwise it blocks
    // like any other wall. (Coming back INWARD from the vestibule never goes through this path at
    // all — see clampVestibule — so entering is always unrestricted regardless of this check.)
    if (isOwnExitAttempt(player.entranceSide, player.room, dir) && player.coloredRoomCount >= TOTAL_ROOMS) return delta;
    return clampDeltaToBoundary(cur, boundary, delta);
  }
  if (edge.state === "open") return delta;
  return clampDeltaToBoundary(cur, boundary, delta); // closed-real/closed-fake — always blocks
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Free movement in the small staging area just outside a player's own entrance — no walls out
 * there, just a soft clamp so they stay near their own door (not wandering across the front of
 * the whole maze) and don't drift arbitrarily far from the grid. */
function clampVestibule(player: PlayerState): void {
  const room = player.room;
  const side = player.entranceSide;
  if (side === "N") {
    player.pos.col = clamp(player.pos.col, room.col - VESTIBULE_LATERAL_CLAMP, room.col + VESTIBULE_LATERAL_CLAMP);
    player.pos.row = Math.max(player.pos.row, room.row - 0.5 - VESTIBULE_DEPTH);
  } else if (side === "S") {
    player.pos.col = clamp(player.pos.col, room.col - VESTIBULE_LATERAL_CLAMP, room.col + VESTIBULE_LATERAL_CLAMP);
    player.pos.row = Math.min(player.pos.row, room.row + 0.5 + VESTIBULE_DEPTH);
  } else if (side === "W") {
    player.pos.row = clamp(player.pos.row, room.row - VESTIBULE_LATERAL_CLAMP, room.row + VESTIBULE_LATERAL_CLAMP);
    player.pos.col = Math.max(player.pos.col, room.col - 0.5 - VESTIBULE_DEPTH);
  } else {
    player.pos.row = clamp(player.pos.row, room.row - VESTIBULE_LATERAL_CLAMP, room.row + VESTIBULE_LATERAL_CLAMP);
    player.pos.col = Math.min(player.pos.col, room.col + 0.5 + VESTIBULE_DEPTH);
  }
}

function applyHumanMovement(session: LightMazeSession, player: PlayerState, input: LightMazeInput, dt: number): void {
  if (input.facing) player.facing = input.facing;

  let dRow = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  let dCol = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dRow === 0 && dCol === 0) return;
  if (dRow !== 0 && dCol !== 0) {
    dRow *= Math.SQRT1_2;
    dCol *= Math.SQRT1_2;
  }
  const stepRow = dRow * PLAYER_SPEED * dt;
  const stepCol = dCol * PLAYER_SPEED * dt;

  if (player.outside) {
    player.pos.row += stepRow;
    player.pos.col += stepCol;
    clampVestibule(player);
  } else {
    player.pos.col += clampAxis(session, player, "col", stepCol);
    player.pos.row += clampAxis(session, player, "row", stepRow);
  }
}

/** Attempts whichever closed door the player is currently closest to (within
 * DOOR_INTERACT_DISTANCE), regardless of which way they're facing — free movement means their
 * facing direction doesn't reliably say which wall they're standing next to, so proximity alone
 * decides it. Ties (e.g. standing near a corner where two walls are both close) go to whichever
 * one is actually closest. */
function attemptOpenNearbyDoor(session: LightMazeSession, player: PlayerState, now: number): void {
  if (player.outside) return;
  let bestDir: Side | null = null;
  let bestDist = Infinity;
  for (const dir of SIDES) {
    if (!neighborRoom(player.room, dir)) continue; // boundary — own-exit is walked, not clicked
    const edge = getInteriorEdge(session.grid, player.room, dir);
    if (!edge || edge.state === "open") continue;
    const axisIsRow = dir === "N" || dir === "S";
    const roomCoord = axisIsRow ? player.room.row : player.room.col;
    const boundary = roomCoord + (dir === "S" || dir === "E" ? 0.5 : -0.5);
    const playerAxisPos = axisIsRow ? player.pos.row : player.pos.col;
    const dist = Math.abs(playerAxisPos - boundary);
    if (dist <= DOOR_INTERACT_DISTANCE && dist < bestDist) {
      bestDist = dist;
      bestDir = dir;
    }
  }
  if (!bestDir) return;
  const edge = getInteriorEdge(session.grid, player.room, bestDir)!;

  if (edge.state === "closed-real") {
    edge.state = "open";
    edge.animStartedAt = now;
    session.doorOpenedThisTick.push({ byPlayerId: player.id });
  } else {
    session.failedAttemptMarker = { room: player.room, dir: bestDir, shownAt: now };
    session.humanDoorFailedThisTick = true;
  }
}

function moveToward(player: PlayerState, target: Position, speed: number, dt: number): void {
  const dRow = target.row - player.pos.row;
  const dCol = target.col - player.pos.col;
  const dist = Math.hypot(dRow, dCol);
  const step = speed * dt;
  if (dist <= step || dist < 1e-6) {
    player.pos.row = target.row;
    player.pos.col = target.col;
    return;
  }
  player.pos.row += (dRow / dist) * step;
  player.pos.col += (dCol / dist) * step;
}

function applyCpuMovement(session: LightMazeSession, player: PlayerState, dt: number, now: number): void {
  if (player.outside) {
    moveToward(player, { row: player.room.row, col: player.room.col }, CPU_MOVE_SPEED, dt);
    return;
  }
  if (player.headingOutside) {
    moveToward(player, outsideStartPos(player.entranceSide), CPU_MOVE_SPEED, dt);
    return;
  }
  if (player.moveTarget) {
    moveToward(player, { row: player.moveTarget.row, col: player.moveTarget.col }, CPU_MOVE_SPEED, dt);
    if (player.pos.row === player.moveTarget.row && player.pos.col === player.moveTarget.col) player.moveTarget = null;
    return;
  }

  const cpu = player.cpu!;
  const action = decideCpuAction(session.grid, cpu, player.room, now);
  switch (action.type) {
    case "wait":
      return;
    case "move":
      player.facing = action.dir;
      player.moveTarget = action.target;
      return;
    case "attemptOpen":
      player.facing = action.dir;
      if (action.success) session.doorOpenedThisTick.push({ byPlayerId: player.id });
      return;
    case "exit":
      // Per the CPU's own exploration algorithm this only fires once its backtrack stack is fully
      // unwound, which (given the maze is always fully connected) only happens after every room
      // has been visited — so this should always already be true. Checked anyway rather than
      // relied upon, matching the same "every room lit before you can leave" rule the human's own
      // exit is held to (see clampAxis).
      if (player.coloredRoomCount >= TOTAL_ROOMS) player.headingOutside = true;
      return;
  }
}

/** Compares `player.pos` against where it was before this tick's movement, adds the actual
 * distance covered to `distanceMoved`, and — if that crossed a STEP_DISTANCE boundary — records a
 * footstep for main.ts's sound dispatch. Driven purely by realized movement (post-collision), so a
 * player blocked by a wall (net zero displacement) never racks up a phantom step. */
function trackFootsteps(session: LightMazeSession, player: PlayerState, beforePos: Position): void {
  const dist = Math.hypot(player.pos.row - beforePos.row, player.pos.col - beforePos.col);
  if (dist <= 0) return;
  const before = Math.floor(player.distanceMoved / STEP_DISTANCE);
  player.distanceMoved += dist;
  const after = Math.floor(player.distanceMoved / STEP_DISTANCE);
  if (after > before) session.footstepsThisTick.push(player.id);
}

function updateRoomTracking(session: LightMazeSession, player: PlayerState, now: number): void {
  const wasOutside = player.outside;
  const nowOutside = isOutsideGrid(player.pos);
  if (wasOutside && !nowOutside) {
    player.room = entranceRoomForSide(player.entranceSide);
    markRoomVisited(session, player);
  } else if (!wasOutside && nowOutside) {
    doExit(session, player, now);
  } else if (!nowOutside) {
    const newRoom: RoomId = { row: Math.round(player.pos.row), col: Math.round(player.pos.col) };
    if (newRoom.row !== player.room.row || newRoom.col !== player.room.col) {
      player.room = newRoom;
      markRoomVisited(session, player);
    }
  }
  player.outside = nowOutside;
}

export function updateLightMazeSession(session: LightMazeSession, now: number, input: LightMazeInput): void {
  const dt = Math.min(0.05, Math.max(0, (now - session.lastUpdateAt) / 1000));
  session.lastUpdateAt = now;

  if (session.phase === "RESULTS") return;

  session.doorOpenedThisTick = [];
  session.humanDoorFailedThisTick = false;
  session.exitedThisTick = [];
  session.doorsReshutThisTick = false;
  session.footstepsThisTick = [];

  if (session.phase === "ENDING") {
    if (now - session.endingStartedAt! >= DOOR_SWING_SHUT_MS + ENDING_HOLD_MS) session.phase = "RESULTS";
    return; // frozen — no movement/CPU updates
  }

  if (now >= session.nextReshutAt) {
    reshutAllOpenDoors(session, now);
    session.nextReshutAt = now + RESHUT_INTERVAL_MS;
  }

  const human = session.players[0]!;
  if (!human.exited) {
    const beforePos = { ...human.pos };
    applyHumanMovement(session, human, input, dt);
    trackFootsteps(session, human, beforePos);
    if (input.clicked) attemptOpenNearbyDoor(session, human, now);
    updateRoomTracking(session, human, now);
  }

  for (const player of session.players) {
    if (!player.isBot || player.exited) continue;
    const beforePos = { ...player.pos };
    applyCpuMovement(session, player, dt, now);
    trackFootsteps(session, player, beforePos);
    updateRoomTracking(session, player, now);
  }

  if (session.failedAttemptMarker && now - session.failedAttemptMarker.shownAt >= FAILED_MARKER_MS) {
    session.failedAttemptMarker = null;
  }

  if (session.exitOrder.length >= 3 && session.phase === "PLAYING") {
    session.loserId = session.players.find((p) => !p.exited)!.id;
    session.phase = "ENDING";
    session.endingStartedAt = now;
  }
}
