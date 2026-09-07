import { announcePlayer, extractVideoId, musicPlayer } from "./youtube.ts";
import { deleteClip, loadClip, saveClip } from "./localAudio.ts";

export interface AudioSettings {
  musicVideoId: string | null;
  startVideoId: string | null;
  finishVideoId: string | null;
  musicBlob: Blob | null;
  startBlob: Blob | null;
  finishBlob: Blob | null;
  /** All three are 0-1. */
  musicVolume: number;
  startVolume: number;
  finishVolume: number;
}

const KEYS = {
  music: "paintparty_music_url",
  start: "paintparty_start_url",
  finish: "paintparty_finish_url",
};

const VOLUME_KEYS = {
  music: "paintparty_music_vol",
  start: "paintparty_start_vol",
  finish: "paintparty_finish_vol",
};

// Defaults are deliberately conservative — uploaded/linked clips vary wildly in mastering
// loudness, and the previous fixed 45-80% defaults were "far too loud" for most sources.
const DEFAULT_VOLUME = { music: 0.35, start: 0.5, finish: 0.5 };

const CLIP_KEYS = { music: "music", start: "start", finish: "finish" } as const;
type SlotName = keyof typeof CLIP_KEYS;

function toId(raw: string | null): string | null {
  return raw ? extractVideoId(raw) : null;
}

function loadVolume(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

export function loadSettings(): AudioSettings {
  return {
    musicVideoId: toId(localStorage.getItem(KEYS.music)),
    startVideoId: toId(localStorage.getItem(KEYS.start)),
    finishVideoId: toId(localStorage.getItem(KEYS.finish)),
    musicBlob: null,
    startBlob: null,
    finishBlob: null,
    musicVolume: loadVolume(VOLUME_KEYS.music, DEFAULT_VOLUME.music),
    startVolume: loadVolume(VOLUME_KEYS.start, DEFAULT_VOLUME.start),
    finishVolume: loadVolume(VOLUME_KEYS.finish, DEFAULT_VOLUME.finish),
  };
}

/** Reads any uploaded audio files from IndexedDB — async since IndexedDB is async. */
export async function loadLocalBlobs(): Promise<Pick<AudioSettings, "musicBlob" | "startBlob" | "finishBlob">> {
  const [musicBlob, startBlob, finishBlob] = await Promise.all([
    loadClip(CLIP_KEYS.music),
    loadClip(CLIP_KEYS.start),
    loadClip(CLIP_KEYS.finish),
  ]);
  return { musicBlob, startBlob, finishBlob };
}

export type SettingsListener = (settings: AudioSettings) => void;
const listeners: SettingsListener[] = [];

export function onSettingsChange(fn: SettingsListener): void {
  listeners.push(fn);
}

function notify(settings: AudioSettings): void {
  listeners.forEach((fn) => fn(settings));
}

async function fullSettings(): Promise<AudioSettings> {
  const blobs = await loadLocalBlobs();
  return { ...loadSettings(), ...blobs };
}

interface SlotEls {
  urlInput: HTMLInputElement;
  fileInput: HTMLInputElement | null;
  clearBtn: HTMLButtonElement | null;
  statusEl: HTMLElement | null;
  volumeInput: HTMLInputElement | null;
  hasFile: boolean;
}

/** Wires the DOM settings panel (see index.html) to localStorage + IndexedDB, notifying listeners on any change. */
export function initSettingsUI(): void {
  const musicInput = document.querySelector<HTMLInputElement>("#musicUrl");
  const startInput = document.querySelector<HTMLInputElement>("#startUrl");
  const finishInput = document.querySelector<HTMLInputElement>("#finishUrl");
  const saveBtn = document.querySelector<HTMLButtonElement>("#saveAudioBtn");
  const status = document.querySelector<HTMLSpanElement>("#audioSaveStatus");
  if (!musicInput || !startInput || !finishInput || !saveBtn || !status) return;

  musicInput.value = localStorage.getItem(KEYS.music) ?? "";
  startInput.value = localStorage.getItem(KEYS.start) ?? "";
  finishInput.value = localStorage.getItem(KEYS.finish) ?? "";

  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  function showStatus(text: string, isError: boolean): void {
    status!.textContent = text;
    status!.style.color = isError ? "#ff6b6b" : "#6ee7a0";
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      status!.textContent = "";
    }, 4000);
  }

  musicPlayer.onError = (msg) => showStatus(`Music link: ${msg}`, true);
  announcePlayer.onError = (msg) => showStatus(`Announcer link: ${msg}`, true);

  const slots: Record<SlotName, SlotEls> = {
    music: {
      urlInput: musicInput,
      fileInput: document.querySelector<HTMLInputElement>("#musicFile"),
      clearBtn: document.querySelector<HTMLButtonElement>('[data-clear="music"]'),
      statusEl: document.querySelector<HTMLElement>("#musicSourceStatus"),
      volumeInput: document.querySelector<HTMLInputElement>("#musicVolume"),
      hasFile: false,
    },
    start: {
      urlInput: startInput,
      fileInput: document.querySelector<HTMLInputElement>("#startFile"),
      clearBtn: document.querySelector<HTMLButtonElement>('[data-clear="start"]'),
      statusEl: document.querySelector<HTMLElement>("#startSourceStatus"),
      volumeInput: document.querySelector<HTMLInputElement>("#startVolume"),
      hasFile: false,
    },
    finish: {
      urlInput: finishInput,
      fileInput: document.querySelector<HTMLInputElement>("#finishFile"),
      clearBtn: document.querySelector<HTMLButtonElement>('[data-clear="finish"]'),
      statusEl: document.querySelector<HTMLElement>("#finishSourceStatus"),
      volumeInput: document.querySelector<HTMLInputElement>("#finishVolume"),
      hasFile: false,
    },
  };

  function updateSourceStatus(name: SlotName): void {
    const slot = slots[name];
    if (!slot.statusEl) return;
    if (slot.hasFile) slot.statusEl.textContent = "Using: uploaded file";
    else if (slot.urlInput.value.trim()) slot.statusEl.textContent = "Using: YouTube link";
    else slot.statusEl.textContent = "Using: built-in default";
  }

  (Object.keys(slots) as SlotName[]).forEach((name) => {
    const slot = slots[name];

    if (slot.volumeInput) {
      slot.volumeInput.value = String(Math.round(loadVolume(VOLUME_KEYS[name], DEFAULT_VOLUME[name]) * 100));
      slot.volumeInput.addEventListener("input", () => {
        const pct = Number(slot.volumeInput!.value);
        localStorage.setItem(VOLUME_KEYS[name], String(pct / 100));
        void fullSettings().then(notify);
      });
    }

    void loadClip(CLIP_KEYS[name]).then((blob) => {
      slot.hasFile = Boolean(blob);
      updateSourceStatus(name);
    });

    slot.fileInput?.addEventListener("change", () => {
      const file = slot.fileInput!.files?.[0];
      if (!file) return;
      void saveClip(CLIP_KEYS[name], file).then(async () => {
        slot.hasFile = true;
        updateSourceStatus(name);
        notify(await fullSettings());
        showStatus(`${name[0]!.toUpperCase()}${name.slice(1)} file uploaded`, false);
      });
    });

    slot.clearBtn?.addEventListener("click", () => {
      void deleteClip(CLIP_KEYS[name]).then(async () => {
        slot.hasFile = false;
        if (slot.fileInput) slot.fileInput.value = "";
        updateSourceStatus(name);
        notify(await fullSettings());
      });
    });

    slot.urlInput.addEventListener("input", () => updateSourceStatus(name));
  });

  saveBtn.addEventListener("click", () => {
    const fields: Array<[string, HTMLInputElement, string]> = [
      ["Music", musicInput, KEYS.music],
      ["Round Start Announcer", startInput, KEYS.start],
      ["Round Finished Announcer", finishInput, KEYS.finish],
    ];

    const badField = fields.find(([, input]) => {
      const raw = input.value.trim();
      return raw.length > 0 && !extractVideoId(raw);
    });
    if (badField) {
      showStatus(`${badField[0]}: couldn't read a video ID from that link`, true);
      return;
    }

    for (const [, input, key] of fields) {
      localStorage.setItem(key, input.value.trim());
    }
    (Object.keys(slots) as SlotName[]).forEach(updateSourceStatus);
    void fullSettings().then((settings) => {
      notify(settings);
      showStatus("Saved", false);
    });
  });
}
