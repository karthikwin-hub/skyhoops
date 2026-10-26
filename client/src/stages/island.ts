import * as THREE from 'three';
import { buildCourt, cloudPuffs, floatingIslets, floatingRock, HOOP_BASE, lerp, motes, spotOnArc } from './common';
import type { SceneryContext, StageDef } from './stageTypes';

const bubbleVertex = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const bubbleFragment = /* glsl */ `
uniform float uTime;
varying vec3 vN; varying vec3 vV;
void main() {
  float f = 1.0 - abs(dot(vN, vV));
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (f * 1.6 + uTime * 0.1 + vec3(0.0, 0.33, 0.67)));
  float a = pow(f, 2.5) * 0.9 + 0.04;
  gl_FragColor = vec4(film * (0.6 + f), a);
}`;

/** Iridescent soap bubbles drifting up through the scene. */
function bubbles(ctx: SceneryContext, count: number): (dt: number, t: number) => void {
  const mat = new THREE.ShaderMaterial({ vertexShader: bubbleVertex, fragmentShader: bubbleFragment, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 } } });
  const geo = new THREE.SphereGeometry(1, 24, 16);
  const items: { m: THREE.Mesh; v: number; phase: number }[] = [];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, mat);
    const s = 0.2 + ctx.rng() * 0.6;
    m.scale.setScalar(s);
    const side = ctx.rng() < 0.5 ? -1 : 1;
    m.position.set(side * (9 + ctx.rng() * 14), -10 + ctx.rng() * 22, -8 + ctx.rng() * 24);
    ctx.root.add(m);
    items.push({ m, v: 0.3 + ctx.rng() * 0.5, phase: ctx.rng() * 10 });
  }
  return (dt, t) => {
    mat.uniforms.uTime.value = t;
    for (const b of items) {
      b.m.position.y += b.v * dt;
      b.m.position.x += Math.sin(t * 0.6 + b.phase) * 0.2 * dt;
      if (b.m.position.y > 14) b.m.position.y = -12;
    }
  };
}

/** The hoop's own little island with a tree, flowers and a waterfall spilling into the sky. */
function hoopIsland(ctx: SceneryContext): { group: THREE.Group; update: (dt: number) => void } {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.z = -0.9;
  g.add(inner);
  const rock = floatingRock(2.3, 7, '#a58bb0', 21, 9);
  inner.add(rock);
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.35, 0.35, 12), new THREE.MeshStandardMaterial({ color: '#8fe3a8', roughness: 0.9, flatShading: true }));
  grass.position.y = -0.17;
  grass.receiveShadow = true;
  inner.add(grass);

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 2.4, 8), new THREE.MeshStandardMaterial({ color: '#8a5a7a' }));
  trunk.position.set(1.2, 1.2, -0.8);
  trunk.castShadow = true;
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 1), new THREE.MeshStandardMaterial({ color: '#ff9ad2', emissive: '#ff6ab8', emissiveIntensity: 0.25, flatShading: true }));
  crown.position.set(1.2, 2.7, -0.8);
  crown.castShadow = true;
  inner.add(trunk, crown);

  const flowerMat = new THREE.MeshStandardMaterial({ color: '#fff0a0', emissive: '#ffe066', emissiveIntensity: 0.8 });
  for (let i = 0; i < 22; i++) {
    const a = ctx.rng() * Math.PI * 2, r = 0.7 + ctx.rng() * 1.3;
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), flowerMat);
    f.position.set(Math.cos(a) * r, 0.06, Math.sin(a) * r);
    inner.add(f);
  }

  // Waterfall: a stream of glowing droplets pouring off the back edge.
  const n = ctx.high ? 400 : 200;
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const reset = (i: number) => {
    pos.set([-1.2 + ctx.rng() * 0.8, -0.1, -3.0 - ctx.rng() * 0.3], i * 3);
    vel.set([(ctx.rng() - 0.5) * 0.3, 0, -0.6 - ctx.rng() * 0.4], i * 3);
  };
  for (let i = 0; i < n; i++) {
    reset(i);
    pos[i * 3 + 1] -= ctx.rng() * 14;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const water = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#bfe8ff', size: 0.12, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  water.frustumCulled = false;
  g.add(water);
  ctx.root.add(g);
  return {
    group: g,
    update(dt) {
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        vel[k + 1] -= 6 * dt;
        pos[k] += vel[k] * dt;
        pos[k + 1] += vel[k + 1] * dt;
        pos[k + 2] += vel[k + 2] * dt;
        if (pos[k + 1] < -16) reset(i);
      }
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    },
  };
}

export const island: StageDef = {
  id: 'island',
  index: 3,
  name: 'Drifting Isle',
  subtitle: 'The hoop lives on its own floating island',
  skill: 'The hoop moves. Time your shot.',
  emblem: '🏝',
  accent: '#ff9ad2',
  card: 'linear-gradient(160deg, #8a7cff 0%, #ffb3d9 60%, #8fe3a8 100%)',
  gravity: 9.81,
  shots: 10,
  stars: [10, 20, 30],
  floorZ: [3.0, 11.4],
  hoopIsland: true,
  sky: {
    top: '#7f73f0',
    mid: '#ffb0d8',
    bottom: '#ffe6f3',
    sunDir: new THREE.Vector3(-0.35, 0.45, -1),
    sunColor: '#fff2f8',
    sunSize: 0.0028,
    stars: 0,
    cloudLight: '#fff2fa',
    cloudDark: '#d39ade',
  },
  fog: { color: '#f4c2e4', near: 60, far: 460 },
  light: { sun: '#fff0f6', sunIntensity: 2.6, hemiSky: '#d0c8ff', hemiGround: '#ffb0d8', hemiIntensity: 1.1, envIntensity: 0.9 },
  bloom: 0.85,
  court: { style: 'pastel', base: '#bfe9ff', alt: '#ffffff', paint: '#ff9ad2', line: '#ffffff', lineGlow: 0.25, emblem: 'DRIFTING ISLE', emblemColor: '#8a7cff' },
  rockColor: '#a58bb0',
  hoop: { rim: '#ff5a9a', frame: '#ffffff', pole: '#8a7cff', glow: 1.0 },
  net: { color: '#ffffff', glow: 0.35 },
  music: { bpm: 88, root: 65, scale: 'major', chords: [0, 5, 3, 4], bright: 0.6, lead: 'bell', swing: 0.08 },

  setupShot({ shotIndex: i }, rng) {
    const k = i / 9;
    return {
      spot: spotOnArc(lerp(5.6, 7.6, k), (rng() - 0.5) * 40),
      wind: new THREE.Vector3(),
      rimScale: 1,
      assist: 0.38,
      guide: lerp(0.35, 0.2, k),
      hint: i === 0 ? 'The hoop is drifting! Shoot when it lines up.' : undefined,
    };
  },

  hoopOffset(t, { shotIndex }, out) {
    const k = Math.min(1, shotIndex / 9);
    const amp = lerp(0.7, 2.6, k);
    const w = lerp(0.5, 0.85, k);
    return out.set(Math.sin(t * w) * amp, Math.sin(t * w * 1.3 + 1) * 0.35, Math.sin(t * w * 0.7) * 0.4).add(HOOP_BASE);
  },

  build(ctx) {
    buildCourt(ctx, { court: island.court, rockColor: island.rockColor, trim: '#ffffff', minZ: 3.0 });
    const isle = hoopIsland(ctx);
    const islets = floatingIslets(ctx, 14, '#a58bb0', '#8fe3a8', [24, 75]);
    const bub = bubbles(ctx, ctx.high ? 26 : 12);
    const sparkle = motes(ctx, { count: 120, color: '#ffffff', size: 0.05, center: new THREE.Vector3(0, 3, 3), spread: new THREE.Vector3(24, 8, 22), drift: new THREE.Vector3(0, 0.08, 0), twinkle: 1 });
    const clouds = cloudPuffs(ctx, ctx.high ? 30 : 16, '#fff0fa', 160, [-28, 12], [30, 70], 0.85);
    return {
      update({ dt, t, hoop }) {
        isle.group.position.set(hoop.x, hoop.y - HOOP_BASE.y, hoop.z);
        isle.update(dt);
        islets(t);
        bub(dt, t);
        sparkle(dt, t);
        clouds(dt);
      },
    };
  },
};
