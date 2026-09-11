// Fully synthesized — no external audio files, same approach as every other game's sound.ts.

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
    const len = Math.floor(c.sampleRate * 0.3);
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

/** A creaking rise as the lid swings open, revealing a fresh round's dice. */
export function playLidOpen(): void {
  const c = getCtx();
  if (!master) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(90, t0);
  osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.5);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.1, t0 + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.56);
}

/** A low wooden thud as the lid swings shut. */
export function playLidClose(): void {
  const c = getCtx();
  if (!master) return;
  const t0 = c.currentTime;
  const thud = c.createOscillator();
  const thudGain = c.createGain();
  thud.type = "sine";
  thud.frequency.setValueAtTime(160, t0);
  thud.frequency.exponentialRampToValueAtTime(50, t0 + 0.2);
  thudGain.gain.setValueAtTime(0.4, t0);
  thudGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
  thud.connect(thudGain).connect(master);
  thud.start(t0);
  thud.stop(t0 + 0.3);
}

/** A short neutral click — any player locking in a selection. Louder for the human. */
export function playSelectClick(isHuman: boolean): void {
  const peak = isHuman ? 0.26 : 0.07;
  tone(520, 0, 0.07, "square", peak);
}

/** A bright ascending chime — a CORRECT selection. */
export function playCorrect(isHuman: boolean): void {
  const peak = isHuman ? 0.3 : 0.09;
  tone(660, 0, 0.12, "sine", peak);
  tone(990, 0.07, 0.18, "sine", peak * 0.85);
}

/** A short descending buzz — a WRONG selection. Human-only, same convention as every other
 * game's failed-attempt cue: a CPU's own mistake is silent. */
export function playWrong(): void {
  const c = getCtx();
  if (!master) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(280, t0);
  osc.frequency.exponentialRampToValueAtTime(110, t0 + 0.22);
  gain.gain.setValueAtTime(0.24, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.24);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.26);
}

/** A rolling flourish — final round's results screen. */
export function playFanfare(): void {
  const c = getCtx();
  if (!master) return;
  [523, 659, 784, 1046].forEach((freq, i) => tone(freq, i * 0.11, 0.3, "triangle", 0.26));
  const rattle = c.createBufferSource();
  rattle.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 2000;
  const rattleGain = c.createGain();
  rattleGain.gain.setValueAtTime(0.12, c.currentTime);
  rattleGain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);
  rattle.connect(filter).connect(rattleGain).connect(master);
  rattle.start();
  rattle.stop(c.currentTime + 0.42);
}
