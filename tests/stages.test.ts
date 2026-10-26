import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STAGES } from '../client/src/stages';
import { idealShot } from '../client/src/game/ballistics';
import { mulberry } from '../client/src/engine/textures';
import { HOOP_BASE, releasePoint } from '../client/src/stages/common';

const shotsFor = (s: (typeof STAGES)[number]) => (s.timeLimit ? 25 : s.shots);

describe('World Tour stages', () => {
  it('has 7 worlds in order with rising star targets', () => {
    expect(STAGES).toHaveLength(7);
    STAGES.forEach((s, i) => {
      expect(s.index).toBe(i);
      expect(s.stars[0]).toBeLessThan(s.stars[1]);
      expect(s.stars[1]).toBeLessThan(s.stars[2]);
    });
  });

  for (const stage of STAGES) {
    it(`${stage.name}: every shot is makeable and the same seed gives the same round`, () => {
      const a = mulberry(42);
      const b = mulberry(42);
      for (let i = 0; i < shotsFor(stage); i++) {
        const state = { shotIndex: i, made: Math.floor(i * 0.7), streak: 0 };
        const s1 = stage.setupShot(state, a);
        const s2 = stage.setupShot(state, b);
        expect(s1.spot.toArray()).toEqual(s2.spot.toArray());
        expect(s1.wind.toArray()).toEqual(s2.wind.toArray());

        const hoop = HOOP_BASE.clone();
        if (stage.hoopOffset) stage.hoopOffset(0, state, hoop);
        const from = releasePoint(s1.spot, hoop);
        const ideal = s1.portal ? hoop.clone().sub(s1.portal.exit.clone().sub(s1.portal.entry)) : hoop;
        const v = idealShot({ from, facing: new THREE.Vector3(0, 0, -1), ideal, g: stage.gravity });
        expect(v, `shot ${i}`).not.toBeNull();
        expect(s1.rimScale).toBeGreaterThanOrEqual(0.85);
        expect(s1.assist).toBeGreaterThanOrEqual(0);
        expect(s1.assist).toBeLessThanOrEqual(1);
      }
    });
  }

  it('later worlds give less help than the first one', () => {
    const avg = (stage: (typeof STAGES)[number], key: 'assist' | 'guide') => {
      const rng = mulberry(7);
      let sum = 0;
      const n = shotsFor(stage);
      for (let i = 0; i < n; i++) sum += stage.setupShot({ shotIndex: i, made: 0, streak: 0 }, rng)[key];
      return sum / n;
    };
    const first = STAGES[0];
    const last = STAGES[STAGES.length - 1];
    expect(avg(last, 'assist')).toBeLessThan(avg(first, 'assist'));
    expect(avg(last, 'guide')).toBeLessThan(avg(first, 'guide'));
  });
});
