// Director that sits between the game and three audio backends: an uploaded local file
// (localAudio.ts), a user-supplied YouTube link (youtube.ts), or the built-in synthesized engine
// (audio.ts) — in that priority order, per slot (music / round-start / round-finish).
//
// Music plays continuously for the whole game once it starts — it's never stopped/restarted
// between rounds — and gets 5% faster (compounding) each round via setRoundSpeed().

import * as audio from "./audio.ts";
import { LocalAudioPlayer } from "./localAudio.ts";
import { loadLocalBlobs, loadSettings, onSettingsChange, type AudioSettings } from "./settings.ts";
import { announcePlayer, musicPlayer } from "./youtube.ts";

let settings: AudioSettings = {
  musicVideoId: null,
  startVideoId: null,
  finishVideoId: null,
  musicBlob: null,
  startBlob: null,
  finishBlob: null,
  musicVolume: 0.35,
  startVolume: 0.5,
  finishVolume: 0.5,
};
let musicStarted = false;
let musicBackend: "local" | "youtube" | "synth" = "synth";
let roundSpeedMultiplier = 1;

const localMusic = new LocalAudioPlayer();
const localAnnounce = new LocalAudioPlayer();

function applyMusicVolume(v: number): void {
  audio.setMusicVolume(v);
  localMusic.setVolume(v);
  if (musicBackend === "youtube") void musicPlayer.setVolume(v * 100);
}

export function init(): void {
  settings = loadSettings();
  applyMusicVolume(settings.musicVolume);
  onSettingsChange((next) => {
    const musicVolumeChanged = next.musicVolume !== settings.musicVolume;
    settings = next;
    if (musicVolumeChanged) applyMusicVolume(settings.musicVolume);
  });
  // Uploaded files live in IndexedDB, which is async — pull them in as soon as they're ready
  // (well before the first round ever needs them) rather than waiting for the settings UI to
  // touch a file input.
  void loadLocalBlobs().then((blobs) => {
    settings = { ...settings, ...blobs };
  });
}

export function unlock(): void {
  audio.unlock();
}

/** Fired the instant the curtain finishes opening — before the round timer actually starts. */
export function announceRoundStart(): void {
  if (settings.startBlob) {
    localAnnounce.setVolume(settings.startVolume);
    localAnnounce.playOnce(settings.startBlob, 4000);
  } else if (settings.startVideoId) {
    void announcePlayer.setVolume(settings.startVolume * 100);
    void announcePlayer.playOnce(settings.startVideoId, 4000);
  } else {
    audio.announceStart(settings.startVolume);
  }
}

/**
 * Starts the background loop once per game session. Safe to call at the start of every round —
 * after the first call it just makes sure playback is live, it never reloads/restarts the track.
 */
export function startMusic(): void {
  if (musicStarted) {
    if (musicBackend === "youtube") void musicPlayer.resume();
    else if (musicBackend === "local") localMusic.resume();
    return;
  }
  musicStarted = true;
  if (settings.musicBlob) {
    musicBackend = "local";
    localMusic.setVolume(settings.musicVolume);
    localMusic.playLooped(settings.musicBlob);
  } else if (settings.musicVideoId) {
    musicBackend = "youtube";
    void musicPlayer.playLooped(settings.musicVideoId);
    void musicPlayer.setVolume(settings.musicVolume * 100);
  } else {
    musicBackend = "synth";
    audio.startMusic();
  }
}

/**
 * Call once per round (0-indexed) — each round is 5% faster than the last, compounding. This is
 * the ONLY thing that changes music tempo; nothing speeds it up mid-round.
 */
export function setRoundSpeed(roundIndex: number): void {
  roundSpeedMultiplier = 1.05 ** roundIndex;
  if (musicBackend === "synth") audio.setTempoMultiplier(roundSpeedMultiplier);
  else if (musicBackend === "youtube") void musicPlayer.setRate(roundSpeedMultiplier);
  else if (musicBackend === "local") localMusic.setRate(roundSpeedMultiplier);
}

function playFinishCue(): void {
  if (settings.finishBlob) {
    localAnnounce.setVolume(settings.finishVolume);
    localAnnounce.playOnce(settings.finishBlob, 3500);
  } else if (settings.finishVideoId) {
    void announcePlayer.setVolume(settings.finishVolume * 100);
    void announcePlayer.playOnce(settings.finishVideoId, 3500);
  } else {
    audio.announceFinish(settings.finishVolume);
  }
}

function stopMusicPlayback(): void {
  if (musicBackend === "youtube") void musicPlayer.pause();
  else if (musicBackend === "local") localMusic.pause();
  else audio.stopMusic();
  musicStarted = false;
  roundSpeedMultiplier = 1;
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

export function gameOver(): void {
  stopMusicPlayback();
  audio.playVictory();
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
