export type Vec3 = [number, number, number];

/** Cap a throw so a flick can't launch a box across the scene; preserves direction. */
export const MAX_THROW_SPEED = 6;

export function clampThrowVelocity(v: Vec3): Vec3 {
  const speed = Math.hypot(v[0], v[1], v[2]);
  if (speed === 0 || speed <= MAX_THROW_SPEED) return v;
  const k = MAX_THROW_SPEED / speed;
  return [v[0] * k, v[1] * k, v[2] * k];
}
