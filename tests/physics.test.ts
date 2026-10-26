import { describe, expect, it } from 'vitest';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { BALL_RADIUS, FIXED_STEP, Physics } from '../client/src/engine/physics';
import { Hoop } from '../client/src/game/hoop';
import { idealShot, type AimContext } from '../client/src/game/ballistics';
import { crossedRim } from '../client/src/game/scoring';
import { HOOP_BASE, releasePoint, spotOnArc } from '../client/src/stages/common';
import { portalShot } from '../client/src/stages/portal';

/** Simulates one shot in the real physics world and reports whether it went in. */
function simulate(spot: THREE.Vector3, gravity: number, scale = 1, opts: { velocityScale?: number; portal?: ReturnType<typeof portalShot> } = {}) {
  const physics = new Physics();
  physics.setGravity(gravity);
  const hoop = new Hoop(physics);
  hoop.buildRim(scale);
  hoop.place(HOOP_BASE);
  const ball = new CANNON.Body({ mass: 0.62, shape: new CANNON.Sphere(BALL_RADIUS), material: physics.mat.ball, linearDamping: 0 });
  physics.world.addBody(ball);
  let rimTouches = 0;
  ball.addEventListener('collide', (e: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
    const s = hoop.body.shapes.includes(e.contact.si) ? e.contact.si : e.contact.sj;
    if (e.body === hoop.body && hoop.rimShapeIds.has(s.id)) rimTouches++;
  });

  const from = releasePoint(spot, HOOP_BASE);
  const ideal = HOOP_BASE.clone();
  const portal = opts.portal?.portal;
  if (portal) ideal.sub(portal.exit.clone().sub(portal.entry));
  const ctx: AimContext = { from, facing: HOOP_BASE.clone().sub(from).setY(0).normalize(), ideal, g: gravity };
  const v = idealShot(ctx)!;
  const k = opts.velocityScale ?? 1;
  ball.position.set(from.x, from.y, from.z);
  ball.velocity.set(v.x * k, v.y * k, v.z * k);

  const prev = new THREE.Vector3().copy(from);
  let teleported = false;
  for (let i = 0; i < 240 * 6; i++) {
    physics.step();
    const cur = new THREE.Vector3(ball.position.x, ball.position.y, ball.position.z);
    if (portal && !teleported) {
      const sPrev = prev.clone().sub(portal.entry).dot(portal.normal);
      const rel = cur.clone().sub(portal.entry);
      const sCurr = rel.dot(portal.normal);
      if (sPrev < 0 && sCurr >= 0 && rel.addScaledVector(portal.normal, -sCurr).length() < portal.radius) {
        cur.add(portal.exit.clone().sub(portal.entry));
        ball.position.set(cur.x, cur.y, cur.z);
        prev.copy(cur);
        teleported = true;
        continue;
      }
    }
    const a = prev.clone().sub(HOOP_BASE);
    const b = cur.clone().sub(HOOP_BASE);
    if (crossedRim(a, b, hoop.rimRadius, BALL_RADIUS)) return { made: true, rimTouches, teleported, time: i * FIXED_STEP };
    prev.copy(cur);
    if (cur.y < -2) break;
  }
  return { made: false, rimTouches, teleported, time: 0 };
}

describe('real physics shots', () => {
  it.each([
    ['free throw', 4.6, 0],
    ['three straight on', 7.0, 0],
    ['three from the wing', 7.0, -45],
    ['deep three', 8.5, 25],
  ])('a perfect %s is a swish', (_label, d, angle) => {
    const r = simulate(spotOnArc(d, angle), 9.81);
    expect(r.made).toBe(true);
    expect(r.rimTouches).toBe(0);
  });

  it('a perfect shot on the moon goes in', () => {
    expect(simulate(spotOnArc(8.0, 20), 9.81 * 0.42).made).toBe(true);
  });

  it('a perfect shot still fits the smallest storm rim', () => {
    expect(simulate(spotOnArc(6.5, -30), 9.81, 0.85).made).toBe(true);
  });

  it('a shot that is 12% too strong misses', () => {
    expect(simulate(spotOnArc(7.0, 0), 9.81, 1, { velocityScale: 1.12 }).made).toBe(false);
  });

  it('a portal shot flies through the portal into the hoop', () => {
    const spot = spotOnArc(8.2, 10);
    const portal = portalShot(spot, 9.81, 1.2, 0.6, 3.6);
    const r = simulate(spot, 9.81, 1, { portal });
    expect(r.teleported).toBe(true);
    expect(r.made).toBe(true);
  });
});
