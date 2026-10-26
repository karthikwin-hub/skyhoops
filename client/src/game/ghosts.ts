import * as THREE from 'three';
import { BALL_RADIUS } from '../engine/physics';
import { ballTextures } from '../engine/textures';

const TRAIL = 24;

interface Ghost {
  group: THREE.Group;
  ball: THREE.Mesh;
  label: THREE.Sprite;
  trail: THREE.Line;
  trailPts: THREE.Vector3[];
  target: THREE.Vector3;
  vel: THREE.Vector3;
  lastUpdate: number;
  fade: number;
  alive: boolean;
}

function labelSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '700 30px Fredoka, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = Math.min(250, g.measureText(text).width + 30);
  g.fillStyle = 'rgba(10,10,30,0.55)';
  g.beginPath();
  g.roundRect(128 - w / 2, 8, w, 48, 24);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#fff';
  g.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  s.scale.set(1.0, 0.25, 1);
  s.renderOrder = 10;
  return s;
}

/** Friends' balls, replayed from the network as translucent ghosts in their own colours. */
export class Ghosts {
  readonly group = new THREE.Group();
  private ghosts = new Map<string, Ghost>();
  private time = 0;

  constructor(private onMade: (at: THREE.Vector3, color: string) => void) {}

  private get(id: string, name: string, avatar: string, color: string): Ghost {
    let g = this.ghosts.get(id);
    if (g) return g;
    const tex = ballTextures(color);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 24, 16),
      new THREE.MeshStandardMaterial({ map: tex.map, transparent: true, opacity: 0.55, emissive: color, emissiveIntensity: 0.6, depthWrite: false }),
    );
    const label = labelSprite(`${avatar} ${name}`, color);
    label.position.y = 0.38;
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const colors = new Float32Array(TRAIL * 3);
    const col = new THREE.Color(color);
    for (let i = 0; i < TRAIL; i++) {
      const k = (i / (TRAIL - 1)) ** 2;
      colors.set([col.r * k * 1.5, col.g * k * 1.5, col.b * k * 1.5], i * 3);
    }
    trailGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    trail.frustumCulled = false;
    const group = new THREE.Group();
    const holder = new THREE.Group();
    holder.add(ball, label);
    group.add(holder, trail);
    group.visible = false;
    this.group.add(group);
    g = { group, ball, label, trail, trailPts: [], target: new THREE.Vector3(), vel: new THREE.Vector3(), lastUpdate: 0, fade: 0, alive: false };
    this.ghosts.set(id, g);
    return g;
  }

  update(id: string, name: string, avatar: string, color: string, p: [number, number, number]): void {
    const g = this.get(id, name, avatar, color);
    const next = new THREE.Vector3(...p);
    if (!g.alive) {
      g.alive = true;
      g.trailPts = [];
      (g.group.children[0] as THREE.Group).position.copy(next);
      g.vel.set(0, 0, 0);
    } else {
      const dt = Math.max(0.03, this.time - g.lastUpdate);
      g.vel.copy(next).sub(g.target).divideScalar(dt);
    }
    g.target.copy(next);
    g.lastUpdate = this.time;
    g.fade = 1;
    g.group.visible = true;
  }

  end(id: string, made: boolean): void {
    const g = this.ghosts.get(id);
    if (!g) return;
    g.alive = false;
    if (made) {
      const holder = g.group.children[0] as THREE.Group;
      this.onMade(holder.position.clone(), '#' + (g.ball.material as THREE.MeshStandardMaterial).emissive.getHexString());
    }
  }

  remove(id: string): void {
    const g = this.ghosts.get(id);
    if (!g) return;
    this.group.remove(g.group);
    this.ghosts.delete(id);
  }

  clear(): void {
    for (const id of [...this.ghosts.keys()]) this.remove(id);
  }

  tick(dt: number): void {
    this.time += dt;
    for (const g of this.ghosts.values()) {
      const holder = g.group.children[0] as THREE.Group;
      if (g.alive) {
        // Extrapolate a little between network updates so ghosts glide instead of stepping.
        const ahead = g.target.clone().addScaledVector(g.vel, Math.min(0.1, this.time - g.lastUpdate));
        holder.position.lerp(ahead, Math.min(1, dt * 18));
        g.ball.rotation.x += dt * 8;
        if (this.time - g.lastUpdate > 1.5) g.alive = false;
      } else {
        g.fade = Math.max(0, g.fade - dt * 1.5);
        if (g.fade <= 0) g.group.visible = false;
      }
      (g.ball.material as THREE.MeshStandardMaterial).opacity = 0.55 * g.fade;
      (g.label.material as THREE.SpriteMaterial).opacity = g.fade;
      if (g.alive) {
        g.trailPts.push(holder.position.clone());
        if (g.trailPts.length > TRAIL) g.trailPts.shift();
      } else if (g.trailPts.length) g.trailPts.shift();
      const pos = g.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      const n = g.trailPts.length;
      for (let i = 0; i < TRAIL; i++) {
        const p = n ? g.trailPts[Math.max(0, Math.min(n - 1, i - (TRAIL - n)))] : holder.position;
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
    }
  }
}
