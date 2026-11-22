/**
 * rooms.js — loads the room GLBs once, then streams room instances in and out.
 *
 * Streaming rule: only the cell the player is in plus its four neighbours
 * (left, right, front, back) exist in the scene. Everything else is removed.
 * Templates stay cached in memory so re-entering a cell is just a clone.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';
import { DIRS } from './world.js';

const S = CONFIG.cellSize;
const key = (x, z) => x + ',' + z;

function edgeIndex(dx, dz) {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 0 : 1;
  return dz > 0 ? 2 : 3;
}

/** Cell `a` owns the shared wall with `b` if it sorts first. Only the owner draws it. */
function owns(a, b) {
  return a.cx < b.cx || (a.cx === b.cx && a.cz < b.cz);
}

/** 2D segment vs AABB (XZ plane), slab method. */
function segHitsBox(ax, az, bx, bz, b) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  if (Math.abs(dx) < 1e-9) { if (ax < b.min.x || ax > b.max.x) return false; }
  else {
    let u = (b.min.x - ax) / dx, v = (b.max.x - ax) / dx;
    if (u > v) { const t = u; u = v; v = t; }
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (az < b.min.z || az > b.max.z) return false; }
  else {
    let u = (b.min.z - az) / dz, v = (b.max.z - az) / dz;
    if (u > v) { const t = u; u = v; v = t; }
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  return true;
}

export class RoomLibrary {
  constructor() {
    this.templates = new Map(); // type -> { scene, wallMat }
  }

  async loadAll(onProgress = () => {}) {
    const loader = new GLTFLoader();
    const entries = Object.entries(CONFIG.roomFiles);
    for (let i = 0; i < entries.length; i++) {
      const [type, file] = entries[i];
      const gltf = await new Promise((resolve, reject) => {
        loader.load(
          CONFIG.roomDir + file,
          resolve,
          (ev) => {
            const f = ev.lengthComputable && ev.total > 0 ? ev.loaded / ev.total : 0;
            onProgress((i + f) / entries.length, `Loading ${file}`);
          },
          (err) => reject(new Error(`Failed to load ${CONFIG.roomDir + file}: ${err && err.message ? err.message : err}`))
        );
      });
      this.register(type, gltf.scene);
      onProgress((i + 1) / entries.length, `Loaded ${file}`);
    }
  }

  /** Register an already-parsed scene (also used by the headless tests). */
  register(type, scene) {
    let wallMat = null;
    scene.traverse((o) => {
      if (!wallMat && o.isMesh && o.name.startsWith('Cube_')) wallMat = o.material;
    });
    this.templates.set(type, { scene, wallMat });
  }
}

export class RoomManager {
  /**
   * @param {THREE.Scene} scene
   * @param {RoomLibrary} library
   * @param {import('./world.js').World} world
   */
  constructor(scene, library, world) {
    this.scene = scene;
    this.library = library;
    this.world = world;
    this.rooms = new Map();      // "x,z" -> room
    this.cell = { x: NaN, z: NaN };

    // Fixed pool of lights (a constant light count avoids shader recompiles).
    this.lights = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(CONFIG.lighting.pointColor, 0, CONFIG.lighting.pointDistance, 2);
      scene.add(l);
      this.lights.push({ light: l, room: null, base: 0, flickerUntil: 0, nextFlicker: 3 + Math.random() * 8, outUntil: 0, wasOut: false });
    }
    this.nextBlackout = 25 + Math.random() * 20;
  }

  /** Cell coordinates containing a world position. */
  static cellOf(x, z) {
    return { x: Math.floor(x / S + 0.5), z: Math.floor(z / S + 0.5) };
  }

  /** Load/unload so exactly {current, E, W, S, N} exist. Returns true if the set changed. */
  update(cx, cz) {
    if (cx === this.cell.x && cz === this.cell.z) return false;
    this.cell = { x: cx, z: cz };

    const wanted = new Map([[key(cx, cz), [cx, cz]]]);
    for (const d of DIRS) wanted.set(key(cx + d.dx, cz + d.dz), [cx + d.dx, cz + d.dz]);

    for (const [k, room] of this.rooms) {
      if (!wanted.has(k)) this.unload(k, room);
    }
    for (const [k, [x, z]] of wanted) {
      if (!this.rooms.has(k)) this.rooms.set(k, this.build(x, z));
    }

    for (const room of this.rooms.values()) this.refreshVisibility(room);
    this.assignLights();
    return true;
  }

  unload(k, room) {
    this.scene.remove(room.root);
    // Geometry/materials/textures are shared with the cached template: never dispose them here.
    room.root.clear();
    this.rooms.delete(k);
    for (const s of this.lights) if (s.room === room) { s.room = null; s.light.intensity = 0; }
  }

  build(cx, cz) {
    const type = this.world.roomTypeAt(cx, cz);
    const rotQ = this.world.rotationAt(cx, cz);
    const tpl = this.library.templates.get(type);
    if (!tpl) throw new Error(`No template loaded for room type "${type}"`);

    const root = new THREE.Group();
    root.name = `cell_${cx}_${cz}_${type}`;
    root.position.set(cx * S, 0, cz * S);
    root.rotation.y = rotQ * Math.PI / 2;
    const model = tpl.scene.clone(true);
    root.add(model);
    this.scene.add(root);
    root.updateMatrixWorld(true);

    const room = { key: key(cx, cz), cx, cz, type, rotQ, root, pieces: [], solids: [], exitBox: null };
    const wx = cx * S, wz = cz * S;
    const floorTop = CONFIG.floorY;
    const bandLo = floorTop + 0.3, bandHi = floorTop + 1.9;

    model.traverse((o) => {
      if (!o.isMesh) return;
      const box = new THREE.Box3().setFromObject(o);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const ldx = c.x - wx, ldz = c.z - wz;
      const name = o.name;

      let kind = 'prop';
      let edge = -1;
      // GLTFLoader de-duplicates node names ("Blocker", "Blocker_1", ...), so match with a pattern.
      if (/^Blocker(_\d+)?$/.test(name)) kind = 'blocker';
      else if (/^Exit(_\d+)?$/.test(name)) kind = 'exit';
      else if (name.startsWith('Cube')) kind = 'shell';

      if (kind === 'blocker' || kind === 'exit' || kind === 'shell') {
        if (Math.abs(ldx) > S / 2 - 0.5 || Math.abs(ldz) > S / 2 - 0.5) {
          edge = edgeIndex(ldx, ldz);
          if (kind === 'shell') kind = 'wall';
        }
      }

      const piece = { mesh: o, box, kind, edge, blocked: false, forced: false, nx: 0, nz: 0, show: true, culled: false };
      if (edge >= 0) {
        piece.nx = cx + DIRS[edge].dx;
        piece.nz = cz + DIRS[edge].dz;
      }

      if (kind === 'blocker') {
        piece.blocked = this.world.edgeBlocked(cx, cz, piece.nx, piece.nz);
        piece.forced = this.world.isExitEdge(cx, cz, piece.nx, piece.nz);
        if (piece.blocked) {
          // the blocker's own material is fully transparent: swap in the room's wall material
          o.material = tpl.wallMat || new THREE.MeshStandardMaterial({ color: 0xb8aa6a, roughness: 0.9 });
          if (piece.forced) {
            // The exit door panel sits on this exact plane: nudge the blocker 3 cm into this room.
            const inward = new THREE.Vector3(-DIRS[edge].dx, 0, -DIRS[edge].dz)
              .applyQuaternion(root.quaternion.clone().invert());
            o.position.addScaledVector(inward, 0.03);
            o.updateMatrix();
            root.updateMatrixWorld(true);
            piece.box = new THREE.Box3().setFromObject(o);
          }
        }
        o.visible = piece.blocked;
        piece.show = piece.blocked;
      }

      room.pieces.push(piece);

      if (kind === 'exit') {
        room.exitBox = piece.box;
        return;
      }
      if (kind === 'shell') return; // floor + ceiling

      // collision candidates (vertical band test also rejects lintels, floor and ceiling)
      const inBand = piece.box.max.y > bandLo && piece.box.min.y < bandHi;
      if (!inBand) return;
      if (kind === 'prop') {
        if (!CONFIG.collideFurniture) return;
        if (size.x < CONFIG.minPropSize && size.z < CONFIG.minPropSize) return;
      }
      room.solids.push(piece);
    });

    // static geometry: no per-frame matrix recomputation
    model.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
    root.updateMatrixWorld(true);

    return room;
  }

  /** Decide which wall/blocker slabs are drawn: shared walls are drawn by one room only. */
  refreshVisibility(room) {
    for (const p of room.pieces) {
      if (p.edge < 0 || p.kind === 'exit') continue;
      let show = p.kind === 'blocker' ? p.blocked : true;
      if (show && !p.forced) {
        const n = this.rooms.get(key(p.nx, p.nz));
        if (n && owns(n, room)) show = false;
      }
      p.show = show;
      p.mesh.visible = show && !p.culled;
    }
  }

  /**
   * Distance culling. Anything whose nearest point is beyond `range` metres from (x,z) is
   * completely swallowed by fog, so not drawing it is lossless. `show` (logical visibility,
   * used by collision / line of sight) is never changed here, only the render flag.
   */
  cull(x, z, range) {
    const r2 = range * range;
    for (const room of this.rooms.values()) {
      for (const p of room.pieces) {
        const b = p.box;
        const dx = x < b.min.x ? b.min.x - x : x > b.max.x ? x - b.max.x : 0;
        const dz = z < b.min.z ? b.min.z - z : z > b.max.z ? z - b.max.z : 0;
        const culled = dx * dx + dz * dz > r2;
        if (culled !== p.culled) {
          p.culled = culled;
          p.mesh.visible = p.show && !culled;
        }
      }
    }
  }

  /** Upload every texture to the GPU and compile every material once, so nothing hitches mid-game. */
  prewarm(renderer, camera, onProgress = () => {}) {
    const seen = new Set();
    const texKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'];
    const tpls = [...this.library.templates.values()];
    tpls.forEach((tpl, i) => {
      this.scene.add(tpl.scene);
      tpl.scene.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) for (const k of texKeys) {
          const t = m && m[k];
          if (t && !seen.has(t)) { seen.add(t); renderer.initTexture(t); }
        }
      });
      renderer.compile(this.scene, camera);
      this.scene.remove(tpl.scene);
      onProgress((i + 1) / tpls.length, 'Preparing rooms');
    });
  }

  assignLights() {
    const used = new Set();
    for (const s of this.lights) if (s.room && this.rooms.get(s.room.key) === s.room) used.add(s.room);
    for (const room of this.rooms.values()) {
      if (used.has(room)) continue;
      const slot = this.lights.find((s) => !s.room);
      if (!slot) break;
      slot.room = room;
      const L = CONFIG.lighting;
      const isExit = room.type === 'Exit';
      slot.light.color.setHex(isExit ? L.exitColor : L.pointColor);
      slot.base = isExit ? L.exitIntensity : L.pointIntensity;
      slot.light.position.set(room.cx * S, L.pointHeight, room.cz * S);
      slot.light.intensity = slot.base;
      used.add(room);
    }
  }

  /**
   * Fluorescent flicker, random room blackouts, and dread-driven instability.
   * hooks: { onFlicker(), onBlackout(), onRestore() } (all optional).
   */
  updateLights(t, fear = 0, hooks = {}) {
    if (!CONFIG.lighting.flicker) return;
    const L = CONFIG.lighting;

    if (t > this.nextBlackout) {
      const live = this.lights.filter((s) => s.room && s.room.type !== 'Exit' && t > s.outUntil);
      if (live.length) {
        const s = live[Math.floor(Math.random() * live.length)];
        s.outUntil = t + 3 + Math.random() * 6;
        if (hooks.onBlackout) hooks.onBlackout();
      }
      this.nextBlackout = t + (L.blackoutEveryMin + Math.random() * L.blackoutEveryExtra) * (1 - 0.6 * fear);
    }

    for (const s of this.lights) {
      if (!s.room) continue;
      if (t < s.outUntil) {
        s.wasOut = true;
        s.light.intensity = Math.random() < 0.03 ? s.base * 0.25 : 0;
        continue;
      }
      if (s.wasOut) { s.wasOut = false; s.light.intensity = s.base; if (hooks.onRestore) hooks.onRestore(); }

      if (t > s.nextFlicker) {
        s.flickerUntil = t + 0.06 + Math.random() * (0.3 + fear * 0.9);
        s.nextFlicker = t + (2 + Math.random() * 11) * (1 - 0.85 * fear);
        if (hooks.onFlicker) hooks.onFlicker();
      }
      if (t < s.flickerUntil) s.light.intensity = s.base * (Math.random() < 0.55 ? Math.random() * 0.45 : 1);
      else s.light.intensity = s.base;
    }
  }

  /** Kill every ceiling light for `seconds` (the exit room stays lit). */
  blackoutAll(t, seconds) {
    for (const s of this.lights) if (s.room && s.room.type !== 'Exit') s.outUntil = t + seconds;
  }

  isLoaded(cx, cz) { return this.rooms.has(key(cx, cz)); }

  /** True if a visible wall/blocker crosses the segment (a)->(b) at eye height. */
  lineBlocked(ax, az, bx, bz) {
    for (const room of this.rooms.values()) {
      for (const p of room.pieces) {
        if (p.edge < 0 || (p.kind !== 'wall' && p.kind !== 'blocker') || !p.show) continue;
        const b = p.box;
        if (b.max.y < 1.0 || b.min.y > 1.7) continue;
        if (segHitsBox(ax, az, bx, bz, b)) return true;
      }
    }
    return false;
  }

  /** All collision boxes currently active near (x,z). */
  collectSolids(x, z, reach, out) {
    out.length = 0;
    for (const room of this.rooms.values()) {
      for (const p of room.solids) {
        if (!p.show) continue;
        const b = p.box;
        if (x < b.min.x - reach || x > b.max.x + reach || z < b.min.z - reach || z > b.max.z + reach) continue;
        out.push(b);
      }
    }
    return out;
  }

  /** True if (x,z) is inside the exit door panel (with a small margin). */
  touchingExit(x, z, margin) {
    for (const room of this.rooms.values()) {
      const b = room.exitBox;
      if (b && x > b.min.x - margin && x < b.max.x + margin && z > b.min.z - margin && z < b.max.z + margin) return true;
    }
    return false;
  }
}
