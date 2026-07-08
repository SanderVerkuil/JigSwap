import * as React from "react";

// @react-three/rapier's RigidBody writes the forwarded ref exactly once, when
// the physics body is created (its useForwardedRef only backfills a NEW ref
// object from an internal ref that never held the body). A ref object handed
// to an already-mounted RigidBody therefore stays null forever. When the box
// count changes, surviving indexes MUST keep their original ref objects —
// only new indexes may get fresh refs.
export function reconcileBodyRefs<T>(
  prev: React.RefObject<T | null>[],
  count: number,
): React.RefObject<T | null>[] {
  return Array.from(
    { length: count },
    (_, i) => prev[i] ?? React.createRef<T>(),
  );
}
