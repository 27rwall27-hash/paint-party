import { NetworkClient } from "./NetworkClient.ts";
import { applyPaint, applySnapshot, createOnlineSession } from "./onlineSession.ts";
import { onlineMode, onlineNow } from "./onlineMode.ts";
import { HostGameLoop } from "./hostLoop.ts";
import { PredictedPlayer } from "./predictedPlayer.ts";
import { RemoteInterpolator } from "./interpolation.ts";
import type { PresencePayload } from "./netProtocol.ts";

export function initOnlineUI(): void {
  const createBtn = document.querySelector<HTMLButtonElement>("#onlineCreateBtn");
  const joinBtn = document.querySelector<HTMLButtonElement>("#onlineJoinBtn");
  const joinCodeInput = document.querySelector<HTMLInputElement>("#onlineJoinCode");
  const startBtn = document.querySelector<HTMLButtonElement>("#onlineStartBtn");
  const status = document.querySelector<HTMLElement>("#onlineStatus");
  const playerList = document.querySelector<HTMLUListElement>("#onlinePlayerList");
  if (!createBtn || !joinBtn || !joinCodeInput || !startBtn || !status || !playerList) return;
  const statusEl = status;
  const playerListEl = playerList;
  const startBtnEl = startBtn;

  let client: NetworkClient | undefined;
  let hostLoop: HostGameLoop | undefined;

  function renderRoster(entries: PresencePayload[]): void {
    playerListEl.innerHTML = "";
    const seated = entries
      .filter((e): e is PresencePayload & { slot: number } => e.slot !== null)
      .sort((a, b) => a.slot - b.slot);
    for (const p of seated) {
      const li = document.createElement("li");
      li.textContent = `P${p.slot + 1}` + (p.clientId === client?.clientId ? " (you)" : "");
      playerListEl.appendChild(li);
    }
  }

  function beginGuestSession(): void {
    onlineMode.session = createOnlineSession();
    onlineMode.predictedPlayer = new PredictedPlayer();
    onlineMode.interpolator = new RemoteInterpolator();
    onlineMode.role = "guest";
    onlineMode.sendInput = (state) => client?.sendInput(state);
    onlineMode.active = true;
  }

  function beginHostSession(c: NetworkClient): void {
    hostLoop = new HostGameLoop(c);
    onlineMode.session = hostLoop.session;
    onlineMode.role = "host";
    onlineMode.mySlot = 0;
    onlineMode.active = true;
    startBtnEl.hidden = false;
  }

  createBtn.addEventListener("click", () => {
    statusEl.textContent = "Connecting…";
    try {
      const c = new NetworkClient();
      client = c;
      c.onPresenceSync(renderRoster);
      void c.createRoom("Player").then((code) => {
        statusEl.textContent = `Room ${code} — you're P1. Share the code with friends.`;
        beginHostSession(c);
      });
    } catch (err) {
      statusEl.textContent = err instanceof Error ? err.message : "Couldn't connect.";
    }
  });

  joinBtn.addEventListener("click", () => {
    const code = joinCodeInput.value.trim();
    if (!code) return;
    statusEl.textContent = "Connecting…";
    try {
      const c = new NetworkClient();
      client = c;
      c.onPresenceSync(renderRoster);
      c.onSlotAssigned((slot) => {
        statusEl.textContent = `Room ${code.toUpperCase()} — you're P${slot + 1}.`;
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
        if (onlineMode.mySlot !== undefined) {
          const authoritative = payload.players[onlineMode.mySlot];
          if (authoritative) {
            onlineMode.lastAuthoritativePlayer = authoritative;
            onlineMode.predictedPlayer?.reconcile(authoritative, roundChanged);
          }
        }
        if (onlineMode.interpolator) {
          const now = onlineNow();
          for (const p of payload.players) {
            if (p.id !== onlineMode.mySlot) onlineMode.interpolator.onSnapshot(p.id, p.x, p.y, now);
          }
        }
      });
      c.onPaint((payload) => {
        if (onlineMode.session) applyPaint(onlineMode.session, payload);
      });
      c.joinRoom(code, "Player");
    } catch (err) {
      statusEl.textContent = err instanceof Error ? err.message : "Couldn't connect.";
    }
  });

  startBtnEl.addEventListener("click", () => {
    hostLoop?.requestStart();
  });
}
