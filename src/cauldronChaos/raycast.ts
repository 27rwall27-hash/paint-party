import * as THREE from "three";
import type { SceneContext } from "./sceneBuilder.ts";

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

/** The one place THREE.Raycaster gets used — feeds a plain ingredient type id back into the pure
 * session as ordinary input. */
export function pickShelfType(ctx: SceneContext, mouseNormalized: { x: number; y: number }): number | null {
  ndc.set(mouseNormalized.x * 2 - 1, -(mouseNormalized.y * 2 - 1));
  raycaster.setFromCamera(ndc, ctx.camera);
  const targets: THREE.Object3D[] = [];
  for (const bottle of ctx.bottleMeshesByType.values()) if (bottle.visible) targets.push(bottle);
  const hits = raycaster.intersectObjects(targets, true);
  if (hits.length === 0) return null;
  const typeId = hits[0]!.object.userData.typeId;
  return typeof typeId === "number" ? typeId : null;
}
