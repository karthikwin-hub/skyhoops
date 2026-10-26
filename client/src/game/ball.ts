import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BALL_MASS, BALL_RADIUS, type Physics } from '../engine/physics';
import { ballTextures } from '../engine/textures';

const TRAIL = 36;

/** The player's ball: physics body, textured mesh, squash on impact and a glowing ribbon trail. */
export class Ball {
  readonly body: CANNON.Body;
  readonly mesh: THREE.Mesh;
  readonly group = new THREE.Group();
  private material: THREE.MeshStandardMaterial;
  private squash = 0;
  private squashAxis = new THREE.Vector3(0, 1, 0);
  private trail: THREE.Mesh;
  private trailPts: THREE.Vector3[] = [];
  private trailGeo: THREE.BufferGeometry;
  private trailMat: THREE.ShaderMaterial;
  private spawnT = 1;
  private camPos = new THREE.Vector3(0, 2, 10);
  readonly prevPos = new THREE.Vector3();
  held = true;

  constructor(private physics: Physics, color: string) {
    this.body = new CANNON.Body({
      mass: BALL_MASS,
      shape: new CANNON.Sphere(BALL_RADIUS),
      material: physics.mat.ball,
      linearDamping: 0,
      angularDamping: 0.08,
    });
    this.body.type = CANNON.Body.KINEMATIC;
    physics.world.addBody(this.body);

    const tex = ballTextures(color);
    this.material = new THREE.MeshStandardMaterial({
      map: tex.map,
      bumpMap: tex.bump,
      bumpScale: 1.2,
      roughness: 0.62,
      metalness: 0,
      emissive: new THREE.Color('#ff5a00'),
      emissiveIntensity: 0,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 48, 32), this.material);
    this.mesh.castShadow = true;
    this.group.add(this.mesh);

    this.trailGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(TRAIL * 2 * 3);
    const along = new Float32Array(TRAIL * 2);
    const edge = new Float32Array(TRAIL * 2);
    const idx: number[] = [];
    for (let i = 0; i < TRAIL; i++) {
      along[i * 2] = along[i * 2 + 1] = i / (TRAIL - 1);
      edge[i * 2] = -1;
      edge[i * 2 + 1] = 1;
      if (i < TRAIL - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.trailGeo.setAttribute('along', new THREE.BufferAttribute(along, 1));
    this.trailGeo.setAttribute('edge', new THREE.BufferAttribute(edge, 1));
    this.trailGeo.setIndex(idx);
    this.trailMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uFire: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float along;
        attribute float edge;
        varying float vAlong;
        varying float vEdge;
        void main() { vAlong = along; vEdge = edge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uFire; uniform float uOpacity;
        varying float vAlong;
        varying float vEdge;
        void main() {
          float core = 1.0 - vEdge * vEdge;
          vec3 fire = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.3), vAlong);
          vec3 c = mix(uColor * 1.4, fire * 2.5, uFire) * (0.7 + core * 0.6);
          gl_FragColor = vec4(c, pow(vAlong, 1.6) * core * core * uOpacity * (0.45 + uFire * 0.5));
        }`,
    });
    this.trail = new THREE.Mesh(this.trailGeo, this.trailMat);
    this.trail.frustumCulled = false;
    this.group.add(this.trail);
  }

  setColor(color: string): void {
    const tex = ballTextures(color);
    this.material.map = tex.map;
    this.material.bumpMap = tex.bump;
    this.material.needsUpdate = true;
    (this.trailMat.uniforms.uColor.value as THREE.Color).set(color);
  }

  setFire(v: number): void {
    this.material.emissiveIntensity = v * 0.9;
    this.trailMat.uniforms.uFire.value = v;
  }

  hold(p: THREE.Vector3): void {
    this.held = true;
    this.body.type = CANNON.Body.KINEMATIC;
    this.body.velocity.setZero();
    this.body.angularVelocity.set(0, 0.6, 0);
    this.body.position.set(p.x, p.y, p.z);
    this.prevPos.copy(p);
  }

  respawn(p: THREE.Vector3): void {
    this.hold(p);
    this.spawnT = 0;
    this.trailPts.length = 0;
  }

  launch(v: { x: number; y: number; z: number }, sideSpin: number): void {
    this.held = false;
    this.body.type = CANNON.Body.DYNAMIC;
    this.body.velocity.set(v.x, v.y, v.z);
    const horiz = new THREE.Vector3(v.x, 0, v.z).normalize();
    // Backspin: the top of the ball rolls back toward the shooter.
    const axis = new THREE.Vector3().crossVectors(horiz, new THREE.Vector3(0, 1, 0)).normalize();
    this.body.angularVelocity.set(axis.x * 14, sideSpin, axis.z * 14);
    this.body.wakeUp();
  }

  impact(normal: THREE.Vector3, strength: number): void {
    this.squash = Math.min(0.35, Math.max(this.squash, strength * 0.05));
    this.squashAxis.copy(normal).normalize();
  }

  get position(): THREE.Vector3 {
    return this.mesh.position;
  }

  sync(dt: number, trailOn: boolean): void {
    const p = this.body.position;
    const q = this.body.quaternion;
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.set(q.x, q.y, q.z, q.w);

    this.spawnT = Math.min(1, this.spawnT + dt * 3.5);
    const pop = this.spawnT < 1 ? 1 - Math.pow(1 - this.spawnT, 3) * Math.cos(this.spawnT * 9) : 1;
    this.squash = Math.max(0, this.squash - dt * 4);
    const s = 1 - this.squash;
    const inv = 1 + this.squash * 0.5;
    // Squash along the impact normal by scaling in the ball's local frame.
    const local = this.squashAxis.clone().applyQuaternion(this.mesh.quaternion.clone().invert());
    const ax = Math.abs(local.x), ay = Math.abs(local.y), az = Math.abs(local.z);
    this.mesh.scale.set(
      pop * (ax > ay && ax > az ? s : inv),
      pop * (ay >= ax && ay >= az ? s : inv),
      pop * (az > ax && az > ay ? s : inv),
    );

    if (trailOn && !this.held) {
      this.trailPts.push(this.mesh.position.clone());
      if (this.trailPts.length > TRAIL) this.trailPts.shift();
    } else if (this.trailPts.length) {
      this.trailPts.shift();
    }
    this.updateTrail();
  }

  private updateTrail(): void {
    const pos = this.trailGeo.getAttribute('position') as THREE.BufferAttribute;
    const n = this.trailPts.length;
    this.trailMat.uniforms.uOpacity.value = n > 2 ? 1 : 0;
    if (n < 2) return;
    const cam = this.camPos;
    for (let i = 0; i < TRAIL; i++) {
      const k = Math.max(0, i - (TRAIL - n));
      const p = this.trailPts[Math.min(n - 1, k)];
      const pNext = this.trailPts[Math.min(n - 1, k + 1)];
      const pPrev = this.trailPts[Math.max(0, k - 1)];
      const dir = pNext.clone().sub(pPrev);
      const toCam = cam.clone().sub(p);
      const side = dir.cross(toCam);
      // Seen end-on the ribbon degenerates; thin it out instead of letting it flicker.
      const facing = Math.min(1, side.length() / Math.max(1e-6, dir.length() * toCam.length()) * 2);
      side.normalize();
      const w = BALL_RADIUS * 0.6 * (i / TRAIL) * facing;
      pos.setXYZ(i * 2, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      pos.setXYZ(i * 2 + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
    }
    pos.needsUpdate = true;
  }

  setCameraPosition(cam: THREE.Vector3): void {
    this.camPos.copy(cam);
  }

  dispose(): void {
    this.physics.world.removeBody(this.body);
  }
}
