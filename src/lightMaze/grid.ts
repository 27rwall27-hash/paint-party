import { GRID_SIZE, MID_INDEX } from "./constants.ts";

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
 * `open` = a former closed-real door that's been opened — global, permanent, passable by
 * everyone from then on. */
export type DoorState = "none" | "closed-real" | "closed-fake" | "open";

export interface DoorEdge {
  id: string;
  roomA: RoomId;
  roomB: RoomId;
  state: DoorState;
  /** Set the instant this edge flips to "open" — drives the swing-open hinge animation in
   * render.ts. Never reset back to null; the end-of-game "swing shut" sweep computes its own
   * closing progress from session.endingStartedAt instead of touching every edge individually. */
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
