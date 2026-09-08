import "./style.css";
import { GameSession } from "./game/GameSession.ts";
import { InputManager } from "./game/Input.ts";
import { render } from "./game/render.ts";
import * as sound from "./game/sound.ts";
import { initOnlineUI } from "./game/onlineUI.ts";
import { onlineMode, onlineNow } from "./game/onlineMode.ts";
import { initPlayerSetupUI } from "./game/playerSetupUI.ts";
import { PLAYER_DEFS } from "./game/constants.ts";

sound.init();
initOnlineUI();

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;

const input = new InputManager();
const session = new GameSession(sound);
initPlayerSetupUI(session);

let lastTime = performance.now();

function loop(time: number): void {
  const dt = Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;

  if (onlineMode.active && onlineMode.session) {
    // Online play's session timestamps come from the HOST's wall clock (Date.now(), never
    // requestAnimationFrame's unrelated performance.now() — that mismatch once froze the tab in
    // an earlier design). But two different physical machines' clocks also aren't guaranteed to
    // agree with each other, sometimes by seconds — onlineNow() adjusts a guest's own Date.now()
    // by an estimated offset so it lines up with the host's clock; the host IS that clock, so it
    // gets back plain Date.now() unchanged. Skipping this produces negative elapsed times (e.g. a
    // projectile's startedAt looking like it's "in the future"), which breaks animation math and
    // can throw outright (a negative radius reaching a canvas draw call).
    const now = onlineNow();

    if (onlineMode.role === "guest") {
      const localInput = input.getInput(PLAYER_DEFS[0]!.keys);
      const mySlot = onlineMode.mySlot;
      if (mySlot !== undefined && onlineMode.predictedPlayer && onlineMode.lastAuthoritativePlayer) {
        const predicted = onlineMode.predictedPlayer.update(onlineMode.lastAuthoritativePlayer, localInput, now);
        onlineMode.session.players[mySlot] = predicted;
      }
      if (onlineMode.interpolator) {
        for (const p of onlineMode.session.players) {
          if (p.id === mySlot) continue;
          const pos = onlineMode.interpolator.currentPosition(p.id, now);
          if (pos) {
            p.x = pos.x;
            p.y = pos.y;
          }
        }
      }
      onlineMode.sendInput?.(localInput);
    }
    // Host role: nothing to do here — hostLoop.ts's own setInterval already drives
    // session.update() independent of this render loop; we just draw its current state.

    render(ctx, onlineMode.session, now);
  } else {
    session.update(dt, time, input);
    render(ctx, session, time);
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
