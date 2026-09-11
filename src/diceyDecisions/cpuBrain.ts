import { ACCURACY_MAX, ACCURACY_MIN, MIN_REACTION_MS, REACTION_FAST_MS, REACTION_JITTER, REACTION_SLOW_MS } from "./constants.ts";

export function rollCpuSkill(): number {
  return Math.random();
}

export interface CpuDiceyPlan {
  /** Elapsed ms into the PLAYING phase at which this CPU commits to its choice. */
  reactionAtOffsetMs: number;
  chosenSection: number;
}

function pickRandomOtherSection(exclude: number, sectionCount: number): number {
  const options: number[] = [];
  for (let i = 0; i < sectionCount; i++) if (i !== exclude) options.push(i);
  return options[Math.floor(Math.random() * options.length)]!;
}

/** One reaction-time + accuracy roll per round per CPU, made the instant that round enters
 * PLAYING — not re-evaluated per tick, since (unlike Light Maze's CPUs, which navigate a maze)
 * this game only ever needs a single decision per round. Higher skill means both a faster
 * reaction AND better accuracy, but accuracy never reaches 100% even at max skill — a "better"
 * CPU can still blink. */
export function createCpuDiceyPlan(skill: number, winningSection: number, sectionCount: number): CpuDiceyPlan {
  const baseReaction = REACTION_SLOW_MS + (REACTION_FAST_MS - REACTION_SLOW_MS) * skill;
  const jitter = 1 + (Math.random() * 2 - 1) * REACTION_JITTER;
  const reactionAtOffsetMs = Math.max(MIN_REACTION_MS, baseReaction * jitter);

  const accuracy = ACCURACY_MIN + (ACCURACY_MAX - ACCURACY_MIN) * skill;
  const isCorrect = Math.random() < accuracy;
  const chosenSection = isCorrect ? winningSection : pickRandomOtherSection(winningSection, sectionCount);

  return { reactionAtOffsetMs, chosenSection };
}
