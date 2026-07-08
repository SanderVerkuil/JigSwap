import { describe, expect, test } from "vitest";
import { reconcileBodyRefs } from "./body-refs";

// Regression: @react-three/rapier's RigidBody writes the forwarded ref ONCE, at
// body creation. If the refs array is rebuilt with fresh objects when the box
// count changes, every already-mounted RigidBody is left holding a ref that is
// permanently null — its box still collides but can never be grabbed again
// (onPointerDown early-returns on the null body). Surviving indexes must
// therefore keep their EXACT ref objects; only new indexes get fresh refs.
describe("reconcileBodyRefs", () => {
  test("growing preserves the existing ref objects by identity", () => {
    const prev = reconcileBodyRefs<string>([], 3);
    prev[0]!.current = "body-0";
    const next = reconcileBodyRefs(prev, 5);
    expect(next).toHaveLength(5);
    expect(next[0]).toBe(prev[0]);
    expect(next[1]).toBe(prev[1]);
    expect(next[2]).toBe(prev[2]);
    expect(next[0]!.current).toBe("body-0");
  });

  test("growing mints fresh null refs for the new indexes only", () => {
    const prev = reconcileBodyRefs<string>([], 2);
    const next = reconcileBodyRefs(prev, 4);
    expect(next[2]!.current).toBeNull();
    expect(next[3]!.current).toBeNull();
    expect(next[2]).not.toBe(next[3]);
    expect(prev).not.toContain(next[2]);
  });

  test("shrinking keeps the surviving prefix by identity", () => {
    const prev = reconcileBodyRefs<string>([], 4);
    const next = reconcileBodyRefs(prev, 2);
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(prev[0]);
    expect(next[1]).toBe(prev[1]);
  });

  test("same count returns refs with identical identity", () => {
    const prev = reconcileBodyRefs<string>([], 3);
    const next = reconcileBodyRefs(prev, 3);
    expect(next.map((ref) => ref)).toEqual(prev.map((ref) => ref));
    next.forEach((ref, i) => expect(ref).toBe(prev[i]));
  });
});
