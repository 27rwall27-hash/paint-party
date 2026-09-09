import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabaseClient.ts";
import type { PlayerInputState } from "./Input.ts";
import type {
  FastPayload,
  InputPayload,
  PresencePayload,
  RenamePayload,
  RoomClosedPayload,
  RoomErrorPayload,
  SlotAssignPayload,
  SnapshotPayload,
} from "./netProtocol.ts";

/** Host-only, supplied by onlineUI.ts (which owns the actual GameSession/roster) so NetworkClient
 * itself stays pure networking with no dependency on game types. `canAcceptJoins` gates whether a
 * brand-new joiner can be seated at all (false once a match is in progress).
 *
 * `assignNewPlayer` picks a free slot AND validates AND commits the new player into it, all in one
 * synchronous call, driven entirely by the host's own player array (Player.active) rather than
 * presence. This matters: presence is eventually-consistent (a client's track() has to round-trip
 * before it shows up), so two joins processed back-to-back would otherwise both read the same
 * stale "slot 1 is free" snapshot and both get assigned it — a real, reproducible collision under
 * concurrent joins, not just a theoretical one. Driving slot-picking off the host's own
 * already-mutated array closes it the same way reserveNameColor already closes the equivalent race
 * for a rename: the second call in the same tick simply sees the first call's committed result.
 *
 * `reserveNameColor` is the equivalent operation for an ALREADY-seated player changing their own
 * name/color (`slot` is known and stable — it doesn't need to be picked). The check excludes
 * `slot` itself (whatever's there is being overwritten regardless — this is also how a rename
 * passes its own already-owned name/color without self-colliding). Returns an error message if
 * rejected, null if approved (and committed). */
export interface HostAuthority {
  canAcceptJoins(): boolean;
  assignNewPlayer(name: string, color: string): { slot: number } | { error: string };
  reserveNameColor(slot: number, name: string, color: string): string | null;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — easy to read aloud
// Exponential backoff between reconnect attempts, capped — a channel that drops from a brief
// network blip should recover almost immediately, but hammering Supabase every second during a
// real outage would just make things worse.
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 8000;
const RECONNECT_MAX_ATTEMPTS = 8;
// How long a guest waits after the host's presence disappears before treating the room as
// actually closed — long enough to ride out an ordinary transient blip (the host's own reconnect
// logic typically recovers well within this), short enough that a genuine departure still reads
// as prompt.
const HOST_GONE_GRACE_MS = 4000;

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
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  // Set by leaveRoom() — an intentional leave also triggers CLOSED (unsubscribe() does that by
  // design), which would otherwise look identical to a dropped connection and trigger the exact
  // reconnect logic above, silently reconnecting a client back into the room it just chose to
  // leave.
  private leaving = false;
  private readonly authority: HostAuthority | undefined;
  // Host-only: clientId -> slot, populated the instant a slot is actually approved (assignSlot),
  // not read from presence — presence can still lag even after the host's own authoritative
  // player array already reflects the join (that array and a client's own track() are two
  // independently-propagating things), which made slotForClient() intermittently unable to find a
  // just-joined client's slot if they requested a rename quickly enough after joining.
  private readonly clientSlots = new Map<string, number>();
  // Guest-only: set the moment the host's presence disappears, cleared if it reappears within
  // HOST_GONE_GRACE_MS — see the comment where it's used in wireCommonListeners.
  private hostGoneAt: number | undefined;
  // Guest-only: last time a snapshot or fast payload actually arrived — the cross-check that
  // makes the presence-leave-based room-closed fallback resistant to presence noise (see above).
  private lastDataAt = Date.now();

  private slotAssignedHandlers: Array<(slot: number) => void> = [];
  private errorHandlers: Array<(message: string) => void> = [];
  private presenceSyncHandlers: Array<(entries: PresencePayload[]) => void> = [];
  private presenceLeaveHandlers: Array<(entries: PresencePayload[]) => void> = [];
  private snapshotHandlers: Array<(payload: SnapshotPayload) => void> = [];
  private fastHandlers: Array<(payload: FastPayload) => void> = [];
  private guestInputHandlers: Array<(slot: number, state: PlayerInputState) => void> = [];
  private connectionStatusHandlers: Array<(status: ConnectionStatus) => void> = [];
  private renameRequestHandlers: Array<(clientId: string, name: string, color: string) => void> = [];
  private renameOkHandlers: Array<(name: string, color: string) => void> = [];
  private roomClosedHandlers: Array<(reason: string) => void> = [];

  constructor(authority?: HostAuthority) {
    this.authority = authority;
  }

  onSlotAssigned(handler: (slot: number) => void): void {
    this.slotAssignedHandlers.push(handler);
  }
  onError(handler: (message: string) => void): void {
    this.errorHandlers.push(handler);
  }
  onPresenceSync(handler: (entries: PresencePayload[]) => void): void {
    this.presenceSyncHandlers.push(handler);
  }
  /** Fires with whoever's presence just disappeared (they left cleanly, closed the tab, or lost
   * their connection) — Supabase's own presence "leave" event, which nothing in this codebase
   * listened for before this. Host-side: frees that slot (while still in "MENU") — this is
   * deliberately NOT derived from onPresenceSync instead, because a "sync" can fire before a
   * brand-new guest's own track()-with-real-slot has propagated back, which would otherwise
   * un-approve a join reserveNameColor() had just synchronously committed. "leave" has no such
   * race — it only ever fires for a presence that genuinely disappeared. */
  onPresenceLeave(handler: (left: PresencePayload[]) => void): void {
    this.presenceLeaveHandlers.push(handler);
  }
  /** Host-only: fires when a guest asks to change their name/color after already joining. */
  onRenameRequest(handler: (clientId: string, name: string, color: string) => void): void {
    this.renameRequestHandlers.push(handler);
  }
  /** Guest-only: fires once the host approves a rename request — track() the new values yourself
   * (presence is per-client, only its owner can update it). A rejection arrives via onError
   * instead. */
  onRenameOk(handler: (name: string, color: string) => void): void {
    this.renameOkHandlers.push(handler);
  }
  /** Guest-only: the host ended the room (left cleanly, or its presence just disappeared —
   * checked against PresencePayload.isHost via onPresenceLeave as the fallback for an unclean
   * departure). Tear down and stop, not reconnect — there's nothing left to reconnect to. */
  onRoomClosed(handler: (reason: string) => void): void {
    this.roomClosedHandlers.push(handler);
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
    channel.on("presence", { event: "leave" }, ({ leftPresences }) => {
      const left = leftPresences as unknown as PresencePayload[];
      if (left.length === 0) return;
      for (const handler of this.presenceLeaveHandlers) handler(left);
      // A departed host means the room is over even if it never got to send room-closed itself
      // (a crash, a force-quit, a network drop — no JS runs in that tab to send anything). Only
      // meaningful for guests — a host never sees its own departure, and never sees another
      // player's leave as reason to end the room.
      //
      // Not fired immediately: presence "leave" also fires for an ordinary transient blip (the
      // exact kind of drop NetworkClient's own reconnect logic already recovers from on its own),
      // and under real network jitter a presence sync can briefly report the host absent even
      // though its connection never actually failed. Firing room-closed instantly on that would
      // kick every guest out of a room that's actually fine. Give the host a grace window to
      // reappear (a fresh "join" with isHost true) before treating this as final.
      if (!this.isHost && left.some((p) => p.isHost)) {
        this.hostGoneAt = Date.now();
        setTimeout(() => {
          if (this.hostGoneAt === undefined) return; // host reappeared — see the "join" listener
          // Cross-check against actual data flow, not presence alone: the host broadcasts a
          // snapshot/fast payload every tick, ~30x/second, so a genuinely running host cannot
          // have gone this long without one landing — but presence itself has shown noisy
          // false-leaves under heavy connection churn (many clients joining/leaving in quick
          // succession), so requiring BOTH signals to agree is what keeps a presence blip from
          // kicking every guest out of a room that's actually still fine.
          if (Date.now() - this.lastDataAt < HOST_GONE_GRACE_MS) return;
          for (const handler of this.roomClosedHandlers) handler("Host left the room.");
        }, HOST_GONE_GRACE_MS);
      }
    });
    channel.on("presence", { event: "join" }, ({ newPresences }) => {
      if (!this.isHost && (newPresences as unknown as PresencePayload[]).some((p) => p.isHost)) {
        this.hostGoneAt = undefined; // cancels the pending room-closed check above, if any
      }
    });
    channel.on("broadcast", { event: "snapshot" }, ({ payload }) => {
      this.lastDataAt = Date.now();
      for (const handler of this.snapshotHandlers) handler(payload as SnapshotPayload);
    });
    channel.on("broadcast", { event: "fast" }, ({ payload }) => {
      this.lastDataAt = Date.now();
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
        this.assignSlot(p.clientId, p.name, p.color);
      }
    });

    channel.on("broadcast", { event: "rename-request" }, ({ payload }) => {
      const { clientId, name, color } = payload as RenamePayload;
      for (const handler of this.renameRequestHandlers) handler(clientId, name, color);
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

    channel.on("broadcast", { event: "rename-ok" }, ({ payload }) => {
      const { clientId, name, color } = payload as RenamePayload;
      if (clientId !== this.clientId) return;
      this.updateOwnPresence(name, color);
      for (const handler of this.renameOkHandlers) handler(name, color);
    });

    channel.on("broadcast", { event: "room-closed" }, ({ payload }) => {
      const { reason } = payload as RoomClosedPayload;
      for (const handler of this.roomClosedHandlers) handler(reason);
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
    if (this.leaving) return; // an intentional leave also fires CLOSED — see leaveRoom()
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
    this.reconnectTimer = setTimeout(() => {
      if (this.leaving) return;
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

  private assignSlot(clientId: string, name: string, color: string): void {
    if (!this.channel || !this.authority) return;
    if (!this.authority.canAcceptJoins()) {
      this.sendError(clientId, "Match already in progress.");
      return;
    }
    const result = this.authority.assignNewPlayer(name, color);
    if ("error" in result) {
      this.sendError(clientId, result.error);
      return;
    }
    this.clientSlots.set(clientId, result.slot);
    void this.channel.send({
      type: "broadcast",
      event: "slot-assign",
      payload: { clientId, slot: result.slot } satisfies SlotAssignPayload,
    });
  }

  /** Host-only: sends a rejection to one specific client — reused for "room full," a taken
   * name/color on join, and a rejected rename request. */
  sendError(clientId: string, message: string): void {
    void this.channel?.send({ type: "broadcast", event: "error", payload: { clientId, message } satisfies RoomErrorPayload });
  }

  /** Host-only: which slot a currently-seated client occupies, for validating/applying their own
   * rename request — read from the map assignSlot() populates at approval time, not presence (see
   * the comment on clientSlots for why). */
  slotForClient(clientId: string): number | undefined {
    return this.clientSlots.get(clientId);
  }

  /** Host-only: approves a pending rename request — the requesting guest still has to track() the
   * new values themselves (see onRenameOk). Call only after the host has already committed the
   * change via HostAuthority.reserveNameColor. */
  approveRename(clientId: string, name: string, color: string): void {
    void this.channel?.send({ type: "broadcast", event: "rename-ok", payload: { clientId, name, color } satisfies RenamePayload });
  }

  /** Guest-only: asks the host to change this client's name/color. Approval arrives via
   * onRenameOk, rejection via onError. */
  requestRename(name: string, color: string): void {
    void this.channel?.send({
      type: "broadcast",
      event: "rename-request",
      payload: { clientId: this.clientId, name, color } satisfies RenamePayload,
    });
  }

  /** Re-tracks this client's own presence with a new name/color — used by a guest once its rename
   * request is approved, and directly by the host for its own rename (no round trip needed, it
   * already owns the authoritative player record). Also updates the locally-remembered name/color
   * so a future reconnect re-announces the current values, not the stale original ones. */
  updateOwnPresence(name: string, color: string): void {
    this.name = name;
    this.color = color;
    if (!this.channel || this.mySlot === undefined) return;
    void this.channel.track({
      clientId: this.clientId,
      name,
      color,
      slot: this.mySlot,
      isHost: this.isHost,
    } satisfies PresencePayload);
  }

  /** Host-only: tells every guest the room is ending — call before untrack()/unsubscribe() so it
   * actually goes out. Guests use this (and the presence-leave fallback for an unclean host
   * departure) to tear down instead of trying to reconnect. */
  announceRoomClosed(reason: string): void {
    void this.channel?.send({ type: "broadcast", event: "room-closed", payload: { reason } satisfies RoomClosedPayload });
  }

  /** Leaves the room without triggering the reconnect logic — an intentional leave also fires
   * CLOSED (unsubscribe() does that by design), which would otherwise be indistinguishable from a
   * dropped connection and silently reconnect this client right back in. Cancels any reconnect
   * attempt already in flight too (a Leave click during a pending backoff delay must not let that
   * timer fire later and rebuild a connection the user just walked away from). */
  leaveRoom(): void {
    this.leaving = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const channel = this.channel;
    if (!channel) return;
    void channel.untrack();
    getSupabaseClient().removeChannel(channel);
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
