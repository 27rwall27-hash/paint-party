// Audio sources: stampede-music.wav / stampede-leap.wav dropped into public/audio/ (see
// customAudio.ts), or a tiny synthesized fallback for the leap sound only — there's no
// synthesized fallback track for music, so the game is simply quiet until a music file is
// provided. start.wav/finish.wav intentionally reuse Paint Party's own files rather than needing
// Stampede-specific copies (per direct request) — silent if those happen to be missing too.
//
// Music loops for the whole game and ramps MUSIC_SPEED_STEP_PCT faster every
// MUSIC_SPEED_INTERVAL_MS (compounding — 0.5%/second by default), capped at
// MUSIC_SPEED_MAX_MULTIPLIER — and stops the instant the finish cue finishes playing (see
// playFinish).

import { LEAP_VOLUME_CPU, LEAP_VOLUME_HUMAN, MUSIC_SPEED_INTERVAL_MS, MUSIC_SPEED_MAX_MULTIPLIER, MUSIC_SPEED_STEP_PCT, MUSIC_VOLUME, START_FINISH_VOLUME } from "./constants.ts";
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
    if (custom.start) custom.start.volume = START_FINISH_VOLUME;
    if (custom.finish) custom.finish.volume = START_FINISH_VOLUME;
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

/** A soft, round "hop" — a single sine oscillator bending gently up then back down, with a soft
 * (not instant) attack — the fallback used when no stampede-leap.wav is provided. Third design
 * this went through: the first was a plain upward sine sweep, the second added a downward triangle
 * chirp plus a square-wave click layered on top that read as too harsh/electronic; this drops the
 * extra click entirely and keeps a single mellow tone. */
function synthLeapBlip(volume: number): void {
  if (!audioCtx) audioCtx = new AudioContext();
  const ctx = audioCtx;
  const t0 = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(500, t0);
  osc.frequency.exponentialRampToValueAtTime(760, t0 + 0.06);
  osc.frequency.exponentialRampToValueAtTime(480, t0 + 0.18);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.02); // soft attack, not an instant click-in
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.23);
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
