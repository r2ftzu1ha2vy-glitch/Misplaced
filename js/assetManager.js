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
        node.castShadow = true;
        node.receiveShadow = true;
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
   */
  get(key) {
    const src = this.cache[key];
    if (!src) {
      Utils.logError(`Requested unknown asset key "${key}" (not in cache).`);
      return this._makePlaceholder(key);
    }
    const clone = src.clone(true);
    // Clone materials too so per-instance tweaks (e.g. emissive flicker) don't leak across instances
    clone.traverse((node) => {
      if (node.isMesh && node.material) {
        node.material = Array.isArray(node.material)
          ? node.material.map((m) => m.clone())
          : node.material.clone();
      }
    });
    return clone;
  }

  didFail(key) {
    return this.failed.has(key);
  }
}
