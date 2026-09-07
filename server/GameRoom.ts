import { GameSession, type PaintEvent } from "../src/game/GameSession.ts";
import type { InputSource } from "../src/game/GameSession.ts";
import { PLAYER_DEFS, type KeyBinding } from "../src/game/constants.ts";
import type { PlayerInputState } from "../src/game/Input.ts";
import { ROUNDS } from "../src/game/rounds.ts";
import type { ServerMessage } from "../src/game/netProtocol.ts";
import type { Room } from "./rooms.ts";

const EMPTY_INPUT: PlayerInputState = { up: false, down: false, left: false, right: false, paint: false };

/** Feeds GameSession's per-player input off whatever the room's sockets last reported, keyed by
 * player slot. GameSession asks for input via a `KeyBinding` object (the shape local play uses
 * to read real keycodes) — reverse the lookup by matching that binding's paint key back to the
 * PLAYER_DEFS slot it belongs to, so online play can reuse GameSession's update loop unchanged. */
class RoomInputSource implements InputSource {
  private states = new Map<number, PlayerInputState>();
  private startRequested = false;

  setInput(slot: number, state: PlayerInputState): void {
    this.states.set(slot, state);
  }

  requestStart(): void {
    this.startRequested = true;
  }

  anyPaintPressed(): boolean {
    if (this.startRequested) {
      this.startRequested = false;
      return true;
    }
    return false;
  }

  getInput(keys: KeyBinding): PlayerInputState {
    const slot = PLAYER_DEFS.findIndex((d) => d.keys.paint === keys.paint);
    return this.states.get(slot) ?? EMPTY_INPUT;
  }
}

const TICK_MS = 1000 / 30;

/** Owns one room's authoritative GameSession and its fixed-tick loop, broadcasting state and
 * paint events to every socket in the room. */
export class GameRoom {
  private readonly session: GameSession;
  private readonly inputs = new RoomInputSource();
  private readonly room: Room;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTick = 0;
  private pendingPaint: PaintEvent[] = [];
  private lastSentRoundIndex = -2;

  constructor(room: Room) {
    this.room = room;
    this.session = new GameSession(undefined, (e) => this.pendingPaint.push(e));
  }

  handleInput(slot: number, state: PlayerInputState): void {
    this.inputs.setInput(slot, state);
  }

  start(): void {
    if (this.timer) return;
    this.inputs.requestStart();
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    const now = Date.now();
    const dt = Math.min(0.05, (now - this.lastTick) / 1000);
    this.lastTick = now;

    this.session.update(dt, now, this.inputs);
    this.broadcastSnapshot();

    if (this.pendingPaint.length > 0) {
      this.room.broadcast({ type: "paint", events: this.pendingPaint } satisfies ServerMessage);
      this.pendingPaint = [];
    }
  }

  private broadcastSnapshot(): void {
    const cfg = ROUNDS[this.session.roundIndex];
    const roundChanged = this.session.roundIndex !== this.lastSentRoundIndex;
    if (roundChanged) this.lastSentRoundIndex = this.session.roundIndex;

    this.room.broadcast({
      type: "snapshot",
      state: this.session.state,
      roundIndex: this.session.roundIndex,
      roundEndAt: this.session.roundEndAt,
      stateEnteredAt: this.session.stateEnteredAt,
      resultsDurationMs: this.session.resultsDurationMs,
      resultsPerOutlineMs: this.session.resultsPerOutlineMs,
      outlineSpecs: roundChanged && cfg ? cfg.outlines.map((o) => ({ ...o })) : undefined,
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
    } satisfies ServerMessage);
  }
}
