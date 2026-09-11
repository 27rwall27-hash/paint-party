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
  FELT_COLOR,
  FELT_COLOR_HOVER,
  FLOOR_DEPTH,
  FLOOR_THICKNESS,
  FLOOR_WIDTH,
  KEY_LIGHT_INTENSITY,
  LID_CLOSE_DURATION_MS,
  LID_OPEN_ANGLE_RAD,
  LID_OPEN_DURATION_MS,
  PEG_BOARD_HEIGHT,
  PEG_BOARD_THICKNESS,
  PEG_BOARD_WALL_OFFSET,
  PEG_BOARD_Y_CENTER,
  PEG_HOLE_RADIUS,
  PEG_LENGTH,
  PEG_RADIUS,
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
  pegBoardGroup: THREE.Group;
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
  const geo = new THREE.CylinderGeometry(PEG_RADIUS, PEG_RADIUS, PEG_LENGTH, 14);
  return session.identities.map((identity) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: identity.color, roughness: 0.35, metalness: 0.15 }));
    mesh.rotation.x = Math.PI / 2; // cylinder's length axis -> world Z, so it "inserts" horizontally
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
  scene.background = new THREE.Color(0x14100c);

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
  const pegBoardGroup = new THREE.Group();
  boxRoot.add(pegBoardGroup);
  const pegMeshes = buildPegs(boxRoot, session);

  return {
    renderer,
    scene,
    camera,
    boxRoot,
    floorSectionMeshes: [],
    dividerGroup,
    diceGroup,
    pegBoardGroup,
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
  const dividerMat = flatMaterial(WOOD_DARK_COLOR);
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

/** Every section's own peg board — a slim strip mounted on its north wall with 4 always-visible
 * dark holes. Rebuilt alongside the floor/dividers whenever the section count changes. */
function rebuildPegBoards(ctx: SceneContext, session: DiceyDecisionsSession): void {
  ctx.pegBoardGroup.clear();
  const bounds = sectionBounds(session.round.config.sections);
  const boardMat = flatMaterial(WOOD_DARK_COLOR);
  const holeMat = new THREE.MeshStandardMaterial({ color: 0x120a0c, roughness: 0.9 });
  const holeGeo = new THREE.CylinderGeometry(PEG_HOLE_RADIUS, PEG_HOLE_RADIUS, 0.05, 12);

  for (const b of bounds) {
    const northZ = sectionNorthZ(b);
    const boardCenterZ = northZ + PEG_BOARD_WALL_OFFSET;
    const board = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.92, PEG_BOARD_HEIGHT, PEG_BOARD_THICKNESS), boardMat);
    board.position.set(b.cx, PEG_BOARD_Y_CENTER, boardCenterZ);
    board.castShadow = true;
    board.receiveShadow = true;
    ctx.pegBoardGroup.add(board);

    const boardFrontZ = boardCenterZ + PEG_BOARD_THICKNESS / 2;
    for (const holeX of sectionPegHoleXs(b)) {
      const hole = new THREE.Mesh(holeGeo, holeMat);
      hole.rotation.x = Math.PI / 2;
      hole.position.set(holeX, PEG_BOARD_Y_CENTER, boardFrontZ - 0.005);
      ctx.pegBoardGroup.add(hole);
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
    const boardFrontZ = sectionNorthZ(b) + PEG_BOARD_WALL_OFFSET + PEG_BOARD_THICKNESS / 2;
    mesh.position.set(holeX, PEG_BOARD_Y_CENTER, boardFrontZ + PEG_LENGTH * 0.3);
    mesh.visible = true;
  }
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
    rebuildPegBoards(ctx, session);
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
