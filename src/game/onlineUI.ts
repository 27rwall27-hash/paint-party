import { NetworkClient } from "./NetworkClient.ts";
import { applyFast, applySnapshot, createOnlineSession } from "./onlineSession.ts";
import { onlineMode } from "./onlineMode.ts";
import { HostGameLoop } from "./hostLoop.ts";
import { PredictedPlayer } from "./predictedPlayer.ts";
import { RemoteInterpolator } from "./interpolation.ts";
import { resetGuestSound, syncGuestSound } from "./guestSound.ts";
import * as sound from "./sound.ts";
import type { PresencePayload } from "./netProtocol.ts";

export function initOnlineUI(): void {
  const createBtn = document.querySelector<HTMLButtonElement>("#onlineCreateBtn");
  const joinBtn = document.querySelector<HTMLButtonElement>("#onlineJoinBtn");
  const joinCodeInput = document.querySelector<HTMLInputElement>("#onlineJoinCode");
  const nameInput = document.querySelector<HTMLInputElement>("#onlineNameInput");
  const colorInput = document.querySelector<HTMLInputElement>("#onlineColorInput");
  const startBtn = document.querySelector<HTMLButtonElement>("#onlineStartBtn");
  const status = document.querySelector<HTMLElement>("#onlineStatus");
  const playerList = document.querySelector<HTMLUListElement>("#onlinePlayerList");
  if (!createBtn || !joinBtn || !joinCodeInput || !nameInput || !colorInput || !startBtn || !status || !playerList) {
    return;
  }
  const statusEl = status;
  const playerListEl = playerList;
  const startBtnEl = startBtn;
  const nameInputEl = nameInput;
  const colorInputEl = colorInput;

  let client: NetworkClient | undefined;
  let hostLoop: HostGameLoop | undefined;

  function renderRoster(entries: PresencePayload[]): void {
    playerListEl.innerHTML = "";
    const seated = entries
      .filter((e): e is PresencePayload & { slot: number } => e.slot !== null)
      .sort((a, b) => a.slot - b.slot);
    for (const p of seated) {
      const li = document.createElement("li");
      li.style.borderLeft = `4px solid ${p.color}`;
      li.textContent = `${p.name || `P${p.slot + 1}`}` + (p.clientId === client?.clientId ? " (you)" : "");
      playerListEl.appendChild(li);
    }

    // Host-only: presence is the only place a guest's chosen name/color ever reaches the host's
    // authoritative session — the regular snapshot broadcast then carries it on to everyone else
    // (guests included) as a completely ordinary part of each Player object, no extra plumbing.
    if (hostLoop) {
      for (const p of seated) {
        const player = hostLoop.session.players[p.slot];
        if (!player) continue;
        if (p.name) player.name = p.name;
        if (p.color) player.color = p.color;
      }
    }
  }

  function beginGuestSession(): void {
    onlineMode.session = createOnlineSession();
    onlineMode.predictedPlayer = new PredictedPlayer();
    onlineMode.interpolator = new RemoteInterpolator();
    onlineMode.role = "guest";
    onlineMode.sendInput = (state) => client?.sendInput(state);
    onlineMode.active = true;
    onlineMode.connectionStatus = "connected";
    resetGuestSound();
  }

  function beginHostSession(c: NetworkClient): void {
    hostLoop = new HostGameLoop(c);
    onlineMode.session = hostLoop.session;
    onlineMode.role = "host";
    onlineMode.mySlot = 0;
    onlineMode.active = true;
    onlineMode.connectionStatus = "connected";
    startBtnEl.hidden = false;
  }

  createBtn.addEventListener("click", () => {
    const myName = nameInputEl.value.trim() || "P1";
    const myColor = colorInputEl.value;
    statusEl.textContent = "Connecting…";
    try {
      const c = new NetworkClient();
      client = c;
      c.onPresenceSync(renderRoster);
      c.onConnectionStatus((s) => (onlineMode.connectionStatus = s));
      void c.createRoom(myName, myColor).then((code) => {
        statusEl.textContent = `Room ${code} — you're ${myName}. Share the code with friends.`;
        beginHostSession(c);
      });
    } catch (err) {
      statusEl.textContent = err instanceof Error ? err.message : "Couldn't connect.";
    }
  });

  joinBtn.addEventListener("click", () => {
    const code = joinCodeInput.value.trim();
    if (!code) return;
    const myName = nameInputEl.value.trim() || "Player";
    const myColor = colorInputEl.value;
    // Guests never press a local "paint" key to unlock audio the way MENU->beginRound does for
    // host/local play (a guest's session never runs its own GameSession.update() — see
    // guestSound.ts) — this click is the one real user gesture in the whole join flow, so it's
    // the only place left to satisfy the browser's autoplay policy for a guest's audio.
    sound.unlock();
    statusEl.textContent = "Connecting…";
    try {
      const c = new NetworkClient();
      client = c;
      c.onPresenceSync(renderRoster);
      c.onConnectionStatus((s) => (onlineMode.connectionStatus = s));
      c.onSlotAssigned((slot) => {
        statusEl.textContent = `Room ${code.toUpperCase()} — you're ${myName}.`;
        onlineMode.mySlot = slot;
        beginGuestSession();
      });
      c.onError((message) => {
        statusEl.textContent = message;
      });
      c.onSnapshot((payload) => {
        if (!onlineMode.session) return;

        // Estimate (host clock - my clock) from this snapshot's send time, smoothed a bit so a
        // single slow/fast round trip doesn't yank "now" around frame to frame.
        const offsetSample = payload.hostNow - Date.now();
        onlineMode.clockOffset =
          onlineMode.clockOffset === undefined ? offsetSample : onlineMode.clockOffset * 0.8 + offsetSample * 0.2;

        const roundChanged = applySnapshot(onlineMode.session, payload);
        syncGuestSound(payload);
        if (onlineMode.mySlot !== undefined) {
          const authoritative = payload.players[onlineMode.mySlot];
          if (authoritative) {
            onlineMode.lastAuthoritativePlayer = authoritative;
            onlineMode.predictedPlayer?.reconcile(authoritative, roundChanged);
          }
        }
        // Remote players' positions come from the faster onPositions channel below now, not this
        // throttled snapshot — reset on a round change so a stale pre-round-change target doesn't
        // linger and get lerped toward for the first ~30ms of the new round.
        if (roundChanged) onlineMode.interpolator?.reset();
      });
      c.onFast((payload) => {
        if (!onlineMode.session) return;
        // Same clock-offset estimate as the full snapshot, just refreshed 3x more often now that
        // this channel also carries hostNow — keeps the guest's clock-domain math (interpolation,
        // eraser extrapolation) tracking the host more tightly.
        const offsetSample = payload.hostNow - Date.now();
        onlineMode.clockOffset =
          onlineMode.clockOffset === undefined ? offsetSample : onlineMode.clockOffset * 0.8 + offsetSample * 0.2;

        applyFast(onlineMode.session, payload, onlineMode.mySlot);

        // Reconcile the guest's own predicted player against THIS channel's fresh position too,
        // not just the throttled ~10Hz snapshot below — that snapshot alone made reconcile() work
        // off data up to ~100ms stale, which is fine for steady movement (drift rarely exceeds the
        // correction threshold) but not for rapid direction changes: a player flicking WASD to
        // trace a circle generates real divergence fast enough to trip a fresh correction on
        // nearly every ~100ms reconcile, each one still only partly blended in before the next
        // stomps it with a new target — the same steady-state-lag pattern RemoteInterpolator had
        // (see its CORRECTION_MS comment) before its correction cadence was tied to a fast enough
        // channel. This payload already carries every player's x/y/cursorRadius every tick, so
        // reconciling against it directly cuts staleness ~3x for free.
        if (onlineMode.mySlot !== undefined && onlineMode.lastAuthoritativePlayer) {
          const self = payload.positions.find((p) => p.id === onlineMode.mySlot);
          if (self) {
            onlineMode.lastAuthoritativePlayer.x = self.x;
            onlineMode.lastAuthoritativePlayer.y = self.y;
            onlineMode.lastAuthoritativePlayer.cursorRadius = self.cursorRadius;
            onlineMode.predictedPlayer?.reconcile(onlineMode.lastAuthoritativePlayer, false);
          }
        }

        if (!onlineMode.interpolator) return;
        // RemoteInterpolator's own elapsed-time math is purely self-relative ("how long ago did I
        // get this sample") and must use a local monotonic clock, not onlineNow() — see the class
        // comment on RemoteInterpolator for why using the host-adjusted clock there fed network
        // jitter directly into the thing meant to smooth over it.
        const localNow = performance.now();
        for (const p of payload.positions) {
          if (p.id !== onlineMode.mySlot) onlineMode.interpolator.onSnapshot(p.id, p.x, p.y, localNow);
        }
      });
      c.joinRoom(code, myName, myColor);
    } catch (err) {
      statusEl.textContent = err instanceof Error ? err.message : "Couldn't connect.";
    }
  });

  startBtnEl.addEventListener("click", () => {
    hostLoop?.requestStart();
  });
}
