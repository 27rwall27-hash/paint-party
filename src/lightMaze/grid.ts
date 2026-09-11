import { GRID_SIZE, MID_INDEX, VESTIBULE_DEPTH } from "./constants.ts";

/** A continuous position in room-units — integer (row, col) is a room's CENTER, so a room spans
 * [-0.5, +0.5] around its own integer coordinate on each axis, and the boundary between room r
 * and r+1 sits at r+0.5. Used for free (non-grid-locked) movement — see LightMazeSession.ts. */
export interface Position {
  row: number;
  col: number;
}

export type Side = "N" | "E" | "S" | "W";
export const SIDES: Side[] = ["N", "E", "S", "W"];

export function oppositeSide(side: Side): Side {
  return side === "N" ? "S" : side === "S" ? "N" : side === "E" ? "W" : "E";
}

export interface RoomId {
  row: number;
  col: number;
}

export function roomKey(room: RoomId): string {
  return `${room.row},${room.col}`;
}

export function roomEquals(a: RoomId, b: RoomId): boolean {
  return a.row === b.row && a.col === b.col;
}

/** `none` = solid wall, never interactive. `closed-real` = opens unconditionally on the first
 * attempt, by anyone. `closed-fake` = looks identical to a real closed door but never opens, no
 * matter who tries or how many times — the deliberate "remember which doors don't open" trap.
 * `open` = a former closed-real door that's been opened — global, passable by everyone from then
 * on, UNTIL the next periodic reshut (see RESHUT_INTERVAL_MS) flips it back to `closed-real` —
 * still the same real door, still freely reopenable, just needs it again. */
export type DoorState = "none" | "closed-real" | "closed-fake" | "open";

export interface DoorEdge {
  id: string;
  roomA: RoomId;
  roomB: RoomId;
  state: DoorState;
  /** Set the instant this edge's state last changed to `open` OR was reshut back to
   * `closed-real` — drives BOTH the swing-open and swing-shut hinge animations in render.ts
   * (which one depends on the edge's current `state`). Untouched by a `closed-fake` failed
   * attempt, since that never changes `state` at all. */
  animStartedAt: number | null;
}

export interface MazeGrid {
  edges: Map<string, DoorEdge>;
}

export type Quadrant = "TL" | "TR" | "BL" | "BR";
/** Fixed, permanent player-id -> quadrant assignment, the same in every room. */
export const QUADRANT_BY_PLAYER: Quadrant[] = ["TL", "TR", "BL", "BR"];
/** Fixed, permanent player-id -> entrance-side assignment — one player per side of the grid. */
export const ENTRANCE_SIDE_BY_PLAYER: Side[] = ["N", "E", "S", "W"];

/** The one room on each side that has an entrance — the middle of that edge, since the grid is
 * an odd 5 wide/tall. */
export function entranceRoomForSide(side: Side): RoomId {
  switch (side) {
    case "N":
      return { row: 0, col: MID_INDEX };
    case "S":
      return { row: GRID_SIZE - 1, col: MID_INDEX };
    case "W":
      return { row: MID_INDEX, col: 0 };
    case "E":
      return { row: MID_INDEX, col: GRID_SIZE - 1 };
  }
}

/** Null if that direction runs off the grid — the caller decides what that means (solid boundary,
 * or possibly an exit if it's this player's own entrance side/room). */
export function neighborRoom(room: RoomId, dir: Side): RoomId | null {
  const next = dir === "N" ? { row: room.row - 1, col: room.col } : dir === "S" ? { row: room.row + 1, col: room.col } : dir === "W" ? { row: room.row, col: room.col - 1 } : { row: room.row, col: room.col + 1 };
  if (next.row < 0 || next.row >= GRID_SIZE || next.col < 0 || next.col >= GRID_SIZE) return null;
  return next;
}

/** The direction you'd have to move IN to get from `from` to the (assumed orthogonally adjacent)
 * `to` — used by the CPU brain's backtrack step, where the target is always a room it arrived
 * from and so is guaranteed adjacent. */
export function directionFromTo(from: RoomId, to: RoomId): Side {
  if (to.row < from.row) return "N";
  if (to.row > from.row) return "S";
  if (to.col < from.col) return "W";
  return "E";
}

/** Canonical, order-independent key for the edge between two orthogonally-adjacent rooms. */
export function interiorEdgeKey(a: RoomId, b: RoomId): string {
  const [first, second] = roomKey(a) < roomKey(b) ? [a, b] : [b, a];
  return `${roomKey(first)}|${roomKey(second)}`;
}

/** Null if `dir` runs off the grid (a solid boundary, not an interior edge at all). */
export function getInteriorEdge(grid: MazeGrid, room: RoomId, dir: Side): DoorEdge | null {
  const neighbor = neighborRoom(room, dir);
  if (!neighbor) return null;
  return grid.edges.get(interiorEdgeKey(room, neighbor)) ?? null;
}

/** True only for the room/direction pair that is a given entrance side's own boundary — i.e.
 * standing in your own entrance room, facing outward. Not stored state (see DoorEdge) since it's
 * a fixed, permanent, per-player fact rather than something that can be opened/closed/discovered. */
export function isOwnExitAttempt(entranceSide: Side, room: RoomId, dir: Side): boolean {
  return dir === entranceSide && roomEquals(room, entranceRoomForSide(entranceSide));
}

/** True once a continuous position has crossed all the way past the grid's own bounding square —
 * i.e. is out in someone's vestibule (or, in principle, further still). Derived fresh from
 * position rather than stored, so there's exactly one source of truth for "am I outside". */
export function isOutsideGrid(pos: Position): boolean {
  return pos.row < -0.5 || pos.row > GRID_SIZE - 0.5 || pos.col < -0.5 || pos.col > GRID_SIZE - 0.5;
}

/** Where a player starts, before they've walked in — a bit out into their own entrance's
 * vestibule, centered on their entrance's row/col. */
export function outsideStartPos(side: Side): Position {
  const room = entranceRoomForSide(side);
  const offset = 0.5 + VESTIBULE_DEPTH * 0.65;
  switch (side) {
    case "N":
      return { row: room.row - offset, col: room.col };
    case "S":
      return { row: room.row + offset, col: room.col };
    case "W":
      return { row: room.row, col: room.col - offset };
    case "E":
      return { row: room.row, col: room.col + offset };
  }
}
