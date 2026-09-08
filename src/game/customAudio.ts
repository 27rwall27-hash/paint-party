// Drop music.wav / start.wav / finish.wav into public/audio/ to replace the built-in defaults —
// no settings UI, no upload flow. Any file you don't provide resolves to null here and sound.ts
// falls back to the synthesized music / Web Speech announcer for that slot, independently.

export interface CustomAudioSet {
  music: HTMLAudioElement | null;
  start: HTMLAudioElement | null;
  finish: HTMLAudioElement | null;
}

const PROBE_TIMEOUT_MS = 5000;

function tryLoad(path: string): Promise<HTMLAudioElement | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: HTMLAudioElement | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const el = new Audio(path);
    el.addEventListener("loadedmetadata", () => finish(el), { once: true });
    el.addEventListener("error", () => finish(null), { once: true });
    setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
  });
}

export async function loadCustomAudio(): Promise<CustomAudioSet> {
  const [music, start, finish] = await Promise.all([
    tryLoad("/audio/music.wav"),
    tryLoad("/audio/start.wav"),
    tryLoad("/audio/finish.wav"),
  ]);
  return { music, start, finish };
}
