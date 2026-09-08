// Director that sits between the game and two audio sources per slot (music / round-start /
// round-finish): a WAV file dropped into public/audio/ (see customAudio.ts), or the built-in
// synthesized engine (audio.ts) as the fallback — no settings UI, nothing to configure.
//
// Music plays continuously for the whole game once it starts — it's never stopped/restarted
// between rounds — and gets 5% faster (compounding) each round via setRoundSpeed().

import * as audio from "./audio.ts";
import { loadCustomAudio, type CustomAudioSet } from "./customAudio.ts";

const DEFAULT_VOLUME = { music: 0.35, start: 0.5, finish: 0.5, victory: 0.5 };

let custom: CustomAudioSet = { music: null, start: null, finish: null, victory: null };
let musicStarted = false;

export function init(): void {
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
 * Call once per round (0-indexed) — each round is 5% faster than the last, compounding. This is
 * the ONLY thing that changes music tempo; nothing speeds it up mid-round.
 */
export function setRoundSpeed(roundIndex: number): void {
  const multiplier = 1.05 ** roundIndex;
  if (custom.music) custom.music.playbackRate = multiplier;
  else audio.setTempoMultiplier(multiplier);
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
    audio.playVictory();
  }
}

export function stopVictoryTheme(): void {
  if (custom.victory) {
    custom.victory.pause();
    custom.victory.currentTime = 0;
  }
}

export function playSplat(): void {
  audio.playSplat();
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
