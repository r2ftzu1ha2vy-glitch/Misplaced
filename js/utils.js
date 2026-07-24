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
};
