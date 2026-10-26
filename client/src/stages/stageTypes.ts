import type * as THREE from 'three';
import type { SkyParams } from '../engine/sky';
import type { CourtParams } from '../engine/textures';
import type { HoopStyle } from '../game/hoop';
import type { MusicTheme } from '../audio/music';

export interface PortalPair {
  entry: THREE.Vector3;
  exit: THREE.Vector3;
  /** Horizontal unit vector the ball travels along when it enters. */
  normal: THREE.Vector3;
  radius: number;
}

export interface WallSetup {
  z: number;
  width: number;
  height: number;
}

export interface ShotSetup {
  /** Where the shooter's feet are. */
  spot: THREE.Vector3;
  /** Constant acceleration from wind, in m/s². */
  wind: THREE.Vector3;
  rimScale: number;
  assist: number;
  /** Fraction of the flight shown by the guide arc. */
  guide: number;
  portal?: PortalPair;
  wall?: WallSetup;
  hint?: string;
}

export interface SceneryContext {
  root: THREE.Group;
  rng: () => number;
  high: boolean;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  flashSky(v: number): void;
  thunder(delay: number, strength: number): void;
}

export interface FrameInfo {
  t: number;
  dt: number;
  glow: number;
  wind: THREE.Vector3;
  hoop: THREE.Vector3;
  ball: THREE.Vector3;
  camera: THREE.Camera;
}

export interface Scenery {
  update(f: FrameInfo): void;
  onShot?(setup: ShotSetup): void;
  onBasket?(at: THREE.Vector3): void;
}

export interface LightSetup {
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  envIntensity: number;
}

export interface RoundState {
  shotIndex: number;
  made: number;
  streak: number;
}

export interface StageDef {
  id: string;
  index: number;
  name: string;
  subtitle: string;
  skill: string;
  emblem: string;
  accent: string;
  card: string;
  gravity: number;
  /** Balls per round. Ignored when there is a time limit. */
  shots: number;
  timeLimit?: number;
  stars: readonly [number, number, number];
  sky: SkyParams;
  fog: { color: string; near: number; far: number };
  light: LightSetup;
  bloom: number;
  court: CourtParams;
  rockColor: string;
  hoop: HoopStyle;
  net: { color: string; glow: number };
  music: MusicTheme;
  /** Player floor along z; areas outside are open sky. */
  floorZ?: [number, number];
  /** The hoop stands on its own floating island that moves with it. */
  hoopIsland?: boolean;
  setupShot(state: RoundState, rng: () => number): ShotSetup;
  hoopOffset?(t: number, state: RoundState, out: THREE.Vector3): THREE.Vector3;
  build(ctx: SceneryContext): Scenery;
}
