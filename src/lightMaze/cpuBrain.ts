import { CPU_DECISION_INTERVAL_FAST_MS, CPU_DECISION_INTERVAL_SLOW_MS, CPU_DECISION_JITTER, CPU_FIRST_DECISION_DELAY_MS } from "./constants.ts";
import { directionFromTo, getInteriorEdge, neighborRoom, roomKey, SIDES, type MazeGrid, type RoomId, type Side } from "./grid.ts";

/** A CPU's own private knowledge of the maze — deliberately separate from the shared/global
 * MazeGrid: it always sees the true state of any globally "open" edge (obviously passable, no
 * ambiguity), but for a "closed" edge it doesn't know real vs. fake until it personally attempts
 * one, and never retries an edge it's personally confirmed fake. */
export interface CpuBrain {
  /** Rolled once at game start — 0..1, governs decision speed (see scheduleNextDecision). */
  skill: number;
  /** Explicit DFS backtracking stack of rooms this CPU has moved into, in order. stack[0] is
   * always its own entrance room; the stack only shrinks by backtracking one step at a time. */
  stack: RoomId[];
  /** Room keys this CPU has personally entered. */
  visited: Set<string>;
  /** Edge ids this CPU has personally attempted and found fake — never retried. */
  triedFakeEdges: Set<string>;
  nextDecisionAt: number;
}

export function rollCpuSkill(): number {
  return Math.random();
}

export function createCpuBrain(entranceRoom: RoomId, now: number): CpuBrain {
  return {
    skill: rollCpuSkill(),
    stack: [entranceRoom],
    visited: new Set([roomKey(entranceRoom)]),
    triedFakeEdges: new Set(),
    nextDecisionAt: now + CPU_FIRST_DECISION_DELAY_MS,
  };
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function scheduleNextDecision(cpu: CpuBrain, now: number): void {
  const base = CPU_DECISION_INTERVAL_SLOW_MS + (CPU_DECISION_INTERVAL_FAST_MS - CPU_DECISION_INTERVAL_SLOW_MS) * cpu.skill;
  const jitter = 1 + (Math.random() * 2 - 1) * CPU_DECISION_JITTER;
  cpu.nextDecisionAt = now + base * jitter;
}

export type CpuAction = { type: "wait" } | { type: "move"; dir: Side; target: RoomId } | { type: "attemptOpen"; dir: Side; success: boolean } | { type: "exit" };

/** One decision per call, assuming the caller only calls this while the CPU is stationary (not
 * mid-move — see LightMazeSession.ts's per-tick loop, which gates on player.moveTarget). Mutates
 * `grid` directly when a real door is opened (doors are global/shared state) and mutates `cpu`'s
 * own bookkeeping, but never touches player/session state — the caller applies the returned
 * action's side effects (actually moving the player, marking a room visited, exiting).
 *
 * Priority cascade, strictly in this order:
 *   1. An OPEN neighbor not yet personally visited -> move there (free progress).
 *   2. Else an untried CLOSED neighbor -> attempt it (real opens it for next tick's rule 1; fake
 *      gets permanently remembered and never retried).
 *   3. Else (nothing left to do here) -> backtrack one step along the known-open path home.
 *   4. Else (backtrack stack fully unwound) -> exit.
 *
 * This terminates for any maze shape: rule 1 only ever grows `visited` (bounded by 25 rooms),
 * rule 2 only ever permanently resolves one closed edge at the current room (bounded by <=4 per
 * room, monotonic, never re-attempted), and rule 3 only ever shrinks `stack` (bounded below by 1)
 * — none of these can regress, so eventually every reachable room is visited, every closed door
 * anywhere on the stack is resolved, the stack unwinds to length 1, and rule 4 fires. */
export function decideCpuAction(grid: MazeGrid, cpu: CpuBrain, currentRoom: RoomId, now: number): CpuAction {
  if (now < cpu.nextDecisionAt) return { type: "wait" };

  const dirs = shuffled(SIDES);

  for (const dir of dirs) {
    const neighbor = neighborRoom(currentRoom, dir);
    if (!neighbor) continue;
    const edge = getInteriorEdge(grid, currentRoom, dir);
    if (edge?.state === "open" && !cpu.visited.has(roomKey(neighbor))) {
      cpu.visited.add(roomKey(neighbor));
      cpu.stack.push(neighbor);
      scheduleNextDecision(cpu, now);
      return { type: "move", dir, target: neighbor };
    }
  }

  for (const dir of dirs) {
    const edge = getInteriorEdge(grid, currentRoom, dir);
    if (!edge || (edge.state !== "closed-real" && edge.state !== "closed-fake")) continue;
    if (cpu.triedFakeEdges.has(edge.id)) continue;
    scheduleNextDecision(cpu, now);
    if (edge.state === "closed-real") {
      edge.state = "open";
      edge.animStartedAt = now;
      return { type: "attemptOpen", dir, success: true };
    }
    cpu.triedFakeEdges.add(edge.id);
    return { type: "attemptOpen", dir, success: false };
  }

  if (cpu.stack.length > 1) {
    cpu.stack.pop();
    const prev = cpu.stack[cpu.stack.length - 1]!;
    const dir = directionFromTo(currentRoom, prev);
    scheduleNextDecision(cpu, now);
    return { type: "move", dir, target: prev };
  }

  return { type: "exit" };
}
