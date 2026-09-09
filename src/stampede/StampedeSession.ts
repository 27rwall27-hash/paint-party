import { POINTS_BY_RANK, SINGLE_PHASE_MS, THREE_WAY_PHASE_MS, TWO_WAY_PHASE_MS } from "./constants.ts";
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
  };
}

function identityOrder(session: StampedeSession, race: RaceInstance): RacerIdentity[] {
  const byId = new Map(session.identities.map((i) => [i.id, i]));
  return race.racers.map((r) => byId.get(r.identityId)!);
}

/** `humanJumpRequests[i]` is true only on the tick a click routed to band i (see main.ts) — one
 * flag per currently-active race, same length as `session.races`. */
export function updateStampedeSession(session: StampedeSession, dt: number, now: number, humanJumpRequests: boolean[]): void {
  if (session.phase === "RESULTS") return;

  for (let i = 0; i < session.races.length; i++) {
    updateRace(session.races[i]!, dt, now, humanJumpRequests[i] ?? false);
  }

  const elapsed = now - session.phaseEnteredAt;
  if (session.phase === "SINGLE" && elapsed >= SINGLE_PHASE_MS) {
    const seed = identityOrder(session, session.races[0]!);
    session.races.push(createRaceInstance(seed, session.baseSkills, now, "TWO_WAY"));
    session.races[0]!.phase = "TWO_WAY";
    session.phase = "TWO_WAY";
    session.phaseEnteredAt = now;
  } else if (session.phase === "TWO_WAY" && elapsed >= TWO_WAY_PHASE_MS) {
    // Seeded from the SECOND race's current standings (races[1]) — the first race already seeded
    // the second at the previous split, per the confirmed rule.
    const seed = identityOrder(session, session.races[1]!);
    session.races.push(createRaceInstance(seed, session.baseSkills, now, "THREE_WAY"));
    session.races[0]!.phase = "THREE_WAY";
    session.races[1]!.phase = "THREE_WAY";
    session.phase = "THREE_WAY";
    session.phaseEnteredAt = now;
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
