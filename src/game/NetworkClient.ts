import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabaseClient.ts";
import type { PlayerInputState } from "./Input.ts";
import type {
  FastPayload,
  InputPayload,
  PresencePayload,
  RoomErrorPayload,
  SlotAssignPayload,
  SnapshotPayload,
} from "./netProtocol.ts";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — easy to read aloud
const MAX_PLAYERS = 4;
// Exponential backoff between reconnect attempts, capped — a channel that drops from a brief
// network blip should recover almost immediately, but hammering Supabase every second during a
// real outage would just make things worse.
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 8000;
const RECONNECT_MAX_ATTEMPTS = 8;

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

function randomCode(): string {
  return Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
}

/** Wraps one Supabase Realtime channel for a room. Presence carries the live lobby roster;
 * broadcast carries everything else (slot assignment, input, snapshots, paint events). There is
 * no server anymore — whichever client calls createRoom() becomes the host and is responsible
 * for slot assignment and (via HostGameLoop) running the authoritative simulation. */
export class NetworkClient {
  readonly clientId = crypto.randomUUID();
  isHost = false;
  mySlot: number | undefined;

  private channel: RealtimeChannel | undefined;
  private roomTopic: string | undefined;
  private name = "Player";
  private color = "#e63946";
  private lastSentInput: PlayerInputState | undefined;
  // A dropped channel (rate limiting, a network blip, a backgrounded tab losing its socket —
  // anything) used to leave a client frozen forever: nothing in this class ever looked at any
  // subscribe status besides SUBSCRIBED, so a guest's session would just silently stop receiving
  // updates with no way back, while its own local audio (an unrelated HTMLAudioElement) kept
  // playing right through it — that mismatch is exactly what a hard freeze with live audio looks
  // like. reconnecting tracks whether a recovery attempt is already in flight so repeated error
  // events for the same drop don't stack up multiple parallel reconnect loops.
  private reconnecting = false;
  private reconnectAttempt = 0;

  private slotAssignedHandlers: Array<(slot: number) => void> = [];
  private errorHandlers: Array<(message: string) => void> = [];
  private presenceSyncHandlers: Array<(entries: PresencePayload[]) => void> = [];
  private snapshotHandlers: Array<(payload: SnapshotPayload) => void> = [];
  private fastHandlers: Array<(payload: FastPayload) => void> = [];
  private guestInputHandlers: Array<(slot: number, state: PlayerInputState) => void> = [];
  private connectionStatusHandlers: Array<(status: ConnectionStatus) => void> = [];

  onSlotAssigned(handler: (slot: number) => void): void {
    this.slotAssignedHandlers.push(handler);
  }
  onError(handler: (message: string) => void): void {
    this.errorHandlers.push(handler);
  }
  onPresenceSync(handler: (entries: PresencePayload[]) => void): void {
    this.presenceSyncHandlers.push(handler);
  }
  onSnapshot(handler: (payload: SnapshotPayload) => void): void {
    this.snapshotHandlers.push(handler);
  }
  onFast(handler: (payload: FastPayload) => void): void {
    this.fastHandlers.push(handler);
  }
  /** Host-only: fires whenever a guest's input broadcast arrives. */
  onGuestInput(handler: (slot: number, state: PlayerInputState) => void): void {
    this.guestInputHandlers.push(handler);
  }
  /** Fires on every connection-state transition: "reconnecting" the moment the channel drops for
   * any reason, "connected" once a fresh channel is subscribed again (including the very first
   * connect never firing this — callers already learn that from createRoom's/joinRoom's own
   * callbacks), "disconnected" once RECONNECT_MAX_ATTEMPTS is exhausted with no recovery. */
  onConnectionStatus(handler: (status: ConnectionStatus) => void): void {
    this.connectionStatusHandlers.push(handler);
  }
  private setStatus(status: ConnectionStatus): void {
    for (const handler of this.connectionStatusHandlers) handler(status);
  }

  private presenceEntries(): PresencePayload[] {
    const state = this.channel?.presenceState<PresencePayload>() ?? {};
    return Object.values(state)
      .flat()
      .map((p) => ({ clientId: p.clientId, name: p.name, color: p.color, slot: p.slot, isHost: p.isHost }));
  }

  private wireCommonListeners(): void {
    const channel = this.channel;
    if (!channel) return;
    channel.on("presence", { event: "sync" }, () => {
      const entries = this.presenceEntries();
      for (const handler of this.presenceSyncHandlers) handler(entries);
    });
    channel.on("broadcast", { event: "snapshot" }, ({ payload }) => {
      for (const handler of this.snapshotHandlers) handler(payload as SnapshotPayload);
    });
    channel.on("broadcast", { event: "fast" }, ({ payload }) => {
      for (const handler of this.fastHandlers) handler(payload as FastPayload);
    });
  }

  /** Builds (or rebuilds, on reconnect) the host's channel with every host-only listener wired —
   * a plain constructor step, deliberately with no subscribe() call, so both the first connect
   * and every later reconnect attempt share this one definition instead of drifting apart. */
  private buildHostChannel(): RealtimeChannel {
    const supabase = getSupabaseClient();
    const channel = supabase.channel(this.roomTopic!, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.clientId } },
    });
    this.channel = channel;
    this.wireCommonListeners();

    channel.on("broadcast", { event: "input" }, ({ payload }) => {
      const { slot, state } = payload as InputPayload;
      for (const handler of this.guestInputHandlers) handler(slot, state);
    });

    channel.on("presence", { event: "join" }, ({ newPresences }) => {
      for (const p of newPresences as unknown as PresencePayload[]) {
        if (p.clientId === this.clientId || p.slot !== null) continue;
        this.assignSlot(p.clientId);
      }
    });

    return channel;
  }

  /** Same idea as buildHostChannel, for a guest's channel. */
  private buildGuestChannel(): RealtimeChannel {
    const supabase = getSupabaseClient();
    const channel = supabase.channel(this.roomTopic!, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.clientId } },
    });
    this.channel = channel;
    this.wireCommonListeners();

    channel.on("broadcast", { event: "slot-assign" }, ({ payload }) => {
      const { clientId, slot } = payload as SlotAssignPayload;
      if (clientId !== this.clientId) return;
      this.mySlot = slot;
      void channel.track({
        clientId: this.clientId,
        name: this.name,
        color: this.color,
        slot,
        isHost: false,
      } satisfies PresencePayload);
      for (const handler of this.slotAssignedHandlers) handler(slot);
    });

    channel.on("broadcast", { event: "error" }, ({ payload }) => {
      const { clientId, message } = payload as RoomErrorPayload;
      if (clientId !== this.clientId) return;
      for (const handler of this.errorHandlers) handler(message);
    });

    return channel;
  }

  /** Runs on every subscribe() status change, for both the initial connect and every reconnect
   * attempt — recovers from CHANNEL_ERROR/TIMED_OUT/CLOSED instead of leaving the client stuck
   * forever on whatever it last received (see the comment on `reconnecting` above). */
  private handleSubscribeStatus(status: string): void {
    if (status === "SUBSCRIBED") {
      const wasReconnecting = this.reconnecting;
      this.reconnecting = false;
      this.reconnectAttempt = 0;
      if (wasReconnecting) this.setStatus("connected");
      return;
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnecting) return; // a retry is already in flight for this drop
    this.reconnecting = true;
    this.setStatus("reconnecting");
    this.attemptReconnect();
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
      this.setStatus("disconnected");
      return;
    }
    this.reconnectAttempt++;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnectAttempt - 1), RECONNECT_MAX_DELAY_MS);
    setTimeout(() => {
      const old = this.channel;
      if (old) getSupabaseClient().removeChannel(old);
      const channel = this.isHost ? this.buildHostChannel() : this.buildGuestChannel();
      channel.subscribe((status) => {
        this.handleSubscribeStatus(status);
        if (status !== "SUBSCRIBED") return;
        // A reconnecting client already knows who it is — re-announce presence directly instead
        // of waiting on the join flow again. For a guest that already had a slot, presenting with
        // that same non-null slot (rather than null) also keeps the host's "assign a slot to any
        // brand-new joiner" listener from mistaking this for a new player and handing out a
        // different one mid-match.
        if (this.isHost) {
          void channel.track({
            clientId: this.clientId,
            name: this.name,
            color: this.color,
            slot: 0,
            isHost: true,
          } satisfies PresencePayload);
        } else {
          void channel.track({
            clientId: this.clientId,
            name: this.name,
            color: this.color,
            slot: this.mySlot ?? null,
            isHost: false,
          } satisfies PresencePayload);
        }
      });
    }, delay);
  }

  /** Creates a new room, becoming its host. Resolves with the room code once subscribed. */
  createRoom(name: string, color: string): Promise<string> {
    this.name = name;
    this.color = color;
    this.isHost = true;
    this.mySlot = 0;
    const code = randomCode();
    this.roomTopic = `room:${code}`;
    const channel = this.buildHostChannel();

    return new Promise((resolve) => {
      channel.subscribe((status) => {
        this.handleSubscribeStatus(status);
        if (status !== "SUBSCRIBED") return;
        void channel.track({
          clientId: this.clientId,
          name: this.name,
          color: this.color,
          slot: 0,
          isHost: true,
        } satisfies PresencePayload);
        resolve(code);
      });
    });
  }

  private assignSlot(clientId: string): void {
    const channel = this.channel;
    if (!channel) return;
    const taken = new Set(this.presenceEntries().map((p) => p.slot));
    let slot = -1;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (!taken.has(i)) {
        slot = i;
        break;
      }
    }
    if (slot === -1) {
      void channel.send({ type: "broadcast", event: "error", payload: { clientId, message: "Room is full." } satisfies RoomErrorPayload });
      return;
    }
    void channel.send({ type: "broadcast", event: "slot-assign", payload: { clientId, slot } satisfies SlotAssignPayload });
  }

  /** Joins an existing room as a guest. */
  joinRoom(code: string, name: string, color: string): void {
    this.name = name;
    this.color = color;
    this.isHost = false;
    this.roomTopic = `room:${code.trim().toUpperCase()}`;
    const channel = this.buildGuestChannel();

    channel.subscribe((status) => {
      this.handleSubscribeStatus(status);
      if (status !== "SUBSCRIBED") return;
      void channel.track({
        clientId: this.clientId,
        name: this.name,
        color: this.color,
        slot: null,
        isHost: false,
      } satisfies PresencePayload);
    });
  }

  /** Guest-only: sends this client's latest input, deduped so it only actually sends on change. */
  sendInput(state: PlayerInputState): void {
    if (!this.channel || this.mySlot === undefined) return;
    const last = this.lastSentInput;
    if (
      last &&
      last.up === state.up &&
      last.down === state.down &&
      last.left === state.left &&
      last.right === state.right &&
      last.paint === state.paint
    ) {
      return;
    }
    this.lastSentInput = state;
    void this.channel.send({ type: "broadcast", event: "input", payload: { slot: this.mySlot, state } satisfies InputPayload });
  }

  /** Host-only: broadcasts a state snapshot to every guest. */
  broadcastSnapshot(payload: SnapshotPayload): void {
    void this.channel?.send({ type: "broadcast", event: "snapshot", payload });
  }

  /** Host-only: broadcasts every player's position, erasers, and this tick's paint events — see
   * FastPayload for why these ride together as one every-tick channel instead of the throttled
   * snapshot (or two separate every-tick messages, as they used to). */
  broadcastFast(payload: FastPayload): void {
    void this.channel?.send({ type: "broadcast", event: "fast", payload });
  }
}
