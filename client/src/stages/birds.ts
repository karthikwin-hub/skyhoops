import * as THREE from 'three';
import type { SceneryContext } from './stageTypes';

/** Builds a flat shape in the bird's wing plane (x = span, y = backwards), lying horizontal. */
function flat(points: [number, number][], tint: (x: number) => THREE.Color): THREE.BufferGeometry {
  const geo = new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))));
  geo.rotateX(-Math.PI / 2);
  return colored(geo, (p) => tint(p.x));
}

function colored(geo: THREE.BufferGeometry, tint: (p: THREE.Vector3) => THREE.Color): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) tint(p.fromBufferAttribute(pos, i)).toArray(col, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** A wing panel as two one-sided meshes: grey on top, white underneath, black tips on both. */
function panel(points: [number, number][], top: (x: number) => THREE.Color, under: (x: number) => THREE.Color, upper: THREE.Material, lower: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(flat(points, top), upper), new THREE.Mesh(flat(points, under), lower));
  return g;
}

interface Wing {
  shoulder: THREE.Group;
  wrist: THREE.Group;
}

interface Bird {
  root: THREE.Group;
  wings: Wing[];
  offset: THREE.Vector3;
  phase: number;
  freq: number;
  seed: number;
}

export interface FlockOptions {
  count: number;
  center: THREE.Vector3;
  radius: [number, number];
  /** Radians per second around the loop. */
  speed: number;
  spacing: number;
  scale: number;
}

/**
 * Gulls with a body, head, beak and tail, and two-part wings that bend at the wrist as they flap.
 * They alternate flapping and gliding, bank into turns, and keep a loose formation.
 */
export function flock(ctx: SceneryContext, o: FlockOptions): (t: number, dt: number) => void {
  const grey = new THREE.Color('#8f99a6');
  const dark = new THREE.Color('#1c1c22');
  const white = new THREE.Color('#ecebe8');
  const upper = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.FrontSide });
  const lower = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.BackSide });
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const beakMat = new THREE.MeshStandardMaterial({ color: '#e6b53a', roughness: 0.6 });
  // Grey back, white head and belly.
  const backTint = (p: THREE.Vector3) => white.clone().lerp(grey, THREE.MathUtils.smoothstep(p.y, 0.01, 0.05) * THREE.MathUtils.smoothstep(-p.z, -0.12, 0.05));

  const body = colored(new THREE.SphereGeometry(1, 14, 10).scale(0.075, 0.068, 0.24), backTint);
  const head = colored(new THREE.SphereGeometry(0.056, 12, 8).scale(1, 0.95, 1.15).translate(0, 0.045, 0.22), () => white);
  const beak = new THREE.ConeGeometry(0.014, 0.075, 6).rotateX(Math.PI / 2).translate(0, 0.035, 0.305);
  const tailPts: [number, number][] = [[-0.045, 0.16], [0.045, 0.16], [0.075, 0.31], [0, 0.29], [-0.075, 0.31]];
  // Broad inner wing, then an outer wing that sweeps back to a point with black tips.
  const innerPts: [number, number][] = [[0, -0.06], [0.16, -0.065], [0.3, -0.05], [0.3, 0.075], [0.15, 0.11], [0, 0.13]];
  const outerPts: [number, number][] = [[0, -0.05], [0.16, -0.04], [0.29, 0.0], [0.37, 0.07], [0.3, 0.085], [0.17, 0.085], [0, 0.075]];
  const tip = (base: THREE.Color) => (x: number) => base.clone().lerp(dark, THREE.MathUtils.smoothstep(x, 0.18, 0.31));

  const birds: Bird[] = [];
  for (let i = 0; i < o.count; i++) {
    const root = new THREE.Group();
    const torso = new THREE.Group();
    torso.add(new THREE.Mesh(body, bodyMat), new THREE.Mesh(head, bodyMat), new THREE.Mesh(beak, beakMat), panel(tailPts, () => white, () => white, upper, lower));
    const wings: Wing[] = [];
    for (const side of [1, -1]) {
      const mirror = new THREE.Group();
      mirror.scale.x = side;
      const shoulder = new THREE.Group();
      shoulder.position.set(0.045, 0.025, 0.03);
      shoulder.add(panel(innerPts, () => grey, () => white, upper, lower));
      const wrist = new THREE.Group();
      wrist.position.x = 0.3;
      wrist.add(panel(outerPts, tip(grey), tip(white), upper, lower));
      shoulder.add(wrist);
      mirror.add(shoulder);
      torso.add(mirror);
      wings.push({ shoulder, wrist });
    }
    torso.scale.setScalar(o.scale);
    root.add(torso);
    ctx.root.add(root);
    // A loose V: each bird trails the leader a little to one side.
    const row = Math.ceil(i / 2);
    const side = i === 0 ? 0 : i % 2 ? 1 : -1;
    birds.push({
      root,
      wings,
      offset: new THREE.Vector3(side * row * o.spacing * (0.8 + ctx.rng() * 0.4), (ctx.rng() - 0.5) * o.spacing * 0.6, -row * o.spacing * (0.9 + ctx.rng() * 0.3)),
      phase: ctx.rng() * Math.PI * 2,
      freq: 2.6 + ctx.rng() * 0.8,
      seed: ctx.rng() * 100,
    });
  }

  const start = ctx.rng() * Math.PI * 2;
  const path = (t: number, out: THREE.Vector3) =>
    out.set(
      o.center.x + Math.cos(start + t * o.speed) * o.radius[0],
      o.center.y + Math.sin(t * o.speed * 1.7) * 2.5,
      o.center.z + Math.sin(start + t * o.speed) * o.radius[1],
    );
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), ahead = new THREE.Vector3();
  let lastHeading = 0;

  return (t, dt) => {
    path(t, p0);
    path(t + 0.1, p1);
    fwd.subVectors(p1, p0).normalize();
    right.crossVectors(fwd, up).normalize();
    const heading = Math.atan2(fwd.x, fwd.z);
    let turn = heading - lastHeading;
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    lastHeading = heading;
    const bank = THREE.MathUtils.clamp((-turn / Math.max(dt, 1e-3)) * 1.6, -0.6, 0.6);

    for (const b of birds) {
      const wander = Math.sin(t * 0.7 + b.seed) * 0.6;
      pos.copy(p0)
        .addScaledVector(right, b.offset.x + wander)
        .addScaledVector(up, b.offset.y + Math.sin(t * 0.9 + b.seed * 2) * 0.4)
        .addScaledVector(fwd, b.offset.z);
      // Bursts of flapping between long glides, like real gulls.
      const flapping = THREE.MathUtils.smoothstep(Math.sin(t * 0.45 + b.seed), -0.2, 0.4);
      b.phase += dt * b.freq * Math.PI * 2 * (0.4 + flapping * 0.6);
      const beat = Math.sin(b.phase);
      pos.y += -beat * 0.04 * flapping * o.scale;
      b.root.position.copy(pos);
      ahead.copy(pos).add(fwd);
      b.root.lookAt(ahead);
      b.root.rotateZ(bank + Math.sin(t * 1.3 + b.seed) * 0.06);
      for (const w of b.wings) {
        w.shoulder.rotation.z = 0.1 + flapping * 0.6 * beat;
        w.wrist.rotation.z = -0.08 + flapping * 0.5 * Math.sin(b.phase - 0.9);
        w.shoulder.rotation.x = flapping * 0.08 * Math.cos(b.phase);
      }
    }
  };
}
