import "./style.css";
import { GameSession } from "./game/GameSession.ts";
import { InputManager } from "./game/Input.ts";
import { render } from "./game/render.ts";
import * as sound from "./game/sound.ts";
import { initOnlineUI } from "./game/onlineUI.ts";
import { onlineMode, onlineNow } from "./game/onlineMode.ts";
import { initPlayerSetupUI } from "./game/playerSetupUI.ts";
import { initModeToggleUI } from "./game/modeToggleUI.ts";
import { MOVE_LOCK_MS, PLAYER_DEFS } from "./game/constants.ts";
import type { PlayerInputState } from "./game/Input.ts";

sound.init();
initModeToggleUI();
initOnlineUI();

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const NEUTRAL_INPUT: PlayerInputState = { up: false, down: false, left: false, right: false, paint: false };

const input = new InputManager();
const session = new GameSession(sound);
// Local play is solo-only now — session.players stays a fixed 4-slot array (see Player.active),
// but only slot 0 is ever active locally; the other 3 sit unrendered/unscored.
session.players.forEach((p, i) => (p.active = i === 0));
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
    // `time` (this function's own rAF timestamp, already computed above for the offline dt) is
    // passed to PredictedPlayer/RemoteInterpolator below wherever they need a LOCAL monotonic
    // clock instead of `now` — `now` jumps every time clockOffset gets re-estimated from a fresh
    // network sample (up to 30x/second), which fed network jitter directly into supposedly
    // network-immune local prediction/smoothing. `now` is still correct (and required) for
    // anything compared against a host-stamped absolute timestamp, like canPredictMovement below.

    if (onlineMode.role === "guest") {
      const localInput = input.getInput(PLAYER_DEFS[0]!.keys);
      const mySlot = onlineMode.mySlot;
      if (mySlot !== undefined && onlineMode.predictedPlayer && onlineMode.lastAuthoritativePlayer) {
        // PredictedPlayer has no idea what state the game is in — it'll happily predict movement/
        // charging from raw key state regardless. The host only ever actually applies movement
        // during PLAYING, and even then not until MOVE_LOCK_MS after it starts — outside that
        // window a guest holding a key would predict themselves drifting away from their real
        // (unmoved, host-authoritative) position, then get visibly snapped back once a real
        // snapshot/reconcile catches up. Feeding it a neutral input outside that window keeps the
        // prediction pinned to the authoritative position instead, exactly matching the host.
        const canPredictMovement =
          onlineMode.session.state === "PLAYING" && now - onlineMode.session.stateEnteredAt >= MOVE_LOCK_MS;
        const predicted = onlineMode.predictedPlayer.update(
          onlineMode.lastAuthoritativePlayer,
          canPredictMovement ? localInput : NEUTRAL_INPUT,
          now,
          time,
        );
        onlineMode.session.players[mySlot] = predicted;
      }
      if (onlineMode.interpolator) {
        for (const p of onlineMode.session.players) {
          if (p.id === mySlot) continue;
          const pos = onlineMode.interpolator.currentPosition(p.id, time);
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
