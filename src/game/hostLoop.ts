import { GameSession, type InputSource, type PaintEvent } from "./GameSession.ts";
import { InputManager, type PlayerInputState } from "./Input.ts";
import * as sound from "./sound.ts";
import { PLAYER_DEFS, type KeyBinding } from "./constants.ts";
import { ROUNDS } from "./rounds.ts";
import type { NetworkClient } from "./NetworkClient.ts";
import type { NetOutlineSpec, SnapshotPayload } from "./netProtocol.ts";

const EMPTY_INPUT: PlayerInputState = { up: false, down: false, left: false, right: false, paint: false };
const TICK_MS = 1000 / 30;
// Simulate at 30Hz but only broadcast every 3rd tick (~10Hz) — interpolation on guests smooths
// the gap, and this meaningfully cuts outbound Realtime message volume for free.
const BROADCAST_EVERY_N_TICKS = 3;

/** Feeds GameSession's per-player input from the host's own keyboard (slot 0) merged with
 * whatever guests last reported over the network (slots 1-3) — the exact same InputSource shape
 * local play and the old Node server both used, so GameSession itself needs no changes. */
class HostInputSource implements InputSource {
  private readonly localInput: InputManager;
  private readonly guestStates = new Map<number, PlayerInputState>();
  private startRequested = false;

  constructor(localInput: InputManager) {
    this.localInput = localInput;
  }

  setGuestInput(slot: number, state: PlayerInputState): void {
    this.guestStates.set(slot, state);
  }

  requestStart(): void {
    this.startRequested = true;
  }

  anyPaintPressed(): boolean {
    if (this.startRequested) {
      this.startRequested = false;
      return true;
    }
    // MENU->start is (also) gated behind the explicit "Start Match" button above, but every other
    // menu-style advance GameSession drives off this (VICTORY->GAME_OVER, GAME_OVER->MENU) has no
    // button at all online — it was only ever reachable via requestStart(), which meant those
    // screens were stuck forever online. Real held-paint state from the host and any guest now
    // counts too, same as local play's InputManager.anyPaintPressed().
    if (this.localInput.anyPaintPressed()) return true;
    for (const state of this.guestStates.values()) {
      if (state.paint) return true;
    }
    return false;
  }

  getInput(keys: KeyBinding): PlayerInputState {
    const slot = PLAYER_DEFS.findIndex((d) => d.keys.paint === keys.paint);
    if (slot === 0) return this.localInput.getInput(keys);
    return this.guestStates.get(slot) ?? EMPTY_INPUT;
  }
}

/** Owns the host's authoritative GameSession and its simulation tick — runs on setInterval, not
 * requestAnimationFrame, because rAF stops in a backgrounded tab and the host is the sole
 * authority; if it stopped simulating, the match would freeze for every connected guest too. */
export class HostGameLoop {
  readonly session: GameSession;
  private readonly inputSource: HostInputSource;
  private readonly client: NetworkClient;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTick = Date.now();
  private tickCount = 0;
  private pendingPaint: PaintEvent[] = [];

  constructor(client: NetworkClient) {
    this.client = client;
    this.inputSource = new HostInputSource(new InputManager());
    this.session = new GameSession(sound, (e) => this.pendingPaint.push(e));
    client.onGuestInput((slot, state) => this.inputSource.setGuestInput(slot, state));
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  requestStart(): void {
    this.inputSource.requestStart();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    const now = Date.now();
    const dt = Math.min(0.05, (now - this.lastTick) / 1000);
    this.lastTick = now;

    this.session.update(dt, now, this.inputSource);

    // Paint goes out every tick (30Hz), decoupled from the throttled full-snapshot broadcast
    // below — a continuous effect like the sweep brush generates a rect event most ticks, and
    // batching those at the same ~10Hz rate as the (much heavier) snapshot made painted trails
    // visibly lag behind the smoothly-interpolated sweep bar itself for guests. Paint messages are
    // small (a handful of {kind, outlineIndex, x, y, ...} objects), so the extra message volume is
    // cheap next to the win in perceived responsiveness.
    if (this.pendingPaint.length > 0) {
      this.client.broadcastPaint({ events: this.pendingPaint });
      this.pendingPaint = [];
    }

    // Positions also go out every tick, same reasoning as paint above — remote cursor movement
    // was interpolating across the throttled snapshot's ~100ms gap, which read as laggy.
    this.client.broadcastPositions({
      positions: this.session.players.map((p) => ({ id: p.id, x: p.x, y: p.y })),
    });

    this.tickCount++;
    if (this.tickCount % BROADCAST_EVERY_N_TICKS === 0) {
      this.broadcastSnapshot(now);
    }
  }

  private broadcastSnapshot(now: number): void {
    const cfg = ROUNDS[this.session.roundIndex];
    const payload: SnapshotPayload = {
      hostNow: now,
      state: this.session.state,
      roundIndex: this.session.roundIndex,
      roundEndAt: this.session.roundEndAt,
      stateEnteredAt: this.session.stateEnteredAt,
      resultsDurationMs: this.session.resultsDurationMs,
      resultsPerOutlineMs: this.session.resultsPerOutlineMs,
      resultsRevealEndMs: this.session.resultsRevealEndMs,
      outlineSpecs: cfg ? cfg.outlines.map((o): NetOutlineSpec => ({ ...o })) : [],
      players: this.session.players,
      powerups: this.session.powerups.map((p) => ({
        type: p.type,
        cx: p.cx,
        cy: p.cy,
        radius: p.radius,
        state: p.state,
        claimedBy: p.claimedBy,
        claimedAt: p.claimedAt,
        spawnedAt: p.spawnedAt,
        expiresAt: p.expiresAt,
      })),
      sweeps: this.session.sweeps,
      projectiles: this.session.projectiles,
      erasers: this.session.erasers,
      impacts: this.session.impacts,
      lastResults: this.session.lastResults,
      revealTimeline: this.session.revealTimeline,
      revealedCount: this.session.revealedCount,
    };
    this.client.broadcastSnapshot(payload);
  }
}
