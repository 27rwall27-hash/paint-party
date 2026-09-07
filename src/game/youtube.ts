// Thin wrapper around the YouTube IFrame Player API so a user can swap the built-in synthesized
// music/announcer for their own YouTube links. Two hidden players: one loops the music video for
// as long as a round is playing, the other loads whichever short clip is requested (start/finish
// announcer) and auto-stops after a few seconds.

interface YTPlayerInstance {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  setPlaybackRate(rate: number): void;
  loadVideoById(videoId: string): void;
  destroy(): void;
}

interface YTPlayerEvent {
  data: number;
}

interface YTNamespace {
  Player: new (
    elementId: string,
    opts: {
      height: string;
      width: string;
      playerVars: Record<string, number>;
      events: {
        onReady: () => void;
        onStateChange?: (e: YTPlayerEvent) => void;
        onError?: (e: YTPlayerEvent) => void;
      };
    },
  ) => YTPlayerInstance;
  PlayerState: { ENDED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

const ERROR_MESSAGES: Record<number, string> = {
  2: "Invalid video link",
  5: "This video can't be played embedded",
  100: "Video not found",
  101: "Owner disabled embedding for this video",
  150: "Owner disabled embedding for this video",
};

class ManagedPlayer {
  private player: YTPlayerInstance | null = null;
  private readyPromise: Promise<void> | null = null;
  private elementId: string;
  private looping = false;
  onError: ((message: string) => void) | null = null;

  constructor(elementId: string) {
    this.elementId = elementId;
  }

  private ensure(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = loadApi().then(
      (YTNS) =>
        new Promise<void>((resolve) => {
          this.player = new YTNS.Player(this.elementId, {
            height: "0",
            width: "0",
            playerVars: { autoplay: 0, controls: 0, disablekb: 1 },
            events: {
              onReady: () => resolve(),
              onStateChange: (e) => {
                if (this.looping && e.data === YTNS.PlayerState.ENDED) {
                  this.player?.seekTo(0, true);
                  this.player?.playVideo();
                }
              },
              onError: (e) => {
                this.onError?.(ERROR_MESSAGES[e.data] ?? "Couldn't play that video");
              },
            },
          });
        }),
    );
    return this.readyPromise;
  }

  async playLooped(videoId: string): Promise<void> {
    await this.ensure();
    this.looping = true;
    this.player?.loadVideoById(videoId);
  }

  async playOnce(videoId: string, maxDurationMs: number): Promise<void> {
    await this.ensure();
    this.looping = false;
    this.player?.loadVideoById(videoId);
    setTimeout(() => this.player?.pauseVideo(), maxDurationMs);
  }

  async pause(): Promise<void> {
    await this.ensure();
    this.player?.pauseVideo();
  }

  /** Resumes playback of whatever's already loaded, without reloading/restarting the video. */
  async resume(): Promise<void> {
    await this.ensure();
    this.player?.playVideo();
  }

  async setRate(rate: number): Promise<void> {
    await this.ensure();
    this.player?.setPlaybackRate(rate);
  }

  /** volume is 0-100, matching the YouTube IFrame API's own scale. */
  async setVolume(volume: number): Promise<void> {
    await this.ensure();
    this.player?.setVolume(Math.max(0, Math.min(100, volume)));
  }
}

export const musicPlayer = new ManagedPlayer("yt-music-mount");
export const announcePlayer = new ManagedPlayer("yt-announce-mount");

/** Extracts an 11-char YouTube video id from any common URL shape, or null if not recognized. */
export function extractVideoId(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const patterns = [/[?&]v=([\w-]{11})/, /youtu\.be\/([\w-]{11})/, /embed\/([\w-]{11})/, /shorts\/([\w-]{11})/];
  for (const p of patterns) {
    const m = trimmed.match(p);
    if (m) return m[1]!;
  }
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  return null;
}
