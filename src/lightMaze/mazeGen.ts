import { EXTRA_LOOP_EDGE_COUNT, FAKE_DOOR_FRACTION, GRID_SIZE } from "./constants.ts";
import { type DoorEdge, type DoorState, type MazeGrid, type RoomId, SIDES, interiorEdgeKey, neighborRoom, roomKey } from "./grid.ts";

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

interface EdgeSeed {
  key: string;
  roomA: RoomId;
  roomB: RoomId;
}

function buildAllInteriorEdges(): EdgeSeed[] {
  const seeds: EdgeSeed[] = [];
  const seen = new Set<string>();
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const room: RoomId = { row, col };
      for (const dir of SIDES) {
        const neighbor = neighborRoom(room, dir);
        if (!neighbor) continue;
        const key = interiorEdgeKey(room, neighbor);
        if (seen.has(key)) continue;
        seen.add(key);
        seeds.push({ key, roomA: room, roomB: neighbor });
      }
    }
  }
  return seeds;
}

/** Randomized recursive backtracker over the 5x5 room grid — produces a spanning tree (24 of the
 * 40 total interior edges) that structurally guarantees every room is reachable from any other
 * using only real doors, no matter how it's played. On top of that: a handful of the remaining 16
 * edges become extra real loop-edges (so it's not one single fragile path), roughly half of
 * what's left after that become permanently-fake trap doors, and the rest stay plain solid walls.
 *
 * Deliberately the SAME algorithm shape as cpuBrain.ts's own exploration loop — one consistent
 * "randomized backtracker" mental model instead of two unrelated maze algorithms in the same file
 * tree. */
export function generateMaze(): MazeGrid {
  const allEdges = buildAllInteriorEdges();
  const treeEdgeKeys = new Set<string>();
  const visited = new Set<string>();

  const start: RoomId = { row: 0, col: 0 }; // arbitrary seed — unrelated to any entrance
  const stack: RoomId[] = [start];
  visited.add(roomKey(start));

  while (stack.length > 0) {
    const current = stack[stack.length - 1]!;
    const candidates = shuffled(SIDES)
      .map((dir) => neighborRoom(current, dir))
      .filter((room): room is RoomId => room !== null && !visited.has(roomKey(room)));
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    const next = candidates[0]!;
    treeEdgeKeys.add(interiorEdgeKey(current, next));
    visited.add(roomKey(next));
    stack.push(next);
  }

  const nonTree = shuffled(allEdges.filter((e) => !treeEdgeKeys.has(e.key)));
  const loopEdges = nonTree.slice(0, EXTRA_LOOP_EDGE_COUNT);
  const remaining = nonTree.slice(EXTRA_LOOP_EDGE_COUNT);
  const fakeCount = Math.round(remaining.length * FAKE_DOOR_FRACTION);
  const fakeKeys = new Set(remaining.slice(0, fakeCount).map((e) => e.key));
  const realKeys = new Set([...treeEdgeKeys, ...loopEdges.map((e) => e.key)]);

  const edges = new Map<string, DoorEdge>();
  for (const seed of allEdges) {
    const state: DoorState = realKeys.has(seed.key) ? "closed-real" : fakeKeys.has(seed.key) ? "closed-fake" : "none";
    edges.set(seed.key, { id: seed.key, roomA: seed.roomA, roomB: seed.roomB, state, animStartedAt: null });
  }
  return { edges };
}
