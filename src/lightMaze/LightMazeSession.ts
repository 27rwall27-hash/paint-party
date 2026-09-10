// Light Maze's core session: a 5x5 grid of rooms (see grid.ts/mazeGen.ts), 4 players (1 human +
// 3 CPU, see cpuBrain.ts) each permanently assigned one entrance side and one room-quadrant. Real
// time, no turns. The instant the 3rd player exits back out their own entrance, the maze locks —
// every open door swings shut — and whoever's still inside is named the loser.

import { DOOR_SWING_SHUT_MS, ENDING_HOLD_MS, FAILED_MARKER_MS, MOVE_DURATION_MS } from "./constants.ts";
import { decideCpuAction, createCpuBrain, type CpuBrain } from "./cpuBrain.ts";
import {
  ENTRANCE_SIDE_BY_PLAYER,
  QUADRANT_BY_PLAYER,
  entranceRoomForSide,
  getInteriorEdge,
  isOwnExitAttempt,
  neighborRoom,
  oppositeSide,
  type MazeGrid,
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
  room: RoomId;
  facing: Side;
  moveTarget: RoomId | null;
  moveStartedAt: number | null;
  exited: boolean;
  exitedAt: number | null;
  coloredRoomCount: number;
  cpu: CpuBrain | null;
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
  grid: MazeGrid;
  rooms: RoomState[][];
  players: PlayerState[];
  exitOrder: number[];
  loserId: number | null;
  endingStartedAt: number | null;
  failedAttemptMarker: FailedAttemptMarker | null;
  // Edge-triggered, cleared at the start of every tick — main.ts reads these after each
  // updateLightMazeSession call to dispatch one-shot sounds (mirrors Stampede's WeakMap-diff
  // idiom, just as an explicit event list instead, since "who did it" matters for volume).
  doorOpenedThisTick: { byPlayerId: number }[];
  humanDoorFailedThisTick: boolean;
  exitedThisTick: number[];
}

export interface LightMazeInput {
  moveDir: Side | null;
  clicked: boolean;
}

function markRoomVisited(session: LightMazeSession, player: PlayerState): void {
  const cell = session.rooms[player.room.row]![player.room.col]!;
  if (cell.visitedByPlayer[player.id]) return;
  cell.visitedByPlayer[player.id] = true;
  player.coloredRoomCount++;
}

function doExit(session: LightMazeSession, player: PlayerState, now: number): void {
  player.exited = true;
  player.exitedAt = now;
  session.exitOrder.push(player.id);
  session.exitedThisTick.push(player.id);
}

function beginMove(player: PlayerState, dir: Side, target: RoomId, now: number): void {
  player.facing = dir;
  player.moveTarget = target;
  player.moveStartedAt = now;
}

function completeMove(session: LightMazeSession, player: PlayerState): void {
  player.room = player.moveTarget!;
  player.moveTarget = null;
  player.moveStartedAt = null;
  markRoomVisited(session, player);
}

export function createLightMazeSession(identities: PlayerIdentity[], now: number): LightMazeSession {
  const grid = generateMaze();
  const rooms: RoomState[][] = [];
  for (let row = 0; row < 5; row++) {
    const rowRooms: RoomState[] = [];
    for (let col = 0; col < 5; col++) {
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
      room,
      facing: oppositeSide(entranceSide), // starts facing INTO the maze, not back out
      moveTarget: null,
      moveStartedAt: null,
      exited: false,
      exitedAt: null,
      coloredRoomCount: 0,
      cpu: identity.isBot ? createCpuBrain(room, now) : null,
    };
  });

  const session: LightMazeSession = {
    identities,
    phase: "PLAYING",
    startedAt: now,
    grid,
    rooms,
    players,
    exitOrder: [],
    loserId: null,
    endingStartedAt: null,
    failedAttemptMarker: null,
    doorOpenedThisTick: [],
    humanDoorFailedThisTick: false,
    exitedThisTick: [],
  };

  // Every player's own starting room is colored the instant the game begins — they "just walked
  // in", the same as any other room they'll later enter.
  for (const player of players) markRoomVisited(session, player);

  return session;
}

function attemptMove(session: LightMazeSession, player: PlayerState, dir: Side, now: number): void {
  if (player.moveTarget !== null) return; // one room at a time — ignore input mid-lerp
  player.facing = dir; // bump sets facing even when blocked
  const neighbor = neighborRoom(player.room, dir);
  if (!neighbor) {
    if (isOwnExitAttempt(player.entranceSide, player.room, dir)) doExit(session, player, now);
    return; // otherwise: solid boundary, no-op
  }
  const edge = getInteriorEdge(session.grid, player.room, dir);
  if (!edge || edge.state !== "open") return; // none/closed-real/closed-fake all block movement
  beginMove(player, dir, neighbor, now);
}

function attemptOpenDoorInFacing(session: LightMazeSession, player: PlayerState, now: number): void {
  if (player.moveTarget !== null) return;
  const dir = player.facing;
  const neighbor = neighborRoom(player.room, dir);
  if (!neighbor) return; // no door here — either a plain boundary, or your own exit (walked, not clicked)
  const edge = getInteriorEdge(session.grid, player.room, dir);
  if (!edge || edge.state === "open" || edge.state === "none") return; // no-op per spec
  if (edge.state === "closed-real") {
    edge.state = "open";
    edge.animStartedAt = now;
    session.doorOpenedThisTick.push({ byPlayerId: player.id });
  } else {
    session.failedAttemptMarker = { room: player.room, dir, shownAt: now };
    session.humanDoorFailedThisTick = true;
  }
}

function applyCpuAction(session: LightMazeSession, player: PlayerState, now: number): void {
  const cpu = player.cpu!;
  const action = decideCpuAction(session.grid, cpu, player.room, now);
  switch (action.type) {
    case "wait":
      return;
    case "move":
      beginMove(player, action.dir, action.target, now);
      return;
    case "attemptOpen":
      if (action.success) session.doorOpenedThisTick.push({ byPlayerId: player.id });
      return;
    case "exit":
      doExit(session, player, now);
      return;
  }
}

export function updateLightMazeSession(session: LightMazeSession, now: number, input: LightMazeInput): void {
  if (session.phase === "RESULTS") return;

  session.doorOpenedThisTick = [];
  session.humanDoorFailedThisTick = false;
  session.exitedThisTick = [];

  if (session.phase === "ENDING") {
    if (now - session.endingStartedAt! >= DOOR_SWING_SHUT_MS + ENDING_HOLD_MS) session.phase = "RESULTS";
    return; // frozen — no movement/CPU updates, mirrors StampedeSession's transition freeze
  }

  const human = session.players[0]!;
  if (!human.exited) {
    if (input.moveDir) attemptMove(session, human, input.moveDir, now);
    if (input.clicked) attemptOpenDoorInFacing(session, human, now);
  }

  for (const player of session.players) {
    if (player.moveTarget && now - player.moveStartedAt! >= MOVE_DURATION_MS) completeMove(session, player);
  }
  for (const player of session.players) {
    if (player.isBot && !player.exited && player.moveTarget === null) applyCpuAction(session, player, now);
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
