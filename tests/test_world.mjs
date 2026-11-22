// Run: node tests/test_world.mjs
import { World, DIRS } from '../js/world.js';
import { CONFIG } from '../js/config.js';

let failures = 0;
const fail = (m) => { failures++; console.error('FAIL:', m); };

for (let seed = 1; seed <= 300; seed++) {
  const w = new World(seed * 7919);
  const e = w.exitCell;
  const ring = Math.max(Math.abs(e.x), Math.abs(e.z));
  if (ring < CONFIG.exitMinRing || ring > CONFIG.exitMaxRing) fail(`seed ${seed}: exit ring ${ring}`);
  if (w.roomTypeAt(0, 0) === 'Exit') fail(`seed ${seed}: exit at origin`);

  // symmetry
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) for (const d of DIRS) {
    if (w.edgeBlocked(x, z, x + d.dx, z + d.dz) !== w.edgeBlocked(x + d.dx, z + d.dz, x, z)) fail(`seed ${seed}: asymmetric edge`);
  }
  // origin is fully open
  for (const d of DIRS) if (w.edgeBlocked(0, 0, d.dx, d.dz)) fail(`seed ${seed}: origin edge blocked`);

  // BFS from origin inside a box that contains the exit: exit cell must be reachable.
  const B = CONFIG.exitMaxRing + 3;
  const seen = new Set(['0,0']); const q = [[0, 0]];
  while (q.length) {
    const [x, z] = q.shift();
    for (const d of DIRS) {
      const nx = x + d.dx, nz = z + d.dz;
      if (Math.abs(nx) > B || Math.abs(nz) > B || seen.has(nx + ',' + nz)) continue;
      if (w.edgeBlocked(x, z, nx, nz)) continue;
      seen.add(nx + ',' + nz); q.push([nx, nz]);
    }
  }
  if (!seen.has(e.x + ',' + e.z)) fail(`seed ${seed}: exit unreachable`);
  // every cell in the box is reachable (tree guarantee)
  if (seen.size !== (2 * B + 1) ** 2) fail(`seed ${seed}: ${seen.size} reachable of ${(2 * B + 1) ** 2}`);
}

// room-type spread
const w = new World(12345); const counts = {};
for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) { const t = w.roomTypeAt(x, z); counts[t] = (counts[t] || 0) + 1; }
console.log('room type spread:', counts);
let blocked = 0, total = 0;
for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) { total++; if (w.edgeBlocked(x, z, x + 1, z)) blocked++; }
console.log(`+x edges blocked: ${blocked}/${total}`);
console.log(failures ? `${failures} FAILURES` : 'world tests passed');
process.exit(failures ? 1 : 0);
