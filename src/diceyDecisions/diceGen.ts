import { DIE_SIZE, MAX_REROLL_ITERATIONS, OVERLAP_SAFETY_MARGIN, PLACEMENT_JITTER_FRACTION, type RoundConfig } from "./constants.ts";
import { sectionBounds, type SectionBounds } from "./layout.ts";

export type PipCount = 1 | 2 | 3 | 4 | 5 | 6;

export interface SectionData {
  index: number;
  diceValues: PipCount[];
  sum: number;
}

export interface DiePlacement {
  section: number;
  topFace: PipCount;
  localX: number;
  localZ: number;
  /** Spin around the world-vertical axis — full random, doesn't disturb which face is up. Dice
   * are placed perfectly flat (no tilt) so the top face stays clearly readable. */
  yaw: number;
  /** Uniform per-die shrink, <= 1 — only shrinks under density (see generateDicePlacements). */
  scale: number;
}

function rollDie(): PipCount {
  return (Math.floor(Math.random() * 6) + 1) as PipCount;
}

export function rollSectionDice(count: number): PipCount[] {
  return Array.from({ length: count }, rollDie);
}

function sumDice(values: PipCount[]): number {
  return values.reduce((total, v) => total + v, 0);
}

function findCollidingIndices(sections: SectionData[]): number[] {
  const bySum = new Map<number, number[]>();
  for (const s of sections) bySum.set(s.sum, [...(bySum.get(s.sum) ?? []), s.index]);
  return [...bySum.values()].filter((group) => group.length > 1).flat();
}

/** Deterministic last-resort fallback: walk sections in order, nudging one die up (or down, if
 * already maxed) one pip at a time until that section's sum is unclaimed. Always terminates —
 * each nudge strictly changes the sum by 1, and for every round config used in this game the
 * number of sections is comfortably less than the number of achievable sums (round 4's 8
 * sections vs. 16 possible 3d6 totals is the tightest case) — so by the pigeonhole principle a
 * fully-distinct assignment always exists; this just walks toward it directly instead of hoping
 * random rerolls stumble onto it. */
function forceDistinctSums(sections: SectionData[]): void {
  const used = new Set<number>();
  for (const s of sections) {
    while (used.has(s.sum)) {
      const upIndex = s.diceValues.findIndex((v) => v < 6);
      if (upIndex >= 0) {
        s.diceValues[upIndex] = (s.diceValues[upIndex]! + 1) as PipCount;
      } else {
        const downIndex = s.diceValues.findIndex((v) => v > 1);
        s.diceValues[downIndex!] = (s.diceValues[downIndex!]! - 1) as PipCount;
      }
      s.sum = sumDice(s.diceValues);
    }
    used.add(s.sum);
  }
}

/** Rolls every section's dice, then rerolls ONLY the sections whose sums collide (already-unique
 * sums are locked in permanently — "remaining work" only ever shrinks) until every sum is
 * distinct, or falls back to a deterministic nudge (see forceDistinctSums) as an absolute
 * guarantee independent of how unlucky the random rerolls were. */
export function generateSections(config: RoundConfig): SectionData[] {
  const sections: SectionData[] = Array.from({ length: config.sections }, (_, index) => {
    const diceValues = rollSectionDice(config.dicePerSection);
    return { index, diceValues, sum: sumDice(diceValues) };
  });

  for (let iter = 0; iter < MAX_REROLL_ITERATIONS; iter++) {
    const colliding = findCollidingIndices(sections);
    if (colliding.length === 0) return sections;
    for (const i of colliding) {
      const diceValues = rollSectionDice(config.dicePerSection);
      sections[i] = { index: i, diceValues, sum: sumDice(diceValues) };
    }
  }
  forceDistinctSums(sections);
  return sections;
}

export function computeWinningSection(sections: SectionData[]): number {
  return sections.reduce((best, s) => (s.sum > sections[best]!.sum ? s.index : best), 0);
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

interface Slot {
  cx: number;
  cz: number;
  w: number;
  h: number;
}

function slotGrid(n: number, width: number, depth: number): Slot[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * (width / depth))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const slotW = width / cols;
  const slotH = depth / rows;
  const slots: Slot[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({ cx: -width / 2 + slotW * (c + 0.5), cz: -depth / 2 + slotH * (r + 0.5), w: slotW, h: slotH });
    }
  }
  // Shuffled so which slots go unused (when rows*cols > n) isn't always the same corner —
  // matters for e.g. round 4's 2x2 slot grid holding only 3 dice.
  return shuffled(slots);
}

/** Procedural, non-physics placement — every die's position/rotation is randomized once per round
 * to read as "just been shaken and settled," not simulated. Dice go into a shuffled jittered grid
 * of slots sized from the section's own world-space bounds; a uniform per-section `scale` shrinks
 * every die in that section if the slot grid would otherwise be tighter than the die itself, so
 * dense rounds (2 sections x 20 dice) and sparse ones (8 sections x 3 dice) both self-adjust
 * without any per-round special-casing. */
export function generateDicePlacements(sections: SectionData[]): DiePlacement[] {
  const bounds = sectionBounds(sections.length);
  const placements: DiePlacement[] = [];
  for (const section of sections) {
    const box: SectionBounds = bounds[section.index]!;
    const slots = slotGrid(section.diceValues.length, box.width, box.depth).slice(0, section.diceValues.length);
    const tightestSlot = slots.reduce((min, s) => Math.min(min, s.w, s.h), Infinity);
    const scale = Math.min(1, tightestSlot / (DIE_SIZE * OVERLAP_SAFETY_MARGIN));

    section.diceValues.forEach((value, i) => {
      const slot = slots[i]!;
      const jitterX = Math.max(0, (slot.w - DIE_SIZE * scale) / 2) * PLACEMENT_JITTER_FRACTION;
      const jitterZ = Math.max(0, (slot.h - DIE_SIZE * scale) / 2) * PLACEMENT_JITTER_FRACTION;
      placements.push({
        section: section.index,
        topFace: value,
        localX: slot.cx + (Math.random() * 2 - 1) * jitterX,
        localZ: slot.cz + (Math.random() * 2 - 1) * jitterZ,
        yaw: Math.random() * Math.PI * 2,
        scale,
      });
    });
  }
  return placements;
}
