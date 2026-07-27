/**
 * multiplayer.js
 * ---------------------------------------------------------------
 * Realtime multiplayer using the Firebase Realtime Database (RTDB),
 * loaded on demand only if the player picks "Multiplayer" from the
 * main menu. Two players (or more — nothing here caps it at 2) join
 * the SAME 4-character room code and see each other moving around in
 * real time.
 *
 * How it works:
 *  - Host clicks "Create Room" -> we generate a random 4-char code and
 *    write rooms/{code}/meta = { createdAt, host }.
 *  - Joiner clicks "Join Room", types the code -> we check
 *    rooms/{code}/meta exists.
 *  - Once in a room, both clients write their own live state to
 *    rooms/{code}/players/{myPlayerId} several times a second:
 *      { x, y, z, yaw, floor, ts }
 *    and listen to every OTHER player's node under the same path.
 *  - onDisconnect() removes our own node automatically if the tab
 *    closes/crashes, so stale players don't linger in the room.
 *  - Each remote player is rendered as a clone of assets/player/player.glb
 *    (loaded separately from the level's AssetManager, since it's only
 *    needed in multiplayer), position/rotation smoothed toward the
 *    latest network snapshot instead of snapping every update.
 *
 * This file intentionally has ZERO dependency on any specific floor's
 * geometry — it only ever touches player.position/yaw and a group of
 * remote-avatar meshes added straight to the main scene, so it works
 * unmodified across Floor 1, the lobby, and Floor 2.
 * ---------------------------------------------------------------
 */

const Multiplayer = (() => {
  const cfg = () => GAME_CONFIG.multiplayer;

  let app = null, db = null;
  let sdkLoadPromise = null;

  let roomCode = null;
  let myId = null;
  let myRef = null;
  let playersRef = null;
  let isHost = false;

  let scene = null;
  let avatarSourceGlb = null; // cached THREE.Group loaded once from player.glb
  let avatarLoadPromise = null;

  const remotePlayers = new Map(); // id -> { group, target:{x,y,z,yaw}, lastSeen, nameTag }

  let sendAccumulator = 0;
  let localGetters = null; // { getPosition, getYaw, getFloorLabel } set by connect()

  let onRosterChange = null; // optional callback(count) for UI

  function _log(msg) { Utils.logInfo("[Multiplayer] " + msg); }
  function _err(msg) { Utils.logError("[Multiplayer] " + msg); }

  /** Loads the Firebase compat SDKs (app + database) from the CDN the
   *  first time multiplayer is actually used, so single-player never
   *  pays for it. Resolves once `firebase` is available globally. */
  function _loadSdk() {
    if (sdkLoadPromise) return sdkLoadPromise;
    sdkLoadPromise = new Promise((resolve, reject) => {
      if (window.firebase && window.firebase.database) return resolve();
      const scripts = [
        "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
        "https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js",
      ];
      let remaining = scripts.length;
      let failed = false;
      scripts.forEach((src) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => { remaining--; if (remaining === 0 && !failed) resolve(); };
        s.onerror = () => { failed = true; reject(new Error("Failed to load Firebase SDK: " + src)); };
        document.head.appendChild(s);
      });
    });
    return sdkLoadPromise;
  }

  function _initFirebase() {
    if (db) return db;
    const fc = cfg().firebaseConfig;
    if (!fc || !fc.databaseURL) {
      throw new Error(
        "Firebase isn't configured yet. Fill in GAME_CONFIG.multiplayer.firebaseConfig " +
        "in js/config.js with your Firebase project's web SDK config (see comment there)."
      );
    }
    app = window.firebase.apps && window.firebase.apps.length
      ? window.firebase.app()
      : window.firebase.initializeApp(fc);
    db = window.firebase.database();
    return db;
  }

  function _randomCode() {
    const chars = cfg().roomCodeChars;
    const len = cfg().roomCodeLength;
    let out = "";
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function _randomPlayerId() {
    return "p" + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Creates a brand-new room with a fresh random code, retrying on the
   * (very unlikely) chance of a collision with an already-live room.
   * Resolves with the room code string.
   */
  async function createRoom() {
    await _loadSdk();
    _initFirebase();

    for (let attempt = 0; attempt < 8; attempt++) {
      const code = _randomCode();
      const roomRef = db.ref("rooms/" + code + "/meta");
      const snap = await roomRef.get();
      if (snap.exists()) continue; // collision, try again
      await roomRef.set({ createdAt: window.firebase.database.ServerValue.TIMESTAMP });
      isHost = true;
      _log("Created room " + code);
      return code;
    }
    throw new Error("Could not allocate a free room code, try again.");
  }

  /** Verifies a room code exists. Resolves true/false. */
  async function roomExists(code) {
    await _loadSdk();
    _initFirebase();
    const snap = await db.ref("rooms/" + code.toUpperCase() + "/meta").get();
    return snap.exists();
  }

  /**
   * Joins (or, if you already called createRoom(), enters) a room and
   * starts broadcasting/listening. `getters` supplies live read access
   * to the local player's state each frame without this module needing
   * to know anything about PlayerController/FloorManager internals:
   *   { getPosition: () => THREE.Vector3, getYaw: () => number,
   *     getFloorLabel: () => string }
   */
  async function connect(code, sceneRef, getters, opts) {
    await _loadSdk();
    _initFirebase();

    roomCode = code.toUpperCase();
    scene = sceneRef;
    localGetters = getters;
    onRosterChange = (opts && opts.onRosterChange) || null;
    myId = _randomPlayerId();

    const exists = await roomExists(roomCode);
    if (!exists) {
      if (isHost) {
        // We created it ourselves a moment ago — fine, meta may just
        // not have propagated to this read yet on a slow connection.
      } else {
        throw new Error(`Room "${roomCode}" doesn't exist.`);
      }
    }

    playersRef = db.ref("rooms/" + roomCode + "/players");
    myRef = playersRef.child(myId);

    // Auto-cleanup: if this tab closes, crashes, or loses connection,
    // Firebase removes our node server-side without us doing anything.
    myRef.onDisconnect().remove();

    // Listen for every other player's live state.
    playersRef.on("child_added", _onPlayerSnapshot);
    playersRef.on("child_changed", _onPlayerSnapshot);
    playersRef.on("child_removed", (snap) => _removeRemote(snap.key));

    await _ensureAvatarLoaded();

    _log(`Joined room ${roomCode} as ${myId}`);
    return roomCode;
  }

  function _onPlayerSnapshot(snap) {
    if (snap.key === myId) return; // never render ourselves
    const data = snap.val();
    if (!data) return;
    _upsertRemote(snap.key, data);
  }

  async function _ensureAvatarLoaded() {
    if (avatarSourceGlb) return avatarSourceGlb;
    if (avatarLoadPromise) return avatarLoadPromise;
    avatarLoadPromise = new Promise((resolve, reject) => {
      const loader = new THREE.GLTFLoader();
      const pm = GAME_CONFIG.playerModel;
      loader.load(
        GAME_CONFIG.assetBasePathPlayer + pm.file,
        (gltf) => {
          const root = gltf.scene;
          root.traverse((n) => {
            if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; }
          });
          if (pm.scaleFix && pm.scaleFix !== 1) root.scale.multiplyScalar(pm.scaleFix);
          // player.glb is authored facing local -Z (glTF/Three.js default).
          // Rotate it so its front faces +X to match the game's forward axis.
          root.rotation.y += Math.PI / 2;
          // Same footprint/origin-align trick as AssetManager._prepModel,
          // kept local here since multiplayer avatars load independently
          // of the level's AssetManager (they're not part of any floor).
          const box = new THREE.Box3().setFromObject(root);
          if (isFinite(box.min.y) && Math.abs(box.min.y) > 1e-4) {
            const inner = new THREE.Group();
            while (root.children.length) inner.add(root.children[0]);
            inner.position.y = -box.min.y;
            root.add(inner);
          }
          avatarSourceGlb = root;
          resolve(root);
        },
        undefined,
        (err) => {
          _err("Failed to load player.glb — remote players will show as a placeholder capsule. " + (err && err.message ? err.message : err));
          const geo = new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.32, 1.1, 4, 8) : new THREE.CylinderGeometry(0.32, 0.32, 1.75, 8);
          const mat = new THREE.MeshStandardMaterial({ color: 0x7a3a3a });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.y = 0.9;
          const group = new THREE.Group();
          group.add(mesh);
          avatarSourceGlb = group;
          resolve(group);
        }
      );
    });
    return avatarLoadPromise;
  }

  function _makeAvatarInstance(id) {
    const clone = avatarSourceGlb.clone(true);
    clone.traverse((n) => {
      if (n.isMesh && n.material) {
        n.material = Array.isArray(n.material)
          ? n.material.map((m) => m.clone())
          : n.material.clone();
      }
    });

    const nameTag = _makeNameTagSprite(id);
    nameTag.position.set(0, 2.05, 0);
    clone.add(nameTag);

    scene.add(clone);
    return { group: clone, nameTag };
  }

  function _makeNameTagSprite(id) {
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(0,0,0,0.0)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "bold 34px sans-serif";
    ctx.fillStyle = "rgba(230,230,225,0.9)";
    ctx.textAlign = "center";
    ctx.fillText(id.replace(/^p/, "").slice(0, 6).toUpperCase(), canvas.width / 2, 42);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.1, 0.28, 1);
    sprite.renderOrder = 999;
    return sprite;
  }

  function _upsertRemote(id, data) {
    let rp = remotePlayers.get(id);
    if (!rp) {
      if (!avatarSourceGlb) {
        // Avatar model isn't ready yet — buffer the latest snapshot and
        // create the visible instance once it loads.
        _ensureAvatarLoaded().then(() => _upsertRemote(id, data));
        return;
      }
      const inst = _makeAvatarInstance(id);
      rp = {
        group: inst.group,
        nameTag: inst.nameTag,
        target: { x: data.x, y: data.y || 0, z: data.z, yaw: data.yaw || 0 },
        current: { x: data.x, y: data.y || 0, z: data.z, yaw: data.yaw || 0 },
        floor: data.floor || "",
        lastSeen: performance.now(),
      };
      rp.group.position.set(data.x, data.y || 0, data.z);
      rp.group.rotation.y = data.yaw || 0;
      remotePlayers.set(id, rp);
      if (onRosterChange) onRosterChange(remotePlayers.size);
      _log(`${id} appeared in the room.`);
      return;
    }
    rp.target.x = data.x;
    rp.target.y = data.y || 0;
    rp.target.z = data.z;
    rp.target.yaw = data.yaw || 0;
    rp.floor = data.floor || rp.floor;
    rp.lastSeen = performance.now();
  }

  function _removeRemote(id) {
    const rp = remotePlayers.get(id);
    if (!rp) return;
    if (rp.group && rp.group.parent) rp.group.parent.remove(rp.group);
    remotePlayers.delete(id);
    if (onRosterChange) onRosterChange(remotePlayers.size);
    _log(`${id} left the room.`);
  }

  /** Call every frame once connected. Pushes our own state at
   *  sendRateHz and smooths every remote avatar toward its latest
   *  network snapshot. */
  function update(dt) {
    if (!myRef || !localGetters) return;

    sendAccumulator += dt;
    const interval = 1 / cfg().sendRateHz;
    if (sendAccumulator >= interval) {
      sendAccumulator = 0;
      const pos = localGetters.getPosition();
      const yaw = localGetters.getYaw();
      const floorLabel = localGetters.getFloorLabel ? localGetters.getFloorLabel() : "";
      myRef.set({
        x: pos.x, y: pos.y, z: pos.z, yaw,
        floor: floorLabel,
        ts: Date.now(),
      }).catch((e) => _err("Position update failed: " + (e && e.message ? e.message : e)));
    }

    const now = performance.now();
    const staleMs = cfg().staleTimeoutSec * 1000;
    const smoothing = 1 - Math.exp(-14 * dt); // fixed, snappy-but-smooth lerp

    for (const [id, rp] of remotePlayers) {
      if (now - rp.lastSeen > staleMs) {
        _removeRemote(id);
        continue;
      }
      rp.current.x = Utils.lerp(rp.current.x, rp.target.x, smoothing);
      rp.current.y = Utils.lerp(rp.current.y, rp.target.y, smoothing);
      rp.current.z = Utils.lerp(rp.current.z, rp.target.z, smoothing);
      // Shortest-path yaw lerp so avatars don't spin the long way around
      // when crossing the -PI/PI wrap.
      let dyaw = rp.target.yaw - rp.current.yaw;
      dyaw = ((dyaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      rp.current.yaw += dyaw * smoothing;

      rp.group.position.set(rp.current.x, rp.current.y, rp.current.z);
      rp.group.rotation.y = rp.current.yaw;
      if (rp.nameTag) rp.nameTag.lookAt(rp.nameTag.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, 1)));
    }
  }

  function getPlayerCount() {
    return remotePlayers.size + (myRef ? 1 : 0);
  }

  function getRoomCode() {
    return roomCode;
  }

  function isConnected() {
    return !!myRef;
  }

  /** Leaves the room cleanly (removes our own node immediately instead
   *  of waiting for onDisconnect) and tears down every remote avatar. */
  function disconnect() {
    if (myRef) {
      myRef.onDisconnect().cancel();
      myRef.remove().catch(() => {});
    }
    if (playersRef) {
      playersRef.off("child_added", _onPlayerSnapshot);
      playersRef.off("child_changed", _onPlayerSnapshot);
      playersRef.off("child_removed");
    }
    for (const id of Array.from(remotePlayers.keys())) _removeRemote(id);
    myRef = null;
    playersRef = null;
    roomCode = null;
    isHost = false;
    _log("Disconnected from room.");
  }

  return {
    createRoom,
    roomExists,
    connect,
    update,
    disconnect,
    isConnected,
    getPlayerCount,
    getRoomCode,
  };
})();
