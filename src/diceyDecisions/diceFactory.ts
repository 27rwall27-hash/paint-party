import * as THREE from "three";
import { DIE_SIZE } from "./constants.ts";
import type { PipCount } from "./diceGen.ts";

// Standard 1-6 pip layouts as fractional (x,y) coords within the 0..1 face square.
const PIP_LAYOUTS: Record<PipCount, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.28, 0.28],
    [0.5, 0.5],
    [0.72, 0.72],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.5, 0.5],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  6: [
    [0.28, 0.22],
    [0.72, 0.22],
    [0.28, 0.5],
    [0.72, 0.5],
    [0.28, 0.78],
    [0.72, 0.78],
  ],
};

/** Plain 2D canvas drawing — independently testable without any WebGL context. */
export function createPipCanvas(count: PipCount): HTMLCanvasElement {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f5f0e6";
  ctx.beginPath();
  ctx.roundRect(4, 4, size - 8, size - 8, 18);
  ctx.fill();
  ctx.fillStyle = "#1a1a1a";
  for (const [px, py] of PIP_LAYOUTS[count]) {
    ctx.beginPath();
    ctx.arc(px * size, py * size, size * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

// THREE.BoxGeometry's material array is consumed in a fixed order: [+X, -X, +Y, -Y, +Z, -Z]. Pips
// assigned so opposite faces sum to 7 (standard dice convention): (+X,-X)=(1,6), (+Y,-Y)=(2,5),
// (+Z,-Z)=(3,4).
const PIP_COUNT_BY_MATERIAL_INDEX: PipCount[] = [1, 6, 2, 5, 3, 4];

let cachedMaterials: THREE.Material[] | null = null;

/** Cached module-wide — every die in the scene shares the same 6 materials/textures, they're
 * just applied to differently-positioned/rotated mesh instances. */
export function createDiceMaterials(): THREE.Material[] {
  if (cachedMaterials) return cachedMaterials;
  cachedMaterials = PIP_COUNT_BY_MATERIAL_INDEX.map(
    (count) =>
      new THREE.MeshStandardMaterial({
        map: new THREE.CanvasTexture(createPipCanvas(count)),
        roughness: 0.55,
        metalness: 0.05,
      }),
  );
  return cachedMaterials;
}

export function createDieGeometry(): THREE.BoxGeometry {
  const size = DIE_SIZE * 0.94; // a hair smaller than a slot so touching dice don't z-fight
  return new THREE.BoxGeometry(size, size, size);
}

// The material-index-2 face (pip=2, see the table above) is a fresh die's default "top" (+Y).
// Bringing a specific rolled `topFace` to +Y needs this base rotation, applied BEFORE any random
// yaw spin (see applyDiePlacementRotation) so the spin never disturbs which face ends up up.
const BASE_ROTATION_FOR_TOP_FACE: Record<PipCount, THREE.Euler> = {
  1: new THREE.Euler(0, 0, Math.PI / 2),
  2: new THREE.Euler(0, 0, 0),
  3: new THREE.Euler(-Math.PI / 2, 0, 0),
  4: new THREE.Euler(Math.PI / 2, 0, 0),
  5: new THREE.Euler(Math.PI, 0, 0),
  6: new THREE.Euler(0, 0, -Math.PI / 2),
};

/** Composition order matters: the base rotation (which face is up) is applied first/innermost,
 * then the yaw spin around the WORLD vertical axis (not the object's own local Y, which no longer
 * coincides with world Y after the base rotation) so the spin can never change which face is up.
 * No extra tilt is applied — dice sit perfectly flat on the felt so the top face stays fully
 * readable at the game's near-top-down camera angle. */
export function applyDiePlacementRotation(mesh: THREE.Object3D, topFace: PipCount, yaw: number): void {
  const qBase = new THREE.Quaternion().setFromEuler(BASE_ROTATION_FOR_TOP_FACE[topFace]);
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  mesh.quaternion.multiplyQuaternions(qYaw, qBase);
}
