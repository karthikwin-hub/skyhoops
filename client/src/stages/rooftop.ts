import * as THREE from 'three';
import { buildCourt, cloudPuffs, motes, spotOnArc } from './common';
import { glowTexture } from '../engine/textures';
import type { SceneryContext, StageDef } from './stageTypes';

/** Lit-window facade texture; UVs are scaled per building so windows stay the same size. */
export function windowTexture(rng: () => number, warm = '#ffd9a0', dark = '#1a1d33'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = dark;
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const lit = rng() < 0.42;
      g.fillStyle = lit ? warm : '#0c0e1c';
      g.globalAlpha = lit ? 0.6 + rng() * 0.4 : 1;
      g.fillRect(x * 16 + 3, y * 16 + 4, 10, 9);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function tiledBox(w: number, h: number, d: number, tile = 22): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const faces: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * faces[f][0]) / tile, (uv.getY(i) * faces[f][1]) / tile);
    }
  }
  return geo;
}

function skyline(ctx: SceneryContext, count: number, mat: THREE.Material, radius: [number, number]): THREE.Vector3[] {
  const tops: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const a = ctx.rng() * Math.PI * 2;
    const r = radius[0] + ctx.rng() * (radius[1] - radius[0]);
    const w = 9 + ctx.rng() * 16;
    const top = -26 + Math.pow(ctx.rng(), 1.5) * 34;
    const h = top + 60;
    const m = new THREE.Mesh(tiledBox(w, h, w * (0.7 + ctx.rng() * 0.6)), mat);
    m.position.set(Math.sin(a) * r, top - h / 2, Math.cos(a) * r - 10);
    m.rotation.y = ctx.rng() * Math.PI;
    ctx.root.add(m);
    tops.push(new THREE.Vector3(m.position.x, top, m.position.z));
  }
  return tops;
}

function birds(ctx: SceneryContext): (t: number) => void {
  const flock: { g: THREE.Group; l: THREE.Mesh; r: THREE.Mesh; phase: number; rad: number; h: number }[] = [];
  const mat = new THREE.MeshBasicMaterial({ color: '#2a1d2e', side: THREE.DoubleSide, fog: true });
  const wing = new THREE.PlaneGeometry(0.5, 0.16);
  wing.translate(0.25, 0, 0);
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    const l = new THREE.Mesh(wing, mat);
    const r = new THREE.Mesh(wing, mat);
    r.rotation.y = Math.PI;
    g.add(l, r);
    ctx.root.add(g);
    flock.push({ g, l, r, phase: ctx.rng() * 0.6, rad: 30 + ctx.rng() * 6, h: 16 + ctx.rng() * 4 });
  }
  return (t) => {
    for (const b of flock) {
      const a = t * 0.08 + b.phase;
      b.g.position.set(Math.sin(a) * b.rad - 10, b.h + Math.sin(t + b.phase * 10) * 0.6, Math.cos(a) * b.rad - 25);
      b.g.rotation.y = a + Math.PI / 2;
      const flap = Math.sin(t * 9 + b.phase * 20) * 0.6;
      b.l.rotation.z = flap;
      b.r.rotation.z = -flap;
    }
  };
}

export const rooftop: StageDef = {
  id: 'rooftop',
  index: 0,
  name: 'Golden Rooftop',
  subtitle: 'A court above the clouds at sunset',
  skill: 'Learn the swipe. Free throws, then threes.',
  emblem: '☀',
  accent: '#ffb36b',
  card: 'linear-gradient(160deg, #2b3a7a 0%, #ff8a5b 60%, #ffd29a 100%)',
  gravity: 9.81,
  shots: 10,
  stars: [10, 20, 32],
  sky: {
    top: '#26347a',
    mid: '#ff8a5b',
    bottom: '#ffcf9a',
    sunDir: new THREE.Vector3(-0.55, 0.1, -1),
    sunColor: '#ffb070',
    sunSize: 0.003,
    stars: 0,
    cloudLight: '#ffc3a0',
    cloudDark: '#a35c86',
  },
  fog: { color: '#f19a7c', near: 70, far: 480 },
  light: { sun: '#ffc08a', sunIntensity: 2.8, hemiSky: '#a9b8ff', hemiGround: '#ff9a6a', hemiIntensity: 1.0, envIntensity: 0.8 },
  bloom: 0.9,
  court: { style: 'concrete', base: '#2b6886', alt: '#ffffff', paint: '#ff7a45', line: '#fff4e0', lineGlow: 0.12, emblem: 'SKYHOOPS', emblemColor: '#ffd7a0' },
  rockColor: '#5a4a64',
  hoop: { rim: '#ff5b1f', frame: '#ffffff', pole: '#2a2f45', glow: 1.0 },
  net: { color: '#ffffff', glow: 0.25 },
  music: { bpm: 92, root: 62, scale: 'major', chords: [0, 4, 5, 3], bright: 0.5, lead: 'bell', swing: 0.12 },

  setupShot({ shotIndex: i }) {
    if (i < 4) {
      return {
        spot: spotOnArc(4.6, [0, -14, 14, 0][i]),
        wind: new THREE.Vector3(),
        rimScale: 1,
        assist: 0.72,
        guide: 1,
        hint: i === 0 ? 'Swipe up to shoot! A longer swipe throws further.' : undefined,
      };
    }
    return {
      spot: spotOnArc(7.0, [0, -25, 25, -45, 45, 0][i - 4]),
      wind: new THREE.Vector3(),
      rimScale: 1,
      assist: 0.55,
      guide: 0.6,
      hint: i === 4 ? 'Three-point line! Swipe a little longer.' : undefined,
    };
  },

  build(ctx) {
    const facade = new THREE.MeshStandardMaterial({
      color: '#3a3550',
      roughness: 0.5,
      metalness: 0.3,
      map: windowTexture(ctx.rng),
      emissiveMap: windowTexture(ctx.rng),
      emissive: '#ffb070',
      emissiveIntensity: 1.3,
    });
    buildCourt(ctx, { court: rooftop.court, rockColor: '#4a4058', trim: '#ffcf8a', rock: false });

    const tower = new THREE.Mesh(tiledBox(17, 60, 15), facade);
    tower.position.set(0, -0.7 - 30, 4.4);
    ctx.root.add(tower);

    const tops = skyline(ctx, ctx.high ? 46 : 26, facade, [75, 280]);
    const blinkMat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff3040', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const top of tops.slice(0, 18)) {
      const s = new THREE.Sprite(blinkMat);
      s.position.copy(top).add(new THREE.Vector3(0, 1.5, 0));
      s.scale.setScalar(3);
      ctx.root.add(s);
    }

    const rail = new THREE.MeshStandardMaterial({ color: '#d9d4e8', metalness: 0.8, roughness: 0.25 });
    for (const x of [-8.1, 8.1]) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 14, 8), rail);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(x, 1.05, 4.4);
      ctx.root.add(bar);
      for (let z = -2.4; z <= 11.2; z += 1.7) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.05, 6), rail);
        post.position.set(x, 0.52, z);
        ctx.root.add(post);
      }
    }

    // Water tower on the roof corner.
    const wt = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#7a4b34', roughness: 0.8 });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.2, 16), wood);
    tank.position.y = 3.6;
    tank.castShadow = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.45, 1.0, 16), new THREE.MeshStandardMaterial({ color: '#3b2b35', roughness: 0.6 }));
    roof.position.y = 5.2;
    wt.add(tank, roof);
    for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 6), rail);
      leg.position.set(x, 1.25, z);
      wt.add(leg);
    }
    wt.position.set(-10.5, 0, -1);
    const wtBase = new THREE.Mesh(new THREE.BoxGeometry(4, 0.7, 4), new THREE.MeshStandardMaterial({ color: '#4a4058' }));
    wtBase.position.set(-10.5, -0.35, -1);
    ctx.root.add(wt, wtBase);

    const dust = motes(ctx, { count: 160, color: '#ffd2a0', size: 0.06, center: new THREE.Vector3(0, 3, 4), spread: new THREE.Vector3(20, 7, 18), drift: new THREE.Vector3(0.1, 0.03, 0), twinkle: 0.6 });
    const clouds = cloudPuffs(ctx, ctx.high ? 26 : 14, '#ffc8b0', 170, [-30, 10], [30, 70], 0.75);
    const flock = birds(ctx);

    return {
      update({ dt, t }) {
        dust(dt, t);
        clouds(dt);
        flock(t);
        const on = Math.sin(t * 2.5) > 0.3;
        blinkMat.opacity = on ? 1 : 0.1;
      },
    };
  },
};
