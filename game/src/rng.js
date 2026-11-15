// rng.js — seeded randomness. Every random draw in the simulation comes
// from one of these streams so a run is deterministic given its seed.
// No Math.random anywhere in the sim (render-only sparkle may use it).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Uniform float in [a, b).
export function range(rng, a, b) { return a + (b - a) * rng(); }
// Integer in [a, b] inclusive.
export function int(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }
// True with probability p.
export function chance(rng, p) { return rng() < p; }
// One element of arr, uniformly.
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
// Fisher-Yates shuffle, in place, seeded.
export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
