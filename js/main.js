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
  let floorManager;
  let audioListener;
  let colliders = [];
  let running = false;
  let hasWon = false;
  let hasEnded = false; // true once the win OR death screen has fired, guards against double-trigger

  let deviceTier = "high"; // "low" | "mid" | "high" — set once in init(), read by several systems below

  /**
   * Cheap, synchronous heuristic to bucket the current device into a
   * performance tier, so we can automatically dial down render cost on
   * phones/tablets/low-core laptops instead of shipping one fixed
   * quality level for every device. No GPU benchmarking (that needs
   * async frame timing we don't have time for at boot) — just signals
   * available immediately: touch/mobile UA, core count, and memory.
   */
  function detectDeviceTier() {
    const ua = navigator.userAgent || "";
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua);
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4; // Chrome-only; undefined elsewhere, defaults to 4 (mid)
    const coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

    if (isMobileUA || coarsePointer) {
      // Phones/tablets: split low vs mid by cores+memory, since a modern
      // flagship phone can handle more than a 2015-era budget device.
      if (cores <= 4 || mem <= 3) return "low";
      return "mid";
    }
    // Desktop/laptop: low core count is the main red flag (old/budget
    // hardware, or a throttled VM); otherwise assume it can handle full quality.
    if (cores <= 2) return "low";
    if (cores <= 4) return "mid";
    return "high";
  }

  /**
   * Applies deviceTier to the handful of settings that actually move the
   * needle on frame cost: Floor 1's stream radius (its 20m tiles carry
   * several furniture props each — the single biggest lever for the
   * office feeling laggy). Called immediately, before the renderer even
   * exists, since scene/fog/camera setup below already reads
   * GAME_CONFIG.floor1.streamRadius. Floor 2's smaller/simpler corridor
   * segments are left alone since they weren't the reported problem area.
   */
  function applyDeviceTierConfig(tier) {
    if (tier === "low") {
      GAME_CONFIG.floor1.streamRadius = 0; // 1x1 tile around the player instead of 3x3
    } else {
      GAME_CONFIG.floor1.streamRadius = 1; // mid/high: unchanged default
    }
  }

  function init() {
    deviceTier = detectDeviceTier();
    applyDeviceTierConfig(deviceTier);

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

    // Positional audio listener lives on the camera so 3D sounds (like a
    // toppling cabinet) pan/attenuate naturally with the player's position
    // and facing.
    audioListener = new THREE.AudioListener();
    camera.add(audioListener);

    renderer = new THREE.WebGLRenderer({
      // Antialiasing is one of the more expensive fixed costs per frame
      // (extra samples every pixel, every frame) — worth cutting first
      // on weaker devices since MSAA-off is barely noticeable in a dark,
      // foggy scene like this one but frees up real GPU headroom.
      antialias: deviceTier === "high",
      powerPreference: "high-performance",
    });
    // Capped at 1.5 instead of 2 — on high-DPI/retina screens a cap of 2
    // was quietly forcing the GPU to shade up to 4x the actual screen
    // pixels every frame, which is one of the more common causes of
    // "laggy" performance that isn't visible in any profiler timeline.
    // Lower tiers get an even tighter cap since resolution scales the
    // cost of literally every fragment shader in the scene.
    const pixelRatioCap = deviceTier === "low" ? 1 : deviceTier === "mid" ? 1.25 : 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
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

    // Load BOTH floors' assets up front, under one combined progress bar,
    // so the loading screen actually reflects everything the game needs —
    // previously Floor 2's hotel models loaded silently in the background
    // after "CLICK TO ENTER" appeared, which looked like the game had only
    // ever loaded Floor 1.
    const floor1Total = Object.keys(GAME_CONFIG.models).length;
    const floor2Total = Object.keys(GAME_CONFIG.modelsFloor2).length;
    const grandTotal = floor1Total + floor2Total;

    await assets.loadAll((done, total, key) => {
      const pct = Math.round((done / grandTotal) * 100);
      if (statusEl) statusEl.textContent = `Loading ${key}… (${done}/${grandTotal})`;
      if (barEl) barEl.style.width = pct + "%";
    });

    await assets.loadFloor2((done, total, key) => {
      const overallDone = floor1Total + done;
      const pct = Math.round((overallDone / grandTotal) * 100);
      if (statusEl) statusEl.textContent = `Loading ${key}… (${overallDone}/${grandTotal})`;
      if (barEl) barEl.style.width = pct + "%";
    });

    if (statusEl) statusEl.textContent = "Assembling floor…";

    // Load the cabinet-topple sound in parallel with level assembly — it's
    // small, and we don't want a slow audio fetch to hold up the loading
    // screen. atmosphere.update()/topple logic already guards against the
    // buffer not being ready yet, so this can resolve whenever it resolves.
    const audioLoader = new THREE.AudioLoader();
    audioLoader.load(
      "assets/audio/fall.mp3",
      (buffer) => atmosphere.setFallSound(audioListener, buffer),
      undefined,
      (err) => Utils.logError("Failed to load fall.mp3: " + (err && err.message ? err.message : err))
    );

    roomStreamer = new RoomStreamer(scene, assets, lighting, atmosphere, onWin);
    const result = roomStreamer.buildInitial();
    colliders = result.colliders;

    player.position.copy(result.spawnPoint);
    player.position.y = GAME_CONFIG.player.eyeHeight;

    floorManager = new FloorManager({ scene, assets, lighting, atmosphere, player, camera, audioListener });
    floorManager.initFloor1(roomStreamer);
    floorManager.onWin(onWin);
    floorManager.onDeath(onCaught);

    CheatSystem.init(player, floorManager);

    return assets;
  }

  function onWin() {
    // Called only for the TRUE end-of-game win — finding the access
    // card at the end of Floor 2's hotel corridor. The Floor 1 exit
    // gate no longer calls this directly; it hands off to
    // floorManager.goToLobby() instead (see roomStreamer.checkExitTrigger
    // usage below), which is Floor 2's own scene transition, not a win.
    if (hasEnded) return;
    hasEnded = true;
    hasWon = true;
    running = false;
    document.exitPointerLock && document.exitPointerLock();

    const fadeEl = document.getElementById("fadeOverlay");
    const winEl = document.getElementById("winscreen");

    if (fadeEl) {
      fadeEl.classList.add("show");
      setTimeout(() => {
        if (winEl) {
          winEl.style.display = "flex";
          requestAnimationFrame(() => winEl.classList.add("show"));
        }
      }, 1100); // matches #fadeOverlay's transition duration
    } else if (winEl) {
      winEl.style.display = "flex";
      requestAnimationFrame(() => winEl.classList.add("show"));
    }
  }

  /** Called the instant N-tity or Ghoxt catches the player. `who` is
   *  "ntity" or "ghoxt" so the death screen can show flavor text for
   *  whichever one got you. Clicking the death screen reloads the page
   *  — simplest possible "try again" for a single-life horror loop. */
  function onCaught(who) {
    if (hasEnded) return;
    hasEnded = true;
    running = false;
    document.exitPointerLock && document.exitPointerLock();

    const deathSound = document.getElementById("deathSound");
    if (deathSound) {
      deathSound.volume = 0.9;
      deathSound.currentTime = 0;
      const p = deathSound.play();
      if (p && p.catch) p.catch(() => {});
    }

    const fadeEl = document.getElementById("fadeOverlay");
    const deathEl = document.getElementById("deathscreen");
    const titleEl = document.getElementById("deathTitle");
    const subEl = document.getElementById("deathSub");

    if (titleEl && subEl) {
      if (who === "ghoxt") {
        titleEl.textContent = "YOU DIED";
        subEl.textContent = "Ghoxt was waiting in the room with you.";
      } else {
        titleEl.textContent = "YOU DIED";
        subEl.textContent = "N-tity caught up to you.";
      }
    }

    const showDeathScreen = () => {
      if (!deathEl) return;
      deathEl.style.display = "flex";
      requestAnimationFrame(() => deathEl.classList.add("show"));
      deathEl.addEventListener("click", () => window.location.reload(), { once: true });
    };

    if (fadeEl) {
      fadeEl.classList.add("show");
      setTimeout(showDeathScreen, 1100); // matches #fadeOverlay's transition duration
    } else {
      showDeathScreen();
    }
  }

  function animate() {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05); // clamp to avoid huge steps on tab-out

    player.update(dt);
    lighting.update(dt);
    // Atmosphere (flicker/topple/nudge events) is Floor 1 flavor only —
    // Floor 2's hotel plays it much calmer, so this only keeps running
    // while still on Floor 1.
    if (!floorManager || floorManager.state === "floor1") {
      atmosphere.update(dt, player.position);
    }

    if (floorManager && !player.flyMode) {
      floorManager.update(dt, player.position);
      colliders = floorManager.getColliders(); // keep the getter's backing array current
    }

    CheatSystem.update(dt);

    if (Multiplayer.isConnected()) {
      Multiplayer.update(dt);
    }

    renderer.render(scene, camera);
    if (running) requestAnimationFrame(animate);
  }

  function start() {
    running = true;
    clock.start();
    animate();
  }

  /** Wires up the "MULTIPLAYER" button + its create/join modal on the
   *  title card. Purely UI/flow — the actual networking lives in
   *  multiplayer.js. Connecting happens as soon as a room is settled
   *  (either right after creating one, or right after a valid join),
   *  independent of whether the player has clicked "CLICK TO ENTER"
   *  yet, so position sync is already live the moment gameplay starts. */
  function initMultiplayerMenu() {
    const mpBtn = document.getElementById("multiplayerBtn");
    const modal = document.getElementById("mpModal");
    const choiceRow = document.getElementById("mpChoiceRow");
    const choiceCreate = document.getElementById("mpChoiceCreate");
    const choiceJoin = document.getElementById("mpChoiceJoin");
    const createPane = document.getElementById("mpCreatePane");
    const joinPane = document.getElementById("mpJoinPane");
    const createdCodeEl = document.getElementById("mpCreatedCode");
    const createStatusEl = document.getElementById("mpCreateStatus");
    const createStartBtn = document.getElementById("mpCreateStartBtn");
    const codeInput = document.getElementById("roomCodeInput");
    const joinStatusEl = document.getElementById("mpJoinStatus");
    const joinStartBtn = document.getElementById("mpJoinStartBtn");
    const closeBtn = document.getElementById("mpCloseBtn");
    const badge = document.getElementById("mpBadge");
    if (!mpBtn || !modal) return;

    const resetModal = () => {
      choiceRow.style.display = "flex";
      createPane.style.display = "none";
      joinPane.style.display = "none";
      createStatusEl.textContent = "Share this code with your friend, then press start once they've joined.";
      joinStatusEl.textContent = "";
      joinStatusEl.classList.remove("error");
      joinStartBtn.classList.add("disabled");
      codeInput.value = "";
    };

    const updateBadge = () => {
      if (!badge) return;
      if (Multiplayer.isConnected()) {
        badge.textContent = `ROOM ${Multiplayer.getRoomCode()} — ${Multiplayer.getPlayerCount()} ONLINE`;
        badge.classList.add("show");
      } else {
        badge.classList.remove("show");
      }
    };

    mpBtn.addEventListener("click", () => {
      resetModal();
      modal.classList.add("show");
    });
    closeBtn.addEventListener("click", () => modal.classList.remove("show"));

    choiceCreate.addEventListener("click", async () => {
      choiceRow.style.display = "none";
      createPane.style.display = "flex";
      createdCodeEl.textContent = "• • • •";
      try {
        const code = await Multiplayer.createRoom();
        createdCodeEl.textContent = code.split("").join(" ");
        await Multiplayer.connect(code, scene, {
          getPosition: () => new THREE.Vector3(player.position.x, player.position.y - player.currentHeight, player.position.z),
          getYaw: () => player.yaw,
          getFloorLabel: () => (floorManager ? floorManager.state : ""),
        }, { onRosterChange: (n) => updateBadge() });
        updateBadge();
        createStatusEl.textContent = "Room ready. Your friend can join with this code any time.";
      } catch (e) {
        createStatusEl.textContent = e && e.message ? e.message : "Couldn't create a room.";
        createStatusEl.classList.add("error");
        Utils.logError("Multiplayer create failed: " + (e && e.message ? e.message : e));
      }
    });

    createStartBtn.addEventListener("click", () => {
      modal.classList.remove("show");
    });

    choiceJoin.addEventListener("click", () => {
      choiceRow.style.display = "none";
      joinPane.style.display = "flex";
      codeInput.focus();
    });

    codeInput.addEventListener("input", () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      joinStartBtn.classList.toggle("disabled", codeInput.value.length !== GAME_CONFIG.multiplayer.roomCodeLength);
      joinStatusEl.textContent = "";
      joinStatusEl.classList.remove("error");
    });

    const attemptJoin = async () => {
      const code = codeInput.value.trim();
      if (code.length !== GAME_CONFIG.multiplayer.roomCodeLength) return;
      joinStatusEl.textContent = "Checking code…";
      joinStatusEl.classList.remove("error");
      try {
        const exists = await Multiplayer.roomExists(code);
        if (!exists) {
          joinStatusEl.textContent = `No room "${code}" found.`;
          joinStatusEl.classList.add("error");
          return;
        }
        await Multiplayer.connect(code, scene, {
          getPosition: () => new THREE.Vector3(player.position.x, player.position.y - player.currentHeight, player.position.z),
          getYaw: () => player.yaw,
          getFloorLabel: () => (floorManager ? floorManager.state : ""),
        }, { onRosterChange: (n) => updateBadge() });
        updateBadge();
        joinStatusEl.textContent = `Joined room ${code}.`;
        setTimeout(() => modal.classList.remove("show"), 500);
      } catch (e) {
        joinStatusEl.textContent = e && e.message ? e.message : "Couldn't join that room.";
        joinStatusEl.classList.add("error");
        Utils.logError("Multiplayer join failed: " + (e && e.message ? e.message : e));
      }
    };
    joinStartBtn.addEventListener("click", attemptJoin);
    codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") attemptJoin(); });
  }

  window.addEventListener("DOMContentLoaded", async () => {
    init();
    initMultiplayerMenu();

    const startBtn = document.getElementById("startBtn");
    const titlecard = document.getElementById("titlecard");
    const menuMusic = document.getElementById("menuMusic");

    // Autoplay-with-sound is blocked by browsers until a user gesture, so
    // this best-effort play() will usually get rejected on first load —
    // that's expected and silently ignored. The one-time listener below
    // catches the player's very first tap/click ANYWHERE on the page
    // (which happens before they've necessarily clicked "CLICK TO ENTER")
    // and starts the music then instead, so it's never stuck silent.
    const tryPlayMenuMusic = () => {
      if (!menuMusic) return;
      menuMusic.volume = 0.55;
      const p = menuMusic.play();
      if (p && p.catch) p.catch(() => {});
    };
    tryPlayMenuMusic();
    const firstGestureStart = () => {
      tryPlayMenuMusic();
      document.removeEventListener("click", firstGestureStart);
      document.removeEventListener("touchstart", firstGestureStart);
    };
    document.addEventListener("click", firstGestureStart);
    document.addEventListener("touchstart", firstGestureStart);

    /** Fades menuMusic's volume to 0 over `ms`, then pauses it — used
     *  when gameplay actually starts so the menu theme doesn't keep
     *  playing under the level. */
    const fadeOutMenuMusic = (ms) => {
      if (!menuMusic || menuMusic.paused) return;
      const startVol = menuMusic.volume;
      const startTime = performance.now();
      const step = (now) => {
        const t = Math.min((now - startTime) / ms, 1);
        menuMusic.volume = startVol * (1 - t);
        if (t < 1) requestAnimationFrame(step);
        else menuMusic.pause();
      };
      requestAnimationFrame(step);
    };

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
      // Autoplay on page load is usually blocked, so tryPlayMenuMusic()
      // may not have actually started anything yet — this click is a
      // real user gesture, so play() is guaranteed to work here. Fading
      // it out in the SAME tick as starting it made the music start and
      // finish fading to silence almost simultaneously, which was
      // effectively inaudible. Giving play() a beat to actually kick in
      // before fading fixes that.
      tryPlayMenuMusic();
      setTimeout(() => fadeOutMenuMusic(1500), 50);
      if (!("ontouchstart" in window)) renderer.domElement.requestPointerLock();
      start();
    });
  });
})();
