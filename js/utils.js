/**
 * utils.js — small shared helpers. No external deps.
 */

const Utils = {
  clamp(v, min, max) { return Math.max(min, Math.min(max, v)); },

  lerp(a, b, t) { return a + (b - a) * t; },

  // Frame-rate independent damping lerp (Freya Holmer style)
  damp(a, b, lambda, dt) {
    return Utils.lerp(a, b, 1 - Math.exp(-lambda * dt));
  },

  randRange(min, max) { return min + Math.random() * (max - min); },

  randSign() { return Math.random() < 0.5 ? -1 : 1; },

  // Simple seeded-ish pseudo-random for reproducible flicker patterns per light
  hashSeed(x) {
    let s = Math.sin(x * 999.123) * 43758.5453;
    return s - Math.floor(s);
  },

  logError(msg) {
    const el = document.getElementById("errorlog");
    if (!el) return;
    el.style.display = "block";
    const line = document.createElement("div");
    line.textContent = "• " + msg;
    el.appendChild(line);
    console.error("[MISPLACED]", msg);
  },

  logInfo(msg) {
    console.log("[MISPLACED]", msg);
  },

  // Deterministic string/int hash -> 32-bit seed, so a given tile
  // coordinate always produces the same room contents.
  seedFromCoords(x, z) {
    let h = 2166136261 ^ (x * 374761393) ^ (z * 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return h >>> 0;
  },

  // Tiny mulberry32 PRNG — returns a function you call repeatedly for
  // deterministic pseudo-random floats in [0, 1).
  makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
};
