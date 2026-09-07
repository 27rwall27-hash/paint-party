// Wire protocol shared between the browser client (NetworkClient.ts) and the room/authoritative
// game server (server/*.ts). Kept as plain types with no runtime code so either side can import
// it freely. Gameplay types (Player, Sweep, Projectile, Eraser, Impact, OutlineResult) are
// reused as-is from the game modules — they're already plain, JSON-safe data shapes.

import type { GameState, PaintEvent, Sweep, Projectile, Eraser, Impact } from "./GameSession.ts";
import type { Player } from "./Player.ts";
import type { PlayerInputState } from "./Input.ts";
import type { PowerupState } from "./Outline.ts";
import type { PowerupType } from "./constants.ts";
import type { OutlineResult } from "./scoring.ts";

export interface LobbyPlayer {
  slot: number;
}

/** The resolved shape for one outline slot this round — sent by the server (the authority on
 * which custom shapes, if any, are actually available) rather than assumed from the client's
 * own static ROUNDS config, since the two can differ (see NetOutlineSpec usage in GameRoom). */
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

export type ClientMessage =
  | { type: "create" }
  | { type: "join"; code: string }
  | { type: "start" }
  | { type: "input"; state: PlayerInputState };

export type ServerMessage =
  | { type: "joined"; code: string; slot: number }
  | { type: "lobby"; code: string; players: LobbyPlayer[] }
  | { type: "error"; message: string }
  | {
      type: "snapshot";
      state: GameState;
      roundIndex: number;
      roundEndAt: number;
      stateEnteredAt: number;
      resultsDurationMs: number;
      resultsPerOutlineMs: number;
      /** Only present when the round just changed — the client keeps its last copy otherwise,
       * both to save bandwidth and so it doesn't wipe its local paint canvases every tick. */
      outlineSpecs?: NetOutlineSpec[];
      players: Player[];
      powerups: NetPowerup[];
      sweeps: Sweep[];
      projectiles: Projectile[];
      erasers: Eraser[];
      impacts: Impact[];
      lastResults: OutlineResult[];
    }
  | { type: "paint"; events: PaintEvent[] };
