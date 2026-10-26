import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Renderer, type Quality } from '../engine/renderer';
import { FIXED_STEP, Physics } from '../engine/physics';
import { Sky } from '../engine/sky';
import { CameraDirector } from '../engine/cameraDirector';
import { mulberry } from '../engine/textures';
import { Ball } from './ball';
import { Hoop, RIM_HEIGHT } from './hoop';
import { Net } from './net';
import { GuideArc, type Teleport } from './guide';
import { Confetti, Sparks } from './particles';
import { Ghosts } from './ghosts';
import { ShotInput } from './input';
import { DEFAULT_TUNING, gestureToShot, idealShot, type AimContext, type Gesture } from './ballistics';
import { computePoints, crossedRim, starsFor, FIRE_STREAK } from './scoring';
import { progress } from './progress';
import { HOOP_BASE, releasePoint } from '../stages/common';
import { STAGES } from '../stages';
import type { Scenery, ShotSetup, StageDef } from '../stages/stageTypes';
import { sfx, Ambience } from '../audio/sfx';
import { music } from '../audio/music';
import { audio } from '../audio/audio';
import { COURT } from '../engine/textures';

export interface ScoreEvent {
  points: number;
  labels: string[];
  total: number;
  streak: number;
  onFire: boolean;
  swish: boolean;
  firstFire: boolean;
}

export interface RoundResult {
  stage: StageDef;
  score: number;
  stars: number;
  made: number;
  shots: number;
  bestStreak: number;
  swishes: number;
  newBest: boolean;
  unlockedNext: boolean;
}

export interface HudState {
  score: number;
  streak: number;
  ballsLeft: number | null;
  timeLeft: number | null;
  wind: THREE.Vector3;
  windScreenAngle: number;
}

export interface GameEvents {
  onShotReady(setup: ShotSetup, shotIndex: number): void;
  onAim(power: number | null): void;
  onScore(e: ScoreEvent): void;
  onMiss(lostStreak: number): void;
  onRoundEnd(r: RoundResult): void;
  onBall(p: [number, number, number]): void;
  onShotEnd(made: boolean): void;
  onTooSoft(): void;
}

type Phase = 'idle' | 'ready' | 'flight' | 'between' | 'done';

const BALLCAM_SCALE = 0.22;

export class Game {
  readonly scene = new THREE.Scene();
  readonly renderer: Renderer;
  readonly physics = new Physics();
  readonly sky = new Sky();
  readonly director: CameraDirector;
  readonly ball: Ball;
  readonly hoop: Hoop;
  readonly net: Net;
  readonly guide = new GuideArc();
  readonly sparks = new Sparks();
  readonly confetti = new Confetti();
  readonly ghosts: Ghosts;
  readonly input: ShotInput;
  events: Partial<GameEvents> = {};

  private sun = new THREE.DirectionalLight('#ffffff', 2);
  private hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
  private stageRoot = new THREE.Group();
  private scenery: Scenery | null = null;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private floor: CANNON.Body;
  private islandBody: CANNON.Body | null = null;
  private wallBody: CANNON.Body | null = null;
  private ambience = new Ambience();
  private rain = new Ambience();

  stage: StageDef = STAGES[0];
  private rng = mulberry(1);
  private phase: Phase = 'idle';
  private attract = false;
  multiplayer = false;
  private setup: ShotSetup | null = null;
  private release = new THREE.Vector3();
  private state = { shotIndex: 0, made: 0, streak: 0 };
  private score = 0;
  private bestStreak = 0;
  private swishes = 0;
  private roundTime = 0;
  private shotTime = 0;
  private scoredAt = -1;
  private betweenT = 0;
  private touchedRim = false;
  private touchedBoard = false;
  private portalUsed = false;
  private ballcam = false;
  private ballcamHold = 0;
  private timeScale = 1;
  private timeScaleTarget = 1;
  private simAcc = 0;
  private clock = new THREE.Timer();
  private t = 0;
  private shotDistance = 0;
  private wind = new THREE.Vector3();
  private aimPower = 0;
  private lastNet = 0;
  private attractTimer = 0;
  private glow = 0;
  private hoopTarget = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private curPos = new THREE.Vector3();
  private fireEmit = 0;

  constructor(container: HTMLElement, quality: Quality) {
    this.renderer = new Renderer(container, this.scene, quality);
    this.director = new CameraDirector(this.renderer.camera);
    this.pmrem = new THREE.PMREMGenerator(this.renderer.renderer);

    this.scene.add(this.sky.group, this.stageRoot, this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -15;
    sc.right = 15;
    sc.top = 15;
    sc.bottom = -15;
    sc.near = 1;
    sc.far = 120;
    this.sun.shadow.mapSize.set(quality.high ? 2048 : 1024, quality.high ? 2048 : 1024);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;

    this.hoop = new Hoop(this.physics);
    this.net = new Net(this.hoop.rimCenter);
    this.ball = new Ball(this.physics, '#ff7a1a');
    this.ghosts = new Ghosts((at, color) => this.sparks.burst(at, 40, 2.5, [new THREE.Color(color).multiplyScalar(2)], 0.2, 0.9, 1));
    this.scene.add(this.hoop.group, this.net.mesh, this.ball.group, this.guide.mesh, this.sparks.points, this.confetti.mesh, this.ghosts.group);

    this.floor = new CANNON.Body({ mass: 0, material: this.physics.mat.floor });
    this.physics.world.addBody(this.floor);
    this.setFloor(COURT.minZ, COURT.maxZ);

    this.ball.body.addEventListener('collide', (e: { body: CANNON.Body; contact: CANNON.ContactEquation }) => this.onCollide(e));

    this.input = new ShotInput(this.renderer.canvas, {
      onStart: () => audio.unlock(),
      onDrag: (g) => this.preview(g),
      onRelease: (g) => this.shoot(g),
      onCancel: () => {
        this.guide.hide();
        this.events.onAim?.(null);
      },
    });

    this.loadStage(STAGES[0]);
    requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- stage setup

  loadStage(def: StageDef): void {
    this.stage = def;
    this.scenery = null;
    this.stageRoot.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) mat.dispose();
    });
    this.stageRoot.clear();

    this.sky.apply(def.sky);
    this.scene.fog = new THREE.Fog(def.fog.color, def.fog.near, def.fog.far);
    this.sun.color.set(def.light.sun);
    this.sun.intensity = def.light.sunIntensity;
    this.sun.target.position.set(0, 0, 4);
    this.sun.position.copy(def.sky.sunDir).normalize().multiplyScalar(50).add(this.sun.target.position);
    if (this.sun.position.y < 12) this.sun.position.y = 12;
    this.hemi.color.set(def.light.hemiSky);
    this.hemi.groundColor.set(def.light.hemiGround);
    this.hemi.intensity = def.light.hemiIntensity;
    this.renderer.setBaseBloom(def.bloom);
    this.hoop.setStyle(def.hoop);
    this.net.setColor(def.net.color, def.net.glow);
    this.physics.setGravity(def.gravity);
    this.net.gravity = def.gravity;
    this.confetti.gravity = def.gravity * 0.33;

    const [minZ, maxZ] = def.floorZ ?? [COURT.minZ, COURT.maxZ];
    this.setFloor(minZ, maxZ);
    if (this.islandBody) {
      this.physics.world.removeBody(this.islandBody);
      this.islandBody = null;
    }
    if (def.hoopIsland) {
      this.islandBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.physics.mat.floor });
      this.islandBody.addShape(new CANNON.Box(new CANNON.Vec3(2.1, 0.2, 2.1)), new CANNON.Vec3(0, -RIM_HEIGHT - 0.2, -0.9));
      this.islandBody.position.set(HOOP_BASE.x, HOOP_BASE.y, HOOP_BASE.z);
      this.physics.world.addBody(this.islandBody);
    }
    this.setWall(null);
    this.hoop.buildRim(1);
    this.hoop.place(HOOP_BASE);
    this.net.layout(this.hoop.rimCenter, this.hoop.rimRadius);

    this.scenery = def.build({
      root: this.stageRoot,
      rng: mulberry(def.index * 977 + 13),
      high: this.renderer.quality.high,
      sun: this.sun,
      hemi: this.hemi,
      flashSky: (v) => (this.sky.flash = v),
      thunder: (delay, strength) =>
        setTimeout(() => {
          sfx.thunder(strength);
          if (strength > 0.8) this.director.addShake(0.35);
        }, delay * 1000),
    });

    const envScene = new THREE.Scene();
    envScene.add(this.sky.group.children[0].clone());
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = def.light.envIntensity;

    music.play(def.music);
    audio.onReady(() => {
      this.ambience.set(def.id === 'cliffs' || def.id === 'storm' ? 'wind' : 'none');
      this.rain.set(def.id === 'storm' ? 'rain' : 'none');
      this.rain.level(def.id === 'storm' ? 0.05 : 0);
    });
  }

  private setFloor(minZ: number, maxZ: number): void {
    while (this.floor.shapes.length) this.floor.removeShape(this.floor.shapes[0]);
    const d = maxZ - minZ;
    this.floor.addShape(new CANNON.Box(new CANNON.Vec3((COURT.maxX - COURT.minX) / 2 + 0.15, 0.35, d / 2 + 0.15)), new CANNON.Vec3(0, -0.35, (minZ + maxZ) / 2));
  }

  private setWall(wall: ShotSetup['wall'] | null): void {
    if (this.wallBody) {
      this.physics.world.removeBody(this.wallBody);
      this.wallBody = null;
    }
    if (!wall) return;
    this.wallBody = new CANNON.Body({ mass: 0, material: this.physics.mat.wall });
    this.wallBody.addShape(new CANNON.Box(new CANNON.Vec3(wall.width / 2, wall.height / 2, 0.05)));
    this.wallBody.position.set(0, wall.height / 2, wall.z);
    this.physics.world.addBody(this.wallBody);
  }

  // ---------------------------------------------------------------- round flow

  startRound(def: StageDef, seed: number, multiplayer: boolean): void {
    this.attract = false;
    this.multiplayer = multiplayer;
    if (def !== this.stage) this.loadStage(def);
    this.rng = mulberry(seed);
    this.state = { shotIndex: 0, made: 0, streak: 0 };
    this.score = 0;
    this.bestStreak = 0;
    this.swishes = 0;
    this.roundTime = 0;
    this.timeScale = this.timeScaleTarget = 1;
    this.ball.setFire(0);
    this.glow = 0;
    music.setLevel(0);
    this.prepareShot(true);
  }

  /** Self-playing demo with an orbiting camera, used behind the menus. */
  startAttract(def: StageDef = this.stage): void {
    this.attract = true;
    this.multiplayer = false;
    this.input.enabled = false;
    this.ballcam = false;
    this.timeScaleTarget = 1;
    this.ball.setFire(0);
    if (this.stage !== def) this.loadStage(def);
    this.phase = 'between';
    this.betweenT = 0.8;
    this.state = { shotIndex: 0, made: 0, streak: 0 };
    this.director.orbitCenter.set(0, 2.4, 3);
    this.director.orbitRadius = 12;
    this.director.orbitHeight = 2.6;
    this.director.orbitSpeed = 0.07;
    this.director.setMode('orbit');
    this.guide.hide();
    music.setLevel(1);
  }

  /** Leaves the current round without results (e.g. back to the menu). */
  stopRound(): void {
    this.phase = 'idle';
    this.input.enabled = false;
    this.guide.hide();
    this.timeScale = this.timeScaleTarget = 1;
    this.ballcam = false;
  }

  showcase(): void {
    this.director.orbitCenter.set(0, 2.8, 1);
    this.director.orbitRadius = 8.5;
    this.director.orbitHeight = 1.4;
    this.director.orbitSpeed = 0.12;
    this.director.setMode('orbit');
  }

  get hud(): HudState {
    const f = this.renderer.camera.getWorldDirection(this.tmp2).setY(0).normalize();
    const w = this.wind;
    const along = w.x * f.x + w.z * f.z;
    const right = w.x * -f.z + w.z * f.x;
    return {
      score: this.score,
      streak: this.state.streak,
      ballsLeft: this.stage.timeLimit ? null : Math.max(0, this.stage.shots - this.state.shotIndex),
      timeLeft: this.stage.timeLimit ? Math.max(0, this.stage.timeLimit - this.roundTime) : null,
      wind: this.wind,
      windScreenAngle: Math.atan2(-along, right),
    };
  }

  private prepareShot(first = false): void {
    let setup: ShotSetup;
    if (this.attract) {
      setup = this.stage.setupShot({ shotIndex: 4 + Math.floor(Math.random() * 6), made: 0, streak: 0 }, Math.random);
    } else {
      setup = this.stage.setupShot(this.state, this.rng);
    }
    this.setup = setup;
    if (Math.abs(this.hoop.rimRadius / 0.2286 - setup.rimScale) > 0.001) {
      this.hoop.buildRim(setup.rimScale);
      this.net.layout(this.hoop.rimCenter, this.hoop.rimRadius);
    }
    this.setWall(setup.wall ?? null);
    this.scenery?.onShot?.(setup);
    this.release.copy(releasePoint(setup.spot, HOOP_BASE));
    this.ball.respawn(this.release);
    this.shotDistance = Math.hypot(setup.spot.x - HOOP_BASE.x, setup.spot.z - HOOP_BASE.z);

    if (!this.attract) {
      this.director.spot.copy(setup.spot);
      this.director.aimAt.copy(HOOP_BASE);
      if (setup.portal) this.director.aimAt.lerp(setup.portal.entry, 0.35);
      this.director.setMode('aim', first);
      this.phase = 'ready';
      this.input.enabled = true;
      this.events.onShotReady?.(setup, this.state.shotIndex);
    } else {
      this.phase = 'ready';
      this.attractTimer = 0.9 + Math.random() * 0.8;
    }
  }

  private aimContext(): AimContext {
    const ideal = this.hoop.rimCenter.clone();
    if (this.setup?.portal) ideal.sub(this.tmp.copy(this.setup.portal.exit).sub(this.setup.portal.entry));
    return {
      from: this.release,
      facing: HOOP_BASE.clone().sub(this.release).setY(0).normalize(),
      ideal,
      g: this.stage.gravity,
    };
  }

  private tpA = new THREE.Vector3();
  private tpB = new THREE.Vector3();
  private teleport: Teleport = (prev, curr) => {
    const p = this.setup?.portal;
    if (!p) return null;
    const sPrev = this.tpA.copy(prev).sub(p.entry).dot(p.normal);
    const rel = this.tpB.copy(curr).sub(p.entry);
    const sCurr = rel.dot(p.normal);
    if (!(sPrev < 0 && sCurr >= 0)) return null;
    rel.addScaledVector(p.normal, -sCurr);
    if (rel.length() > p.radius) return null;
    return curr.clone().add(this.tpA.copy(p.exit).sub(p.entry));
  };

  private preview(g: Gesture): void {
    if (this.phase !== 'ready' || !this.setup) return;
    const shot = gestureToShot(g, this.aimContext(), { ...DEFAULT_TUNING, assist: this.setup.assist });
    this.aimPower = shot ? shot.power : 0;
    this.events.onAim?.(shot ? shot.power : 0);
    if (!shot) {
      this.guide.hide();
      return;
    }
    const flight = (2.2 * shot.velocity.y) / this.stage.gravity;
    this.guide.show(this.release, shot.velocity, this.stage.gravity, this.setup.guide, new THREE.Color(this.stage.accent).multiplyScalar(1.6), this.teleport, flight);
  }

  private shoot(g: Gesture): void {
    this.events.onAim?.(null);
    this.guide.hide();
    if (this.phase !== 'ready' || !this.setup) return;
    const shot = gestureToShot(g, this.aimContext(), { ...DEFAULT_TUNING, assist: this.setup.assist });
    if (!shot) {
      this.events.onTooSoft?.();
      return;
    }
    this.launch(shot.velocity, shot.sideSpin, shot.power);
  }

  private launch(v: { x: number; y: number; z: number }, spin: number, power: number): void {
    this.ball.body.position.set(this.release.x, this.release.y, this.release.z);
    this.ball.prevPos.copy(this.release);
    this.ball.launch(v, spin);
    sfx.whoosh(power);
    this.phase = 'flight';
    this.input.enabled = false;
    this.shotTime = 0;
    this.scoredAt = -1;
    this.touchedRim = false;
    this.touchedBoard = false;
    this.portalUsed = false;
    this.ballcam = false;
    if (!this.attract) this.director.setMode('follow');
  }

  private onCollide(e: { body: CANNON.Body; contact: CANNON.ContactEquation }): void {
    const c = e.contact;
    const impact = Math.abs(c.getImpactVelocityAlongNormal());
    const n = new THREE.Vector3(c.ni.x, c.ni.y, c.ni.z);
    if (e.body === this.hoop.body) {
      // cannon-es does not always order si/sj to match bi/bj, so look the shape up by owner.
      const shape = this.hoop.body.shapes.includes(c.si) ? c.si : c.sj;
      if (this.hoop.rimShapeIds.has(shape.id)) {
        this.touchedRim = true;
        sfx.rim(impact);
        if (impact > 1.5) navigator.vibrate?.(12);
        this.hoop.flash(Math.min(0.4, impact * 0.08));
      } else if (shape.id === this.hoop.boardShapeId) {
        if (this.scoredAt < 0) this.touchedBoard = true;
        sfx.board(impact);
      } else {
        sfx.board(impact * 0.6);
      }
    } else if (e.body === this.floor || e.body === this.islandBody) {
      sfx.bounce(impact);
      this.ball.impact(n, impact);
    } else if (e.body === this.wallBody) {
      sfx.wall(impact);
      this.sparks.burst(this.ball.position, 12, 1.5, [new THREE.Color('#9af0ff').multiplyScalar(2)], 0.15, 0.5, 0);
    }
  }

  private onBasket(): void {
    this.scoredAt = this.shotTime;
    const swish = !this.touchedRim;
    const at = this.hoop.rimCenter.clone();
    const sparkCol = new THREE.Color(this.stage.accent).multiplyScalar(2.2);
    const white = new THREE.Color(2.5, 2.5, 2.5);
    this.net.snap(swish ? 1.2 : 0.6);
    this.hoop.flash(1);
    this.scenery?.onBasket?.(at);
    if (this.attract) {
      sfx.swish(swish);
      this.sparks.ring(at, this.hoop.rimRadius, 40, 2.5, sparkCol);
      return;
    }
    const pts = computePoints({ distance: this.shotDistance, swish, bank: this.touchedBoard, streak: this.state.streak, portal: this.portalUsed });
    const firstFire = this.state.streak + 1 === FIRE_STREAK;
    this.state.streak++;
    this.state.made++;
    this.bestStreak = Math.max(this.bestStreak, this.state.streak);
    if (swish) this.swishes++;
    this.score += pts.points;

    sfx.swish(swish);
    sfx.chime(this.state.streak, this.stage.music.root + 12);
    sfx.cheer(Math.min(1, 0.4 + this.state.streak * 0.15 + (swish ? 0.2 : 0)));
    if (firstFire) sfx.fanfare(this.stage.music.root + 12);
    navigator.vibrate?.(swish ? [25, 40, 35] : [20]);

    this.sparks.ring(at, this.hoop.rimRadius, 60, swish ? 3.5 : 2.2, sparkCol);
    this.sparks.burst(at, swish ? 90 : 45, 4, [sparkCol, white], 0.22, 1.1, 2);
    if (swish || pts.onFire) {
      const palette = ['#ff5a8a', '#ffd23a', '#5ae8ff', '#8aff7a', '#b07aff', '#ffffff'].map((c) => new THREE.Color(c));
      this.confetti.burst(at.clone().add(new THREE.Vector3(0, 0.3, 0)), pts.onFire ? 140 : 80, palette, 1);
    }
    this.renderer.pulse(at, swish ? 1 : 0.5);
    this.director.addShake(swish ? 0.25 : 0.15);

    this.events.onScore?.({ points: pts.points, labels: pts.labels, total: this.score, streak: this.state.streak, onFire: pts.onFire, swish, firstFire });
  }

  private endShot(): void {
    const made = this.scoredAt >= 0;
    this.phase = 'between';
    this.betweenT = this.attract ? 1.4 : 0.55;
    this.ballcam = false;
    this.timeScaleTarget = 1;
    if (this.attract) return;
    this.events.onShotEnd?.(made);
    if (!made) {
      const lost = this.state.streak;
      this.state.streak = 0;
      this.events.onMiss?.(lost);
    }
    this.state.shotIndex++;
  }

  private roundOver(): boolean {
    if (this.stage.timeLimit) return this.roundTime >= this.stage.timeLimit;
    return this.state.shotIndex >= this.stage.shots;
  }

  private finishRound(): void {
    this.phase = 'done';
    this.input.enabled = false;
    const stars = starsFor(this.score, this.stage.stars);
    const rec = progress.record(this.stage.id, this.score, stars);
    sfx.buzzer();
    this.showcase();
    if (stars > 0) {
      const palette = ['#ff5a8a', '#ffd23a', '#5ae8ff', '#8aff7a', '#b07aff'].map((c) => new THREE.Color(c));
      this.confetti.burst(this.hoop.rimCenter.clone().add(new THREE.Vector3(0, 1, 0)), 200, palette, 1.3);
    }
    this.events.onRoundEnd?.({
      stage: this.stage,
      score: this.score,
      stars,
      made: this.state.made,
      shots: this.state.shotIndex,
      bestStreak: this.bestStreak,
      swishes: this.swishes,
      newBest: rec.newBest,
      unlockedNext: rec.unlockedNext,
    });
  }

  // ---------------------------------------------------------------- simulation

  private stepPhysics(): void {
    const b = this.ball.body;
    if (this.stage.hoopOffset) this.stage.hoopOffset(this.roundTime, this.state, this.hoopTarget);
    else this.hoopTarget.copy(HOOP_BASE);
    this.hoop.moveTo(this.hoopTarget, FIXED_STEP);
    if (this.islandBody) {
      const ip = this.islandBody.position;
      this.islandBody.velocity.set((this.hoopTarget.x - ip.x) / FIXED_STEP, (this.hoopTarget.y - ip.y) / FIXED_STEP, (this.hoopTarget.z - ip.z) / FIXED_STEP);
    }

    if (!this.ball.held) {
      b.force.x += this.wind.x * b.mass;
      b.force.y += this.wind.y * b.mass;
      b.force.z += this.wind.z * b.mass;
      const wy = b.angularVelocity.y;
      b.force.x += b.mass * 0.02 * wy * b.velocity.z;
      b.force.z -= b.mass * 0.02 * wy * b.velocity.x;
      if (this.net.contains(this.ball.position, this.hoop.rimCenter)) {
        b.velocity.x *= 0.985;
        b.velocity.z *= 0.985;
        b.velocity.y *= 0.993;
      }
    }

    this.physics.step();
    this.roundTime += this.phase === 'idle' || this.phase === 'done' ? 0 : FIXED_STEP;
    this.shotTime += FIXED_STEP;

    const p = b.position;
    const cur = this.curPos.set(p.x, p.y, p.z);
    this.ball.mesh.position.copy(cur);

    if (!this.ball.held) {
      const tp = this.teleport(this.ball.prevPos, cur);
      if (tp && !this.portalUsed) {
        b.position.set(tp.x, tp.y, tp.z);
        cur.copy(tp);
        this.ball.prevPos.copy(tp);
        this.portalUsed = true;
        sfx.portal();
        this.sparks.burst(tp, 50, 3, [new THREE.Color('#ff5ad8').multiplyScalar(2), new THREE.Color('#ffd35a').multiplyScalar(2)], 0.2, 0.8, 0);
        this.sparks.burst(this.setup!.portal!.entry, 40, 3, [new THREE.Color('#5ae8ff').multiplyScalar(2)], 0.2, 0.8, 0);
      }
      if (this.scoredAt < 0) {
        const prevRel = this.tmp2.copy(this.ball.prevPos).sub(this.hoop.prevRimCenter);
        const pr = { x: prevRel.x, y: prevRel.y, z: prevRel.z };
        const cr = { x: cur.x - this.hoop.rimCenter.x, y: cur.y - this.hoop.rimCenter.y, z: cur.z - this.hoop.rimCenter.z };
        if (crossedRim(pr, cr, this.hoop.rimRadius, 0.12)) this.onBasket();
        else this.checkBallcam(cr, b.velocity.y);
      }
    }
    this.ball.prevPos.copy(cur);
    this.net.step(FIXED_STEP, this.hoop.rimCenter, cur, null);
  }

  private checkBallcam(rel: { x: number; y: number; z: number }, vy: number): void {
    if (this.ballcam || this.touchedRim || vy >= 0) return;
    if (rel.y < 0.05 || rel.y > 0.75) return;
    if (Math.hypot(rel.x, rel.z) > this.hoop.rimRadius * 0.6) return;
    const storm = !!this.stage.timeLimit;
    const want = this.attract ? Math.random() < 0.5 : storm ? this.state.streak >= 2 : this.state.streak >= 1 || this.shotDistance > 6.6 || Math.random() < 0.4;
    if (!want) return;
    this.ballcam = true;
    this.ballcamHold = 0;
    this.timeScaleTarget = BALLCAM_SCALE;
    this.director.ballcamSide = Math.random() < 0.5 ? -1 : 1;
    this.director.setMode('ballcam');
  }

  private update(realDt: number): void {
    this.t += realDt;
    this.timeScale += (this.timeScaleTarget - this.timeScale) * Math.min(1, realDt * (this.timeScaleTarget < this.timeScale ? 14 : 4));
    const dt = realDt * this.timeScale;

    if (this.setup && this.phase !== 'idle') {
      const gust = 1 + Math.sin(this.t * 1.3) * 0.18 + Math.sin(this.t * 3.1) * 0.07;
      this.wind.copy(this.setup.wind).multiplyScalar(gust);
    } else this.wind.set(0, 0, 0);
    this.net.wind.copy(this.wind);
    this.ambience.level(Math.min(0.22, 0.03 + this.wind.length() * 0.05));

    this.simAcc += dt;
    let steps = 0;
    while (this.simAcc >= FIXED_STEP && steps < 16) {
      this.stepPhysics();
      this.simAcc -= FIXED_STEP;
      steps++;
    }
    if (steps === 16) this.simAcc = 0;

    switch (this.phase) {
      case 'ready': {
        if (!this.attract && this.stage.timeLimit && this.roundTime >= this.stage.timeLimit) {
          this.input.enabled = false;
          this.guide.hide();
          this.events.onAim?.(null);
          this.finishRound();
          break;
        }
        const bob = Math.sin(this.t * 3) * 0.015;
        const pull = this.input.active ? this.aimPower : 0;
        const dir = this.tmp.copy(HOOP_BASE).sub(this.release).setY(0).normalize();
        this.ball.body.position.set(this.release.x - dir.x * pull * 0.12, this.release.y + bob + pull * 0.06, this.release.z - dir.z * pull * 0.12);
        if (this.attract) {
          this.attractTimer -= realDt;
          if (this.attractTimer <= 0) {
            const v = idealShot(this.aimContext());
            if (v) {
              const err = Math.random() < 0.3 ? 0.035 : 0.006;
              v.x *= 1 + (Math.random() - 0.5) * err * 2;
              v.y *= 1 + (Math.random() - 0.5) * err;
              v.z *= 1 + (Math.random() - 0.5) * err * 2;
              this.launch(v, 0, 0.6);
            }
          }
        }
        break;
      }
      case 'flight': {
        const p = this.ball.position;
        if (this.ballcam) {
          this.ballcamHold += realDt;
          if ((this.scoredAt >= 0 && this.shotTime - this.scoredAt > 0.35) || this.ballcamHold > 2.2) {
            this.timeScaleTarget = 1;
            if (!this.attract) this.director.setMode('follow');
            else this.director.setMode('orbit');
            this.ballcam = false;
          }
        }
        const v = this.ball.body.velocity;
        const slow = Math.sqrt(9.81 / this.stage.gravity);
        const done =
          (this.scoredAt >= 0 && this.shotTime - this.scoredAt > 1.0) ||
          this.shotTime > 5.5 * slow ||
          p.y < -10 ||
          (this.scoredAt < 0 && this.shotTime > 1.2 * slow && p.y < 0.6 && Math.hypot(v.x, v.y, v.z) < 2.5) ||
          (this.scoredAt < 0 && this.shotTime > 3.2 * slow);
        if (done) this.endShot();
        if (!this.attract && this.multiplayer && this.t - this.lastNet > 1 / 15) {
          this.lastNet = this.t;
          this.events.onBall?.([round2(p.x), round2(p.y), round2(p.z)]);
        }
        break;
      }
      case 'between': {
        this.betweenT -= realDt;
        if (this.betweenT <= 0) {
          if (!this.attract && this.roundOver()) this.finishRound();
          else this.prepareShot();
        }
        break;
      }
    }

    // Juice: the world warms up as the streak grows.
    const glowTarget = this.attract ? 0.2 : Math.min(1, this.state.streak / 5);
    this.glow += (glowTarget - this.glow) * Math.min(1, realDt * 2);
    this.renderer.setGlow(this.glow);
    const fire = !this.attract && this.state.streak >= FIRE_STREAK ? 1 : 0;
    this.ball.setFire(fire);
    if (!this.attract && this.phase !== 'idle') {
      const s = this.state.streak;
      music.setLevel(s >= 5 ? 4 : s >= 3 ? 3 : s >= 2 ? 2 : s >= 1 ? 1 : 0);
    }
    if (fire && !this.ball.held) {
      this.fireEmit += realDt;
      while (this.fireEmit > 1 / 90) {
        this.fireEmit -= 1 / 90;
        const v = this.ball.body.velocity;
        const jitter = this.tmp2.randomDirection().multiplyScalar(0.4);
        this.sparks.emit(
          this.ball.position.clone().addScaledVector(jitter, 0.2),
          new THREE.Vector3(-v.x * 0.1 + jitter.x, 0.8 + jitter.y, -v.z * 0.1 + jitter.z),
          new THREE.Color().setHSL(0.03 + Math.random() * 0.08, 1, 0.55).multiplyScalar(2.5),
          0.22 + Math.random() * 0.15,
          0.45,
          2,
          -1.5,
        );
      }
    }

    // Camera bookkeeping.
    this.director.ball.copy(this.ball.position);
    this.director.hoop.copy(this.hoop.rimCenter);
    if (this.director.mode === 'aim') {
      this.renderer.setFocus(this.hoop.rimCenter);
    } else if (this.director.mode === 'orbit' && this.phase === 'done') {
      this.renderer.setFocus(this.hoop.rimCenter);
    } else {
      this.renderer.setFocus(this.ball.position);
    }
    this.director.update(realDt);

    this.ball.setCameraPosition(this.renderer.camera.position);
    this.ball.sync(dt, !this.ball.held);
    this.hoop.sync(dt, this.glow);
    this.net.render();
    this.guide.update(realDt);
    this.sparks.update(dt);
    this.confetti.update(dt, this.t);
    this.ghosts.tick(realDt);
    this.sky.update(this.t);
    this.scenery?.update({
      t: this.t,
      dt,
      glow: this.glow,
      wind: this.wind,
      hoop: this.hoop.rimCenter,
      ball: this.ball.position,
      camera: this.renderer.camera,
    });
  }

  private loop = (time: number): void => {
    requestAnimationFrame(this.loop);
    this.clock.update(time);
    const dt = Math.min(1 / 20, this.clock.getDelta());
    this.update(dt);
    this.renderer.render(dt);
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
