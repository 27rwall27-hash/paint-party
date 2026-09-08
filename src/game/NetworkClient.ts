import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabaseClient.ts";
import type { PlayerInputState } from "./Input.ts";
import type {
  InputPayload,
  PaintBatchPayload,
  PresencePayload,
  RoomErrorPayload,
  SlotAssignPayload,
  SnapshotPayload,
} from "./netProtocol.ts";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — easy to read aloud
const MAX_PLAYERS = 4;

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
  private name = "Player";
  private lastSentInput: PlayerInputState | undefined;

  private slotAssignedHandlers: Array<(slot: number) => void> = [];
  private errorHandlers: Array<(message: string) => void> = [];
  private presenceSyncHandlers: Array<(entries: PresencePayload[]) => void> = [];
  private snapshotHandlers: Array<(payload: SnapshotPayload) => void> = [];
  private paintHandlers: Array<(payload: PaintBatchPayload) => void> = [];
  private guestInputHandlers: Array<(slot: number, state: PlayerInputState) => void> = [];

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
  onPaint(handler: (payload: PaintBatchPayload) => void): void {
    this.paintHandlers.push(handler);
  }
  /** Host-only: fires whenever a guest's input broadcast arrives. */
  onGuestInput(handler: (slot: number, state: PlayerInputState) => void): void {
    this.guestInputHandlers.push(handler);
  }

  private presenceEntries(): PresencePayload[] {
    const state = this.channel?.presenceState<PresencePayload>() ?? {};
    return Object.values(state)
      .flat()
      .map((p) => ({ clientId: p.clientId, name: p.name, slot: p.slot, isHost: p.isHost }));
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
    channel.on("broadcast", { event: "paint" }, ({ payload }) => {
      for (const handler of this.paintHandlers) handler(payload as PaintBatchPayload);
    });
  }

  /** Creates a new room, becoming its host. Resolves with the room code once subscribed. */
  createRoom(name: string): Promise<string> {
    this.name = name;
    this.isHost = true;
    this.mySlot = 0;
    const code = randomCode();
    const supabase = getSupabaseClient();
    const channel = supabase.channel(`room:${code}`, {
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

    return new Promise((resolve) => {
      channel.subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        void channel.track({ clientId: this.clientId, name: this.name, slot: 0, isHost: true } satisfies PresencePayload);
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
  joinRoom(code: string, name: string): void {
    this.name = name;
    this.isHost = false;
    const supabase = getSupabaseClient();
    const channel = supabase.channel(`room:${code.trim().toUpperCase()}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.clientId } },
    });
    this.channel = channel;
    this.wireCommonListeners();

    channel.on("broadcast", { event: "slot-assign" }, ({ payload }) => {
      const { clientId, slot } = payload as SlotAssignPayload;
      if (clientId !== this.clientId) return;
      this.mySlot = slot;
      void channel.track({ clientId: this.clientId, name: this.name, slot, isHost: false } satisfies PresencePayload);
      for (const handler of this.slotAssignedHandlers) handler(slot);
    });

    channel.on("broadcast", { event: "error" }, ({ payload }) => {
      const { clientId, message } = payload as RoomErrorPayload;
      if (clientId !== this.clientId) return;
      for (const handler of this.errorHandlers) handler(message);
    });

    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      void channel.track({ clientId: this.clientId, name: this.name, slot: null, isHost: false } satisfies PresencePayload);
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

  /** Host-only: broadcasts this interval's paint events to every guest. */
  broadcastPaint(payload: PaintBatchPayload): void {
    void this.channel?.send({ type: "broadcast", event: "paint", payload });
  }
}
