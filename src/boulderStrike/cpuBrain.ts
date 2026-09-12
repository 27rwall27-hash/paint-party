import { ACCURACY_MAX, ACCURACY_MIN, PRECISION_SKEW_MAX, PRECISION_SKEW_MIN } from "./constants.ts";
import type { RoundState } from "./BoulderStrikeSession.ts";

export function rollCpuSkill(): number {
  return Math.random();
}

export interface CpuReleasePlan {
  /** Absolute timestamp to release at, or null if this CPU never releases at all this round
   * (a "timid" miss, as opposed to releasing during a decoy). */
  releaseAt: number | null;
}

/** A CPU "catches" the real target with probability = accuracy (skill-scaled) — on a hit, it
 * releases somewhere inside the target's valid window, skewed toward the very start the higher
 * its skill (better reflexes = closer to instant). On a miss, it's a coin flip between releasing
 * during a random decoy (mistimed) or never releasing at all (too hesitant). */
export function planCpuRelease(skill: number, round: RoundState): CpuReleasePlan {
  const accuracy = ACCURACY_MIN + (ACCURACY_MAX - ACCURACY_MIN) * skill;
  const targetEntry = round.sequence.find((e) => e.isTarget)!;

  if (Math.random() < accuracy) {
    const skew = PRECISION_SKEW_MIN + (PRECISION_SKEW_MAX - PRECISION_SKEW_MIN) * skill;
    const t = Math.pow(Math.random(), skew); // skewed toward 0 as skill rises
    const windowLen = targetEntry.endAt - targetEntry.startAt;
    return { releaseAt: targetEntry.startAt + t * windowLen };
  }

  if (Math.random() < 0.5) return { releaseAt: null };

  const decoys = round.sequence.filter((e) => !e.isTarget);
  const decoy = decoys[Math.floor(Math.random() * decoys.length)]!;
  const decoyT = Math.random();
  return { releaseAt: decoy.startAt + decoyT * (decoy.endAt - decoy.startAt) };
}
