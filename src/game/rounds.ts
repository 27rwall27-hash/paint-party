import { CANVAS_H, CANVAS_W, CUSTOM_SHAPE_SIZE_BOOST, FINALE_POINTS_BY_RANK } from "./constants.ts";
import { CUSTOM_SHAPE_IDS } from "./customShapes.ts";
import type { OutlineSpec } from "./Outline.ts";
import type { ShapeKind } from "./shapes.ts";

export interface RoundConfig {
  outlines: OutlineSpec[];
  powerupCountRange: [number, number];
  /** How many power-ups may be active on screen at the same time — grows round to round. */
  concurrentPowerups: number;
  durationMs: number;
  pointsByRank?: number[];
}

/**
 * Rejection-samples `count` non-overlapping small outlines across the canvas, for the chaos
 * finale. `radiusMultipliers` lets specific kinds (usually thin custom shapes that read as
 * "crunched" at the finale's tiny base size) render a bit bigger than the rest.
 */
function scatterOutlines(
  count: number,
  radius: number,
  kinds: ShapeKind[],
  radiusMultipliers: Record<string, number> = {},
): OutlineSpec[] {
  const maxMultiplier = Math.max(1, ...Object.values(radiusMultipliers));
  const margin = radius * maxMultiplier + 50; // keep clear of the thick picture frame around the canvas edge
  const placed: OutlineSpec[] = [];
  for (let i = 0; i < count; i++) {
    const kind = kinds[i % kinds.length]!;
    const shapeRadius = radius * (radiusMultipliers[kind] ?? 1);
    for (let attempt = 0; attempt < 300; attempt++) {
      const x = margin + Math.random() * (CANVAS_W - margin * 2);
      const y = margin + Math.random() * (CANVAS_H - margin * 2);
      const tooClose = placed.some((p) => Math.hypot(p.cx - x, p.cy - y) < p.radius + shapeRadius + 8);
      if (!tooClose) {
        placed.push({ kind, cx: x, cy: y, radius: shapeRadius });
        break;
      }
    }
  }
  return placed;
}

const CX = CANVAS_W / 2;
const CY = CANVAS_H / 2;

// Custom shapes dropped into src/custom-shapes/ get worked into EVERY round below, one slot at a
// time in reading order (round 1's outlines first, then round 2's, and so on). Any slot that
// runs out of custom shapes falls back to its original built-in shape — you never need to
// provide any for the game to work, and providing just one or two still does something useful.
// A slot that actually gets a custom shape is sized up (see CUSTOM_SHAPE_SIZE_BOOST) since
// custom art tends to read better a bit bigger; the finale's scatter is deliberately excluded
// from that boost so nothing there ends up oversized among 30 small shapes.
let customCursor = 0;
function nextSlot(
  fallback: ShapeKind,
  cx: number,
  cy: number,
  baseRadius: number,
  widthScale?: number,
  heightScale?: number,
): OutlineSpec {
  const custom = CUSTOM_SHAPE_IDS[customCursor++];
  if (custom) return { kind: custom, cx, cy, radius: baseRadius * CUSTOM_SHAPE_SIZE_BOOST, widthScale, heightScale };
  return { kind: fallback, cx, cy, radius: baseRadius, widthScale, heightScale };
}

const FINALE_KINDS: ShapeKind[] = ["circle", "triangle", "star", "heart", "diamond", ...CUSTOM_SHAPE_IDS];

export const ROUNDS: RoundConfig[] = [
  {
    outlines: [
      nextSlot("circle", 340, 260, 119, 1.25),
      nextSlot("circle", 940, 260, 119, 1.25),
      nextSlot("circle", CX, 520, 119, 1.25),
    ],
    powerupCountRange: [1, 2],
    concurrentPowerups: 1,
    durationMs: 32000,
  },
  {
    outlines: [
      nextSlot("star", CX, CY, 96.8, 1.25, 1.25), // center accent — kept distinct from the corner triangles
      nextSlot("triangle", 300, 210, 103.4, 1.25, 1.25),
      nextSlot("triangle", 980, 210, 103.4, 1.25, 1.25),
      nextSlot("triangle", 300, 530, 103.4, 1.25, 1.25),
      nextSlot("triangle", 980, 530, 103.4, 1.25, 1.25),
    ],
    powerupCountRange: [2, 3],
    concurrentPowerups: 2,
    durationMs: 34000,
  },
  {
    // A straight 2x2 grid was the most boring layout in the game — swapped for a wide zigzag so
    // the four targets are staggered instead of aligned, and sized up like everything else.
    outlines: [
      nextSlot("heart", 210, 245, 144),
      nextSlot("diamond", 497, 465, 144),
      nextSlot("heart", 783, 245, 144),
      nextSlot("diamond", 1070, 465, 144),
    ],
    powerupCountRange: [3, 5],
    concurrentPowerups: 3,
    durationMs: 38000,
  },
  {
    outlines: [{ kind: "rectangle", cx: CX, cy: CY, radius: 0, width: CANVAS_W - 160, height: CANVAS_H - 180 }],
    powerupCountRange: [4, 6],
    concurrentPowerups: 3,
    durationMs: 30000,
  },
  {
    outlines: scatterOutlines(30, 26, FINALE_KINDS, { Eiffel: 1.1, Pisa: 1.5 }),
    powerupCountRange: [12, 18],
    concurrentPowerups: 5,
    durationMs: 45000,
    pointsByRank: FINALE_POINTS_BY_RANK,
  },
];
