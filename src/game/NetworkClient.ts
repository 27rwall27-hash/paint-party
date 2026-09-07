import type { PlayerInputState } from "./Input.ts";
import type { ClientMessage, ServerMessage } from "./netProtocol.ts";

function serverUrl(): string {
  if (import.meta.env.DEV) return "ws://localhost:8787";
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}`;
}

/** Thin wrapper around the room/lobby WebSocket — queues sends until the socket is actually open. */
export class NetworkClient {
  private ws: WebSocket;
  private ready = false;
  private queue: ClientMessage[] = [];
  private messageHandlers: Array<(msg: ServerMessage) => void> = [];
  private lastSentInput: PlayerInputState | undefined;

  constructor() {
    this.ws = new WebSocket(serverUrl());
    this.ws.addEventListener("open", () => {
      this.ready = true;
      for (const msg of this.queue) this.ws.send(JSON.stringify(msg));
      this.queue = [];
    });
    this.ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data as string) as ServerMessage;
      for (const handler of this.messageHandlers) handler(msg);
    });
  }

  onMessage(handler: (msg: ServerMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  private send(msg: ClientMessage): void {
    if (this.ready) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  createRoom(): void {
    this.send({ type: "create" });
  }

  joinRoom(code: string): void {
    this.send({ type: "join", code: code.trim().toUpperCase() });
  }

  startMatch(): void {
    this.send({ type: "start" });
  }

  sendInput(state: PlayerInputState): void {
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
    this.send({ type: "input", state });
  }
}
