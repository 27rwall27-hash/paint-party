import * as THREE from "three";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  AMBIENT_LIGHT_INTENSITY,
  ARM_RAISED_ROT_X,
  ARM_REST_ROT_X,
  ARM_SWING_ROT_X,
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
  MARIO_ARM_SWING_SCALE,
  ORE_TIERS,
  PLAYER_COUNT,
  PLAYER_STAND_OFFSET,
  REVEAL_HOLD_MS,
  ROUND_CONFIGS,
  RUBBLE_CHUNK_COUNT,
  RUBBLE_SETTLE_MS,
  SHADOWS_ENABLED,
  SWING_DURATION_MS,
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

// --- Player-0 character model (user-provided .dae + textures, see public/models/char1/) --------
// Only the human (player 0) gets this model — CPUs keep the generic capsule rig (see
// buildCharacter) — both so the human stands out at a glance and because attaching a real skinned
// model to the pickaxe-pose rig for all 10 players would need this model's actual bone names,
// which we don't have reason to assume beyond a plain standing pose.

const CHAR_MODEL_URL = "/models/char1/mario.dae";

let charTemplatePromise: Promise<THREE.Object3D | null> | null = null;

/** Same auto-fit trick as loadRockTemplate, but fit to CHARACTER_HEIGHT by the model's own height
 * (not its longest dimension) and feet-aligned to y=0 rather than vertically centered, since this
 * one needs to stand on the ground next to the generic-rig characters, not float at a boulder's
 * resting height. */
function loadCharacterModelTemplate(): Promise<THREE.Object3D | null> {
  if (!charTemplatePromise) {
    charTemplatePromise = (async () => {
      try {
        const collada = await new ColladaLoader().loadAsync(CHAR_MODEL_URL);
        const loaded = collada!.scene;

        loaded.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const std = m as THREE.MeshStandardMaterial;
            if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
          }
          mesh.castShadow = SHADOWS_ENABLED;
          mesh.receiveShadow = true;
        });

        const root = new THREE.Group();
        root.add(loaded);

        const box = new THREE.Box3().setFromObject(loaded);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);
        const scale = CHARACTER_HEIGHT / (size.y || 1);
        root.scale.setScalar(scale);
        root.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

        return root;
      } catch (err) {
        console.error("Boulder Strike: failed to load the char1 model — using the generic rig instead.", err);
        return null;
      }
    })();
  }
  return charTemplatePromise;
}

// --- Pickaxe + gleam texture -------------------------------------------------------------------

function createGleamCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  return canvas;
}

/** Paints a bright glint — a soft colored glow with a hot white core, both shaped per-combo —
 * on a fully transparent background. Combined with additive blending on the plane material (see
 * createPickaxe), the dark/transparent background vanishes entirely and only the glow itself
 * shows, reading as a shine reflecting off the pickaxe's metal head rather than a flat sticker. */
function paintGleamCanvas(canvas: HTMLCanvasElement, combo: GleamCombo | null): void {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!combo) return;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  ctx.save();
  ctx.shadowColor = combo.color.hex;
  ctx.shadowBlur = canvas.width * 0.32;
  drawGleamShape(ctx, combo.shape, cx, cy, canvas.width * 0.3, combo.color.hex);
  drawGleamShape(ctx, combo.shape, cx, cy, canvas.width * 0.3, combo.color.hex);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = canvas.width * 0.16;
  drawGleamShape(ctx, combo.shape, cx, cy, canvas.width * 0.14, "#ffffff");
  ctx.restore();
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

  // The head's two points sit in the Y-Z plane (front/back along the handle's own swing arc),
  // NOT the X plane (left/right) — toolGrip only ever rotates around local X (see updateCharacters),
  // and a rotation around X does nothing to a point that already lies on the X axis, so points
  // sticking out sideways just spin in place instead of ever leading into the rock. Points in the
  // Y-Z plane instead sweep through the exact same arc as the handle, so the front point
  // genuinely arrives at the boulder at the bottom of the swing, like a real pickaxe.
  const headMat = new THREE.MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.25, metalness: 0.9 });
  const headFront = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.42, 4), headMat);
  headFront.rotation.x = -Math.PI / 2;
  headFront.position.set(0, 0.85, -0.2);
  headFront.castShadow = SHADOWS_ENABLED;
  group.add(headFront);
  const headBack = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.42, 4), headMat);
  headBack.rotation.x = Math.PI / 2;
  headBack.position.set(0, 0.85, 0.2);
  headBack.castShadow = SHADOWS_ENABLED;
  group.add(headBack);

  // A single upward-facing plane sitting on top of the head — from the game's elevated,
  // near-top-down camera this reads far better than a plane facing sideways (nearly edge-on from
  // that angle). DoubleSide so it stays visible even if the camera ever dips below it mid-swing.
  const gleamCanvas = createGleamCanvas();
  paintGleamCanvas(gleamCanvas, null);
  const gleamTexture = new THREE.CanvasTexture(gleamCanvas);
  const gleamPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 0.44),
    new THREE.MeshBasicMaterial({
      map: gleamTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  gleamPlane.rotation.x = -Math.PI / 2;
  gleamPlane.position.set(0, 1.06, 0);
  group.add(gleamPlane);

  return { group, gleamCanvas, gleamTexture, paintedComboId: undefined };
}

// --- Characters --------------------------------------------------------------------------------

/** Real named bones found on a loaded custom model (see buildCharacter) — captured once per
 * instance (each clone needs its own bone references) so updateCharacters can add rotation
 * offsets on top of the model's own bind pose, rather than overwriting it outright. */
interface CustomModelBones {
  armR?: THREE.Object3D;
  armRBase: THREE.Euler;
}

interface CharacterRig {
  group: THREE.Group;
  toolGrip: THREE.Group;
  pickaxe: PickaxeRig;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  customBones?: CustomModelBones;
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

/** `customModelTemplate` swaps the generic capsule body/head/legs/arms for a real loaded model
 * (used for player 0 only, see loadCharacterModelTemplate) — the leg/arm pivots still get built
 * as bare, mesh-less groups in that case so updateCharacters' walk/pose code has somewhere
 * harmless to write rotations into, without needing to special-case the update loop itself. */
function buildCharacter(color: string, customModelTemplate: THREE.Object3D | null): CharacterRig {
  const group = new THREE.Group();
  const hipY = CHARACTER_HEIGHT * 0.46;
  const shoulderY = CHARACTER_HEIGHT * 0.82;

  let legL: THREE.Group;
  let legR: THREE.Group;
  let armL: THREE.Group;
  let armR: THREE.Group;
  let customBones: CustomModelBones | undefined;

  if (customModelTemplate) {
    legL = new THREE.Group();
    legR = new THREE.Group();
    armL = new THREE.Group();
    armR = new THREE.Group();
    group.add(legL, legR, armL, armR);

    const body = cloneSkinned(customModelTemplate);
    group.add(body);

    // char1's rip keeps the original game's skeleton naming (Hip_1/LegL_1/ArmR_1/...) — drive the
    // arm raise/swing straight off the real ArmR_1 bone instead of our synthetic capsule pivots,
    // so the model's own arm actually moves along with the pickaxe. (LegL_1/LegR_1 exist too but
    // their bind poses turned out too asymmetric to drive safely — see updateCharacters.)
    const armRBone = body.getObjectByName("ArmR_1");
    customBones = {
      armR: armRBone,
      armRBase: armRBone ? armRBone.rotation.clone() : new THREE.Euler(),
    };
  } else {
    legL = buildLimbPivot(color, hipY * 0.85, CHARACTER_RADIUS * 0.24);
    legL.position.set(-CHARACTER_RADIUS * 0.3, hipY, 0);
    group.add(legL);
    legR = buildLimbPivot(color, hipY * 0.85, CHARACTER_RADIUS * 0.24);
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
    armL = buildLimbPivot(color, (shoulderY - hipY) * 0.75, CHARACTER_RADIUS * 0.18);
    armL.position.set(-CHARACTER_RADIUS * 0.68, shoulderY + 0.1, 0);
    group.add(armL);
    armR = buildLimbPivot(color, (shoulderY - hipY) * 0.75, CHARACTER_RADIUS * 0.18);
    armR.position.set(CHARACTER_RADIUS * 0.68, shoulderY + 0.1, 0);
    group.add(armR);
  }

  const toolGrip = new THREE.Group();
  toolGrip.position.set(0, shoulderY, 0);
  group.add(toolGrip);

  const pickaxe = createPickaxe();
  toolGrip.add(pickaxe.group);

  return { group, toolGrip, pickaxe, legL, legR, armL, armR, customBones };
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

// --- Rubble (a successfully-struck boulder crumbles into a small pile on the ground, instead of
// just shrinking away to nothing) ----------------------------------------------------------------

interface RubbleTransform {
  pos: THREE.Vector3;
  rot: THREE.Euler;
}

interface RubblePile {
  group: THREE.Group;
  chunks: THREE.Mesh[];
  burstTransforms: RubbleTransform[];
  settleTransforms: RubbleTransform[];
}

let rubbleGeometry: THREE.BufferGeometry | null = null;
let rubbleMaterial: THREE.MeshStandardMaterial | null = null;
function getRubbleGeometry(): THREE.BufferGeometry {
  if (!rubbleGeometry) rubbleGeometry = new THREE.IcosahedronGeometry(0.11, 0);
  return rubbleGeometry;
}
function getRubbleMaterial(): THREE.MeshStandardMaterial {
  if (!rubbleMaterial) rubbleMaterial = new THREE.MeshStandardMaterial({ color: 0x6e6255, roughness: 0.95 });
  return rubbleMaterial;
}

/** Builds one (initially hidden) rubble pile — every chunk starts at a "burst" transform
 * (scattered outward and slightly airborne) and eases into its final "settle" transform (a small
 * flat pile) the moment its boulder is struck; see showRubble. Geometry and material are shared
 * across every pile in the game (50 of them) since chunks are never individually recolored. */
function createRubblePile(): RubblePile {
  const group = new THREE.Group();
  group.visible = false;
  const chunks: THREE.Mesh[] = [];
  const burstTransforms: RubbleTransform[] = [];
  const settleTransforms: RubbleTransform[] = [];
  const geometry = getRubbleGeometry();
  const material = getRubbleMaterial();

  for (let i = 0; i < RUBBLE_CHUNK_COUNT; i++) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = SHADOWS_ENABLED;
    mesh.receiveShadow = true;

    const angle = (i / RUBBLE_CHUNK_COUNT) * Math.PI * 2 + Math.random() * 0.6;
    const settleRadius = 0.15 + Math.random() * 0.16;
    const settlePos = new THREE.Vector3(Math.cos(angle) * settleRadius, 0.05 + Math.random() * 0.04, Math.sin(angle) * settleRadius);
    const settleRot = new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    const burstPos = new THREE.Vector3(Math.cos(angle) * settleRadius * 2.6, 0.45 + Math.random() * 0.3, Math.sin(angle) * settleRadius * 2.6);
    const burstRot = new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);

    mesh.position.copy(burstPos);
    mesh.rotation.copy(burstRot);
    group.add(mesh);
    chunks.push(mesh);
    burstTransforms.push({ pos: burstPos, rot: burstRot });
    settleTransforms.push({ pos: settlePos, rot: settleRot });
  }

  return { group, chunks, burstTransforms, settleTransforms };
}

/** t=0 -> just struck (chunks at their scattered burst pose), t=1 -> fully settled pile. */
function showRubble(rubble: RubblePile, t: number): void {
  rubble.group.visible = true;
  const eased = 1 - Math.pow(1 - t, 3);
  rubble.chunks.forEach((chunk, i) => {
    const start = rubble.burstTransforms[i]!;
    const end = rubble.settleTransforms[i]!;
    chunk.position.lerpVectors(start.pos, end.pos, eased);
    chunk.rotation.set(
      lerp(start.rot.x, end.rot.x, eased),
      lerp(start.rot.y, end.rot.y, eased),
      lerp(start.rot.z, end.rot.z, eased),
    );
    chunk.scale.setScalar(lerp(0.55, 1, Math.min(1, eased * 1.4)));
  });
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
  rubble: RubblePile[][]; // [playerId][roundIndex]
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

  const [rockTemplate, charTemplate] = await Promise.all([loadRockTemplate(), loadCharacterModelTemplate()]);
  const boulders: BoulderInstance[][] = [];
  const rubble: RubblePile[][] = [];
  for (let playerId = 0; playerId < PLAYER_COUNT; playerId++) {
    const row: BoulderInstance[] = [];
    const rubbleRow: RubblePile[] = [];
    for (let roundIndex = 0; roundIndex < ROUND_COUNT; roundIndex++) {
      const boulder = instantiateBoulder(rockTemplate);
      boulder.root.position.set(laneX(playerId), BOULDER_RADIUS * 0.6, boulderZ(roundIndex));
      scene.add(boulder.root);
      row.push(boulder);

      const pile = createRubblePile();
      pile.group.position.set(laneX(playerId), BOULDER_RADIUS * 0.2, boulderZ(roundIndex));
      scene.add(pile.group);
      rubbleRow.push(pile);
    }
    boulders.push(row);
    rubble.push(rubbleRow);
  }

  const characters = session.identities.map((identity) => {
    const rig = buildCharacter(identity.color, identity.id === 0 ? charTemplate : null);
    rig.group.position.set(laneX(identity.id), 0, standZ(0));
    scene.add(rig.group);
    return rig;
  });

  const orePopupGroup = new THREE.Group();
  scene.add(orePopupGroup);

  return { renderer, scene, camera, characters, boulders, rubble, orePopupGroup, orePopups: [], revealedForRound: -1 };
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
    // shoulder rather than just tilted. The swing plays off the player's own release timestamp,
    // not the round's global phase — so it fires the instant the mouse comes up, whether that's
    // mid-GLEAMING (a fast correct release) or later, rather than waiting for every other player
    // to finish out the round first.
    let toolRotX = TOOL_REST_ROT_X;
    let toolY = TOOL_REST_POS.y;
    let toolZ = TOOL_REST_POS.z;
    let armRotX = ARM_REST_ROT_X;
    if (releasedAt !== null) {
      const t = clamp01((now - releasedAt) / SWING_DURATION_MS);
      toolRotX = lerp(TOOL_RAISED_ROT_X, TOOL_SWING_ROT_X, t);
      toolY = lerp(TOOL_RAISED_POS.y, TOOL_SWING_POS.y, t);
      toolZ = lerp(TOOL_RAISED_POS.z, TOOL_SWING_POS.z, t);
      armRotX = lerp(ARM_RAISED_ROT_X, ARM_SWING_ROT_X, t);
    } else if (session.phase === "RAISE" || session.phase === "GLEAMING") {
      toolRotX = TOOL_RAISED_ROT_X;
      toolY = TOOL_RAISED_POS.y;
      toolZ = TOOL_RAISED_POS.z;
      armRotX = ARM_RAISED_ROT_X;
    }
    rig.toolGrip.position.y = toolY;
    rig.toolGrip.position.z = toolZ;
    rig.toolGrip.rotation.x = toolRotX;
    rig.armL.rotation.x = armRotX;
    rig.armR.rotation.x = armRotX;

    // char1 (player 0's real model, when loaded): the pickaxe itself still swings via the
    // synthetic toolGrip above (already-proven motion, kept as the single source of truth for
    // where the axe actually is) — this just nudges the model's own leg/arm bones in the same
    // direction on top of their bind pose, so it visibly walks and raises/swings along with it,
    // rather than staying frozen in its loaded T-pose the whole game.
    // Leg bones intentionally NOT driven here: LegL_1's and LegR_1's bind-pose rotations turned
    // out wildly asymmetric (~0 vs ~180°, not a simple mirror), so the same additive swing put
    // one leg somewhere sane and the other somewhere the bind pose never anticipated, reading as
    // both legs bunching up off the ground rather than a stride, on every axis tried. Left at bind
    // pose rather than shipping that — the body still visibly walks (translates + bobs), just
    // without leg articulation. The pickaxe-arm swing below doesn't have this problem (ArmR_1's
    // bind pose is ~0, a normal T-pose extension) so it's still driven.
    const bones = rig.customBones;
    if (bones?.armR) bones.armR.rotation.x = bones.armRBase.x + armRotX * MARIO_ARM_SWING_SCALE;

    updatePickaxeGleam(rig.pickaxe, active ? active.combo : null);
  });
}

/** A correct release crumbles its boulder into a rubble pile the moment the swing lands
 * (SWING_DURATION_MS after release), independent of every other player — fast reflexes get
 * immediate payoff instead of waiting for the round to end. A miss (or never releasing at all)
 * leaves the boulder intact until the whole round wraps up, then fades it away, matching "any
 * rocks not shattered disappear at round end." Ore rewards are a separate, later step (see
 * rebuildOrePopups, gated on the REVEAL phase) — everyone's chance has to be over first. */
function updateBoulders(ctx: SceneContext, session: BoulderStrikeSession, now: number): void {
  const round = session.round;
  const roundIndex = round.roundIndex;
  const revealElapsed = session.phase === "REVEAL" ? now - session.phaseStartedAt : session.phase === "SCORED" || session.phase === "WALK" ? REVEAL_HOLD_MS : -1;

  for (let playerId = 0; playerId < PLAYER_COUNT; playerId++) {
    const boulder = ctx.boulders[playerId]![roundIndex]!;
    const rubble = ctx.rubble[playerId]![roundIndex]!;
    const { root, mesh } = boulder;
    const result = round.playerResult[playerId];
    const releasedAt = round.playerReleasedAt[playerId];

    if (result === "success" && releasedAt !== null) {
      const impactAt = releasedAt + SWING_DURATION_MS;
      if (now < impactAt) {
        root.visible = true;
        root.scale.setScalar(root.userData.baseScale ?? (root.userData.baseScale = root.scale.x));
        rubble.group.visible = false;
        continue;
      }
      root.visible = false;
      showRubble(rubble, clamp01((now - impactAt) / RUBBLE_SETTLE_MS));
      continue;
    }

    // Fail or never-attempted: stays intact until the whole round is over, then fades away.
    rubble.group.visible = false;
    if (revealElapsed < 0) {
      root.visible = true;
      root.scale.setScalar(root.userData.baseScale ?? (root.userData.baseScale = root.scale.x));
      continue;
    }
    const t = clamp01(revealElapsed / (REVEAL_HOLD_MS * 0.6));
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.transparent = true;
    mat.opacity = 1 - t;
    root.visible = t < 1;
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
