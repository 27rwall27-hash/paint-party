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
  SHELF_WIDTH,
  SHELF_Y,
  SHELF_Z,
  WALK_DURATION_MS,
  WALL_HEIGHT,
} from "./constants.ts";
import { getLabelTexture } from "./bottleTexture.ts";
import { currentTurnPlayerId, type CauldronChaosSession, type RoundState } from "./CauldronChaosSession.ts";

const INGREDIENT_BY_ID = new Map(INGREDIENTS.map((i) => [i.id, i]));

interface CharacterRig {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  handGroup: THREE.Group;
}

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  shelfGroup: THREE.Group;
  bottleMeshesBySlot: Map<number, THREE.Group>;
  cauldronLiquid: THREE.Mesh;
  characters: CharacterRig[];
  heldBottle: { group: THREE.Group; forSlotId: number } | null;
  cachedRound: RoundState | null;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// --- Environment (soft ambient fill, not meant to gleam — a moody dungeon, not lacquered wood) ---

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
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(CAULDRON_RADIUS * 0.85, CAULDRON_RADIUS * 0.5, 1.3, 24),
    new THREE.MeshStandardMaterial({ color: 0x26262e, roughness: 0.55, metalness: 0.35 }),
  );
  pot.position.set(CAULDRON_X, 0.65, CAULDRON_Z);
  pot.castShadow = true;
  pot.receiveShadow = true;
  scene.add(pot);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(CAULDRON_RADIUS * 0.86, 0.09, 10, 24),
    new THREE.MeshStandardMaterial({ color: 0x3a3a44, roughness: 0.4, metalness: 0.5 }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.set(CAULDRON_X, 1.28, CAULDRON_Z);
  scene.add(rim);

  const liquid = new THREE.Mesh(
    new THREE.CircleGeometry(CAULDRON_RADIUS * 0.78, 28),
    new THREE.MeshStandardMaterial({ color: 0x3fae5a, roughness: 0.35, emissive: 0x1c5a30, emissiveIntensity: 0.35 }),
  );
  liquid.rotation.x = -Math.PI / 2;
  liquid.position.set(CAULDRON_X, 1.25, CAULDRON_Z);
  scene.add(liquid);

  const legMat = new THREE.MeshStandardMaterial({ color: 0x26262e, roughness: 0.6 });
  for (const [dx, dz] of [
    [-0.85, 0],
    [0.85, 0],
    [0, 0.85],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), legMat);
    leg.position.set(CAULDRON_X + dx, 0.05, CAULDRON_Z + dz);
    leg.castShadow = true;
    scene.add(leg);
  }

  return liquid;
}

// --- Bottles ---------------------------------------------------------------------------------

export function createBottleMesh(typeId: number): THREE.Group {
  const def = INGREDIENT_BY_ID.get(typeId)!;
  const group = new THREE.Group();

  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(BOTTLE_RADIUS, BOTTLE_RADIUS * 0.88, BOTTLE_HEIGHT, 16),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, roughness: 0.15, clearcoat: 0.5 }),
  );
  glass.position.y = BOTTLE_HEIGHT / 2;
  group.add(glass);

  const liquid = new THREE.Mesh(
    new THREE.CylinderGeometry(BOTTLE_RADIUS * 0.8, BOTTLE_RADIUS * 0.72, BOTTLE_HEIGHT * 0.6, 16),
    new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.4 }),
  );
  liquid.position.y = BOTTLE_HEIGHT * 0.33;
  group.add(liquid);

  const cork = new THREE.Mesh(
    new THREE.CylinderGeometry(BOTTLE_RADIUS * 0.35, BOTTLE_RADIUS * 0.35, BOTTLE_HEIGHT * 0.18, 10),
    new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 0.9 }),
  );
  cork.position.y = BOTTLE_HEIGHT + BOTTLE_HEIGHT * 0.06;
  group.add(cork);

  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(BOTTLE_RADIUS * 1.3, BOTTLE_RADIUS * 1.3),
    new THREE.MeshBasicMaterial({ map: getLabelTexture(typeId), transparent: true, depthWrite: false }),
  );
  label.position.set(0, BOTTLE_HEIGHT * 0.5, BOTTLE_RADIUS * 0.95);
  group.add(label);

  if (SHADOWS_ENABLED) for (const child of group.children) (child as THREE.Mesh).castShadow = true;
  group.traverse((obj) => {
    obj.userData.slotId = group.userData.slotId;
  });
  return group;
}

/** Shelf slot layout: fills rows of up to 12, wrapping and receding toward the back wall so a
 * dense round's extra bottle copies don't just overlap. Pure given a slot count. */
function shelfSlotLocalPosition(index: number, total: number): { x: number; z: number } {
  const cols = Math.min(total, 12);
  const spacing = SHELF_WIDTH / cols;
  const row = Math.floor(index / cols);
  const col = index % cols;
  const thisRowCount = Math.min(cols, total - row * cols);
  const rowWidth = thisRowCount * spacing;
  return { x: -rowWidth / 2 + spacing * (col + 0.5), z: SHELF_Z - row * 0.85 };
}

function shelfSlotWorldPosition(round: RoundState, slotId: number): { x: number; z: number } {
  const index = round.shelfSlots.findIndex((s) => s.slotId === slotId);
  return shelfSlotLocalPosition(index, round.shelfSlots.length);
}

function rebuildShelf(ctx: SceneContext, session: CauldronChaosSession): void {
  ctx.shelfGroup.clear();
  ctx.bottleMeshesBySlot.clear();
  const round = session.round;
  round.shelfSlots.forEach((slot, index) => {
    const bottle = new THREE.Group();
    bottle.userData.slotId = slot.slotId;
    const built = createBottleMesh(slot.typeId);
    built.userData.slotId = slot.slotId;
    built.traverse((obj) => {
      obj.userData.slotId = slot.slotId;
    });
    bottle.add(built);
    const pos = shelfSlotLocalPosition(index, round.shelfSlots.length);
    bottle.position.set(pos.x, SHELF_Y, pos.z);
    ctx.shelfGroup.add(bottle);
    ctx.bottleMeshesBySlot.set(slot.slotId, bottle);
  });
}

function updateShelfVisibility(ctx: SceneContext, session: CauldronChaosSession): void {
  const round = session.round;
  for (const [slotId, bottle] of ctx.bottleMeshesBySlot) {
    const carrying = round.pendingPickSlotId === slotId && round.turnPhase !== "AWAITING" && round.turnPhase !== "DECIDING";
    bottle.visible = !round.usedSlotIds.includes(slotId) && !carrying;
  }
}

// --- Characters --------------------------------------------------------------------------------

function buildCharacter(color: string): CharacterRig {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(CHARACTER_RADIUS, Math.max(0.1, CHARACTER_HEIGHT - CHARACTER_RADIUS * 2), 6, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true }),
  );
  body.position.y = CHARACTER_HEIGHT / 2;
  body.castShadow = SHADOWS_ENABLED;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(CHARACTER_RADIUS * 0.72, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8c39e, roughness: 0.7, transparent: true }),
  );
  head.position.y = CHARACTER_HEIGHT + CHARACTER_RADIUS * 0.15;
  head.castShadow = SHADOWS_ENABLED;
  group.add(head);

  const handGroup = new THREE.Group();
  handGroup.position.set(CHARACTER_RADIUS * 0.95, CHARACTER_HEIGHT * 0.55, CHARACTER_RADIUS * 0.5);
  group.add(handGroup);

  return { group, body, head, handGroup };
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

  const shelfGroup = new THREE.Group();
  scene.add(shelfGroup);

  const characters = session.identities.map((identity) => {
    const rig = buildCharacter(identity.color);
    const home = PLAYER_HOME_POSITIONS[identity.id]!;
    rig.group.position.set(home.x, 0, home.z);
    scene.add(rig.group);
    return rig;
  });

  const ctx: SceneContext = {
    renderer,
    scene,
    camera,
    shelfGroup,
    bottleMeshesBySlot: new Map(),
    cauldronLiquid,
    characters,
    heldBottle: null,
    cachedRound: null,
  };
  rebuildShelf(ctx, session);
  ctx.cachedRound = session.round;
  return ctx;
}

// --- Per-frame updates -------------------------------------------------------------------------

function angleTo(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

interface CharacterFrame {
  x: number;
  z: number;
  holding: boolean;
  pourTilt: number;
  facing: number | null;
}

function characterFrame(round: RoundState, playerId: number, now: number): CharacterFrame {
  const home = PLAYER_HOME_POSITIONS[playerId]!;
  if (currentTurnPlayerId(round) !== playerId || round.turnPhase === "AWAITING" || round.turnPhase === "DECIDING") {
    return { x: home.x, z: home.z, holding: false, pourTilt: 0, facing: null };
  }

  const shelfPos = round.pendingPickSlotId !== null ? shelfSlotWorldPosition(round, round.pendingPickSlotId) : home;
  const pourPos = { x: CAULDRON_X, z: CAULDRON_POUR_Z };
  const t = clamp01((now - round.turnPhaseStartedAt) / WALK_DURATION_MS);

  switch (round.turnPhase) {
    case "WALK_TO_SHELF": {
      const x = lerp(home.x, shelfPos.x, t);
      const z = lerp(home.z, shelfPos.z, t);
      return { x, z, holding: false, pourTilt: 0, facing: angleTo(home, shelfPos) };
    }
    case "PICKUP":
      return { x: shelfPos.x, z: shelfPos.z, holding: true, pourTilt: 0, facing: angleTo(home, shelfPos) };
    case "WALK_TO_CAULDRON": {
      const x = lerp(shelfPos.x, pourPos.x, t);
      const z = lerp(shelfPos.z, pourPos.z, t);
      return { x, z, holding: true, pourTilt: 0, facing: angleTo(shelfPos, pourPos) };
    }
    case "POUR": {
      const pt = clamp01((now - round.turnPhaseStartedAt) / POUR_HOLD_MS);
      return { x: pourPos.x, z: pourPos.z, holding: true, pourTilt: Math.sin(pt * Math.PI) * 1.1, facing: 0 };
    }
    case "WALK_BACK": {
      const x = lerp(pourPos.x, home.x, t);
      const z = lerp(pourPos.z, home.z, t);
      return { x, z, holding: t < 0.4, pourTilt: 0, facing: angleTo(pourPos, home) };
    }
    default:
      return { x: home.x, z: home.z, holding: false, pourTilt: 0, facing: null };
  }
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

    const frame = session.phase === "PICKING" ? characterFrame(round, playerId, now) : { x: PLAYER_HOME_POSITIONS[playerId]!.x, z: PLAYER_HOME_POSITIONS[playerId]!.z, holding: false, pourTilt: 0, facing: null };
    const bob = playerId === turnPlayer && round.turnPhase.startsWith("WALK") ? Math.sin(now / 90) * 0.05 : 0;
    rig.group.position.set(frame.x, bob, frame.z);
    if (frame.facing !== null) rig.group.rotation.y = frame.facing;

    // Held bottle attachment — one shared instance per current carrier, rebuilt when the pick
    // (slot) changes, parented into whoever's hand is currently holding it.
    if (playerId === turnPlayer && frame.holding && round.pendingPickSlotId !== null) {
      if (!ctx.heldBottle || ctx.heldBottle.forSlotId !== round.pendingPickSlotId) {
        if (ctx.heldBottle) ctx.heldBottle.group.parent?.remove(ctx.heldBottle.group);
        const slot = round.shelfSlots.find((s) => s.slotId === round.pendingPickSlotId)!;
        const group = createBottleMesh(slot.typeId);
        group.scale.setScalar(0.85);
        ctx.heldBottle = { group, forSlotId: round.pendingPickSlotId };
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
 * create-once/mutate-in-place cache. Shelf geometry only gets rebuilt when session.round is a
 * new object (a fresh round started). */
export function renderCauldronScene(ctx: SceneContext, session: CauldronChaosSession, now: number): void {
  if (ctx.cachedRound !== session.round) {
    if (ctx.heldBottle) {
      ctx.heldBottle.group.parent?.remove(ctx.heldBottle.group);
      ctx.heldBottle = null;
    }
    rebuildShelf(ctx, session);
    ctx.cachedRound = session.round;
  }

  updateShelfVisibility(ctx, session);
  updateCharacters(ctx, session, now);
  updateCauldronPulse(ctx, session, now);

  ctx.renderer.render(ctx.scene, ctx.camera);
}
