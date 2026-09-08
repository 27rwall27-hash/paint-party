// Payload shapes carried over Supabase Realtime (presence + broadcast) between the host's browser
// tab (the authoritative simulation) and guest tabs. Plain types only, no runtime code, so either
// side can import freely. Gameplay types (Player, Sweep, Projectile, Eraser, Impact, OutlineResult)
// are reused as-is from the game modules — they're already plain, JSON-safe data shapes.

import type { GameState, PaintEvent, RevealStep, Sweep, Projectile, Eraser, Impact } from "./GameSession.ts";
import type { Player } from "./Player.ts";
import type { PlayerInputState } from "./Input.ts";
import type { PowerupState } from "./Outline.ts";
import type { PowerupType } from "./constants.ts";
import type { OutlineResult } from "./scoring.ts";

/** The resolved shape for one outline slot this round. Host and guests run the same bundle so
 * they'd normally resolve ROUNDS identically, but a guest on a stale cached build is a real (if
 * rare) desync vector — broadcasting the host's resolved shapes removes that assumption. */
export interface NetOutlineSpec {
  kind: string;
  cx: number;
  cy: number;
  radius: number;
  width?: number;
  height?: number;
  widthScale?: number;
  heightScale?: number;
}

export interface NetPowerup {
  type: PowerupType;
  cx: number;
  cy: number;
  radius: number;
  state: PowerupState;
  claimedBy: number | null;
  claimedAt: number;
  spawnedAt: number;
  expiresAt: number;
}

/** Presence payload every client (host and guests) tracks on the room channel — this alone is
 * the live lobby roster, no separate "lobby" message needed. */
export interface PresencePayload {
  clientId: string;
  name: string;
  slot: number | null;
  isHost: boolean;
}

/** Host -> one guest (filtered by clientId): assigns that guest's player slot once it joins. */
export interface SlotAssignPayload {
  clientId: string;
  slot: number;
}

/** Host -> one guest (filtered by clientId): e.g. room already has 4 players. */
export interface RoomErrorPayload {
  clientId: string;
  message: string;
}

/** Guest -> host: this guest's latest input state for its assigned slot. */
export interface InputPayload {
  slot: number;
  state: PlayerInputState;
}

/** Host -> all: a full snapshot of session state, broadcast on a throttled schedule (not every
 * simulation tick) to conserve Realtime message volume — guests interpolate between snapshots. */
export interface SnapshotPayload {
  /** The host's own Date.now() at broadcast time — two different physical machines' clocks can
   * disagree by anywhere from milliseconds to whole seconds (no NTP guarantee), and every other
   * timestamp in this payload is stamped using the host's clock. Guests use this to estimate a
   * clock offset and adjust their own Date.now() before comparing against those timestamps —
   * without it, a guest running behind the host's clock can see negative elapsed times (e.g. a
   * projectile whose startedAt is "in the future" from the guest's point of view), which breaks
   * time-based animation math and can throw (a negative radius passed to a canvas draw call). */
  hostNow: number;
  state: GameState;
  roundIndex: number;
  roundEndAt: number;
  stateEnteredAt: number;
  resultsDurationMs: number;
  resultsPerOutlineMs: number;
  /** Always included (cheap — a handful of small objects) rather than only on round change, so a
   * guest whose join is still settling right as a round starts can't miss it and end up with no
   * outlines for the rest of that round. Guests decide for themselves whether to rebuild their
   * local Outline instances by comparing roundIndex, not by whether this field is present. */
  outlineSpecs: NetOutlineSpec[];
  players: Player[];
  powerups: NetPowerup[];
  sweeps: Sweep[];
  projectiles: Projectile[];
  erasers: Eraser[];
  impacts: Impact[];
  lastResults: OutlineResult[];
  revealTimeline: RevealStep[];
  revealedCount: number;
}

/** Host -> all: paint actions from this broadcast interval, batched, so guests can replay them
 * onto their own local paint canvases without needing pixel data over the wire. */
export interface PaintBatchPayload {
  events: PaintEvent[];
}
