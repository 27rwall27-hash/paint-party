// Lets the user upload their own .wav (or any audio file) for music/announcer cues, stored
// locally in IndexedDB so it survives page reloads. Playback goes through a plain
// HTMLAudioElement — much simpler than the YouTube IFrame API, and works fully offline.

const DB_NAME = "paintparty-audio";
const STORE = "clips";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveClip(key: string, file: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(file, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadClip(key: string): Promise<Blob | null> {
  const db = await openDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return blob;
}

export async function deleteClip(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export class LocalAudioPlayer {
  private el = new Audio();

  constructor() {
    this.el.volume = 0.5;
  }

  playLooped(blob: Blob): void {
    this.el.src = URL.createObjectURL(blob);
    this.el.loop = true;
    void this.el.play();
  }

  playOnce(blob: Blob, maxDurationMs: number): void {
    this.el.src = URL.createObjectURL(blob);
    this.el.loop = false;
    void this.el.play();
    setTimeout(() => this.el.pause(), maxDurationMs);
  }

  pause(): void {
    this.el.pause();
  }

  resume(): void {
    void this.el.play();
  }

  setRate(rate: number): void {
    this.el.playbackRate = rate;
  }

  setVolume(volume: number): void {
    this.el.volume = Math.max(0, Math.min(1, volume));
  }
}
