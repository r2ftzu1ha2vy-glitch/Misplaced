/**
 * roomStreamer.js
 * ---------------------------------------------------------------
 * Builds Floor 1 as an infinite grid of room tiles (see roomTiles.js)
 * streamed in/out around the player's current position, instead of
 * one fixed-size room. Every tile is deterministic (same grid coord
 * always builds the same room), so streaming a tile back out and
 * back in later produces an identical result.
 *
 * The spawn tile (0,0) is always a Cubicle Farm. An "exit" tile
 * (stairwell to Floor 2) can appear once the player has wandered at
 * least `minTilesFromSpawnForExit` tiles from spawn; exactly one
 * exit tile is ever placed for the whole run.
 * ---------------------------------------------------------------
 */

class RoomStreamer {
  constructor(scene, assets, lighting, atmosphere, onWin) {
    this.scene = scene;
    this.assets = assets;
    this.lighting = lighting;
    this.atmosphere = atmosphere;
    this.onWin = onWin;

    this.tiles = new Map();      // "x,z" -> { group, colliders, exitTrigger, tx, tz }
    this.colliders = [];         // flat list kept in sync for the player controller
    this._colliderTiles = new Map(); // "x,z" -> colliders array reference, for fast removal

    this.exitPlaced = false;
    this.exitTileCoord = null;

    this._lastCenterTx = null;
    this._lastCenterTz = null;

    // Tiles that are wanted but not yet built get queued here instead of
    // built immediately. Crossing into a new area used to call _buildTile
    // for every newly-needed tile back-to-back in one frame — each one
    // clones GLBs, builds walls/colliders, registers lights — so the
    // frame you actually cross a boundary could spike hugely. Now update()
    // builds a small batch off this queue per frame instead, turning one
    // big freeze into several unnoticeable small ones.
    this._buildQueue = [];
    this._queuedSet = new Set();
    this.tilesBuiltPerFrame = 1;

    this.spawnPoint = new THREE.Vector3(0, 0, 0);
  }

  worldToTile(x, z) {
    const size = GAME_CONFIG.floor1.tileSize;
    return {
      tx: Math.round(x / size),
      tz: Math.round(z / size),
    };
  }

  tileKey(tx, tz) {
    return tx + "," + tz;
  }

  /** Initial build: spawn tile + surrounding radius. Called once before the game starts.
   *  Built fully synchronously (not queued) — this happens during the loading
   *  screen, before the player can see anything, so there's no reason to
   *  spread it out. */
  buildInitial() {
    this.spawnPoint = new THREE.Vector3(0, 0, 0);
    this._streamAround(0, 0, /* immediate */ true);
    this._lastCenterTx = 0;
    this._lastCenterTz = 0;
    return { colliders: this.colliders, spawnPoint: this.spawnPoint };
  }

  /** Call every frame (cheap early-out) with the player's world position. */
  update(playerPos) {
    const { tx, tz } = this.worldToTile(playerPos.x, playerPos.z);
    if (tx !== this._lastCenterTx || tz !== this._lastCenterTz) {
      this._lastCenterTx = tx;
      this._lastCenterTz = tz;
      this._streamAround(tx, tz, /* immediate */ false);
    }
    this._drainBuildQueue();
  }

  /** Builds up to tilesBuiltPerFrame queued tiles. Called once per frame from update(). */
  _drainBuildQueue() {
    let n = this.tilesBuiltPerFrame;
    while (n > 0 && this._buildQueue.length > 0) {
      const { tx, tz } = this._buildQueue.shift();
      const key = this.tileKey(tx, tz);
      this._queuedSet.delete(key);
      // Might have streamed back out of range while it sat in the queue
      // (fast player movement) — skip building tiles no one needs anymore.
      if (!this._isWanted(tx, tz)) continue;
      if (this.tiles.has(key)) continue;
      this._buildTile(tx, tz);
      n--;
    }
  }

  _isWanted(tx, tz) {
    const radius = GAME_CONFIG.floor1.streamRadius;
    return Math.abs(tx - this._lastCenterTx) <= radius && Math.abs(tz - this._lastCenterTz) <= radius;
  }

  /** Returns true + fires onWin once if the player is standing in the exit trigger. */
  checkExitTrigger(playerPos) {
    if (!this.exitPlaced) return false;
    const key = this.tileKey(this.exitTileCoord.tx, this.exitTileCoord.tz);
    const entry = this.tiles.get(key);
    if (!entry || !entry.exitTrigger) return false;

    const size = GAME_CONFIG.floor1.tileSize;
    const worldTriggerX = entry.tx * size + entry.exitTrigger.localPoint.x;
    const worldTriggerZ = entry.tz * size + entry.exitTrigger.localPoint.z;
    const dx = playerPos.x - worldTriggerX;
    const dz = playerPos.z - worldTriggerZ;
    const dist = Math.hypot(dx, dz);
    return dist <= entry.exitTrigger.radius;
  }

  _streamAround(centerTx, centerTz, immediate) {
    const radius = GAME_CONFIG.floor1.streamRadius;
    const wanted = new Set();

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const tx = centerTx + dx;
        const tz = centerTz + dz;
        const key = this.tileKey(tx, tz);
        wanted.add(key);
        if (this.tiles.has(key)) continue;

        if (immediate) {
          this._buildTile(tx, tz);
        } else if (!this._queuedSet.has(key)) {
          // Closest tiles first, so the room the player is actually
          // walking into pops in before the ones beside it.
          this._queuedSet.add(key);
          this._buildQueue.push({ tx, tz, dist: Math.abs(dx) + Math.abs(dz) });
        }
      }
    }
    if (!immediate) this._buildQueue.sort((a, b) => a.dist - b.dist);

    // Unload tiles outside the wanted set (never unload the exit tile
    // once it exists, so the win room stays reachable/consistent)
    for (const [key, entry] of this.tiles) {
      if (wanted.has(key)) continue;
      if (this.exitPlaced && key === this.tileKey(this.exitTileCoord.tx, this.exitTileCoord.tz)) continue;
      this._unloadTile(key, entry);
    }

    // Also drop any now-stale queued builds that fell outside the new
    // wanted set before they ever got built.
    if (!immediate) {
      this._buildQueue = this._buildQueue.filter((t) => {
        const keep = wanted.has(this.tileKey(t.tx, t.tz));
        if (!keep) this._queuedSet.delete(this.tileKey(t.tx, t.tz));
        return keep;
      });
    }
  }

  _distFromSpawnTiles(tx, tz) {
    return Math.max(Math.abs(tx), Math.abs(tz));
  }

  _pickRoomType(tx, tz, rng) {
    if (tx === 0 && tz === 0) return "cubicleFarm"; // spawn always a known-safe room

    const dist = this._distFromSpawnTiles(tx, tz);
    const exitEligible = !this.exitPlaced && dist >= GAME_CONFIG.floor1.minTilesFromSpawnForExit;
    if (exitEligible && rng() < GAME_CONFIG.floor1.exitChancePerEligibleTile) {
      return "exit";
    }

    const roll = rng();
    if (roll < 0.34) return "cubicleFarm";
    if (roll < 0.55) return "meetingRoom";
    if (roll < 0.72) return "breakRoom";
    if (roll < 0.88) return "serverRoom";
    return "archive";
  }

  _buildTile(tx, tz) {
    const size = GAME_CONFIG.floor1.tileSize;
    const seed = Utils.seedFromCoords(tx, tz);
    const rng = Utils.makeRng(seed);

    const roomType = this._pickRoomType(tx, tz, rng);

    const group = new THREE.Group();
    group.name = `Tile_${tx}_${tz}_${roomType}`;
    group.position.set(tx * size, 0, tz * size);
    this.scene.add(group);

    let result;
    switch (roomType) {
      case "meetingRoom":
        result = RoomTiles.buildMeetingRoom(group, this.assets, this.lighting, this.atmosphere, rng);
        break;
      case "breakRoom":
        result = RoomTiles.buildBreakRoom(group, this.assets, this.lighting, this.atmosphere, rng);
        break;
      case "serverRoom":
        result = RoomTiles.buildServerRoom(group, this.assets, this.lighting, this.atmosphere, rng);
        break;
      case "archive":
        result = RoomTiles.buildArchive(group, this.assets, this.lighting, this.atmosphere, rng);
        break;
      case "exit":
        result = RoomTiles.buildExitRoom(group, this.assets, this.lighting, this.atmosphere, rng);
        this.exitPlaced = true;
        this.exitTileCoord = { tx, tz };
        Utils.logInfo(`Exit room placed at tile (${tx}, ${tz})`);
        break;
      case "cubicleFarm":
      default:
        result = RoomTiles.buildCubicleFarm(group, this.assets, this.lighting, this.atmosphere, rng);
        break;
    }

    const key = this.tileKey(tx, tz);
    const entry = {
      group,
      colliders: result.colliders || [],
      exitTrigger: result.exitTrigger || null,
      tx, tz,
      roomType,
    };
    this.tiles.set(key, entry);
    this._colliderTiles.set(key, entry.colliders);
    this.colliders.push(...entry.colliders);
  }

  _unloadTile(key, entry) {
    this._queuedSet.delete(key);
    this.scene.remove(entry.group);
    this.atmosphere.forgetGroup(entry.group);
    entry.group.traverse((n) => {
      if (n.isMesh) {
        n.geometry && n.geometry.dispose && n.geometry.dispose();
        if (n.material) {
          const ms = Array.isArray(n.material) ? n.material : [n.material];
          ms.forEach((m) => m.dispose && m.dispose());
        }
      }
    });

    const removeSet = new Set(entry.colliders);
    this.colliders = this.colliders.filter((c) => !removeSet.has(c));

    this.tiles.delete(key);
    this._colliderTiles.delete(key);
  }
}
