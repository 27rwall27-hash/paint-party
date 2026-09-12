import * as THREE from "three";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  AMBIENT_LIGHT_INTENSITY,
  ARM_RAISE_FOLLOW,
  BOULDER_RADIUS,
  BOULDER_SPACING,
  CAMERA_BACK,
  CAMERA_FOV,
  CAMERA_HEIGHT,
  CANVAS_H,
  CANVAS_W,
  CHARACTER_HEIGHT,
  CHARACTER_RADIUS,
  ENVIRONMENT_INTENSITY,
  KEY_LIGHT_INTENSITY,
  LANE_SPACING,
  ORE_TIERS,
  PLAYER_COUNT,
  PLAYER_STAND_OFFSET,
  REVEAL_HOLD_MS,
  ROUND_CONFIGS,
  SHADOWS_ENABLED,
  TOOL_RAISED_POS,
  TOOL_RAISED_ROT_X,
  TOOL_REST_POS,
  TOOL_REST_ROT_X,
  TOOL_SWING_POS,
  TOOL_SWING_ROT_X,
  WALK_DURATION_MS,
  type GleamCombo,
} from "./constants.ts";
import { drawGleamShape } from "./gleamShapes.ts";
import { activeGleamAt, type BoulderStrikeSession } from "./BoulderStrikeSession.ts";

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const ROUND_COUNT = ROUND_CONFIGS.length;

function laneX(playerId: number): number {
  return (playerId - (PLAYER_COUNT - 1) / 2) * LANE_SPACING;
}
function boulderZ(roundIndex: number): number {
  return -roundIndex * BOULDER_SPACING;
}
function standZ(roundIndex: number): number {
  return boulderZ(roundIndex) + PLAYER_STAND_OFFSET;
}
/** A point between the current round's boulder and where players stand for it — what the camera
 * re-centers on every round, so whichever boulder/pickaxes are actually in play stay framed
 * regardless of how far down the line the game has gotten. */
function cameraCenterZ(roundIndex: number): number {
  return boulderZ(roundIndex) + PLAYER_STAND_OFFSET / 2;
}

// --- Environment (soft ambient fill) --------------------------------------------------------

function createEnvironmentTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#5a4a3a");
  sky.addColorStop(0.5, "#2a2018");
  sky.addColorStop(1, "#0c0a08");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const glow = ctx.createRadialGradient(128, 20, 0, 128, 20, 90);
  glow.addColorStop(0, "rgba(255,214,90,0.4)");
  glow.addColorStop(1, "rgba(255,214,90,0)");
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

// --- Ground / boulders -------------------------------------------------------------------------

function buildGround(scene: THREE.Scene): void {
  const width = LANE_SPACING * PLAYER_COUNT + 4;
  const depth = BOULDER_SPACING * ROUND_COUNT + PLAYER_STAND_OFFSET + 5;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: 0x3a3128, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, boulderZ(ROUND_COUNT - 1) + (PLAYER_STAND_OFFSET + boulderZ(0)) / 2 - boulderZ(0) / 2);
  ground.position.z = (boulderZ(ROUND_COUNT - 1) + standZ(0)) / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

/** A boulder is a small wrapper (`root`, what gets positioned/scaled/rotated/hidden) around
 * whichever mesh actually carries the material (`mesh`, what the shatter/fade animation tweaks
 * opacity on) — kept separate because the loaded rock model nests its real mesh a couple of
 * levels deep inside its own scene-graph transforms, which we don't want to fight against by
 * scaling/rotating it directly. */
interface BoulderInstance {
  root: THREE.Object3D;
  mesh: THREE.Mesh;
}

function createProceduralBoulder(): BoulderInstance {
  const geo = new THREE.IcosahedronGeometry(BOULDER_RADIUS, 1);
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const scale = 0.82 + Math.random() * 0.32;
    pos.setXYZ(i, pos.getX(i) * scale, pos.getY(i) * scale, pos.getZ(i) * scale);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5c5248, roughness: 0.92 }));
  mesh.castShadow = SHADOWS_ENABLED;
  mesh.receiveShadow = true;
  return { root: mesh, mesh };
}

// --- Rock model (user-provided .dae + textures, see public/models/rock/) -------------------------

const ROCK_MODEL_URL = "/models/rock/Item_Ore_H.dae";
const ROCK_ALBEDO_URL = "/models/rock/item_ore_h_alb.png";
const ROCK_NORMAL_URL = "/models/rock/item_ore_h_nrm.png";
const ROCK_SPEC_URL = "/models/rock/item_ore_h_spm.png";

let rockTemplatePromise: Promise<THREE.Object3D | null> | null = null;

/** Loads the rock model once (cached across the whole game) and auto-fits it: centered at its own
 * origin and scaled so its longest dimension matches BOULDER_RADIUS*2, regardless of whatever
 * arbitrary unit scale the source file was authored in — so there's nothing to hand-tune if the
 * model gets swapped out later. Falls back to null (triggering the old procedural boulder) if the
 * model or its textures fail to load, rather than breaking the game. */
function loadRockTemplate(): Promise<THREE.Object3D | null> {
  if (!rockTemplatePromise) {
    rockTemplatePromise = (async () => {
      try {
        const collada = await new ColladaLoader().loadAsync(ROCK_MODEL_URL);
        const loaded = collada!.scene;

        // ColladaLoader already bakes the file's declared unit-to-meter conversion into `loaded`'s
        // own transform, so the box below is measured in real-world-ish units. Applying our own
        // fit scale/position directly onto `loaded` would OVERWRITE that baked-in transform instead
        // of composing with it (THREE.Object3D.scale/position are absolute, not relative), throwing
        // the result off by whatever factor the source unit conversion was. Wrapping it in a fresh,
        // still-identity group and fitting the wrapper instead sidesteps that entirely.
        const root = new THREE.Group();
        root.add(loaded);

        const box = new THREE.Box3().setFromObject(loaded);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = (BOULDER_RADIUS * 2) / maxDim;
        root.scale.setScalar(scale);
        root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

        const textureLoader = new THREE.TextureLoader();
        const [albedo, normal, spec] = await Promise.all([
          textureLoader.loadAsync(ROCK_ALBEDO_URL),
          textureLoader.loadAsync(ROCK_NORMAL_URL),
          textureLoader.loadAsync(ROCK_SPEC_URL),
        ]);
        albedo.colorSpace = THREE.SRGBColorSpace;

        root.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.material = new THREE.MeshStandardMaterial({
            map: albedo,
            normalMap: normal,
            roughnessMap: spec,
            roughness: 0.85,
            metalness: 0.05,
          });
          mesh.castShadow = SHADOWS_ENABLED;
          mesh.receiveShadow = true;
        });

        return root;
      } catch (err) {
        console.error("Boulder Strike: failed to load the rock model — using the procedural fallback instead.", err);
        return null;
      }
    })();
  }
  return rockTemplatePromise;
}

function instantiateBoulder(template: THREE.Object3D | null): BoulderInstance {
  if (!template) return createProceduralBoulder();
  const root = cloneSkinned(template);
  let mesh: THREE.Mesh | null = null;
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh && !mesh) {
      m.material = (m.material as THREE.MeshStandardMaterial).clone();
      mesh = m;
    }
  });
  if (!mesh) return createProceduralBoulder();
  // A little per-instance variety so 50 clones of the same low-poly rock don't read as obviously
  // identical, the way the old randomized-icosahedron boulders naturally varied.
  root.rotation.y = Math.random() * Math.PI * 2;
  const jitter = 0.88 + Math.random() * 0.24;
  root.scale.multiplyScalar(jitter);
  return { root, mesh };
}

// --- Pickaxe + gleam texture -------------------------------------------------------------------

function createGleamCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  return canvas;
}

function paintGleamCanvas(canvas: HTMLCanvasElement, combo: GleamCombo | null): void {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1c1712";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (combo) drawGleamShape(ctx, combo.shape, canvas.width / 2, canvas.height / 2, canvas.width * 0.36, combo.color.hex);
}

interface PickaxeRig {
  group: THREE.Group;
  gleamCanvas: HTMLCanvasElement;
  gleamTexture: THREE.CanvasTexture;
  paintedComboId: number | null | undefined;
}

function createPickaxe(): PickaxeRig {
  const group = new THREE.Group();

  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.85, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.8 }),
  );
  handle.position.y = 0.42;
  handle.castShadow = SHADOWS_ENABLED;
  group.add(handle);

  const headMat = new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.5, metalness: 0.55 });
  const headL = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.42, 4), headMat);
  headL.rotation.z = Math.PI / 2;
  headL.position.set(-0.2, 0.85, 0);
  headL.castShadow = SHADOWS_ENABLED;
  group.add(headL);
  const headR = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.42, 4), headMat);
  headR.rotation.z = -Math.PI / 2;
  headR.position.set(0.2, 0.85, 0);
  headR.castShadow = SHADOWS_ENABLED;
  group.add(headR);

  const gleamCanvas = createGleamCanvas();
  paintGleamCanvas(gleamCanvas, null);
  const gleamTexture = new THREE.CanvasTexture(gleamCanvas);
  const gleamPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ map: gleamTexture }),
  );
  gleamPlane.position.set(0, 0.85, 0.09);
  group.add(gleamPlane);
  const gleamPlaneBack = gleamPlane.clone();
  gleamPlaneBack.position.z = -0.09;
  gleamPlaneBack.rotation.y = Math.PI;
  group.add(gleamPlaneBack);

  return { group, gleamCanvas, gleamTexture, paintedComboId: undefined };
}

// --- Characters --------------------------------------------------------------------------------

interface CharacterRig {
  group: THREE.Group;
  toolGrip: THREE.Group;
  pickaxe: PickaxeRig;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
}

function buildLimbPivot(color: string | number, length: number, radius: number): THREE.Group {
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, length, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
  );
  mesh.position.y = -(length / 2 + radius);
  mesh.castShadow = SHADOWS_ENABLED;
  pivot.add(mesh);
  return pivot;
}

function buildCharacter(color: string): CharacterRig {
  const group = new THREE.Group();
  const hipY = CHARACTER_HEIGHT * 0.46;
  const shoulderY = CHARACTER_HEIGHT * 0.82;

  const legL = buildLimbPivot(color, hipY * 0.85, CHARACTER_RADIUS * 0.24);
  legL.position.set(-CHARACTER_RADIUS * 0.3, hipY, 0);
  group.add(legL);
  const legR = buildLimbPivot(color, hipY * 0.85, CHARACTER_RADIUS * 0.24);
  legR.position.set(CHARACTER_RADIUS * 0.3, hipY, 0);
  group.add(legR);

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(CHARACTER_RADIUS * 0.8, shoulderY - hipY, 6, 14),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55 }),
  );
  body.position.y = (hipY + shoulderY) / 2;
  body.castShadow = SHADOWS_ENABLED;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(CHARACTER_RADIUS * 0.62, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xe8c39e, roughness: 0.7 }),
  );
  head.position.y = shoulderY + CHARACTER_RADIUS * 0.75;
  head.castShadow = SHADOWS_ENABLED;
  group.add(head);

  // Both arms flank the tool grip and mirror its rotation (see updateCharacters), so a raised
  // pickaxe genuinely reads as a two-handed grip pulled back over the shoulder, not a one-armed
  // half-raise.
  const armL = buildLimbPivot(color, (shoulderY - hipY) * 0.75, CHARACTER_RADIUS * 0.18);
  armL.position.set(-CHARACTER_RADIUS * 0.68, shoulderY + 0.1, 0);
  group.add(armL);
  const armR = buildLimbPivot(color, (shoulderY - hipY) * 0.75, CHARACTER_RADIUS * 0.18);
  armR.position.set(CHARACTER_RADIUS * 0.68, shoulderY + 0.1, 0);
  group.add(armR);

  const toolGrip = new THREE.Group();
  toolGrip.position.set(0, shoulderY, 0);
  group.add(toolGrip);

  const pickaxe = createPickaxe();
  toolGrip.add(pickaxe.group);

  return { group, toolGrip, pickaxe, legL, legR, armL, armR };
}

// --- Ore reward gem (original low-poly design — a faceted crystal on an icy base) ---------------

function createOreGemMesh(color: string): THREE.Group {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.32, 0),
    new THREE.MeshPhysicalMaterial({ color: 0xcfe8ef, roughness: 0.35, transparent: true, opacity: 0.92, clearcoat: 0.4 }),
  );
  base.scale.set(1, 0.42, 1);
  group.add(base);

  const gemMat = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.12,
    transparent: true,
    opacity: 0.9,
    clearcoat: 0.8,
    emissive: color,
    emissiveIntensity: 0.25,
  });
  const mainSpike = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.62, 5), gemMat);
  mainSpike.position.set(-0.07, 0.42, 0);
  mainSpike.rotation.y = Math.PI / 6;
  group.add(mainSpike);

  const sideSpike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.38, 5), gemMat);
  sideSpike.position.set(0.2, 0.3, 0.04);
  sideSpike.rotation.y = -Math.PI / 5;
  group.add(sideSpike);

  return group;
}

// --- Scene context ------------------------------------------------------------------------------

interface OrePopup {
  group: THREE.Group;
  startedAt: number;
}

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  characters: CharacterRig[];
  boulders: BoulderInstance[][]; // [playerId][roundIndex]
  boulderHidden: boolean[][];
  orePopupGroup: THREE.Group;
  orePopups: OrePopup[];
  revealedForRound: number;
}

export async function createSceneContext(canvas: HTMLCanvasElement, session: BoulderStrikeSession): Promise<SceneContext> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(CANVAS_W, CANVAS_H, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = SHADOWS_ENABLED;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x120e0a);
  scene.environment = createEnvironmentMap(renderer);
  scene.environmentIntensity = ENVIRONMENT_INTENSITY;

  const fullRangeCenterZ = (boulderZ(ROUND_COUNT - 1) + standZ(0)) / 2;
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, CANVAS_W / CANVAS_H, 0.1, 120);
  camera.position.set(0, CAMERA_HEIGHT, cameraCenterZ(0) + CAMERA_BACK);
  camera.lookAt(0, 0.6, cameraCenterZ(0));

  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT_LIGHT_INTENSITY));
  const keyLight = new THREE.DirectionalLight(0xfff2df, KEY_LIGHT_INTENSITY);
  keyLight.position.set(6, 22, fullRangeCenterZ + 10);
  keyLight.castShadow = SHADOWS_ENABLED;
  if (SHADOWS_ENABLED) {
    keyLight.shadow.mapSize.set(2048, 2048);
    const cam = keyLight.shadow.camera as THREE.OrthographicCamera;
    const halfW = (LANE_SPACING * PLAYER_COUNT) / 2 + 3;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = 14;
    cam.bottom = -14;
    cam.near = 1;
    cam.far = 50;
  }
  scene.add(keyLight);

  buildGround(scene);

  const rockTemplate = await loadRockTemplate();
  const boulders: BoulderInstance[][] = [];
  const boulderHidden: boolean[][] = [];
  for (let playerId = 0; playerId < PLAYER_COUNT; playerId++) {
    const row: BoulderInstance[] = [];
    const hiddenRow: boolean[] = [];
    for (let roundIndex = 0; roundIndex < ROUND_COUNT; roundIndex++) {
      const boulder = instantiateBoulder(rockTemplate);
      boulder.root.position.set(laneX(playerId), BOULDER_RADIUS * 0.6, boulderZ(roundIndex));
      scene.add(boulder.root);
      row.push(boulder);
      hiddenRow.push(false);
    }
    boulders.push(row);
    boulderHidden.push(hiddenRow);
  }

  const characters = session.identities.map((identity) => {
    const rig = buildCharacter(identity.color);
    rig.group.position.set(laneX(identity.id), 0, standZ(0));
    scene.add(rig.group);
    return rig;
  });

  const orePopupGroup = new THREE.Group();
  scene.add(orePopupGroup);

  return { renderer, scene, camera, characters, boulders, boulderHidden, orePopupGroup, orePopups: [], revealedForRound: -1 };
}

// --- Per-frame updates -------------------------------------------------------------------------

function updatePickaxeGleam(pickaxe: PickaxeRig, combo: GleamCombo | null): void {
  const comboId = combo ? combo.id : null;
  if (pickaxe.paintedComboId === comboId) return;
  paintGleamCanvas(pickaxe.gleamCanvas, combo);
  pickaxe.gleamTexture.needsUpdate = true;
  pickaxe.paintedComboId = comboId;
}

function updateCharacters(ctx: SceneContext, session: BoulderStrikeSession, now: number): void {
  const round = session.round;
  const active = session.phase === "GLEAMING" ? activeGleamAt(round, now) : null;

  session.identities.forEach((_identity, playerId) => {
    const rig = ctx.characters[playerId]!;
    const result = round.playerResult[playerId];
    const releasedAt = round.playerReleasedAt[playerId];

    // Position: standing still except during WALK, when everyone steps forward to the next rock.
    const fromZ = standZ(round.roundIndex);
    const toZ = standZ(Math.min(round.roundIndex + 1, ROUND_COUNT - 1));
    let z = fromZ;
    let walking = false;
    if (session.phase === "WALK") {
      const t = clamp01((now - session.phaseStartedAt) / WALK_DURATION_MS);
      z = lerp(fromZ, toZ, t);
      walking = true;
    }
    const bob = walking ? Math.abs(Math.sin(now / 90)) * 0.05 : 0;
    rig.group.position.set(laneX(playerId), bob, z);

    const legSwing = walking ? Math.sin(now / 90) * 0.5 : 0;
    rig.legL.rotation.x = legSwing;
    rig.legR.rotation.x = -legSwing;

    // Pickaxe pose: rest (hanging), raised (pulled back overhead, both arms up — a real windup,
    // not a one-armed half-raise), or swing (whipped forward onto the boulder). Position AND
    // rotation both move between poses so "raised" genuinely reads as pulled back over the
    // shoulder rather than just tilted.
    let toolRotX = TOOL_REST_ROT_X;
    let toolY = TOOL_REST_POS.y;
    let toolZ = TOOL_REST_POS.z;
    if (session.phase === "RAISE" || session.phase === "GLEAMING") {
      toolRotX = TOOL_RAISED_ROT_X;
      toolY = TOOL_RAISED_POS.y;
      toolZ = TOOL_RAISED_POS.z;
    } else if (session.phase === "REVEAL") {
      const t = clamp01((now - session.phaseStartedAt) / (REVEAL_HOLD_MS * 0.4));
      if (releasedAt !== null) {
        const st = Math.min(1, t * 1.4);
        toolRotX = lerp(TOOL_RAISED_ROT_X, TOOL_SWING_ROT_X, st);
        toolY = lerp(TOOL_RAISED_POS.y, TOOL_SWING_POS.y, st);
        toolZ = lerp(TOOL_RAISED_POS.z, TOOL_SWING_POS.z, st);
      } // else: never even raised — stays at rest, no swing at all
    }
    rig.toolGrip.position.y = toolY;
    rig.toolGrip.position.z = toolZ;
    rig.toolGrip.rotation.x = toolRotX;
    const armFollow = (toolRotX - TOOL_REST_ROT_X) * ARM_RAISE_FOLLOW;
    rig.armL.rotation.x = armFollow;
    rig.armR.rotation.x = armFollow;

    updatePickaxeGleam(rig.pickaxe, active ? active.combo : null);
    void result;
  });
}

function updateBoulders(ctx: SceneContext, session: BoulderStrikeSession, now: number): void {
  const round = session.round;
  const revealElapsed = session.phase === "REVEAL" ? now - session.phaseStartedAt : session.phase === "SCORED" || session.phase === "WALK" ? REVEAL_HOLD_MS : -1;

  for (let playerId = 0; playerId < PLAYER_COUNT; playerId++) {
    const boulder = ctx.boulders[playerId]![round.roundIndex]!;
    const { root, mesh } = boulder;
    if (ctx.boulderHidden[playerId]![round.roundIndex]) {
      root.visible = false;
      continue;
    }
    if (revealElapsed < 0) {
      root.visible = true;
      root.scale.setScalar(root.userData.baseScale ?? (root.userData.baseScale = root.scale.x));
      continue;
    }
    const success = round.playerResult[playerId] === "success";
    const t = clamp01(revealElapsed / (REVEAL_HOLD_MS * 0.6));
    const baseScale: number = root.userData.baseScale ?? root.scale.x;
    if (success) {
      root.scale.setScalar(Math.max(0, baseScale * (1 - t * 1.3)));
      root.rotation.y += 0.25;
      if (t >= 1) {
        root.visible = false;
        ctx.boulderHidden[playerId]![round.roundIndex] = true;
      }
    } else {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = 1 - t;
      if (t >= 1) {
        root.visible = false;
        ctx.boulderHidden[playerId]![round.roundIndex] = true;
      }
    }
  }
}

function rebuildOrePopups(ctx: SceneContext, session: BoulderStrikeSession, now: number): void {
  ctx.orePopupGroup.clear();
  ctx.orePopups = [];
  const round = session.round;
  round.rankedPlayerIds.forEach((playerId, rank) => {
    const tier = ORE_TIERS[rank]!;
    const gem = createOreGemMesh(tier.color);
    gem.position.set(laneX(playerId), 1.1, boulderZ(round.roundIndex));
    ctx.orePopupGroup.add(gem);
    ctx.orePopups.push({ group: gem, startedAt: now });
  });
}

function updateOrePopups(ctx: SceneContext, now: number): void {
  for (const popup of ctx.orePopups) {
    const t = clamp01((now - popup.startedAt) / REVEAL_HOLD_MS);
    popup.group.position.y = 1.1 + t * 1.1;
    popup.group.rotation.y = t * Math.PI * 2.2;
    const scale = t < 0.15 ? t / 0.15 : t > 0.75 ? Math.max(0, 1 - (t - 0.75) / 0.25) : 1;
    popup.group.scale.setScalar(scale);
  }
}

function updateCamera(ctx: SceneContext, session: BoulderStrikeSession, now: number): void {
  const roundIndex = session.round.roundIndex;
  let centerZ = cameraCenterZ(roundIndex);
  if (session.phase === "WALK") {
    const t = clamp01((now - session.phaseStartedAt) / WALK_DURATION_MS);
    const nextIndex = Math.min(roundIndex + 1, ROUND_COUNT - 1);
    centerZ = lerp(cameraCenterZ(roundIndex), cameraCenterZ(nextIndex), t);
  }
  ctx.camera.position.set(0, CAMERA_HEIGHT, centerZ + CAMERA_BACK);
  ctx.camera.lookAt(0, 0.6, centerZ);
}

/** Re-derives every visible fact from session/now on every call — ctx's meshes are purely a
 * create-once/mutate-in-place cache. */
export function renderBoulderScene(ctx: SceneContext, session: BoulderStrikeSession, now: number): void {
  updateCamera(ctx, session, now);
  if (session.phase === "REVEAL" && ctx.revealedForRound !== session.round.roundIndex) {
    rebuildOrePopups(ctx, session, now);
    ctx.revealedForRound = session.round.roundIndex;
  }
  if (session.phase !== "REVEAL" && session.phase !== "SCORED") {
    if (ctx.orePopups.length > 0) {
      ctx.orePopupGroup.clear();
      ctx.orePopups = [];
    }
  }

  updateCharacters(ctx, session, now);
  updateBoulders(ctx, session, now);
  updateOrePopups(ctx, now);

  ctx.renderer.render(ctx.scene, ctx.camera);
}
