import { DEFAULT_POINTS_BY_RANK } from "./constants.ts";
import { hexToRgb, type Outline } from "./Outline.ts";
import type { Player } from "./Player.ts";

export interface OutlineRankEntry {
  playerId: number;
  pixels: number;
  percent: number;
  points: number;
}

export interface OutlineResult {
  outlineIndex: number;
  kind: string;
  ranking: OutlineRankEntry[];
}

/** Counts painted pixels per player within an outline's bounding box, sorted by coverage descending. */
export function scoreOutline(
  outline: Outline,
  players: Player[],
): Array<{ playerId: number; pixels: number }> {
  const { x, y, w, h } = outline.bbox;
  const img = outline.paintCtx.getImageData(x, y, w, h);
  const data = img.data;

  const palette = players.map((p) => ({ id: p.id, rgb: hexToRgb(p.color) }));
  const counts = new Map<number, number>(players.map((p) => [p.id, 0]));

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 64) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    let bestId = -1;
    let bestDist = Infinity;
    for (const { id, rgb } of palette) {
      const dist = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        bestId = id;
      }
    }
    counts.set(bestId, (counts.get(bestId) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([playerId, pixels]) => ({ playerId, pixels }))
    .sort((a, b) => b.pixels - a.pixels);
}

export function computeRoundResults(
  outlines: Outline[],
  players: Player[],
  pointsByRank: number[] = DEFAULT_POINTS_BY_RANK,
): OutlineResult[] {
  return outlines.map((outline, outlineIndex) => {
    const coverage = scoreOutline(outline, players);
    // Only players who actually painted something compete for rank/points — an
    // untouched slot in the coverage list must never inherit a rank's points.
    const painters = coverage.filter((c) => c.pixels > 0);

    const ranking: OutlineRankEntry[] = coverage.map((entry) => {
      const rank = painters.findIndex((p) => p.playerId === entry.playerId);
      const points = rank === -1 ? 0 : (pointsByRank[rank] ?? 0);
      const percent = (entry.pixels / outline.areaPixels) * 100;
      // Scoring no longer applies immediately here — GameSession.updateResults() increments each
      // player's score live, in sync with the round-results reveal sequence.
      return { playerId: entry.playerId, pixels: entry.pixels, percent, points };
    });

    return { outlineIndex, kind: outline.kind, ranking };
  });
}
