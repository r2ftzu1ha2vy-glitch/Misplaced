/**
 * roomStreamer.js
 * ---------------------------------------------------------------
 * Floor 1 as a FIXED grid of persistent room "shells" (floor, walls,
 * ceiling — built once each, never rebuilt) that re-centers on the
 * player's current tile whenever they cross into a new room. Only
 * furniture + room-specific dressing is swapped per tile; the shell
 * geometry itself is reused for the life of the game.
 *
 * Grid size is (2*radius+1)^2 shells — e.g. radius 1 = 3x3 = 9 shells,
 * always exactly covering the player's tile plus its ring of
 * neighbors. When the player moves into a new tile, every shell's
 * *slot* (its position relative to the player) shifts so the tile the
 * player is now standing in becomes the middle slot again — the shell
 * that no longer has a place in the new 3x3 window gets re-skinned
 * and re-furnished as whatever the new window's edge tile needs,
 * instead of being destroyed and a new one instantiated.
 *
 * Rooms are still deterministic (same grid coord -> same room), via
 * the same seeded RNG approach as before, so revisiting a tile later
 * reproduces it exactly.
 * ---------------------------------------------------------------
 */

class RoomStreamer {
  constructor(scene, assets, lighting, atmosphere, onWin) {
    this.scene = scene;
    this.assets = assets;
    this.lighting = lighting;
    this.atmosphere = atmosphere;
    this.onWin = onWin;

    // slots[i] = { group, floorMesh, furnitureGroup, colliders, exitTrigger, tx, tz, roomType,
    //              sdx, sdz }  where sdx/sdz is the slot's FIXED offset from center (never changes).
    this.slots = [];
    this._slotByCoord = new Map(); // "tx,tz" -> slot, only valid tiles currently occupying a slot

    this.colliders = []; // flat list kept in sync for the player controller

    this.exitPlaced = false;
    this.exitTileCoord = null;

    this._centerTx = null;
    this._centerTz = null;

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

  /** Initial build: allocate the fixed grid of shells and furnish them
   *  for the tiles around spawn. Runs during the loading screen. */
  buildInitial() {
    this.spawnPoint = new THREE.Vector3(0, 0, 0);
    this._allocateSlots();
    this._centerTx = 0;
    this._centerTz = 0;
    this._furnishAllSlots();
    return { colliders: this.colliders, spawnPoint: this.spawnPoint };
  }

  /** Creates the fixed set of shell Groups once. Their local slot offsets
   *  (sdx, sdz) never change again — only which tile a slot represents,
   *  and the shell's world position, change as the player moves. */
  _allocateSlots() {
    const radius = GAME_CONFIG.floor1.streamRadius;
    for (let sdx = -radius; sdx <= radius; sdx++) {
      for (let sdz = -radius; sdz <= radius; sdz++) {
        const shell = RoomTiles.buildReusableShell();
        shell.group.name = `Shell_${sdx}_${sdz}`;
        this.scene.add(shell.group);

        const furnitureGroup = new THREE.Group();
        shell.group.add(furnitureGroup);

        this.slots.push({
          group: shell.group,
          floorMesh: shell.floorMesh,
          shellColliders: shell.colliders,
          furnitureGroup,
          colliders: [],       // furniture colliders only, currently active
          exitTrigger: null,
          ceilingLights: [],   // THREE.Light refs, for lighting.unregisterFixture
          tx: null,
          tz: null,
          roomType: null,
          sdx, sdz,
        });
      }
    }
  }

  /** Call every frame (cheap early-out) with the player's world position. */
  update(playerPos) {
    const { tx, tz } = this.worldToTile(playerPos.x, playerPos.z);
    if (tx !== this._centerTx || tz !== this._centerTz) {
      this._centerTx = tx;
      this._centerTz = tz;
      this._recenter();
    }
  }

  /** Returns true + fires onWin once if the player is standing in the exit trigger. */
  checkExitTrigger(playerPos) {
    if (!this.exitPlaced) return false;
    const key = this.tileKey(this.exitTileCoord.tx, this.exitTileCoord.tz);
    const slot = this._slotByCoord.get(key);
    if (!slot || !slot.exitTrigger) return false;

    const size = GAME_CONFIG.floor1.tileSize;
    const worldTriggerX = slot.tx * size + slot.exitTrigger.localPoint.x;
    const worldTriggerZ = slot.tz * size + slot.exitTrigger.localPoint.z;
    const dx = playerPos.x - worldTriggerX;
    const dz = playerPos.z - worldTriggerZ;
    const dist = Math.hypot(dx, dz);
    return dist <= slot.exitTrigger.radius;
  }

  /** Re-centers the fixed grid on the new (this._centerTx, this._centerTz):
   *  every slot's world position moves to (center + its fixed sdx/sdz),
   *  and any slot whose new tile differs from what it was previously
   *  showing gets re-skinned + re-furnished for that tile. Slots whose
   *  tile hasn't changed (the vast majority when moving one tile at a
   *  time) are left completely untouched — no geometry work at all. */
  _recenter() {
    const size = GAME_CONFIG.floor1.tileSize;
    this._slotByCoord.clear();

    for (const slot of this.slots) {
      const newTx = this._centerTx + slot.sdx;
      const newTz = this._centerTz + slot.sdz;

      // Always reposition (cheap) — the shell's world slot follows the
      // player even if its contents don't need to change.
      slot.group.position.set(newTx * size, 0, newTz * size);

      const tileChanged = slot.tx !== newTx || slot.tz !== newTz;
      if (tileChanged) {
        this._furnishSlot(slot, newTx, newTz);
      }

      this._slotByCoord.set(this.tileKey(newTx, newTz), slot);
    }

    this._rebuildColliderList();
  }

  _furnishAllSlots() {
    for (const slot of this.slots) {
      const tx = this._centerTx + slot.sdx;
      const tz = this._centerTz + slot.sdz;
      slot.group.position.set(tx * GAME_CONFIG.floor1.tileSize, 0, tz * GAME_CONFIG.floor1.tileSize);
      this._furnishSlot(slot, tx, tz);
      this._slotByCoord.set(this.tileKey(tx, tz), slot);
    }
    this._rebuildColliderList();
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

  /** Clears whatever furniture a slot currently has and rebuilds it for
   *  (tx, tz): re-skins the shared floor material and refills the
   *  slot's furnitureGroup, without touching wall/ceiling/floor geometry
   *  (that part of the shell is permanent and shared across every tile
   *  that ever occupies this slot). */
  _furnishSlot(slot, tx, tz) {
    this._clearSlotFurniture(slot);

    const seed = Utils.seedFromCoords(tx, tz);
    const rng = Utils.makeRng(seed);
    const roomType = this._pickRoomType(tx, tz, rng);

    // Re-skin the shared floor slab for this room type instead of
    // rebuilding it.
    slot.floorMesh.material = RoomTiles.floorMatForRoomType(roomType);

    slot.furnitureGroup.position.set(0, 0, 0);
    let result;
    switch (roomType) {
      case "meetingRoom":
        result = RoomTiles.buildMeetingRoom(slot.furnitureGroup, this.assets, this.lighting, this.atmosphere, rng, true);
        break;
      case "breakRoom":
        result = RoomTiles.buildBreakRoom(slot.furnitureGroup, this.assets, this.lighting, this.atmosphere, rng, true);
        break;
      case "serverRoom":
        result = RoomTiles.buildServerRoom(slot.furnitureGroup, this.assets, this.lighting, this.atmosphere, rng, true);
        break;
      case "archive":
        result = RoomTiles.buildArchive(slot.furnitureGroup, this.assets, this.lighting, this.atmosphere, rng, true);
        break;
      case "exit":
        result = RoomTiles.buildExitRoom(slot.furnitureGroup, this.assets, this.lighting, this.atmosphere, rng, true);
        this.exitPlaced = true;
        this.exitTileCoord = { tx, tz };
        Utils.logInfo(`Exit room placed at tile (${tx}, ${tz})`);
        break;
      case "cubicleFarm":
      default:
        result = RoomTiles.buildCubicleFarm(slot.furnitureGroup, this.assets, this.lighting, this.atmosphere, rng, true);
        break;
    }

    slot.tx = tx;
    slot.tz = tz;
    slot.roomType = roomType;
    slot.colliders = result.colliders || [];
    slot.exitTrigger = result.exitTrigger || null;

    // Ceiling lights are added straight into furnitureGroup by
    // addCeilingLight() (via lighting.registerFixture), so any
    // PointLights among furnitureGroup's children are this slot's
    // fixtures — track them so _clearSlotFurniture can unregister them
    // next time this slot gets re-furnished.
    slot.ceilingLights = [];
    slot.furnitureGroup.traverse((n) => {
      if (n.isLight) slot.ceilingLights.push(n);
    });
  }

  /** Disposes this slot's current furniture (geometry/materials),
   *  unregisters its ceiling light(s) from the lighting system, and
   *  forgets its atmosphere-eligible objects — mirroring what the old
   *  per-tile _unloadTile() used to do, but scoped to just the
   *  furnitureGroup instead of the whole shell. */
  _clearSlotFurniture(slot) {
    if (slot.tx === null) return; // nothing built yet

    for (const light of slot.ceilingLights) {
      this.lighting.unregisterFixture(light);
    }
    slot.ceilingLights = [];

    this.atmosphere.forgetGroup(slot.furnitureGroup);

    slot.furnitureGroup.traverse((n) => {
      if (n.isMesh) {
        n.geometry && n.geometry.dispose && n.geometry.dispose();
        if (n.material) {
          const ms = Array.isArray(n.material) ? n.material : [n.material];
          ms.forEach((m) => m.dispose && m.dispose());
        }
      }
    });
    while (slot.furnitureGroup.children.length) {
      slot.furnitureGroup.remove(slot.furnitureGroup.children[0]);
    }

    slot.colliders = [];
    slot.exitTrigger = null;
  }

  _rebuildColliderList() {
    const list = [];
    for (const slot of this.slots) {
      list.push(...slot.shellColliders); // floor + walls, shared per slot
      list.push(...slot.colliders);      // current furniture
    }
    this.colliders = list;
  }
}
