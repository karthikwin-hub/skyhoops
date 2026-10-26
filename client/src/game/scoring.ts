import type { V3 } from './ballistics';

export const RIM_RADIUS = 0.2286;
export const THREE_POINT_DISTANCE = 6.7;

/**
 * True when the ball centre passes down through the rim plane inside the hoop.
 * Positions are relative to the rim centre at each moment, so moving hoops work too.
 */
export function crossedRim(prevRel: V3, currRel: V3, rimRadius: number, ballRadius: number): boolean {
  if (!(prevRel.y > 0 && currRel.y <= 0)) return false;
  const t = prevRel.y / (prevRel.y - currRel.y);
  const x = prevRel.x + (currRel.x - prevRel.x) * t;
  const z = prevRel.z + (currRel.z - prevRel.z) * t;
  return Math.hypot(x, z) < rimRadius - ballRadius * 0.35;
}

export interface BasketInfo {
  distance: number;
  swish: boolean;
  bank: boolean;
  /** Baskets in a row before this one. */
  streak: number;
  portal?: boolean;
}

export interface PointsResult {
  points: number;
  labels: string[];
  onFire: boolean;
}

export const FIRE_STREAK = 3;

export function computePoints(info: BasketInfo): PointsResult {
  const labels: string[] = [];
  let points = info.distance >= THREE_POINT_DISTANCE ? 3 : 2;
  labels.push(points === 3 ? 'THREE!' : 'BUCKET!');
  if (info.swish) {
    points += 1;
    labels.push('SWISH');
  }
  if (info.bank) {
    points += 1;
    labels.push('BANK');
  }
  if (info.portal) {
    points += 1;
    labels.push('PORTAL');
  }
  const onFire = info.streak + 1 >= FIRE_STREAK;
  if (onFire) {
    points *= 2;
    labels.push('ON FIRE x2');
  }
  return { points, labels, onFire };
}

export function starsFor(score: number, thresholds: readonly [number, number, number]): number {
  let s = 0;
  for (const t of thresholds) if (score >= t) s++;
  return s;
}
