// Two audio sources: stampede-music.wav / stampede-leap.wav dropped into public/audio/ (see
// customAudio.ts), or a tiny synthesized fallback for the leap sound only — there's no
// synthesized fallback track for music, so the game is simply quiet until a music file is
// provided.
//
// Music loops for the whole game and ramps MUSIC_SPEED_STEP_PCT faster every
// MUSIC_SPEED_INTERVAL_MS (compounding), capped at MUSIC_SPEED_MAX_MULTIPLIER.

import { LEAP_VOLUME_CPU, LEAP_VOLUME_HUMAN, MUSIC_SPEED_INTERVAL_MS, MUSIC_SPEED_MAX_MULTIPLIER, MUSIC_SPEED_STEP_PCT, MUSIC_VOLUME } from "./constants.ts";
import { loadCustomAudio, type StampedeCustomAudio } from "./customAudio.ts";

let custom: StampedeCustomAudio = { music: null, leap: null };
let musicStarted = false;
let audioCtx: AudioContext | null = null;

export function init(): void {
  void loadCustomAudio().then((loaded) => {
    custom = loaded;
    if (custom.music) {
      custom.music.loop = true;
      custom.music.volume = MUSIC_VOLUME;
    }
  });
}

/** Safe to call every time a race starts — after the first call it just makes sure playback is
 * live, it never reloads/restarts the track (matching Paint Party's sound.ts convention). */
export function startMusic(): void {
  if (!custom.music) return;
  if (musicStarted) {
    void custom.music.play().catch(() => {});
    return;
  }
  musicStarted = true;
  custom.music.playbackRate = 1;
  void custom.music.play().catch(() => {});
}

export function stopMusic(): void {
  if (custom.music) {
    custom.music.pause();
    custom.music.currentTime = 0;
    custom.music.playbackRate = 1;
  }
  musicStarted = false;
}

/** Call every frame with elapsed ms since startMusic() — a no-op if there's no music playing. */
export function updateMusicSpeed(elapsedMs: number): void {
  if (!custom.music || !musicStarted) return;
  const steps = Math.floor(Math.max(0, elapsedMs) / MUSIC_SPEED_INTERVAL_MS);
  const rate = Math.min(MUSIC_SPEED_MAX_MULTIPLIER, (1 + MUSIC_SPEED_STEP_PCT) ** steps);
  custom.music.playbackRate = rate;
}

function synthLeapBlip(volume: number): void {
  if (!audioCtx) audioCtx = new AudioContext();
  const ctx = audioCtx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(520, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.16);
}

/** Plays the instant a racer actually leaves the ground — see main.ts's airborne-transition
 * detection. Loud for the human, very soft for CPUs (see LEAP_VOLUME_HUMAN/LEAP_VOLUME_CPU). */
export function playLeap(isHuman: boolean): void {
  const volume = isHuman ? LEAP_VOLUME_HUMAN : LEAP_VOLUME_CPU;
  if (custom.leap) {
    // Cloned so overlapping jumps (e.g. two CPUs leaving the ground the same tick) don't cut each
    // other's playback off.
    const el = custom.leap.cloneNode(true) as HTMLAudioElement;
    el.volume = volume;
    void el.play().catch(() => {});
  } else {
    synthLeapBlip(volume);
  }
}
