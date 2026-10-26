import { describe, expect, it } from 'vitest';
import { computePoints, crossedRim, RIM_RADIUS, starsFor, THREE_POINT_DISTANCE } from '../client/src/game/scoring';

const BALL = 0.12;

describe('crossedRim', () => {
  it('counts a ball dropping straight through the middle', () => {
    expect(crossedRim({ x: 0, y: 0.05, z: 0 }, { x: 0, y: -0.05, z: 0 }, RIM_RADIUS, BALL)).toBe(true);
  });

  it('ignores a ball coming up through the rim from below', () => {
    expect(crossedRim({ x: 0, y: -0.05, z: 0 }, { x: 0, y: 0.05, z: 0 }, RIM_RADIUS, BALL)).toBe(false);
  });

  it('ignores a ball passing the rim plane outside the hoop', () => {
    expect(crossedRim({ x: 0.4, y: 0.05, z: 0 }, { x: 0.4, y: -0.05, z: 0 }, RIM_RADIUS, BALL)).toBe(false);
  });

  it('interpolates the crossing point between frames', () => {
    // Far outside before and after, but the line crosses the plane right at the centre.
    expect(crossedRim({ x: -0.5, y: 0.1, z: 0 }, { x: 0.5, y: -0.1, z: 0 }, RIM_RADIUS, BALL)).toBe(true);
  });

  it('rejects a ball that would clip the rim edge', () => {
    const edge = RIM_RADIUS - BALL * 0.2;
    expect(crossedRim({ x: edge, y: 0.02, z: 0 }, { x: edge, y: -0.02, z: 0 }, RIM_RADIUS, BALL)).toBe(false);
  });

  it('respects a shrunken rim', () => {
    const p = { x: 0.12, y: 0.02, z: 0 };
    const c = { x: 0.12, y: -0.02, z: 0 };
    expect(crossedRim(p, c, RIM_RADIUS, BALL)).toBe(true);
    expect(crossedRim(p, c, RIM_RADIUS * 0.7, BALL)).toBe(false);
  });
});

describe('computePoints', () => {
  it('gives 2 inside the arc and 3 beyond it', () => {
    expect(computePoints({ distance: 4.2, swish: false, bank: false, streak: 0 }).points).toBe(2);
    expect(computePoints({ distance: THREE_POINT_DISTANCE, swish: false, bank: false, streak: 0 }).points).toBe(3);
  });

  it('adds bonuses for swish, bank and portal', () => {
    const r = computePoints({ distance: 7, swish: true, bank: false, streak: 0, portal: true });
    expect(r.points).toBe(5);
    expect(r.labels).toEqual(['THREE!', 'SWISH', 'PORTAL']);
    expect(computePoints({ distance: 4, swish: false, bank: true, streak: 0 }).points).toBe(3);
  });

  it('doubles everything from the third basket in a row', () => {
    expect(computePoints({ distance: 4, swish: true, bank: false, streak: 1 }).onFire).toBe(false);
    const fire = computePoints({ distance: 7, swish: true, bank: false, streak: 2 });
    expect(fire.onFire).toBe(true);
    expect(fire.points).toBe(8);
    expect(fire.labels).toContain('ON FIRE x2');
  });
});

describe('starsFor', () => {
  it('awards one star per threshold reached', () => {
    const t = [10, 20, 30] as const;
    expect(starsFor(0, t)).toBe(0);
    expect(starsFor(10, t)).toBe(1);
    expect(starsFor(29, t)).toBe(2);
    expect(starsFor(99, t)).toBe(3);
  });
});
