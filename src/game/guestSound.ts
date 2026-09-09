// Guests never run their own GameSession.update() — hostLoop.ts's HostGameLoop is the only thing
// that ever drives real game logic, and it's the only GameSession wired to the real sound.ts hooks
// (see its constructor). A guest's local session is display-only, so none of the host's sound
// cues ever fire in a guest's own browser tab. This module replays the same audible cues locally
// by diffing consecutive snapshots — the instant something changes (a state transition, a newly
// revealed point, a new/claimed power-up, a countdown tick) is exactly the instant the host fired
// the matching cue, so detecting the change from data is equivalent to running the same code path.

import * as sound from "./sound.ts";
import { onlineNow } from "./onlineMode.ts";
import { LAST_CHANCE_MS, TICK_WINDOW_MS, VICTORY_CURTAIN_HOLD_MS, VICTORY_CURTAIN_OPEN_MS } from "./constants.ts";
import { ROUNDS } from "./rounds.ts";
import type { SnapshotPayload } from "./netProtocol.ts";
import type { GameState } from "./GameSession.ts";

interface GuestSoundState {
  state: GameState;
  roundIndex: number;
  revealedCount: number;
  lastTickSecond: number;
  victoryRevealed: boolean;
  powerupKeys: Set<number>;
  claimedKeys: Set<number>;
}

let prev: GuestSoundState | undefined;

/** Call once when a guest session starts (or restarts) so the next snapshot doesn't diff against
 * stale state from a previous connection/game. */
export function resetGuestSound(): void {
  prev = undefined;
}

function powerupKey(p: { cx: number; cy: number; spawnedAt: number }): number {
  return p.spawnedAt;
}

export function syncGuestSound(payload: SnapshotPayload): void {
  const isFinale = payload.roundIndex === ROUNDS.length - 1;
  const roundChanged = !prev || prev.roundIndex !== payload.roundIndex;
  const stateChanged = !prev || prev.state !== payload.state;

  // First snapshot ever seen for this session — just prime state, don't fire a barrage of cues
  // for whatever's already in progress (e.g. joining mid-round with power-ups already on screen).
  const isFirstSnapshot = !prev;

  if (!isFirstSnapshot && roundChanged && payload.state === "ROUND_INTRO") {
    sound.setUrgent(false);
    sound.setRoundSpeed(payload.roundIndex, isFinale);
    sound.playCurtain();
  }

  if (!isFirstSnapshot && stateChanged) {
    if (payload.state === "PLAYING") {
      sound.announceRoundStart();
      sound.startMusic();
    } else if (payload.state === "ROUND_RESULTS") {
      if (isFinale) sound.finalRoundEnd();
      else sound.roundEnd();
    } else if (payload.state === "VICTORY") {
      sound.playDrumroll();
    }
  }

  // Point-reveal cues: fire one per newly-revealed step since the last snapshot (only meaningful
  // mid-round-results for the same round; a round/state change already resets revealedCount).
  if (!isFirstSnapshot && !roundChanged && !stateChanged && payload.state === "ROUND_RESULTS" && prev) {
    for (let i = prev.revealedCount; i < payload.revealedCount; i++) {
      const step = payload.revealTimeline[i];
      if (step) sound.playPointReveal(step.rank);
    }
  }

  // The victory theme takes over from the drum roll once the curtain has actually finished
  // opening — elapsed-time-based, not a discrete field, so it's checked every snapshot instead of
  // only on a state change.
  let victoryRevealed = prev?.state === "VICTORY" && !roundChanged ? prev.victoryRevealed : false;
  if (payload.state === "VICTORY" && !victoryRevealed) {
    const elapsed = onlineNow() - payload.stateEnteredAt;
    if (elapsed >= VICTORY_CURTAIN_HOLD_MS + VICTORY_CURTAIN_OPEN_MS) {
      victoryRevealed = true;
      if (!isFirstSnapshot) {
        sound.stopDrumroll();
        sound.playVictoryTheme();
      }
    }
  }

  // Countdown tick, mirroring GameSession.updatePlaying's own lastTickSecond tracking.
  let lastTickSecond = roundChanged || stateChanged ? 0 : (prev?.lastTickSecond ?? 0);
  if (payload.state === "PLAYING") {
    const timeLeft = payload.roundEndAt - onlineNow();
    if (!isFirstSnapshot) sound.setUrgent(timeLeft <= LAST_CHANCE_MS && timeLeft > 0);
    if (timeLeft <= TICK_WINDOW_MS && timeLeft > 0) {
      const secsLeft = Math.ceil(timeLeft / 1000);
      if (secsLeft !== lastTickSecond) {
        lastTickSecond = secsLeft;
        if (!isFirstSnapshot) sound.playTick();
      }
    }
  }

  // Power-up spawn/claim cues — power-ups have no persistent id over the wire, so spawnedAt (a
  // timestamp) doubles as a stable-enough key to diff against the previous snapshot's set.
  const powerupKeys = new Set<number>();
  const claimedKeys = new Set<number>();
  for (const p of payload.powerups) {
    const key = powerupKey(p);
    powerupKeys.add(key);
    if (p.state === "claimed") {
      claimedKeys.add(key);
      if (!isFirstSnapshot && !prev!.claimedKeys.has(key)) sound.playClaim();
    }
  }
  if (!isFirstSnapshot) {
    for (const key of powerupKeys) {
      if (!prev!.powerupKeys.has(key)) sound.playSpawn();
    }
  }

  prev = {
    state: payload.state,
    roundIndex: payload.roundIndex,
    revealedCount: payload.revealedCount,
    lastTickSecond,
    victoryRevealed,
    powerupKeys,
    claimedKeys,
  };
}
