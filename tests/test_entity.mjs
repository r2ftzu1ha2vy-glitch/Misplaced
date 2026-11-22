// Run: node tests/test_entity.mjs  — headless chase simulation on the real GLBs.
import { register } from 'node:module';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){ if(s==='three') return {url:'${pathToFileURL(root + '/lib/three.module.js')}',shortCircuit:true}; if(s.startsWith('three/addons/')) return {url:'${pathToFileURL(root + '/lib/addons/')}'+s.slice(13),shortCircuit:true}; return n(s,c);}`));
globalThis.self = globalThis;
globalThis.document = { createElementNS: () => { const l = {}; return { addEventListener(t, f) { l[t] = f; }, removeEventListener() {}, set src(v) { setTimeout(() => l.load && l.load({})); }, style: {} }; } };
const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { CONFIG } = await import('../js/config.js');
const { World } = await import('../js/world.js');
const { RoomLibrary, RoomManager } = await import('../js/rooms.js');
const { Entity } = await import('../js/entity.js');

let failures = 0;
const check = (c, m) => { if (!c) { failures++; console.error('FAIL:', m); } else console.log('ok  :', m); };

const lib = new RoomLibrary(); const loader = new GLTFLoader();
for (const [t, f] of Object.entries(CONFIG.roomFiles)) {
  const b = fs.readFileSync(path.join(root, CONFIG.roomDir, f));
  const g = await new Promise((r, j) => loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', r, j));
  lib.register(t, g.scene);
}

for (const seed of [11, 222, 3333, 44444]) {
  const world = new World(seed);
  const scene = new THREE.Scene();
  const rooms = new RoomManager(scene, lib, world);
  rooms.update(0, 0);
  const ent = new Entity(scene, world, rooms);
  check(ent.spawn({ x: 0, z: 0 }), `seed ${seed}: spawns`);
  const d0 = Math.hypot(ent.x, ent.z);
  check(!rooms.isLoaded(Math.round(ent.x / 10), Math.round(ent.z / 10)), `seed ${seed}: spawn is outside the loaded set (${(d0 / 10).toFixed(1)} cells)`);

  // player stands still looking at the ceiling so it can never be "seen"
  const view = { px: 0, pz: 0, cx: 0, cy: 1.8, cz: 0, fx: 0, fy: 1, fz: 0 };
  let t = 0, caught = false, lastSpeed = 0;
  while (t < 240 && !caught) { const r = ent.update(0.05, view); caught = r.caught; t += 0.05; lastSpeed = ent.speed; }
  check(caught, `seed ${seed}: reaches a stationary player in ${t.toFixed(0)}s (speed now ${lastSpeed.toFixed(2)})`);

  // freezing: re-spawn, make it appear in view in a loaded room and look straight at it
  const e2 = new Entity(scene, world, rooms);
  e2.active = true; e2.x = 0; e2.z = -7; // inside the loaded north neighbour
  e2.sinceSpawn = 0;
  const x0 = e2.x, z0 = e2.z;
  let seenAny = false;
  const lookN = { px: 0, pz: 0, cx: 0, cy: 1.8, cz: 0, fx: 0, fy: 0, fz: -1 };
  for (let i = 0; i < 40; i++) { const r = e2.update(0.05, lookN); seenAny ||= r.seen; }
  const wallBetween = rooms.lineBlocked(0, 0, 0, -7);
  if (!wallBetween) { check(seenAny && Math.hypot(e2.x - x0, e2.z - z0) < 0.01, `seed ${seed}: freezes while watched`); }
  else console.log(`seed ${seed}: wall between (north door blocked) — freeze test skipped`);
  scene.remove(ent.group); scene.remove(e2.group);
}
console.log(failures ? `\n${failures} FAILURES` : '\nentity tests passed');
process.exit(failures ? 1 : 0);
