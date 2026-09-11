import { ACCURACY_MAX, ACCURACY_MIN, DECIDE_FAST_MS, DECIDE_JITTER, DECIDE_SLOW_MS } from "./constants.ts";
import type { ShelfSlot } from "./CauldronChaosSession.ts";

export function rollCpuSkill(): number {
  return Math.random();
}

export interface CpuPickPlan {
  slotId: number;
  decideMs: number;
}

/** A CPU "remembers" the called list with probability = accuracy (skill-scaled) — on a hit it
 * walks toward a genuinely still-safe bottle; on a miss it just grabs whatever's nearest to hand
 * off the shelf, which occasionally still turns out to be safe by luck (same as a real player
 * guessing). Higher skill also means a shorter pause deciding before it sets off. */
export function decideCpuPick(
  skill: number,
  shelfSlots: ShelfSlot[],
  usedSlotIds: number[],
  remainingSafeCountByType: Record<number, number>,
): CpuPickPlan {
  const accuracy = ACCURACY_MIN + (ACCURACY_MAX - ACCURACY_MIN) * skill;
  const baseDecide = DECIDE_SLOW_MS + (DECIDE_FAST_MS - DECIDE_SLOW_MS) * skill;
  const jitter = 1 + (Math.random() * 2 - 1) * DECIDE_JITTER;
  const decideMs = Math.max(150, baseDecide * jitter);

  const available = shelfSlots.filter((s) => !usedSlotIds.includes(s.slotId));
  const safeAvailable = available.filter((s) => (remainingSafeCountByType[s.typeId] ?? 0) > 0);
  const remembersCorrectly = Math.random() < accuracy && safeAvailable.length > 0;
  const pickFrom = remembersCorrectly ? safeAvailable : available;
  const slotId = pickFrom[Math.floor(Math.random() * pickFrom.length)]!.slotId;

  return { slotId, decideMs };
}
