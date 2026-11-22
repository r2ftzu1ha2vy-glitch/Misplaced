/**
 * player.js — first-person controller: mouse look, WASD, sprint, circle-vs-AABB collision.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3(0, CONFIG.floorY, 0);
    this.vel = new THREE.Vector2(0, 0); // x, z
    this.yaw = 0;
    this.pitch = 0;
    this.bob = 0;
    this.keys = new Set();
    this.solids = [];
    this.enabled = false;
    this.camera.fov = CONFIG.player.fov;
    this.camera.updateProjectionMatrix();

    addEventListener('keydown', (e) => { this.keys.add(e.code); });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      this.yaw -= e.movementX * CONFIG.player.sensitivity;
      this.pitch -= e.movementY * CONFIG.player.sensitivity;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    });
  }

  /** Push the circle (x,z,r) out of every box. Returns the corrected position in `p`. */
  static resolve(p, r, boxes) {
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const b of boxes) {
        const nx = Math.max(b.min.x, Math.min(p.x, b.max.x));
        const nz = Math.max(b.min.z, Math.min(p.z, b.max.z));
        let dx = p.x - nx, dz = p.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2), push = r - d;
          p.x += (dx / d) * push; p.z += (dz / d) * push;
        } else {
          // centre is inside the box: leave through the nearest face
          const l = p.x - b.min.x, rr = b.max.x - p.x, t = p.z - b.min.z, bt = b.max.z - p.z;
          const m = Math.min(l, rr, t, bt);
          if (m === l) p.x = b.min.x - r; else if (m === rr) p.x = b.max.x + r;
          else if (m === t) p.z = b.min.z - r; else p.z = b.max.z + r;
        }
        moved = true;
      }
      if (!moved) break;
    }
  }

  /** True if a circle at (x,z) is clear of all boxes. */
  static clear(x, z, r, boxes) {
    for (const b of boxes) {
      const nx = Math.max(b.min.x, Math.min(x, b.max.x));
      const nz = Math.max(b.min.z, Math.min(z, b.max.z));
      if ((x - nx) ** 2 + (z - nz) ** 2 < r * r) return false;
    }
    return true;
  }

  update(dt, rooms) {
    const P = CONFIG.player;
    dt = Math.min(dt, 0.05);

    let fx = 0, fz = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1;
    }
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = sprint ? P.sprintSpeed : P.walkSpeed;

    // input is relative to yaw
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin;
    const wz = -fx * sin + fz * cos;

    const rate = len > 0 ? P.acceleration : P.deceleration;
    const tx = wx * speed, tz = wz * speed;
    const k = Math.min(1, rate * dt / Math.max(speed, 0.001));
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.y += (tz - this.vel.y) * k;

    // sub-step so a fast player can never skip through a 1 cm blocker
    const dist = Math.hypot(this.vel.x, this.vel.y) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.1));
    const sx = this.vel.x * dt / steps, sz = this.vel.y * dt / steps;
    for (let i = 0; i < steps; i++) {
      this.pos.x += sx; this.pos.z += sz;
      rooms.collectSolids(this.pos.x, this.pos.z, P.radius + 0.5, this.solids);
      Player.resolve(this.pos, P.radius, this.solids);
    }

    const moving = Math.hypot(this.vel.x, this.vel.y);
    this.bob += moving * dt * (P.bobSpeed / P.walkSpeed);
    const bobY = Math.sin(this.bob) * P.bobAmount * Math.min(1, moving / P.walkSpeed);

    this.camera.position.set(this.pos.x, CONFIG.floorY + P.eyeHeight + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  /** Find the nearest clear spot around (x,z) so the player never spawns inside furniture. */
  placeNear(x, z, rooms) {
    const P = CONFIG.player;
    rooms.collectSolids(x, z, 20, this.solids);
    const cands = [];
    for (let dx = -4; dx <= 4; dx += 0.5) for (let dz = -4; dz <= 4; dz += 0.5) cands.push([dx, dz, dx * dx + dz * dz]);
    cands.sort((a, b) => a[2] - b[2]);
    for (const [dx, dz] of cands) {
      if (Player.clear(x + dx, z + dz, P.radius + 0.15, this.solids)) { this.pos.set(x + dx, CONFIG.floorY, z + dz); return; }
    }
    this.pos.set(x, CONFIG.floorY, z);
  }
}
