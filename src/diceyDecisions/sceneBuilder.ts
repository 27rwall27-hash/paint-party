import * as THREE from "three";
import {
  AMBIENT_LIGHT_INTENSITY,
  CAMERA_BACK,
  CAMERA_FOV,
  CAMERA_HEIGHT,
  CANVAS_H,
  CANVAS_W,
  DIVIDER_HEIGHT,
  DIVIDER_THICKNESS,
  ENVIRONMENT_INTENSITY,
  FELT_COLOR,
  FELT_COLOR_HOVER,
  FLOOR_DEPTH,
  FLOOR_THICKNESS,
  FLOOR_WIDTH,
  KEY_LIGHT_INTENSITY,
  LID_CLOSE_DURATION_MS,
  LID_OPEN_ANGLE_RAD,
  LID_OPEN_DURATION_MS,
  PEG_HOLE_RADIUS,
  PEG_LENGTH,
  PEG_RADIUS,
  PEG_WALL_GAP,
  PEG_WALL_HEIGHT,
  PEG_WALL_THICKNESS,
  SHADOWS_ENABLED,
  SHAKE_AMPLITUDE_X,
  SHAKE_AMPLITUDE_Z,
  SHAKE_ROT_AMPLITUDE_RAD,
  SHAKING_DURATION_MS,
  SLIDE_DISTANCE,
  SLIDE_DURATION_MS,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WINNING_EMISSIVE,
  WOOD_DARK_COLOR,
} from "./constants.ts";
import { applyDiePlacementRotation, createDiceMaterials, createDieGeometry } from "./diceFactory.ts";
import { createLidMaterials, createWoodMaterial, disposeLidMaterials } from "./boxMaterials.ts";
import { sectionBounds, sectionGridShape, sectionPegHoleXs, type SectionBounds } from "./layout.ts";
import { computeSectionAssignments, type DiceyDecisionsSession } from "./DiceyDecisionsSession.ts";

interface FloorSectionMesh extends THREE.Mesh {
  material: THREE.MeshStandardMaterial;
}

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Everything box-related (base/walls/lid/dividers/felt/dice/peg boards/pegs) hangs off this one
   * group so the whole box can slide as a unit — lights and the camera stay outside it. */
  boxRoot: THREE.Group;
  floorSectionMeshes: FloorSectionMesh[];
  dividerGroup: THREE.Group;
  diceGroup: THREE.Group;
  pegWallGroup: THREE.Group;
  lidGroup: THREE.Group;
  lidMesh: THREE.Mesh;
  pegMeshes: THREE.Mesh[];
  /** Identity of the last RoundState this context built section/divider/dice/peg-board geometry
   * for — a new round object (created fresh by createRoundState every SLIDING_IN/SLIDING_OUT
   * transition) means it all needs rebuilding; the same round object means it's still current. */
  cachedRound: DiceyDecisionsSession["round"] | null;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function flatMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05 });
}

/** A tall, thin canvas stretched to a smooth vertical gradient (deep violet -> plum -> warm gold)
 * — a single soft blend, not a repeating texture, so it reads as "fun backdrop" rather than dark
 * emptiness or a tiled pattern. */
function createBackgroundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#2c1854");
  gradient.addColorStop(0.5, "#8a2f6e");
  gradient.addColorStop(1, "#ffb648");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A glossy clearcoat only picks up a tiny hotspot from a single directional light — without
 * something to actually reflect, "shiny" reads as flat. This builds a small equirectangular
 * "studio" environment and prefilters it via PMREMGenerator into scene.environment, so every
 * clearcoat/PBR surface in the box gets real reflections instead of one thin glint. A dark base
 * (for contrast) plus a few small, near-white, tightly-bounded "window" highlights — not broad
 * soft glows — is what actually reads as high-gloss lacquer rather than a satin sheen. */
function createEnvironmentTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#4a3f52");
  sky.addColorStop(0.45, "#2c2436");
  sky.addColorStop(1, "#0a0712");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const [x, y, r, alpha] of [
    [140, 40, 22, 1],
    [360, 60, 16, 1],
    [256, 20, 30, 1],
    [70, 130, 12, 0.9],
    [430, 150, 14, 0.9],
  ] as const) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, `rgba(255,255,255,${alpha})`);
    glow.addColorStop(0.5, `rgba(255,242,222,${alpha * 0.55})`);
    glow.addColorStop(1, "rgba(255,242,222,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createEnvironmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const equirect = createEnvironmentTexture();
  const renderTarget = pmremGenerator.fromEquirectangular(equirect);
  equirect.dispose();
  pmremGenerator.dispose();
  return renderTarget.texture;
}

function buildStaticBox(boxRoot: THREE.Group): void {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(FLOOR_WIDTH + WALL_THICKNESS * 2, FLOOR_THICKNESS, FLOOR_DEPTH + WALL_THICKNESS * 2),
    flatMaterial(WOOD_DARK_COLOR),
  );
  base.position.y = -FLOOR_THICKNESS / 2;
  base.receiveShadow = true;
  boxRoot.add(base);

  const wallMat = createWoodMaterial();
  const sideWallGeo = new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, FLOOR_DEPTH + WALL_THICKNESS * 2);
  const endWallGeo = new THREE.BoxGeometry(FLOOR_WIDTH + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS);

  const leftWall = new THREE.Mesh(sideWallGeo, wallMat);
  leftWall.position.set(-FLOOR_WIDTH / 2 - WALL_THICKNESS / 2, WALL_HEIGHT / 2, 0);
  const rightWall = new THREE.Mesh(sideWallGeo, wallMat);
  rightWall.position.set(FLOOR_WIDTH / 2 + WALL_THICKNESS / 2, WALL_HEIGHT / 2, 0);
  const frontWall = new THREE.Mesh(endWallGeo, wallMat);
  frontWall.position.set(0, WALL_HEIGHT / 2, FLOOR_DEPTH / 2 + WALL_THICKNESS / 2);
  const backWall = new THREE.Mesh(endWallGeo, wallMat);
  backWall.position.set(0, WALL_HEIGHT / 2, -FLOOR_DEPTH / 2 - WALL_THICKNESS / 2);

  for (const wall of [leftWall, rightWall, frontWall, backWall]) {
    wall.castShadow = true;
    wall.receiveShadow = true;
    boxRoot.add(wall);
  }
}

function buildLid(boxRoot: THREE.Group, roundNumber: number): { lidGroup: THREE.Group; lidMesh: THREE.Mesh } {
  const lidGroup = new THREE.Group();
  // Hinged at the back wall's top edge (world -Z, the far side from the camera) — opening rotates
  // the lid's free edge up and back over the box, per the standard treasure-chest hinge convention.
  lidGroup.position.set(0, WALL_HEIGHT, -FLOOR_DEPTH / 2 - WALL_THICKNESS / 2);

  const lidMesh = new THREE.Mesh(
    new THREE.BoxGeometry(FLOOR_WIDTH + WALL_THICKNESS * 2, WALL_THICKNESS, FLOOR_DEPTH + WALL_THICKNESS * 2),
    createLidMaterials(roundNumber),
  );
  lidMesh.position.set(0, WALL_THICKNESS / 2, (FLOOR_DEPTH + WALL_THICKNESS * 2) / 2);
  lidMesh.castShadow = true;
  lidMesh.receiveShadow = true;
  lidGroup.add(lidMesh);

  boxRoot.add(lidGroup);
  return { lidGroup, lidMesh };
}

function buildPegs(boxRoot: THREE.Group, session: DiceyDecisionsSession): THREE.Mesh[] {
  // A cylinder's default orientation already stands along +Y — no rotation needed, it just stands
  // straight up out of its hole like a golf tee.
  const geo = new THREE.CylinderGeometry(PEG_RADIUS, PEG_RADIUS, PEG_LENGTH, 14);
  return session.identities.map((identity) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: identity.color, roughness: 0.35, metalness: 0.15 }));
    mesh.visible = false;
    mesh.castShadow = SHADOWS_ENABLED;
    boxRoot.add(mesh);
    return mesh;
  });
}

export function createSceneContext(canvas: HTMLCanvasElement, session: DiceyDecisionsSession): SceneContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(CANVAS_W, CANVAS_H, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = SHADOWS_ENABLED;

  const scene = new THREE.Scene();
  scene.background = createBackgroundTexture();
  scene.environment = createEnvironmentMap(renderer);
  scene.environmentIntensity = ENVIRONMENT_INTENSITY;

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, CANVAS_W / CANVAS_H, 0.1, 100);
  camera.position.set(0, CAMERA_HEIGHT, CAMERA_BACK);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT_LIGHT_INTENSITY));
  const keyLight = new THREE.DirectionalLight(0xfff2df, KEY_LIGHT_INTENSITY);
  keyLight.position.set(6, 16, 10);
  keyLight.castShadow = SHADOWS_ENABLED;
  if (SHADOWS_ENABLED) {
    keyLight.shadow.mapSize.set(1024, 1024);
    const cam = keyLight.shadow.camera as THREE.OrthographicCamera;
    cam.left = -FLOOR_WIDTH;
    cam.right = FLOOR_WIDTH;
    cam.top = FLOOR_DEPTH;
    cam.bottom = -FLOOR_DEPTH;
    cam.near = 1;
    cam.far = 40;
  }
  scene.add(keyLight);

  const boxRoot = new THREE.Group();
  scene.add(boxRoot);

  buildStaticBox(boxRoot);
  const { lidGroup, lidMesh } = buildLid(boxRoot, session.roundIndex + 1);
  const dividerGroup = new THREE.Group();
  boxRoot.add(dividerGroup);
  const diceGroup = new THREE.Group();
  boxRoot.add(diceGroup);
  const pegWallGroup = new THREE.Group();
  boxRoot.add(pegWallGroup);
  const pegMeshes = buildPegs(boxRoot, session);

  return {
    renderer,
    scene,
    camera,
    boxRoot,
    floorSectionMeshes: [],
    dividerGroup,
    diceGroup,
    pegWallGroup,
    lidGroup,
    lidMesh,
    pegMeshes,
    cachedRound: null,
  };
}

function rebuildFloorAndDividers(ctx: SceneContext, session: DiceyDecisionsSession): void {
  for (const mesh of ctx.floorSectionMeshes) {
    ctx.boxRoot.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  ctx.floorSectionMeshes = [];
  ctx.dividerGroup.clear();

  const bounds = sectionBounds(session.round.config.sections);
  for (const b of bounds) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(b.width - 0.06, b.depth - 0.06),
      new THREE.MeshStandardMaterial({ color: FELT_COLOR, roughness: 0.9, metalness: 0 }),
    ) as FloorSectionMesh;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(b.cx, 0.001, b.cz);
    mesh.receiveShadow = true;
    mesh.userData.sectionIndex = b.index;
    ctx.boxRoot.add(mesh);
    ctx.floorSectionMeshes.push(mesh);
  }

  const { cols, rows } = sectionGridShape(session.round.config.sections);
  // Same wood material as the outer walls — not the old flat dark color — so every wall-like
  // surface in the box reads as one consistent material.
  const dividerMat = createWoodMaterial(0.6, 0.6);
  for (let c = 1; c < cols; c++) {
    const x = -FLOOR_WIDTH / 2 + (FLOOR_WIDTH / cols) * c;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(DIVIDER_THICKNESS, DIVIDER_HEIGHT, FLOOR_DEPTH), dividerMat);
    wall.position.set(x, DIVIDER_HEIGHT / 2, 0);
    wall.castShadow = true;
    wall.receiveShadow = true;
    ctx.dividerGroup.add(wall);
  }
  for (let r = 1; r < rows; r++) {
    const z = -FLOOR_DEPTH / 2 + (FLOOR_DEPTH / rows) * r;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_WIDTH, DIVIDER_HEIGHT, DIVIDER_THICKNESS), dividerMat);
    wall.position.set(0, DIVIDER_HEIGHT / 2, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    ctx.dividerGroup.add(wall);
  }
}

function rebuildDice(ctx: SceneContext, session: DiceyDecisionsSession): void {
  ctx.diceGroup.clear();
  const bounds = sectionBounds(session.round.config.sections);
  const materials = createDiceMaterials();
  const geometry = createDieGeometry();
  for (const placement of session.round.dice) {
    const box = bounds[placement.section]!;
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.scale.setScalar(placement.scale);
    mesh.position.set(box.cx + placement.localX, (0.94 * placement.scale) / 2 + 0.02, box.cz + placement.localZ);
    applyDiePlacementRotation(mesh, placement.topFace, placement.yaw);
    mesh.castShadow = SHADOWS_ENABLED;
    mesh.receiveShadow = true;
    ctx.diceGroup.add(mesh);
  }
}

function sectionNorthZ(b: SectionBounds): number {
  return b.cz - b.depth / 2;
}

// Where a peg's own bottom end sits — just above the dark socket cap at the hole's base, so it
// reads as plugged all the way down into the hole rather than floating above it.
const PEG_BASE_Y = 0.06;

/** A flat rectangular slab (width x thickness, standing PEG_WALL_HEIGHT tall) with genuine round
 * holes bored straight through it top-to-bottom at each of holeLocalXs — built via THREE.Shape's
 * hole-path support rather than a flat dark circle, so the holes are real geometry (you can see
 * into them, not just a black dot painted on the surface). The 2D shape is authored in the XY
 * plane (X = width, Y = thickness) and extruded along Z, then rotated so that extrusion axis
 * becomes world Y — the holes end up boring straight up through the slab's height. */
function createPegWallGeometry(width: number, holeLocalXs: number[]): THREE.BufferGeometry {
  const halfW = width / 2;
  const halfT = PEG_WALL_THICKNESS / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, -halfT);
  shape.lineTo(halfW, -halfT);
  shape.lineTo(halfW, halfT);
  shape.lineTo(-halfW, halfT);
  shape.lineTo(-halfW, -halfT);
  for (const x of holeLocalXs) {
    const hole = new THREE.Path();
    hole.absarc(x, 0, PEG_HOLE_RADIUS, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: PEG_WALL_HEIGHT, bevelEnabled: false, curveSegments: 20 });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** Every section's own dedicated peg wall — a uniform pedestal (same thickness/height regardless
 * of whether the real structure behind it is the outer box wall or a thinner interior divider,
 * see PEG_WALL_GAP's comment in constants.ts) standing just south of its north boundary, with 4
 * real bored holes across its top and a dark socket visible at the bottom of each one. Rebuilt
 * alongside the floor/dividers whenever the section count changes. */
function rebuildPegWalls(ctx: SceneContext, session: DiceyDecisionsSession): void {
  ctx.pegWallGroup.clear();
  const bounds = sectionBounds(session.round.config.sections);
  const wallMat = createWoodMaterial(1, 0.3);
  const socketMat = new THREE.MeshStandardMaterial({ color: 0x0c0605, roughness: 0.95 });
  const socketGeo = new THREE.CylinderGeometry(PEG_HOLE_RADIUS * 0.9, PEG_HOLE_RADIUS * 0.9, 0.05, 14);

  for (const b of bounds) {
    const wallWidth = b.width * 0.92;
    const wallCenterZ = sectionNorthZ(b) + PEG_WALL_GAP + PEG_WALL_THICKNESS / 2;
    const holeXs = sectionPegHoleXs(b);
    const localHoleXs = holeXs.map((x) => x - b.cx);

    const wall = new THREE.Mesh(createPegWallGeometry(wallWidth, localHoleXs), wallMat);
    wall.position.set(b.cx, 0, wallCenterZ);
    wall.castShadow = true;
    wall.receiveShadow = true;
    ctx.pegWallGroup.add(wall);

    for (const holeX of holeXs) {
      const socket = new THREE.Mesh(socketGeo, socketMat);
      socket.position.set(holeX, 0.025, wallCenterZ);
      ctx.pegWallGroup.add(socket);
    }
  }
}

function lidOpenProgress(session: DiceyDecisionsSession, now: number): number {
  switch (session.phase) {
    case "SLIDING_IN":
    case "SHAKING":
      return 0;
    case "OPENING":
      return clamp01((now - session.phaseStartedAt) / LID_OPEN_DURATION_MS);
    case "PLAYING":
    case "SCORED":
      return 1;
    case "CLOSING":
      return 1 - clamp01((now - session.phaseStartedAt) / LID_CLOSE_DURATION_MS);
    case "SLIDING_OUT":
    case "RESULTS":
      return 0;
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function easeInCubic(t: number): number {
  return t * t * t;
}

/** The box's own X offset from center — 0 whenever it's meant to be sitting in place (including
 * during SHAKING, whose jitter is added separately in shakeOffset). */
function boxSlideX(session: DiceyDecisionsSession, now: number): number {
  if (session.phase === "SLIDING_IN") {
    const t = clamp01((now - session.phaseStartedAt) / SLIDE_DURATION_MS);
    return SLIDE_DISTANCE * (1 - easeOutCubic(t));
  }
  if (session.phase === "SLIDING_OUT") {
    const t = clamp01((now - session.phaseStartedAt) / SLIDE_DURATION_MS);
    return -SLIDE_DISTANCE * easeInCubic(t);
  }
  if (session.phase === "RESULTS") return -SLIDE_DISTANCE;
  return 0;
}

function shakeOffset(session: DiceyDecisionsSession, now: number): { x: number; z: number; rotZ: number } {
  if (session.phase !== "SHAKING") return { x: 0, z: 0, rotZ: 0 };
  const t = clamp01((now - session.phaseStartedAt) / SHAKING_DURATION_MS);
  const envelope = Math.sin(Math.PI * t); // rises then settles back to 0
  return {
    x: Math.sin(now * 0.05) * SHAKE_AMPLITUDE_X * envelope,
    z: Math.cos(now * 0.07) * SHAKE_AMPLITUDE_Z * envelope,
    rotZ: Math.sin(now * 0.06) * SHAKE_ROT_AMPLITUDE_RAD * envelope,
  };
}

/** Fills each section's peg holes left-to-right in per-section selection order (see
 * computeSectionAssignments) — up to PLAYER_COUNT total pegs exist, each repositioned to wherever
 * its owner currently sits, hidden if that player hasn't selected this round. */
function updatePegs(ctx: SceneContext, session: DiceyDecisionsSession): void {
  const bounds = sectionBounds(session.round.config.sections);
  const assignments = computeSectionAssignments(session.round);
  for (const mesh of ctx.pegMeshes) mesh.visible = false;

  for (const { playerId, section, holeIndex } of assignments) {
    const mesh = ctx.pegMeshes[playerId];
    if (!mesh) continue;
    const b = bounds[section]!;
    const holeXs = sectionPegHoleXs(b);
    const holeX = holeXs[holeIndex] ?? holeXs[holeXs.length - 1]!;
    const wallCenterZ = sectionNorthZ(b) + PEG_WALL_GAP + PEG_WALL_THICKNESS / 2;
    mesh.position.set(holeX, PEG_BASE_Y + PEG_LENGTH / 2, wallCenterZ);
    mesh.visible = true;
  }
}

/** Screen-space position (percentages, 0-100) of a player's current peg tip — for main.ts to pop
 * a floating "+N" score number there. Reads the peg's already-updated world position (set by
 * updatePegs during the previous render call), so it's safe to call the same tick a round scores,
 * before this frame's own render happens. Returns null if that player has no peg showing. */
export function pegScreenPosition(ctx: SceneContext, playerId: number): { xPct: number; yPct: number } | null {
  const mesh = ctx.pegMeshes[playerId];
  if (!mesh || !mesh.visible) return null;
  const world = new THREE.Vector3();
  mesh.getWorldPosition(world);
  world.y += PEG_LENGTH * 0.6; // pop just above the peg's own tip
  const projected = world.project(ctx.camera);
  return { xPct: ((projected.x + 1) / 2) * 100, yPct: ((1 - projected.y) / 2) * 100 };
}

function updateFloorHighlight(ctx: SceneContext, session: DiceyDecisionsSession): void {
  const showWinner = session.phase === "SCORED" || session.phase === "CLOSING";
  for (const mesh of ctx.floorSectionMeshes) {
    const index = mesh.userData.sectionIndex as number;
    const isHovered = session.phase === "PLAYING" && session.humanHoveredSection === index;
    const isWinner = showWinner && index === session.round.winningSection;
    mesh.material.color.setHex(isHovered ? FELT_COLOR_HOVER : FELT_COLOR);
    mesh.material.emissive.setHex(isWinner ? WINNING_EMISSIVE : 0x000000);
    mesh.material.emissiveIntensity = isWinner ? 0.55 : 0;
  }
}

/** Re-derives every visible fact from session/now on every call — ctx's meshes are purely a
 * create-once/mutate-in-place cache, never a second source of truth. Section/divider/dice/peg-
 * board geometry and the lid's "Round N" engraving only get rebuilt when session.round is a new
 * object (a fresh round started). */
export function renderDiceyScene(ctx: SceneContext, session: DiceyDecisionsSession, now: number): void {
  if (ctx.cachedRound !== session.round) {
    rebuildFloorAndDividers(ctx, session);
    rebuildDice(ctx, session);
    rebuildPegWalls(ctx, session);
    disposeLidMaterials(ctx.lidMesh.material as THREE.Material[]);
    ctx.lidMesh.material = createLidMaterials(session.roundIndex + 1);
    ctx.cachedRound = session.round;
  }

  const shake = shakeOffset(session, now);
  ctx.boxRoot.position.set(boxSlideX(session, now) + shake.x, 0, shake.z);
  ctx.boxRoot.rotation.z = shake.rotZ;

  ctx.lidGroup.rotation.x = -lidOpenProgress(session, now) * LID_OPEN_ANGLE_RAD;
  updateFloorHighlight(ctx, session);
  updatePegs(ctx, session);

  ctx.renderer.render(ctx.scene, ctx.camera);
}
