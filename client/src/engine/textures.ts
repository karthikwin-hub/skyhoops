import * as THREE from 'three';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
    l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf,
  );
}

export function fbm3(x: number, y: number, z: number, octaves = 4): number {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    v += a * noise3(x * f, y * f, z * f);
    f *= 2.02;
    a *= 0.5;
  }
  return v / (1 - Math.pow(0.5, octaves));
}

const ballCache = new Map<string, { map: THREE.Texture; bump: THREE.Texture }>();

/** Procedural basketball: pebbled leather in any colour with the classic eight-panel seams. */
export function ballTextures(color: string): { map: THREE.Texture; bump: THREE.Texture } {
  const cached = ballCache.get(color);
  if (cached) return cached;
  const W = 1024, H = 512;
  const [c, ctx] = canvas(W, H);
  const [bc, bctx] = canvas(W, H);
  const img = ctx.createImageData(W, H);
  const bump = bctx.createImageData(W, H);
  const base = new THREE.Color(color);
  const dark = base.clone().multiplyScalar(0.55);
  const seamR = Math.cos((50 * Math.PI) / 180);
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - j / H) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const lon = (i / W) * Math.PI * 2;
      const px = cl * Math.sin(lon), py = sl, pz = cl * Math.cos(lon);
      const seam = Math.min(Math.abs(py), Math.abs(px), Math.abs(Math.abs(pz) - seamR) * 1.1);
      const pebble = hash3(Math.floor(px * 170), Math.floor(py * 170), Math.floor(pz * 170));
      const blotch = noise3(px * 6, py * 6, pz * 6);
      const s = 0.82 + pebble * 0.18 - blotch * 0.12;
      let r = (base.r * s + dark.r * (1 - s) * 0.2) * 255;
      let g = (base.g * s + dark.g * (1 - s) * 0.2) * 255;
      let b = (base.b * s + dark.b * (1 - s) * 0.2) * 255;
      let bumpV = 150 + pebble * 105;
      if (seam < 0.016) {
        const k = seam < 0.011 ? 1 : (0.016 - seam) / 0.005;
        r = r * (1 - k) + 18 * k;
        g = g * (1 - k) + 12 * k;
        b = b * (1 - k) + 10 * k;
        bumpV = bumpV * (1 - k);
      }
      const o = (j * W + i) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
      bump.data[o] = bump.data[o + 1] = bump.data[o + 2] = bumpV;
      bump.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  bctx.putImageData(bump, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const bumpTex = new THREE.CanvasTexture(bc);
  const result = { map, bump: bumpTex };
  ballCache.set(color, result);
  return result;
}

let glowTex: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

let puffTex: THREE.Texture | null = null;
export function cloudPuffTexture(): THREE.Texture {
  if (puffTex) return puffTex;
  const [c, ctx] = canvas(256, 256);
  for (let i = 0; i < 26; i++) {
    const x = 128 + (Math.random() - 0.5) * 140;
    const y = 140 + (Math.random() - 0.5) * 70;
    const r = 30 + Math.random() * 50;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  puffTex = new THREE.CanvasTexture(c);
  puffTex.colorSpace = THREE.SRGBColorSpace;
  return puffTex;
}

export type CourtStyle = 'wood' | 'concrete' | 'regolith' | 'metal' | 'acrylic' | 'pastel' | 'neon';

export interface CourtParams {
  style: CourtStyle;
  base: string;
  alt: string;
  paint: string;
  line: string;
  lineGlow: number;
  emblem: string;
  emblemColor: string;
}

/** Court extents in metres. The rim centre sits above (0, 0). */
export const COURT = { minX: -8, maxX: 8, minZ: -2.6, maxZ: 11.4 };
const PX = 96;

/** Paints a full court (surface, key, three point arc, emblem) plus a matching glow map for the lines. */
export function courtTextures(p: CourtParams): { map: THREE.Texture; emissive: THREE.Texture } {
  const W = (COURT.maxX - COURT.minX) * PX;
  const H = (COURT.maxZ - COURT.minZ) * PX;
  const [c, ctx] = canvas(W, H);
  const [ec, ectx] = canvas(W, H);
  const X = (x: number) => (x - COURT.minX) * PX;
  const Z = (z: number) => (z - COURT.minZ) * PX;

  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, W, H);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);
  const rand = mulberry(7);

  switch (p.style) {
    case 'wood': {
      const plank = 0.16 * PX;
      for (let y = 0; y < H; y += plank) {
        let x = -rand() * 400;
        while (x < W) {
          const len = 300 + rand() * 500;
          ctx.fillStyle = rand() > 0.5 ? p.base : p.alt;
          ctx.globalAlpha = 0.35 + rand() * 0.5;
          ctx.fillRect(x, y, len, plank);
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = '#000';
          ctx.fillRect(x, y, 2, plank);
          for (let k = 0; k < 5; k++) {
            ctx.globalAlpha = 0.05 + rand() * 0.06;
            ctx.fillRect(x, y + rand() * plank, len, 1.5);
          }
          x += len;
        }
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, y, W, 1.5);
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'regolith': {
      for (let i = 0; i < 9000; i++) {
        ctx.fillStyle = rand() > 0.5 ? p.alt : '#000';
        ctx.globalAlpha = rand() * 0.18;
        ctx.fillRect(rand() * W, rand() * H, 2 + rand() * 4, 2 + rand() * 4);
      }
      for (let i = 0; i < 30; i++) {
        const x = rand() * W, y = rand() * H, r = 15 + rand() * 70;
        const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, r * 0.2, x, y, r);
        g.addColorStop(0, 'rgba(0,0,0,0.28)');
        g.addColorStop(0.8, 'rgba(0,0,0,0.1)');
        g.addColorStop(0.92, 'rgba(255,255,255,0.18)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'metal': {
      ctx.globalAlpha = 0.25;
      for (let y = 0; y < H; y += 48) {
        for (let x = (y / 48) % 2 ? 24 : 0; x < W; x += 48) {
          ctx.fillStyle = p.alt;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-12, -3, 24, 6);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 14; i++) {
        const x = rand() * W, y = rand() * H, r = 60 + rand() * 160;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(0,0,0,0.35)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      break;
    }
    case 'neon': {
      ctx.strokeStyle = p.alt;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      for (let x = 0; x < W; x += PX) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += PX) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ectx.strokeStyle = p.alt;
      ectx.globalAlpha = 0.25;
      ectx.lineWidth = 2;
      for (let x = 0; x < W; x += PX) {
        ectx.beginPath(); ectx.moveTo(x, 0); ectx.lineTo(x, H); ectx.stroke();
      }
      for (let y = 0; y < H; y += PX) {
        ectx.beginPath(); ectx.moveTo(0, y); ectx.lineTo(W, y); ectx.stroke();
      }
      ctx.globalAlpha = 1;
      ectx.globalAlpha = 1;
      break;
    }
    default: {
      for (let i = 0; i < 14000; i++) {
        ctx.fillStyle = rand() > 0.5 ? p.alt : '#000';
        ctx.globalAlpha = rand() * (p.style === 'pastel' ? 0.05 : 0.1);
        ctx.fillRect(rand() * W, rand() * H, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  // The key ("paint") and three point zone tint.
  ctx.fillStyle = p.paint;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(X(-2.45), Z(-1.575), 4.9 * PX, (4.225 + 1.575) * PX);
  ctx.globalAlpha = 1;

  const strokeBoth = (draw: (g: CanvasRenderingContext2D) => void) => {
    for (const [g, color, alpha] of [
      [ctx, p.line, 1],
      [ectx, p.line, p.lineGlow],
    ] as const) {
      g.save();
      g.strokeStyle = color;
      g.globalAlpha = alpha;
      g.lineWidth = 0.06 * PX;
      g.lineCap = 'round';
      g.beginPath();
      draw(g);
      g.stroke();
      g.restore();
    }
  };

  strokeBoth((g) => g.rect(X(-7.5), Z(-1.575), 15 * PX, (COURT.maxZ - 0.4 + 1.575) * PX));
  strokeBoth((g) => g.rect(X(-2.45), Z(-1.575), 4.9 * PX, (4.225 + 1.575) * PX));
  strokeBoth((g) => g.arc(X(0), Z(4.225), 1.8 * PX, 0, Math.PI * 2));
  strokeBoth((g) => g.arc(X(0), Z(0), 1.25 * PX, 0, Math.PI));
  const cornerZ = Math.sqrt(6.75 * 6.75 - 6.6 * 6.6);
  strokeBoth((g) => {
    g.moveTo(X(-6.6), Z(-1.575));
    g.lineTo(X(-6.6), Z(cornerZ));
    const a0 = Math.atan2(cornerZ, -6.6);
    const a1 = Math.atan2(cornerZ, 6.6);
    g.arc(X(0), Z(0), 6.75 * PX, a0, a1, true);
    g.lineTo(X(6.6), Z(-1.575));
  });
  strokeBoth((g) => g.arc(X(0), Z(9.6), 1.6 * PX, 0, Math.PI * 2));

  for (const g of [ctx, ectx]) {
    g.save();
    g.translate(X(0), Z(9.6));
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${0.55 * PX}px Fredoka, "Arial Rounded MT Bold", system-ui, sans-serif`;
    g.fillStyle = p.emblemColor;
    g.globalAlpha = g === ctx ? 0.9 : p.lineGlow * 0.8;
    g.fillText(p.emblem, 0, 0);
    g.restore();
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const emissive = new THREE.CanvasTexture(ec);
  emissive.colorSpace = THREE.SRGBColorSpace;
  emissive.anisotropy = 8;
  return { map, emissive };
}

/** Equirectangular Earth with oceans, continents, ice caps and clouds. */
export function earthTexture(): THREE.Texture {
  const W = 512, H = 256;
  const [c, ctx] = canvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - j / H) * Math.PI;
    for (let i = 0; i < W; i++) {
      const lon = (i / W) * Math.PI * 2;
      const x = Math.cos(lat) * Math.sin(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.cos(lon);
      const land = fbm3(x * 2.2 + 3, y * 2.2, z * 2.2, 5);
      const cloud = fbm3(x * 4 + 11, y * 6, z * 4, 4);
      let r = 20, g = 70, b = 160;
      if (land > 0.54) {
        const t = Math.min(1, (land - 0.54) * 6);
        r = 60 + t * 90; g = 130 - t * 20; b = 60 - t * 10;
        if (Math.abs(lat) < 0.45 && land > 0.62) { r = 190; g = 160; b = 100; }
      } else {
        const d = (0.54 - land) * 2;
        r = 15; g = 70 - d * 30; b = 170 - d * 50;
      }
      if (Math.abs(lat) > 1.2) { r = g = b = 240; }
      const cl = Math.max(0, (cloud - 0.52) * 3.2);
      r = r + (255 - r) * Math.min(1, cl);
      g = g + (255 - g) * Math.min(1, cl);
      b = b + (255 - b) * Math.min(1, cl);
      const o = (j * W + i) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
