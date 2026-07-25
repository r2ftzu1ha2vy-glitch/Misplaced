/**
 * assetManager.js
 * ---------------------------------------------------------------
 * Loads every .glb declared in GAME_CONFIG.models exactly once,
 * caches the parsed scene, and hands out CLONES to the world so
 * multiple instances (e.g. many cubicles) don't share transforms.
 *
 * If a model fails to load (404, bad path, etc.) we log it clearly
 * and substitute a neutral placeholder box so the room still reads
 * correctly and the game doesn't hard-crash.
 * ---------------------------------------------------------------
 */

class AssetManager {
  constructor() {
    this.loader = new THREE.GLTFLoader();
    this.cache = {};       // key -> THREE.Group (source, never mutate directly)
    this.failed = new Set();
  }

  /**
   * Loads all models declared in config. Reports progress via onProgress(loadedCount, total, label).
   * Resolves once every model has either loaded or failed (never rejects).
   */
  async loadAll(onProgress) {
    const entries = Object.entries(GAME_CONFIG.models);
    const total = entries.length;
    let done = 0;

    const loadOne = ([key, filename]) => {
      const url = GAME_CONFIG.assetBasePath + filename;
      return new Promise((resolve) => {
        this.loader.load(
          url,
          (gltf) => {
            this._prepModel(gltf.scene, key);
            this.cache[key] = gltf.scene;
            done++;
            onProgress && onProgress(done, total, key);
            resolve();
          },
          undefined,
          (err) => {
            this.failed.add(key);
            Utils.logError(`Failed to load "${filename}" (key: ${key}). Using placeholder. ${err && err.message ? err.message : ""}`);
            this.cache[key] = this._makePlaceholder(key);
            done++;
            onProgress && onProgress(done, total, key);
            resolve();
          }
        );
      });
    };

    // Load with modest concurrency to avoid hammering the browser on large batches
    const CONCURRENCY = 4;
    let idx = 0;
    const workers = new Array(Math.min(CONCURRENCY, entries.length)).fill(0).map(async () => {
      while (idx < entries.length) {
        const i = idx++;
        await loadOne(entries[i]);
      }
    });
    await Promise.all(workers);
  }

  _prepModel(root, key) {
    root.traverse((node) => {
      if (node.isMesh) {
        // No light in the scene ever casts a shadow (see roomTiles.js —
        // fixture PointLights are created with castShadow = false), so
        // flagging every single furniture mesh as a shadow caster/receiver
        // was pure dead weight for the renderer's shadow pass. Leaving
        // these off entirely is free performance.
        node.castShadow = false;
        node.receiveShadow = false;
        if (node.material) {
          // Normalize material response to our low-light horror scene
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach((m) => {
            if (m && "envMapIntensity" in m) m.envMapIntensity = 0.6;
          });
        }
      }
    });
    root.userData.assetKey = key;

    // Some source glTFs bake in wrong real-world scale (e.g. a "desk"
    // that measures ~1500 units wide). Correct that first so every
    // downstream measurement (bounding box, footprint) reflects the
    // model's actual real-world size.
    const scaleFix = GAME_CONFIG.modelScaleFixes && GAME_CONFIG.modelScaleFixes[key];
    if (scaleFix && scaleFix !== 1) {
      root.scale.multiplyScalar(scaleFix);
    }

    // Many source glTFs are exported with their pivot at the object's
    // vertical/geometric center rather than its base. Placing those at
    // y=0 buries half the mesh in the floor. Wrap the real geometry in
    // an inner group and shift it up so the OUTER root's origin sits at
    // the model's true floor contact point (min Y of its bounding box).
    // Everything else in the codebase keeps treating `get(key)` as "an
    // object whose origin is its footprint on the ground."
    const box = new THREE.Box3().setFromObject(root);
    if (isFinite(box.min.y)) {
      const size = new THREE.Vector3();
      box.getSize(size);
      root.userData.footprint = { width: size.x, depth: size.z, height: size.y };
      if (Math.abs(box.min.y) > 1e-4) {
        const inner = new THREE.Group();
        inner.name = "originAlign";
        while (root.children.length) inner.add(root.children[0]);
        inner.position.y = -box.min.y;
        root.add(inner);
      }
    }
  }

  _makePlaceholder(key) {
    const geo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x552222, wireframe: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "placeholder_" + key;
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.assetKey = key;
    group.userData.isPlaceholder = true;
    return group;
  }

  /**
   * Returns a fresh clone of a loaded model, safe to add to the scene
   * and transform independently.
   *
   * cloneMaterials defaults to false: most instances (desks, chairs,
   * cabinets, plants...) never touch their material at runtime, so they
   * can all safely share the one material instance loaded from the glTF.
   * That lets Three.js batch/sort draw calls by material instead of
   * juggling a unique material (and unique shader program state) per
   * instance, which was a major source of the lag with dozens of tiles
   * streamed in. Pass cloneMaterials = true only for objects that need
   * independent per-instance material state, like the ceiling light
   * fixtures whose emissive intensity flickers independently.
   */
  get(key, cloneMaterials = false) {
    const src = this.cache[key];
    if (!src) {
      Utils.logError(`Requested unknown asset key "${key}" (not in cache).`);
      return this._makePlaceholder(key);
    }
    const clone = src.clone(true);
    if (cloneMaterials) {
      clone.traverse((node) => {
        if (node.isMesh && node.material) {
          node.material = Array.isArray(node.material)
            ? node.material.map((m) => m.clone())
            : node.material.clone();
        }
      });
    }
    return clone;
  }

  didFail(key) {
    return this.failed.has(key);
  }
}
