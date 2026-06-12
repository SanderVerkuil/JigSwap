// Shared seedable-PRNG and partial-shuffle helpers used by insights queries that
// need deterministic, seed-stable random sampling without a full array sort.

// mulberry32 — a tiny, fast, seedable 32-bit PRNG (public domain). Returns a
// generator function that produces the next float in [0, 1) on each call.
// Deterministic per seed so Convex's reactivity model is satisfied (same
// inputs → same output for a given DB state).
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

// Partial Fisher-Yates: shuffle only the first `limit` slots so we pay O(limit)
// not O(n). Mutates `arr` in-place and returns it for convenience.
export function partialShuffle<T>(
  arr: T[],
  limit: number,
  rand: () => number,
): T[] {
  const n = arr.length;
  const picks = Math.min(limit, n);
  for (let i = 0; i < picks; i++) {
    const j = i + Math.floor(rand() * (n - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
