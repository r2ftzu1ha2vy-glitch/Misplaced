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
   * Instead of a full symmetric (2r+1)^2 grid, use a small fixed core
   * (the player's tile + its 4 orthogonal neighbors, so nothing pops in
   * right next to you) plus 2 "lookahead" tiles extended further in
   * whatever direction the player is currently walking/facing — so you
   * can always see the next room ahead without paying for a full 3x3
   * (or larger) block most of which sits behind you. The lookahead
   * offsets are recomputed on a cooldown in update() (see
   * _updateLookaheadDir) rather than every frame, so glancing around
   * with the mouse doesn't thrash tile rebuilds — only sustained
   * movement in a new direction shifts the window.
   */
  _coreOffsets() {
    return [
      { sdx: 0, sdz: 0 },
      { sdx: 1, sdz: 0 },
      { sdx: -1, sdz: 0 },
      { sdx: 0, sdz: 1 },
      { sdx: 0, sdz: -1 },
    ];
  }

  _computeOffsetsForDir(dirTx, dirTz) {
    const offsets = this._coreOffsets();
    const key = (o) => o.sdx + "," + o.sdz;
    const seen = new Set(offsets.map(key));
    const reach = GAME_CONFIG.floor1.lookaheadTiles || 2;
    // Extend further out in the current facing/movement direction so
    // the "next room(s)" are always already streamed in.
    for (let step = 2; step <= reach + 1; step++) {
      const o = { sdx: dirTx * (step - 1), sdz: dirTz * (step - 1) };
      const k = key(o);
      if (!seen.has(k)) {
        offsets.push(o);
        seen.add(k);
      }
    }
    return offsets;
  }

  _allocateSlots() {
    this._lookaheadDirTx = 0;
    this._lookaheadDirTz = -1; // default: player starts facing -Z
    this._lastDirCheckPos = null;
    this._dirCooldown = 0;

    const offsets = this._computeOffsetsForDir(this._lookaheadDirTx, this._lookaheadDirTz);
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
    this._updateLookaheadDir(playerPos);
  }

  /**
   * Re-evaluates which direction to extend the lookahead tiles in,
   * based on actual movement (distance travelled since the last check),
   * not raw camera look direction — checked at most twice a second and
   * only acted on once the player has moved a meaningful distance, so
   * turning the mouse to glance sideways never triggers a rebuild; only
   * genuinely walking a new way does.
   */
  _updateLookaheadDir(playerPos) {
    this._dirCooldown -= 1;
    if (this._dirCooldown > 0) return;
    this._dirCooldown = 20; // ~ every 20 update() calls (roughly a third-to-half second at 60fps)

    if (!this._lastDirCheckPos) {
      this._lastDirCheckPos = playerPos.clone();
      return;
    }
    const dx = playerPos.x - this._lastDirCheckPos.x;
    const dz = playerPos.z - this._lastDirCheckPos.z;
    this._lastDirCheckPos = playerPos.clone();

    const moved = Math.hypot(dx, dz);
    if (moved < 0.6) return; // standing still / barely moved — keep current lookahead

    const newDirTx = Math.abs(dx) >= Math.abs(dz) ? Math.sign(dx) : 0;
    const newDirTz = Math.abs(dz) > Math.abs(dx) ? Math.sign(dz) : 0;
    if (newDirTx === 0 && newDirTz === 0) return;
    if (newDirTx === this._lookaheadDirTx && newDirTz === this._lookaheadDirTz) return;

    this._lookaheadDirTx = newDirTx;
    this._lookaheadDirTz = newDirTz;
    this._reassignLookaheadSlots();
  }

  /**
   * Re-tasks whichever slots currently sit at "old" lookahead offsets
   * (i.e. not part of the fixed core) into the new direction's
   * lookahead offsets, re-furnishing them for their new tile coord —
   * same reuse-not-rebuild approach _recenter() already uses for the
   * shell geometry itself.
   */
  _reassignLookaheadSlots() {
    const coreKeys = new Set(this._coreOffsets().map((o) => o.sdx + "," + o.sdz));
    const newOffsets = this._computeOffsetsForDir(this._lookaheadDirTx, this._lookaheadDirTz)
      .filter((o) => !coreKeys.has(o.sdx + "," + o.sdz));

    const size = GAME_CONFIG.floor1.tileSize;
    const freeSlots = this.slots.filter((s) => !coreKeys.has(s.sdx + "," + s.sdz));

    for (let i = 0; i < freeSlots.length && i < newOffsets.length; i++) {
      const slot = freeSlots[i];
      const { sdx, sdz } = newOffsets[i];
      slot.sdx = sdx;
      slot.sdz = sdz;

      const newTx = this._centerTx + sdx;
      const newTz = this._centerTz + sdz;
      slot.group.position.set(newTx * size, 0, newTz * size);

      if (slot.tx !== newTx || slot.tz !== newTz) {
        this._furnishSlot(slot, newTx, newTz);
      }
    }
    this._rebuildSlotByCoord();
    this._rebuildColliderList();
  }

  _rebuildSlotByCoord() {
    this._slotByCoord.clear();
    for (const slot of this.slots) {
      if (slot.tx !== null) this._slotByCoord.set(this.tileKey(slot.tx, slot.tz), slot);
    }
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

  _furnishSlot(slot, tx, tz) {
    this._clearSlotFurniture(slot);

    const seed = Utils.seedFromCoords(tx, tz);
    const rng = Utils.makeRng(seed);
    const roomType = this._pickRoomType(tx, tz, rng);
    const rotationY = this._pickRoomRotation(tx, tz, rng);

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
