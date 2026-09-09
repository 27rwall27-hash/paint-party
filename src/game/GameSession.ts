import {
  BIGSHOT_MULTIPLIER,
  CANVAS_H,
  CANVAS_W,
  CLEAR_FRACTION,
  CONFUSE_DURATION_MS,
  CURTAIN_CLOSE_MS,
  ERASER_DURATION_MS,
  ERASER_RADIUS,
  ERASER_REDIRECT_MS,
  ERASER_SPEED,
  ERASER_SPLIT_COUNT,
  ERASER_SPLIT_SIZE_MULT,
  ERASER_SPLIT_SPEED_MULT,
  FINAL_BURST_AT_MS,
  FINAL_BURST_COUNT,
  FINALE_INTENSITY_INTERVAL_MS,
  FINALE_INTENSITY_START_DELAY_MS,
  GUN_BASE_Y,
  GUN_LENGTH,
  gunStationX,
  IMPACT_FLASH_MS,
  type KeyBinding,
  LAST_CHANCE_MS,
  MACHINEGUN_DURATION_MS,
  MACHINEGUN_SHOT_RADIUS,
  MANUAL_FIRE_COOLDOWN_MS,
  MIN_RADIUS,
  PLAYER_DEFS,
  POWERUP_CLAIM_SLACK,
  POWERUP_CLAIMED_FLASH_MS,
  POWERUP_SPAWN_MAX_MS,
  POWERUP_SPAWN_MIN_MS,
  PROJECTILE_DURATION_MS,
  FINALE_TALLY_DELAY_MS,
  MOVE_LOCK_MS,
  RESULTS_LEADERBOARD_MS,
  RESULTS_MANY_OUTLINES_THRESHOLD,
  RESULTS_MANY_OUTLINES_TOTAL_MS,
  RESULTS_PER_OUTLINE_MS,
  RESULTS_TALLY_DELAY_MS,
  ROUND_INTRO_MS,
  ROUND_NUMBER_MS,
  SHRINK_DURATION_MS,
  SPEED_BOOST_DURATION_MS,
  SPLAT_INTERVAL_MS,
  SWEEP_BAND_HEIGHT,
  SWEEP_DURATION_MS,
  SWEEP_WIDTH,
  TICK_WINDOW_MS,
  VICTORY_CURTAIN_HOLD_MS,
  VICTORY_CURTAIN_OPEN_MS,
  type PowerupType,
} from "./constants.ts";
import type { PlayerInputState } from "./Input.ts";
import { Outline, Powerup } from "./Outline.ts";
import { spawnOnePowerup } from "./Powerup.ts";
import { createPlayers, currentMaxRadius, isMachineGunActive, resetForRound, updatePlayer, type Player } from "./Player.ts";
import { computeRoundResults, type OutlineResult } from "./scoring.ts";
import { ROUNDS } from "./rounds.ts";

const PLAYER_KEYS = PLAYER_DEFS.map((d) => d.keys);

export type GameState = "MENU" | "ROUND_INTRO" | "PLAYING" | "ROUND_RESULTS" | "VICTORY" | "GAME_OVER";

/** Whatever supplies per-player input each frame — the browser's real InputManager locally, or
 * a server-side store filled from socket messages when running as the authoritative host. */
export interface InputSource {
  anyPaintPressed(): boolean;
  getInput(keys: KeyBinding): PlayerInputState;
}

/** Sound is a pure side effect of the browser tab it plays in — GameSession never imports the
 * concrete `sound.ts` module (which touches AudioContext/DOM at module scope and can't load in
 * Node) so it can run headless on a server with a no-op implementation. */
export interface SoundHooks {
  unlock(): void;
  announceRoundStart(): void;
  startMusic(): void;
  setUrgent(urgent: boolean): void;
  playTick(): void;
  playSplat(): void;
  /** A full-charge Big Shot landing — bigger and more dramatic than a regular splat. */
  playKaboom(): void;
  playClaim(): void;
  setRoundSpeed(roundIndex: number): void;
  /** Finale-only: level increments every FINALE_INTENSITY_INTERVAL_MS spent playing that round —
   * ramps tempo and pitch together on top of the round's own baseline speed. */
  setFinaleIntensity(level: number): void;
  playCurtain(): void;
  roundEnd(): void;
  finalRoundEnd(): void;
  playSpawn(): void;
  playPointReveal(rank: 0 | 1 | 2): void;
  /** Plays once right as the victory curtain starts its suspense hold, before it opens. */
  playDrumroll(): void;
  stopDrumroll(): void;
  /** The big "Player X Wins!" reveal moment — loops a custom victory theme if provided, else a
   * short synth fanfare. */
  playVictoryTheme(): void;
  stopVictoryTheme(): void;
}

const noopSound: SoundHooks = {
  unlock() {},
  announceRoundStart() {},
  startMusic() {},
  setUrgent() {},
  playTick() {},
  playSplat() {},
  playKaboom() {},
  playClaim() {},
  setRoundSpeed() {},
  setFinaleIntensity() {},
  playCurtain() {},
  roundEnd() {},
  finalRoundEnd() {},
  playSpawn() {},
  playPointReveal() {},
  playDrumroll() {},
  stopDrumroll() {},
  playVictoryTheme() {},
  stopVictoryTheme() {},
};

/** Emitted whenever an Outline's paint canvas actually changes, so a server can broadcast just
 * the paint action (not pixels) for clients to replay locally on their own canvases. */
export type PaintEvent =
  | { kind: "splat"; outlineIndex: number; x: number; y: number; radius: number; color: string; isBigShot: boolean }
  | { kind: "rect"; outlineIndex: number; x: number; y: number; w: number; h: number; color: string }
  | { kind: "erase"; outlineIndex: number; x: number; y: number; radius: number; excludeColor: string }
  | { kind: "clear"; outlineIndex: number; color: string; fraction: number };

/** One "+N points" reveal moment in a round-results sequence — `atMs` is relative to when
 * ROUND_RESULTS was entered. Built once per round from the (already-known) scoring results, so
 * both the score increment and the sound/visual cue can be triggered at exactly the right time
 * without render.ts (or a network snapshot) needing to know anything beyond "what time is it". */
export interface RevealStep {
  atMs: number;
  outlineIndex: number;
  playerId: number;
  points: number;
  /** 0 = +3 (most exciting cue), 1 = +2, 2 = +1 — position within that outline's scorers. */
  rank: 0 | 1 | 2;
}

export interface Sweep {
  ownerId: number;
  color: string;
  x: number;
  bandY: number;
  bandH: number;
  startedAt: number;
}

export interface Projectile {
  ownerId: number;
  x: number;
  y: number;
  launchX: number;
  launchY: number;
  radius: number;
  color: string;
  startedAt: number;
  /** True only for a Big Shot fired at full charge — the "kaboom" shot, gets its own landing cue. */
  isBigShot: boolean;
}

export interface Eraser {
  ownerId: number;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  speed: number;
  lastRedirectAt: number;
  expiresAt: number;
}

export interface Impact {
  x: number;
  y: number;
  color: string;
  radius: number;
  at: number;
}

function randRange(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function randomHeading(speed: number): { vx: number; vy: number } {
  const angle = Math.random() * Math.PI * 2;
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

/** Builds the full round-results reveal sequence from already-computed results — each outline's
 * scoring players (already sorted highest-points-first, since ranking mirrors pixel coverage
 * order) get one evenly-spaced reveal step within that outline's slice of the results timeline.
 * `delayMs` pushes every step back by a flat amount (the post-"Finish!" pause) without changing
 * the spacing between them — it's 0 for the finale's fast many-outline path. */
function buildRevealTimeline(results: OutlineResult[], perOutlineMs: number, delayMs: number): RevealStep[] {
  const steps: RevealStep[] = [];
  results.forEach((result, outlineIndex) => {
    const scorers = result.ranking.filter((e) => e.points > 0);
    const stepMs = perOutlineMs / Math.max(1, scorers.length);
    scorers.forEach((entry, i) => {
      steps.push({
        atMs: delayMs + outlineIndex * perOutlineMs + i * stepMs,
        outlineIndex,
        playerId: entry.playerId,
        points: entry.points,
        rank: Math.min(2, i) as 0 | 1 | 2,
      });
    });
  });
  return steps;
}

export class GameSession {
  players: Player[] = createPlayers();
  state: GameState = "MENU";
  stateEnteredAt = 0;
  /** Guest-only: the host's clock time (hostNow) as of the last applied snapshot — undefined for
   * a host/local session, which is always fully up to date on its own. render.ts uses this to
   * extrapolate erasers' positions from their synced velocity between snapshots instead of
   * leaving them frozen until the next one arrives, which reads as visibly choppy at the
   * broadcast's ~10Hz rate. See onlineSession.ts's applySnapshot. */
  lastSnapshotAt: number | undefined;
  roundIndex = -1;
  roundEndAt = 0;
  outlines: Outline[] = [];
  powerups: Powerup[] = [];
  powerupsRemaining = 0;
  nextPowerupSpawnAt = 0;
  sweeps: Sweep[] = [];
  projectiles: Projectile[] = [];
  erasers: Eraser[] = [];
  impacts: Impact[] = [];
  lastResults: OutlineResult[] = [];
  resultsDurationMs = 0;
  resultsPerOutlineMs = RESULTS_PER_OUTLINE_MS;
  /** How far into ROUND_RESULTS the point-reveal phase runs before the curtain starts closing —
   * render.ts uses this to know when to switch from drawing the in-place reveal to the curtain. */
  resultsRevealEndMs = 0;
  revealTimeline: RevealStep[] = [];
  /** How many entries of revealTimeline have already fired (score applied, cue played) — also
   * doubles as "index of the next one due", since the timeline is built already sorted by atMs. */
  revealedCount = 0;
  /** Whether the victory theme has taken over from the drum roll yet this VICTORY state. */
  private victoryRevealed = false;
  /** Whether the curtain-opening swish has already fired this ROUND_INTRO. */
  private curtainSoundPlayed = false;
  /** Finale-only: how many FINALE_INTENSITY_INTERVAL_MS steps of the panic ramp have fired so far
   * this round — see updatePlaying(). */
  private finaleIntensityLevel = 0;
  /** Raw "is any paint key currently held" from last frame — used to edge-detect a fresh press
   * for menu-style state advances (see update()), independent of Player.wasPaintHeld's per-player
   * charge/release tracking used during PLAYING. */
  private paintWasHeld = false;
  private lastTickSecond = 0;
  private finalBurstTriggered = false;

  private readonly sound: SoundHooks;
  private readonly onPaint?: (e: PaintEvent) => void;

  constructor(sound: SoundHooks = noopSound, onPaint?: (e: PaintEvent) => void) {
    this.sound = sound;
    this.onPaint = onPaint;
  }

  get round() {
    return this.roundIndex >= 0 ? ROUNDS[this.roundIndex] : undefined;
  }

  update(dt: number, now: number, input: InputSource): void {
    // Edge-triggered (not "currently held") for every menu-style advance below — anyPaintPressed()
    // stays true for the whole time a key is held, so a single press-and-hold could otherwise
    // cascade through several state transitions in one go (e.g. VICTORY -> GAME_OVER -> MENU ->
    // a fresh round all in the ~150ms a button is normally held for).
    const paintJustPressed = input.anyPaintPressed() && !this.paintWasHeld;
    this.paintWasHeld = input.anyPaintPressed();

    switch (this.state) {
      case "MENU":
        if (paintJustPressed) {
          this.sound.unlock();
          this.players.forEach((p) => (p.score = 0));
          this.beginRound(0, now);
        }
        break;
      case "ROUND_INTRO": {
        const introElapsed = now - this.stateEnteredAt;
        // The curtain sits closed showing the round number for ROUND_NUMBER_MS before it actually
        // starts opening — the swish sound needs to fire at that same moment, not at the instant
        // this state begins (which used to play it a beat before the curtain visibly moved at all).
        if (!this.curtainSoundPlayed && introElapsed >= ROUND_NUMBER_MS) {
          this.curtainSoundPlayed = true;
          this.sound.playCurtain();
        }
        if (introElapsed >= ROUND_INTRO_MS) {
          this.state = "PLAYING";
          this.roundEndAt = now + (this.round?.durationMs ?? 30000);
          this.stateEnteredAt = now;
          this.sound.announceRoundStart();
          this.sound.startMusic();
        }
        break;
      }
      case "PLAYING":
        this.updatePlaying(dt, now, input);
        break;
      case "ROUND_RESULTS":
        this.updateResults(now);
        if (now - this.stateEnteredAt >= this.resultsDurationMs) {
          if (this.roundIndex + 1 < ROUNDS.length) {
            this.beginRound(this.roundIndex + 1, now);
          } else {
            this.state = "VICTORY";
            this.stateEnteredAt = now;
            this.victoryRevealed = false;
            this.sound.playDrumroll();
          }
        }
        break;
      case "VICTORY": {
        const elapsed = now - this.stateEnteredAt;
        // The drum roll plays through the curtain's hold-then-open build-up; the victory theme
        // only kicks in once the curtain has actually finished opening onto the reveal.
        if (!this.victoryRevealed && elapsed >= VICTORY_CURTAIN_HOLD_MS + VICTORY_CURTAIN_OPEN_MS) {
          this.victoryRevealed = true;
          this.sound.stopDrumroll();
          this.sound.playVictoryTheme();
        }
        // No auto-timeout — the reveal stays up as long as players want to soak in it, and only
        // moves on once someone presses paint (and only after the curtain has actually opened, so
        // mashing the button during the drum-roll build-up can't skip the reveal itself).
        if (this.victoryRevealed && paintJustPressed) {
          this.state = "GAME_OVER";
          this.stateEnteredAt = now;
          this.sound.stopVictoryTheme();
        }
        break;
      }
      case "GAME_OVER":
        if (paintJustPressed) {
          this.state = "MENU";
          this.stateEnteredAt = now;
        }
        break;
    }
  }

  private beginRound(index: number, now: number): void {
    const cfg = ROUNDS[index];
    if (!cfg) return;
    this.roundIndex = index;
    this.outlines = cfg.outlines.map((o) => new Outline(o));
    this.powerups = [];
    this.powerupsRemaining = randRange(cfg.powerupCountRange[0], cfg.powerupCountRange[1]);
    this.nextPowerupSpawnAt = now + randRange(POWERUP_SPAWN_MIN_MS, POWERUP_SPAWN_MAX_MS);
    this.sweeps = [];
    this.projectiles = [];
    this.erasers = [];
    this.impacts = [];
    this.lastTickSecond = 0;
    this.finalBurstTriggered = false;
    resetForRound(this.players);
    this.lastResults = [];
    this.revealTimeline = [];
    this.revealedCount = 0;
    this.resultsRevealEndMs = 0;
    this.state = "ROUND_INTRO";
    this.stateEnteredAt = now;
    this.curtainSoundPlayed = false;
    this.finaleIntensityLevel = 0;
    this.sound.setUrgent(false);
    this.sound.setRoundSpeed(index);
  }

  private updatePlaying(dt: number, now: number, input: InputSource): void {
    // Cursors are frozen for the first stretch of a round — right through the "START!" flash —
    // so it actually registers before anyone can react. Charging is locked right along with
    // movement (both go through the same neutered input below), so there's no way to get a head
    // start on a shot before you're even allowed to move.
    const moveLocked = now - this.stateEnteredAt < MOVE_LOCK_MS;

    // Finale-only panic ramp: stays completely quiet (level 0, same as any other round) for the
    // first FINALE_INTENSITY_START_DELAY_MS, then ticks up another notch every
    // FINALE_INTENSITY_INTERVAL_MS after that — deliberately not something players notice right
    // as the round begins.
    if (this.roundIndex === ROUNDS.length - 1) {
      const finaleElapsed = now - this.stateEnteredAt;
      const level =
        finaleElapsed < FINALE_INTENSITY_START_DELAY_MS
          ? 0
          : 1 + Math.floor((finaleElapsed - FINALE_INTENSITY_START_DELAY_MS) / FINALE_INTENSITY_INTERVAL_MS);
      if (level !== this.finaleIntensityLevel) {
        this.finaleIntensityLevel = level;
        this.sound.setFinaleIntensity(level);
      }
    }
    for (const player of this.players) {
      const keys = PLAYER_KEYS[player.id]!;
      const playerInput = input.getInput(keys);
      const mgActive = isMachineGunActive(player, now);
      updatePlayer(
        player,
        moveLocked ? { ...playerInput, up: false, down: false, left: false, right: false, paint: false } : playerInput,
        dt,
        now,
      );

      if (mgActive) {
        if (now - player.lastSplatAt >= SPLAT_INTERVAL_MS) {
          player.lastSplatAt = now;
          this.fireProjectile(player, player.x, player.y, MACHINEGUN_SHOT_RADIUS, now);
        }
      } else if (player.wasPaintHeld && !playerInput.paint) {
        // A release inside the cooldown window is a "dry fire" — no splat, no sound — so rapid
        // spam-clicking can't match or beat the machine gun power-up's fire rate.
        if (now - player.lastSplatAt >= MANUAL_FIRE_COOLDOWN_MS) {
          player.lastSplatAt = now;
          this.fireProjectile(player, player.x, player.y, player.cursorRadius, now);
        }
        player.cursorRadius = MIN_RADIUS;
      }
      player.wasPaintHeld = mgActive ? false : playerInput.paint;
    }

    this.updateProjectiles(now);
    this.updateSweeps(now);
    this.updateErasers(dt, now);
    this.updatePowerupLifecycle(now);
    this.impacts = this.impacts.filter((i) => now - i.at < IMPACT_FLASH_MS);

    const timeLeft = this.roundEndAt - now;
    this.updateFinalBurst(timeLeft, now);
    this.sound.setUrgent(timeLeft <= LAST_CHANCE_MS && timeLeft > 0);

    if (timeLeft <= TICK_WINDOW_MS && timeLeft > 0) {
      const secsLeft = Math.ceil(timeLeft / 1000);
      if (secsLeft !== this.lastTickSecond) {
        this.lastTickSecond = secsLeft;
        this.sound.playTick();
      }
    }

    if (now >= this.roundEndAt) {
      this.finishRound(now);
    }
  }

  /** One-time event: with FINAL_BURST_AT_MS left in the very last round, drop a burst of machine guns. */
  private updateFinalBurst(timeLeft: number, now: number): void {
    if (this.finalBurstTriggered) return;
    if (this.roundIndex !== ROUNDS.length - 1) return;
    if (timeLeft > FINAL_BURST_AT_MS || timeLeft <= 0) return;
    this.finalBurstTriggered = true;

    const cfg = this.round;
    if (!cfg) return;
    for (let i = 0; i < FINAL_BURST_COUNT; i++) {
      const obstacles = [
        ...cfg.outlines.map((o) => ({ cx: o.cx, cy: o.cy, radius: o.radius })),
        ...this.powerups.map((p) => ({ cx: p.cx, cy: p.cy, radius: p.radius })),
      ];
      const spawned = spawnOnePowerup(obstacles, now, "machinegun");
      if (spawned) {
        this.powerups.push(spawned);
        this.sound.playSpawn();
      }
    }
  }

  private fireProjectile(player: Player, x: number, y: number, radius: number, now: number): void {
    // Launch from the muzzle tip of that player's paint gun, which is always aimed at their
    // cursor — i.e. aimed at (x, y), the same point the shot will land on.
    const baseX = gunStationX(player.id, this.players.length);
    const angle = Math.atan2(y - GUN_BASE_Y, x - baseX);
    const muzzleX = baseX + Math.cos(angle) * GUN_LENGTH;
    const muzzleY = GUN_BASE_Y + Math.sin(angle) * GUN_LENGTH;

    let shotRadius = radius;
    // "Fired at max power" — a fully-charged shot (not the machine gun, which always fires at
    // MIN_RADIUS) with Big Shot active — gets its own dramatic landing cue instead of a plain splat.
    const isBigShot = player.bigShotPending && radius >= currentMaxRadius(player, now);
    if (player.bigShotPending) {
      shotRadius *= BIGSHOT_MULTIPLIER;
      player.bigShotPending = false;
    }

    this.projectiles.push({
      ownerId: player.id,
      x,
      y,
      launchX: muzzleX,
      launchY: muzzleY,
      radius: shotRadius,
      color: player.color,
      startedAt: now,
      isBigShot,
    });
  }

  private updateProjectiles(now: number): void {
    this.projectiles = this.projectiles.filter((proj) => {
      if (now - proj.startedAt < PROJECTILE_DURATION_MS) return true;
      this.landProjectile(proj, now);
      return false;
    });
  }

  private landProjectile(proj: Projectile, now: number): void {
    const player = this.players.find((p) => p.id === proj.ownerId);
    if (!player) return;
    for (const [i, outline] of this.outlines.entries()) {
      if (outline.mayOverlap(proj.x, proj.y, proj.radius)) {
        outline.paintSplat(proj.x, proj.y, proj.radius, proj.color);
        this.onPaint?.({
          kind: "splat",
          outlineIndex: i,
          x: proj.x,
          y: proj.y,
          radius: proj.radius,
          color: proj.color,
          isBigShot: proj.isBigShot,
        });
      }
    }
    this.impacts.push({ x: proj.x, y: proj.y, color: proj.color, radius: proj.radius, at: now });
    if (proj.isBigShot) this.sound.playKaboom();
    else this.sound.playSplat();
    const hit = this.powerups.find(
      (p) => p.state === "active" && p.overlaps(proj.x, proj.y, proj.radius, POWERUP_CLAIM_SLACK),
    );
    if (hit) this.claimPowerup(hit, player, now);
  }

  private claimPowerup(powerup: Powerup, player: Player, now: number): void {
    powerup.state = "claimed";
    powerup.claimedBy = player.id;
    powerup.claimedAt = now;
    this.sound.playClaim();
    this.applyPowerupEffect(powerup.type, player, now);
  }

  private applyPowerupEffect(type: PowerupType, player: Player, now: number): void {
    switch (type) {
      case "shrink":
        for (const p of this.players) {
          if (p.id !== player.id) p.shrinkUntil = now + SHRINK_DURATION_MS;
        }
        break;
      case "machinegun":
        player.machineGunUntil = now + MACHINEGUN_DURATION_MS;
        break;
      case "sweep": {
        const bandY = Math.max(0, Math.min(CANVAS_H - SWEEP_BAND_HEIGHT, player.y - SWEEP_BAND_HEIGHT / 2));
        this.sweeps.push({ ownerId: player.id, color: player.color, x: 0, bandY, bandH: SWEEP_BAND_HEIGHT, startedAt: now });
        break;
      }
      case "clear":
        for (const [i, outline] of this.outlines.entries()) {
          outline.clearOtherColors(player.color, CLEAR_FRACTION);
          this.onPaint?.({ kind: "clear", outlineIndex: i, color: player.color, fraction: CLEAR_FRACTION });
        }
        break;
      case "eraser": {
        const radius = ERASER_RADIUS * ERASER_SPLIT_SIZE_MULT;
        const speed = ERASER_SPEED * ERASER_SPLIT_SPEED_MULT;
        for (let i = 0; i < ERASER_SPLIT_COUNT; i++) {
          const heading = randomHeading(speed);
          this.erasers.push({
            ownerId: player.id,
            color: player.color,
            x: Math.max(radius, Math.min(CANVAS_W - radius, player.x + (Math.random() - 0.5) * 40)),
            y: Math.max(radius, Math.min(CANVAS_H - radius, player.y + (Math.random() - 0.5) * 40)),
            vx: heading.vx,
            vy: heading.vy,
            radius,
            speed,
            lastRedirectAt: now,
            expiresAt: now + ERASER_DURATION_MS,
          });
        }
        break;
      }
      case "bigshot":
        player.bigShotPending = true;
        break;
      case "confuse":
        for (const p of this.players) {
          if (p.id !== player.id) p.confusedUntil = now + CONFUSE_DURATION_MS;
        }
        break;
      case "speedboost":
        player.speedBoostUntil = now + SPEED_BOOST_DURATION_MS;
        break;
    }
  }

  private updateErasers(dt: number, now: number): void {
    this.erasers = this.erasers.filter((eraser) => {
      if (now >= eraser.expiresAt) return false;

      if (now - eraser.lastRedirectAt >= ERASER_REDIRECT_MS) {
        const heading = randomHeading(eraser.speed);
        eraser.vx = heading.vx;
        eraser.vy = heading.vy;
        eraser.lastRedirectAt = now;
      }

      eraser.x += eraser.vx * dt;
      eraser.y += eraser.vy * dt;
      if (eraser.x < eraser.radius || eraser.x > CANVAS_W - eraser.radius) {
        eraser.vx *= -1;
        eraser.x = Math.max(eraser.radius, Math.min(CANVAS_W - eraser.radius, eraser.x));
      }
      if (eraser.y < eraser.radius || eraser.y > CANVAS_H - eraser.radius) {
        eraser.vy *= -1;
        eraser.y = Math.max(eraser.radius, Math.min(CANVAS_H - eraser.radius, eraser.y));
      }

      for (const [i, outline] of this.outlines.entries()) {
        if (outline.mayOverlap(eraser.x, eraser.y, eraser.radius)) {
          outline.eraseColor(eraser.x, eraser.y, eraser.radius, eraser.color);
          this.onPaint?.({ kind: "erase", outlineIndex: i, x: eraser.x, y: eraser.y, radius: eraser.radius, excludeColor: eraser.color });
        }
      }
      return true;
    });
  }

  private updateSweeps(now: number): void {
    this.sweeps = this.sweeps.filter((sweep) => {
      const t = (now - sweep.startedAt) / SWEEP_DURATION_MS;
      if (t >= 1) return false;
      const newX = t * CANVAS_W;
      const bandX = Math.min(sweep.x, newX);
      const bandW = Math.max(1, Math.abs(newX - sweep.x) + SWEEP_WIDTH);
      for (const [i, outline] of this.outlines.entries()) {
        const overlapsX = outline.bbox.x < bandX + bandW && outline.bbox.x + outline.bbox.w > bandX;
        const overlapsY = outline.bbox.y < sweep.bandY + sweep.bandH && outline.bbox.y + outline.bbox.h > sweep.bandY;
        if (overlapsX && overlapsY) {
          outline.paintRect(bandX, sweep.bandY, bandW, sweep.bandH, sweep.color);
          this.onPaint?.({ kind: "rect", outlineIndex: i, x: bandX, y: sweep.bandY, w: bandW, h: sweep.bandH, color: sweep.color });
        }
      }
      sweep.x = newX;
      return true;
    });
  }

  private updatePowerupLifecycle(now: number): void {
    const before = this.powerups.length;
    this.powerups = this.powerups.filter((p) => {
      const expired = p.state === "active" && now >= p.expiresAt;
      const flashDone = p.state === "claimed" && now - p.claimedAt >= POWERUP_CLAIMED_FLASH_MS;
      return !(expired || flashDone);
    });
    if (this.powerups.length < before) {
      this.nextPowerupSpawnAt = now + randRange(POWERUP_SPAWN_MIN_MS, POWERUP_SPAWN_MAX_MS);
    }

    const cfg = this.round;
    const maxConcurrent = cfg?.concurrentPowerups ?? 1;
    if (cfg && this.powerups.length < maxConcurrent && this.powerupsRemaining > 0 && now >= this.nextPowerupSpawnAt) {
      const obstacles = [
        ...cfg.outlines.map((o) => ({ cx: o.cx, cy: o.cy, radius: o.radius })),
        ...this.powerups.map((p) => ({ cx: p.cx, cy: p.cy, radius: p.radius })),
      ];
      const spawned = spawnOnePowerup(obstacles, now);
      if (spawned) {
        this.powerups.push(spawned);
        this.powerupsRemaining--;
        this.nextPowerupSpawnAt = now + randRange(POWERUP_SPAWN_MIN_MS, POWERUP_SPAWN_MAX_MS);
        this.sound.playSpawn();
      }
    }
  }

  private finishRound(now: number): void {
    // Any blob still mid-flight when the timer hits zero never gets to land — it hasn't painted
    // anything yet (that only happens in updateProjectiles/landProjectile, which won't run again
    // once we leave PLAYING), so just dropping it here is enough; nothing to undo.
    this.projectiles = [];
    this.lastResults = computeRoundResults(this.outlines, this.players, this.round?.pointsByRank);
    const n = this.lastResults.length;
    const manyOutlines = n > RESULTS_MANY_OUTLINES_THRESHOLD;
    this.resultsPerOutlineMs = manyOutlines
      ? Math.max(120, RESULTS_MANY_OUTLINES_TOTAL_MS / n)
      : RESULTS_PER_OUTLINE_MS;
    // The finale gets its own (shorter) pause between "Finish!" and the reveal starting — its
    // reveal cycles fast once it begins, so a full normal-round delay would feel disproportionate.
    const tallyDelayMs = manyOutlines ? FINALE_TALLY_DELAY_MS : RESULTS_TALLY_DELAY_MS;
    this.resultsRevealEndMs = n > 0 ? tallyDelayMs + n * this.resultsPerOutlineMs : 0;
    // After the reveal: curtain closes, a leaderboard holds on the closed curtain, then it's gone
    // — the next state (round intro, or victory after the finale) picks up from a closed curtain.
    this.resultsDurationMs = this.resultsRevealEndMs + CURTAIN_CLOSE_MS + RESULTS_LEADERBOARD_MS;
    this.revealTimeline = buildRevealTimeline(this.lastResults, this.resultsPerOutlineMs, tallyDelayMs);
    this.revealedCount = 0;
    this.state = "ROUND_RESULTS";
    this.stateEnteredAt = now;
    if (this.roundIndex === ROUNDS.length - 1) {
      this.sound.finalRoundEnd();
    } else {
      this.sound.roundEnd();
    }
  }

  visiblePowerups(now: number): Powerup[] {
    return this.powerups.filter((p) => p.state === "active" || now - p.claimedAt < POWERUP_CLAIMED_FLASH_MS);
  }

  /** Applies each reveal step's score bump and sound cue the moment its scheduled time arrives —
   * scores build up live over the results sequence instead of all jumping at round-end. */
  private updateResults(now: number): void {
    const elapsed = now - this.stateEnteredAt;
    while (this.revealedCount < this.revealTimeline.length && this.revealTimeline[this.revealedCount]!.atMs <= elapsed) {
      const step = this.revealTimeline[this.revealedCount]!;
      const player = this.players.find((p) => p.id === step.playerId);
      if (player) player.score += step.points;
      this.sound.playPointReveal(step.rank);
      this.revealedCount++;
    }
  }
}
