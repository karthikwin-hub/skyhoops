import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { glowTexture } from '../engine/textures';
import type { SceneryContext } from './stageTypes';

export type FacadeStyle = 'glass' | 'office' | 'brick';

export interface CityPalette {
  /** Lit window colours, picked at random. */
  lit: string[];
  /** Share of windows with the lights on. */
  litChance: number;
  emissiveIntensity: number;
  glass: Record<FacadeStyle, string>;
  wall: Record<FacadeStyle, string>;
  roof: string;
}

export const SUNSET_CITY: CityPalette = {
  lit: ['#ffd9a0', '#ffe2b8', '#ffc98a', '#fff0d6'],
  litChance: 0.1,
  emissiveIntensity: 0.85,
  glass: { glass: '#3d5a80', office: '#2c3a52', brick: '#28304a' },
  wall: { glass: '#8a93a6', office: '#c9bfb2', brick: '#8a4a3a' },
  roof: '#4a4450',
};

/** Floors and columns painted into one texture tile. */
const FLOORS = 12;
const FLOOR_H = 3.2;
export const FACADE_TILE = FLOORS * FLOOR_H;
const COLS: Record<FacadeStyle, number> = { glass: 22, office: 16, brick: 12 };
const SIZE = 512;

interface FacadeTextures {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
  /** Roughness in green, metalness in blue, as three.js expects. */
  orm: THREE.CanvasTexture;
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return [c, c.getContext('2d')!];
}

function speckle(g: CanvasRenderingContext2D, rng: () => number, count: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    const v = rng() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * rng()})`;
    g.fillRect(rng() * SIZE, rng() * SIZE, 1 + rng() * 2, 1 + rng() * 2);
  }
}

/** Paints one facade tile: albedo, lit windows, and which parts are shiny glass. */
function paintFacade(style: FacadeStyle, p: CityPalette, rng: () => number): FacadeTextures {
  const [cm, m] = canvas();
  const [ce, e] = canvas();
  const [co, o] = canvas();
  const wall = p.wall[style];
  const glass = new THREE.Color(p.glass[style]);
  const rowH = SIZE / FLOORS;
  const colW = SIZE / COLS[style];

  m.fillStyle = wall;
  m.fillRect(0, 0, SIZE, SIZE);
  if (style === 'brick') {
    // Brick courses, barely visible from a distance but enough to break up the flat colour.
    m.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < SIZE; y += 4) m.fillRect(0, y, SIZE, 1);
  }
  speckle(m, rng, 2500, 0.08);
  // Soft vertical weathering streaks.
  for (let i = 0; i < 18; i++) {
    const x = rng() * SIZE;
    const grad = m.createLinearGradient(0, 0, 0, SIZE);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${0.05 + rng() * 0.08})`);
    m.fillStyle = grad;
    m.fillRect(x, 0, 2 + rng() * 6, SIZE);
  }
  e.fillStyle = '#000';
  e.fillRect(0, 0, SIZE, SIZE);
  // Walls: rough and not metallic.
  o.fillStyle = `rgb(0,${style === 'glass' ? 120 : 220},${style === 'glass' ? 180 : 0})`;
  o.fillRect(0, 0, SIZE, SIZE);

  for (let f = 0; f < FLOORS; f++) {
    const y0 = f * rowH;
    // A floor slab band between storeys.
    m.fillStyle = 'rgba(0,0,0,0.18)';
    m.fillRect(0, y0, SIZE, style === 'glass' ? 5 : 3);
    const roomLit = rng() < p.litChance;
    for (let c = 0; c < COLS[style]; c++) {
      const x0 = c * colW;
      let wx: number, wy: number, ww: number, wh: number;
      if (style === 'glass') {
        [wx, wy, ww, wh] = [x0 + 1.5, y0 + 7, colW - 3, rowH - 9];
      } else if (style === 'office') {
        [wx, wy, ww, wh] = [x0 + 2, y0 + rowH * 0.3, colW - 4, rowH * 0.55];
      } else {
        [wx, wy, ww, wh] = [x0 + colW * 0.24, y0 + rowH * 0.22, colW * 0.52, rowH * 0.58];
        // Recess shadow above and a pale sill below.
        m.fillStyle = 'rgba(0,0,0,0.35)';
        m.fillRect(wx - 2, wy - 3, ww + 4, 3);
        m.fillStyle = 'rgba(255,240,220,0.35)';
        m.fillRect(wx - 3, wy + wh, ww + 6, 3);
      }
      // Glass: darker at the bottom, with a little tint variation per pane.
      const tint = glass.clone().offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.08);
      const grad = m.createLinearGradient(0, wy, 0, wy + wh);
      grad.addColorStop(0, `#${tint.clone().offsetHSL(0, 0, 0.08).getHexString()}`);
      grad.addColorStop(1, `#${tint.clone().offsetHSL(0, 0, -0.06).getHexString()}`);
      m.fillStyle = grad;
      m.fillRect(wx, wy, ww, wh);
      o.fillStyle = `rgb(0,${18 + rng() * 20},${style === 'brick' ? 140 : 235})`;
      o.fillRect(wx, wy, ww, wh);

      const lit = roomLit ? rng() < 0.75 : rng() < p.litChance * 0.35;
      if (lit) {
        const col = new THREE.Color(p.lit[Math.floor(rng() * p.lit.length)]);
        const k = 0.55 + rng() * 0.45;
        // Ceiling lights make the top of a lit window brighter; blinds sometimes cover part of it.
        const blind = rng() < 0.3 ? wh * (0.2 + rng() * 0.5) : 0;
        const lg = e.createLinearGradient(0, wy, 0, wy + wh);
        lg.addColorStop(0, `rgba(${(col.r * 255 * k) | 0},${(col.g * 255 * k) | 0},${(col.b * 255 * k) | 0},1)`);
        lg.addColorStop(1, `rgba(${(col.r * 150 * k) | 0},${(col.g * 130 * k) | 0},${(col.b * 110 * k) | 0},1)`);
        e.fillStyle = lg;
        e.fillRect(wx, wy + blind, ww, wh - blind);
        if (blind) {
          e.fillStyle = `rgba(${(col.r * 90) | 0},${(col.g * 70) | 0},${(col.b * 50) | 0},1)`;
          e.fillRect(wx, wy, ww, blind);
        }
        // Lit rooms read through the glass in the albedo too.
        m.fillStyle = `rgba(${(col.r * 255) | 0},${(col.g * 230) | 0},${(col.b * 190) | 0},0.35)`;
        m.fillRect(wx, wy, ww, wh);
      }
      if (style !== 'glass') {
        // Mullion splitting each window.
        m.fillStyle = 'rgba(30,30,36,0.7)';
        m.fillRect(wx + ww / 2 - 0.75, wy, 1.5, wh);
        e.fillStyle = '#000';
        e.fillRect(wx + ww / 2 - 0.75, wy, 1.5, wh);
      }
    }
  }
  if (style === 'glass') {
    // Thin aluminium mullions over the curtain wall.
    m.fillStyle = 'rgba(200,205,215,0.55)';
    o.fillStyle = 'rgb(0,90,220)';
    for (let c = 0; c <= COLS.glass; c++) {
      m.fillRect(c * colW - 1, 0, 2, SIZE);
      o.fillRect(c * colW - 1, 0, 2, SIZE);
    }
  }

  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  return { map: tex(cm, true), emissive: tex(ce, true), orm: tex(co, false) };
}

export function facadeMaterial(style: FacadeStyle, p: CityPalette, rng: () => number): THREE.MeshStandardMaterial {
  const t = paintFacade(style, p, rng);
  return new THREE.MeshStandardMaterial({
    map: t.map,
    emissiveMap: t.emissive,
    emissive: '#ffffff',
    emissiveIntensity: p.emissiveIntensity,
    roughnessMap: t.orm,
    metalnessMap: t.orm,
    roughness: 1,
    metalness: 1,
  });
}

/** Box sides only (no top or bottom), with UVs in metres so windows keep their real size. */
function sides(w: number, h: number, d: number, u0: number, v0: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const faceSize: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, u0 + (uv.getX(i) * faceSize[f][0]) / FACADE_TILE, v0 + (uv.getY(i) * faceSize[f][1]) / FACADE_TILE);
    }
  }
  const index = geo.getIndex()!;
  const keep: number[] = [];
  for (const g of geo.groups) {
    if (g.materialIndex === 2 || g.materialIndex === 3) continue;
    for (let i = g.start; i < g.start + g.count; i++) keep.push(index.getX(i));
  }
  geo.setIndex(keep);
  geo.clearGroups();
  return geo;
}

function placed(geo: THREE.BufferGeometry, x: number, y: number, z: number, rotY = 0): THREE.BufferGeometry {
  return geo.applyMatrix4(new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z));
}

export interface BuildingSpec {
  x: number;
  z: number;
  /** Height of the roof above the court. */
  top: number;
  /** How far below the court the building starts. */
  base: number;
  w: number;
  d: number;
  rotY: number;
  style: FacadeStyle;
  /** Just the walls, e.g. for the tower the court stands on. */
  plain?: boolean;
}

interface Parts {
  facade: Record<FacadeStyle, THREE.BufferGeometry[]>;
  trim: Record<FacadeStyle, THREE.BufferGeometry[]>;
  roof: THREE.BufferGeometry[];
  metal: THREE.BufferGeometry[];
}

/** One building: stacked tiers with setbacks, a parapet, and rooftop clutter. */
function addBuilding(parts: Parts, b: BuildingSpec, rng: () => number): THREE.Vector3 {
  const rot = (geo: THREE.BufferGeometry, lx: number, y: number, lz: number) => {
    const c = Math.cos(b.rotY), s = Math.sin(b.rotY);
    return placed(geo, b.x + lx * c + lz * s, y, b.z - lx * s + lz * c, b.rotY);
  };
  const total = b.top - b.base;
  if (b.plain) {
    parts.facade[b.style].push(rot(sides(b.w, total, b.d, rng(), 0), 0, b.base + total / 2, 0));
    return new THREE.Vector3(b.x, b.top, b.z);
  }
  const tiers = b.style === 'brick' ? 1 : total > 70 ? 3 : total > 45 ? 2 : 1;
  let w = b.w, d = b.d, y = b.base;
  const u0 = rng(), v0 = Math.floor(rng() * FLOORS) / FLOORS;
  for (let t = 0; t < tiers; t++) {
    const h = t === tiers - 1 ? b.top - y : total * (t === 0 ? 0.62 : 0.22);
    // Snap tier heights to whole floors so window rows line up with the roof.
    const hh = Math.max(FLOOR_H, Math.round(h / FLOOR_H) * FLOOR_H);
    parts.facade[b.style].push(rot(sides(w, hh, d, u0, v0), 0, y + hh / 2, 0));
    y += hh;
    const roof = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
    parts.roof.push(rot(roof, 0, y + 0.02, 0));
    // Parapet around each roof edge.
    const ph = 1.1;
    for (const [px, pz, pw, pd] of [[0, d / 2, w + 0.4, 0.4], [0, -d / 2, w + 0.4, 0.4], [w / 2, 0, 0.4, d], [-w / 2, 0, 0.4, d]] as const) {
      parts.trim[b.style].push(rot(new THREE.BoxGeometry(pw, ph, pd), px, y + ph / 2, pz));
    }
    if (t < tiers - 1) {
      w *= 0.62 + rng() * 0.15;
      d *= 0.62 + rng() * 0.15;
    }
  }
  // Rooftop plant: AC units, a lift room, sometimes a water tank or an antenna.
  const units = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < units; i++) {
    const s = 1 + rng() * 2.4;
    parts.roof.push(rot(new THREE.BoxGeometry(s, 0.8 + rng() * 1.6, s * (0.6 + rng() * 0.8)), (rng() - 0.5) * w * 0.6, y + 0.8, (rng() - 0.5) * d * 0.6));
  }
  if (b.style === 'brick' && rng() < 0.7) {
    const tank = new THREE.CylinderGeometry(1.4, 1.4, 2.6, 12);
    parts.roof.push(rot(tank, w * 0.2, y + 3.6, -d * 0.15));
    const tankRoof = new THREE.ConeGeometry(1.55, 1, 12);
    parts.roof.push(rot(tankRoof, w * 0.2, y + 5.4, -d * 0.15));
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      parts.metal.push(rot(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 5), w * 0.2 + lx * 0.9, y + 1.2, -d * 0.15 + lz * 0.9));
    }
  }
  let peak = y;
  if (b.style !== 'brick' && rng() < 0.55) {
    const mast = 6 + rng() * 14;
    parts.metal.push(rot(new THREE.CylinderGeometry(0.12, 0.3, mast, 6), 0, y + mast / 2, 0));
    peak = y + mast;
  }
  return new THREE.Vector3(b.x, peak, b.z);
}

/**
 * A whole skyline in a handful of draw calls: one merged mesh per facade style, plus roofs and metal.
 * Returns the highest point of each building, for aircraft warning lights.
 */
export function buildCity(ctx: SceneryContext, specs: BuildingSpec[], palette: CityPalette): THREE.Vector3[] {
  const styles: FacadeStyle[] = ['glass', 'office', 'brick'];
  const parts: Parts = {
    facade: { glass: [], office: [], brick: [] },
    trim: { glass: [], office: [], brick: [] },
    roof: [],
    metal: [],
  };
  const peaks = specs.map((s) => addBuilding(parts, s, ctx.rng));
  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
    if (!geos.length) return;
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (merged) ctx.root.add(new THREE.Mesh(merged, mat));
  };
  for (const s of styles) {
    add(parts.facade[s], facadeMaterial(s, palette, ctx.rng));
    add(parts.trim[s], new THREE.MeshStandardMaterial({ color: palette.wall[s], roughness: 0.85, metalness: s === 'glass' ? 0.4 : 0 }));
  }
  add(parts.roof, new THREE.MeshStandardMaterial({ color: palette.roof, roughness: 0.9 }));
  add(parts.metal, new THREE.MeshStandardMaterial({ color: '#9aa0ac', roughness: 0.35, metalness: 0.85 }));
  return peaks;
}

/** Slow, soft red lights on the tallest roofs and masts. */
export function warningLights(ctx: SceneryContext, peaks: THREE.Vector3[], count: number): (t: number) => void {
  const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff3040', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const p of [...peaks].sort((a, b) => b.y - a.y).slice(0, count)) {
    const s = new THREE.Sprite(mat);
    s.position.copy(p).add(new THREE.Vector3(0, 0.8, 0));
    s.scale.setScalar(2.4);
    ctx.root.add(s);
  }
  return (t) => {
    mat.opacity = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(t * 1.4));
  };
}
