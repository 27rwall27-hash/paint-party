import { CPU_NAME_PREFIX, PRESET_COLORS, RACER_COUNT } from "./constants.ts";

/** One of the 8 stable racer identities — exists across every currently-active race
 * simultaneously (see RaceInstance/StampedeSession); a race only ever reorders/clones these, it
 * never creates or removes one. */
export interface RacerIdentity {
  id: number;
  name: string;
  color: string;
  isBot: boolean;
}

/** id 0 is always the human; 1-7 are CPU-filled, matching Paint Party's "always full" local-play
 * convention (fillWithBots) but simpler — there's no lobby/active-flag concept here, just always
 * exactly 8. */
export function createIdentities(): RacerIdentity[] {
  const identities: RacerIdentity[] = [];
  for (let i = 0; i < RACER_COUNT; i++) {
    identities.push({
      id: i,
      name: i === 0 ? "You" : `${CPU_NAME_PREFIX} ${i}`,
      color: PRESET_COLORS[i % PRESET_COLORS.length]!,
      isBot: i !== 0,
    });
  }
  return identities;
}

/** Applies the setup screen's name/color pick to the human identity (id 0). */
export function setHumanIdentity(identities: RacerIdentity[], name: string, color: string): void {
  const human = identities[0];
  if (!human) return;
  human.name = name.trim() || "You";
  human.color = color;
}
