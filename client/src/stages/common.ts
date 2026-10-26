import * as THREE from 'three';
import { COURT, cloudPuffTexture, courtTextures, glowTexture, noise3, type CourtParams } from '../engine/textures';
import type { SceneryContext } from './stageTypes';

export const HOOP_BASE = new THREE.Vector3(0, 3.05, 0);
export const RELEASE_HEIGHT = 1.6;

/** Where the ball leaves the shooter's hands for a given spot. */
export function releasePoint(spot: THREE.Vector3, hoop: THREE.Vector3): THREE.Vector3 {
  const dir = hoop.clone().sub(spot).setY(0).normalize();
  return spot.clone().add(new THREE.Vector3(0, RELEASE_HEIGHT, 0)).addScaledVector(dir, 0.3);
}

/** Shooting spot at a distance from the rim, angle 0 = straight out from the basket. */
export function spotOnArc(distance: number, angleDeg: number): THREE.Vector3 {
  const a = (angleDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * distance, 0, Math.cos(a) * distance);
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Low-poly floating rock: an upside-down cone roughened with noise. */
export function floatingRock(radius: number, depth: number, color: string, seed = 1, segments = 10): THREE.Mesh {
  const geo = new THREE.ConeGeometry(radius, depth, segments, 6, false);
  geo.rotateX(Math.PI);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const top = v.y > depth / 2 - 0.01;
    const n = noise3(v.x * 0.35 + seed, v.y * 0.35, v.z * 0.35) - 0.5;
    const r = Math.hypot(v.x, v.z);
    if (r > 0.01) {
      const k = 1 + n * (top ? 0.08 : 0.45);
      v.x *= k;
      v.z *= k;
    }
    if (!top) v.y += n * depth * 0.18;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true });
  const m = new THREE.Mesh(flat, mat);
  m.position.y = -depth / 2;
  m.receiveShadow = true;
  return m;
}

export interface CourtOptions {
  court: CourtParams;
  rockColor: string;
  trim: string;
  minZ?: number;
  maxZ?: number;
  rock?: boolean;
  surface?: Partial<THREE.MeshStandardMaterialParameters>;
}

/** The floating court every world is built on: painted surface, stone slab, rocky underside and glowing trim. */
export function buildCourt(ctx: SceneryContext, o: CourtOptions): THREE.Group {
  const g = new THREE.Group();
  const minZ = o.minZ ?? COURT.minZ;
  const maxZ = o.maxZ ?? COURT.maxZ;
  const w = COURT.maxX - COURT.minX;
  const d = maxZ - minZ;
  const cz = (minZ + maxZ) / 2;
  const { map, emissive } = courtTextures(o.court);
  if (minZ !== COURT.minZ || maxZ !== COURT.maxZ) {
    const fullD = COURT.maxZ - COURT.minZ;
    for (const t of [map, emissive]) {
      t.repeat.set(1, d / fullD);
      t.offset.set(0, (COURT.maxZ - maxZ) / fullD);
    }
  }
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({
      map,
      emissiveMap: emissive,
      emissive: '#ffffff',
      emissiveIntensity: 1,
      roughness: 0.55,
      metalness: 0.05,
      ...o.surface,
    }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, 0.002, cz);
  top.receiveShadow = true;
  g.add(top);

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.3, 0.7, d + 0.3),
    new THREE.MeshStandardMaterial({ color: o.rockColor, roughness: 0.9 }),
  );
  slab.position.set(0, -0.35, cz);
  slab.receiveShadow = true;
  g.add(slab);

  const trimMat = new THREE.MeshBasicMaterial({ color: o.trim });
  const edge = (len: number, x: number, z: number, rotY: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), trimMat);
    m.position.set(x, 0.0, z);
    m.rotation.y = rotY;
    g.add(m);
  };
  edge(w + 0.32, 0, minZ - 0.16, 0);
  edge(w + 0.32, 0, maxZ + 0.16, 0);
  edge(d + 0.32, COURT.minX - 0.16, cz, Math.PI / 2);
  edge(d + 0.32, COURT.maxX + 0.16, cz, Math.PI / 2);

  if (o.rock !== false) {
    const rock = floatingRock(Math.hypot(w, d) * 0.52, 16, o.rockColor, 3, 12);
    rock.scale.set(1, 1, d / w);
    rock.position.set(0, -0.6 - 8, cz);
    g.add(rock);
  }

  ctx.root.add(g);
  return g;
}

export interface MoteOptions {
  count: number;
  color: string;
  size: number;
  center: THREE.Vector3;
  spread: THREE.Vector3;
  drift: THREE.Vector3;
  twinkle?: number;
  wrap?: boolean;
}

/** Glowing particles that wander around: dust, fireflies, embers, snow, spores. */
export function motes(ctx: SceneryContext, o: MoteOptions): (dt: number, t: number, wind?: THREE.Vector3) => void {
  const n = ctx.high ? o.count : Math.floor(o.count * 0.5);
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = o.center.x + (ctx.rng() - 0.5) * o.spread.x;
    pos[i * 3 + 1] = o.center.y + (ctx.rng() - 0.5) * o.spread.y;
    pos[i * 3 + 2] = o.center.z + (ctx.rng() - 0.5) * o.spread.z;
    seed[i] = ctx.rng() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uMap: { value: glowTexture() },
      uColor: { value: new THREE.Color(o.color) },
      uSize: { value: o.size * window.innerHeight * 0.5 },
      uTime: { value: 0 },
      uTwinkle: { value: o.twinkle ?? 0.5 },
    },
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uSize; uniform float uTime; uniform float uTwinkle;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vA = 1.0 - uTwinkle + uTwinkle * (0.5 + 0.5 * sin(uTime * (1.0 + fract(seed) * 2.5) + seed));
        gl_PointSize = uSize / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec3 uColor;
      varying float vA;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vA;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  ctx.root.add(pts);
  const half = o.spread.clone().multiplyScalar(0.5);
  return (dt, t, wind) => {
    mat.uniforms.uTime.value = t;
    const wx = (wind?.x ?? 0) * 0.6, wz = (wind?.z ?? 0) * 0.6;
    for (let i = 0; i < n; i++) {
      const k = i * 3, s = seed[i];
      pos[k] += (o.drift.x + wx + Math.sin(t * 0.7 + s) * 0.15) * dt;
      pos[k + 1] += (o.drift.y + Math.cos(t * 0.5 + s * 1.3) * 0.08) * dt;
      pos[k + 2] += (o.drift.z + wz + Math.cos(t * 0.6 + s) * 0.15) * dt;
      if (o.wrap !== false) {
        for (let c = 0; c < 3; c++) {
          const ctr = c === 0 ? o.center.x : c === 1 ? o.center.y : o.center.z;
          const h = c === 0 ? half.x : c === 1 ? half.y : half.z;
          if (pos[k + c] > ctr + h) pos[k + c] -= h * 2;
          else if (pos[k + c] < ctr - h) pos[k + c] += h * 2;
        }
      }
    }
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  };
}

/** Soft billboard clouds scattered around the horizon. */
export function cloudPuffs(ctx: SceneryContext, count: number, color: string, radius: number, height: [number, number], scale: [number, number], opacity = 0.8): (dt: number) => void {
  const group = new THREE.Group();
  const tex = cloudPuffTexture();
  const items: { s: THREE.Sprite; speed: number; a: number; r: number }[] = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: opacity * (0.6 + ctx.rng() * 0.4), depthWrite: false, fog: true });
    const s = new THREE.Sprite(mat);
    const a = ctx.rng() * Math.PI * 2;
    const r = radius * (0.6 + ctx.rng() * 0.6);
    const sc = lerp(scale[0], scale[1], ctx.rng());
    s.scale.set(sc * 2, sc, 1);
    s.position.set(Math.sin(a) * r, lerp(height[0], height[1], ctx.rng()), Math.cos(a) * r);
    group.add(s);
    items.push({ s, speed: 0.004 + ctx.rng() * 0.006, a, r });
  }
  ctx.root.add(group);
  return (dt) => {
    for (const it of items) {
      it.a += it.speed * dt;
      it.s.position.x = Math.sin(it.a) * it.r;
      it.s.position.z = Math.cos(it.a) * it.r;
    }
  };
}

/** Smaller rocks bobbing in the air around the court. */
export function floatingIslets(ctx: SceneryContext, count: number, color: string, topColor: string | null, radius: [number, number]): (t: number) => void {
  const items: { m: THREE.Group; base: number; phase: number }[] = [];
  for (let i = 0; i < count; i++) {
    const g = new THREE.Group();
    const size = 0.6 + ctx.rng() * 2.4;
    const rock = floatingRock(size, size * 2.2, color, i * 7.3, 7);
    g.add(rock);
    if (topColor) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.95, size * 1.02, 0.18, 7), new THREE.MeshStandardMaterial({ color: topColor, roughness: 0.9, flatShading: true }));
      cap.position.y = 0.05;
      g.add(cap);
    }
    const a = ctx.rng() * Math.PI * 2;
    const r = lerp(radius[0], radius[1], ctx.rng());
    g.position.set(Math.sin(a) * r, -6 + ctx.rng() * 16, Math.cos(a) * r - 4);
    g.rotation.y = ctx.rng() * 6;
    ctx.root.add(g);
    items.push({ m: g, base: g.position.y, phase: ctx.rng() * 10 });
  }
  return (t) => {
    for (const it of items) {
      it.m.position.y = it.base + Math.sin(t * 0.4 + it.phase) * 0.6;
      it.m.rotation.y += 0.0005;
    }
  };
}

/** Wind streamer on a pole: shows the player which way the wind is blowing. */
export function windFlag(ctx: SceneryContext, at: THREE.Vector3, color: string): (wind: THREE.Vector3, t: number) => void {
  const g = new THREE.Group();
  g.position.copy(at);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 5, 8), new THREE.MeshStandardMaterial({ color: '#d8dde8', metalness: 0.6, roughness: 0.3 }));
  pole.position.y = 2.5;
  pole.castShadow = true;
  g.add(pole);
  const segs = 14;
  const geo = new THREE.PlaneGeometry(2, 0.7, segs, 2);
  geo.translate(1, 0, 0);
  const base = (geo.getAttribute('position') as THREE.BufferAttribute).clone();
  const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.35, roughness: 0.7 }));
  flag.position.y = 4.6;
  flag.castShadow = true;
  g.add(flag);
  ctx.root.add(g);
  return (wind, t) => {
    const strength = Math.min(1, wind.length() / 4);
    const target = Math.atan2(-wind.z, wind.x);
    flag.rotation.y += (target - flag.rotation.y) * 0.05;
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = base.getX(i);
      const droop = (1 - strength) * x * 0.7;
      p.setY(i, base.getY(i) - droop);
      p.setZ(i, Math.sin(x * 3 - t * (4 + strength * 8)) * 0.12 * x * (0.3 + strength));
      p.setX(i, x * (0.55 + 0.45 * strength + 0.0001));
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
  };
}
