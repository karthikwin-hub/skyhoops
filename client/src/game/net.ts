import * as THREE from 'three';
import { BALL_RADIUS } from '../engine/physics';

const AROUND = 14;
const ROWS = 7;
const LENGTH = 0.46;
const ITERATIONS = 4;

/**
 * A verlet cloth net woven in the classic diamond pattern. The top row is tied to the rim;
 * everything else swings, stretches and snaps when the ball pushes through it.
 */
export class Net {
  readonly mesh: THREE.InstancedMesh;
  private count = AROUND * ROWS;
  private pos = new Float32Array(this.count * 3);
  private prev = new Float32Array(this.count * 3);
  private rest: { a: number; b: number; len: number; visible: boolean }[] = [];
  private anchors: THREE.Vector3[] = [];
  private visibleLinks: { a: number; b: number }[] = [];
  private rimRadius = 0.2286;
  private dummy = new THREE.Object3D();
  private up = new THREE.Vector3(0, 1, 0);
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  gravity = 9.81;
  readonly wind = new THREE.Vector3();
  /** How much the ball is currently being slowed by the net (0..1), for sound and feel. */
  contact = 0;

  constructor(rimCenter: THREE.Vector3) {
    this.layout(rimCenter, this.rimRadius);
    const geo = new THREE.CylinderGeometry(0.0055, 0.0055, 1, 5, 1, true);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.25 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.visibleLinks.length);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.render();
  }

  setColor(color: string, glow: number): void {
    const m = this.mesh.material as THREE.MeshStandardMaterial;
    m.color.set(color);
    m.emissive.set(color);
    m.emissiveIntensity = glow;
  }

  private restPoint(i: number, j: number, rimRadius: number): THREE.Vector3 {
    const t = j / (ROWS - 1);
    const r = rimRadius * (1 - 0.38 * t) - 0.004;
    const a = ((i + 0.5 * (j % 2)) / AROUND) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * r, -t * LENGTH, Math.sin(a) * r);
  }

  /** Re-ties the net to a rim of the given radius and resets its shape. */
  layout(rimCenter: THREE.Vector3, rimRadius: number): void {
    this.rimRadius = rimRadius;
    this.rest = [];
    this.visibleLinks = [];
    this.anchors = [];
    const id = (i: number, j: number) => j * AROUND + (((i % AROUND) + AROUND) % AROUND);
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < AROUND; i++) {
        const p = this.restPoint(i, j, rimRadius);
        pts.push(p);
        if (j === 0) this.anchors.push(p.clone());
        const k = id(i, j) * 3;
        this.pos[k] = this.prev[k] = p.x + rimCenter.x;
        this.pos[k + 1] = this.prev[k + 1] = p.y + rimCenter.y;
        this.pos[k + 2] = this.prev[k + 2] = p.z + rimCenter.z;
      }
    }
    const link = (a: number, b: number, visible: boolean, slack = 1) => {
      this.rest.push({ a, b, len: pts[a].distanceTo(pts[b]) * slack, visible });
      if (visible) this.visibleLinks.push({ a, b });
    };
    for (let j = 0; j < ROWS - 1; j++) {
      for (let i = 0; i < AROUND; i++) {
        const a = id(i, j);
        if (j % 2 === 0) {
          link(a, id(i, j + 1), true);
          link(a, id(i - 1, j + 1), true);
        } else {
          link(a, id(i, j + 1), true);
          link(a, id(i + 1, j + 1), true);
        }
      }
    }
    for (let j = 1; j < ROWS; j++) {
      for (let i = 0; i < AROUND; i++) link(id(i, j), id(i + 1, j), false, 1.04);
    }
    for (let i = 0; i < AROUND; i++) link(id(i, ROWS - 1), id(i + AROUND / 2, ROWS - 1), false, 1.0);
  }

  /** Gives the bottom of the net a downward tug, used when a swish snaps it. */
  snap(strength: number): void {
    for (let j = 2; j < ROWS; j++) {
      for (let i = 0; i < AROUND; i++) {
        const k = (j * AROUND + i) * 3;
        this.prev[k + 1] += 0.012 * strength * (j / ROWS);
      }
    }
  }

  step(dt: number, rimCenter: THREE.Vector3, ball: THREE.Vector3, ballVel: { x: number; y: number; z: number } | null): void {
    const damping = 0.985;
    const g = this.gravity * dt * dt;
    const wx = this.wind.x * dt * dt * 0.15;
    const wz = this.wind.z * dt * dt * 0.15;
    for (let i = AROUND; i < this.count; i++) {
      const k = i * 3;
      for (let c = 0; c < 3; c++) {
        const p = this.pos[k + c];
        const v = (p - this.prev[k + c]) * damping;
        this.prev[k + c] = p;
        this.pos[k + c] = p + v - (c === 1 ? g : 0) + (c === 0 ? wx : c === 2 ? wz : 0);
      }
    }
    for (let i = 0; i < AROUND; i++) {
      const k = i * 3;
      const a = this.anchors[i];
      this.pos[k] = this.prev[k] = rimCenter.x + a.x;
      this.pos[k + 1] = this.prev[k + 1] = rimCenter.y + a.y;
      this.pos[k + 2] = this.prev[k + 2] = rimCenter.z + a.z;
    }

    const minD = BALL_RADIUS + 0.012;
    this.contact = 0;
    const nearNet = Math.abs(ball.y - (rimCenter.y - LENGTH / 2)) < LENGTH && Math.hypot(ball.x - rimCenter.x, ball.z - rimCenter.z) < this.rimRadius + 0.2;

    for (let it = 0; it < ITERATIONS; it++) {
      for (const r of this.rest) {
        const ka = r.a * 3, kb = r.b * 3;
        const dx = this.pos[kb] - this.pos[ka];
        const dy = this.pos[kb + 1] - this.pos[ka + 1];
        const dz = this.pos[kb + 2] - this.pos[ka + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        // Visible strings only resist stretching; hidden links also push back to keep the net's shape.
        if (d < r.len && r.visible) continue;
        const diff = (d - r.len) / d;
        const aPinned = r.a < AROUND, bPinned = r.b < AROUND;
        const wa = aPinned ? 0 : bPinned ? 1 : 0.5;
        const wb = bPinned ? 0 : aPinned ? 1 : 0.5;
        const s = r.visible ? 1 : 0.35;
        this.pos[ka] += dx * diff * wa * s;
        this.pos[ka + 1] += dy * diff * wa * s;
        this.pos[ka + 2] += dz * diff * wa * s;
        this.pos[kb] -= dx * diff * wb * s;
        this.pos[kb + 1] -= dy * diff * wb * s;
        this.pos[kb + 2] -= dz * diff * wb * s;
      }
      if (nearNet) {
        for (let i = AROUND; i < this.count; i++) {
          const k = i * 3;
          const dx = this.pos[k] - ball.x;
          const dy = this.pos[k + 1] - ball.y;
          const dz = this.pos[k + 2] - ball.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < minD * minD) {
            const d = Math.sqrt(d2) || 1e-6;
            const push = (minD - d) / d;
            this.pos[k] += dx * push;
            this.pos[k + 1] += dy * push;
            this.pos[k + 2] += dz * push;
            if (it === 0) this.contact += 1;
          }
        }
      }
    }
    if (ballVel && this.contact > 0) this.contact = Math.min(1, this.contact / 10);
  }

  render(): void {
    for (let n = 0; n < this.visibleLinks.length; n++) {
      const { a, b } = this.visibleLinks[n];
      this.tmpA.fromArray(this.pos, a * 3);
      this.tmpB.fromArray(this.pos, b * 3);
      const dir = this.tmpB.sub(this.tmpA);
      const len = dir.length();
      this.dummy.position.copy(this.tmpA);
      this.dummy.quaternion.setFromUnitVectors(this.up, dir.multiplyScalar(1 / (len || 1)));
      this.dummy.scale.set(1, len, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** True when a point is inside the net's cylinder (used to slow the ball as it passes through). */
  contains(p: THREE.Vector3, rimCenter: THREE.Vector3): boolean {
    const dy = rimCenter.y - p.y;
    return dy > 0 && dy < LENGTH && Math.hypot(p.x - rimCenter.x, p.z - rimCenter.z) < this.rimRadius;
  }
}
