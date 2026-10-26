import * as THREE from 'three';
import { buildCourt, cloudPuffs, floatingIslets, floatingRock, lerp, motes, spotOnArc, windFlag } from './common';
import type { SceneryContext, StageDef } from './stageTypes';

/** Fast white streaks that make the wind visible. */
function windStreaks(ctx: SceneryContext, count: number): (dt: number, wind: THREE.Vector3) => void {
  const pos = new Float32Array(count * 6);
  const seeds: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push(new THREE.Vector3((ctx.rng() - 0.5) * 30, ctx.rng() * 9 - 1, (ctx.rng() - 0.5) * 26 + 4));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  ctx.root.add(lines);
  return (dt, wind) => {
    const s = wind.length();
    mat.opacity = Math.min(0.55, s * 0.13);
    const dir = s > 0.01 ? wind.clone().divideScalar(s) : new THREE.Vector3(1, 0, 0);
    const speed = 6 + s * 5;
    for (let i = 0; i < count; i++) {
      const p = seeds[i];
      p.addScaledVector(dir, speed * dt * (0.7 + (i % 5) * 0.12));
      if (p.x > 15) p.x -= 30;
      if (p.x < -15) p.x += 30;
      if (p.z > 17) p.z -= 26;
      if (p.z < -9) p.z += 26;
      const len = 0.6 + s * 0.35;
      pos.set([p.x, p.y, p.z, p.x - dir.x * len, p.y - dir.y * len, p.z - dir.z * len], i * 6);
    }
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  };
}

function turbines(ctx: SceneryContext): (dt: number, wind: THREE.Vector3) => void {
  const rotors: THREE.Group[] = [];
  const white = new THREE.MeshStandardMaterial({ color: '#f4f8ff', roughness: 0.4 });
  const spots = [new THREE.Vector3(-26, 2, -18), new THREE.Vector3(30, -4, -30), new THREE.Vector3(-40, -8, 14), new THREE.Vector3(22, 0, 26)];
  for (const s of spots) {
    const g = new THREE.Group();
    g.position.copy(s);
    const rock = floatingRock(3.5, 9, '#7d7265', s.x, 9);
    g.add(rock);
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.3, 9), new THREE.MeshStandardMaterial({ color: '#5fae4a', flatShading: true }));
    grass.position.y = 0.1;
    g.add(grass);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 12, 10), white);
    mast.position.y = 6;
    mast.castShadow = true;
    g.add(mast);
    const rotor = new THREE.Group();
    rotor.position.set(0, 12, 0.4);
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.5, 0.08), white);
      blade.position.y = 2.75;
      const holder = new THREE.Group();
      holder.rotation.z = (b / 3) * Math.PI * 2;
      holder.add(blade);
      rotor.add(holder);
    }
    rotor.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), white));
    g.add(rotor);
    g.lookAt(0, s.y, 4);
    ctx.root.add(g);
    rotors.push(rotor);
  }
  return (dt, wind) => {
    for (const r of rotors) r.rotation.z += (0.4 + wind.length() * 0.9) * dt;
  };
}

export const cliffs: StageDef = {
  id: 'cliffs',
  index: 2,
  name: 'Windy Cliffs',
  subtitle: 'The wind wants your ball',
  skill: 'Read the wind and aim into it.',
  emblem: '🌬',
  accent: '#6fd3ff',
  card: 'linear-gradient(160deg, #2f86d6 0%, #a8dcf0 60%, #5fae4a 100%)',
  gravity: 9.81,
  shots: 10,
  stars: [10, 20, 30],
  sky: {
    top: '#2f7fd0',
    mid: '#a6daf2',
    bottom: '#e4f6ff',
    sunDir: new THREE.Vector3(0.6, 0.75, 0.35),
    sunColor: '#fff3d0',
    sunSize: 0.0025,
    stars: 0,
    cloudLight: '#ffffff',
    cloudDark: '#9cbcd6',
  },
  fog: { color: '#bfe2f4', near: 80, far: 520 },
  light: { sun: '#fff2dc', sunIntensity: 3.0, hemiSky: '#bfe4ff', hemiGround: '#7aa060', hemiIntensity: 1.1, envIntensity: 1.0 },
  bloom: 0.6,
  court: { style: 'acrylic', base: '#2b8566', alt: '#ffffff', paint: '#1f5c98', line: '#ffffff', lineGlow: 0.05, emblem: 'WINDY CLIFFS', emblemColor: '#e8fff4' },
  rockColor: '#7d7265',
  hoop: { rim: '#ff4a1a', frame: '#1f5c98', pole: '#e8eef6', glow: 0.5 },
  net: { color: '#ffffff', glow: 0.1 },
  music: { bpm: 100, root: 60, scale: 'lydian', chords: [0, 1, 0, 4], bright: 0.75, lead: 'glass' },

  setupShot({ shotIndex: i }, rng) {
    const k = i / 9;
    const side = rng() < 0.5 ? -1 : 1;
    const strength = lerp(1.0, 3.6, k) * (0.85 + rng() * 0.3);
    const wind = new THREE.Vector3(side, 0, (rng() - 0.5) * 0.8).normalize().multiplyScalar(strength);
    return {
      spot: spotOnArc(lerp(5.0, 7.2, k), (rng() - 0.5) * 50),
      wind,
      rimScale: 1,
      assist: lerp(0.45, 0.3, k),
      guide: lerp(0.35, 0.2, k),
      hint: i === 0 ? 'Wind! Watch the flag and aim into it.' : undefined,
    };
  },

  build(ctx) {
    buildCourt(ctx, { court: cliffs.court, rockColor: cliffs.rockColor, trim: '#ffffff' });
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(12.2, 12.6, 0.5, 14), new THREE.MeshStandardMaterial({ color: '#5fae4a', roughness: 0.95, flatShading: true }));
    grass.scale.z = 0.9;
    grass.position.set(0, -0.45, 4.4);
    grass.receiveShadow = true;
    ctx.root.add(grass);

    const flag = windFlag(ctx, new THREE.Vector3(-7.2, 0, -2), '#ff4a6a');
    const flag2 = windFlag(ctx, new THREE.Vector3(7.2, 0, -2), '#ffd23a');
    const streaks = windStreaks(ctx, ctx.high ? 140 : 70);
    const mills = turbines(ctx);
    const islets = floatingIslets(ctx, 12, '#7d7265', '#5fae4a', [26, 80]);
    const leaves = motes(ctx, { count: 90, color: '#b9ff8a', size: 0.05, center: new THREE.Vector3(0, 3, 4), spread: new THREE.Vector3(26, 7, 24), drift: new THREE.Vector3(0, 0, 0), twinkle: 0.3 });
    const clouds = cloudPuffs(ctx, ctx.high ? 30 : 16, '#ffffff', 170, [-25, 25], [30, 70], 0.9);
    return {
      update({ dt, t, wind }) {
        flag(wind, t);
        flag2(wind, t);
        streaks(dt, wind);
        mills(dt, wind);
        islets(t);
        leaves(dt, t, wind.clone().multiplyScalar(2.2));
        clouds(dt + wind.x * dt * 2);
      },
    };
  },
};
