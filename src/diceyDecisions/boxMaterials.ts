import * as THREE from "three";
import { BOX_CLEARCOAT, BOX_CLEARCOAT_ROUGHNESS, BOX_ROUGHNESS, WOOD_COLOR, WOOD_DARK_COLOR } from "./constants.ts";

const WOOD_LIGHT = "#6e3320"; // a lighter mahogany-brown, for grain highlight streaks — warm, not pink
const BRASS = "#c9a227";

function hexToCss(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

/** Procedural wood grain: a base mahogany fill plus many soft wavy streaks (some darker, some
 * lighter) — no external texture assets, same "synthesize everything" approach the rest of the
 * suite already uses for sound. No knots/blotches: at this size they read as dirty spots rather
 * than wood character, so grain stays to clean directional streaks only. */
function drawWoodGrain(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = hexToCss(WOOD_COLOR);
  ctx.fillRect(0, 0, width, height);

  const streakCount = 46;
  for (let i = 0; i < streakCount; i++) {
    const y = (i / streakCount) * height + (Math.random() - 0.5) * height * 0.035;
    ctx.strokeStyle = Math.random() < 0.5 ? hexToCss(WOOD_DARK_COLOR) : WOOD_LIGHT;
    ctx.globalAlpha = 0.07 + Math.random() * 0.11;
    ctx.lineWidth = 1 + Math.random() * 2.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    const cx1 = width * 0.33;
    const cy1 = y + (Math.random() - 0.5) * height * 0.08;
    const cx2 = width * 0.66;
    const cy2 = y + (Math.random() - 0.5) * height * 0.08;
    ctx.bezierCurveTo(cx1, cy1, cx2, cy2, width, y + (Math.random() - 0.5) * height * 0.05);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function fitCursiveFontSize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startPx: number): number {
  let size = startPx;
  while (size > 24) {
    ctx.font = `italic 700 ${size}px "Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 4;
  }
  return size;
}

/** The lid's top face — wood grain plus a brass corner/border accent and a cursive "Round N"
 * engraved into the wood (a dark carved-in fill with a light offset highlight and a dark offset
 * shadow, so the grain still reads through it rather than looking painted on top). */
function createLidTopCanvas(roundNumber: number): HTMLCanvasElement {
  const width = 720;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  drawWoodGrain(ctx, width, height);

  const inset = width * 0.035;
  ctx.strokeStyle = BRASS;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3;
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  ctx.lineWidth = 1;
  ctx.strokeRect(inset + 7, inset + 7, width - (inset + 7) * 2, height - (inset + 7) * 2);
  ctx.globalAlpha = 1;
  const cornerR = 9;
  for (const [cx, cy] of [
    [inset, inset],
    [width - inset, inset],
    [inset, height - inset],
    [width - inset, height - inset],
  ]) {
    ctx.fillStyle = BRASS;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(cx, cy, cornerR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const text = `Round ${roundNumber}`;
  const cx = width / 2;
  const cy = height / 2;
  const fontSize = fitCursiveFontSize(ctx, text, width * 0.78, height * 0.3);
  ctx.font = `italic 700 ${fontSize}px "Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(20,5,8,0.65)";
  ctx.fillText(text, cx + 3, cy + 3);
  ctx.fillStyle = "rgba(255,225,200,0.35)";
  ctx.fillText(text, cx - 2, cy - 2);
  ctx.fillStyle = "rgba(20,8,10,0.55)";
  ctx.fillText(text, cx, cy);

  return canvas;
}

function createGrainTexture(repeatX: number, repeatY: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  drawWoodGrain(canvas.getContext("2d")!, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

/** Plain wood — used for every box surface that isn't the lid's engraved top face. The clearcoat
 * layer is what gives the "gleam": a thin glossy varnish coat over the grain, picking up a bright
 * specular highlight from the key light without needing an environment map. */
export function createWoodMaterial(repeatX = 2, repeatY = 1.4): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: createGrainTexture(repeatX, repeatY),
    roughness: BOX_ROUGHNESS,
    metalness: 0,
    clearcoat: BOX_CLEARCOAT,
    clearcoatRoughness: BOX_CLEARCOAT_ROUGHNESS,
  });
}

function disposeMaterial(mat: THREE.Material): void {
  const withMap = mat as THREE.MeshPhysicalMaterial;
  withMap.map?.dispose();
  mat.dispose();
}

/** 6-entry material array matching THREE.BoxGeometry's fixed face order [+X,-X,+Y,-Y,+Z,-Z] — the
 * +Y (top) face gets the round-specific engraved texture, the other 5 share one plain wood
 * material. Call disposeLidMaterials on the PREVIOUS array before replacing it each round. */
export function createLidMaterials(roundNumber: number): THREE.Material[] {
  const side = createWoodMaterial(1.6, 1);
  const top = new THREE.MeshPhysicalMaterial({
    map: new THREE.CanvasTexture(createLidTopCanvas(roundNumber)),
    roughness: BOX_ROUGHNESS,
    metalness: 0,
    clearcoat: BOX_CLEARCOAT,
    clearcoatRoughness: BOX_CLEARCOAT_ROUGHNESS,
  });
  return [side, side, top, side, side, side];
}

export function disposeLidMaterials(materials: THREE.Material[]): void {
  const seen = new Set<THREE.Material>();
  for (const mat of materials) {
    if (seen.has(mat)) continue;
    seen.add(mat);
    disposeMaterial(mat);
  }
}
