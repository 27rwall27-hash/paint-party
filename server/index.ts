import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, DOMMatrix, Path2D } from "@napi-rs/canvas";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { setCanvasFactory } from "../src/game/Outline.ts";
import type { ClientMessage, ServerMessage } from "../src/game/netProtocol.ts";
import { GameRoom } from "./GameRoom.ts";
import { createRoom, deleteRoomIfEmpty, getRoom, type Room } from "./rooms.ts";

// The game's shape/outline code uses `Path2D`/`DOMMatrix` as bare browser globals (not obtained
// from a canvas context), which don't exist in plain Node — @napi-rs/canvas ships its own
// implementations of both, so install them as globals before any game code runs.
globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;
globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
// @napi-rs/canvas has no `document` to create elements from — its Canvas otherwise implements
// the same 2D API (Path2D, clip, getImageData) that Outline.ts already relies on.
setCanvasFactory(() => createCanvas(1, 1) as unknown as HTMLCanvasElement);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "..", "dist");

const app = express();
app.use(express.static(DIST_DIR));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const gameRooms = new Map<string, GameRoom>();

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

function broadcastLobby(room: Room): void {
  room.broadcast({
    type: "lobby",
    code: room.code,
    players: room.players.map((p) => ({ slot: p.slot })),
  } satisfies ServerMessage);
}

function stopAndForgetGameRoom(code: string): void {
  gameRooms.get(code)?.stop();
  gameRooms.delete(code);
}

wss.on("connection", (socket) => {
  let currentRoom: Room | undefined;

  socket.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "create") {
      currentRoom = createRoom();
      const player = currentRoom.addPlayer(socket);
      send(socket, { type: "joined", code: currentRoom.code, slot: player.slot });
      broadcastLobby(currentRoom);
      return;
    }

    if (msg.type === "join") {
      const room = getRoom(msg.code);
      if (!room) {
        send(socket, { type: "error", message: "Room not found." });
        return;
      }
      if (room.isFull) {
        send(socket, { type: "error", message: "Room is full." });
        return;
      }
      currentRoom = room;
      const player = room.addPlayer(socket);
      send(socket, { type: "joined", code: room.code, slot: player.slot });
      broadcastLobby(room);
      return;
    }

    if (msg.type === "start") {
      if (!currentRoom) return;
      let gameRoom = gameRooms.get(currentRoom.code);
      if (!gameRoom) {
        gameRoom = new GameRoom(currentRoom);
        gameRooms.set(currentRoom.code, gameRoom);
      }
      gameRoom.start();
      return;
    }

    if (msg.type === "input") {
      if (!currentRoom) return;
      const player = currentRoom.players.find((p) => p.socket === socket);
      if (!player) return;
      gameRooms.get(currentRoom.code)?.handleInput(player.slot, msg.state);
      return;
    }
  });

  socket.on("close", () => {
    if (!currentRoom) return;
    currentRoom.removeSocket(socket);
    broadcastLobby(currentRoom);
    if (currentRoom.isEmpty) stopAndForgetGameRoom(currentRoom.code);
    deleteRoomIfEmpty(currentRoom);
  });
});

const port = Number(process.env.PORT) || 8787;
httpServer.listen(port, () => {
  console.log(`Paint Party server listening on :${port}`);
});
