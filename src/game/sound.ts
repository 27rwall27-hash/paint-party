// Director that sits between the game and two audio sources per slot (music / round-start /
// round-finish): a WAV file dropped into public/audio/ (see customAudio.ts), or the built-in
// synthesized engine (audio.ts) as the fallback — no settings UI, nothing to configure.
//
// Music plays continuously for the whole game once it starts — it's never stopped/restarted
// between rounds — and gets 8% faster (compounding) each round via setRoundSpeed().

import * as audio from "./audio.ts";
import { loadCustomAudio, type CustomAudioSet } from "./customAudio.ts";
import { FINALE_INTENSITY_STEP_PCT } from "./constants.ts";

// music/start/finish are 22% quieter than their original levels (0.35/0.5/0.5); start/finish/
// victory are then a further 10% quieter still (0.351/0.351/0.45).
const DEFAULT_VOLUME = { music: 0.273, start: 0.351, finish: 0.351, victory: 0.45, drumroll: 0.55 };

let custom: CustomAudioSet = { music: null, start: null, finish: null, victory: null, drumroll: null };
/** The current round's own tempo multiplier (1.08 ** roundIndex) — the finale's intensity ramp
 * adds to this rather than replacing it. */
let roundSpeedMultiplier = 1;
let musicStarted = false;

export function init(): void {
  // Only the synthesized fallback music loop has a separate volume knob from DEFAULT_VOLUME.music
  // (which only applies to a dropped-in music.wav) — matching the same 22% reduction here too.
  audio.setMusicVolume(0.78);
  void loadCustomAudio().then((loaded) => {
    custom = loaded;
    if (custom.music) {
      custom.music.loop = true;
      custom.music.volume = DEFAULT_VOLUME.music;
    }
    if (custom.start) custom.start.volume = DEFAULT_VOLUME.start;
    if (custom.finish) custom.finish.volume = DEFAULT_VOLUME.finish;
    if (custom.victory) {
      custom.victory.loop = true;
      custom.victory.volume = DEFAULT_VOLUME.victory;
    }
    if (custom.drumroll) custom.drumroll.volume = DEFAULT_VOLUME.drumroll;
  });
}

export function unlock(): void {
  audio.unlock();
}

/** Fired the instant the curtain finishes opening — before the round timer actually starts. */
export function announceRoundStart(): void {
  if (custom.start) {
    custom.start.currentTime = 0;
    void custom.start.play().catch(() => {});
  } else {
    audio.announceStart(DEFAULT_VOLUME.start);
  }
}

/**
 * Starts the background loop once per game session. Safe to call at the start of every round —
 * after the first call it just makes sure playback is live, it never reloads/restarts the track.
 */
export function startMusic(): void {
  if (musicStarted) {
    if (custom.music) void custom.music.play().catch(() => {});
    return;
  }
  musicStarted = true;
  if (custom.music) {
    void custom.music.play().catch(() => {});
  } else {
    audio.startMusic();
  }
}

/**
 * Call once per round (0-indexed) — each round is 8% faster than the last, compounding. Pitch is
 * preserved (tempo-only) for every normal round. The finale is the one exception: preservesPitch
 * flips off here, once, right at the start of that round — not mid-round on the ramp's first tick
 * — because toggling it on an already-playing track switches which resampling algorithm the
 * browser uses and produces an audible glitch; doing it once at the round transition (a moment
 * that's already an expected "new round" cue, curtain and tempo bump included) means the ramp
 * itself, once running, never has to flip anything again — it's just a continuous, uneventful
 * rate change from there.
 */
export function setRoundSpeed(roundIndex: number, isFinale: boolean): void {
  const multiplier = 1.08 ** roundIndex;
  roundSpeedMultiplier = multiplier;
  if (custom.music) {
    custom.music.preservesPitch = !isFinale;
    custom.music.playbackRate = multiplier;
  } else {
    audio.setTempoMultiplier(multiplier);
    audio.setPitchMultiplier(1);
  }
}

/** Finale-only: called every FINALE_INTENSITY_INTERVAL_MS starting from the moment the finale
 * begins playing (no delay — 0.5%/sec is gradual enough on its own), with an incrementing level —
 * ramps tempo AND pitch together on top of the round's own baseline speed. Linear, not compounding
 * — level 40 is +20% (40 * 0.5%), not 1.005^40. Never touches preservesPitch — setRoundSpeed
 * already set that once for the whole round, so this is just a plain rate update every tick. */
export function setFinaleIntensity(level: number): void {
  const multiplier = roundSpeedMultiplier * (1 + level * FINALE_INTENSITY_STEP_PCT);
  if (custom.music) custom.music.playbackRate = multiplier;
  else {
    audio.setTempoMultiplier(multiplier);
    audio.setPitchMultiplier(multiplier);
  }
}

function playFinishCue(): void {
  if (custom.finish) {
    custom.finish.currentTime = 0;
    void custom.finish.play().catch(() => {});
  } else {
    audio.announceFinish(DEFAULT_VOLUME.finish);
  }
}

function stopMusicPlayback(): void {
  if (custom.music) {
    custom.music.pause();
    custom.music.currentTime = 0;
    custom.music.playbackRate = 1;
  } else {
    audio.stopMusic();
  }
  musicStarted = false;
}

/** Round-end beat: just the "Finish!" cue — music keeps going, unchanged tempo. */
export function roundEnd(): void {
  playFinishCue();
  setUrgent(false);
}

/** Final round only: the music ends right on the "Finish!" cue, not later once scoring wraps up. */
export function finalRoundEnd(): void {
  playFinishCue();
  stopMusicPlayback();
  setUrgent(false);
}

/** Purely a percussion-flavor flag for the closing seconds of a round — never touches tempo. */
export function setUrgent(value: boolean): void {
  audio.setUrgent(value);
}

/** The big "Player X Wins!" reveal — loops the custom victory theme if provided, else a short
 * synth fanfare (which just plays once; there's nothing to loop without a real track). */
export function playVictoryTheme(): void {
  if (custom.victory) {
    custom.victory.currentTime = 0;
    void custom.victory.play().catch(() => {});
  } else {
    audio.playVictory(DEFAULT_VOLUME.victory);
  }
}

export function stopVictoryTheme(): void {
  if (custom.victory) {
    custom.victory.pause();
    custom.victory.currentTime = 0;
  }
}

/** Plays once as the victory curtain starts its suspense hold, before it opens onto the reveal. */
export function playDrumroll(): void {
  if (custom.drumroll) {
    custom.drumroll.currentTime = 0;
    void custom.drumroll.play().catch(() => {});
  } else {
    audio.playDrumroll();
  }
}

export function stopDrumroll(): void {
  if (custom.drumroll) {
    custom.drumroll.pause();
    custom.drumroll.currentTime = 0;
  }
}

export function playSplat(): void {
  audio.playSplat();
}

export function playKaboom(): void {
  audio.playKaboom();
}

export function playClaim(): void {
  audio.playClaim();
}

export function playTick(): void {
  audio.playTick();
}

export function playCurtain(): void {
  audio.playCurtain();
}

export function playSpawn(): void {
  audio.playSpawn();
}

export function playPointReveal(rank: 0 | 1 | 2): void {
  audio.playPointReveal(rank);
}
