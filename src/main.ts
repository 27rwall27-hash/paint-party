import "./style.css";
import { GameSession } from "./game/GameSession.ts";
import { InputManager } from "./game/Input.ts";
import { render } from "./game/render.ts";
import * as sound from "./game/sound.ts";
import { initSettingsUI } from "./game/settings.ts";
import { initOnlineUI } from "./game/onlineUI.ts";
import { onlineMode } from "./game/onlineMode.ts";
import { PLAYER_DEFS } from "./game/constants.ts";

sound.init();
initSettingsUI();
initOnlineUI();

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;

const input = new InputManager();
const session = new GameSession(sound);

let lastTime = performance.now();

function loop(time: number): void {
  const dt = Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;

  if (onlineMode.active && onlineMode.session) {
    // Online play is fully server-authoritative — everyone uses WASD + Space regardless of
    // which slot they were assigned, and the client only sends input and renders snapshots.
    // The server's session timestamps (stateEnteredAt, roundEndAt, ...) are Date.now()-based,
    // not requestAnimationFrame's performance.now()-based `time` — render() needs "now" in the
    // same clock domain as those or every elapsed-time calculation comes out wildly wrong.
    render(ctx, onlineMode.session, Date.now());
    onlineMode.sendInput?.(input.getInput(PLAYER_DEFS[0]!.keys));
  } else {
    session.update(dt, time, input);
    render(ctx, session, time);
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
