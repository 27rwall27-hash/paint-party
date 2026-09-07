import { buildCustomShape } from "./customShapes.ts";

/** Built-in kinds, or any id discovered in src/custom-shapes/ (filename minus .svg). */
export type ShapeKind = string;

export const BUILTIN_SHAPE_KINDS = ["circle", "triangle", "star", "heart", "diamond"] as const;

export interface BuiltShape {
  path: Path2D;
  /** Radius of a circle guaranteed to fully contain the shape, for cheap overlap checks. */
  boundingRadius: number;
}

function polygonPath(cx: number, cy: number, points: Array<[number, number]>): Path2D {
  const path = new Path2D();
  points.forEach(([px, py], i) => {
    const x = cx + px;
    const y = cy + py;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  path.closePath();
  return path;
}

function triangle(cx: number, cy: number, radius: number): Path2D {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 3; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return polygonPath(cx, cy, points);
}

function star(cx: number, cy: number, radius: number): Path2D {
  const inner = radius * 0.45;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push([Math.cos(angle) * r, Math.sin(angle) * r]);
  }
  return polygonPath(cx, cy, points);
}

function diamond(cx: number, cy: number, radius: number): Path2D {
  return polygonPath(cx, cy, [
    [0, -radius],
    [radius, 0],
    [0, radius],
    [-radius, 0],
  ]);
}

function heart(cx: number, cy: number, radius: number): Path2D {
  const path = new Path2D();
  const s = radius / 16;
  path.moveTo(cx, cy + 12 * s);
  path.bezierCurveTo(cx - 16 * s, cy - 2 * s, cx - 14 * s, cy - 16 * s, cx, cy - 6 * s);
  path.bezierCurveTo(cx + 14 * s, cy - 16 * s, cx + 16 * s, cy - 2 * s, cx, cy + 12 * s);
  path.closePath();
  return path;
}

function circle(cx: number, cy: number, radius: number): Path2D {
  const path = new Path2D();
  path.arc(cx, cy, radius, 0, Math.PI * 2);
  return path;
}

function rectangle(cx: number, cy: number, width: number, height: number): Path2D {
  const path = new Path2D();
  path.rect(cx - width / 2, cy - height / 2, width, height);
  return path;
}

/** Builds a polygon from points authored in a -100..100 design box, scaled so the box maps to `radius`. */
function designPolygon(cx: number, cy: number, radius: number, points: Array<[number, number]>): Path2D {
  const s = radius / 100;
  return polygonPath(cx, cy, points.map(([x, y]) => [x * s, y * s]));
}

// Simplified silhouette: robed figure, spiked crown, arm raised holding a torch aloft.
const STATUE_POINTS: Array<[number, number]> = [
  [0, -92], [8, -84], [14, -90], [16, -80], [14, -68], [10, -60],
  [16, -54], [22, -60], [30, -74], [36, -88], [40, -98], [46, -104],
  [40, -108], [34, -100], [30, -92], [26, -84], [20, -68], [14, -52],
  [22, -20], [34, 20], [44, 60], [50, 92], [50, 100], [-50, 100],
  [-50, 92], [-44, 60], [-34, 20], [-22, -20], [-14, -52], [-10, -60],
  [-14, -68], [-16, -80], [-14, -90], [-8, -84],
];

// Simplified silhouette: tapering lattice tower with two tier "kinks".
const EIFFEL_POINTS: Array<[number, number]> = [
  [3, -100], [9, -68], [19, -38], [13, -36], [32, 14], [21, 17], [50, 95],
  [-50, 95], [-21, 17], [-32, 14], [-13, -36], [-19, -38], [-9, -68], [-3, -100],
];

function statue(cx: number, cy: number, radius: number): Path2D {
  return designPolygon(cx, cy, radius, STATUE_POINTS);
}

function eiffel(cx: number, cy: number, radius: number): Path2D {
  return designPolygon(cx, cy, radius, EIFFEL_POINTS);
}

// Simplified portrait-bust silhouette: a round head merged with sloped shoulders underneath
// (two overlapping subpaths — the nonzero fill rule unions them into one solid silhouette).
function monalisa(cx: number, cy: number, radius: number): Path2D {
  const s = radius / 100;
  const path = new Path2D();
  path.ellipse(cx, cy - 58 * s, 34 * s, 40 * s, 0, 0, Math.PI * 2);

  const shoulderPts: Array<[number, number]> = [
    [-46, -40],
    [46, -40],
    [68, 40],
    [64, 100],
    [-64, 100],
    [-68, 40],
  ];
  shoulderPts.forEach(([x, y], i) => {
    const px = cx + x * s;
    const py = cy + y * s;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  });
  path.closePath();
  return path;
}

/**
 * A rounded, organic paint blob — a handful of smooth lobes bulging outward from a full circle
 * of `radius`, never pinching in below it. That guarantees the core always reads as a complete
 * filled circle (matching what the charging cursor showed) with a few soft bumps on top, rather
 * than a jagged starburst with gaps in it.
 */
export function buildSplatBlob(cx: number, cy: number, radius: number, variance: number, lobes: number): Path2D {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < lobes; i++) {
    const angle = (i / lobes) * Math.PI * 2;
    const r = radius * (1 + Math.random() * variance);
    pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }

  const path = new Path2D();
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[lobes - 1]!, pts[0]!);
  path.moveTo(start[0], start[1]);
  for (let i = 0; i < lobes; i++) {
    const cur = pts[i]!;
    const next = pts[(i + 1) % lobes]!;
    const m = mid(cur, next);
    path.quadraticCurveTo(cur[0], cur[1], m[0], m[1]);
  }
  path.closePath();
  return path;
}

export function buildShape(
  kind: ShapeKind,
  cx: number,
  cy: number,
  radius: number,
  size?: { width: number; height: number },
): BuiltShape {
  switch (kind) {
    case "triangle":
      return { path: triangle(cx, cy, radius), boundingRadius: radius * 1.05 };
    case "star":
      return { path: star(cx, cy, radius), boundingRadius: radius * 1.05 };
    case "diamond":
      return { path: diamond(cx, cy, radius), boundingRadius: radius * 1.05 };
    case "heart":
      return { path: heart(cx, cy, radius), boundingRadius: radius * 1.15 };
    case "statue":
      return { path: statue(cx, cy, radius), boundingRadius: radius * 1.15 };
    case "eiffel":
      return { path: eiffel(cx, cy, radius), boundingRadius: radius * 1.05 };
    case "monalisa":
      return { path: monalisa(cx, cy, radius), boundingRadius: radius * 1.2 };
    case "rectangle": {
      const w = size?.width ?? radius * 2;
      const h = size?.height ?? radius * 2;
      return { path: rectangle(cx, cy, w, h), boundingRadius: Math.hypot(w, h) / 2 };
    }
    case "circle":
      return { path: circle(cx, cy, radius), boundingRadius: radius * 1.05 };
    default: {
      const custom = buildCustomShape(kind, cx, cy, radius);
      if (custom) return custom;
      return { path: circle(cx, cy, radius), boundingRadius: radius * 1.05 };
    }
  }
}
