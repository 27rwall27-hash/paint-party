// Drop stampede-music.wav / stampede-leap.wav into public/audio/ to enable them — no settings UI,
// no upload flow. Namespaced with a "stampede-" prefix since public/audio/ is shared across the
// whole suite (Paint Party already has its own music.wav/start.wav/etc. living there). Any file
// you don't provide resolves to null here; sound.ts falls back to silence (music) or a tiny
// synthesized blip (leap), independently per slot.
//
// start/finish are the EXCEPTION: those intentionally point at Paint Party's own start.wav/
// finish.wav (already present in public/audio/) rather than Stampede-namespaced copies — reusing
// the same two cues across both games, per direct request, not duplicating the files.

export interface StampedeCustomAudio {
  music: HTMLAudioElement | null;
  leap: HTMLAudioElement | null;
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

export async function loadCustomAudio(): Promise<StampedeCustomAudio> {
  const [music, leap, start, finish] = await Promise.all([
    tryLoad("/audio/stampede-music.wav"),
    tryLoad("/audio/stampede-leap.wav"),
    tryLoad("/audio/start.wav"),
    tryLoad("/audio/finish.wav"),
  ]);
  return { music, leap, start, finish };
}
