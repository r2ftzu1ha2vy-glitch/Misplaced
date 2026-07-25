/**
 * main.js
 * ---------------------------------------------------------------
 * Boots the renderer/scene, loads Floor 1 assets, builds the level,
 * and runs the game loop. Kept intentionally thin — all real logic
 * lives in the dedicated systems (player, lighting, atmosphere,
 * floor layout).
 * ---------------------------------------------------------------
 */

(function () {
  let scene, camera, renderer, clock;
  let player, lighting, atmosphere, roomStreamer;
  let colliders = [];
  let running = false;
  let hasWon = false;

  function init() {
    scene = new THREE.Scene();
    // Fog far is intentionally close to the stream radius edge so newly
    // streamed-in tiles fade in through fog rather than visibly popping.
    const streamEdge = GAME_CONFIG.floor1.tileSize * (GAME_CONFIG.floor1.streamRadius + 0.5);
    scene.fog = new THREE.Fog(
      GAME_CONFIG.atmosphere.fogColor,
      GAME_CONFIG.atmosphere.fogNear,
      Math.min(GAME_CONFIG.atmosphere.fogFar, streamEdge)
    );
    scene.background = new THREE.Color(GAME_CONFIG.atmosphere.fogColor);

    camera = new THREE.PerspectiveCamera(
      GAME_CONFIG.player.fovBase,
      window.innerWidth / window.innerHeight,
      0.05,
      streamEdge + 10
    );

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    // Capped at 1.5 instead of 2 — on high-DPI/retina screens a cap of 2
    // was quietly forcing the GPU to shade up to 4x the actual screen
    // pixels every frame, which is one of the more common causes of
    // "laggy" performance that isn't visible in any profiler timeline.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    // No light in the level ever casts a shadow (see lightingSystem /
    // roomTiles), so leaving the shadow map on just made the renderer do
    // shadow-related bookkeeping for zero visual benefit.
    renderer.shadowMap.enabled = false;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    document.getElementById("app").appendChild(renderer.domElement);

    window.addEventListener("resize", onResize);

    // Base ambient — kept low; fixtures provide the real light
    const ambient = new THREE.AmbientLight(0x8a8f94, GAME_CONFIG.atmosphere.ambientIntensity);
    scene.add(ambient);

    // A faint hemisphere light so unlit areas aren't pure black silhouettes
    const hemi = new THREE.HemisphereLight(0x4a4e55, 0x0a0a0a, 0.18);
    scene.add(hemi);

    clock = new THREE.Clock();

    lighting = new LightingSystem(scene);
    atmosphere = new AtmosphereSystem();

    player = new PlayerController(camera, renderer.domElement, () => colliders);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  async function loadAndBuild() {
    const assets = new AssetManager();
    const statusEl = document.getElementById("loadingStatus");
    const barEl = document.getElementById("loadingBar");

    await assets.loadAll((done, total, key) => {
      const pct = Math.round((done / total) * 100);
      if (statusEl) statusEl.textContent = `Loading ${key}… (${done}/${total})`;
      if (barEl) barEl.style.width = pct + "%";
    });

    if (statusEl) statusEl.textContent = "Assembling floor…";

    roomStreamer = new RoomStreamer(scene, assets, lighting, atmosphere, onWin);
    const result = roomStreamer.buildInitial();
    colliders = result.colliders;

    player.position.copy(result.spawnPoint);
    player.position.y = GAME_CONFIG.player.eyeHeight;

    return assets;
  }

  function onWin() {
    if (hasWon) return;
    hasWon = true;
    running = false;
    document.exitPointerLock && document.exitPointerLock();
    const winEl = document.getElementById("winscreen");
    if (winEl) {
      winEl.style.display = "flex";
      requestAnimationFrame(() => winEl.classList.add("show"));
    }
  }

  function animate() {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05); // clamp to avoid huge steps on tab-out

    player.update(dt);
    lighting.update(dt);
    atmosphere.update(dt, player.position);

    if (roomStreamer) {
      roomStreamer.update(player.position);
      colliders = roomStreamer.colliders; // keep the getter's backing array current
      if (roomStreamer.checkExitTrigger(player.position)) {
        onWin();
      }
    }

    renderer.render(scene, camera);
    if (running) requestAnimationFrame(animate);
  }

  function start() {
    running = true;
    clock.start();
    animate();
  }

  window.addEventListener("DOMContentLoaded", async () => {
    init();

    const startBtn = document.getElementById("startBtn");
    const titlecard = document.getElementById("titlecard");

    try {
      await loadAndBuild();
      if (startBtn) startBtn.textContent = "CLICK TO ENTER";
    } catch (e) {
      Utils.logError("Fatal error during load: " + (e && e.message ? e.message : e));
      if (startBtn) startBtn.textContent = "LOAD FAILED — SEE LOG";
      return;
    }

    startBtn.addEventListener("click", () => {
      titlecard.style.opacity = "0";
      setTimeout(() => (titlecard.style.display = "none"), 1200);
      if (!("ontouchstart" in window)) renderer.domElement.requestPointerLock();
      start();
    });
  });
})();
