import * as THREE from 'three';
import { buildCourt, cloudPuffs, motes, spotOnArc } from './common';
import type { SceneryContext, StageDef } from './stageTypes';
import { buildCity, SUNSET_CITY, warningLights, type BuildingSpec, type FacadeStyle } from './city';
import { flock } from './birds';

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

/** The city around the rooftop: low blocks fading into the cloud sea, and a few landmark towers. */
function skyline(ctx: SceneryContext, count: number, sunDir: THREE.Vector3): BuildingSpec[] {
  const sunAz = Math.atan2(sunDir.x, sunDir.z);
  const specs: BuildingSpec[] = [];
  const place = (r: [number, number], top: number, w: number, style: FacadeStyle, avoidSun: number) => {
    for (let tries = 0; tries < 20; tries++) {
      const a = ctx.rng() * Math.PI * 2;
      let da = Math.abs(a - sunAz) % (Math.PI * 2);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < avoidSun) continue;
      const rr = r[0] + ctx.rng() * (r[1] - r[0]);
      specs.push({ x: Math.sin(a) * rr, z: Math.cos(a) * rr - 10, top, base: top - 70, w, d: w * (0.7 + ctx.rng() * 0.6), rotY: ctx.rng() * Math.PI, style });
      return;
    }
  };
  for (let i = 0; i < count; i++) {
    const top = -26 + Math.pow(ctx.rng(), 1.5) * 34;
    const style: FacadeStyle = top > -4 ? (ctx.rng() < 0.5 ? 'glass' : 'office') : (['glass', 'office', 'brick'] as const)[Math.floor(ctx.rng() * 3)];
    place([75, 280], top, 10 + ctx.rng() * 16, style, 0.12);
  }
  // Compose the view behind the hoop (azimuth 180°): landmark towers to the right of the hoop and
  // beyond the sun on the left, with mid-rise blocks filling in, all clear of the sun itself.
  const at = (deg: number, r: number, top: number, w: number, style: FacadeStyle) => {
    const a = (deg * Math.PI) / 180;
    specs.push({ x: Math.sin(a) * r, z: Math.cos(a) * r - 10, top, base: top - 80, w, d: w * (0.75 + ctx.rng() * 0.4), rotY: ctx.rng() * Math.PI, style });
  };
  const landmarks: [number, number, number, number, FacadeStyle][] = [
    [158, 230, 44, 22, 'glass'],
    [170, 175, 26, 18, 'office'],
    [146, 260, 34, 20, 'glass'],
    [-112, 220, 38, 20, 'office'],
    [-98, 260, 24, 18, 'glass'],
  ];
  for (const [deg, r, top, w, style] of landmarks.slice(0, ctx.high ? 5 : 3)) at(deg, r, top, w, style);
  const fill = ctx.high ? 10 : 6;
  for (let i = 0; i < fill; i++) {
    const deg = 180 + (ctx.rng() - 0.3) * 80;
    const away = Math.abs(((deg * Math.PI) / 180 - sunAz + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    if (away < 0.12) continue;
    at(deg, 95 + ctx.rng() * 70, -14 + ctx.rng() * 16, 11 + ctx.rng() * 10, (['glass', 'office', 'brick'] as const)[Math.floor(ctx.rng() * 3)]);
  }
  return specs;
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
    sunSize: 0.0012,
    stars: 0,
    cloudLight: '#ffc3a0',
    cloudDark: '#a35c86',
  },
  fog: { color: '#f19a7c', near: 90, far: 620 },
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
    buildCourt(ctx, { court: rooftop.court, rockColor: '#4a4058', trim: '#ffcf8a', rock: false });

    const specs = skyline(ctx, ctx.high ? 46 : 28, rooftop.sky.sunDir);
    specs.push({ x: 0, z: 4.4, top: -0.7, base: -70, w: 17, d: 15, rotY: 0, style: 'office', plain: true });
    const peaks = buildCity(ctx, specs, SUNSET_CITY);
    const beacons = warningLights(ctx, peaks, 14);

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
    const clouds = cloudPuffs(ctx, ctx.high ? 16 : 9, '#ffc8b0', 190, [-32, -12], [30, 60], 0.45);
    const far = flock(ctx, { count: 7, center: new THREE.Vector3(-15, 24, -45), radius: [55, 30], speed: 0.16, spacing: 2.2, scale: 1.3 });
    const near = flock(ctx, { count: 4, center: new THREE.Vector3(4, 13, -6), radius: [34, 20], speed: 0.21, spacing: 1.6, scale: 1.1 });

    return {
      update({ dt, t }) {
        dust(dt, t);
        clouds(dt);
        far(t, dt);
        near(t + 40, dt);
        beacons(t);
      },
    };
  },
};
