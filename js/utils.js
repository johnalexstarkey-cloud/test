'use strict';
// utils.js — math & helper functions (global U)

const TAU = Math.PI * 2;

const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  dist: (x0, y0, x1, y1) => Math.hypot(x1 - x0, y1 - y0),
  ang: (x0, y0, x1, y1) => Math.atan2(y1 - y0, x1 - x0),
  // smallest signed difference between two angles, in [-PI, PI]
  adiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  },
  // rand() -> [0,1), rand(a) -> [0,a), rand(a,b) -> [a,b)
  rand: (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a)),
  // random integer in [a, b] inclusive
  ri: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
  chance: (p) => Math.random() < p,
  pick: (arr) => arr[(Math.random() * arr.length) | 0],
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },
  // deterministic pseudo-random in [0,1) from integer coords (tile decor)
  hash2(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = ((h ^ (h >>> 13)) * 1274126177) | 0;
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  },
};
