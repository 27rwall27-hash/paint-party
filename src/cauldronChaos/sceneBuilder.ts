import * as THREE from "three";
import {
  AMBIENT_LIGHT_INTENSITY,
  BOTTLE_HEIGHT,
  BOTTLE_RADIUS,
  CAMERA_BACK,
  CAMERA_FOV,
  CAMERA_HEIGHT,
  CANVAS_H,
  CANVAS_W,
  CAULDRON_DETOUR_MARGIN,
  CAULDRON_POUR_Z,
  CAULDRON_RADIUS,
  CAULDRON_X,
  CAULDRON_Z,
  CHARACTER_HEIGHT,
  CHARACTER_RADIUS,
  ENVIRONMENT_INTENSITY,
  INGREDIENTS,
  KEY_LIGHT_INTENSITY,
  PLAYER_HOME_POSITIONS,
  POUR_HOLD_MS,
  ROOM_DEPTH,
  ROOM_WIDTH,
  SHADOWS_ENABLED,
  SHELF_APPROACH_OFFSET,
  SHELF_WIDTH,
  SHELF_Y,
  SHELF_Z,
  WALK_CYCLE_PERIOD_MS,
  WALK_DURATION_MS,
  WALK_SWING_RAD,
  WALL_HEIGHT,
} from "./constants.ts";
import { currentTurnPlayerId, type CauldronChaosSession, type RoundState } from "./CauldronChaosSession.ts";

const INGREDIENT_BY_ID = new Map(INGREDIENTS.map((i) => [i.id, i]));

interface Limb {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
}

interface CharacterRig {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  legL: Limb;
  legR: Limb;
  armL: Limb;
  armR: Limb;
  handGroup: THREE.Group;
}

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  bottleMeshesByType: Map<number, THREE.Group>;
  cauldronLiquid: THREE.Mesh;
  characters: CharacterRig[];
  heldBottle: { group: THREE.Group; forTypeId: number } | null;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// --- Environment (soft ambient fill, not meant to gleam — a moody dungeon) -----------------------

function createEnvironmentTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#4a3f56");
  sky.addColorStop(0.5, "#241a30");
  sky.addColorStop(1, "#0c0714");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const glow = ctx.createRadialGradient(128, 24, 0, 128, 24, 70);
  glow.addColorStop(0, "rgba(140,220,150,0.5)");
  glow.addColorStop(1, "rgba(140,220,150,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
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

// --- Procedural cast-iron texture (subtle mottled noise, not flat plastic) -----------------------

function createIronTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#232228";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1100; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const shade = 18 + Math.random() * 42;
    ctx.fillStyle = `rgba(${shade + 12},${shade + 6},${shade + 14},${0.12 + Math.random() * 0.22})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.6 + Math.random() * 1.9, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 1.4);
  return texture;
}

// --- Room / shelf / cauldron (static) -----------------------------------------------------------

function buildRoom(scene: THREE.Scene): void {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH),
    new THREE.MeshStandardMaterial({ color: 0x362a3e, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x211729, roughness: 0.92 });
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, WALL_HEIGHT, 0.6), wallMat);
  backWall.position.set(0, WALL_HEIGHT / 2, -ROOM_DEPTH / 2);
  backWall.receiveShadow = true;
  scene.add(backWall);

  const sideGeo = new THREE.BoxGeometry(0.6, WALL_HEIGHT, ROOM_DEPTH);
  const leftWall = new THREE.Mesh(sideGeo, wallMat);
  leftWall.position.set(-ROOM_WIDTH / 2, WALL_HEIGHT / 2, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);
  const rightWall = new THREE.Mesh(sideGeo, wallMat);
  rightWall.position.set(ROOM_WIDTH / 2, WALL_HEIGHT / 2, 0);
  rightWall.receiveShadow = true;
  scene.add(rightWall);

  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(SHELF_WIDTH + 1.4, SHELF_Y, 1.3),
    new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.85 }),
  );
  counter.position.set(0, SHELF_Y / 2, SHELF_Z);
  counter.castShadow = true;
  counter.receiveShadow = true;
  scene.add(counter);
}

function buildCauldron(scene: THREE.Scene): THREE.Mesh {
  const ironTexture = createIronTexture();
  const potMat = new THREE.MeshStandardMaterial({ map: ironTexture, color: 0x2a2a30, roughness: 0.62, metalness: 0.45 });

  const profile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(CAULDRON_RADIUS * 0.16, 0.03),
    new THREE.Vector2(CAULDRON_RADIUS * 0.38, 0.12),
    new THREE.Vector2(CAULDRON_RADIUS * 0.72, 0.4),
    new THREE.Vector2(CAULDRON_RADIUS * 0.94, 0.75),
    new THREE.Vector2(CAULDRON_RADIUS, 1.02),
    new THREE.Vector2(CAULDRON_RADIUS * 0.96, 1.2),
    new THREE.Vector2(CAULDRON_RADIUS * 0.78, 1.32),
    new THREE.Vector2(CAULDRON_RADIUS * 0.82, 1.4),
  ];
  const pot = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), potMat);
  pot.position.set(CAULDRON_X, 0, CAULDRON_Z);
  pot.castShadow = true;
  pot.receiveShadow = true;
  scene.add(pot);

  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.4, metalness: 0.65 });

  const rim = new THREE.Mesh(new THREE.TorusGeometry(CAULDRON_RADIUS * 0.83, 0.075, 12, 32), trimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(CAULDRON_X, 1.32, CAULDRON_Z);
  rim.castShadow = true;
  scene.add(rim);

  for (const side of [-1, 1] as const) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.04, 8, 16, Math.PI * 1.2), trimMat);
    handle.position.set(CAULDRON_X + side * CAULDRON_RADIUS * 0.97, 1.08, CAULDRON_Z);
    handle.rotation.z = Math.PI / 2;
    handle.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    handle.castShadow = true;
    scene.add(handle);
  }

  const rivetGeo = new THREE.SphereGeometry(0.05, 8, 6);
  const rivetCount = 16;
  for (let i = 0; i < rivetCount; i++) {
    const a = (i / rivetCount) * Math.PI * 2;
    const rivet = new THREE.Mesh(rivetGeo, trimMat);
    rivet.position.set(CAULDRON_X + Math.cos(a) * CAULDRON_RADIUS * 0.99, 1.18, CAULDRON_Z + Math.sin(a) * CAULDRON_RADIUS * 0.99);
    scene.add(rivet);
  }

  const liquid = new THREE.Mesh(
    new THREE.CircleGeometry(CAULDRON_RADIUS * 0.72, 32),
    new THREE.MeshStandardMaterial({ color: 0x3fae5a, roughness: 0.3, emissive: 0x1c5a30, emissiveIntensity: 0.35 }),
  );
  liquid.rotation.x = -Math.PI / 2;
  liquid.position.set(CAULDRON_X, 1.28, CAULDRON_Z);
  scene.add(liquid);

  const legMat = new THREE.MeshStandardMaterial({ color: 0x232228, roughness: 0.55, metalness: 0.4 });
  for (const [dx, dz] of [
    [-0.85, 0],
    [0.85, 0],
    [0, 0.85],
  ] as const) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 0.24, 12), legMat);
    foot.position.set(CAULDRON_X + dx, 0.12, CAULDRON_Z + dz);
    foot.castShadow = true;
    scene.add(foot);
  }

  return liquid;
}

// --- Bottles (pure color, no symbols) -----------------------------------------------------------

export function createBottleMesh(typeId: number): THREE.Group {
  const def = INGREDIENT_BY_ID.get(typeId)!;
  const group = new THREE.Group();

  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(BOTTLE_RADIUS, BOTTLE_RADIUS * 0.88, BOTTLE_HEIGHT, 20),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, roughness: 0.12, clearcoat: 0.6 }),
  );
  glass.position.y = BOTTLE_HEIGHT / 2;
  group.add(glass);

  const liquid = new THREE.Mesh(
    new THREE.CylinderGeometry(BOTTLE_RADIUS * 0.8, BOTTLE_RADIUS * 0.72, BOTTLE_HEIGHT * 0.62, 20),
    new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.3, emissive: def.color, emissiveIntensity: 0.12 }),
  );
  liquid.position.y = BOTTLE_HEIGHT * 0.34;
  group.add(liquid);

  const cork = new THREE.Mesh(
    new THREE.CylinderGeometry(BOTTLE_RADIUS * 0.35, BOTTLE_RADIUS * 0.35, BOTTLE_HEIGHT * 0.18, 10),
    new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 0.9 }),
  );
  cork.position.y = BOTTLE_HEIGHT + BOTTLE_HEIGHT * 0.06;
  group.add(cork);

  if (SHADOWS_ENABLED) for (const child of group.children) (child as THREE.Mesh).castShadow = true;
  return group;
}

/** Fixed shelf layout for exactly INGREDIENTS.length bottles — built once, never rebuilt, since
 * the shelf composition no longer varies round to round (every bottle simply refills in place). */
function shelfTypePosition(index: number, total: number): { x: number; z: number } {
  const spacing = SHELF_WIDTH / total;
  return { x: -SHELF_WIDTH / 2 + spacing * (index + 0.5), z: SHELF_Z };
}

function buildShelf(scene: THREE.Scene): Map<number, THREE.Group> {
  const bottleMeshesByType = new Map<number, THREE.Group>();
  INGREDIENTS.forEach((def, index) => {
    const bottle = createBottleMesh(def.id);
    bottle.userData.typeId = def.id;
    bottle.traverse((obj) => {
      obj.userData.typeId = def.id;
    });
    const pos = shelfTypePosition(index, INGREDIENTS.length);
    bottle.position.set(pos.x, SHELF_Y, pos.z);
    scene.add(bottle);
    bottleMeshesByType.set(def.id, bottle);
  });
  return bottleMeshesByType;
}

function shelfBottleWorldPosition(typeId: number): { x: number; z: number } {
  const index = INGREDIENTS.findIndex((i) => i.id === typeId);
  return shelfTypePosition(index, INGREDIENTS.length);
}

function updateShelfVisibility(ctx: SceneContext, session: CauldronChaosSession): void {
  const round = session.round;
  const carriedTypeId = round.turnPhase === "AWAITING" || round.turnPhase === "DECIDING" ? null : round.pendingPickTypeId;
  for (const [typeId, bottle] of ctx.bottleMeshesByType) {
    bottle.visible = typeId !== carriedTypeId;
  }
}

// --- Characters --------------------------------------------------------------------------------

function buildLimb(color: number | string, length: number, radius: number): Limb {
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, length, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true }),
  );
  mesh.position.y = -(length / 2 + radius);
  mesh.castShadow = SHADOWS_ENABLED;
  pivot.add(mesh);
  return { pivot, mesh };
}

function buildCharacter(color: string): CharacterRig {
  const group = new THREE.Group();
  const hipY = CHARACTER_HEIGHT * 0.46;
  const shoulderY = CHARACTER_HEIGHT * 0.82;
  const legLength = hipY * 0.85;
  const armLength = (shoulderY - hipY) * 0.85;

  const legL = buildLimb(color, legLength, CHARACTER_RADIUS * 0.24);
  legL.pivot.position.set(-CHARACTER_RADIUS * 0.32, hipY, 0);
  group.add(legL.pivot);
  const legR = buildLimb(color, legLength, CHARACTER_RADIUS * 0.24);
  legR.pivot.position.set(CHARACTER_RADIUS * 0.32, hipY, 0);
  group.add(legR.pivot);

  const armL = buildLimb(color, armLength, CHARACTER_RADIUS * 0.19);
  armL.pivot.position.set(-CHARACTER_RADIUS * 0.82, shoulderY, 0);
  group.add(armL.pivot);
  const armR = buildLimb(color, armLength, CHARACTER_RADIUS * 0.19);
  armR.pivot.position.set(CHARACTER_RADIUS * 0.82, shoulderY, 0);
  group.add(armR.pivot);

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(CHARACTER_RADIUS * 0.82, shoulderY - hipY, 6, 14),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, transparent: true }),
  );
  body.position.y = (hipY + shoulderY) / 2;
  body.castShadow = SHADOWS_ENABLED;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(CHARACTER_RADIUS * 0.66, 18, 14),
    new THREE.MeshStandardMaterial({ color: 0xe8c39e, roughness: 0.7, transparent: true }),
  );
  head.position.y = shoulderY + CHARACTER_RADIUS * 0.8;
  head.castShadow = SHADOWS_ENABLED;
  group.add(head);

  const handGroup = new THREE.Group();
  handGroup.position.set(CHARACTER_RADIUS * 0.82, hipY + (shoulderY - hipY) * 0.6, CHARACTER_RADIUS * 0.6);
  group.add(handGroup);

  return { group, body, head, legL, legR, armL, armR, handGroup };
}

// --- Scene setup -----------------------------------------------------------------------------

export function createSceneContext(canvas: HTMLCanvasElement, session: CauldronChaosSession): SceneContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(CANVAS_W, CANVAS_H, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = SHADOWS_ENABLED;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x120d1a);
  scene.environment = createEnvironmentMap(renderer);
  scene.environmentIntensity = ENVIRONMENT_INTENSITY;

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, CANVAS_W / CANVAS_H, 0.1, 100);
  camera.position.set(0, CAMERA_HEIGHT, CAMERA_BACK);
  camera.lookAt(0, 1, -1);

  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT_LIGHT_INTENSITY));
  const keyLight = new THREE.DirectionalLight(0xfff2df, KEY_LIGHT_INTENSITY);
  keyLight.position.set(4, 12, 8);
  keyLight.castShadow = SHADOWS_ENABLED;
  if (SHADOWS_ENABLED) {
    keyLight.shadow.mapSize.set(1024, 1024);
    const cam = keyLight.shadow.camera as THREE.OrthographicCamera;
    cam.left = -ROOM_WIDTH / 2;
    cam.right = ROOM_WIDTH / 2;
    cam.top = ROOM_DEPTH / 2;
    cam.bottom = -ROOM_DEPTH / 2;
    cam.near = 1;
    cam.far = 30;
  }
  scene.add(keyLight);

  buildRoom(scene);
  const cauldronLiquid = buildCauldron(scene);
  const bottleMeshesByType = buildShelf(scene);

  const characters = session.identities.map((identity) => {
    const rig = buildCharacter(identity.color);
    const home = PLAYER_HOME_POSITIONS[identity.id]!;
    rig.group.position.set(home.x, 0, home.z);
    scene.add(rig.group);
    return rig;
  });

  return { renderer, scene, camera, bottleMeshesByType, cauldronLiquid, characters, heldBottle: null };
}

// --- Path routing (quadratic bezier, always arcing around the cauldron) --------------------------

function shelfApproachPosition(bottlePos: { x: number; z: number }): { x: number; z: number } {
  return { x: bottlePos.x, z: bottlePos.z + SHELF_APPROACH_OFFSET };
}

function cauldronDetourPoint(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number } {
  const side = from.x + to.x >= 0 ? 1 : -1;
  return { x: side * CAULDRON_DETOUR_MARGIN, z: CAULDRON_Z };
}

function bezierPoint(p0: { x: number; z: number }, p1: { x: number; z: number }, p2: { x: number; z: number }, t: number): { x: number; z: number } {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, z: u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z };
}

function bezierFacing(p0: { x: number; z: number }, p1: { x: number; z: number }, p2: { x: number; z: number }, t: number): number {
  const dx = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
  const dz = 2 * (1 - t) * (p1.z - p0.z) + 2 * t * (p2.z - p1.z);
  return Math.atan2(dx, dz);
}

// --- Per-frame character animation -----------------------------------------------------------

interface CharacterFrame {
  x: number;
  z: number;
  holding: boolean;
  pourTilt: number;
  facing: number | null;
  walking: boolean;
}

function characterFrame(round: RoundState, playerId: number, now: number): CharacterFrame {
  const home = PLAYER_HOME_POSITIONS[playerId]!;
  if (currentTurnPlayerId(round) !== playerId || round.turnPhase === "AWAITING" || round.turnPhase === "DECIDING") {
    return { x: home.x, z: home.z, holding: false, pourTilt: 0, facing: null, walking: false };
  }

  const bottlePos = round.pendingPickTypeId !== null ? shelfBottleWorldPosition(round.pendingPickTypeId) : home;
  const approachPos = shelfApproachPosition(bottlePos);
  const pourPos = { x: CAULDRON_X, z: CAULDRON_POUR_Z };
  const t = clamp01((now - round.turnPhaseStartedAt) / WALK_DURATION_MS);

  switch (round.turnPhase) {
    case "WALK_TO_SHELF": {
      const control = cauldronDetourPoint(home, approachPos);
      const p = bezierPoint(home, control, approachPos, t);
      return { x: p.x, z: p.z, holding: false, pourTilt: 0, facing: bezierFacing(home, control, approachPos, t), walking: true };
    }
    case "PICKUP":
      return { x: approachPos.x, z: approachPos.z, holding: true, pourTilt: 0, facing: Math.atan2(0, -1), walking: false };
    case "WALK_TO_CAULDRON": {
      const control = cauldronDetourPoint(approachPos, pourPos);
      const p = bezierPoint(approachPos, control, pourPos, t);
      return { x: p.x, z: p.z, holding: true, pourTilt: 0, facing: bezierFacing(approachPos, control, pourPos, t), walking: true };
    }
    case "POUR": {
      const pt = clamp01((now - round.turnPhaseStartedAt) / POUR_HOLD_MS);
      return { x: pourPos.x, z: pourPos.z, holding: true, pourTilt: Math.sin(pt * Math.PI) * 1.1, facing: 0, walking: false };
    }
    case "WALK_BACK": {
      const control = cauldronDetourPoint(pourPos, home);
      const p = bezierPoint(pourPos, control, home, t);
      return { x: p.x, z: p.z, holding: t < 0.4, pourTilt: 0, facing: bezierFacing(pourPos, control, home, t), walking: true };
    }
    default:
      return { x: home.x, z: home.z, holding: false, pourTilt: 0, facing: null, walking: false };
  }
}

function applyWalkCycle(rig: CharacterRig, now: number, walking: boolean): void {
  const swing = walking ? Math.sin(now / (WALK_CYCLE_PERIOD_MS / (Math.PI * 2))) * WALK_SWING_RAD : 0;
  rig.legL.pivot.rotation.x = swing;
  rig.legR.pivot.rotation.x = -swing;
  rig.armL.pivot.rotation.x = -swing * 0.7;
  rig.armR.pivot.rotation.x = swing * 0.35; // the carrying arm swings less, it's holding a bottle
}

function updateCharacters(ctx: SceneContext, session: CauldronChaosSession, now: number): void {
  const round = session.round;
  const turnPlayer = session.phase === "PICKING" ? currentTurnPlayerId(round) : -1;

  session.identities.forEach((_identity, playerId) => {
    const rig = ctx.characters[playerId]!;
    const active = round.activePlayers[playerId];
    const opacity = active ? 1 : 0.32;
    (rig.body.material as THREE.MeshStandardMaterial).opacity = opacity;
    (rig.head.material as THREE.MeshStandardMaterial).opacity = opacity;

    const home = PLAYER_HOME_POSITIONS[playerId]!;
    const frame: CharacterFrame =
      session.phase === "PICKING" ? characterFrame(round, playerId, now) : { x: home.x, z: home.z, holding: false, pourTilt: 0, facing: null, walking: false };

    const bob = frame.walking ? Math.abs(Math.sin(now / (WALK_CYCLE_PERIOD_MS / Math.PI))) * 0.06 : 0;
    rig.group.position.set(frame.x, bob, frame.z);
    if (frame.facing !== null) rig.group.rotation.y = frame.facing;
    applyWalkCycle(rig, now, frame.walking);

    if (playerId === turnPlayer && frame.holding && round.pendingPickTypeId !== null) {
      if (!ctx.heldBottle || ctx.heldBottle.forTypeId !== round.pendingPickTypeId) {
        if (ctx.heldBottle) ctx.heldBottle.group.parent?.remove(ctx.heldBottle.group);
        const group = createBottleMesh(round.pendingPickTypeId);
        group.scale.setScalar(0.85);
        ctx.heldBottle = { group, forTypeId: round.pendingPickTypeId };
      }
      if (ctx.heldBottle.group.parent !== rig.handGroup) rig.handGroup.add(ctx.heldBottle.group);
      ctx.heldBottle.group.rotation.z = round.turnPhase === "POUR" ? -frame.pourTilt : 0;
    } else if (ctx.heldBottle && ctx.heldBottle.group.parent === rig.handGroup && !frame.holding) {
      rig.handGroup.remove(ctx.heldBottle.group);
      ctx.heldBottle = null;
    }
  });

  if (session.phase !== "PICKING" && ctx.heldBottle) {
    ctx.heldBottle.group.parent?.remove(ctx.heldBottle.group);
    ctx.heldBottle = null;
  }
}

function updateCauldronPulse(ctx: SceneContext, session: CauldronChaosSession, now: number): void {
  const round = session.round;
  const mat = ctx.cauldronLiquid.material as THREE.MeshStandardMaterial;
  if (session.phase === "PICKING" && round.turnPhase === "POUR" && round.lastPick) {
    const t = clamp01((now - round.turnPhaseStartedAt) / POUR_HOLD_MS);
    const pulse = Math.sin(t * Math.PI);
    mat.emissive.setHex(round.lastPick.safe ? 0x5be07a : 0xaa2a2a);
    mat.emissiveIntensity = 0.35 + pulse * 0.9;
  } else {
    mat.emissive.setHex(0x1c5a30);
    mat.emissiveIntensity = 0.35 + Math.sin(now / 500) * 0.08;
  }
}

/** Re-derives every visible fact from session/now on every call — ctx's meshes are purely a
 * create-once/mutate-in-place cache. The shelf is fully static now (every potion just refills in
 * place), so there's nothing left to rebuild per round — only visibility/position/animation. */
export function renderCauldronScene(ctx: SceneContext, session: CauldronChaosSession, now: number): void {
  updateShelfVisibility(ctx, session);
  updateCharacters(ctx, session, now);
  updateCauldronPulse(ctx, session, now);
  ctx.renderer.render(ctx.scene, ctx.camera);
}
