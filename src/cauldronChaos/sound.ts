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

function tone(freq: number, dur: number, type: OscillatorType, peak: number): void {
  const c = getCtx();
  if (!master) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** A short bright blip as the witch calls out one ingredient — pitch varies by ingredient id so
 * the list has some melodic shape rather than being one flat repeated note. */
export function playCallBlip(ingredientId: number): void {
  const freq = 420 + (ingredientId % 8) * 55;
  tone(freq, 0.11, "triangle", 0.22);
}

/** A warm ascending chime — a safe pour. */
export function playSafePour(isHuman: boolean): void {
  const c = getCtx();
  if (!master) return;
  const peak = isHuman ? 0.3 : 0.1;
  const t0 = c.currentTime;
  [520, 780].forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = t0 + i * 0.07;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
    osc.connect(gain).connect(master!);
    osc.start(start);
    osc.stop(start + 0.18);
  });
}

/** A sputtering low buzz plus a noise burst — a wrong pour backfiring. Louder for the human. */
export function playBackfire(isHuman: boolean): void {
  const c = getCtx();
  if (!master) return;
  const peak = isHuman ? 0.34 : 0.11;
  const t0 = c.currentTime;

  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.3);
  gain.gain.setValueAtTime(peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.34);

  const noise = c.createBufferSource();
  noise.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 900;
  filter.Q.value = 1.2;
  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(peak * 0.7, t0);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
  noise.connect(filter).connect(noiseGain).connect(master);
  noise.start(t0);
  noise.stop(t0 + 0.22);
}

/** A short descending "poof" — a player knocked out for the round. Human-only, same convention
 * as every other game's failed-attempt cue: a CPU's own elimination is silent beyond the backfire. */
export function playEliminated(): void {
  const c = getCtx();
  if (!master) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(300, t0);
  osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.35);
  gain.gain.setValueAtTime(0.26, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.38);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.4);
}

/** A bright rolling flourish — a round's survivor is declared. */
export function playSurvive(): void {
  const c = getCtx();
  if (!master) return;
  [523, 659, 784].forEach((freq, i) => {
    const t0 = c.currentTime + i * 0.1;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.26, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    osc.connect(gain).connect(master!);
    osc.start(t0);
    osc.stop(t0 + 0.32);
  });
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
