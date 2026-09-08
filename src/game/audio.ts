// Small self-contained sound engine: everything here is synthesized with the Web Audio API
// at runtime (oscillators, filtered noise, gain envelopes). No external audio files, so there's
// nothing to license — the background loop is an original upbeat riff, not a copy of any game's
// soundtrack, and it speeds up in the closing seconds of a round for a "hurry up!" push.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** Must be called from inside a real user gesture (e.g. a keydown handler) to satisfy autoplay policy. */
export function unlock(): void {
  const c = getCtx();
  if (c.state === "suspended") void c.resume();
}

function getNoiseBuffer(c: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const len = Math.floor(c.sampleRate * 0.25);
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function tone(freq: number, startOffset: number, dur: number, type: OscillatorType, peak: number): void {
  const c = getCtx();
  if (!master) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + startOffset;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function playSplat(): void {
  const c = getCtx();
  if (!master) return;
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1400, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(180, c.currentTime + 0.15);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.5, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.18);
  src.connect(filter).connect(gain).connect(master);
  src.start();
  src.stop(c.currentTime + 0.2);
  tone(90, 0, 0.12, "sine", 0.3);
}

export function playClaim(): void {
  tone(660, 0, 0.12, "square", 0.2);
  tone(990, 0.08, 0.16, "square", 0.22);
}

/** A bright, airy chime the instant a power-up appears — distinct timbre from playClaim's
 * electronic square-wave beeps, so "one just showed up" reads differently from "you got one". */
export function playSpawn(): void {
  tone(880, 0, 0.1, "sine", 0.18);
  tone(1320, 0.05, 0.16, "sine", 0.16);
}

/** Round-results reveal cue, one per scoring rank — rank 0 (+3) is the most elaborate/exciting,
 * rank 2 (+1) the simplest, matching how much of a big deal that placement is. */
export function playPointReveal(rank: 0 | 1 | 2): void {
  if (rank === 2) {
    tone(700, 0, 0.12, "square", 0.22);
  } else if (rank === 1) {
    tone(700, 0, 0.1, "square", 0.2);
    tone(950, 0.06, 0.14, "square", 0.24);
  } else {
    tone(700, 0, 0.09, "square", 0.2);
    tone(950, 0.07, 0.1, "square", 0.22);
    tone(1300, 0.14, 0.26, "triangle", 0.3);
  }
}

/** Short countdown tick — plays once per second in the closing seconds of a round. */
export function playTick(): void {
  tone(1500, 0, 0.06, "square", 0.22);
}

export function playCurtain(): void {
  const c = getCtx();
  if (!master) return;
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer(c);
  src.loop = true;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.6;
  filter.frequency.setValueAtTime(200, c.currentTime);
  filter.frequency.linearRampToValueAtTime(1200, c.currentTime + 0.5);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.18, c.currentTime);
  gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.6);
  src.connect(filter).connect(gain).connect(master);
  src.start();
  src.stop(c.currentTime + 0.65);
}

export function playVictory(): void {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.35, "triangle", 0.28));
}

/** A snare-style drum roll that accelerates into a final crash — scheduled up front as a fixed
 * ~1.8s sequence (matching VICTORY_CURTAIN_HOLD_MS) rather than something render.ts loops, since
 * Web Audio lets every hit be scheduled by absolute future time in one shot. */
export function playDrumroll(): void {
  const c = getCtx();
  if (!master) return;
  const totalDur = 1.7;
  let t = 0;
  let gapMs = 130;
  while (t < totalDur) {
    snareHit(t, 0.55);
    t += gapMs / 1000;
    gapMs = Math.max(28, gapMs * 0.88); // accelerating roll
  }
  // Cymbal crash to punctuate the very end of the roll.
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 3000;
  const gain = c.createGain();
  const t0 = c.currentTime + totalDur;
  gain.gain.setValueAtTime(0.35, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
  src.stop(t0 + 0.55);
}

// --- Announcer (Web Speech API — a real synthesized voice, no audio files needed) ----------

function speak(text: string, pitch: number, rate: number, volume: number): void {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.pitch = pitch;
  u.rate = rate;
  u.volume = Math.max(0, Math.min(1, volume));
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => /en/i.test(v.lang) && /male|david|mark|daniel|alex|guy/i.test(v.name)) ??
    voices.find((v) => /en/i.test(v.lang));
  if (preferred) u.voice = preferred;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export function announceStart(volume: number): void {
  speak("Start!", 0.8, 1.05, volume);
}

export function announceFinish(volume: number): void {
  speak("Finish!", 0.8, 1.05, volume);
}

// --- Background loop ---------------------------------------------------------------------
// A short I-V-vi-IV pop progression, arpeggiated over a kick/snare pulse — an original riff,
// not a transcription of anything. Speeds up (and the pulse gets busier) in the last stretch.

const CHORDS = [
  [0, 4, 7], // I
  [7, 11, 14], // V
  [-3, 0, 4], // vi
  [5, 9, 12], // IV
];
const ARP_PATTERN = [0, 1, 2, 1];
const SCALE_ROOT = 392; // G4
const BASE_STEP_MS = 190;

let musicTimer: ReturnType<typeof setTimeout> | null = null;
let musicStep = 0;
let urgent = false;
let tempoMultiplier = 1;
let musicVolumeMul = 1;

function kick(offset: number, volumeMul = 1): void {
  const c = getCtx();
  if (!master) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  const t0 = c.currentTime + offset;
  osc.frequency.setValueAtTime(150, t0);
  osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
  gain.gain.setValueAtTime(0.5 * volumeMul, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.18);
}

function snareHit(offset: number, volumeMul = 1): void {
  const c = getCtx();
  if (!master) return;
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1800;
  const gain = c.createGain();
  const t0 = c.currentTime + offset;
  gain.gain.setValueAtTime(0.26 * volumeMul, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
  src.stop(t0 + 0.1);
}

function scheduleNext(): void {
  // Tempo only changes between rounds (tempoMultiplier) — "urgent" adds percussion flavor in the
  // closing seconds of a round (see playStep) but must never speed up playback mid-round.
  musicTimer = setTimeout(playStep, BASE_STEP_MS / tempoMultiplier);
}

function playStep(): void {
  const beat = musicStep % 4;
  const chord = CHORDS[Math.floor(musicStep / 4) % CHORDS.length]!;
  const semitone = chord[ARP_PATTERN[beat]!]!;
  const freq = SCALE_ROOT * 2 ** (semitone / 12);

  tone(freq, 0, urgent ? 0.15 : 0.2, "square", 0.085 * musicVolumeMul);
  if (beat === 0) {
    tone(freq / 2, 0, urgent ? 0.3 : 0.42, "triangle", 0.14 * musicVolumeMul);
    kick(0, musicVolumeMul);
  }
  if (beat === 2) {
    snareHit(0, musicVolumeMul);
    if (urgent) kick(0, musicVolumeMul);
  }

  musicStep++;
  scheduleNext();
}

export function startMusic(): void {
  if (musicTimer) return;
  musicStep = 0;
  playStep();
}

export function stopMusic(): void {
  if (musicTimer) clearTimeout(musicTimer);
  musicTimer = null;
}

export function setUrgent(value: boolean): void {
  urgent = value;
}

/** Scales the loop's tempo (1 = normal, 1.05 = 5% faster, ...) without restarting it. */
export function setTempoMultiplier(value: number): void {
  tempoMultiplier = value;
}

/** Volume for the synthesized music loop only (0-1) — doesn't affect SFX like splats/claims. */
export function setMusicVolume(value: number): void {
  musicVolumeMul = Math.max(0, Math.min(1, value));
}
