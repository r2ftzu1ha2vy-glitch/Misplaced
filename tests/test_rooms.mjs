// Headless test: loads the real GLBs in Node (image decoding stubbed) and exercises RoomManager.
// Run: node tests/test_rooms.mjs   (needs node >= 18; resolves 'three' via a tiny loader hook below)
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hook = `
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${pathToFileURL(root + '/lib/three.module.js')}', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${pathToFileURL(root + '/lib/addons/')}' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

// --- DOM stubs so GLTFLoader can "decode" textures without a browser ---
globalThis.self = globalThis;
globalThis.document = { createElementNS: () => {
  const l = {}; const el = { addEventListener(t, f) { l[t] = f; }, removeEventListener() {},
    set src(v) { setTimeout(() => l.load && l.load({})); }, style: {} }; return el; } };
globalThis.createImageBitmap = undefined;

const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { CONFIG } = await import('../js/config.js');
const { World, DIRS } = await import('../js/world.js');
const { RoomLibrary, RoomManager } = await import('../js/rooms.js');
const { Player } = await import('../js/player.js');

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };

const lib = new RoomLibrary();
const loader = new GLTFLoader();
for (const [type, file] of Object.entries(CONFIG.roomFiles)) {
  const buf = fs.readFileSync(path.join(root, CONFIG.roomDir, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
  lib.register(type, gltf.scene);
  console.log('parsed', file, 'wallMat:', !!lib.templates.get(type).wallMat);
}

const world = new World(4242);
const scene = new THREE.Scene();
const rm = new RoomManager(scene, lib, world);

rm.update(0, 0);
check(rm.rooms.size === 5, 'start: exactly 5 rooms loaded');
const keys0 = [...rm.rooms.keys()].sort().join('|');
check(keys0 === ['0,0', '1,0', '-1,0', '0,1', '0,-1'].sort().join('|'), 'start: current + E/W/S/N only');

// every room has 4 blockers, exit room has the Exit piece
for (const r of rm.rooms.values()) {
  const bl = r.pieces.filter((p) => p.kind === 'blocker').length;
  const ex = r.pieces.filter((p) => p.kind === 'exit').length;
  check(r.type === 'Exit' ? (bl === 3 && ex === 1) : (bl === 4 && ex === 0), `${r.type}@${r.key}: blockers=${bl} exit=${ex}`);
}

// walk a long way; the loaded set must always be exactly 5 and scene children bounded
let maxChildren = 0;
for (let i = -15; i <= 15; i++) {
  rm.update(i, Math.round(i / 2));
  check(rm.rooms.size === 5, `walk (${i},${Math.round(i / 2)}): 5 rooms`) || 0;
  maxChildren = Math.max(maxChildren, scene.children.length);
}
check(maxChildren <= 5 + 5, `scene children stay bounded (max ${maxChildren})`);

// edge consistency: for every pair of loaded neighbours, blocker visibility must agree with world and be drawn once
rm.update(2, 3);
const cur = rm.rooms.get('2,3');
for (const d of DIRS) {
  const nb = rm.rooms.get(`${2 + d.dx},${3 + d.dz}`);
  const blocked = world.edgeBlocked(2, 3, 2 + d.dx, 3 + d.dz);
  const a = cur.pieces.filter((p) => p.kind === 'blocker' && p.edge === DIRS.indexOf(d))[0];
  const bIdx = DIRS.findIndex((q) => q.dx === -d.dx && q.dz === -d.dz);
  const b = nb.pieces.filter((p) => p.kind === 'blocker' && p.edge === bIdx)[0];
  if (nb.type === 'Exit') continue;
  check(a.blocked === blocked && b.blocked === blocked, `edge ${d.name}: blocked=${blocked} agrees both sides`);
  if (blocked) check(a.mesh.visible !== b.mesh.visible, `edge ${d.name}: blocker drawn by exactly one room`);
  const wa = cur.pieces.filter((p) => p.kind === 'wall' && p.edge === DIRS.indexOf(d));
  const wb = nb.pieces.filter((p) => p.kind === 'wall' && p.edge === bIdx);
  const va = wa.filter((p) => p.mesh.visible).length, vb = wb.filter((p) => p.mesh.visible).length;
  check((va === 0) !== (vb === 0), `edge ${d.name}: wall slabs drawn by exactly one room (${va}/${vb})`);
}

// collision: visible blocker stops the player, hidden one doesn't
const camera = new THREE.PerspectiveCamera();
globalThis.addEventListener = () => {};
const player = new Player(camera);
let tested = 0;
for (let tries = 0; tries < 40 && tested < 2; tries++) {
  const cx = tries, cz = -tries;
  rm.update(cx, cz);
  const room = rm.rooms.get(`${cx},${cz}`);
  for (const p of room.pieces.filter((q) => q.kind === 'blocker')) {
    const d = DIRS[p.edge];
    const vis = p.mesh.visible;
    // stand in the doorway centre, 1.5 m inside, walk towards the doorway
    player.pos.set(cx * 10 - d.dx * 0 , CONFIG.floorY, cz * 10);
    player.pos.x = cx * 10 + d.dx * 3.5; player.pos.z = cz * 10 + d.dz * 3.5;
    player.vel.set(0, 0);
    player.enabled = true; player.yaw = 0;
    const target = { x: cx * 10 + d.dx * 7, z: cz * 10 + d.dz * 7 };
    // direct movement through the collision resolver
    for (let s = 0; s < 80; s++) {
      player.pos.x += (target.x - player.pos.x) * 0.05; player.pos.z += (target.z - player.pos.z) * 0.05;
      rm.collectSolids(player.pos.x, player.pos.z, 1, player.solids);
      Player.resolve(player.pos, CONFIG.player.radius, player.solids);
    }
    const crossed = d.dx ? Math.abs(player.pos.x - cx * 10) > 5 : Math.abs(player.pos.z - cz * 10) > 5;
    if (p.forced) continue;
    // Doorway might also be obstructed by furniture; only assert the blocked direction strictly.
    if (vis) { check(!crossed, `${room.type}@${room.key} ${d.name}: visible blocker stops player`); tested++; }
    else if (crossed) { check(true, `${room.type}@${room.key} ${d.name}: open doorway passable`); tested++; }
  }
}

// exit trigger
const ex = world.exitCell;
rm.update(ex.x, ex.z);
const eroom = rm.rooms.get(`${ex.x},${ex.z}`);
const eb = eroom.exitBox;
const ec = eb.getCenter(new THREE.Vector3());
check(rm.touchingExit(ec.x, ec.z, 0.1), 'standing in exit door triggers win');
check(!rm.touchingExit(ex.x * 10, ex.z * 10, 0.1), 'room centre does not trigger win');
const ed = DIRS[world.exitDir];
check(Math.sign(ec.x - ex.x * 10) === ed.dx && Math.sign(ec.z - ex.z * 10) === ed.dz, `exit panel faces world exit dir ${ed.name}`);

// spawn spot is clear
rm.update(0, 0);
player.placeNear(0, 0, rm);
rm.collectSolids(player.pos.x, player.pos.z, 5, player.solids);
check(Player.clear(player.pos.x, player.pos.z, CONFIG.player.radius, player.solids), `spawn (${player.pos.x.toFixed(1)}, ${player.pos.z.toFixed(1)}) is clear`);

// solids summary per template
for (const r of [...rm.rooms.values()]) console.log(`${r.type}@${r.key}: pieces=${r.pieces.length} solids=${r.solids.length}`);

console.log(failures ? `\n${failures} FAILURES` : '\nroom tests passed');
process.exit(failures ? 1 : 0);
