import { FLOOR_DEPTH, FLOOR_WIDTH, PEG_HOLE_MARGIN_FRACTION } from "./constants.ts";

export interface GridShape {
  cols: number;
  rows: number;
}

/** Explicit lookup rather than a general factorization search — every ROUND_CONFIGS section
 * count was deliberately chosen (see constants.ts) to factor into a clean, gapless grid, so
 * there's no need for an approximate "closest to a square" algorithm that could leave leftover
 * cells. Falls back to a single row for anything unlisted rather than silently misrendering. */
const SECTION_GRID_SHAPES: Record<number, GridShape> = {
  2: { cols: 2, rows: 1 },
  4: { cols: 2, rows: 2 },
  6: { cols: 3, rows: 2 },
  8: { cols: 4, rows: 2 },
  9: { cols: 3, rows: 3 },
};

export function sectionGridShape(sectionCount: number): GridShape {
  return SECTION_GRID_SHAPES[sectionCount] ?? { cols: sectionCount, rows: 1 };
}

export interface SectionBounds {
  index: number;
  cx: number;
  cz: number;
  width: number;
  depth: number;
}

/** World-space (box floor) bounds for every section of a round with this many sections — shared
 * by both dice placement (diceGen.ts) and scene building (sceneBuilder.ts), the same role
 * grid.ts plays for both session and render in Light Maze. */
export function sectionBounds(sectionCount: number): SectionBounds[] {
  const { cols, rows } = sectionGridShape(sectionCount);
  const cellW = FLOOR_WIDTH / cols;
  const cellD = FLOOR_DEPTH / rows;
  const bounds: SectionBounds[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (bounds.length >= sectionCount) break;
      bounds.push({
        index: bounds.length,
        cx: -FLOOR_WIDTH / 2 + cellW * (c + 0.5),
        cz: -FLOOR_DEPTH / 2 + cellD * (r + 0.5),
        width: cellW,
        depth: cellD,
      });
    }
  }
  return bounds;
}

/** The 4 peg-hole X positions along a section's own north wall, left to right on screen (+X is
 * screen-right for this game's fixed camera — see sceneBuilder.ts). Shared by both the render
 * layer (drawing the holes/pegs) and anything that needs to reason about hole positions without
 * touching three.js. */
export function sectionPegHoleXs(bounds: SectionBounds): number[] {
  const margin = bounds.width * PEG_HOLE_MARGIN_FRACTION;
  const usable = bounds.width - margin * 2;
  return [0, 1, 2, 3].map((i) => bounds.cx - usable / 2 + (usable * i) / 3);
}
