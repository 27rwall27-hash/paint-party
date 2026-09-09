import { NetworkClient, type HostAuthority } from "./NetworkClient.ts";
import { applyFast, applySnapshot, createOnlineSession } from "./onlineSession.ts";
import { onlineMode } from "./onlineMode.ts";
import { HostGameLoop } from "./hostLoop.ts";
import { PredictedPlayer } from "./predictedPlayer.ts";
import { RemoteInterpolator } from "./interpolation.ts";
import { resetGuestSound, syncGuestSound } from "./guestSound.ts";
import { renderColorPicker } from "./colorPicker.ts";
import { fillWithBots } from "./Player.ts";
import * as sound from "./sound.ts";
import type { PresencePayload } from "./netProtocol.ts";

const DEFAULT_COLOR = "#e63946";

export interface OnlineUIHandle {
  /** Leaves the current room (if any) and resets the online panel back to its pre-join state.
   * Used by the mode toggle when switching away to Local, so a forgotten online session can't
   * keep driving the game loop behind the scenes while the Local panel is showing. */
  leaveIfActive(): void;
}

export function initOnlineUI(): OnlineUIHandle | undefined {
  const createBtn = document.querySelector<HTMLButtonElement>("#onlineCreateBtn");
  const joinBtn = document.querySelector<HTMLButtonElement>("#onlineJoinBtn");
  const joinCodeInput = document.querySelector<HTMLInputElement>("#onlineJoinCode");
  const joinControls = document.querySelector<HTMLElement>("#onlineJoinControls");
  const nameInput = document.querySelector<HTMLInputElement>("#onlineNameInput");
  const colorPickerEl = document.querySelector<HTMLElement>("#onlineColorPicker");
  const startBtn = document.querySelector<HTMLButtonElement>("#onlineStartBtn");
  const leaveBtn = document.querySelector<HTMLButtonElement>("#onlineLeaveBtn");
  const roomControls = document.querySelector<HTMLElement>("#onlineRoomControls");
  const status = document.querySelector<HTMLElement>("#onlineStatus");
  const playerList = document.querySelector<HTMLUListElement>("#onlinePlayerList");
  if (
    !createBtn ||
    !joinBtn ||
    !joinCodeInput ||
    !joinControls ||
    !nameInput ||
    !colorPickerEl ||
    !startBtn ||
    !leaveBtn ||
    !roomControls ||
    !status ||
    !playerList
  ) {
    return undefined;
  }
  const statusEl = status;
  const playerListEl = playerList;
  const startBtnEl = startBtn;
  const leaveBtnEl = leaveBtn;
  const roomControlsEl = roomControls;
  const joinControlsEl = joinControls;
  const nameInputEl = nameInput;
  const colorPickerElBound = colorPickerEl; // rebound so nested functions below see it as non-null

  let client: NetworkClient | undefined;
  let hostLoop: HostGameLoop | undefined;
  let editabilityPollTimer: ReturnType<typeof setInterval> | undefined;
  let myColor = DEFAULT_COLOR;
  let roomCode = "";

  // Name/color live in ONE place (this input + picker), used both to pick them before
  // creating/joining a room AND to change them afterward, while still in the lobby — see
  // applyNameColor below for the "afterward" half. Before joining, changing them just updates the
  // local vars used by the next Create/Join click.
  const paintColor = (color: string) => {
    myColor = color;
    renderColorPicker(colorPickerElBound, myColor, paintColor);
    if (isSeated()) applyNameColor(currentName(), color);
  };
  renderColorPicker(colorPickerElBound, myColor, paintColor);

  nameInputEl.addEventListener("change", () => {
    if (isSeated()) applyNameColor(currentName(), myColor);
  });

  function currentName(): string {
    return nameInputEl.value.trim() || "Player";
  }

  function isSeated(): boolean {
    return client !== undefined && onlineMode.active && onlineMode.mySlot !== undefined;
  }

  // Once a match has actually started, name/color are locked for the rest of it (same rule as
  // Player.active — see its comment) — both so the input can't send a request the host would just
  // reject, and so it's visibly obvious you can't change it mid-game rather than silently failing.
  function midMatch(): boolean {
    return onlineMode.active && onlineMode.session !== undefined && onlineMode.session.state !== "MENU";
  }

  function updateEditability(): void {
    const locked = isSeated() && midMatch();
    nameInputEl.disabled = locked;
    colorPickerElBound.classList.toggle("disabled", locked);
  }

  function applyNameColor(name: string, color: string): void {
    if (!client) return;
    if (onlineMode.role === "host") {
      // No round trip needed — the host already owns the authoritative player record directly.
      const rejection = hostAuthority.reserveNameColor(0, name, color);
      if (rejection) {
        statusEl.textContent = rejection;
        return;
      }
      client.updateOwnPresence(name, color);
      statusEl.textContent = `Room ${roomCode} — you're ${name}. Share the code with friends.`;
    } else {
      client.requestRename(name, color);
    }
  }

  // Host-only authority NetworkClient calls into for join/rename decisions — kept here (not
  // inside NetworkClient) so the actual GameSession/roster stays owned by this module; NetworkClient
  // itself never needs to know about GameSession types. canAcceptJoins/reserveNameColor read
  // `hostLoop` via closure, so they're safe to construct once even though hostLoop doesn't exist
  // until createRoom() resolves.
  function nameOrColorConflicts(excludeSlot: number, name: string, color: string): boolean {
    if (!hostLoop) return false;
    return hostLoop.session.players.some(
      (p, i) => i !== excludeSlot && p.active && (p.name.toLowerCase() === name.toLowerCase() || p.color.toLowerCase() === color.toLowerCase()),
    );
  }

  const hostAuthority: HostAuthority = {
    canAcceptJoins: () => hostLoop?.session.state === "MENU",
    // Slot picking AND the uniqueness check both run off hostLoop.session.players (never
    // presence, which lags a round trip behind) so two joins processed back-to-back can't collide
    // on the same slot or the same name/color — see the interface comment in NetworkClient.ts.
    assignNewPlayer: (name, color) => {
      if (!hostLoop) return { error: "Room isn't ready yet." };
      const slot = hostLoop.session.players.findIndex((p) => !p.active);
      if (slot === -1) return { error: "Room is full." };
      const trimmed = (name.trim() || `P${slot + 1}`).slice(0, 12);
      if (nameOrColorConflicts(slot, trimmed, color)) return { error: "That name or color is already taken in this room." };
      const player = hostLoop.session.players[slot]!;
      player.name = trimmed;
      player.color = color;
      player.active = true;
      return { slot };
    },
    reserveNameColor: (slot, name, color) => {
      if (!hostLoop) return "Room isn't ready yet.";
      if (hostLoop.session.state !== "MENU") return "Can't change name/color once a match has started.";
      const trimmed = (name.trim() || `P${slot + 1}`).slice(0, 12);
      if (nameOrColorConflicts(slot, trimmed, color)) return "That name or color is already taken in this room.";
      const player = hostLoop.session.players[slot];
      if (player) {
        player.name = trimmed;
        player.color = color;
        player.active = true;
      }
      return null;
    },
  };

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
    // as a completely ordinary part of each Player object, no extra plumbing. Only touched while
    // state === "MENU" — once a match starts, Player.active/name/color are locked for the rest of
    // it (see the comment on Player.active), so a mid-match departure freezes a player in place
    // rather than freeing their slot or reshuffling the gun-station layout.
    //
    // Deliberately only ever sets active TRUE here, never false — a "sync" can fire before a
    // brand-new guest's own track()-with-real-slot has fully propagated back to the host (the
    // guest's initial track() lands with slot: null a moment before their real one), which would
    // otherwise un-approve a join hostAuthority.reserveNameColor() had just synchronously
    // committed. Freeing a slot on departure is handled unambiguously via onPresenceLeave instead
    // (registered on the host's own client below), which only ever fires for a presence that
    // genuinely disappeared.
    if (hostLoop && hostLoop.session.state === "MENU") {
      for (const p of seated) {
        const player = hostLoop.session.players[p.slot];
        if (!player) continue;
        player.active = true;
        if (p.name) player.name = p.name;
        if (p.color) player.color = p.color;
      }
    }
    updateEditability();
  }

  function resetToStartScreen(message: string): void {
    if (editabilityPollTimer !== undefined) {
      clearInterval(editabilityPollTimer);
      editabilityPollTimer = undefined;
    }
    client = undefined;
    hostLoop = undefined;
    onlineMode.active = false;
    onlineMode.role = undefined;
    onlineMode.session = undefined;
    onlineMode.mySlot = undefined;
    onlineMode.sendInput = undefined;
    onlineMode.predictedPlayer = undefined;
    onlineMode.interpolator = undefined;
    onlineMode.lastAuthoritativePlayer = undefined;
    onlineMode.clockOffset = undefined;
    onlineMode.connectionStatus = undefined;
    roomControlsEl.hidden = true;
    startBtnEl.hidden = true;
    joinControlsEl.hidden = false;
    playerListEl.innerHTML = "";
    statusEl.textContent = message;
    updateEditability();
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
    joinControlsEl.hidden = true;
    roomControlsEl.hidden = false;
    updateEditability();
  }

  function beginHostSession(c: NetworkClient): void {
    hostLoop = new HostGameLoop(c);
    onlineMode.session = hostLoop.session;
    onlineMode.role = "host";
    onlineMode.mySlot = 0;
    onlineMode.active = true;
    onlineMode.connectionStatus = "connected";
    startBtnEl.hidden = false;
    joinControlsEl.hidden = true;
    roomControlsEl.hidden = false;
    updateEditability();
    // The host has no other event that fires once the match actually leaves MENU (a guest learns
    // this from its own onSnapshot handler; the host, especially with no guests to trigger a
    // presence sync, otherwise never re-checks) — a cheap poll is simpler than threading a new
    // state-change callback through HostGameLoop for what's ultimately a cosmetic UI sync.
    editabilityPollTimer = setInterval(updateEditability, 500);
  }

  createBtn.addEventListener("click", () => {
    const myName = currentName();
    client?.leaveRoom(); // tear down any earlier attempt from this tab first — see joinBtn below
    statusEl.textContent = "Connecting…";
    try {
      const c = new NetworkClient(hostAuthority);
      client = c;
      c.onPresenceSync(renderRoster);
      c.onConnectionStatus((s) => (onlineMode.connectionStatus = s));
      c.onPresenceLeave((left) => {
        // Free a departed player's slot, but only pre-match — see the comment on Player.active
        // and on renderRoster above for why this can't just be inferred from onPresenceSync.
        if (!hostLoop || hostLoop.session.state !== "MENU") return;
        for (const p of left) {
          if (p.slot === null) continue;
          const player = hostLoop.session.players[p.slot];
          if (player) player.active = false;
        }
      });
      c.onRenameRequest((clientId, name, color) => {
        const slot = c.slotForClient(clientId);
        if (slot === undefined) return;
        const rejection = hostAuthority.reserveNameColor(slot, name, color);
        if (rejection) c.sendError(clientId, rejection);
        else c.approveRename(clientId, name, color);
      });
      void c.createRoom(myName, myColor).then((code) => {
        roomCode = code;
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
    const myName = currentName();
    // Guests never press a local "paint" key to unlock audio the way MENU->beginRound does for
    // host/local play (a guest's session never runs its own GameSession.update() — see
    // guestSound.ts) — this click is the one real user gesture in the whole join flow, so it's
    // the only place left to satisfy the browser's autoplay policy for a guest's audio.
    sound.unlock();
    // A rejected join (room full, name/color taken) leaves its channel subscribed — only the
    // application-level request was rejected, not the connection itself — so a retry from the
    // same tab must tear that down first. Supabase reuses an already-subscribed channel object
    // for the same room topic rather than creating a new one, and wiring a fresh set of listeners
    // onto an already-subscribed channel throws ("cannot add ... callbacks ... after subscribe()").
    client?.leaveRoom();
    statusEl.textContent = "Connecting…";
    try {
      const c = new NetworkClient();
      client = c;
      c.onPresenceSync(renderRoster);
      c.onConnectionStatus((s) => (onlineMode.connectionStatus = s));
      c.onSlotAssigned((slot) => {
        roomCode = code.toUpperCase();
        statusEl.textContent = `Room ${roomCode} — you're ${myName}.`;
        onlineMode.mySlot = slot;
        beginGuestSession();
      });
      c.onError((message) => {
        statusEl.textContent = message;
      });
      c.onRenameOk((name) => {
        statusEl.textContent = `Room ${roomCode} — you're ${name}.`;
      });
      c.onRoomClosed((reason) => {
        resetToStartScreen(reason);
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
        updateEditability();
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
    if (!hostLoop) return;
    // "There should always be 4 in a room" — whichever slots no real guest claimed in time get
    // backfilled with CPU bots right as the match actually begins, not any earlier (a human can
    // still join and take a slot right up until this click).
    fillWithBots(hostLoop.session.players);
    hostLoop.requestStart();
  });

  function leaveRoom(): void {
    if (!client) return;
    if (onlineMode.role === "host") {
      // Confirmed decision: the host leaving ends the room for everyone — no host migration, the
      // host's tab is the only thing running the authoritative simulation.
      client.announceRoomClosed("Host left the room.");
      hostLoop?.stop();
    }
    client.leaveRoom();
    resetToStartScreen("");
  }

  leaveBtnEl.addEventListener("click", leaveRoom);

  return {
    leaveIfActive: () => {
      if (onlineMode.active) leaveRoom();
    },
  };
}
