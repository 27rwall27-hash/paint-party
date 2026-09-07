// Loads any .svg files dropped into src/custom-shapes/ and turns each into a usable outline
// shape, keyed by filename (minus extension). Only the first <path> element(s)' geometry is
// used — fill/stroke/colors in the source SVG are ignored. See
// src/custom-shapes/example-shield.svg for a working template.
//
// If a round references more custom shapes than exist, it silently falls back to a built-in
// shape (see rounds.ts) — you never need to provide any for the game to work.

interface LoadedCustomShape {
  id: string;
  rawPath: Path2D;
  nativeCenterX: number;
  nativeCenterY: number;
  nativeHalfSize: number;
  boundingRadiusRatio: number;
}

// import.meta.glob is a Vite build-time macro — Vite's plugin only recognizes and replaces it
// when it appears as a literal `import.meta.glob(...)` call, so it must stay written exactly
// like that (no indirection through a variable). Under plain Node (e.g. the online-multiplayer
// server running via tsx) that macro was never transformed away, so calling it throws; caught
// here and treated the same as "no custom shapes provided" — every round slot then falls back
// to its built-in shape, exactly like when nobody has dropped any custom SVGs in at all.
let svgModules: Record<string, string> = {};
try {
  svgModules = import.meta.glob("/src/custom-shapes/*.svg", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
} catch {
  // running outside Vite — leave svgModules empty
}

function parseViewBox(svg: string): { minX: number; minY: number; w: number; h: number } {
  const m = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (m) {
    const parts = m[1]!.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
      return { minX: parts[0]!, minY: parts[1]!, w: parts[2]!, h: parts[3]! };
    }
  }
  return { minX: 0, minY: 0, w: 100, h: 100 };
}

function parsePathData(svg: string): string {
  const matches = [...svg.matchAll(/<path\b[^>]*\bd\s*=\s*"([^"]+)"/gi)];
  return matches.map((m) => m[1]).join(" ");
}

/**
 * Many export tools (picsvg.com among them) wrap all their <path>s in a <g transform="...">
 * rather than baking the transform into the path coordinates. Parse that transform so we don't
 * silently ignore it — an untransformed picsvg export renders 10x too big, upside down, and
 * off-canvas.
 */
function parseGroupTransform(svg: string): DOMMatrix {
  const m = svg.match(/<g\b[^>]*\btransform\s*=\s*"([^"]+)"/i);
  let matrix = new DOMMatrix();
  if (!m) return matrix;

  const fnRe = /(\w+)\s*\(([^)]*)\)/g;
  let fn: RegExpExecArray | null;
  while ((fn = fnRe.exec(m[1]!))) {
    const name = fn[1];
    const args = fn[2]!.split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n));
    if (name === "translate") {
      matrix = matrix.translate(args[0] ?? 0, args[1] ?? 0);
    } else if (name === "scale") {
      matrix = matrix.scale(args[0] ?? 1, args[1] ?? args[0] ?? 1);
    } else if (name === "rotate") {
      matrix = matrix.rotate(args[0] ?? 0);
    } else if (name === "matrix" && args.length === 6) {
      matrix = matrix.multiply(new DOMMatrix([args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!]));
    }
  }
  return matrix;
}

function transformedPath(shape: Pick<LoadedCustomShape, "rawPath" | "nativeCenterX" | "nativeCenterY" | "nativeHalfSize">, cx: number, cy: number, radius: number): Path2D {
  const matrix = new DOMMatrix()
    .translate(cx, cy)
    .scale(radius / shape.nativeHalfSize)
    .translate(-shape.nativeCenterX, -shape.nativeCenterY);
  const path = new Path2D();
  path.addPath(shape.rawPath, matrix);
  return path;
}

function measureBoundingRadiusRatio(shape: Pick<LoadedCustomShape, "rawPath" | "nativeCenterX" | "nativeCenterY" | "nativeHalfSize">): number {
  const REF = 220;
  const size = REF * 2 + 40;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return 1.15;

  const path = transformedPath(shape, size / 2, size / 2, REF);
  ctx.fillStyle = "#000";
  ctx.fill(path);
  const data = ctx.getImageData(0, 0, size, size).data;

  let maxDistSq = 0;
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      if (data[(y * size + x) * 4 + 3]! > 0) {
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxDistSq) maxDistSq = d2;
      }
    }
  }
  return Math.max(1.02, Math.sqrt(maxDistSq) / REF);
}

function parseCustomShape(filePath: string, svgText: string): LoadedCustomShape | null {
  const id = filePath.split("/").pop()!.replace(/\.svg$/i, "");
  const d = parsePathData(svgText);
  if (!d) {
    console.warn(`[custom-shapes] ${filePath}: no <path d="..."> found, skipping`);
    return null;
  }

  const vb = parseViewBox(svgText);
  const untransformed = new Path2D(d);
  const groupMatrix = parseGroupTransform(svgText);
  const rawPath = new Path2D();
  rawPath.addPath(untransformed, groupMatrix);

  const partial = {
    rawPath,
    nativeCenterX: vb.minX + vb.w / 2,
    nativeCenterY: vb.minY + vb.h / 2,
    nativeHalfSize: Math.max(vb.w, vb.h) / 2 || 50,
  };
  return { id, ...partial, boundingRadiusRatio: measureBoundingRadiusRatio(partial) };
}

const loaded: LoadedCustomShape[] = Object.entries(svgModules)
  .map(([path, text]) => parseCustomShape(path, text))
  .filter((s): s is LoadedCustomShape => s !== null)
  .sort((a, b) => a.id.localeCompare(b.id));

/** Ids of every valid custom shape found, e.g. ["example-shield", "my-logo"]. */
export const CUSTOM_SHAPE_IDS: string[] = loaded.map((s) => s.id);

const byId = new Map(loaded.map((s) => [s.id, s]));

// Per-shape size tweaks (case-sensitive, matches the filename) layered on top of whatever radius
// the round slot already assigned — for shapes whose artwork reads thin/small relative to the
// generic sizing (a tall, narrow silhouette like a tower ends up with a lot of empty space on
// its sides when scaled to fit a round slot the same way a circle would be).
const SIZE_OVERRIDES: Record<string, number> = {
  Eiffel: 1.35,
  Liberty: 1.35,
};

export function buildCustomShape(
  id: string,
  cx: number,
  cy: number,
  radius: number,
): { path: Path2D; boundingRadius: number } | null {
  const shape = byId.get(id);
  if (!shape) return null;
  const effectiveRadius = radius * (SIZE_OVERRIDES[id] ?? 1);
  return { path: transformedPath(shape, cx, cy, effectiveRadius), boundingRadius: effectiveRadius * shape.boundingRadiusRatio };
}
