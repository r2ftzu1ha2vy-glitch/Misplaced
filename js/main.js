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
  let player, lighting, atmosphere;
  let colliders = [];
  let running = false;

  function init() {
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(
      GAME_CONFIG.atmosphere.fogColor,
      GAME_CONFIG.atmosphere.fogNear,
      GAME_CONFIG.atmosphere.fogFar
    );
    scene.background = new THREE.Color(GAME_CONFIG.atmosphere.fogColor);

    camera = new THREE.PerspectiveCamera(
      GAME_CONFIG.player.fovBase,
      window.innerWidth / window.innerHeight,
      0.05,
      100
    );

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    document.getElementById("app").appendChild(renderer.domElement);

    window.addEventListener("resize", onResize);

    // Base ambient — kept very low; fixtures provide the real light
    const ambient = new THREE.AmbientLight(0x8a8f94, GAME_CONFIG.atmosphere.ambientIntensity);
    scene.add(ambient);

    // A faint hemisphere light so unlit areas aren't pure black silhouettes
    const hemi = new THREE.HemisphereLight(0x4a4e55, 0x0a0a0a, 0.08);
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

    const floor1 = new Floor1Layout();
    const result = floor1.build(scene, assets, lighting, atmosphere);
    colliders = result.colliders;

    player.position.copy(result.spawnPoint);
    player.position.y = GAME_CONFIG.player.eyeHeight;

    return assets;
  }

  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05); // clamp to avoid huge steps on tab-out

    player.update(dt);
    lighting.update(dt);
    atmosphere.update(dt, player.position);

    renderer.render(scene, camera);
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
      renderer.domElement.requestPointerLock();
      start();
    });
  });
})();
