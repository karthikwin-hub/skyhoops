import * as THREE from 'three';
import { buildCourt, lerp, spotOnArc } from './common';
import { earthTexture, fbm3, glowTexture } from '../engine/textures';
import type { SceneryContext, StageDef } from './stageTypes';

function lunarTerrain(ctx: SceneryContext): void {
  const size = 700;
  const seg = ctx.high ? 160 : 90;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const craters: [number, number, number][] = [];
  for (let i = 0; i < 60; i++) craters.push([(ctx.rng() - 0.5) * size * 0.8, (ctx.rng() - 0.5) * size * 0.8, 4 + ctx.rng() * 26]);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let h = (fbm3(x * 0.012, 0, z * 0.012, 4) - 0.5) * 22;
    for (const [cx, cz, r] of craters) {
      const d = Math.hypot(x - cx, z - cz) / r;
      if (d < 1.4) h += d < 1 ? -(1 - d * d) * r * 0.25 : Math.sin((d - 1) / 0.4 * Math.PI) * r * 0.06;
    }
    const nearCourt = Math.hypot(x, z - 4) < 30;
    p.setY(i, nearCourt ? Math.min(h, -14) : h - 10);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#8a8c96', roughness: 1, flatShading: true }));
  m.position.y = -6;
  m.receiveShadow = true;
  ctx.root.add(m);
}

function lander(ctx: SceneryContext): THREE.Group {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: '#e8b84a', metalness: 0.9, roughness: 0.3 });
  const silver = new THREE.MeshStandardMaterial({ color: '#d0d4dc', metalness: 0.9, roughness: 0.25 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.0, 8), gold);
  body.position.y = 1.4;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.9, 8), silver);
  top.position.y = 2.35;
  g.add(body, top);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), silver);
    leg.position.set(Math.cos(a) * 1.1, 0.7, Math.sin(a) * 1.1);
    leg.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.06, 10), silver);
    foot.position.set(Math.cos(a) * 1.4, 0.03, Math.sin(a) * 1.4);
    g.add(leg, foot);
  }
  g.traverse((o) => (o.castShadow = true));
  g.position.set(-11.5, 0, 1);
  g.rotation.y = 0.5;
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.7, 16), new THREE.MeshStandardMaterial({ color: '#6c6e78', roughness: 1 }));
  pad.position.set(-11.5, -0.35, 1);
  ctx.root.add(g, pad);
  return g;
}

export const moon: StageDef = {
  id: 'moon',
  index: 4,
  name: 'Moon Court',
  subtitle: 'Earthrise over the lunar base',
  skill: 'Low gravity. Swipe softer than you think.',
  emblem: '🌙',
  accent: '#7fe8ff',
  card: 'linear-gradient(160deg, #000006 0%, #0a0b20 50%, #2f6bd6 100%)',
  gravity: 9.81 * 0.42,
  shots: 10,
  stars: [10, 20, 30],
  sky: {
    top: '#000004',
    mid: '#03040e',
    bottom: '#05060f',
    sunDir: new THREE.Vector3(1, 0.35, 0.3),
    sunColor: '#ffffff',
    sunSize: 0.0014,
    stars: 1.3,
    cloudLight: '#05060f',
    cloudDark: '#020208',
    cloudHeight: -400,
  },
  fog: { color: '#03040e', near: 200, far: 900 },
  light: { sun: '#ffffff', sunIntensity: 3.2, hemiSky: '#3a4a8a', hemiGround: '#1a1a22', hemiIntensity: 0.35, envIntensity: 0.4 },
  bloom: 1.1,
  court: { style: 'regolith', base: '#8d8f98', alt: '#ffffff', paint: '#2f3a6a', line: '#7fe8ff', lineGlow: 1.0, emblem: 'MOON BASE', emblemColor: '#7fe8ff' },
  rockColor: '#6c6e78',
  hoop: { rim: '#7fe8ff', frame: '#7fe8ff', pole: '#d0d4dc', glow: 1.8 },
  net: { color: '#bff6ff', glow: 0.8 },
  music: { bpm: 72, root: 57, scale: 'lydian', chords: [0, 1, 5, 4], bright: 0.3, lead: 'glass' },

  setupShot({ shotIndex: i }, rng) {
    const k = i / 9;
    return {
      spot: spotOnArc(lerp(5.0, 8.4, k), (rng() - 0.5) * 60),
      wind: new THREE.Vector3(),
      rimScale: 1,
      assist: lerp(0.4, 0.25, k),
      guide: lerp(0.3, 0.15, k),
      hint: i === 0 ? 'Low gravity! Swipe softer than you think.' : undefined,
    };
  },

  build(ctx) {
    buildCourt(ctx, { court: moon.court, rockColor: moon.rockColor, trim: '#7fe8ff', surface: { roughness: 0.95, emissiveIntensity: 1.6 } });
    lunarTerrain(ctx);
    lander(ctx);

    const earth = new THREE.Mesh(new THREE.SphereGeometry(38, 64, 32), new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.8, emissive: '#0a1a40', emissiveIntensity: 0.3 }));
    earth.position.set(-90, 20, -260);
    earth.rotation.z = 0.4;
    const atmo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#4a9aff', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    atmo.scale.setScalar(110);
    atmo.position.copy(earth.position);
    ctx.root.add(atmo, earth);

    const sats: THREE.Group[] = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Group();
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 1.2), new THREE.MeshStandardMaterial({ color: '#e8b84a', metalness: 0.8, roughness: 0.3 }));
      const panel = new THREE.Mesh(new THREE.BoxGeometry(5, 0.05, 1.4), new THREE.MeshStandardMaterial({ color: '#1a3a8a', metalness: 0.6, roughness: 0.2, emissive: '#1a3aff', emissiveIntensity: 0.2 }));
      const blink = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff4a4a', blending: THREE.AdditiveBlending, depthWrite: false }));
      blink.position.y = 0.6;
      s.add(core, panel, blink);
      ctx.root.add(s);
      sats.push(s);
    }

    const shooting = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffffff', blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    shooting.scale.set(8, 0.5, 1);
    shooting.visible = false;
    ctx.root.add(shooting);
    let shootT = 3;
    const shootFrom = new THREE.Vector3();
    const shootDir = new THREE.Vector3();

    return {
      update({ dt, t }) {
        earth.rotation.y += dt * 0.02;
        earth.position.y = 20 + Math.min(40, t * 0.25);
        atmo.position.copy(earth.position);
        sats.forEach((s, i) => {
          const a = t * (0.04 + i * 0.015) + i * 2;
          s.position.set(Math.sin(a) * (40 + i * 20), 25 + i * 8, Math.cos(a) * (40 + i * 20) - 30);
          s.rotation.y = a;
          (s.children[2] as THREE.Sprite).material.opacity = Math.sin(t * 4 + i) > 0.6 ? 1 : 0.1;
        });
        shootT -= dt;
        if (shootT < 0) {
          shootT = 3 + Math.random() * 5;
          shootFrom.set((Math.random() - 0.5) * 300, 80 + Math.random() * 60, -250);
          shootDir.set(Math.random() < 0.5 ? -1 : 1, -0.4, 0).normalize();
          shooting.visible = true;
          shooting.position.copy(shootFrom);
        }
        if (shooting.visible) {
          shooting.position.addScaledVector(shootDir, dt * 160);
          shooting.material.rotation = Math.atan2(shootDir.y, shootDir.x);
          if (shooting.position.distanceTo(shootFrom) > 120) shooting.visible = false;
        }
      },
    };
  },
};
