// Boulder Strike's core session: every round flashes a sequence of gleams on all 10 pickaxes at
// once — decoys plus one real target, shown to players beforehand and placed at a random point in
// the sequence. Release (mouse-up) while the target is lit and you shatter your boulder; release
// at any other moment (or never release) and you don't. The 4 fastest correct releases (closest
// to the exact instant the target appeared) earn ore; everyone else gets nothing that round.
// Deliberately framework-free (no three.js/DOM) — every camera/mesh/animation concern stays in
// the render layer, the same "session vs. render" split every game in this suite uses.

import {
  GLEAM_COMBOS,
  INTRO_HOLD_MS,
  LEAD_GAP_MS,
  ORE_TIERS,
  PLAYER_COUNT,
  PREVIEW_HOLD_MS,
  RAISE_HOLD_MS,
  REVEAL_HOLD_MS,
  ROUND_CONFIGS,
  SCORED_HOLD_MS,
  TAIL_GRACE_MS,
  WALK_DURATION_MS,
  type GleamCombo,
  type RoundConfig,
} from "./constants.ts";
import { planCpuRelease, rollCpuSkill, type CpuReleasePlan } from "./cpuBrain.ts";
import type { PlayerIdentity } from "./identities.ts";

export type BoulderStrikePhase = "INTRO" | "PREVIEW" | "RAISE" | "GLEAMING" | "REVEAL" | "SCORED" | "WALK" | "RESULTS";

export type PlayerResult = "pending" | "success" | "fail";

export interface SequenceEntry {
  combo: GleamCombo;
  isTarget: boolean;
  startAt: number;
  endAt: number;
}

export interface RoundState {
  roundIndex: number;
  config: RoundConfig;
  targetCombo: GleamCombo;
  /** Absolute-timestamp schedule — empty until the RAISE phase ends and GLEAMING begins. */
  sequence: SequenceEntry[];
  lastActiveComboId: number | null;
  playerReleasedAt: (number | null)[];
  playerResult: PlayerResult[];
  cpuPlans: (CpuReleasePlan | null)[];
  scoresAwarded: number[] | null;
  /** Up to 4 player ids, fastest-correct first — who earned Gold/Silver/Bronze/Verdite this round. */
  rankedPlayerIds: number[];
}

export interface BoulderStrikeSession {
  identities: PlayerIdentity[];
  cpuSkills: number[];
  totalScores: number[];
  roundIndex: number;
  round: RoundState;
  phase: BoulderStrikePhase;
  phaseStartedAt: number;
  // Edge-triggered, cleared at the start of every tick — main.ts reads these after each
  // updateBoulderStrikeSession call to dispatch one-shot sounds/effects.
  gleamChangedThisTick: { combo: GleamCombo; isTarget: boolean } | null;
  playersResolvedThisTick: { playerId: number; success: boolean }[];
  roundScoredThisTick: boolean;
}

export interface BoulderStrikeInput {
  /** True for exactly one tick — the frame the human's mouse-up fired. */
  released: boolean;
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
  const targetCombo = GLEAM_COMBOS[Math.floor(Math.random() * GLEAM_COMBOS.length)]!;
  return {
    roundIndex,
    config,
    targetCombo,
    sequence: [],
    lastActiveComboId: null,
    playerReleasedAt: new Array(PLAYER_COUNT).fill(null),
    playerResult: new Array(PLAYER_COUNT).fill("pending"),
    cpuPlans: new Array(PLAYER_COUNT).fill(null),
    scoresAwarded: null,
    rankedPlayerIds: [],
  };
}

export function createBoulderStrikeSession(identities: PlayerIdentity[], now: number): BoulderStrikeSession {
  return {
    identities,
    cpuSkills: identities.map((identity) => (identity.isBot ? rollCpuSkill() : 0)),
    totalScores: new Array(PLAYER_COUNT).fill(0),
    roundIndex: 0,
    round: createRoundState(0),
    phase: "INTRO",
    phaseStartedAt: now,
    gleamChangedThisTick: null,
    playersResolvedThisTick: [],
    roundScoredThisTick: false,
  };
}

/** Builds the round's full flash schedule as absolute timestamps — the target's position among
 * the decoys is randomized every round, so there's nothing to count toward, only watch for. */
function buildSequence(config: RoundConfig, targetCombo: GleamCombo, startTime: number): SequenceEntry[] {
  const totalSlots = config.decoyCount + 1;
  const targetSlot = Math.floor(Math.random() * totalSlots);
  const decoyPool = shuffled(GLEAM_COMBOS.filter((c) => c.id !== targetCombo.id));
  const entries: SequenceEntry[] = [];
  let decoyPointer = 0;
  for (let i = 0; i < totalSlots; i++) {
    const isTarget = i === targetSlot;
    const combo = isTarget ? targetCombo : decoyPool[decoyPointer++ % decoyPool.length]!;
    const slotStart = startTime + i * (config.windowMs + config.gapMs);
    entries.push({ combo, isTarget, startAt: slotStart, endAt: slotStart + config.windowMs });
  }
  return entries;
}

/** Whichever gleam (if any) is currently lit — pure function of the round's fixed schedule and
 * `now`, so both the session and the render layer can derive it independently without either
 * owning "current state" as mutable truth. */
export function activeGleamAt(round: RoundState, now: number): SequenceEntry | null {
  for (const entry of round.sequence) {
    if (now >= entry.startAt && now < entry.endAt) return entry;
  }
  return null;
}

function resolveRelease(session: BoulderStrikeSession, playerId: number, now: number): void {
  const round = session.round;
  if (round.playerResult[playerId] !== "pending") return;
  const active = activeGleamAt(round, now);
  const success = active !== null && active.isTarget;
  round.playerResult[playerId] = success ? "success" : "fail";
  round.playerReleasedAt[playerId] = now;
  session.playersResolvedThisTick.push({ playerId, success });
}

/** Ranks every successful release by how close it landed to the target gleam's own start —
 * closest (fastest reflexes) wins, since the target appears at the same instant for everyone.
 * Only the top 4 earn ore; 5th place and beyond get nothing this round. */
function computeRoundScoring(round: RoundState): number[] {
  const targetEntry = round.sequence.find((e) => e.isTarget)!;
  const successful = round.playerReleasedAt
    .map((releasedAt, playerId) => ({ playerId, releasedAt, result: round.playerResult[playerId] }))
    .filter((p): p is { playerId: number; releasedAt: number; result: PlayerResult } => p.result === "success" && p.releasedAt !== null)
    .sort((a, b) => a.releasedAt - targetEntry.startAt - (b.releasedAt - targetEntry.startAt));

  const scores = new Array(PLAYER_COUNT).fill(0);
  successful.slice(0, ORE_TIERS.length).forEach(({ playerId }, rank) => {
    scores[playerId] = ORE_TIERS[rank]!.points;
  });
  round.rankedPlayerIds = successful.slice(0, ORE_TIERS.length).map((p) => p.playerId);
  return scores;
}

function updateGleaming(session: BoulderStrikeSession, now: number, input: BoulderStrikeInput): void {
  const round = session.round;

  if (input.released && round.playerResult[0] === "pending") resolveRelease(session, 0, now);
  for (let playerId = 1; playerId < PLAYER_COUNT; playerId++) {
    if (round.playerResult[playerId] !== "pending") continue;
    const plan = round.cpuPlans[playerId];
    if (plan && plan.releaseAt !== null && now >= plan.releaseAt) resolveRelease(session, playerId, now);
  }

  const active = activeGleamAt(round, now);
  const activeComboId = active ? active.combo.id : null;
  if (activeComboId !== round.lastActiveComboId) {
    round.lastActiveComboId = activeComboId;
    if (active) session.gleamChangedThisTick = { combo: active.combo, isTarget: active.isTarget };
  }

  const lastEntry = round.sequence[round.sequence.length - 1]!;
  if (now >= lastEntry.endAt + TAIL_GRACE_MS) {
    const scores = computeRoundScoring(round);
    round.scoresAwarded = scores;
    scores.forEach((pts, playerId) => {
      session.totalScores[playerId]! += pts;
    });
    session.phase = "REVEAL";
    session.phaseStartedAt = now;
    session.roundScoredThisTick = true;
  }
}

export function updateBoulderStrikeSession(session: BoulderStrikeSession, now: number, input: BoulderStrikeInput): void {
  session.gleamChangedThisTick = null;
  session.playersResolvedThisTick = [];
  session.roundScoredThisTick = false;

  if (session.phase === "RESULTS") return;

  switch (session.phase) {
    case "INTRO":
      if (now - session.phaseStartedAt >= INTRO_HOLD_MS) {
        session.phase = "PREVIEW";
        session.phaseStartedAt = now;
      }
      return;

    case "PREVIEW":
      if (now - session.phaseStartedAt >= PREVIEW_HOLD_MS) {
        session.phase = "RAISE";
        session.phaseStartedAt = now;
      }
      return;

    case "RAISE":
      if (now - session.phaseStartedAt >= RAISE_HOLD_MS) {
        session.phase = "GLEAMING";
        session.phaseStartedAt = now;
        session.round.sequence = buildSequence(session.round.config, session.round.targetCombo, now + LEAD_GAP_MS);
        session.round.cpuPlans = session.identities.map((identity, playerId) =>
          identity.isBot ? planCpuRelease(session.cpuSkills[playerId]!, session.round) : null,
        );
      }
      return;

    case "GLEAMING":
      updateGleaming(session, now, input);
      return;

    case "REVEAL":
      if (now - session.phaseStartedAt >= REVEAL_HOLD_MS) {
        session.phase = "SCORED";
        session.phaseStartedAt = now;
      }
      return;

    case "SCORED":
      if (now - session.phaseStartedAt >= SCORED_HOLD_MS) {
        session.phase = "WALK";
        session.phaseStartedAt = now;
      }
      return;

    case "WALK":
      if (now - session.phaseStartedAt >= WALK_DURATION_MS) {
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
