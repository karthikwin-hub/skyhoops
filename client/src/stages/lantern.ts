import * as THREE from 'three';
import { buildCourt, cloudPuffs, floatingIslets, lerp, motes, spotOnArc } from './common';
import type { SceneryContext, StageDef } from './stageTypes';

function skyLanterns(ctx: SceneryContext, count: number): (dt: number, t: number, glow: number) => void {
  const geo = new THREE.CylinderGeometry(0.34, 0.24, 0.62, 10, 1, true);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: true, toneMapped: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const data: { p: THREE.Vector3; speed: number; phase: number; scale: number; hue: number }[] = [];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const near = i < count * 0.25;
    const a = ctx.rng() * Math.PI * 2;
    const r = near ? 10 + ctx.rng() * 18 : 25 + ctx.rng() * 120;
    const p = new THREE.Vector3(Math.sin(a) * r, lerp(-30, 60, ctx.rng()), Math.cos(a) * r - 5);
    // Keep the air above the court clear so lanterns never block a shot.
    if (Math.abs(p.x) < 11 && p.z > -8 && p.z < 16) p.x = Math.sign(p.x || 1) * (11 + ctx.rng() * 6);
    data.push({
      p,
      speed: 0.25 + ctx.rng() * 0.5,
      phase: ctx.rng() * 10,
      scale: near ? 0.8 + ctx.rng() * 0.5 : 1.2 + ctx.rng() * 1.5,
      hue: ctx.rng(),
    });
  }
  mesh.frustumCulled = false;
  ctx.root.add(mesh);
  return (dt, t, glow) => {
    for (let i = 0; i < count; i++) {
      const d = data[i];
      d.p.y += d.speed * dt;
      if (d.p.y > 70) d.p.y = -35;
      dummy.position.set(d.p.x + Math.sin(t * 0.3 + d.phase) * 0.8, d.p.y, d.p.z + Math.cos(t * 0.25 + d.phase) * 0.8);
      dummy.rotation.set(Math.sin(t + d.phase) * 0.08, t * 0.1 + d.phase, 0);
      dummy.scale.setScalar(d.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const flicker = 0.85 + Math.sin(t * 7 + d.phase * 13) * 0.08 + Math.sin(t * 13 + d.phase) * 0.05;
      color.setHSL(0.06 + d.hue * 0.05, 1, 0.55).multiplyScalar((1.6 + glow * 1.2) * flicker);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
}

function stringLights(ctx: SceneryContext): (t: number, glow: number) => void {
  const posts: THREE.Vector3[] = [
    new THREE.Vector3(-7.9, 4.2, -2.4),
    new THREE.Vector3(7.9, 4.2, -2.4),
    new THREE.Vector3(7.9, 4.2, 4.5),
    new THREE.Vector3(-7.9, 4.2, 4.5),
    new THREE.Vector3(-7.9, 4.2, 11.2),
    new THREE.Vector3(7.9, 4.2, 11.2),
  ];
  const wood = new THREE.MeshStandardMaterial({ color: '#4a2a1a', roughness: 0.8 });
  for (const p of posts) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, p.y, 8), wood);
    post.position.set(p.x, p.y / 2, p.z);
    post.castShadow = true;
    ctx.root.add(post);
  }
  const spans: [number, number][] = [[0, 2], [1, 3], [3, 4], [2, 5], [0, 3], [1, 2], [3, 5], [2, 4]];
  const bulbs: THREE.Vector3[] = [];
  const lanterns: THREE.Vector3[] = [];
  const lineMat = new THREE.LineBasicMaterial({ color: '#2a1a12' });
  for (const [a, b] of spans) {
    const pa = posts[a], pb = posts[b];
    const pts: THREE.Vector3[] = [];
    const n = 28;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = pa.clone().lerp(pb, t);
      p.y -= Math.sin(t * Math.PI) * 1.1;
      pts.push(p);
      if (i > 0 && i < n) (i % 7 === 0 ? lanterns : bulbs).push(p.clone());
    }
    ctx.root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  }
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial(), bulbs.length);
  const palette = ['#ffcf6a', '#ff7a5a', '#ffe9b0', '#ff9acb', '#9ad8ff'].map((c) => new THREE.Color(c).multiplyScalar(2.2));
  const dummy = new THREE.Object3D();
  bulbs.forEach((p, i) => {
    dummy.position.copy(p);
    dummy.updateMatrix();
    bulbMesh.setMatrixAt(i, dummy.matrix);
    bulbMesh.setColorAt(i, palette[i % palette.length]);
  });
  ctx.root.add(bulbMesh);

  const paperMat = new THREE.MeshStandardMaterial({ color: '#d0281e', emissive: '#ff3a1a', emissiveIntensity: 1.4, roughness: 0.7 });
  const capMat = new THREE.MeshStandardMaterial({ color: '#2a1408', roughness: 0.5 });
  for (const p of lanterns) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10), paperMat);
    l.scale.y = 0.8;
    l.position.copy(p).add(new THREE.Vector3(0, -0.35, 0));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 10), capMat);
    cap.position.copy(l.position).add(new THREE.Vector3(0, 0.23, 0));
    ctx.root.add(l, cap);
  }
  const warm = new THREE.PointLight('#ff8a3a', 18, 18, 1.6);
  warm.position.set(0, 3.8, 4.5);
  ctx.root.add(warm);
  return (t, glow) => {
    paperMat.emissiveIntensity = 1.2 + Math.sin(t * 3) * 0.1 + glow * 0.8;
    warm.intensity = 16 + Math.sin(t * 5) * 1.5 + glow * 10;
  };
}

export const lantern: StageDef = {
  id: 'lantern',
  index: 1,
  name: 'Lantern Festival',
  subtitle: 'A thousand wishes float past the hoop',
  skill: 'New spot every shot. The guide arc gets shorter.',
  emblem: '🏮',
  accent: '#ff9a3c',
  card: 'linear-gradient(160deg, #070b24 0%, #26205e 55%, #ff7a3a 100%)',
  gravity: 9.81,
  shots: 10,
  stars: [10, 20, 32],
  sky: {
    top: '#050820',
    mid: '#1d2260',
    bottom: '#3a2050',
    sunDir: new THREE.Vector3(0.6, 0.38, -1),
    sunColor: '#d8e0ff',
    sunSize: 0.0016,
    stars: 0.9,
    cloudLight: '#3e3a7a',
    cloudDark: '#0e0c28',
  },
  fog: { color: '#1f1c4c', near: 60, far: 420 },
  light: { sun: '#9fb0ff', sunIntensity: 0.9, hemiSky: '#4a58b0', hemiGround: '#ff8a3a', hemiIntensity: 0.65, envIntensity: 0.5 },
  bloom: 1.25,
  court: { style: 'wood', base: '#8a5530', alt: '#b5733e', paint: '#a8281e', line: '#ffe2b0', lineGlow: 0.35, emblem: 'LANTERNS', emblemColor: '#ffd08a' },
  rockColor: '#3a2e4a',
  hoop: { rim: '#ff6a2a', frame: '#ffcf6a', pole: '#2a1a12', glow: 1.4 },
  net: { color: '#ffe2b0', glow: 0.4 },
  music: { bpm: 84, root: 64, scale: 'major', chords: [0, 3, 5, 4], bright: 0.35, lead: 'pluck', swing: 0.2 },

  setupShot({ shotIndex: i }, rng) {
    const k = i / 9;
    return {
      spot: spotOnArc(lerp(4.8, 7.4, k) + rng() * 0.4, (rng() - 0.5) * lerp(40, 100, k)),
      wind: new THREE.Vector3(),
      rimScale: 1,
      assist: lerp(0.55, 0.4, k),
      guide: lerp(0.45, 0.22, k),
      hint: i === 0 ? 'Every shot moves you somewhere new. Watch the arc!' : undefined,
    };
  },

  build(ctx) {
    buildCourt(ctx, { court: lantern.court, rockColor: lantern.rockColor, trim: '#ffb35c', surface: { roughness: 0.32 } });
    const lanterns = skyLanterns(ctx, ctx.high ? 260 : 130);
    const strings = stringLights(ctx);
    const islets = floatingIslets(ctx, 9, '#3a2e4a', '#2c4a3a', [28, 70]);
    const flies = motes(ctx, { count: 120, color: '#ffd36a', size: 0.07, center: new THREE.Vector3(0, 2.5, 4), spread: new THREE.Vector3(22, 5, 20), drift: new THREE.Vector3(0, 0.05, 0), twinkle: 0.9 });
    const clouds = cloudPuffs(ctx, 14, '#4a4a8a', 160, [-30, 0], [30, 60], 0.5);
    return {
      update({ dt, t, glow }) {
        lanterns(dt, t, glow);
        strings(t, glow);
        islets(t);
        flies(dt, t);
        clouds(dt);
      },
    };
  },
};
