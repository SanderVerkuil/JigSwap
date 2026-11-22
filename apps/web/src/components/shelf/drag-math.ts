export type Vec3 = [number, number, number];

/**
 * Cap a throw so a flick can't launch a box across the scene; preserves direction. In world units
 * per second (100 CSS px a unit): about seven 1,000-piece boxes' widths a second.
 */
export const MAX_THROW_SPEED = 11;

export function clampThrowVelocity(v: Vec3): Vec3 {
  const speed = Math.hypot(v[0], v[1], v[2]);
  if (speed === 0 || speed <= MAX_THROW_SPEED) return v;
  const k = MAX_THROW_SPEED / speed;
  return [v[0] * k, v[1] * k, v[2] * k];
}

/** A pointer that stopped longer than this before letting go was putting the box down. */
export const THROW_MAX_PAUSE_MS = 80;

export interface DragSample {
  p: { x: number; y: number; z: number };
  /** The pointer event's timeStamp, in ms. */
  t: number;
}

/**
 * The velocity a held box leaves with when let go at `releasedAt` (the same clock as the
 * samples): from its last two positions, capped by clampThrowVelocity, if the pointer was
 * still moving then; else none. Pure.
 */
export function releaseVelocity(
  samples: readonly DragSample[],
  releasedAt: number,
): Vec3 {
  const [a, b] = samples.slice(-2);
  if (!a || !b || releasedAt - b.t > THROW_MAX_PAUSE_MS) return [0, 0, 0];
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0) return [0, 0, 0];
  return clampThrowVelocity([
    (b.p.x - a.p.x) / dt,
    (b.p.y - a.p.y) / dt,
    (b.p.z - a.p.z) / dt,
  ]);
}
