import * as CANNON from 'cannon-es';

export const FIXED_STEP = 1 / 240;
export const BALL_RADIUS = 0.12;
export const BALL_MASS = 0.62;

export interface Materials {
  ball: CANNON.Material;
  rim: CANNON.Material;
  board: CANNON.Material;
  floor: CANNON.Material;
  wall: CANNON.Material;
}

/** Thin wrapper around a cannon-es world with tuned basketball materials. */
export class Physics {
  readonly world: CANNON.World;
  readonly mat: Materials;

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    this.world.broadphase = new CANNON.NaiveBroadphase();
    (this.world.solver as CANNON.GSSolver).iterations = 12;
    this.world.allowSleep = false;

    this.mat = {
      ball: new CANNON.Material('ball'),
      rim: new CANNON.Material('rim'),
      board: new CANNON.Material('board'),
      floor: new CANNON.Material('floor'),
      wall: new CANNON.Material('wall'),
    };
    const m = this.mat;
    const pair = (a: CANNON.Material, b: CANNON.Material, restitution: number, friction: number) =>
      this.world.addContactMaterial(
        new CANNON.ContactMaterial(a, b, {
          restitution,
          friction,
          contactEquationStiffness: 1e8,
          contactEquationRelaxation: 3,
        }),
      );
    pair(m.ball, m.rim, 0.52, 0.18);
    pair(m.ball, m.board, 0.68, 0.3);
    pair(m.ball, m.floor, 0.76, 0.55);
    pair(m.ball, m.wall, 0.55, 0.2);
  }

  setGravity(g: number): void {
    this.world.gravity.set(0, -g, 0);
  }

  step(): void {
    this.world.step(FIXED_STEP);
  }
}
