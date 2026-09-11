// Cauldron Chaos' core session: a witch calls out a rapid-fire list of potion ingredients, then
// players take turns pouring a bottle from the shelf into the cauldron. A correct, not-yet-used
// ingredient is safe; anything else backfires and that player is out for the round. Turn-based,
// last one standing scores highest. Deliberately framework-free (no canvas/DOM) — every drawing
// concern stays in render.ts, the same "session vs. render" split every game in this suite uses.

import {
  CALLING_LEAD_MS,
  CALLING_TAIL_MS,
  HUMAN_TURN_TIMEOUT_MS,
  INGREDIENTS,
  INTRO_HOLD_MS,
  PLAYER_COUNT,
  POINTS_BY_SURVIVAL_RANK,
  ROUND_CONFIGS,
  SCORED_HOLD_MS,
  TURN_REVEAL_HOLD_MS,
  type RoundConfig,
} from "./constants.ts";
import { decideCpuPick, rollCpuSkill, type CpuPickPlan } from "./cpuBrain.ts";
import type { PlayerIdentity } from "./identities.ts";

export type CauldronChaosPhase = "INTRO" | "CALLING" | "PICKING" | "SCORED" | "RESULTS";

export interface LastPick {
  playerId: number;
  ingredientId: number;
  safe: boolean;
}

export interface RoundState {
  roundIndex: number;
  config: RoundConfig;
  poolIds: number[];
  calledIds: number[];
  remainingSafeIds: number[];
  usedIds: number[];
  turnOrder: number[];
  turnPointer: number;
  activePlayers: boolean[];
  eliminatedOrder: number[];
  survivor: number | null;
  scoresAwarded: number[] | null;
  turnSubPhase: "AWAITING" | "REVEAL";
  turnDeadlineAt: number | null;
  cpuDecisionAt: number | null;
  pendingCpuPick: CpuPickPlan | null;
  lastPick: LastPick | null;
  turnRevealUntil: number | null;
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
  pickedIngredientId: number | null;
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
  const poolIds = shuffled(INGREDIENTS.map((i) => i.id)).slice(0, config.poolSize);
  const calledIds = Array.from({ length: config.callListLength }, () => poolIds[Math.floor(Math.random() * poolIds.length)]!);
  const remainingSafeIds = [...new Set(calledIds)];
  const startPlayer = roundIndex % PLAYER_COUNT;
  const turnOrder = Array.from({ length: PLAYER_COUNT }, (_, i) => (startPlayer + i) % PLAYER_COUNT);
  return {
    roundIndex,
    config,
    poolIds,
    calledIds,
    remainingSafeIds,
    usedIds: [],
    turnOrder,
    turnPointer: 0,
    activePlayers: new Array(PLAYER_COUNT).fill(true),
    eliminatedOrder: [],
    survivor: null,
    scoresAwarded: null,
    turnSubPhase: "AWAITING",
    turnDeadlineAt: null,
    cpuDecisionAt: null,
    pendingCpuPick: null,
    lastPick: null,
    turnRevealUntil: null,
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
    session.round.turnSubPhase === "AWAITING" &&
    currentTurnPlayerId(session.round) === 0 &&
    !session.identities[0]!.isBot
  );
}

function beginTurn(session: CauldronChaosSession, now: number): void {
  const round = session.round;
  round.turnSubPhase = "AWAITING";
  round.lastPick = null;
  const playerId = currentTurnPlayerId(round);
  const identity = session.identities[playerId]!;
  if (identity.isBot) {
    const plan = decideCpuPick(session.cpuSkills[playerId]!, round.remainingSafeIds, round.poolIds);
    round.pendingCpuPick = plan;
    round.cpuDecisionAt = now + plan.thinkMs;
    round.turnDeadlineAt = null;
  } else {
    round.pendingCpuPick = null;
    round.cpuDecisionAt = null;
    round.turnDeadlineAt = now + HUMAN_TURN_TIMEOUT_MS;
  }
}

function resolvePick(session: CauldronChaosSession, playerId: number, ingredientId: number, now: number): void {
  const round = session.round;
  const safeIdx = round.remainingSafeIds.indexOf(ingredientId);
  const safe = safeIdx !== -1;
  if (safe) {
    round.remainingSafeIds.splice(safeIdx, 1);
    round.usedIds.push(ingredientId);
  } else {
    round.activePlayers[playerId] = false;
    round.eliminatedOrder.push(playerId);
  }
  round.lastPick = { playerId, ingredientId, safe };
  round.turnSubPhase = "REVEAL";
  round.turnRevealUntil = now + TURN_REVEAL_HOLD_MS;
  session.turnResolvedThisTick = { playerId, ingredientId, safe };
}

/** Ranks the survivor first, then eliminated players by how long they lasted (most recently
 * eliminated = 2nd place, earliest eliminated = last) — same points-by-rank convention as the
 * rest of the suite. */
function finishRound(session: CauldronChaosSession, now: number): void {
  const round = session.round;
  const ranking = [round.survivor!, ...[...round.eliminatedOrder].reverse()];
  const scores = new Array(PLAYER_COUNT).fill(0);
  ranking.forEach((playerId, rank) => {
    scores[playerId] = POINTS_BY_SURVIVAL_RANK[rank] ?? 0;
  });
  round.scoresAwarded = scores;
  scores.forEach((pts, playerId) => {
    session.totalScores[playerId]! += pts;
  });
  session.phase = "SCORED";
  session.phaseStartedAt = now;
  session.roundScoredThisTick = true;
}

function advanceAfterReveal(session: CauldronChaosSession, now: number): void {
  const round = session.round;
  const activeCount = round.activePlayers.filter(Boolean).length;
  if (activeCount <= 1) {
    round.survivor = round.activePlayers.findIndex(Boolean);
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
  if (round.turnSubPhase === "AWAITING") {
    const playerId = currentTurnPlayerId(round);
    const identity = session.identities[playerId]!;
    let pickedId: number | null = null;
    if (identity.isBot) {
      if (round.cpuDecisionAt !== null && now >= round.cpuDecisionAt) {
        pickedId = round.pendingCpuPick!.ingredientId;
      }
    } else if (input.pickedIngredientId !== null) {
      pickedId = input.pickedIngredientId;
    } else if (round.turnDeadlineAt !== null && now >= round.turnDeadlineAt) {
      pickedId = round.poolIds[Math.floor(Math.random() * round.poolIds.length)]!; // timed out — forced grab
    }
    if (pickedId !== null) resolvePick(session, playerId, pickedId, now);
    return;
  }
  if (round.turnRevealUntil !== null && now >= round.turnRevealUntil) advanceAfterReveal(session, now);
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
