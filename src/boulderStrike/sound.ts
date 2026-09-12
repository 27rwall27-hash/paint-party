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

/** A short, distinct blip for a decoy gleam — pitch mapped to the shape (4 shapes -> 4 pitches)
 * so, in principle, sound alone hints at what just flashed. */
export function playDecoyBlip(shapeIndex: number): void {
  const c = getCtx();
  if (!master) return;
  const freq = 340 + shapeIndex * 90;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.14, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.12);
}

/** A brighter, ringing chime — the real target gleam. Deliberately distinct timbre (not just
 * pitch) from the decoy blips so it can be told apart by ear. */
export function playTargetChime(): void {
  const c = getCtx();
  if (!master) return;
  const t0 = c.currentTime;
  [880, 1320].forEach((freq, i) => {
    const start = t0 + i * 0.05;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.24, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
    osc.connect(gain).connect(master!);
    osc.start(start);
    osc.stop(start + 0.26);
  });
}

/** A satisfying crack — a successfully shattered boulder. Louder for the human. */
export function playShatter(isHuman: boolean): void {
  const c = getCtx();
  if (!master) return;
  const peak = isHuman ? 0.36 : 0.12;
  const t0 = c.currentTime;

  const noise = c.createBufferSource();
  noise.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1400;
  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(peak, t0);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
  noise.connect(filter).connect(noiseGain).connect(master);
  noise.start(t0);
  noise.stop(t0 + 0.24);

  const thud = c.createOscillator();
  const thudGain = c.createGain();
  thud.type = "sine";
  thud.frequency.setValueAtTime(160, t0);
  thud.frequency.exponentialRampToValueAtTime(60, t0 + 0.18);
  thudGain.gain.setValueAtTime(peak * 0.7, t0);
  thudGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
  thud.connect(thudGain).connect(master);
  thud.start(t0);
  thud.stop(t0 + 0.22);
}

/** A dull clank — a mistimed swing bouncing off the rock. Human-only, same convention as every
 * other game's failed-attempt cue. */
export function playWhiff(): void {
  const c = getCtx();
  if (!master) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(220, t0);
  osc.frequency.exponentialRampToValueAtTime(120, t0 + 0.1);
  gain.gain.setValueAtTime(0.22, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.16);
}

/** The final results fanfare. */
export function playFanfare(): void {
  const c = getCtx();
  if (!master) return;
  [523, 659, 784, 1046].forEach((freq, i) => {
    const t0 = c.currentTime + i * 0.11;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.28, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    osc.connect(gain).connect(master!);
    osc.start(t0);
    osc.stop(t0 + 0.32);
  });
}
