import * as THREE from 'three';
import { buildCourt, cloudPuffs, floatingIslets, HOOP_BASE, lerp, motes, releasePoint, spotOnArc } from './common';
import { LAUNCH_ANGLE, solveLaunchSpeed } from '../game/ballistics';
import type { SceneryContext, ShotSetup, StageDef } from './stageTypes';

const PORTAL_RADIUS = 0.85;

const swirlVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const swirlFragment = /* glsl */ `
uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform float uPulse;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float s = sin(a * 5.0 + r * 14.0 - uTime * 5.0) * 0.5 + 0.5;
  float s2 = sin(a * 3.0 - r * 9.0 + uTime * 3.0) * 0.5 + 0.5;
  vec3 col = mix(uA, uB, s * s2);
  float core = smoothstep(0.6, 0.0, r);
  float edge = smoothstep(0.75, 1.0, r);
  col = col * (0.8 + core * 1.2 + edge * 1.6) * (1.0 + uPulse * 2.0);
  gl_FragColor = vec4(col, 0.72 + edge * 0.28);
}`;

class Gate {
  readonly group = new THREE.Group();
  private disc: THREE.ShaderMaterial;
  private pulse = 0;
  constructor(colorA: string, colorB: string) {
    this.disc = new THREE.ShaderMaterial({
      vertexShader: swirlVertex,
      fragmentShader: swirlFragment,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color(colorA) }, uB: { value: new THREE.Color(colorB) }, uPulse: { value: 0 } },
    });
    const d = new THREE.Mesh(new THREE.CircleGeometry(PORTAL_RADIUS, 48), this.disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(PORTAL_RADIUS, 0.07, 12, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(colorB).multiplyScalar(2.5) }));
    const outer = new THREE.Mesh(new THREE.TorusGeometry(PORTAL_RADIUS + 0.16, 0.025, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(colorA).multiplyScalar(2) }));
    this.group.add(d, ring, outer);
  }
  kick(): void {
    this.pulse = 1;
  }
  update(dt: number, t: number): void {
    this.pulse = Math.max(0, this.pulse - dt * 2);
    this.disc.uniforms.uTime.value = t;
    this.disc.uniforms.uPulse.value = this.pulse;
    this.group.children[2].rotation.z = t * 0.6;
    const s = 1 + this.pulse * 0.25 + Math.sin(t * 3) * 0.015;
    this.group.scale.setScalar(s);
  }
}

/** Places a portal pair so the perfect shot through them lands in the hoop over the crystal wall. */
export function portalShot(spot: THREE.Vector3, gravity: number, lateral: number, lift: number, jump: number): Pick<ShotSetup, 'portal' | 'wall'> {
  const from = releasePoint(spot, HOOP_BASE);
  const toHoop = HOOP_BASE.clone().sub(from).setY(0).normalize();
  const side = new THREE.Vector3(toHoop.z, 0, -toHoop.x);
  const offset = toHoop.clone().multiplyScalar(jump).addScaledVector(side, lateral).setY(lift);
  const virtual = HOOP_BASE.clone().sub(offset);
  const flat = virtual.clone().sub(from).setY(0);
  const D = flat.length();
  const dir = flat.normalize();
  const v = solveLaunchSpeed(D, virtual.y - from.y, gravity) ?? 8;
  const x = D * 0.55;
  const c = Math.cos(LAUNCH_ANGLE);
  const y = from.y + x * Math.tan(LAUNCH_ANGLE) - (gravity * x * x) / (2 * v * v * c * c);
  const entry = from.clone().addScaledVector(dir, x).setY(y);
  const exit = entry.clone().add(offset);
  return {
    portal: { entry, exit, normal: dir, radius: PORTAL_RADIUS },
    wall: { z: (entry.z + exit.z) / 2, width: 16, height: 7.5 },
  };
}

function crystalWall(ctx: SceneryContext): { group: THREE.Group; setZ: (z: number) => void; update: (dt: number, t: number) => void } {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);}`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv;
      void main(){
        vec2 g = vUv * vec2(32.0, 15.0);
        vec2 h = abs(fract(g + vec2(0.5 * floor(mod(g.y, 2.0)), 0.0)) - 0.5);
        float line = smoothstep(0.44, 0.5, max(h.x, h.y));
        float sweep = smoothstep(0.08, 0.0, abs(fract(vUv.x * 0.5 - uTime * 0.08) - vUv.y * 0.3 - 0.35));
        vec3 col = mix(vec3(0.35, 0.8, 1.0), vec3(1.0, 0.4, 0.95), vUv.y);
        float a = 0.06 + line * 0.25 + sweep * 0.25 + smoothstep(0.85, 1.0, vUv.y) * 0.3;
        gl_FragColor = vec4(col * (0.6 + line + sweep * 2.0), a);
      }`,
  });
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(16, 7.5), mat);
  pane.position.y = 3.75;
  group.add(pane);
  const edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9af0ff').multiplyScalar(2) });
  const top = new THREE.Mesh(new THREE.BoxGeometry(16, 0.06, 0.06), edgeMat);
  top.position.y = 7.5;
  group.add(top);
  for (const x of [-8, 8]) {
    const spire = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), new THREE.MeshStandardMaterial({ color: '#9af0ff', emissive: '#4ad8ff', emissiveIntensity: 1.5, flatShading: true }));
    spire.scale.set(0.6, 6.5, 0.6);
    spire.position.set(x, 3.75, 0);
    group.add(spire);
  }
  ctx.root.add(group);
  let targetZ = 3;
  return {
    group,
    setZ: (z) => (targetZ = z),
    update(dt, t) {
      mat.uniforms.uTime.value = t;
      group.position.z += (targetZ - group.position.z) * Math.min(1, dt * 6);
    },
  };
}

function garden(ctx: SceneryContext): (t: number, glow: number) => void {
  const stemMat = new THREE.MeshStandardMaterial({ color: '#2a1a4a', roughness: 0.8 });
  const capColors = ['#ff5ad8', '#5ae8ff', '#b07aff', '#ffd35a'];
  const caps: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 40; i++) {
    const side = i % 2 ? -1 : 1;
    const x = side * (8.6 + ctx.rng() * 5);
    const z = -3 + ctx.rng() * 15;
    const h = 0.5 + ctx.rng() * 2.6;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * h, 0.09 * h, h, 6), stemMat);
    stem.position.set(x, h / 2 - 0.6, z);
    const capMat = new THREE.MeshStandardMaterial({ color: capColors[i % 4], emissive: capColors[i % 4], emissiveIntensity: 1.2, roughness: 0.4 });
    caps.push(capMat);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.35 * h, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
    cap.position.set(x, h - 0.6, z);
    ctx.root.add(stem, cap);
  }
  const ledge = new THREE.Mesh(new THREE.CylinderGeometry(15, 15.5, 1.2, 20), new THREE.MeshStandardMaterial({ color: '#2a1a4a', roughness: 0.9, flatShading: true }));
  ledge.scale.z = 0.8;
  ledge.position.set(0, -1.2, 4.4);
  ctx.root.add(ledge);
  return (t, glow) => {
    caps.forEach((m, i) => (m.emissiveIntensity = 1 + Math.sin(t * 1.5 + i) * 0.4 + glow));
  };
}

export const portal: StageDef = {
  id: 'portal',
  index: 5,
  name: 'Portal Garden',
  subtitle: 'Bend space to reach the hoop',
  skill: 'A crystal wall blocks the hoop. Shoot through the portal!',
  emblem: '🌀',
  accent: '#ff5ad8',
  card: 'linear-gradient(160deg, #1a0b3a 0%, #6a2a8a 55%, #ff7ab8 100%)',
  gravity: 9.81,
  shots: 10,
  stars: [10, 22, 34],
  sky: {
    top: '#14082e',
    mid: '#5a2482',
    bottom: '#ff7ab8',
    sunDir: new THREE.Vector3(0.4, 0.05, -1),
    sunColor: '#ff9ad0',
    sunSize: 0.004,
    stars: 0.5,
    aurora: 1,
    cloudLight: '#c86ab0',
    cloudDark: '#2a1048',
  },
  fog: { color: '#4a2070', near: 60, far: 420 },
  light: { sun: '#ffb0e0', sunIntensity: 1.4, hemiSky: '#8a5aff', hemiGround: '#ff5ad8', hemiIntensity: 0.8, envIntensity: 0.7 },
  bloom: 1.3,
  court: { style: 'neon', base: '#140a26', alt: '#5a2aa0', paint: '#2a0f4a', line: '#ff5ad8', lineGlow: 1.0, emblem: 'PORTAL GARDEN', emblemColor: '#5ae8ff' },
  rockColor: '#2a1a4a',
  hoop: { rim: '#ff5ad8', frame: '#5ae8ff', pole: '#2a1a4a', glow: 2.0 },
  net: { color: '#5ae8ff', glow: 1.0 },
  music: { bpm: 96, root: 61, scale: 'minor', chords: [0, 5, 2, 6], bright: 0.6, lead: 'glass' },

  setupShot({ shotIndex: i }, rng) {
    const k = i / 9;
    const spot = spotOnArc(lerp(7.4, 9.0, k), (rng() - 0.5) * lerp(10, 40, k));
    const lateral = i < 2 ? 0 : (rng() - 0.5) * lerp(1.0, 3.4, k);
    const lift = i < 2 ? 0 : rng() * lerp(0.2, 1.0, k);
    const jump = lerp(3.2, 4.0, rng());
    return {
      spot,
      wind: new THREE.Vector3(),
      rimScale: 1,
      assist: lerp(0.5, 0.35, k),
      guide: lerp(0.6, 0.35, k),
      ...portalShot(spot, 9.81, lateral, lift, jump),
      hint: i === 0 ? 'A crystal wall! Shoot into the glowing portal.' : i === 2 ? 'The portals moved. Aim for the entrance!' : undefined,
    };
  },

  build(ctx) {
    buildCourt(ctx, { court: portal.court, rockColor: portal.rockColor, trim: '#ff5ad8', surface: { roughness: 0.25, metalness: 0.3 } });
    const plants = garden(ctx);
    const wall = crystalWall(ctx);
    const entry = new Gate('#5ae8ff', '#b07aff');
    const exit = new Gate('#ff5ad8', '#ffd35a');
    ctx.root.add(entry.group, exit.group);
    const flies = motes(ctx, { count: 160, color: '#5ae8ff', size: 0.06, center: new THREE.Vector3(0, 3, 4), spread: new THREE.Vector3(26, 7, 22), drift: new THREE.Vector3(0, 0.05, 0), twinkle: 1 });
    const islets = floatingIslets(ctx, 10, '#2a1a4a', '#5a2aa0', [28, 70]);
    const clouds = cloudPuffs(ctx, 16, '#c86ab0', 160, [-30, 5], [30, 60], 0.55);
    let lastExit = new THREE.Vector3();
    return {
      onShot(setup) {
        if (!setup.portal || !setup.wall) return;
        const yaw = Math.atan2(setup.portal.normal.x, setup.portal.normal.z);
        entry.group.position.copy(setup.portal.entry);
        entry.group.rotation.set(0, yaw, 0);
        exit.group.position.copy(setup.portal.exit);
        exit.group.rotation.set(0, yaw, 0);
        lastExit = setup.portal.exit.clone();
        wall.setZ(setup.wall.z);
        entry.kick();
        exit.kick();
      },
      onBasket() {
        exit.kick();
      },
      update({ dt, t, glow, ball }) {
        entry.update(dt, t);
        exit.update(dt, t);
        wall.update(dt, t);
        plants(t, glow);
        flies(dt, t);
        islets(t);
        clouds(dt);
        if (ball.distanceTo(lastExit) < 1.2) exit.kick();
      },
    };
  },
};
