import * as THREE from 'three';
import { calmMotion } from './comfort';

export type CameraMode = 'aim' | 'follow' | 'ballcam' | 'orbit' | 'podium';

const tmp = new THREE.Vector3();

/**
 * Moves the camera between shot framing, ball following, the slow-motion ball-cam
 * and cinematic orbits. All motion is critically damped so cuts never feel jarring.
 */
export class CameraDirector {
  mode: CameraMode = 'orbit';
  private pos = new THREE.Vector3(0, 6, 14);
  private look = new THREE.Vector3(0, 3, 0);
  private wantPos = new THREE.Vector3();
  private wantLook = new THREE.Vector3();
  private shake = 0;
  private time = 0;
  private rate = 3;

  /** Where the shooter stands and what they are aiming at. */
  readonly spot = new THREE.Vector3(0, 0, 7);
  readonly aimAt = new THREE.Vector3(0, 3.05, 0);
  readonly ball = new THREE.Vector3();
  readonly hoop = new THREE.Vector3(0, 3.05, 0);
  orbitCenter = new THREE.Vector3(0, 2.6, 0);
  orbitRadius = 11;
  orbitHeight = 3.2;
  orbitSpeed = 0.08;
  private orbitPhase = 0;
  ballcamSide = 1;

  constructor(private camera: THREE.PerspectiveCamera) {}

  setMode(mode: CameraMode, snap = false): void {
    const wasOrbit = this.mode === 'orbit' || this.mode === 'podium';
    this.mode = mode;
    if (!snap && !wasOrbit && (mode === 'orbit' || mode === 'podium')) {
      // Start the orbit where the camera already is, so it never swings through the backboard.
      const a = Math.atan2(this.pos.x - this.orbitCenter.x, this.pos.z - this.orbitCenter.z);
      this.orbitPhase = a - this.time * this.orbitSpeed;
    }
    if (snap) {
      this.computeWanted();
      this.pos.copy(this.wantPos);
      this.look.copy(this.wantLook);
    }
  }

  addShake(amount: number): void {
    if (calmMotion) return;
    this.shake = Math.min(1, this.shake + amount);
  }

  get lookTarget(): THREE.Vector3 {
    return this.look;
  }

  private computeWanted(): void {
    const toAim = tmp.copy(this.aimAt).sub(this.spot).setY(0).normalize();
    switch (this.mode) {
      case 'aim': {
        this.wantPos.copy(this.spot).addScaledVector(toAim, -2.1).setY(this.spot.y + 1.95);
        this.wantLook.copy(this.aimAt).lerp(this.spot, 0.18).setY(this.aimAt.y * 0.78 + this.spot.y * 0.22);
        this.rate = 3.2;
        break;
      }
      case 'follow': {
        this.wantPos.copy(this.spot).addScaledVector(toAim, -1.7).setY(this.spot.y + 2.1);
        this.wantLook.copy(this.aimAt).lerp(this.ball, 0.45);
        this.rate = 2.4;
        break;
      }
      case 'ballcam': {
        const side = new THREE.Vector3(toAim.z, 0, -toAim.x).multiplyScalar(this.ballcamSide);
        this.wantPos.copy(this.hoop).addScaledVector(side, 1.35).addScaledVector(toAim, -1.25);
        this.wantPos.y = this.hoop.y - 0.25;
        this.wantLook.copy(this.hoop).lerp(this.ball, 0.35);
        this.wantLook.y -= 0.1;
        this.rate = 7;
        break;
      }
      case 'orbit':
      case 'podium': {
        const a = this.time * this.orbitSpeed + this.orbitPhase;
        this.wantPos.set(
          this.orbitCenter.x + Math.sin(a) * this.orbitRadius,
          this.orbitCenter.y + this.orbitHeight + Math.sin(a * 0.7) * 0.8,
          this.orbitCenter.z + Math.cos(a) * this.orbitRadius,
        );
        this.wantLook.copy(this.orbitCenter);
        this.rate = 1.5;
        break;
      }
    }
  }

  /** @param realDt unscaled frame time, so the camera stays smooth during slow motion. */
  update(realDt: number): void {
    this.time += realDt;
    this.computeWanted();
    const k = 1 - Math.exp(-this.rate * realDt);
    this.pos.lerp(this.wantPos, k);
    this.look.lerp(this.wantLook, Math.min(1, k * 1.4));

    this.shake = Math.max(0, this.shake - realDt * 2.5);
    const s = this.shake * this.shake * 0.12;
    const breathe = this.mode === 'aim' ? 0.012 : 0.004;
    this.camera.position.set(
      this.pos.x + Math.sin(this.time * 0.9) * breathe + (Math.random() - 0.5) * s,
      this.pos.y + Math.sin(this.time * 1.3) * breathe + (Math.random() - 0.5) * s,
      this.pos.z + (Math.random() - 0.5) * s,
    );
    this.camera.lookAt(this.look);
  }
}
