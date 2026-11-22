/**
 * entity.js — "It". Walks the open doorways towards you, freezes while you look at it,
 * speeds up the longer you survive. Pure logic works on plain numbers so it can be tested headless.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';

const S = CONFIG.cellSize;
const cellOf = (x, z) => ({ x: Math.floor(x / S + 0.5), z: Math.floor(z / S + 0.5) });

function buildBody() {
  const skin = new THREE.MeshStandardMaterial({ color: 0x1b1a18, roughness: 0.95, metalness: 0 });
  const pale = new THREE.MeshStandardMaterial({ color: 0xcfc9b6, roughness: 0.9, metalness: 0 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, fog: false });
  const g = new THREE.Group();
  g.name = 'Entity';

  const limb = (len, r0, r1, mat) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, 8), mat);
    m.position.y = -len / 2; // hangs from its pivot
    const pivot = new THREE.Group();
    pivot.add(m);
    return pivot;
  };

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.95, 10), skin);
  torso.position.y = 1.45;
  g.add(torso);
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.2, 10), skin);
  hips.position.y = 0.92;
  g.add(hips);

  const legL = limb(0.95, 0.06, 0.035, skin); legL.position.set(-0.09, 0.92, 0);
  const legR = limb(0.95, 0.06, 0.035, skin); legR.position.set(0.09, 0.92, 0);
  const armL = limb(1.45, 0.045, 0.03, skin); armL.position.set(-0.24, 1.88, 0);
  const armR = limb(1.45, 0.045, 0.03, skin); armR.position.set(0.24, 1.88, 0);
  g.add(legL, legR, armL, armR);

  const head = new THREE.Group();
  head.position.set(0, 2.0, 0.02);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), pale);
  skull.scale.set(0.85, 1.35, 0.95);
  head.add(skull);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeMat); eyeL.position.set(-0.055, 0.04, 0.145);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.055;
  head.add(eyeL, eyeR);
  g.add(head);

  g.userData = { legL, legR, armL, armR, head, torso };
  return g;
}

export class Entity {
  constructor(scene, world, rooms) {
    this.scene = scene;
    this.world = world;
    this.rooms = rooms;
    this.group = buildBody();
    this.group.visible = false;
    scene.add(this.group);

    this.active = false;
    this.x = 0; this.z = 0;
    this.sinceSpawn = 0;
    this.pathTimer = 0;
    this.step = null;
    this.seen = false;
    this.everSeen = false;
    this.seenTimer = 0;
    this.walk = 0;
    this.heading = 0;
    this.t = 0;
  }

  /** Put it `depth` doorways away along open routes (never inside a loaded room). */
  placeAtDepth(from, depth) {
    let cells = [];
    for (let d = depth; d >= 3 && !cells.length; d--) cells = this.world.cellsAtDepth(from, d);
    if (!cells.length) return false;
    const c = cells[Math.floor(Math.random() * cells.length)];
    this.x = c.x * S; this.z = c.z * S;
    this.step = null; this.pathTimer = 0;
    return true;
  }

  spawn(playerCell) {
    if (!this.placeAtDepth(playerCell, CONFIG.entity.spawnDepth)) return false;
    this.active = true;
    this.sinceSpawn = 0;
    return true;
  }

  get speed() {
    const E = CONFIG.entity;
    return Math.min(E.maxSpeed, E.baseSpeed + E.rampPerMinute * (this.sinceSpawn / 60));
  }

  /**
   * @param {number} dt
   * @param {{px:number,pz:number,cx:number,cy:number,cz:number,fx:number,fy:number,fz:number}} v  player + camera state
   * @param {{onFirstSight?:Function, onStare?:Function}} hooks
   * @returns {{active:boolean, fear:number, seen:boolean, caught:boolean, dist:number}}
   */
  update(dt, v, hooks = {}) {
    if (!this.active) return { active: false, fear: 0, seen: false, caught: false, dist: Infinity };
    const E = CONFIG.entity;
    this.t += dt;
    this.sinceSpawn += dt;

    const pc = cellOf(v.px, v.pz);
    const myCell = cellOf(this.x, this.z);
    const loaded = this.rooms.isLoaded(myCell.x, myCell.z);

    // --- route ---
    this.pathTimer -= dt;
    if (this.pathTimer <= 0 || !this.step) {
      this.pathTimer = 0.4;
      if (myCell.x === pc.x && myCell.z === pc.z) this.step = null;
      else {
        this.step = this.world.nextStep(myCell, pc, 16);
        if (!this.step) { this.placeAtDepth(pc, E.relocateDepth); return this.report(v, false); }
      }
    }

    // --- is it being looked at? ---
    let seen = false;
    if (loaded) {
      const dx = this.x - v.cx, dy = 1.3 - v.cy, dz = this.z - v.cz;
      const d3 = Math.hypot(dx, dy, dz);
      if (d3 < 30 && d3 > 0.01) {
        const dot = (dx * v.fx + dy * v.fy + dz * v.fz) / d3;
        if (dot > E.seenDot && !this.rooms.lineBlocked(v.cx, v.cz, this.x, this.z)) seen = true;
      }
    }
    if (seen && !this.seen && !this.everSeen) { this.everSeen = true; if (hooks.onFirstSight) hooks.onFirstSight(); }
    this.seen = seen;
    this.seenTimer = seen ? this.seenTimer + dt : Math.max(0, this.seenTimer - dt * 2);

    // --- stalemate breaker: stare too long and it takes a step in the dark ---
    if (this.seenTimer > E.stareLimit) {
      this.seenTimer = 0;
      if (hooks.onStare) hooks.onStare();
      const dx = v.px - this.x, dz = v.pz - this.z, d = Math.hypot(dx, dz);
      const jump = Math.min(2.5, d - (E.catchRadius + 1.2));
      if (jump > 0 && d > 0.01) { this.x += (dx / d) * jump; this.z += (dz / d) * jump; }
    }

    // --- move (only while unobserved) ---
    let tx, tz;
    if (!this.step) { tx = v.px; tz = v.pz; }
    else {
      const dxn = this.step.x - myCell.x, dzn = this.step.z - myCell.z;
      tx = (myCell.x + this.step.x) * S / 2 + dxn * S * 0.06;
      tz = (myCell.z + this.step.z) * S / 2 + dzn * S * 0.06;
    }
    const mx = tx - this.x, mz = tz - this.z, md = Math.hypot(mx, mz);
    let moved = 0;
    if (!seen && md > 0.02) {
      moved = Math.min(md, this.speed * dt);
      this.x += (mx / md) * moved; this.z += (mz / md) * moved;
      this.heading = Math.atan2(mx, mz);
    }
    this.walk += moved * 2.4;

    return this.report(v, loaded, moved);
  }

  report(v, loaded, moved = 0) {
    const E = CONFIG.entity;
    const dist = Math.hypot(v.px - this.x, v.pz - this.z);
    let caught = false;
    if (dist < E.catchRadius && !this.rooms.lineBlocked(v.px, v.pz, this.x, this.z)) caught = true;
    let fear = Math.max(0, 1 - dist / E.fearRange);
    if (this.seen) fear = Math.max(fear, Math.min(1, 1.15 - dist / 18));
    this.applyPose(v, loaded, moved);
    return { active: true, fear: Math.min(1, fear), seen: this.seen, caught, dist };
  }

  applyPose(v, loaded, moved) {
    const g = this.group;
    g.visible = loaded;
    if (!loaded) return;
    g.position.set(this.x, CONFIG.floorY, this.z);
    // face the player while watched, otherwise face where it is walking
    const face = this.seen ? Math.atan2(v.px - this.x, v.pz - this.z) : this.heading;
    let d = face - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y += d * (this.seen ? 0.25 : 0.15);

    const u = g.userData;
    const sw = Math.sin(this.walk) * (moved > 0 ? 0.55 : 0);
    u.legL.rotation.x = sw; u.legR.rotation.x = -sw;
    u.armL.rotation.x = -sw * 0.35 + 0.05; u.armR.rotation.x = sw * 0.35 + 0.05;
    u.head.rotation.z = Math.sin(this.t * 0.6) * 0.12 + (this.seen ? 0.38 : 0); // the head tilts when it knows you see it
    u.head.rotation.x = this.seen ? 0.12 : 0.28;
    u.torso.rotation.x = 0.06;
  }

  /** For the death scene: stand it right in front of the camera. */
  lungeTo(x, z) { this.x = x; this.z = z; this.seen = true; }

  hide() { this.group.visible = false; }
}
