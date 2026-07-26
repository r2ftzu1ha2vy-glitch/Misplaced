/**
 * hotelStreamer.js
 * ---------------------------------------------------------------
 * Drives the endless hotel corridor (Floor 2, level 2): streams
 * corridor segments in/out around the player exactly like Floor 1's
 * RoomStreamer but along a single Z axis, and owns the "enter a room
 * through a door" state machine — when the player crosses a door
 * trigger, the corridor is hidden, a HotelRooms interior is built into
 * a separate group, and the player is teleported into it. Walking back
 * through that room's door reverses the swap.
 *
 * The access card win trigger lives on the corridor floor itself (see
 * hotelCorridor.js) and is checked the same way Floor 1 checks its
 * exit gate: a simple world-space distance test each frame.
 * ---------------------------------------------------------------
 */

class HotelStreamer {
  constructor(scene, assets, lighting, onWin) {
    this.scene = scene;
    this.assets = assets;
    this.lighting = lighting;
    this.onWin = onWin;

    this.corridorRoot = new THREE.Group();
    this.corridorRoot.name = "HotelCorridorRoot";
    this.scene.add(this.corridorRoot);

    this.slots = [];
    this._centerSeg = null;

    // Room-interior sub-scene state
    this.inRoom = false;
    this.roomGroup = null;
    this.roomExitInfo = null; // { corridorReturnPos, corridorReturnYaw }
    this._pendingRoomFade = null; // callback set by floorManager to fade for room transitions

    this.colliders = [];
    this.spawnPoint = new THREE.Vector3(0, 0, 0);

    this._cardSeg = this._computeCardSegment();
  }

  _computeCardSegment() {
    const { minSegmentsFromStartForCard: minD, maxSegmentsFromStartForCard: maxD } = GAME_CONFIG.hotelCorridor;
    const rng = Utils.makeRng(0xC0FFEE01);
    const dir = rng() < 0.5 ? -1 : 1;
    const dist = minD + Math.floor(rng() * (maxD - minD));
    return dir * dist;
  }

  worldToSeg(z) {
    return Math.round(z / T());
  }

  buildInitial() {
    this.spawnPoint = new THREE.Vector3(0, 0, 0);
    this._allocateSlots();
    this._centerSeg = 0;
    this._furnishAllSlots();
    return { colliders: this.colliders, spawnPoint: this.spawnPoint };
  }

  _allocateSlots() {
    const radius = GAME_CONFIG.hotelCorridor.streamRadius;
    for (let s = -radius; s <= radius; s++) {
      const shell = HotelCorridor.buildReusableSegment();
      shell.group.name = `CorridorSeg_${s}`;
      this.corridorRoot.add(shell.group);

      this.slots.push({
        group: shell.group,
        floorMesh: shell.floorMesh,
        shellColliders: shell.colliders,
        doorSlotsGroup: shell.doorSlotsGroup,
        doorGapZ: shell.doorGapZ,
        colliders: [],
        doorTriggers: [],
        cardObj: null,
        cardTriggerLocal: null,
        cardTriggerRadius: 0,
        seg: null,
        sOffset: s,
      });
    }
  }

  update(playerPos) {
    if (this.inRoom) return; // corridor doesn't stream while inside a room
    const seg = this.worldToSeg(playerPos.z);
    if (seg !== this._centerSeg) {
      this._centerSeg = seg;
      this._recenter();
    }
  }

  _recenter() {
    const size = T();
    for (const slot of this.slots) {
      const newSeg = this._centerSeg + slot.sOffset;
      slot.group.position.set(0, 0, newSeg * size);
      if (slot.seg !== newSeg) {
        this._furnishSlot(slot, newSeg);
      }
    }
    this._rebuildColliderList();
  }

  _furnishAllSlots() {
    for (const slot of this.slots) {
      const seg = this._centerSeg + slot.sOffset;
      slot.group.position.set(0, 0, seg * T());
      this._furnishSlot(slot, seg);
    }
    this._rebuildColliderList();
  }

  _furnishSlot(slot, seg) {
    this._clearSlotFurniture(slot);
    const rng = Utils.makeRng(Utils.seedFromCoords(seg, 7331));
    const isCardSegment = seg === this._cardSeg;
    HotelCorridor.furnishSegment(slot, this.assets, seg, rng, isCardSegment);
    slot.seg = seg;
    slot.colliders = slot.colliders || [];
  }

  _clearSlotFurniture(slot) {
    if (slot.seg === null) { slot.colliders = []; slot.doorTriggers = []; return; }
    slot.doorSlotsGroup.traverse((n) => {
      if (n.isMesh) {
        n.geometry && n.geometry.dispose && n.geometry.dispose();
        if (n.material) {
          const ms = Array.isArray(n.material) ? n.material : [n.material];
          ms.forEach((m) => m.dispose && m.dispose());
        }
      }
      if (n.isLight && n !== slot.doorSlotsGroup) {
        // point lights get GC'd with the group removal; nothing to unregister
        // here since corridor lights aren't part of the flicker system.
      }
    });
    while (slot.doorSlotsGroup.children.length) {
      slot.doorSlotsGroup.remove(slot.doorSlotsGroup.children[0]);
    }
    slot.colliders = [];
    slot.doorTriggers = [];
    slot.cardObj = null;
  }

  _rebuildColliderList() {
    const list = [];
    for (const slot of this.slots) {
      list.push(...slot.shellColliders);
      list.push(...slot.colliders);
    }
    this.colliders = list;
  }

  /**
   * Returns the nearest door trigger (world-space) the player is inside,
   * or null. Called every frame by floorManager to detect "walked
   * through a door" and trigger the room-enter transition.
   */
  findDoorTrigger(playerPos) {
    for (const slot of this.slots) {
      if (slot.seg === null) continue;
      for (const trig of slot.doorTriggers) {
        const worldX = trig.localPoint.x;
        const worldZ = slot.seg * T() + trig.localPoint.z;
        const dx = playerPos.x - worldX;
        const dz = playerPos.z - worldZ;
        if (Math.hypot(dx, dz) <= trig.radius) {
          return trig;
        }
      }
    }
    return null;
  }

  checkCardTrigger(playerPos) {
    for (const slot of this.slots) {
      if (slot.seg === null || !slot.cardObj) continue;
      const worldX = 0;
      const worldZ = slot.seg * T();
      const dx = playerPos.x - worldX;
      const dz = playerPos.z - worldZ;
      if (Math.hypot(dx, dz) <= slot.cardTriggerRadius) return true;
    }
    return false;
  }

  /** Hides the corridor and builds/enters a room interior. Returns the
   *  local-space spawn point the caller should place the player at
   *  (already converted to world space here since the room group sits
   *  at a fixed world offset far from the corridor, to guarantee no
   *  overlap with streamed corridor geometry). */
  enterRoom(roomType, corridorReturnWorldPos) {
    this.corridorRoot.visible = false;

    this.roomGroup = new THREE.Group();
    this.roomGroup.name = "HotelRoomInterior";
    // Park the room far off in +X so it never spatially overlaps the
    // corridor's collider list (both are simultaneously in the scene
    // graph; only the corridor's VISIBILITY is toggled, not removal —
    // removal/rebuild per room entry would be needlessly expensive for
    // something entered/exited repeatedly).
    this.roomGroup.position.set(5000, 0, 0);
    this.scene.add(this.roomGroup);

    const rng = Utils.makeRng(Utils.seedFromCoords(Math.round(corridorReturnWorldPos.z), roomType.length));
    const result = HotelRooms.build(roomType, this.roomGroup, this.assets, this.lighting, rng);

    this.inRoom = true;
    this.roomColliders = result.colliders;
    this.roomLights = result.lights || [];
    this.roomExitInfo = {
      corridorReturnWorldPos: corridorReturnWorldPos.clone(),
      doorLocalWorld: result.doorLocal.clone().add(this.roomGroup.position),
    };

    this.colliders = this.roomColliders;

    return result.spawnPoint.clone().add(this.roomGroup.position);
  }

  /** Returns true if the player is standing near the room's own door
   *  (i.e. they've walked back to the doorway and should be returned
   *  to the corridor). */
  checkRoomExitTrigger(playerPos) {
    if (!this.inRoom || !this.roomExitInfo) return false;
    const d = playerPos.distanceTo(this.roomExitInfo.doorLocalWorld);
    return d <= 1.2;
  }

  /** Reverses enterRoom(): disposes the room group, restores the
   *  corridor's visibility/colliders, and returns the world position
   *  the player should be placed at back in the corridor. */
  exitRoom() {
    if (this.roomLights && this.roomLights.length) {
      for (const light of this.roomLights) this.lighting.unregisterFixture(light);
      this.roomLights = [];
    }
    if (this.roomGroup) {
      this.roomGroup.traverse((n) => {
        if (n.isMesh) {
          n.geometry && n.geometry.dispose && n.geometry.dispose();
          if (n.material) {
            const ms = Array.isArray(n.material) ? n.material : [n.material];
            ms.forEach((m) => m.dispose && m.dispose());
          }
        }
      });
      this.scene.remove(this.roomGroup);
      this.roomGroup = null;
    }
    this.corridorRoot.visible = true;
    this.inRoom = false;
    this._rebuildColliderList();

    const returnPos = this.roomExitInfo ? this.roomExitInfo.corridorReturnWorldPos.clone() : new THREE.Vector3(0, 0, 0);
    this.roomExitInfo = null;
    return returnPos;
  }
}

function T() { return GAME_CONFIG.hotelCorridor.tileSize; }
