import {
  BIGSHOT_MULTIPLIER,
  CANVAS_H,
  CANVAS_W,
  CLEAR_FRACTION,
  CONFUSE_DURATION_MS,
  ERASER_DURATION_MS,
  ERASER_RADIUS,
  ERASER_REDIRECT_MS,
  ERASER_SPEED,
  ERASER_SPLIT_COUNT,
  ERASER_SPLIT_SIZE_MULT,
  ERASER_SPLIT_SPEED_MULT,
  FINAL_BURST_AT_MS,
  FINAL_BURST_COUNT,
  GUN_BASE_Y,
  GUN_LENGTH,
  gunStationX,
  IMPACT_FLASH_MS,
  type KeyBinding,
  LAST_CHANCE_MS,
  MACHINEGUN_DURATION_MS,
  MACHINEGUN_SHOT_RADIUS,
  MIN_RADIUS,
  PLAYER_DEFS,
  POWERUP_CLAIM_SLACK,
  POWERUP_CLAIMED_FLASH_MS,
  POWERUP_SPAWN_MAX_MS,
  POWERUP_SPAWN_MIN_MS,
  PROJECTILE_DURATION_MS,
  RESULTS_HOLD_MS,
  RESULTS_MANY_OUTLINES_THRESHOLD,
  RESULTS_MANY_OUTLINES_TOTAL_MS,
  RESULTS_PER_OUTLINE_MS,
  ROUND_INTRO_MS,
  SHRINK_DURATION_MS,
  SPLAT_INTERVAL_MS,
  SWEEP_BAND_HEIGHT,
  SWEEP_DURATION_MS,
  SWEEP_WIDTH,
  TICK_WINDOW_MS,
  type PowerupType,
} from "./constants.ts";
import type { PlayerInputState } from "./Input.ts";
import { Outline, Powerup } from "./Outline.ts";
import { spawnOnePowerup } from "./Powerup.ts";
import { createPlayers, isMachineGunActive, resetForRound, updatePlayer, type Player } from "./Player.ts";
import { computeRoundResults, type OutlineResult } from "./scoring.ts";
import { ROUNDS } from "./rounds.ts";

const PLAYER_KEYS = PLAYER_DEFS.map((d) => d.keys);

export type GameState = "MENU" | "ROUND_INTRO" | "PLAYING" | "ROUND_RESULTS" | "GAME_OVER";

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
  playClaim(): void;
  gameOver(): void;
  setRoundSpeed(roundIndex: number): void;
  playCurtain(): void;
  roundEnd(): void;
  finalRoundEnd(): void;
}

const noopSound: SoundHooks = {
  unlock() {},
  announceRoundStart() {},
  startMusic() {},
  setUrgent() {},
  playTick() {},
  playSplat() {},
  playClaim() {},
  gameOver() {},
  setRoundSpeed() {},
  playCurtain() {},
  roundEnd() {},
  finalRoundEnd() {},
};

/** Emitted whenever an Outline's paint canvas actually changes, so a server can broadcast just
 * the paint action (not pixels) for clients to replay locally on their own canvases. */
export type PaintEvent =
  | { kind: "splat"; outlineIndex: number; x: number; y: number; radius: number; color: string }
  | { kind: "rect"; outlineIndex: number; x: number; y: number; w: number; h: number; color: string }
  | { kind: "erase"; outlineIndex: number; x: number; y: number; radius: number; excludeColor: string }
  | { kind: "clear"; outlineIndex: number; color: string; fraction: number };

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

export class GameSession {
  players: Player[] = createPlayers();
  state: GameState = "MENU";
  stateEnteredAt = 0;
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
  resultsDurationMs = RESULTS_HOLD_MS;
  resultsPerOutlineMs = RESULTS_PER_OUTLINE_MS;
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
    switch (this.state) {
      case "MENU":
        if (input.anyPaintPressed()) {
          this.sound.unlock();
          this.players.forEach((p) => (p.score = 0));
          this.beginRound(0, now);
        }
        break;
      case "ROUND_INTRO":
        if (now - this.stateEnteredAt >= ROUND_INTRO_MS) {
          this.state = "PLAYING";
          this.roundEndAt = now + (this.round?.durationMs ?? 30000);
          this.stateEnteredAt = now;
          this.sound.announceRoundStart();
          this.sound.startMusic();
        }
        break;
      case "PLAYING":
        this.updatePlaying(dt, now, input);
        break;
      case "ROUND_RESULTS":
        if (now - this.stateEnteredAt >= this.resultsDurationMs) {
          if (this.roundIndex + 1 < ROUNDS.length) {
            this.beginRound(this.roundIndex + 1, now);
          } else {
            this.state = "GAME_OVER";
            this.stateEnteredAt = now;
            this.sound.gameOver();
          }
        }
        break;
      case "GAME_OVER":
        if (input.anyPaintPressed()) {
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
    this.state = "ROUND_INTRO";
    this.stateEnteredAt = now;
    this.sound.setUrgent(false);
    this.sound.setRoundSpeed(index);
    this.sound.playCurtain();
  }

  private updatePlaying(dt: number, now: number, input: InputSource): void {
    for (const player of this.players) {
      const keys = PLAYER_KEYS[player.id]!;
      const playerInput = input.getInput(keys);
      const mgActive = isMachineGunActive(player, now);
      updatePlayer(player, playerInput, dt, now);

      if (mgActive) {
        if (now - player.lastSplatAt >= SPLAT_INTERVAL_MS) {
          player.lastSplatAt = now;
          this.fireProjectile(player, player.x, player.y, MACHINEGUN_SHOT_RADIUS, now);
        }
      } else if (player.wasPaintHeld && !playerInput.paint) {
        this.fireProjectile(player, player.x, player.y, player.cursorRadius, now);
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
      if (spawned) this.powerups.push(spawned);
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
        this.onPaint?.({ kind: "splat", outlineIndex: i, x: proj.x, y: proj.y, radius: proj.radius, color: proj.color });
      }
    }
    this.impacts.push({ x: proj.x, y: proj.y, color: proj.color, radius: proj.radius, at: now });
    this.sound.playSplat();
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
      }
    }
  }

  private finishRound(now: number): void {
    this.lastResults = computeRoundResults(this.outlines, this.players, this.round?.pointsByRank);
    const n = this.lastResults.length;
    this.resultsPerOutlineMs =
      n > RESULTS_MANY_OUTLINES_THRESHOLD ? Math.max(120, RESULTS_MANY_OUTLINES_TOTAL_MS / n) : RESULTS_PER_OUTLINE_MS;
    this.resultsDurationMs = n > 0 ? n * this.resultsPerOutlineMs + RESULTS_HOLD_MS : RESULTS_HOLD_MS;
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
}
