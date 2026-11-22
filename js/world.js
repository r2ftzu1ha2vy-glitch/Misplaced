/**
 * world.js — pure, deterministic world generator (no THREE, no DOM).
 *
 * Everything is a function of (seed, cell coordinates), so a cell always
 * looks the same no matter how many times it is unloaded and reloaded.
 *
 * Direction indices used everywhere: 0 = E (+x), 1 = W (-x), 2 = S (+z), 3 = N (-z)
 */
import { CONFIG } from './config.js';

export const DIRS = [
  { name: 'E', dx: 1,  dz: 0 },
  { name: 'W', dx: -1, dz: 0 },
  { name: 'S', dx: 0,  dz: 1 },
  { name: 'N', dx: 0,  dz: -1 },
];

function mix(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic float in [0,1) from a seed, two integers and a salt. */
export function hash(seed, a, b, salt) {
  let h = mix((seed ^ 0x9e3779b9) >>> 0);
  h = mix((h ^ Math.imul(a | 0, 0x27d4eb2d)) >>> 0);
  h = mix((h ^ Math.imul(b | 0, 0x165667b1)) >>> 0);
  h = mix((h ^ Math.imul(salt | 0, 0x85ebca77)) >>> 0);
  return h / 4294967296;
}

/** Local +x of the exit room, rotated by r quarter-turns about Y, points to this direction index. */
const EXIT_ROT_FOR_DIR = { 0: 0, 3: 1, 1: 2, 2: 3 };

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;

    // --- exit cell ---
    const span = CONFIG.exitMaxRing - CONFIG.exitMinRing + 1;
    const R = CONFIG.exitMinRing + Math.floor(hash(this.seed, 0, 0, 101) * span);
    const side = Math.floor(hash(this.seed, 0, 0, 102) * 4);
    const t = Math.floor(hash(this.seed, 0, 0, 103) * (2 * R + 1)) - R;
    this.exitCell =
      side === 0 ? { x: R, z: t } :
      side === 1 ? { x: -R, z: t } :
      side === 2 ? { x: t, z: R } :
                   { x: t, z: -R };

    // --- exit direction: must face a doorway that is not on the guaranteed route ---
    const free = [];
    for (let d = 0; d < 4; d++) {
      const n = DIRS[d];
      if (!this.isTreeEdge(this.exitCell.x, this.exitCell.z, this.exitCell.x + n.dx, this.exitCell.z + n.dz)) free.push(d);
    }
    // A cell always has at least one non-tree edge away from the origin; fall back to 0 defensively.
    this.exitDir = free.length ? free[Math.floor(hash(this.seed, 0, 0, 104) * free.length)] : 0;
    this.exitRot = EXIT_ROT_FOR_DIR[this.exitDir];
  }

  /** The guaranteed route: every cell has one always-open edge towards the origin. */
  parentOf(x, z) {
    if (x === 0 && z === 0) return null;
    if (Math.abs(x) >= Math.abs(z)) return { x: x - Math.sign(x), z };
    return { x, z: z - Math.sign(z) };
  }

  isTreeEdge(ax, az, bx, bz) {
    const pa = this.parentOf(ax, az);
    if (pa && pa.x === bx && pa.z === bz) return true;
    const pb = this.parentOf(bx, bz);
    return !!(pb && pb.x === ax && pb.z === az);
  }

  isExitCell(x, z) { return x === this.exitCell.x && z === this.exitCell.z; }

  /** True if the doorway between a and b is the exit room's exit door. */
  isExitEdge(ax, az, bx, bz) {
    const e = this.exitCell, n = DIRS[this.exitDir];
    const ex = e.x + n.dx, ez = e.z + n.dz;
    return (ax === e.x && az === e.z && bx === ex && bz === ez) ||
           (bx === e.x && bz === e.z && ax === ex && az === ez);
  }

  /** Is the doorway between two adjacent cells blocked (blocker visible + solid)? Symmetric. */
  edgeBlocked(ax, az, bx, bz) {
    if (this.isExitEdge(ax, az, bx, bz)) return true;
    if (this.isTreeEdge(ax, az, bx, bz)) return false;
    // canonical edge id: lower cell + axis (0 = edge on its +x side, 1 = on its +z side)
    let lx, lz, axis;
    if (az === bz) { axis = 0; lx = Math.min(ax, bx); lz = az; }
    else           { axis = 1; lx = ax; lz = Math.min(az, bz); }
    return hash(this.seed, lx, lz, 200 + axis) < CONFIG.blockerChance;
  }

  roomTypeAt(x, z) {
    if (this.isExitCell(x, z)) return 'Exit';
    const list = CONFIG.regularRooms;
    return list[Math.floor(hash(this.seed, x, z, 1) * list.length)];
  }

  /** Quarter-turns (0..3) the room is rotated about Y. */
  rotationAt(x, z) {
    if (this.isExitCell(x, z)) return this.exitRot;
    return Math.floor(hash(this.seed, x, z, 2) * 4);
  }
}
