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
  PLAYER_COUNT,
  SHADOWS_ENABLED,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WINNING_EMISSIVE,
  WOOD_COLOR,
  WOOD_DARK_COLOR,
} from "./constants.ts";
import { applyDiePlacementRotation, createDiceMaterials, createDieGeometry } from "./diceFactory.ts";
import { sectionBounds, sectionGridShape } from "./layout.ts";
import type { DiceyDecisionsSession } from "./DiceyDecisionsSession.ts";

interface FloorSectionMesh extends THREE.Mesh {
  material: THREE.MeshStandardMaterial;
}

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  floorSectionMeshes: FloorSectionMesh[];
  dividerGroup: THREE.Group;
  diceGroup: THREE.Group;
  lidGroup: THREE.Group;
  markerMeshes: THREE.Mesh[];
  /** Identity of the last RoundState this context built section/divider/dice meshes for — a new
   * round object (created fresh by createRoundState every BOX_CLOSED->OPENING transition) means
   * the geometry needs rebuilding; the same round object means it's still current. */
  cachedRound: DiceyDecisionsSession["round"] | null;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function woodMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 });
}

function buildStaticBox(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(FLOOR_WIDTH + WALL_THICKNESS * 2, FLOOR_THICKNESS, FLOOR_DEPTH + WALL_THICKNESS * 2),
    woodMaterial(WOOD_DARK_COLOR),
  );
  base.position.y = -FLOOR_THICKNESS / 2;
  base.receiveShadow = true;
  group.add(base);

  const wallMat = woodMaterial(WOOD_COLOR);
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
    group.add(wall);
  }

  scene.add(group);
  return group;
}

function buildLid(scene: THREE.Scene): THREE.Group {
  const lidGroup = new THREE.Group();
  // Hinged at the back wall's top edge (world -Z, the far side from the camera) — opening rotates
  // the lid's free edge up and back over the box, per the standard treasure-chest hinge convention.
  lidGroup.position.set(0, WALL_HEIGHT, -FLOOR_DEPTH / 2 - WALL_THICKNESS / 2);

  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(FLOOR_WIDTH + WALL_THICKNESS * 2, WALL_THICKNESS, FLOOR_DEPTH + WALL_THICKNESS * 2),
    woodMaterial(WOOD_COLOR),
  );
  lid.position.set(0, WALL_THICKNESS / 2, (FLOOR_DEPTH + WALL_THICKNESS * 2) / 2);
  lid.castShadow = true;
  lid.receiveShadow = true;
  lidGroup.add(lid);

  scene.add(lidGroup);
  return lidGroup;
}

function buildMarkers(scene: THREE.Scene, session: DiceyDecisionsSession): THREE.Mesh[] {
  const geo = new THREE.ConeGeometry(0.4, 1.1, 14);
  return session.identities.map((identity) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: identity.color, roughness: 0.4 }));
    mesh.rotation.x = Math.PI; // point downward, like a marker pin
    mesh.visible = false;
    mesh.castShadow = SHADOWS_ENABLED;
    scene.add(mesh);
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

  buildStaticBox(scene);
  const lidGroup = buildLid(scene);
  const dividerGroup = new THREE.Group();
  scene.add(dividerGroup);
  const diceGroup = new THREE.Group();
  scene.add(diceGroup);
  const markerMeshes = buildMarkers(scene, session);

  return {
    renderer,
    scene,
    camera,
    floorSectionMeshes: [],
    dividerGroup,
    diceGroup,
    lidGroup,
    markerMeshes,
    cachedRound: null,
  };
}

function rebuildFloorAndDividers(ctx: SceneContext, session: DiceyDecisionsSession): void {
  for (const mesh of ctx.floorSectionMeshes) {
    ctx.scene.remove(mesh);
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
    ctx.scene.add(mesh);
    ctx.floorSectionMeshes.push(mesh);
  }

  const { cols, rows } = sectionGridShape(session.round.config.sections);
  const dividerMat = woodMaterial(WOOD_DARK_COLOR);
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

function lidOpenProgress(session: DiceyDecisionsSession, now: number): number {
  switch (session.phase) {
    case "BOX_CLOSED":
      return 0;
    case "OPENING":
      return clamp01((now - session.phaseStartedAt) / LID_OPEN_DURATION_MS);
    case "PLAYING":
    case "SCORED":
      return 1;
    case "CLOSING":
      return 1 - clamp01((now - session.phaseStartedAt) / LID_CLOSE_DURATION_MS);
    case "RESULTS":
      return 0;
  }
}

const MARKER_OFFSET_RADIUS = 1.3;

function updateMarkers(ctx: SceneContext, session: DiceyDecisionsSession): void {
  const bounds = sectionBounds(session.round.config.sections);
  session.round.selections.forEach((selection, playerId) => {
    const mesh = ctx.markerMeshes[playerId]!;
    if (selection.section === null) {
      mesh.visible = false;
      return;
    }
    const box = bounds[selection.section]!;
    const angle = (playerId / PLAYER_COUNT) * Math.PI * 2;
    mesh.visible = true;
    mesh.position.set(
      box.cx + Math.cos(angle) * MARKER_OFFSET_RADIUS,
      2.1,
      box.cz + Math.sin(angle) * MARKER_OFFSET_RADIUS,
    );
  });
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
 * create-once/mutate-in-place cache, never a second source of truth. Section/divider/dice
 * geometry only gets rebuilt when session.round is a new object (a fresh round started). */
export function renderDiceyScene(ctx: SceneContext, session: DiceyDecisionsSession, now: number): void {
  if (ctx.cachedRound !== session.round) {
    rebuildFloorAndDividers(ctx, session);
    rebuildDice(ctx, session);
    ctx.cachedRound = session.round;
  }

  ctx.lidGroup.rotation.x = -lidOpenProgress(session, now) * LID_OPEN_ANGLE_RAD;
  updateFloorHighlight(ctx, session);
  updateMarkers(ctx, session);

  ctx.renderer.render(ctx.scene, ctx.camera);
}
