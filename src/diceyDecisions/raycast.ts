import * as THREE from "three";
import type { SceneContext } from "./sceneBuilder.ts";

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

/** The one place THREE.Raycaster gets used — feeds a plain number back into the pure session as
 * ordinary input, one frame of lag behind the reticle's own movement (imperceptible at 60fps). */
export function pickSection(ctx: SceneContext, reticleNormalized: { x: number; y: number }): number | null {
  ndc.set(reticleNormalized.x * 2 - 1, -(reticleNormalized.y * 2 - 1));
  raycaster.setFromCamera(ndc, ctx.camera);
  const hits = raycaster.intersectObjects(ctx.floorSectionMeshes, false);
  if (hits.length === 0) return null;
  const hit = hits[0]!.object.userData.sectionIndex;
  return typeof hit === "number" ? hit : null;
}
