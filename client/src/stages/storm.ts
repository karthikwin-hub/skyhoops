import * as THREE from 'three';
import { buildCourt, cloudPuffs, HOOP_BASE, lerp, spotOnArc } from './common';
import { tiledBox, windowTexture } from './rooftop';
import type { SceneryContext, StageDef } from './stageTypes';

function rain(ctx: SceneryContext, count: number): (dt: number, wind: THREE.Vector3, cam: THREE.Vector3) => void {
  const pos = new Float32Array(count * 6);
  const drops: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) drops.push(new THREE.Vector3((ctx.rng() - 0.5) * 30, ctx.rng() * 20, (ctx.rng() - 0.5) * 30));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#9fb4d8', transparent: true, opacity: 0.35, depthWrite: false }));
  lines.frustumCulled = false;
  ctx.root.add(lines);
  return (dt, wind, cam) => {
    const vx = wind.x * 1.5, vz = wind.z * 1.5, vy = -22;
    for (let i = 0; i < count; i++) {
      const d = drops[i];
      d.x += vx * dt;
      d.y += vy * dt;
      d.z += vz * dt;
      if (d.y < -1) {
        d.y += 21;
        d.x = cam.x + (ctx.rng() - 0.5) * 30;
        d.z = cam.z - 8 + (ctx.rng() - 0.5) * 30;
      }
      pos.set([d.x, d.y, d.z, d.x - vx * 0.03, d.y - vy * 0.03, d.z - vz * 0.03], i * 6);
    }
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  };
}

function bolt(from: THREE.Vector3, to: THREE.Vector3, rng: () => number): THREE.Vector3[] {
  let pts = [from.clone(), to.clone()];
  let spread = from.distanceTo(to) * 0.18;
  for (let gen = 0; gen < 6; gen++) {
    const next: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const mid = a.clone().lerp(b, 0.5);
      mid.x += (rng() - 0.5) * spread;
      mid.z += (rng() - 0.5) * spread;
      mid.y += (rng() - 0.5) * spread * 0.3;
      next.push(a, mid);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
    spread *= 0.55;
  }
  return pts;
}

export const storm: StageDef = {
  id: 'storm',
  index: 6,
  name: 'Storm Tower',
  subtitle: 'The final challenge, inside the thunderstorm',
  skill: '60 seconds. Wind, a moving hoop, and it shrinks with every basket.',
  emblem: '⚡',
  accent: '#ffd23a',
  card: 'linear-gradient(160deg, #0a0d18 0%, #2b3450 55%, #ffd23a 140%)',
  gravity: 9.81,
  shots: 99,
  timeLimit: 60,
  stars: [14, 28, 44],
  sky: {
    top: '#080a14',
    mid: '#262e48',
    bottom: '#3a4262',
    sunDir: new THREE.Vector3(0.2, 0.6, -1),
    sunColor: '#8a9ac8',
    sunSize: 0.0001,
    stars: 0,
    cloudLight: '#4a5474',
    cloudDark: '#10131e',
    cloudHeight: -24,
  },
  fog: { color: '#20263c', near: 35, far: 260 },
  light: { sun: '#a8b8e8', sunIntensity: 1.2, hemiSky: '#5a6a9a', hemiGround: '#20242e', hemiIntensity: 0.7, envIntensity: 0.6 },
  bloom: 1.15,
  court: { style: 'metal', base: '#30343e', alt: '#5a606e', paint: '#5a1020', line: '#ffd23a', lineGlow: 0.9, emblem: 'STORM TOWER', emblemColor: '#ffd23a' },
  rockColor: '#1e2230',
  hoop: { rim: '#ffd23a', frame: '#ffd23a', pole: '#1e2230', glow: 1.6 },
  net: { color: '#ffe680', glow: 0.7 },
  music: { bpm: 112, root: 50, scale: 'minor', chords: [0, 5, 3, 4], bright: 0.45, lead: 'pluck' },

  setupShot({ shotIndex: i, made }, rng) {
    const k = Math.min(1, made / 10);
    const wind = new THREE.Vector3(rng() - 0.5, 0, (rng() - 0.5) * 0.5).normalize().multiplyScalar(lerp(0.8, 2.6, k) * (0.7 + rng() * 0.5));
    return {
      spot: spotOnArc(lerp(5.0, 7.2, rng()), (rng() - 0.5) * 80),
      wind,
      rimScale: Math.max(0.85, 1 - made * 0.015),
      assist: 0.22,
      guide: 0.15,
      hint: i === 0 ? 'Score as many as you can before time runs out!' : undefined,
    };
  },

  hoopOffset(t, { made }, out) {
    const amp = Math.min(1.6, 0.25 + made * 0.12);
    return out.set(Math.sin(t * 0.9) * amp, Math.sin(t * 1.7) * 0.15 * Math.min(1, made / 5), 0).add(HOOP_BASE);
  },

  build(ctx) {
    buildCourt(ctx, { court: storm.court, rockColor: storm.rockColor, trim: '#ffd23a', rock: false, surface: { roughness: 0.18, metalness: 0.55 } });
    const stone = new THREE.MeshStandardMaterial({
      color: '#1e2230',
      roughness: 0.6,
      metalness: 0.3,
      map: windowTexture(ctx.rng, '#ffd23a', '#141824'),
      emissiveMap: windowTexture(ctx.rng, '#ffb020', '#000000'),
      emissive: '#ffb020',
      emissiveIntensity: 0.8,
    });
    const tower = new THREE.Mesh(tiledBox(17, 80, 15), stone);
    tower.position.set(0, -40.7, 4.4);
    ctx.root.add(tower);

    const rodTips: THREE.Vector3[] = [];
    const rodMat = new THREE.MeshStandardMaterial({ color: '#c8ccd8', metalness: 0.9, roughness: 0.2 });
    for (const [x, z] of [[-8.2, -2.8], [8.2, -2.8], [-8.2, 11.6], [8.2, 11.6]]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.12, 7, 8), rodMat);
      rod.position.set(x, 3.5, z);
      rod.castShadow = true;
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe680').multiplyScalar(2) }));
      orb.position.set(x, 7.05, z);
      ctx.root.add(rod, orb);
      rodTips.push(new THREE.Vector3(x, 7.1, z));
    }

    const boltMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#d8e4ff').multiplyScalar(4), transparent: true, opacity: 1 });
    const boltLine = new THREE.Line(new THREE.BufferGeometry(), boltMat);
    boltLine.frustumCulled = false;
    boltLine.visible = false;
    ctx.root.add(boltLine);
    const flashLight = new THREE.PointLight('#cfe0ff', 0, 120, 1.2);
    ctx.root.add(flashLight);

    const drops = rain(ctx, ctx.high ? 1800 : 800);
    const clouds = cloudPuffs(ctx, ctx.high ? 34 : 18, '#3a4262', 120, [-15, 35], [30, 70], 0.9);
    let nextStrike = 2.5;
    let flash = 0;
    let boltLife = 0;

    return {
      update({ dt, t, wind, camera }) {
        drops(dt, wind, camera.position);
        clouds(dt * 3);
        nextStrike -= dt;
        if (nextStrike <= 0) {
          nextStrike = 3 + ctx.rng() * 6;
          const near = ctx.rng() < 0.45;
          const target = near ? rodTips[Math.floor(ctx.rng() * 4)] : new THREE.Vector3((ctx.rng() - 0.5) * 200, -20, -60 - ctx.rng() * 100);
          const from = target.clone().add(new THREE.Vector3((ctx.rng() - 0.5) * 40, near ? 60 : 90, (ctx.rng() - 0.5) * 30 - 10));
          boltLine.geometry.dispose();
          boltLine.geometry = new THREE.BufferGeometry().setFromPoints(bolt(from, target, ctx.rng));
          boltLine.visible = true;
          boltLife = 0.35;
          flash = near ? 1 : 0.6;
          flashLight.position.copy(target).add(new THREE.Vector3(0, 6, 0));
          ctx.thunder(near ? 0.05 : 0.6 + ctx.rng() * 0.8, near ? 1 : 0.6);
        }
        boltLife -= dt;
        boltLine.visible = boltLife > 0 && Math.sin(boltLife * 90) > -0.3;
        flash = Math.max(0, flash - dt * 3);
        const flicker = flash * (0.6 + 0.4 * Math.sin(t * 70));
        ctx.flashSky(flicker * 0.6);
        flashLight.intensity = flicker * 900;
        ctx.hemi.intensity = 0.7 + flicker * 2;
      },
    };
  },
};
