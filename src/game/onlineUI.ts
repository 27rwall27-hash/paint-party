import { NetworkClient } from "./NetworkClient.ts";
import { applyServerMessage, createOnlineSession } from "./onlineSession.ts";
import { onlineMode } from "./onlineMode.ts";

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
  let mySlot: number | undefined;

  function ensureClient(): NetworkClient {
    if (client) return client;
    client = new NetworkClient();
    client.onMessage((msg) => {
      if (msg.type === "joined") {
        mySlot = msg.slot;
        statusEl.textContent = `Room ${msg.code} — you're P${msg.slot + 1}. Share the code with friends.`;
        startBtnEl.hidden = false;
        onlineMode.session = createOnlineSession();
        onlineMode.sendInput = (state) => client?.sendInput(state);
        onlineMode.active = true;
      } else if (msg.type === "lobby") {
        playerListEl.innerHTML = "";
        for (const p of msg.players) {
          const li = document.createElement("li");
          li.textContent = `P${p.slot + 1}` + (p.slot === mySlot ? " (you)" : "");
          playerListEl.appendChild(li);
        }
      } else if (msg.type === "error") {
        statusEl.textContent = msg.message;
      } else if (onlineMode.session) {
        applyServerMessage(onlineMode.session, msg);
      }
    });
    return client;
  }

  createBtn.addEventListener("click", () => {
    statusEl.textContent = "Connecting…";
    ensureClient().createRoom();
  });

  joinBtn.addEventListener("click", () => {
    const code = joinCodeInput.value.trim();
    if (!code) return;
    statusEl.textContent = "Connecting…";
    ensureClient().joinRoom(code);
  });

  startBtnEl.addEventListener("click", () => {
    client?.startMatch();
  });
}
