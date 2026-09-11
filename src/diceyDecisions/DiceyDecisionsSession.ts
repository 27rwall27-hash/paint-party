// Dicey Decisions' core session: 6 rounds (see constants.ts's ROUND_CONFIGS), each dividing the
// box into N sections of already-"rolled" dice (see diceGen.ts) — players race to click the
// section with the highest pip total. Real time, no turns. Deliberately `three`-free: every
// camera/raycast/mesh concern stays in the render layer (sceneBuilder.ts/raycast.ts), the same
// "session vs. render" split every other game in this suite already uses.

import {
  BOX_CLOSED_HOLD_MS,
  LID_CLOSE_DURATION_MS,
  LID_OPEN_DURATION_MS,
  PLAYER_COUNT,
  PLAYING_TIMEOUT_MS,
  POINTS_BY_RANK,
  RETICLE_SPEED,
  ROUND_CONFIGS,
  SCORED_HOLD_MS,
  type RoundConfig,
} from "./constants.ts";
import { createCpuDiceyPlan, rollCpuSkill, type CpuDiceyPlan } from "./cpuBrain.ts";
import { computeWinningSection, generateDicePlacements, generateSections, type DiePlacement, type SectionData } from "./diceGen.ts";
import type { PlayerIdentity } from "./identities.ts";

export type DiceyDecisionsPhase = "BOX_CLOSED" | "OPENING" | "PLAYING" | "SCORED" | "CLOSING" | "RESULTS";

export interface PlayerSelection {
  section: number | null;
  selectedAt: number | null;
}

export interface RoundState {
  roundIndex: number;
  config: RoundConfig;
  sections: SectionData[];
  dice: DiePlacement[];
  winningSection: number;
  selections: PlayerSelection[]; // index = playerId
  playStartedAt: number | null;
  scoresAwarded: number[] | null;
}

export interface DiceyDecisionsSession {
  identities: PlayerIdentity[];
  /** Rolled once at game start, persists across every round — same convention as every other
   * game's rollCpuSkill. Index = playerId; the human's own slot (0) is unused. */
  cpuSkills: number[];
  totalScores: number[]; // index = playerId, cumulative across rounds
  roundIndex: number;
  round: RoundState;
  phase: DiceyDecisionsPhase;
  phaseStartedAt: number;
  /** Real timestamp of the last updateDiceyDecisionsSession call — lets the reticle move in real
   * normalized-units-per-second regardless of the caller's own frame timing. */
  lastUpdateAt: number;
  /** Normalized [0,1] canvas-space — survives a canvas resize without needing live pixel
   * dimensions. Gameplay state (determines what a click selects), so it lives here, not in the
   * render layer — moved the same way Light Maze moves a player's room position. */
  humanReticle: { x: number; y: number };
  /** Fed in fresh each tick by main.ts (a raycast against last frame's reticle position — see
   * raycast.ts) and just stored here for the render layer to read back for the hover highlight. */
  humanHoveredSection: number | null;
  cpuPlans: (CpuDiceyPlan | null)[]; // index = playerId, regenerated every round on PLAYING entry
  // Edge-triggered, cleared at the start of every tick — main.ts reads these after each
  // updateDiceyDecisionsSession call to dispatch one-shot sounds.
  lidOpenedThisTick: boolean;
  lidClosedThisTick: boolean;
  selectionsThisTick: { playerId: number; correct: boolean }[];
  roundScoredThisTick: boolean;
}

export interface DiceyDecisionsInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** Raycast result from the PREVIOUS frame's reticle position — one frame of lag, imperceptible
   * at 60fps, keeps this session fully `three`-free (it only ever sees a plain number). */
  hoveredSection: number | null;
  clicked: boolean;
}

function createRoundState(roundIndex: number): RoundState {
  const config = ROUND_CONFIGS[roundIndex]!;
  const sections = generateSections(config);
  const dice = generateDicePlacements(sections);
  const winningSection = computeWinningSection(sections);
  return {
    roundIndex,
    config,
    sections,
    dice,
    winningSection,
    selections: Array.from({ length: PLAYER_COUNT }, () => ({ section: null, selectedAt: null })),
    playStartedAt: null,
    scoresAwarded: null,
  };
}

export function createDiceyDecisionsSession(identities: PlayerIdentity[], now: number): DiceyDecisionsSession {
  return {
    identities,
    cpuSkills: identities.map((identity) => (identity.isBot ? rollCpuSkill() : 0)),
    totalScores: new Array(PLAYER_COUNT).fill(0),
    roundIndex: 0,
    round: createRoundState(0),
    phase: "BOX_CLOSED",
    phaseStartedAt: now,
    lastUpdateAt: now,
    humanReticle: { x: 0.5, y: 0.5 },
    humanHoveredSection: null,
    cpuPlans: new Array(PLAYER_COUNT).fill(null),
    lidOpenedThisTick: false,
    lidClosedThisTick: false,
    selectionsThisTick: [],
    roundScoredThisTick: false,
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function moveReticle(reticle: { x: number; y: number }, input: DiceyDecisionsInput, dt: number): void {
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (dx !== 0 && dy !== 0) {
    dx *= Math.SQRT1_2;
    dy *= Math.SQRT1_2;
  }
  reticle.x = clamp01(reticle.x + dx * RETICLE_SPEED * dt);
  reticle.y = clamp01(reticle.y + dy * RETICLE_SPEED * dt);
}

function lockSelection(session: DiceyDecisionsSession, playerId: number, section: number, now: number): void {
  session.round.selections[playerId] = { section, selectedAt: now };
  session.selectionsThisTick.push({ playerId, correct: section === session.round.winningSection });
}

/** Ranks players who selected the WINNING section by how fast they did — 1st/2nd/3rd/4th correct
 * get POINTS_BY_RANK, anyone wrong (or who never selected) gets 0. If fewer than 4 were correct,
 * the unused ranks simply go unclaimed (no guaranteed "4th place" consolation prize). */
export function computeRoundScores(round: RoundState): number[] {
  const correct = round.selections
    .map((sel, playerId) => ({ playerId, sel }))
    .filter(({ sel }) => sel.section === round.winningSection && sel.selectedAt !== null)
    .sort((a, b) => a.sel.selectedAt! - b.sel.selectedAt!);
  const points = new Array(PLAYER_COUNT).fill(0);
  correct.forEach(({ playerId }, rank) => {
    points[playerId] = POINTS_BY_RANK[rank] ?? 0;
  });
  return points;
}

export function updateDiceyDecisionsSession(session: DiceyDecisionsSession, now: number, input: DiceyDecisionsInput): void {
  const dt = Math.min(0.05, Math.max(0, (now - session.lastUpdateAt) / 1000));
  session.lastUpdateAt = now;

  session.lidOpenedThisTick = false;
  session.lidClosedThisTick = false;
  session.selectionsThisTick = [];
  session.roundScoredThisTick = false;

  if (session.phase === "RESULTS") return;

  session.humanHoveredSection = input.hoveredSection;

  switch (session.phase) {
    case "BOX_CLOSED":
      if (now - session.phaseStartedAt >= BOX_CLOSED_HOLD_MS) {
        session.round = createRoundState(session.roundIndex);
        session.phase = "OPENING";
        session.phaseStartedAt = now;
        session.lidOpenedThisTick = true;
      }
      return;

    case "OPENING":
      if (now - session.phaseStartedAt >= LID_OPEN_DURATION_MS) {
        session.round.playStartedAt = now;
        session.cpuPlans = session.identities.map((identity) =>
          identity.isBot ? createCpuDiceyPlan(session.cpuSkills[identity.id]!, session.round.winningSection, session.round.config.sections) : null,
        );
        session.phase = "PLAYING";
        session.phaseStartedAt = now;
      }
      return;

    case "PLAYING": {
      moveReticle(session.humanReticle, input, dt);

      const human = session.round.selections[0]!;
      if (input.clicked && input.hoveredSection !== null && human.section === null) {
        lockSelection(session, 0, input.hoveredSection, now);
      }

      const elapsed = now - session.round.playStartedAt!;
      for (let playerId = 1; playerId < PLAYER_COUNT; playerId++) {
        if (session.round.selections[playerId]!.section !== null) continue;
        const plan = session.cpuPlans[playerId];
        if (plan && elapsed >= plan.reactionAtOffsetMs) lockSelection(session, playerId, plan.chosenSection, now);
      }

      const allSelected = session.round.selections.every((s) => s.section !== null);
      if (allSelected || elapsed >= PLAYING_TIMEOUT_MS) {
        const scores = computeRoundScores(session.round);
        session.round.scoresAwarded = scores;
        scores.forEach((pts, playerId) => {
          session.totalScores[playerId]! += pts;
        });
        session.phase = "SCORED";
        session.phaseStartedAt = now;
        session.roundScoredThisTick = true;
      }
      return;
    }

    case "SCORED":
      if (now - session.phaseStartedAt >= SCORED_HOLD_MS) {
        session.phase = "CLOSING";
        session.phaseStartedAt = now;
      }
      return;

    case "CLOSING":
      if (now - session.phaseStartedAt >= LID_CLOSE_DURATION_MS) {
        session.lidClosedThisTick = true;
        if (session.roundIndex + 1 < ROUND_CONFIGS.length) {
          session.roundIndex++;
          session.phase = "BOX_CLOSED";
        } else {
          session.phase = "RESULTS";
        }
        session.phaseStartedAt = now;
      }
      return;
  }
}
