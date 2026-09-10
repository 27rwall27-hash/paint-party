// Audio sources: stampede-music.wav / stampede-leap.wav dropped into public/audio/ (see
// customAudio.ts), or a tiny synthesized fallback for the leap sound only — there's no
// synthesized fallback track for music, so the game is simply quiet until a music file is
// provided. start.wav/finish.wav intentionally reuse Paint Party's own files rather than needing
// Stampede-specific copies (per direct request) — silent if those happen to be missing too.
//
// Music loops for the whole game and ramps MUSIC_SPEED_STEP_PCT faster every
// MUSIC_SPEED_INTERVAL_MS (compounding), capped at MUSIC_SPEED_MAX_MULTIPLIER — and stops the
// instant the finish cue finishes playing (see playFinish).

import { LEAP_VOLUME_CPU, LEAP_VOLUME_HUMAN, MUSIC_SPEED_INTERVAL_MS, MUSIC_SPEED_MAX_MULTIPLIER, MUSIC_SPEED_STEP_PCT, MUSIC_VOLUME } from "./constants.ts";
import { loadCustomAudio, type StampedeCustomAudio } from "./customAudio.ts";

let custom: StampedeCustomAudio = { music: null, leap: null, start: null, finish: null };
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

/** Pure function, also used directly by main.ts to drive the run-cycle animation's own speed-
 * ramped clock (see main.ts's animClockMs) so the visible running animation and the music tempo
 * are always reading off the exact same schedule. */
export function speedMultiplierAt(elapsedMs: number): number {
  const steps = Math.floor(Math.max(0, elapsedMs) / MUSIC_SPEED_INTERVAL_MS);
  return Math.min(MUSIC_SPEED_MAX_MULTIPLIER, (1 + MUSIC_SPEED_STEP_PCT) ** steps);
}

/** Call every frame with elapsed ms since startMusic() — a no-op if there's no music playing. */
export function updateMusicSpeed(elapsedMs: number): void {
  if (!custom.music || !musicStarted) return;
  custom.music.playbackRate = speedMultiplierAt(elapsedMs);
}

/** Plays right when a race begins. */
export function playStart(): void {
  if (!custom.start) return;
  custom.start.currentTime = 0;
  void custom.start.play().catch(() => {});
}

/** Plays the instant the game ends — and stops the background music the moment THIS finishes
 * playing (not immediately), so the finish cue rings out over the music rather than cutting it
 * off mid-note. If there's no finish.wav to wait on, music just stops right away instead. */
export function playFinish(): void {
  if (!custom.finish) {
    stopMusic();
    return;
  }
  custom.finish.currentTime = 0;
  custom.finish.addEventListener("ended", () => stopMusic(), { once: true });
  void custom.finish.play().catch(() => stopMusic());
}

/** A quick downward "hop" chirp (triangle sweep + a short square click layered on top) — the
 * fallback used when no stampede-leap.wav is provided. */
function synthLeapBlip(volume: number): void {
  if (!audioCtx) audioCtx = new AudioContext();
  const ctx = audioCtx;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(780, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(340, ctx.currentTime + 0.1);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.13);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.14);

  const click = ctx.createOscillator();
  const clickGain = ctx.createGain();
  click.type = "square";
  click.frequency.setValueAtTime(1400, ctx.currentTime);
  clickGain.gain.setValueAtTime(volume * 0.25, ctx.currentTime);
  clickGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
  click.connect(clickGain).connect(ctx.destination);
  click.start();
  click.stop(ctx.currentTime + 0.05);
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
