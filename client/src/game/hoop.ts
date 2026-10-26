import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { Physics } from '../engine/physics';
import { RIM_RADIUS } from './scoring';

export const RIM_HEIGHT = 3.05;
const TUBE = 0.018;
const RIM_SEGMENTS = 24;

export interface HoopStyle {
  rim: string;
  frame: string;
  pole: string;
  glow: number;
}

/**
 * Backboard, rim and pole. Physics is one kinematic body whose origin is the rim centre,
 * so moving hoops carry their momentum into collisions properly.
 */
export class Hoop {
  readonly group = new THREE.Group();
  readonly rimCenter = new THREE.Vector3(0, RIM_HEIGHT, 0);
  readonly prevRimCenter = new THREE.Vector3(0, RIM_HEIGHT, 0);
  body!: CANNON.Body;
  rimShapeIds = new Set<number>();
  boardShapeId = -1;
  rimRadius = RIM_RADIUS;
  private rimMesh!: THREE.Mesh;
  private rimMat: THREE.MeshStandardMaterial;
  private frameMat: THREE.MeshStandardMaterial;
  private poleMat: THREE.MeshStandardMaterial;
  private glowRing: THREE.Mesh;
  private glowMat: THREE.MeshBasicMaterial;
  private pole: THREE.Group;
  private flashT = 0;
  private baseGlow = 1;
  poleHeight = RIM_HEIGHT;

  constructor(private physics: Physics) {
    this.rimMat = new THREE.MeshStandardMaterial({ color: '#ff5b1f', metalness: 0.7, roughness: 0.3, emissive: '#ff3300', emissiveIntensity: 0.2 });
    this.frameMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.2, roughness: 0.4 });
    this.poleMat = new THREE.MeshStandardMaterial({ color: '#2a2f45', metalness: 0.6, roughness: 0.35 });

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.83, 1.07, 0.03),
      new THREE.MeshPhysicalMaterial({
        color: '#dff6ff',
        transparent: true,
        opacity: 0.22,
        roughness: 0.04,
        metalness: 0,
        clearcoat: 1,
        envMapIntensity: 1.5,
        depthWrite: false,
      }),
    );
    board.position.set(0, 0.385, -0.405);
    board.renderOrder = 2;
    this.group.add(board);

    const bar = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), this.frameMat);
      m.position.set(x, y, -0.39);
      this.group.add(m);
    };
    bar(1.85, 0.05, 0, 0.385 + 0.535);
    bar(1.85, 0.05, 0, 0.385 - 0.535);
    bar(0.05, 1.12, -0.915, 0.385);
    bar(0.05, 1.12, 0.915, 0.385);
    bar(0.59, 0.035, 0, 0.15 + 0.45);
    bar(0.59, 0.035, 0, 0.15);
    bar(0.035, 0.45, -0.295, 0.375);
    bar(0.035, 0.45, 0.295, 0.375);

    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.17), this.rimMat);
    bracket.position.set(0, -0.02, -0.31);
    this.group.add(bracket);

    this.glowMat = new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glowRing = new THREE.Mesh(new THREE.TorusGeometry(RIM_RADIUS + 0.01, 0.05, 12, 64), this.glowMat);
    this.glowRing.rotation.x = Math.PI / 2;
    this.group.add(this.glowRing);

    this.pole = new THREE.Group();
    this.group.add(this.pole);
    this.buildPole(RIM_HEIGHT);
    this.buildRim(1);
  }

  setStyle(s: HoopStyle): void {
    this.rimMat.color.set(s.rim);
    this.rimMat.emissive.set(s.rim);
    this.frameMat.color.set(s.frame);
    this.frameMat.emissive.set(s.frame);
    this.frameMat.emissiveIntensity = s.glow;
    this.baseGlow = s.glow;
    this.poleMat.color.set(s.pole);
  }

  /** Rebuilds the pole so it reaches the ground `height` metres below the rim. */
  buildPole(height: number): void {
    this.poleHeight = height;
    this.pole.clear();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, height + 0.35, 16), this.poleMat);
    pole.position.set(0, -height / 2 + 0.17, -1.45);
    pole.castShadow = true;
    this.pole.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.05), this.poleMat);
    arm.position.set(0, 0.35, -0.95);
    arm.castShadow = true;
    this.pole.add(arm);
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 1.6, 16),
      new THREE.MeshStandardMaterial({ color: this.frameMat.color, emissive: this.frameMat.color, emissiveIntensity: 0.15, roughness: 0.8 }),
    );
    pad.position.set(0, -height + 0.8, -1.45);
    this.pole.add(pad);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.15, 24), this.poleMat);
    base.position.set(0, -height + 0.07, -1.45);
    base.receiveShadow = true;
    this.pole.add(base);
    if (this.body) this.buildRim(this.rimRadius / RIM_RADIUS);
  }

  /** Rebuilds the rim (visual and physics) at a new size, e.g. for the shrinking hoop. */
  buildRim(scale: number): void {
    this.rimRadius = RIM_RADIUS * scale;
    const ring = this.rimRadius + TUBE / 2;

    if (this.rimMesh) {
      this.group.remove(this.rimMesh);
      this.rimMesh.geometry.dispose();
    }
    this.rimMesh = new THREE.Mesh(new THREE.TorusGeometry(ring, TUBE, 14, 72), this.rimMat);
    this.rimMesh.rotation.x = Math.PI / 2;
    this.rimMesh.castShadow = true;
    this.group.add(this.rimMesh);
    this.glowRing.scale.setScalar(scale);

    const pos = this.body ? this.body.position.clone() : new CANNON.Vec3(0, RIM_HEIGHT, 0);
    if (this.body) this.physics.world.removeBody(this.body);
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.physics.mat.rim });
    body.position.copy(pos);
    this.rimShapeIds.clear();
    for (let i = 0; i < RIM_SEGMENTS; i++) {
      const a = (i / RIM_SEGMENTS) * Math.PI * 2;
      const s = new CANNON.Sphere(TUBE);
      s.material = this.physics.mat.rim;
      body.addShape(s, new CANNON.Vec3(Math.cos(a) * ring, 0, Math.sin(a) * ring));
      this.rimShapeIds.add(s.id);
    }
    const bracket = new CANNON.Box(new CANNON.Vec3(0.06, 0.02, 0.085));
    bracket.material = this.physics.mat.rim;
    body.addShape(bracket, new CANNON.Vec3(0, -0.02, -0.31));
    this.rimShapeIds.add(bracket.id);

    const board = new CANNON.Box(new CANNON.Vec3(0.915, 0.535, 0.025));
    board.material = this.physics.mat.board;
    body.addShape(board, new CANNON.Vec3(0, 0.385, -0.405));
    this.boardShapeId = board.id;

    const pole = new CANNON.Box(new CANNON.Vec3(0.1, (this.poleHeight + 0.35) / 2, 0.1));
    pole.material = this.physics.mat.wall;
    body.addShape(pole, new CANNON.Vec3(0, -this.poleHeight / 2 + 0.17, -1.45));
    const arm = new CANNON.Box(new CANNON.Vec3(0.06, 0.06, 0.52));
    arm.material = this.physics.mat.wall;
    body.addShape(arm, new CANNON.Vec3(0, 0.35, -0.95));

    this.physics.world.addBody(body);
    this.body = body;
  }

  /** Places the hoop for the next physics step, giving the body the matching velocity. */
  moveTo(p: THREE.Vector3, dt: number): void {
    this.prevRimCenter.copy(this.rimCenter);
    const b = this.body;
    if (dt > 0) {
      b.velocity.set((p.x - b.position.x) / dt, (p.y - b.position.y) / dt, (p.z - b.position.z) / dt);
    }
    this.rimCenter.copy(p);
  }

  /** Teleports without imparting velocity (between rounds). */
  place(p: THREE.Vector3): void {
    this.body.position.set(p.x, p.y, p.z);
    this.body.velocity.setZero();
    this.rimCenter.copy(p);
    this.prevRimCenter.copy(p);
    this.group.position.copy(p);
  }

  flash(strength = 1): void {
    this.flashT = Math.max(this.flashT, strength);
  }

  sync(dt: number, streakGlow: number): void {
    const p = this.body.position;
    this.group.position.set(p.x, p.y, p.z);
    this.flashT = Math.max(0, this.flashT - dt * 1.6);
    this.glowMat.opacity = Math.min(1, this.flashT * 0.9 + streakGlow * 0.25);
    this.rimMat.emissiveIntensity = 0.2 + this.flashT * 2.5 + streakGlow * 0.6;
    this.frameMat.emissiveIntensity = this.baseGlow * (1 + this.flashT * 1.5 + streakGlow * 0.5);
  }
}
