import { CANVAS_W, SHELF_COLS } from "./constants.ts";

export interface BottleSlot {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const SHELF_AREA_X = 130;
const SHELF_AREA_Y = 610;
const SHELF_AREA_W = CANVAS_W - 260;
const SHELF_AREA_H = 330;

/** Grid position for every pool ingredient's shelf bottle — shared by render.ts (drawing) and
 * main.ts (click hit-testing) so they can never drift out of sync. Pure/DOM-free. */
export function shelfLayout(poolIds: number[]): BottleSlot[] {
  const cols = SHELF_COLS;
  const rows = Math.ceil(poolIds.length / cols);
  const cellW = SHELF_AREA_W / cols;
  const cellH = SHELF_AREA_H / rows;
  const w = cellW * 0.7;
  const h = cellH * 0.82;
  return poolIds.map((id, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      id,
      x: SHELF_AREA_X + col * cellW + (cellW - w) / 2,
      y: SHELF_AREA_Y + row * cellH + (cellH - h) / 2,
      w,
      h,
    };
  });
}
