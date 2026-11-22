/**
 * main.js — bootstrap, render loop, streaming driver.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { World } from './world.js';
import { RoomLibrary, RoomManager } from './rooms.js';
import { Player } from './player.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const setProgress = (f, msg) => {
  $('barFill').style.width = Math.round(f * 100) + '%';
  if (msg) statusEl.textContent = msg;
};
const fatal = (err) => {
  console.error(err);
  statusEl.classList.add('error');
  statusEl.textContent = 'ERROR: ' + (err && err.message ? err.message : err) +
    (location.protocol === 'file:' ? '  — open via serve.py, not file://' : '');
};

// ---- seed -----------------------------------------------------------------
const params = new URLSearchParams(location.search);
let seed = parseInt(params.get('seed'), 10);
if (!Number.isFinite(seed)) seed = (Math.random() * 0xffffffff) >>> 0;
const newRun = () => { location.search = '?seed=' + ((Math.random() * 0xffffffff) >>> 0); };

async function main() {
  if (location.protocol === 'file:') throw new Error('Browsers block module/GLB loading from file://. Run serve.py and open http://localhost:8080');

  // ---- renderer / scene ----
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.fog.color);
  scene.fog = new THREE.Fog(CONFIG.fog.color, CONFIG.fog.near, CONFIG.fog.far);
  const camera = new THREE.PerspectiveCamera(CONFIG.player.fov, innerWidth / innerHeight, 0.05, 80);
  scene.add(camera);

  const ambient = new THREE.AmbientLight(CONFIG.lighting.ambientColor, CONFIG.lighting.ambient);
  scene.add(ambient);

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  // ---- assets ----
  const library = new RoomLibrary();
  await library.loadAll(setProgress);

  // ---- world ----
  const world = new World(seed);
  const rooms = new RoomManager(scene, library, world);
  const player = new Player(camera);

  rooms.update(0, 0);
  player.placeNear(0, 0, rooms);

  // ---- UI state ----
  let won = false, debug = false, fullbright = false;
  const hud = $('hud');
  $('loading').classList.add('hidden');
  $('start').classList.remove('hidden');

  const lock = () => renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock();
  $('startBtn').addEventListener('click', lock);
  $('resumeBtn').addEventListener('click', lock);
  $('pause').addEventListener('click', lock);
  $('againBtn').addEventListener('click', newRun);

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === renderer.domElement;
    player.enabled = locked && !won;
    if (locked) { $('start').classList.add('hidden'); $('pause').classList.add('hidden'); }
    else if (!won && $('start').classList.contains('hidden')) $('pause').classList.remove('hidden');
  });

  addEventListener('keydown', (e) => {
    if (e.code === 'F3') { e.preventDefault(); debug = !debug; hud.classList.toggle('hidden', !debug); }
    if (e.code === 'KeyB') {
      fullbright = !fullbright;
      ambient.intensity = fullbright ? 6 : CONFIG.lighting.ambient;
      scene.fog.far = fullbright ? 200 : CONFIG.fog.far;
    }
    if (e.code === 'KeyR') newRun();
  });

  // ---- loop ----
  const clock = new THREE.Clock();
  let fpsAcc = 0, fpsFrames = 0, fps = 0;

  function frame() {
    requestAnimationFrame(frame);
    const dt = clock.getDelta();
    const t = clock.elapsedTime;

    player.update(dt, rooms);

    // stream: current cell + 4 neighbours only
    const c = RoomManager.cellOf(player.pos.x, player.pos.z);
    rooms.update(c.x, c.z);
    rooms.updateLights(t);

    if (!won && rooms.touchingExit(player.pos.x, player.pos.z, CONFIG.player.radius + 0.1)) {
      won = true;
      player.enabled = false;
      document.exitPointerLock();
      $('win').classList.remove('hidden');
    }

    renderer.render(scene, camera);

    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) { fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    if (debug) {
      const list = [...rooms.rooms.values()].map((r) => `${r.type}@${r.cx},${r.cz}`).join('  ');
      hud.textContent =
        `seed ${seed}   fps ${fps}   draws ${renderer.info.render.calls}   tris ${renderer.info.render.triangles}\n` +
        `cell ${c.x},${c.z}   pos ${player.pos.x.toFixed(1)}, ${player.pos.z.toFixed(1)}\n` +
        `loaded ${rooms.rooms.size}: ${list}\n` +
        `exit cell ${world.exitCell.x},${world.exitCell.z}`;
    }
  }
  frame();
}

main().catch(fatal);
