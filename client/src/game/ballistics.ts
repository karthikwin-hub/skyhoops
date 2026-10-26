export const EARTH_G = 9.81;
/** Steep enough that a perfect shot drops cleanly through the rim from hand height. */
export const LAUNCH_ANGLE = (60 * Math.PI) / 180;

export type V3 = { x: number; y: number; z: number };

/**
 * Launch speed needed to travel horizontal distance `d` while rising `h`,
 * at a fixed launch angle. Returns null when the target is unreachable at that angle.
 */
export function solveLaunchSpeed(d: number, h: number, g: number, angle = LAUNCH_ANGLE): number | null {
  const c = Math.cos(angle);
  const denom = 2 * c * c * (d * Math.tan(angle) - h);
  if (denom <= 0 || d <= 0) return null;
  return Math.sqrt((g * d * d) / denom);
}

/** A finished swipe, normalised by screen height. dy > 0 means the finger moved up. */
export interface Gesture {
  dx: number;
  dy: number;
  /** Signed sideways bulge of the swipe path relative to its length (-1..1). */
  curve: number;
}

export interface ShotTuning {
  /** Swipe length (fraction of screen height) that produces `maxDistance`. */
  fullSwipe: number;
  /** Earth distance in metres reached with a full swipe. */
  maxDistance: number;
  /** 0 = no help, 1 = every shot inside the window is perfect. */
  assist: number;
  /** Relative speed error inside which assist kicks in. */
  assistWindow: number;
  /** How strongly sideways swipe angle turns the shot. */
  yawScale: number;
}

export const DEFAULT_TUNING: ShotTuning = {
  fullSwipe: 0.55,
  maxDistance: 11,
  assist: 0.5,
  assistWindow: 0.16,
  yawScale: 0.55,
};

export interface AimContext {
  from: V3;
  /** Direction the shooter is facing; a straight-up swipe goes this way. */
  facing: V3;
  /** Where a perfect shot should go (the rim, or a portal's virtual rim). */
  ideal: V3;
  /** Gravity of the stage, used to work out what "perfect" means. */
  g: number;
}

export interface ShotResult {
  velocity: V3;
  /** Spin around the vertical axis in rad/s (curves the ball sideways). */
  sideSpin: number;
  power: number;
}

export const MIN_SWIPE = 0.035;

/** Swipe strength 0..~1.2 from the gesture. */
export function gesturePower(g: Gesture, tuning: ShotTuning = DEFAULT_TUNING): number {
  return Math.min(1.25, Math.max(0, g.dy) / tuning.fullSwipe);
}

/**
 * Turns a swipe into a launch velocity. Power maps to an "Earth distance", so on low gravity
 * worlds the same swipe flies much further. Assist gently pulls near-misses toward the ideal.
 */
export function gestureToShot(gesture: Gesture, ctx: AimContext, tuning: ShotTuning = DEFAULT_TUNING): ShotResult | null {
  if (gesture.dy < MIN_SWIPE) return null;
  const power = gesturePower(gesture, tuning);
  const reachDistance = Math.max(0.6, power * tuning.maxDistance);
  let speed = solveLaunchSpeed(reachDistance, 0, EARTH_G) ?? 0;

  const facingYaw = Math.atan2(ctx.facing.x, ctx.facing.z);
  // Yaw grows counter-clockwise seen from above, so a swipe to the right lowers it.
  let yaw = facingYaw - Math.atan2(gesture.dx, gesture.dy) * tuning.yawScale;

  const ix = ctx.ideal.x - ctx.from.x;
  const iz = ctx.ideal.z - ctx.from.z;
  const idealD = Math.hypot(ix, iz);
  const idealSpeed = solveLaunchSpeed(idealD, ctx.ideal.y - ctx.from.y, ctx.g);
  const idealYaw = Math.atan2(ix, iz);

  if (idealSpeed && tuning.assist > 0) {
    if (Math.abs(speed - idealSpeed) / idealSpeed < tuning.assistWindow) {
      speed += (idealSpeed - speed) * tuning.assist;
    }
    const dyaw = wrapAngle(idealYaw - yaw);
    if (Math.abs(dyaw) < 0.16) yaw += dyaw * tuning.assist;
  }

  const horiz = speed * Math.cos(LAUNCH_ANGLE);
  return {
    velocity: { x: Math.sin(yaw) * horiz, y: speed * Math.sin(LAUNCH_ANGLE), z: Math.cos(yaw) * horiz },
    sideSpin: Math.max(-1, Math.min(1, gesture.curve * 4)) * 9 * (1 - tuning.assist * 0.5),
    power,
  };
}

/** The perfect shot for a given context, used by the attract-mode shooter and tests. */
export function idealShot(ctx: AimContext): V3 | null {
  const ix = ctx.ideal.x - ctx.from.x;
  const iz = ctx.ideal.z - ctx.from.z;
  const speed = solveLaunchSpeed(Math.hypot(ix, iz), ctx.ideal.y - ctx.from.y, ctx.g);
  if (!speed) return null;
  const yaw = Math.atan2(ix, iz);
  const horiz = speed * Math.cos(LAUNCH_ANGLE);
  return { x: Math.sin(yaw) * horiz, y: speed * Math.sin(LAUNCH_ANGLE), z: Math.cos(yaw) * horiz };
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export interface Point2 {
  x: number;
  y: number;
}

/**
 * Builds a gesture from raw pointer samples (pixels, y down).
 * Uses the whole path for length, and the path's bulge for curve.
 */
export function gestureFromPath(path: Point2[], screenHeight: number): Gesture {
  if (path.length < 2) return { dx: 0, dy: 0, curve: 0 };
  const a = path[0];
  const b = path[path.length - 1];
  const dx = (b.x - a.x) / screenHeight;
  const dy = (a.y - b.y) / screenHeight;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  let bulge = 0;
  if (len > 1) {
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    for (const p of path) {
      const d = (p.x - a.x) * nx + (p.y - a.y) * ny;
      if (Math.abs(d) > Math.abs(bulge)) bulge = d;
    }
  }
  return { dx, dy, curve: len > 1 ? bulge / len : 0 };
}
