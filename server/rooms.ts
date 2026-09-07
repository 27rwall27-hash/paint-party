import type { WebSocket } from "ws";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — easy to read aloud
const MAX_PLAYERS = 4;

export interface RoomPlayer {
  slot: number;
  socket: WebSocket;
}

export class Room {
  readonly code: string;
  players: RoomPlayer[] = [];

  constructor(code: string) {
    this.code = code;
  }

  get isFull(): boolean {
    return this.players.length >= MAX_PLAYERS;
  }

  get isEmpty(): boolean {
    return this.players.length === 0;
  }

  addPlayer(socket: WebSocket): RoomPlayer {
    const usedSlots = new Set(this.players.map((p) => p.slot));
    let slot = 0;
    while (usedSlots.has(slot)) slot++;
    const player: RoomPlayer = { slot, socket };
    this.players.push(player);
    return player;
  }

  removeSocket(socket: WebSocket): void {
    this.players = this.players.filter((p) => p.socket !== socket);
  }

  broadcast(message: unknown): void {
    const data = JSON.stringify(message);
    for (const p of this.players) {
      if (p.socket.readyState === p.socket.OPEN) p.socket.send(data);
    }
  }
}

const rooms = new Map<string, Room>();

function generateCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}

export function createRoom(): Room {
  const room = new Room(generateCode());
  rooms.set(room.code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function deleteRoomIfEmpty(room: Room): void {
  if (room.isEmpty) rooms.delete(room.code);
}
