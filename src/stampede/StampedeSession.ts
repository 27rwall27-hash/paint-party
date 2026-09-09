import { ABSOLUTE_MAX_SPLIT_WAIT_MS, POINTS_BY_RANK, PRE_SPLIT_QUIET_MS, SINGLE_PHASE_MS, THREE_WAY_PHASE_MS, TWO_WAY_PHASE_MS } from "./constants.ts";
import type { RacerIdentity } from "./identities.ts";
import { createRaceInstance, rollBaseSkill, updateRace, type RaceInstance } from "./RaceInstance.ts";

export type StampedePhase = "SINGLE" | "TWO_WAY" | "THREE_WAY" | "RESULTS";

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
}

export function createStampedeSession(identities: RacerIdentity[], now: number): StampedeSession {
  const baseSkills = new Map<number, number>();
  for (const identity of identities) {
    if (identity.isBot) baseSkills.set(identity.id, rollBaseSkill());
  }
  return {
    phase: "SINGLE",
    phaseEnteredAt: now,
    identities,
    races: [createRaceInstance(identities, baseSkills, now, "SINGLE")],
    baseSkills,
    finalScores: null,
    pendingSplitAt: null,
    clearSinceAt: null,
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
 * `doSplit()` actually runs. ABSOLUTE_MAX_SPLIT_WAIT_MS is a defensive-only ceiling on the whole
 * thing, not expected to matter given spawning is suppressed rather than waited-out. */
function maybeSplit(session: StampedeSession, now: number, elapsed: number, phaseDurationMs: number, doSplit: () => void): void {
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
    doSplit();
  }
}

/** `humanJumpRequests[i]` is true only on the tick a click routed to band i (see main.ts) — one
 * flag per currently-active race, same length as `session.races`. */
export function updateStampedeSession(session: StampedeSession, dt: number, now: number, humanJumpRequests: boolean[]): void {
  if (session.phase === "RESULTS") return;

  const suppressSpawns = session.pendingSplitAt !== null;
  for (let i = 0; i < session.races.length; i++) {
    updateRace(session.races[i]!, dt, now, humanJumpRequests[i] ?? false, suppressSpawns);
  }

  const elapsed = now - session.phaseEnteredAt;
  if (session.phase === "SINGLE") {
    maybeSplit(session, now, elapsed, SINGLE_PHASE_MS, () => {
      const seed = identityOrder(session, session.races[0]!);
      session.races.push(createRaceInstance(seed, session.baseSkills, now, "TWO_WAY"));
      session.races[0]!.phase = "TWO_WAY";
      session.phase = "TWO_WAY";
      session.phaseEnteredAt = now;
    });
  } else if (session.phase === "TWO_WAY") {
    // Seeded from the SECOND race's current standings (races[1]) — the first race already seeded
    // the second at the previous split, per the confirmed rule.
    maybeSplit(session, now, elapsed, TWO_WAY_PHASE_MS, () => {
      const seed = identityOrder(session, session.races[1]!);
      session.races.push(createRaceInstance(seed, session.baseSkills, now, "THREE_WAY"));
      session.races[0]!.phase = "THREE_WAY";
      session.races[1]!.phase = "THREE_WAY";
      session.phase = "THREE_WAY";
      session.phaseEnteredAt = now;
    });
  } else if (session.phase === "THREE_WAY" && elapsed >= THREE_WAY_PHASE_MS) {
    const scores = session.identities.map(() => 0);
    for (const race of session.races) {
      race.racers.forEach((r, rank) => {
        scores[r.identityId] = (scores[r.identityId] ?? 0) + (POINTS_BY_RANK[rank] ?? 0);
      });
    }
    session.finalScores = scores;
    session.phase = "RESULTS";
    session.phaseEnteredAt = now;
  }
}
