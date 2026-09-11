// Fully synthesized — no external audio files (same approach as Paint Party's audio.ts), since
// this is a brand-new game with no existing sound assets to fall back to. Everything here is a
// plain oscillator/noise burst with a gain envelope, no licensing concerns.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** Must be called from inside a real user gesture to satisfy autoplay policy. */
export function init(): void {
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
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** A bright two-note "ding" — a door successfully opening. Louder for the human's own opens,
 * quiet for CPUs (same loud/quiet-for-CPU convention Stampede Sprint uses for jump sounds). */
export function playDoorOpen(isHuman: boolean): void {
  const peak = isHuman ? 0.32 : 0.08;
  tone(880, 0, 0.1, "sine", peak);
  tone(1320, 0.06, 0.18, "sine", peak * 0.85);
}

/** A short discordant buzz — a failed (fake-door) open attempt. Human-only; CPUs' own failed
 * attempts are silent (it's their own private mistake, nothing for the human to react to). */
export function playDoorFail(): void {
  const c = getCtx();
  if (!master) return;
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 220;
  filter.Q.value = 4;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.32, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.22);
  src.connect(filter).connect(gain).connect(master);
  src.start();
  src.stop(c.currentTime + 0.24);
  tone(140, 0, 0.16, "sawtooth", 0.14);
}

/** A short upward whoosh — a player successfully exiting the maze. */
export function playExit(isHuman: boolean): void {
  const c = getCtx();
  if (!master) return;
  const peak = isHuman ? 0.3 : 0.1;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "triangle";
  const t0 = c.currentTime;
  osc.frequency.setValueAtTime(420, t0);
  osc.frequency.exponentialRampToValueAtTime(980, t0 + 0.22);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.3);
}

/** A low, heavy thud-and-rattle — every door slamming shut at once when the maze locks. */
export function playGameOver(): void {
  const c = getCtx();
  if (!master) return;
  const boom = c.createOscillator();
  const boomGain = c.createGain();
  boom.type = "sine";
  const t0 = c.currentTime;
  boom.frequency.setValueAtTime(140, t0);
  boom.frequency.exponentialRampToValueAtTime(38, t0 + 0.4);
  boomGain.gain.setValueAtTime(0.55, t0);
  boomGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
  boom.connect(boomGain).connect(master);
  boom.start(t0);
  boom.stop(t0 + 0.52);

  const rattle = c.createBufferSource();
  rattle.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1200;
  const rattleGain = c.createGain();
  rattleGain.gain.setValueAtTime(0.22, t0);
  rattleGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
  rattle.connect(filter).connect(rattleGain).connect(master);
  rattle.start(t0);
  rattle.stop(t0 + 0.32);
}

/** A lighter, quicker version of playGameOver's thud-and-rattle — the periodic "every open door
 * reshuts" reset, distinct from the final door-slam so the two don't read as the same event. */
export function playDoorsReshut(): void {
  const c = getCtx();
  if (!master) return;
  const t0 = c.currentTime;

  const boom = c.createOscillator();
  const boomGain = c.createGain();
  boom.type = "sine";
  boom.frequency.setValueAtTime(220, t0);
  boom.frequency.exponentialRampToValueAtTime(70, t0 + 0.22);
  boomGain.gain.setValueAtTime(0.34, t0);
  boomGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.26);
  boom.connect(boomGain).connect(master);
  boom.start(t0);
  boom.stop(t0 + 0.28);

  const rattle = c.createBufferSource();
  rattle.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1500;
  const rattleGain = c.createGain();
  rattleGain.gain.setValueAtTime(0.14, t0);
  rattleGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
  rattle.connect(filter).connect(rattleGain).connect(master);
  rattle.start(t0);
  rattle.stop(t0 + 0.18);
}

/** A soft, short filtered-noise "tap" — one footstep. Loud enough for the human to actually hear
 * their own pace, near-inaudible for CPUs (same loud/quiet-for-CPU convention every other cue in
 * this game uses) since up to 3 of them could be stepping at once. A touch of random pitch
 * wobble per call so a run of steps doesn't sound like a mechanical loop. */
export function playFootstep(volume: number): void {
  const c = getCtx();
  if (!master) return;
  const t0 = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 260 + Math.random() * 90;
  filter.Q.value = 1.1;
  const gain = c.createGain();
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
  src.stop(t0 + 0.08);
}
