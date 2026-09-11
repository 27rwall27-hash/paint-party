import { ACCURACY_MAX, ACCURACY_MIN, THINK_FAST_MS, THINK_JITTER, THINK_SLOW_MS } from "./constants.ts";

export function rollCpuSkill(): number {
  return Math.random();
}

export interface CpuPickPlan {
  ingredientId: number;
  thinkMs: number;
}

/** A CPU "remembers" the called list with probability = accuracy (skill-scaled) — on a hit it
 * pours something genuinely still-safe; on a miss it just grabs a random bottle off the shelf,
 * which occasionally still turns out to be safe by luck (same as a real player guessing). Higher
 * skill also means committing to the pour faster, not just more accurately. */
export function decideCpuPick(skill: number, remainingSafeIds: number[], poolIds: number[]): CpuPickPlan {
  const accuracy = ACCURACY_MIN + (ACCURACY_MAX - ACCURACY_MIN) * skill;
  const baseThink = THINK_SLOW_MS + (THINK_FAST_MS - THINK_SLOW_MS) * skill;
  const jitter = 1 + (Math.random() * 2 - 1) * THINK_JITTER;
  const thinkMs = Math.max(300, baseThink * jitter);

  const remembersCorrectly = Math.random() < accuracy && remainingSafeIds.length > 0;
  const ingredientId = remembersCorrectly
    ? remainingSafeIds[Math.floor(Math.random() * remainingSafeIds.length)]!
    : poolIds[Math.floor(Math.random() * poolIds.length)]!;

  return { ingredientId, thinkMs };
}
