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

    this.slots = [];
    this._slotByCoord = new Map();
    // slot -> {tx, tz} — tiles that need their (expensive) furniture
    // actually built, processed a few at a time in _processFurnishQueue
    // instead of all at once. See _coreOffsets' comment for why.
    this._furnishQueue = new Map();

    this.colliders = [];

    this.exitGateCoords = this._computeExitGateCoords();
    this._exitCoordKeys = new Set(this.exitGateCoords.map((c) => this.tileKey(c.tx, c.tz)));

    this._centerTx = null;
    this._centerTz = null;

    this.spawnPoint = new THREE.Vector3(0, 0, 0);
  }

  _computeExitGateCoords() {
    const { minTilesFromSpawnForExit: minD, maxTilesFromSpawnForExit: maxD, exitGateCount } = GAME_CONFIG.floor1;
    const rng = Utils.makeRng(0xE817E17E);
    const coords = [];
    let attempts = 0;

    while (coords.length < exitGateCount && attempts < 5000) {
      attempts++;
      const angle = rng() * Math.PI * 2;
      const radius = minD + rng() * (maxD - minD);
      const tx = Math.round(Math.cos(angle) * radius);
      const tz = Math.round(Math.sin(angle) * radius);

      const distFromSpawn = this._distFromSpawnTiles(tx, tz);
      if (distFromSpawn < minD || distFromSpawn > maxD) continue;

      const tooCloseToOther = coords.some(
        (c) => this._distFromSpawnTiles(tx - c.tx, tz - c.tz) < minD
      );
      if (tooCloseToOther) continue;

      coords.push({ tx, tz });
    }

    return coords;
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

  buildInitial() {
    this.spawnPoint = new THREE.Vector3(0, 0, 0);
    this._allocateSlots();
    this._centerTx = 0;
    this._centerTz = 0;
    this._furnishAllSlots();
    // See hotelStreamer.js's enterRoom() for the full explanation: any
    // freshly-added mesh only gets a correct matrixWorld once the
    // renderer's next render() pass runs, but main.js immediately
    // raycasts against these colliders (via
    // PlayerController._groundHeightAt) on the very first frame to
    // settle the player onto the floor. Forcing the update here closes
    // that gap.
    for (const slot of this.slots) slot.group.updateMatrixWorld(true);
    return { colliders: this.colliders, spawnPoint: this.spawnPoint };
  }

  /**
   * Full, static (2*1+1)^2 = 3x3 grid centered on the player's tile —
   * every tile touching the player's tile (including diagonals) is
   * always a live streamed slot. This used to be trimmed down to a
   * fixed core (just the 4 orthogonal neighbors) plus a direction-
   * biased lookahead to save on furniture/light cost, but that meant
   * diagonal tiles were never actually streamed in — visible the
   * instant a doorway lined up so you could see two rooms deep (e.g.
   * standing in the center tile looking through the north room's own
   * side door into the north-west tile), which reads as an obvious
   * "unloaded room" hole instead of the level feeling infinite.
   * Keeping the full 3x3 window guarantees there's no direction you
   * can look in from your own tile that exposes a not-yet-streamed
   * tile. Frame cost is now managed via a time-sliced furnish queue
   * (see _queueFurnish/_processFurnishQueue) instead of shrinking the
   * grid, so rebuilding several tiles' worth of furniture after a move
   * never has to happen in a single frame.
   */
  _coreOffsets() {
    const offsets = [];
    for (let sdx = -1; sdx <= 1; sdx++) {
      for (let sdz = -1; sdz <= 1; sdz++) {
        offsets.push({ sdx, sdz });
      }
    }
    return offsets;
  }

  _allocateSlots() {
    const offsets = this._coreOffsets();
    for (const { sdx, sdz } of offsets) {
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
          colliders: [],
          exitTrigger: null,
          ceilingLights: [],
          tx: null,
          tz: null,
          roomType: null,
          sdx, sdz,
        });
    }
  }

  update(playerPos) {
    const { tx, tz } = this.worldToTile(playerPos.x, playerPos.z);
    if (tx !== this._centerTx || tz !== this._centerTz) {
      this._centerTx = tx;
      this._centerTz = tz;
      this._recenter();
    }
    this._processFurnishQueue();
  }

  /**
   * Time-sliced furniture building: _recenter() clears out any slot
   * whose tile changed immediately (cheap — just disposal + a floor
   * material swap) but defers the actual furniture construction (asset
   * cloning, collider setup, RNG room layout — the expensive part) to
   * here, spread across a handful of frames instead of however many
   * tiles changed in one go. Crossing a single tile boundary can
   * reassign up to 3 slots at once in a 3x3 grid (a whole trailing
   * edge), and a diagonal step can reassign 5 — building all of those
   * synchronously in one frame is exactly the kind of frame-time spike
   * that reads as "lag" when you cross into a new room. Budget is
   * small enough to be invisible (each slot is well outside the fog
   * line, mid-clear, when its turn comes up) but big enough that the
   * queue never meaningfully falls behind normal walking speed.
   */
  _queueFurnish(slot, tx, tz) {
    this._furnishQueue.set(slot, { tx, tz });
  }

  _processFurnishQueue() {
    if (this._furnishQueue.size === 0) return;
    let budget = GAME_CONFIG.floor1.furnishPerFrame || 2;
    let rebuiltAny = false;

    for (const [slot, job] of this._furnishQueue) {
      if (budget <= 0) break;
      this._furnishQueue.delete(slot);
      // The slot may have been reassigned again (e.g. player doubled
      // back) before this job came up — only build it if it's still
      // the tile we queued it for.
      if (slot.tx === job.tx && slot.tz === job.tz) {
        this._buildSlotFurniture(slot, job.tx, job.tz);
        rebuiltAny = true;
      }
      budget--;
    }

    if (rebuiltAny) this._rebuildColliderList();
  }

  /** Public lookup for "what room type is the player standing in right
   *  now" — used by monsterSystem.js (N-tity needs to know if the
   *  player is inside its 6-cabinet home room). Returns null if the
   *  tile isn't currently a live streamed slot. */
  getRoomTypeAt(x, z) {
    const { tx, tz } = this.worldToTile(x, z);
    const slot = this._slotByCoord.get(this.tileKey(tx, tz));
    return slot ? slot.roomType : null;
  }

  checkExitTrigger(playerPos) {
    for (const gate of this.exitGateCoords) {
      const key = this.tileKey(gate.tx, gate.tz);
      const slot = this._slotByCoord.get(key);
      if (!slot || !slot.exitTrigger) continue;

      const size = GAME_CONFIG.floor1.tileSize;
      const rotationY = slot.furnitureGroup ? slot.furnitureGroup.rotation.y : 0;
      const cos = Math.cos(rotationY);
      const sin = Math.sin(rotationY);
      const lx = slot.exitTrigger.localPoint.x;
      const lz = slot.exitTrigger.localPoint.z;
      const rotatedX = lx * cos + lz * sin;
      const rotatedZ = -lx * sin + lz * cos;

      const worldTriggerX = slot.tx * size + rotatedX;
      const worldTriggerZ = slot.tz * size + rotatedZ;
      const dx = playerPos.x - worldTriggerX;
      const dz = playerPos.z - worldTriggerZ;
      const dist = Math.hypot(dx, dz);
      if (dist <= slot.exitTrigger.radius) return true;
    }
    return false;
  }

  _recenter() {
    const size = GAME_CONFIG.floor1.tileSize;
    this._slotByCoord.clear();

    for (const slot of this.slots) {
      const newTx = this._centerTx + slot.sdx;
      const newTz = this._centerTz + slot.sdz;

      slot.group.position.set(newTx * size, 0, newTz * size);

      const tileChanged = slot.tx !== newTx || slot.tz !== newTz;
      if (tileChanged) {
        // Don't touch the furniture yet — the OLD room's furniture stays
        // exactly where it is (now sitting at the new slot position)
        // until the new room is actually built and ready to swap in.
        // Only the coordinate is updated now, so lookups (exit triggers,
        // N-tity's room-type check) reflect the new tile immediately;
        // the visible swap happens atomically inside _buildSlotFurniture
        // once its queued turn comes up (see _processFurnishQueue).
        slot.tx = newTx;
        slot.tz = newTz;
        slot.roomType = null; // pending — set once its furnish job actually runs
        this._queueFurnish(slot, newTx, newTz);
      }

      this._slotByCoord.set(this.tileKey(newTx, newTz), slot);
    }

    this._rebuildColliderList();
  }

  _furnishAllSlots() {
    // Initial build happens synchronously (no queue) — this only runs
    // once, before the title screen's "CLICK TO ENTER", so there's no
    // frame-time budget to protect yet and the player needs a fully
    // furnished spawn tile the instant they start.
    for (const slot of this.slots) {
      const tx = this._centerTx + slot.sdx;
      const tz = this._centerTz + slot.sdz;
      slot.group.position.set(tx * GAME_CONFIG.floor1.tileSize, 0, tz * GAME_CONFIG.floor1.tileSize);
      this._buildSlotFurniture(slot, tx, tz);
      this._slotByCoord.set(this.tileKey(tx, tz), slot);
    }
    this._rebuildColliderList();
  }

  _distFromSpawnTiles(tx, tz) {
    return Math.max(Math.abs(tx), Math.abs(tz));
  }

  _pickRoomType(tx, tz, rng) {
    if (tx === 0 && tz === 0) return "cubicleFarm";

    if (this._exitCoordKeys.has(this.tileKey(tx, tz))) return "exit";

    const roll = rng();
    if (roll < 0.34) return "cubicleFarm";
    if (roll < 0.55) return "meetingRoom";
    if (roll < 0.72) return "breakRoom";
    if (roll < 0.88) return "serverRoom";
    return "archive";
  }

  _pickRoomRotation(tx, tz, rng) {
    const steps = Math.floor(rng() * 4);
    return steps * (Math.PI / 2);
  }

  /** Does the actual (relatively expensive) room-layout work: RNG room
   *  type/rotation pick, asset cloning, collider/light setup. Called
   *  either synchronously for the initial spawn furnish (_furnishAllSlots)
   *  or later, spread across frames, from _processFurnishQueue. Callers
   *  are responsible for clearing any previous furniture first (see
   *  _recenter) — this only builds, it doesn't tear down. */
  _buildSlotFurniture(slot, tx, tz) {
    const seed = Utils.seedFromCoords(tx, tz);
    const rng = Utils.makeRng(seed);
    const roomType = this._pickRoomType(tx, tz, rng);
    const rotationY = this._pickRoomRotation(tx, tz, rng);

    // Old furniture (if any) is only torn down right here, immediately
    // before the new furniture goes up in the same synchronous call —
    // so there's never a frame where the slot sits empty/bare. It's a
    // swap, not a remove-then-load.
    this._clearSlotFurniture(slot);

    slot.floorMesh.material = RoomTiles.floorMatForRoomType(roomType);

    slot.furnitureGroup.position.set(0, 0, 0);
    slot.furnitureGroup.rotation.set(0, rotationY, 0);
    let result;
    switch (roomType) {
      case "meetingRoom":
        result = RoomTiles.buildMeetingRoom(slot.furnitureGroup, this.assets, this.lighting, this.atmosphere, rng, true);
        break;
      case "breakRoom":
        result = RoomTiles.buildBreakRoom(slot.furnitureGroup, this.assets, this.lighting, this.atmosphere, rng, true);
        break;
      case "serverRoom":
        result = RoomTiles.buildServerRoom(slot.furnitureGroup, this.assets, this.lighting, this.atmosphere, rng, true, tx, tz);
        break;
      case "archive":
        result = RoomTiles.buildArchive(slot.furnitureGroup, this.assets, this.lighting, this.atmosphere, rng, true, tx, tz);
        break;
      case "exit":
        result = RoomTiles.buildExitRoom(slot.furnitureGroup, this.assets, this.lighting, this.atmosphere, rng, true);
        Utils.logInfo(`Exit gate room built at tile (${tx}, ${tz})`);
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

    slot.ceilingLights = [];
    slot.furnitureGroup.traverse((n) => {
      if (n.isLight) slot.ceilingLights.push(n);
    });
  }

  _clearSlotFurniture(slot) {
    if (slot.tx === null) return;

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
      list.push(...slot.shellColliders);
      list.push(...slot.colliders);
    }
    this.colliders = list;
  }
}
