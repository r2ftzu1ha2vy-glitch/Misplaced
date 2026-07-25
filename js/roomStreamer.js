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

  /** Initial build: spawn tile + surrounding radius. Called once before the game starts. */
  buildInitial() {
    this.spawnPoint = new THREE.Vector3(0, 0, 0);
    this._streamAround(0, 0);
    this._lastCenterTx = 0;
    this._lastCenterTz = 0;
    return { colliders: this.colliders, spawnPoint: this.spawnPoint };
  }

  /** Call every frame (cheap early-out) with the player's world position. */
  update(playerPos) {
    const { tx, tz } = this.worldToTile(playerPos.x, playerPos.z);
    if (tx === this._lastCenterTx && tz === this._lastCenterTz) return;
    this._lastCenterTx = tx;
    this._lastCenterTz = tz;
    this._streamAround(tx, tz);
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

  _streamAround(centerTx, centerTz) {
    const radius = GAME_CONFIG.floor1.streamRadius;
    const wanted = new Set();

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const tx = centerTx + dx;
        const tz = centerTz + dz;
        wanted.add(this.tileKey(tx, tz));
        if (!this.tiles.has(this.tileKey(tx, tz))) {
          this._buildTile(tx, tz);
        }
      }
    }

    // Unload tiles outside the wanted set (never unload the exit tile
    // once it exists, so the win room stays reachable/consistent)
    for (const [key, entry] of this.tiles) {
      if (wanted.has(key)) continue;
      if (this.exitPlaced && key === this.tileKey(this.exitTileCoord.tx, this.exitTileCoord.tz)) continue;
      this._unloadTile(key, entry);
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
    this.scene.remove(entry.group);
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
