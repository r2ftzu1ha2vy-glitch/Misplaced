/**
 * main.js — bootstrap, render loop, streaming driver, horror director.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { World } from './world.js';
import { RoomLibrary, RoomManager } from './rooms.js';
import { Player } from './player.js';
import { Entity } from './entity.js';
import { AudioEngine } from './audio.js';

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

// film grain texture (tiny noise tile, animated purely with CSS)
function makeGrain() {
  const c = document.createElement('canvas'); c.width = c.height = 160;
  const g = c.getContext('2d'), img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  $('grain').style.backgroundImage = `url(${c.toDataURL()})`;
}

async function main() {
  if (location.protocol === 'file:') throw new Error('Browsers block module/GLB loading from file://. Run serve.py and open http://localhost:8080');
  makeGrain();

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

  // flashlight (always present so the shader never recompiles; toggled by intensity)
  const L = CONFIG.lighting;
  const flash = new THREE.SpotLight(0xfff4d6, L.flashlightIntensity, L.flashlightDistance, L.flashlightAngle, 0.6, 1.6);
  flash.position.set(0.1, -0.1, 0);
  flash.target.position.set(0, 0, -1);
  camera.add(flash); camera.add(flash.target);
  let flashOn = true;

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
  const entity = new Entity(scene, world, rooms);
  const audio = new AudioEngine();

  rooms.update(0, 0);
  player.placeNear(0, 0, rooms);

  // ---- UI state ----
  let state = 'menu'; // menu | play | dead | won
  let debug = false, fullbright = false;
  let playTime = 0, fear = 0, deadT = 0;
  const hud = $('hud');
  $('loading').classList.add('hidden');
  $('start').classList.remove('hidden');

  const lock = () => {
    audio.start().then(() => audio.resume());
    renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock();
  };
  $('startBtn').addEventListener('click', lock);
  $('resumeBtn').addEventListener('click', lock);
  $('pause').addEventListener('click', lock);
  $('againBtn').addEventListener('click', newRun);
  $('deathBtn').addEventListener('click', newRun);

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === renderer.domElement;
    if (locked) {
      if (state === 'menu') state = 'play';
      player.enabled = state === 'play';
      $('start').classList.add('hidden'); $('pause').classList.add('hidden');
      audio.resume();
    } else {
      player.enabled = false;
      if (state === 'play') { $('pause').classList.remove('hidden'); audio.stop(); }
    }
  });

  addEventListener('keydown', (e) => {
    if (e.code === 'F3') { e.preventDefault(); debug = !debug; hud.classList.toggle('hidden', !debug); }
    if (e.code === 'KeyB') {
      fullbright = !fullbright;
      ambient.intensity = fullbright ? 6 : CONFIG.lighting.ambient;
      scene.fog.far = fullbright ? 200 : CONFIG.fog.far;
    }
    if (e.code === 'KeyF' && state === 'play') { flashOn = !flashOn; audio.click(); }
    if (e.code === 'KeyR') newRun();
  });

  const lightHooks = {
    onFlicker: () => audio.crackle(),
    onBlackout: () => audio.thunk(),
    onRestore: () => audio.click(),
  };
  const entityHooks = {
    onFirstSight: () => audio.sting(),
    onStare: () => { rooms.blackoutAll(clock.elapsedTime, 1.4); audio.thunk(); flashBurst(0.5); },
  };

  const staticEl = $('static');
  let staticLevel = 0;
  function flashBurst(v) { staticLevel = Math.max(staticLevel, v); }

  function die() {
    state = 'dead'; deadT = 0;
    player.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    audio.alive = true; audio.resume();
    audio.scream();
    flashBurst(1);
    // snap the camera onto its face
    const dx = entity.x - player.pos.x, dz = entity.z - player.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    entity.lungeTo(player.pos.x + (dx / d) * 0.7, player.pos.z + (dz / d) * 0.7);
    player.yaw = Math.atan2(-dx, -dz);
    player.pitch = 0.45;
  }

  // ---- loop ----
  const clock = new THREE.Clock();
  let fpsAcc = 0, fpsFrames = 0, fps = 0;
  const fwd = new THREE.Vector3();
  const staminaFill = $('staminaFill'), fearEl = $('fear'), grainEl = $('grain');

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    if (state === 'play') playTime += dt;
    player.update(dt, rooms);

    // stream: current cell + 4 neighbours only
    const c = RoomManager.cellOf(player.pos.x, player.pos.z);
    rooms.update(c.x, c.z);

    // ---- the entity ----
    camera.getWorldDirection(fwd);
    if (state === 'play' && !entity.active && playTime > CONFIG.entity.spawnDelay) entity.spawn(c);
    let info = { active: false, fear: 0, seen: false, caught: false, dist: Infinity };
    if (state === 'play') {
      info = entity.update(dt, {
        px: player.pos.x, pz: player.pos.z,
        cx: camera.position.x, cy: camera.position.y, cz: camera.position.z,
        fx: fwd.x, fy: fwd.y, fz: fwd.z,
      }, entityHooks);
      if (info.caught) die();
    } else if (state === 'dead') {
      deadT += dt;
      entity.applyPose({ px: player.pos.x, pz: player.pos.z }, true, 0);
      if (deadT > 1.3) $('death').classList.remove('hidden');
    }

    // ---- dread ----
    const targetFear = state === 'dead' ? 1 : info.fear;
    fear += (targetFear - fear) * Math.min(1, dt * (targetFear > fear ? 2.5 : 0.8));
    rooms.updateLights(t, fear, lightHooks);

    // camera shake + FOV pinch
    if (fear > 0.25 || state === 'dead') {
      const k = (state === 'dead' ? 1 : (fear - 0.25) / 0.75) ** 2 * 0.02;
      camera.position.x += (Math.random() - 0.5) * k; camera.position.y += (Math.random() - 0.5) * k;
      camera.rotation.z = (Math.random() - 0.5) * k * 1.5;
    } else camera.rotation.z = 0;
    camera.fov = CONFIG.player.fov - fear * 8 + (player.sprinting ? 4 : 0);
    camera.updateProjectionMatrix();

    // flashlight (flutters when it's close)
    flash.intensity = flashOn ? L.flashlightIntensity * (fear > 0.5 && Math.random() < 0.08 ? 0.2 : 1) : 0;

    // 2D overlays
    fearEl.style.opacity = String(Math.min(1, fear * 1.2));
    grainEl.style.opacity = String(0.09 + fear * 0.12);
    staticLevel = Math.max(0, staticLevel - dt * 1.8);
    staticEl.style.opacity = String(staticLevel * (0.5 + Math.random() * 0.5));
    staminaFill.style.width = Math.round(player.stamina * 100) + '%';
    staminaFill.style.opacity = player.exhausted ? '0.25' : '0.55';

    // audio
    audio.update({
      fear,
      entity: entity.active ? { x: entity.x, y: 1.3, z: entity.z } : null,
      cam: camera.position, fwd,
      speed: state === 'play' ? player.speed : 0, sprinting: player.sprinting,
    });

    // win
    if (state === 'play' && rooms.touchingExit(player.pos.x, player.pos.z, CONFIG.player.radius + 0.1)) {
      state = 'won';
      player.enabled = false;
      entity.hide();
      document.exitPointerLock();
      $('win').classList.remove('hidden');
      audio.stop();
    }

    renderer.render(scene, camera);

    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) { fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    if (debug) {
      const list = [...rooms.rooms.values()].map((r) => `${r.type}@${r.cx},${r.cz}`).join('  ');
      hud.textContent =
        `seed ${seed}   fps ${fps}   draws ${renderer.info.render.calls}   tris ${renderer.info.render.triangles}\n` +
        `cell ${c.x},${c.z}   pos ${player.pos.x.toFixed(1)}, ${player.pos.z.toFixed(1)}   stamina ${player.stamina.toFixed(2)}\n` +
        `loaded ${rooms.rooms.size}: ${list}\n` +
        `exit cell ${world.exitCell.x},${world.exitCell.z}\n` +
        `entity ${entity.active ? `${entity.x.toFixed(1)}, ${entity.z.toFixed(1)}  dist ${info.dist.toFixed(1)}  speed ${entity.speed.toFixed(2)}  seen ${info.seen}` : `dormant (spawns at ${CONFIG.entity.spawnDelay}s, t=${playTime.toFixed(0)})`}\n` +
        `fear ${fear.toFixed(2)}`;
    }
  }
  frame();
}

main().catch(fatal);
