import * as THREE from 'three';
import type { V3 } from './ballistics';

const DOTS = 34;

export type Teleport = (prev: THREE.Vector3, curr: THREE.Vector3) => THREE.Vector3 | null;

/** Dotted "ghost trajectory" shown while aiming. Stages decide how much of it you get to see. */
export class GuideArc {
  readonly mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private colors: Float32Array;
  private opacity = 0;
  private targetOpacity = 0;

  constructor() {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 8, 6), mat, DOTS);
    this.mesh.frustumCulled = false;
    this.colors = new Float32Array(DOTS * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.mesh.visible = false;
  }

  hide(): void {
    this.targetOpacity = 0;
  }

  /**
   * @param fraction how much of the flight (0..1) is revealed.
   */
  show(from: THREE.Vector3, v: V3, g: number, fraction: number, color: THREE.Color, teleport?: Teleport, flightTime = 1.6): void {
    if (fraction <= 0) {
      this.hide();
      return;
    }
    this.targetOpacity = 1;
    this.mesh.visible = true;
    const p = from.clone();
    const prev = new THREE.Vector3();
    const vel = new THREE.Vector3(v.x, v.y, v.z);
    const total = flightTime * fraction;
    const dt = 1 / 120;
    const spacing = total / DOTS;
    let t = 0, nextDot = spacing * 0.5, n = 0;
    while (n < DOTS && t < total) {
      prev.copy(p);
      vel.y -= g * dt;
      p.addScaledVector(vel, dt);
      const tp = teleport?.(prev, p);
      if (tp) p.copy(tp);
      t += dt;
      if (t >= nextDot) {
        const k = n / DOTS;
        this.dummy.position.copy(p);
        this.dummy.scale.setScalar(1 - k * 0.55);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(n, this.dummy.matrix);
        const fade = (1 - k) * (1 - k);
        this.colors[n * 3] = color.r * fade;
        this.colors[n * 3 + 1] = color.g * fade;
        this.colors[n * 3 + 2] = color.b * fade;
        nextDot += spacing;
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number): void {
    this.opacity += (this.targetOpacity - this.opacity) * Math.min(1, dt * 10);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = this.opacity;
    if (this.opacity < 0.01 && this.targetOpacity === 0) this.mesh.visible = false;
  }
}
