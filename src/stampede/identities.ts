import { BR_TOTAL_PLAYERS } from "./battleRoyaleConstants.ts";
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

/** The 24-player roster for Battle Royale mode — id 0 is still always the human ("You"), same
 * convention as Classic's createIdentities, so every existing `identity.id === 0` isHuman check
 * keeps working unchanged. Colors cycle the same 8-color PRESET_COLORS (repeats 3x across the
 * roster) — fine since the 24 players are visually split into 3 separate bands, not shown
 * together, so no global color-uniqueness is needed. WHICH section/slot each identity lands in is
 * decided in BattleRoyaleSession.ts (that's what randomizes the human's placement), not here —
 * this just decides who exists. */
export function createBattleRoyaleIdentities(): RacerIdentity[] {
  const identities: RacerIdentity[] = [];
  for (let i = 0; i < BR_TOTAL_PLAYERS; i++) {
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
