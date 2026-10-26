import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TUNING,
  EARTH_G,
  gestureFromPath,
  gesturePower,
  gestureToShot,
  idealShot,
  LAUNCH_ANGLE,
  MIN_SWIPE,
  solveLaunchSpeed,
  wrapAngle,
  type AimContext,
} from '../client/src/game/ballistics';

const ctx: AimContext = {
  from: { x: 0, y: 1.6, z: 6.5 },
  facing: { x: 0, y: 0, z: -1 },
  ideal: { x: 0, y: 3.05, z: 0 },
  g: EARTH_G,
};

/** Swipe length that maps exactly to the ideal launch speed. */
function perfectSwipe(c: AimContext): number {
  const d = Math.hypot(c.ideal.x - c.from.x, c.ideal.z - c.from.z);
  const v = solveLaunchSpeed(d, c.ideal.y - c.from.y, c.g)!;
  const reach = (v * v * Math.sin(2 * LAUNCH_ANGLE)) / EARTH_G;
  return (reach / DEFAULT_TUNING.maxDistance) * DEFAULT_TUNING.fullSwipe;
}

const speed = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

describe('solveLaunchSpeed', () => {
  it('lands on the target', () => {
    const d = 6;
    const h = 1.4;
    const v = solveLaunchSpeed(d, h, EARTH_G)!;
    const vx = v * Math.cos(LAUNCH_ANGLE);
    const t = d / vx;
    const y = v * Math.sin(LAUNCH_ANGLE) * t - 0.5 * EARTH_G * t * t;
    expect(y).toBeCloseTo(h, 6);
  });

  it('needs less speed on the Moon', () => {
    expect(solveLaunchSpeed(6, 1.4, EARTH_G * 0.42)!).toBeLessThan(solveLaunchSpeed(6, 1.4, EARTH_G)!);
  });

  it('returns null for targets too steep for the launch angle', () => {
    expect(solveLaunchSpeed(1, 5, EARTH_G)).toBeNull();
    expect(solveLaunchSpeed(0, 1, EARTH_G)).toBeNull();
  });
});

describe('gestureToShot', () => {
  it('ignores tiny swipes', () => {
    expect(gestureToShot({ dx: 0, dy: MIN_SWIPE * 0.5, curve: 0 }, ctx)).toBeNull();
    expect(gestureToShot({ dx: 0, dy: -0.3, curve: 0 }, ctx)).toBeNull();
  });

  it('turns a perfect straight swipe into the ideal shot', () => {
    const shot = gestureToShot({ dx: 0, dy: perfectSwipe(ctx), curve: 0 }, ctx)!;
    const ideal = idealShot(ctx)!;
    expect(shot.velocity.x).toBeCloseTo(ideal.x, 3);
    expect(shot.velocity.y).toBeCloseTo(ideal.y, 3);
    expect(shot.velocity.z).toBeCloseTo(ideal.z, 3);
    expect(shot.sideSpin).toBe(0);
  });

  it('throws further with a longer swipe', () => {
    const short = gestureToShot({ dx: 0, dy: 0.2, curve: 0 }, ctx, { ...DEFAULT_TUNING, assist: 0 })!;
    const long = gestureToShot({ dx: 0, dy: 0.4, curve: 0 }, ctx, { ...DEFAULT_TUNING, assist: 0 })!;
    expect(speed(long.velocity)).toBeGreaterThan(speed(short.velocity));
  });

  it('assist pulls a near miss toward the ideal speed, but not a wild one', () => {
    const ideal = speed(idealShot(ctx)!);
    const near = perfectSwipe(ctx) * 1.06;
    const raw = speed(gestureToShot({ dx: 0, dy: near, curve: 0 }, ctx, { ...DEFAULT_TUNING, assist: 0 })!.velocity);
    const helped = speed(gestureToShot({ dx: 0, dy: near, curve: 0 }, ctx, { ...DEFAULT_TUNING, assist: 0.8 })!.velocity);
    expect(Math.abs(helped - ideal)).toBeLessThan(Math.abs(raw - ideal) * 0.5);

    const wild = perfectSwipe(ctx) * 1.8;
    const a = speed(gestureToShot({ dx: 0, dy: wild, curve: 0 }, ctx, { ...DEFAULT_TUNING, assist: 0 })!.velocity);
    const b = speed(gestureToShot({ dx: 0, dy: wild, curve: 0 }, ctx, { ...DEFAULT_TUNING, assist: 0.8 })!.velocity);
    expect(b).toBeCloseTo(a, 6);
  });

  it('a sideways swipe aims sideways, and a curved one adds spin', () => {
    const right = gestureToShot({ dx: 0.12, dy: 0.35, curve: 0 }, ctx, { ...DEFAULT_TUNING, assist: 0 })!;
    expect(right.velocity.x).toBeGreaterThan(0.3);
    // Facing +x, screen right is forward × up = +z.
    const side = { ...ctx, from: { x: -6.5, y: 1.6, z: 0 }, facing: { x: 1, y: 0, z: 0 } };
    const r2 = gestureToShot({ dx: 0.12, dy: 0.35, curve: 0 }, side, { ...DEFAULT_TUNING, assist: 0 })!;
    expect(r2.velocity.z).toBeGreaterThan(0.3);
    const curved = gestureToShot({ dx: 0, dy: 0.35, curve: 0.2 }, ctx)!;
    expect(curved.sideSpin).toBeGreaterThan(0);
  });

  it('the same swipe flies further on low gravity worlds', () => {
    const moon = { ...ctx, g: EARTH_G * 0.42 };
    expect(perfectSwipe(moon)).toBeLessThan(perfectSwipe(ctx) * 0.6);
  });
});

describe('gesturePower', () => {
  it('caps out a little above a full swipe', () => {
    expect(gesturePower({ dx: 0, dy: DEFAULT_TUNING.fullSwipe, curve: 0 })).toBeCloseTo(1);
    expect(gesturePower({ dx: 0, dy: 5, curve: 0 })).toBe(1.25);
  });
});

describe('gestureFromPath', () => {
  it('normalises by screen height with y pointing up', () => {
    const g = gestureFromPath(
      [
        { x: 200, y: 700 },
        { x: 220, y: 500 },
        { x: 240, y: 300 },
      ],
      800,
    );
    expect(g.dy).toBeCloseTo(0.5);
    expect(g.dx).toBeCloseTo(0.05);
    expect(Math.abs(g.curve)).toBeLessThan(0.01);
  });

  it('measures how much the path bulges sideways', () => {
    const left = gestureFromPath(
      [
        { x: 200, y: 700 },
        { x: 160, y: 500 },
        { x: 200, y: 300 },
      ],
      800,
    );
    const right = gestureFromPath(
      [
        { x: 200, y: 700 },
        { x: 240, y: 500 },
        { x: 200, y: 300 },
      ],
      800,
    );
    expect(left.curve).toBeCloseTo(-right.curve);
    expect(Math.abs(left.curve)).toBeCloseTo(0.1);
  });

  it('handles taps', () => {
    expect(gestureFromPath([{ x: 1, y: 1 }], 800)).toEqual({ dx: 0, dy: 0, curve: 0 });
  });
});

describe('wrapAngle', () => {
  it('keeps angles in -π..π', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-2.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI);
  });
});
