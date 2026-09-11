// Cauldron Chaos' core session: the cauldron reveals a rapid-fire list of potion ingredients,
// then players take turns walking to the shelf, picking up a bottle, and carrying it to the
// cauldron to pour. The same ingredient can sit on the shelf as several physical bottles — each
// copy can be safely poured once, as long as its type was actually on the list. Anything else
// backfires and that player is out for the round. Deliberately framework-free (no three.js/DOM)
// — every camera/mesh/animation concern stays in the render layer, the same "session vs. render"
// split every game in this suite uses.

import {
  CALLING_LEAD_MS,
  CALLING_TAIL_MS,
  HUMAN_TURN_TIMEOUT_MS,
  INGREDIENTS,
  INTRO_HOLD_MS,
  PICKUP_HOLD_MS,
  PLAYER_COUNT,
  POINTS_BY_SURVIVAL_RANK,
  POUR_HOLD_MS,
  ROUND_CONFIGS,
  SCORED_HOLD_MS,
  WALK_DURATION_MS,
  type RoundConfig,
} from "./constants.ts";
import { decideCpuPick, rollCpuSkill, type CpuPickPlan } from "./cpuBrain.ts";
import type { PlayerIdentity } from "./identities.ts";

export type CauldronChaosPhase = "INTRO" | "CALLING" | "PICKING" | "SCORED" | "RESULTS";

export type TurnPhase = "AWAITING" | "DECIDING" | "WALK_TO_SHELF" | "PICKUP" | "WALK_TO_CAULDRON" | "POUR" | "WALK_BACK";

export interface ShelfSlot {
  slotId: number;
  typeId: number;
}

export interface LastPick {
  playerId: number;
  slotId: number;
  typeId: number;
  safe: boolean;
}

export interface RoundState {
  roundIndex: number;
  config: RoundConfig;
  shelfSlots: ShelfSlot[];
  calledIds: number[];
  /** Per ingredient TYPE id, how many more physical copies of it are still safe to pour. */
  remainingSafeCountByType: Record<number, number>;
  usedSlotIds: number[];
  turnOrder: number[];
  turnPointer: number;
  activePlayers: boolean[];
  eliminatedOrder: number[];
  /** Normally one player (down to a single survivor). Can be more than one if the shelf's entire
   * physical supply gets safely exhausted before the round narrows to 1 — see advanceAfterTurn. */
  survivors: number[];
  scoresAwarded: number[] | null;
  turnPhase: TurnPhase;
  turnPhaseStartedAt: number;
  /** Only meaningful during DECIDING — a CPU's skill-scaled pause before it sets off. */
  turnPhaseDurationMs: number | null;
  turnDeadlineAt: number | null;
  pendingPickSlotId: number | null;
  lastPick: LastPick | null;
}

export interface CauldronChaosSession {
  identities: PlayerIdentity[];
  cpuSkills: number[];
  totalScores: number[];
  roundIndex: number;
  round: RoundState;
  phase: CauldronChaosPhase;
  phaseStartedAt: number;
  callIndexRevealed: number;
  // Edge-triggered, cleared at the start of every tick — main.ts reads these after each
  // updateCauldronChaosSession call to dispatch one-shot sounds.
  callItemRevealedThisTick: { ingredientId: number } | null;
  turnResolvedThisTick: LastPick | null;
  roundScoredThisTick: boolean;
}

export interface CauldronChaosInput {
  /** Set by main.ts the moment the human clicks a shelf bottle on their own turn; consumed (and
   * cleared back to null) the instant it's applied. */
  pickedSlotId: number | null;
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function createRoundState(roundIndex: number): RoundState {
  const config = ROUND_CONFIGS[roundIndex]!;
  const types = shuffled(INGREDIENTS.map((i) => i.id)).slice(0, config.distinctTypeCount);

  const shelfSlots: ShelfSlot[] = [];
  let nextSlotId = 0;
  const copiesByType: Record<number, number> = {};
  for (const typeId of types) {
    const copies = 1 + Math.floor(Math.random() * config.maxCopiesPerType);
    copiesByType[typeId] = copies;
    for (let c = 0; c < copies; c++) shelfSlots.push({ slotId: nextSlotId++, typeId });
  }

  const calledIds = Array.from({ length: config.callListLength }, () => types[Math.floor(Math.random() * types.length)]!);
  const remainingSafeCountByType: Record<number, number> = {};
  for (const typeId of types) {
    const calledCount = calledIds.filter((id) => id === typeId).length;
    remainingSafeCountByType[typeId] = Math.min(calledCount, copiesByType[typeId] ?? 0);
  }

  const startPlayer = roundIndex % PLAYER_COUNT;
  const turnOrder = Array.from({ length: PLAYER_COUNT }, (_, i) => (startPlayer + i) % PLAYER_COUNT);

  return {
    roundIndex,
    config,
    shelfSlots,
    calledIds,
    remainingSafeCountByType,
    usedSlotIds: [],
    turnOrder,
    turnPointer: 0,
    activePlayers: new Array(PLAYER_COUNT).fill(true),
    eliminatedOrder: [],
    survivors: [],
    scoresAwarded: null,
    turnPhase: "AWAITING",
    turnPhaseStartedAt: 0,
    turnPhaseDurationMs: null,
    turnDeadlineAt: null,
    pendingPickSlotId: null,
    lastPick: null,
  };
}

export function createCauldronChaosSession(identities: PlayerIdentity[], now: number): CauldronChaosSession {
  return {
    identities,
    cpuSkills: identities.map((identity) => (identity.isBot ? rollCpuSkill() : 0)),
    totalScores: new Array(PLAYER_COUNT).fill(0),
    roundIndex: 0,
    round: createRoundState(0),
    phase: "INTRO",
    phaseStartedAt: now,
    callIndexRevealed: 0,
    callItemRevealedThisTick: null,
    turnResolvedThisTick: null,
    roundScoredThisTick: false,
  };
}

export function currentTurnPlayerId(round: RoundState): number {
  return round.turnOrder[round.turnPointer]!;
}

/** True exactly when main.ts should accept a shelf click as the human's move. */
export function isHumanTurnAwaitingInput(session: CauldronChaosSession): boolean {
  return (
    session.phase === "PICKING" &&
    session.round.turnPhase === "AWAITING" &&
    currentTurnPlayerId(session.round) === 0 &&
    !session.identities[0]!.isBot
  );
}

function beginTurn(session: CauldronChaosSession, now: number): void {
  const round = session.round;
  round.lastPick = null;
  round.pendingPickSlotId = null;
  const playerId = currentTurnPlayerId(round);
  const identity = session.identities[playerId]!;
  if (identity.isBot) {
    const plan: CpuPickPlan = decideCpuPick(session.cpuSkills[playerId]!, round.shelfSlots, round.usedSlotIds, round.remainingSafeCountByType);
    round.pendingPickSlotId = plan.slotId;
    round.turnPhase = "DECIDING";
    round.turnPhaseStartedAt = now;
    round.turnPhaseDurationMs = plan.decideMs;
    round.turnDeadlineAt = null;
  } else {
    round.turnPhase = "AWAITING";
    round.turnPhaseStartedAt = now;
    round.turnPhaseDurationMs = null;
    round.turnDeadlineAt = now + HUMAN_TURN_TIMEOUT_MS;
  }
}

function resolvePick(session: CauldronChaosSession): void {
  const round = session.round;
  const playerId = currentTurnPlayerId(round);
  const slotId = round.pendingPickSlotId!;
  const slot = round.shelfSlots.find((s) => s.slotId === slotId)!;
  const typeId = slot.typeId;
  const safe = (round.remainingSafeCountByType[typeId] ?? 0) > 0;
  if (safe) {
    round.remainingSafeCountByType[typeId] = round.remainingSafeCountByType[typeId]! - 1;
    round.usedSlotIds.push(slotId);
  } else {
    round.activePlayers[playerId] = false;
    round.eliminatedOrder.push(playerId);
  }
  const lastPick: LastPick = { playerId, slotId, typeId, safe };
  round.lastPick = lastPick;
  session.turnResolvedThisTick = lastPick;
}

/** Every still-active player shares full survivor credit (normally just one, once the round has
 * narrowed to a single player left — but see advanceAfterTurn's other end condition, where the
 * shelf's physical supply runs out first and more than one player can tie for it). Eliminated
 * players are then ranked by how long they lasted, using whatever point tiers are left — same
 * points-by-rank convention as the rest of the suite. */
function finishRound(session: CauldronChaosSession, now: number): void {
  const round = session.round;
  const scores = new Array(PLAYER_COUNT).fill(0);
  for (const playerId of round.survivors) scores[playerId] = POINTS_BY_SURVIVAL_RANK[0] ?? 0;
  [...round.eliminatedOrder].reverse().forEach((playerId, i) => {
    scores[playerId] = POINTS_BY_SURVIVAL_RANK[i + 1] ?? 0;
  });
  round.scoresAwarded = scores;
  scores.forEach((pts, playerId) => {
    session.totalScores[playerId]! += pts;
  });
  session.phase = "SCORED";
  session.phaseStartedAt = now;
  session.roundScoredThisTick = true;
}

function advanceAfterTurn(session: CauldronChaosSession, now: number): void {
  const round = session.round;
  const activeCount = round.activePlayers.filter(Boolean).length;
  const shelfExhausted = round.shelfSlots.every((s) => round.usedSlotIds.includes(s.slotId));
  if (activeCount <= 1 || shelfExhausted) {
    round.survivors = round.activePlayers.flatMap((active, playerId) => (active ? [playerId] : []));
    finishRound(session, now);
    return;
  }
  let next = round.turnPointer;
  do {
    next = (next + 1) % round.turnOrder.length;
  } while (!round.activePlayers[round.turnOrder[next]!]);
  round.turnPointer = next;
  beginTurn(session, now);
}

function updatePicking(session: CauldronChaosSession, now: number, input: CauldronChaosInput): void {
  const round = session.round;
  switch (round.turnPhase) {
    case "AWAITING": {
      let slotId: number | null = null;
      if (input.pickedSlotId !== null) {
        slotId = input.pickedSlotId;
      } else if (round.turnDeadlineAt !== null && now >= round.turnDeadlineAt) {
        const available = round.shelfSlots.filter((s) => !round.usedSlotIds.includes(s.slotId));
        const pool = available.length > 0 ? available : round.shelfSlots;
        slotId = pool[Math.floor(Math.random() * pool.length)]!.slotId;
      }
      if (slotId !== null) {
        round.pendingPickSlotId = slotId;
        round.turnPhase = "WALK_TO_SHELF";
        round.turnPhaseStartedAt = now;
      }
      return;
    }
    case "DECIDING":
      if (round.turnPhaseDurationMs !== null && now - round.turnPhaseStartedAt >= round.turnPhaseDurationMs) {
        round.turnPhase = "WALK_TO_SHELF";
        round.turnPhaseStartedAt = now;
      }
      return;
    case "WALK_TO_SHELF":
      if (now - round.turnPhaseStartedAt >= WALK_DURATION_MS) {
        round.turnPhase = "PICKUP";
        round.turnPhaseStartedAt = now;
      }
      return;
    case "PICKUP":
      if (now - round.turnPhaseStartedAt >= PICKUP_HOLD_MS) {
        round.turnPhase = "WALK_TO_CAULDRON";
        round.turnPhaseStartedAt = now;
      }
      return;
    case "WALK_TO_CAULDRON":
      if (now - round.turnPhaseStartedAt >= WALK_DURATION_MS) {
        resolvePick(session);
        round.turnPhase = "POUR";
        round.turnPhaseStartedAt = now;
      }
      return;
    case "POUR":
      if (now - round.turnPhaseStartedAt >= POUR_HOLD_MS) {
        round.turnPhase = "WALK_BACK";
        round.turnPhaseStartedAt = now;
      }
      return;
    case "WALK_BACK":
      if (now - round.turnPhaseStartedAt >= WALK_DURATION_MS) {
        advanceAfterTurn(session, now);
      }
      return;
  }
}

export function updateCauldronChaosSession(session: CauldronChaosSession, now: number, input: CauldronChaosInput): void {
  session.callItemRevealedThisTick = null;
  session.turnResolvedThisTick = null;
  session.roundScoredThisTick = false;

  if (session.phase === "RESULTS") return;

  switch (session.phase) {
    case "INTRO":
      if (now - session.phaseStartedAt >= INTRO_HOLD_MS) {
        session.phase = "CALLING";
        session.phaseStartedAt = now;
        session.callIndexRevealed = 0;
      }
      return;

    case "CALLING": {
      const { calledIds, config } = session.round;
      const elapsedSinceLead = now - session.phaseStartedAt - CALLING_LEAD_MS;
      if (elapsedSinceLead >= 0) {
        const shouldHaveRevealed = Math.min(calledIds.length, Math.floor(elapsedSinceLead / config.callIntervalMs) + 1);
        if (shouldHaveRevealed > session.callIndexRevealed) {
          session.callIndexRevealed = shouldHaveRevealed;
          session.callItemRevealedThisTick = { ingredientId: calledIds[shouldHaveRevealed - 1]! };
        }
      }
      const totalCallDuration = CALLING_LEAD_MS + config.callListLength * config.callIntervalMs + CALLING_TAIL_MS;
      if (now - session.phaseStartedAt >= totalCallDuration) {
        session.phase = "PICKING";
        session.phaseStartedAt = now;
        beginTurn(session, now);
      }
      return;
    }

    case "PICKING":
      updatePicking(session, now, input);
      return;

    case "SCORED":
      if (now - session.phaseStartedAt >= SCORED_HOLD_MS) {
        if (session.roundIndex + 1 < ROUND_CONFIGS.length) {
          session.roundIndex++;
          session.round = createRoundState(session.roundIndex);
          session.phase = "INTRO";
        } else {
          session.phase = "RESULTS";
        }
        session.phaseStartedAt = now;
      }
      return;
  }
}
