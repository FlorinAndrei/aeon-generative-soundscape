// Seeded pseudo-random number generator (mulberry32) + seed <-> URL hash helpers.
// A single seeded RNG drives every random decision in the system, so a given seed
// reproduces the entire evolution of a soundscape.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Turn an arbitrary string into a 32-bit integer seed (xfnv1a-ish).
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A short, pronounceable-ish seed token for sharing.
export function randomSeedToken() {
  const n = Math.floor(Math.random() * 0xffffffff) >>> 0;
  return n.toString(36);
}

// Build a small RNG toolkit around a base generator.
export function makeRng(seedToken) {
  const seedInt = hashString(String(seedToken));
  const next = mulberry32(seedInt);
  return {
    seedToken: String(seedToken),
    next, // [0, 1)
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    // Symmetric random walk step in [-amt, amt].
    walk: (amt) => (next() * 2 - 1) * amt,
  };
}
