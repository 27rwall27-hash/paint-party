import {
  ABSOLUTE_MAX_SPLIT_WAIT_MS,
  CLUSTER_CHANCE,
  CLUSTER_STAGGER_MAX_MS,
  CLUSTER_STAGGER_MIN_MS,
  CLUSTER_WINDOW_MS,
  POINTS_BY_RANK,
  PRE_SPLIT_QUIET_MS,
  RACER_COUNT,
  RESULTS_EXIT_RUN_MS,
  RESULTS_EXIT_STAGGER_MS,
  RESULTS_POST_EXIT_HOLD_MS,
  SINGLE_PHASE_MS,
  SPLIT_EMPTY_HOLD_MS,
  SPLIT_PUSH_IN_MS,
  SPLIT_RUNNER_RUN_IN_MS,
  SPLIT_RUNNER_STAGGER_MS,
  THREE_WAY_PHASE_MS,
  TWO_WAY_PHASE_MS,
} from "./constants.ts";
import type { RacerIdentity } from "./identities.ts";
import { createRaceInstance, rollBaseSkill, updateRace, type RaceInstance } from "./RaceInstance.ts";

export type StampedePhase = "SINGLE" | "TWO_WAY" | "THREE_WAY" | "RESULTS";

/** The "push in / empty scene / runners file in" cinematic that now plays at every split, instead
 * of the layout just snapping straight to the new, smaller bands. Fully frozen — no race updates,
 * no phase timers — for its whole duration (see updateStampedeSession); render.ts is the only
 * other thing that reads this. */
export interface SplitTransition {
  fromBandCount: number;
  toBandCount: number;
  startedAt: number;
  /** Identity order for the brand-new band, which doesn't have a real RaceInstance yet — captured
   * the instant the transition starts (the same order `doSplit` will eventually seed it with).
   * Bands that already existed (index < fromBandCount) render straight from their real, live
   * RaceInstance throughout the transition; only the new one needs this. */
  newBandOrder: RacerIdentity[];
  /** Performs the actual split (pushes the new RaceInstance, flips the phase) — deferred until the
   * transition's total duration has elapsed, called with the `now` AT THAT LATER MOMENT (not the
   * moment the transition began). */
  doSplit: (now: number) => void;
}

export const SPLIT_TRANSITION_TOTAL_MS = SPLIT_PUSH_IN_MS + SPLIT_EMPTY_HOLD_MS + (RACER_COUNT - 1) * SPLIT_RUNNER_STAGGER_MS + SPLIT_RUNNER_RUN_IN_MS;

/** Total time from `finishingAt` until RESULTS actually begins — every racer's own staggered exit
 * (see finishStaggerRank) plus the hold after the very last one clears. */
export const RESULTS_EXIT_TOTAL_MS = (RACER_COUNT - 1) * RESULTS_EXIT_STAGGER_MS + RESULTS_EXIT_RUN_MS + RESULTS_POST_EXIT_HOLD_MS;

export interface StampedeSession {
  phase: StampedePhase;
  phaseEnteredAt: number;
  identities: RacerIdentity[];
  /** Length 1 (SINGLE), 2 (TWO_WAY), or 3 (THREE_WAY/RESULTS). */
  races: RaceInstance[];
  /** Persistent per-identity skill, rolled once here — each race clone jitters its own copy off
   * of this (see RaceInstance.createRaceInstance), so it's the "true" skill CPUs regress toward. */
  baseSkills: Map<number, number>;
  /** Set once, when THREE_WAY ends — index matches `identities`. */
  finalScores: number[] | null;
  /** Set the instant a phase reaches its nominal duration — from that moment every race stops
   * spawning new obstacle waves (see updateRace's `suppressSpawns`), letting whatever's already
   * in flight finish. Null whenever no split is pending. render.ts reads this to show a
   * "splitting soon" warning instead of the normal countdown. */
  pendingSplitAt: number | null;
  /** Set the first tick, after pendingSplitAt, that every race is confirmed obstacle-free — the
   * split then waits PRE_SPLIT_QUIET_MS of genuine silence from THIS moment (not from
   * pendingSplitAt) before actually executing. Null until that first clear moment is seen. */
  clearSinceAt: number | null;
  /** Non-null while the push-in/empty-scene/runners-file-in cinematic is playing, once the quiet
   * period above has elapsed. */
  transition: SplitTransition | null;
  /** Set the instant THREE_WAY's nominal duration is reached — from that moment every racer
   * sprints off the right edge, staggered by overall finish order (see finishStaggerRank and
   * render.ts's exitProgressFor), instead of the game cutting straight to RESULTS. Null until
   * then; RESULTS actually begins RESULTS_EXIT_TOTAL_MS after this is set. */
  finishingAt: number | null;
  /** identityId -> position in the OVERALL final standings (0 = the eventual winner, exits first;
   * RACER_COUNT-1 = last place, exits last) — computed once, the same instant `finishingAt` is
   * set (using the same score math as `finalScores`, just published a beat earlier since nothing
   * reads it before RESULTS actually begins anyway). Null until then. */
  finishStaggerRank: Map<number, number> | null;
}

/** Fisher-Yates, returns a new array. */
export function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export function createStampedeSession(identities: RacerIdentity[], now: number): StampedeSession {
  const baseSkills = new Map<number, number>();
  for (const identity of identities) {
    if (identity.isBot) baseSkills.set(identity.id, rollBaseSkill());
  }
  // Randomized starting lineup — identities[0] (the human) is otherwise ALWAYS first in this
  // array, which meant every game's very first jump landed the human in rank 0, the tightest/
  // least forgiving jump-airtime tier (see RaceInstance.jumpAirtimeMsForRank), before they'd had
  // any chance to get a feel for the timing. A real starting lineup wouldn't be alphabetical by
  // seat either.
  return {
    phase: "SINGLE",
    phaseEnteredAt: now,
    identities,
    races: [createRaceInstance(shuffled(identities), baseSkills, now, "SINGLE")],
    baseSkills,
    finalScores: null,
    pendingSplitAt: null,
    clearSinceAt: null,
    transition: null,
    finishingAt: null,
    finishStaggerRank: null,
  };
}

function identityOrder(session: StampedeSession, race: RaceInstance): RacerIdentity[] {
  const byId = new Map(session.identities.map((i) => [i.id, i]));
  return race.racers.map((r) => byId.get(r.identityId)!);
}

/** Once `elapsed >= phaseDurationMs`, this marks the phase as pending-split, which suppresses new
 * obstacle spawns for every race (see updateRace's `suppressSpawns`, applied in
 * updateStampedeSession below) — whatever's already in flight finishes naturally, and since
 * nothing new starts, every race is GUARANTEED to go quiet within a bounded few seconds rather
 * than needing a lucky simultaneous-clear coincidence. Once that first all-clear moment is seen,
 * PRE_SPLIT_QUIET_MS of genuine silence plays out (a real beat with nothing left to dodge) before
 * `onReady()` runs (which now starts the push-in/run-in transition rather than splitting
 * immediately — see beginSplitTransition). ABSOLUTE_MAX_SPLIT_WAIT_MS is a defensive-only ceiling
 * on the whole thing, not expected to matter given spawning is suppressed rather than waited-out. */
function maybeSplit(session: StampedeSession, now: number, elapsed: number, phaseDurationMs: number, onReady: () => void): void {
  if (session.pendingSplitAt === null) {
    if (elapsed >= phaseDurationMs) {
      session.pendingSplitAt = now;
      session.clearSinceAt = null;
    }
    return;
  }

  if (session.clearSinceAt === null) {
    const obstaclesClear = session.races.every((race) => race.obstacles.length === 0);
    if (obstaclesClear) session.clearSinceAt = now;
  }

  const quietLongEnough = session.clearSinceAt !== null && now - session.clearSinceAt >= PRE_SPLIT_QUIET_MS;
  const timedOut = now - session.pendingSplitAt >= ABSOLUTE_MAX_SPLIT_WAIT_MS;
  if (quietLongEnough || timedOut) {
    session.pendingSplitAt = null;
    session.clearSinceAt = null;
    onReady();
  }
}

function beginSplitTransition(session: StampedeSession, now: number, toBandCount: number, newBandOrder: RacerIdentity[], doSplit: (now: number) => void): void {
  session.transition = { fromBandCount: session.races.length, toBandCount, startedAt: now, newBandOrder, doSplit };
}

/** When a race's wave just finished (this tick) and it froze in a fresh `nextObstacleAt`, this
 * often re-targets that value to line up with another currently-idle race's own upcoming spawn
 * (still exactly one obstacle per race — only the TIMING is shared, never the obstacle itself) —
 * see CLUSTER_CHANCE. `justResolvedIdx` are the indices of races whose wave resolved this tick;
 * only those get re-targeted, so an already-scheduled race isn't yanked around on a later tick. */
function applyObstacleClustering(races: RaceInstance[], justResolvedIdx: number[], now: number): void {
  for (const i of justResolvedIdx) {
    if (Math.random() >= CLUSTER_CHANCE) continue;
    const race = races[i]!;
    let anchor: RaceInstance | null = null;
    for (let j = 0; j < races.length; j++) {
      if (j === i) continue;
      const other = races[j]!;
      if (other.obstacles.length > 0 || other.pendingSecondObstacleAt !== null) continue;
      if (other.nextObstacleAt <= now || other.nextObstacleAt - now > CLUSTER_WINDOW_MS) continue;
      if (!anchor || other.nextObstacleAt < anchor.nextObstacleAt) anchor = other;
    }
    if (anchor) {
      const magnitude = CLUSTER_STAGGER_MIN_MS + Math.random() * (CLUSTER_STAGGER_MAX_MS - CLUSTER_STAGGER_MIN_MS);
      const sign = Math.random() < 0.5 ? -1 : 1;
      race.nextObstacleAt = anchor.nextObstacleAt + sign * magnitude;
    }
  }
}

/** `humanJumpRequests[i]` is true only on the tick a click routed to band i (see main.ts) — one
 * flag per currently-active race, same length as `session.races`. */
export function updateStampedeSession(session: StampedeSession, dt: number, now: number, humanJumpRequests: boolean[]): void {
  if (session.phase === "RESULTS") return;

  if (session.transition) {
    if (now - session.transition.startedAt >= SPLIT_TRANSITION_TOTAL_MS) {
      const { doSplit } = session.transition;
      session.transition = null;
      doSplit(now);
    }
    return; // Fully frozen otherwise — no race updates, no phase-timer progress.
  }

  // Also frozen while every racer is sprinting off the right edge at the very end of the game —
  // nothing left to dodge, and the race is already logically over.
  if (session.finishingAt === null) {
    const suppressSpawns = session.pendingSplitAt !== null;
    const justResolvedIdx: number[] = [];
    for (let i = 0; i < session.races.length; i++) {
      const race = session.races[i]!;
      const wasPending = race.waveResolutionPending;
      updateRace(race, dt, now, humanJumpRequests[i] ?? false, suppressSpawns);
      if (wasPending && !race.waveResolutionPending) justResolvedIdx.push(i);
    }
    if (!suppressSpawns && session.races.length > 1) applyObstacleClustering(session.races, justResolvedIdx, now);
  }

  const elapsed = now - session.phaseEnteredAt;
  if (session.phase === "SINGLE") {
    maybeSplit(session, now, elapsed, SINGLE_PHASE_MS, () => {
      const seed = identityOrder(session, session.races[0]!);
      beginSplitTransition(session, now, 2, seed, (splitNow) => {
        session.races.push(createRaceInstance(seed, session.baseSkills, splitNow, "TWO_WAY"));
        session.races[0]!.phase = "TWO_WAY";
        session.phase = "TWO_WAY";
        session.phaseEnteredAt = splitNow;
      });
    });
  } else if (session.phase === "TWO_WAY") {
    // Seeded from the SECOND race's current standings (races[1]) — the first race already seeded
    // the second at the previous split, per the confirmed rule.
    maybeSplit(session, now, elapsed, TWO_WAY_PHASE_MS, () => {
      const seed = identityOrder(session, session.races[1]!);
      beginSplitTransition(session, now, 3, seed, (splitNow) => {
        session.races.push(createRaceInstance(seed, session.baseSkills, splitNow, "THREE_WAY"));
        session.races[0]!.phase = "THREE_WAY";
        session.races[1]!.phase = "THREE_WAY";
        session.phase = "THREE_WAY";
        session.phaseEnteredAt = splitNow;
      });
    });
  } else if (session.phase === "THREE_WAY") {
    if (session.finishingAt === null) {
      if (elapsed >= THREE_WAY_PHASE_MS) {
        session.finishingAt = now;
        // Scores (and the overall standings they imply) are computed NOW rather than at the end
        // of the exit sequence — the stagger order below needs them immediately, and nothing
        // reads finalScores before RESULTS actually begins anyway, so publishing it a beat early
        // is harmless.
        const scores = session.identities.map(() => 0);
        for (const race of session.races) {
          race.racers.forEach((r, rank) => {
            scores[r.identityId] = (scores[r.identityId] ?? 0) + (POINTS_BY_RANK[rank] ?? 0);
          });
        }
        session.finalScores = scores;
        const overallOrder = session.identities.map((i) => i.id).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
        session.finishStaggerRank = new Map(overallOrder.map((identityId, i) => [identityId, i]));
      }
    } else if (now - session.finishingAt >= RESULTS_EXIT_TOTAL_MS) {
      session.phase = "RESULTS";
      session.phaseEnteredAt = now;
    }
  }
}
