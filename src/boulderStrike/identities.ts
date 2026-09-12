import { CPU_NAME_PREFIX, PLAYER_COUNT, PRESET_COLORS } from "./constants.ts";

/** One of the 10 stable player identities — id 0 is always the human, ids 1-9 are CPU-filled. */
export interface PlayerIdentity {
  id: number;
  name: string;
  color: string;
  isBot: boolean;
}

export function createIdentities(): PlayerIdentity[] {
  const identities: PlayerIdentity[] = [];
  for (let i = 0; i < PLAYER_COUNT; i++) {
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
export function setHumanIdentity(identities: PlayerIdentity[], name: string, color: string): void {
  const human = identities[0];
  if (!human) return;
  human.name = name.trim() || "You";
  human.color = color;
}
