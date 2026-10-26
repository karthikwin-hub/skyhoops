import * as THREE from 'three';
import { glowTexture } from '../engine/textures';

/** Additive glowing sparks: score bursts, fire trails, portal shimmer. */
export class Sparks {
  readonly points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private cursor = 0;

  constructor(max = 1500) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: { uMap: { value: glowTexture() }, uScale: { value: window.innerHeight * 0.5 } },
      vertexShader: /* glsl */ `
        attribute float size;
        varying vec3 vColor;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a;
          gl_FragColor = vec4(vColor * a, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, size: number, life: number, drag = 1.5, gravity = 0): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.drag[i] = drag;
    this.grav[i] = gravity;
  }

  burst(p: THREE.Vector3, count: number, speed: number, colors: THREE.Color[], size = 0.25, life = 1.1, gravity = 2): void {
    const v = new THREE.Vector3();
    for (let n = 0; n < count; n++) {
      v.randomDirection().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      this.emit(p, v, colors[n % colors.length], size * (0.5 + Math.random()), life * (0.6 + Math.random() * 0.6), 2.2, gravity);
    }
  }

  /** A flat expanding ring of light, e.g. around the rim on a swish. */
  ring(center: THREE.Vector3, radius: number, count: number, speed: number, color: THREE.Color): void {
    const v = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let n = 0; n < count; n++) {
      const a = (n / count) * Math.PI * 2;
      p.set(center.x + Math.cos(a) * radius, center.y, center.z + Math.sin(a) * radius);
      v.set(Math.cos(a) * speed, (Math.random() - 0.3) * 0.4, Math.sin(a) * speed);
      this.emit(p, v, color, 0.18, 0.8, 2.5, 0);
    }
  }

  update(dt: number): void {
    const c = this.points.geometry.getAttribute('color') as THREE.BufferAttribute;
    const s = this.points.geometry.getAttribute('size') as THREE.BufferAttribute;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt;
      this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const fade = Math.max(0, this.life[i] / this.maxLife[i]);
      if (this.life[i] <= 0) this.size[i] = 0;
      else this.size[i] *= 0.985 + 0.015 * fade;
      this.col[k] *= 0.97 + 0.03 * fade;
      this.col[k + 1] *= 0.97 + 0.03 * fade;
      this.col[k + 2] *= 0.97 + 0.03 * fade;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    c.needsUpdate = true;
    s.needsUpdate = true;
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = window.innerHeight * 0.5;
  }
}

/** Spinning paper confetti with flutter, lit by the scene. */
export class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private n: number;
  private p: Float32Array;
  private v: Float32Array;
  private r: Float32Array;
  private w: Float32Array;
  private life: Float32Array;
  private cursor = 0;
  private dummy = new THREE.Object3D();
  gravity = 3.2;

  constructor(n = 600) {
    this.n = n;
    const geo = new THREE.PlaneGeometry(0.06, 0.035);
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.5, metalness: 0.2, emissive: '#ffffff', emissiveIntensity: 0.15 });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.r = new Float32Array(n * 3);
    this.w = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
  }

  burst(at: THREE.Vector3, count: number, colors: THREE.Color[], power = 1): void {
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      const a = Math.random() * Math.PI * 2;
      const up = 2 + Math.random() * 4;
      const out = 0.5 + Math.random() * 2.5;
      this.p.set([at.x, at.y, at.z], i * 3);
      this.v.set([Math.cos(a) * out * power, up * power, Math.sin(a) * out * power], i * 3);
      this.r.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
      this.w.set([(Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18], i * 3);
      this.life[i] = 3 + Math.random() * 2;
      this.mesh.setColorAt(i, colors[k % colors.length]);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number, t: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      const drag = Math.exp(-2.2 * dt);
      this.v[k] = this.v[k] * drag + Math.sin(t * 3 + i) * 0.8 * dt;
      this.v[k + 1] = this.v[k + 1] * drag - this.gravity * dt;
      this.v[k + 2] = this.v[k + 2] * drag + Math.cos(t * 2.6 + i) * 0.8 * dt;
      for (let c = 0; c < 3; c++) {
        this.p[k + c] += this.v[k + c] * dt;
        this.r[k + c] += this.w[k + c] * dt;
      }
      this.dummy.position.fromArray(this.p, k);
      this.dummy.rotation.set(this.r[k], this.r[k + 1], this.r[k + 2]);
      this.dummy.scale.setScalar(this.life[i] > 0 ? Math.min(1, this.life[i]) : 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
