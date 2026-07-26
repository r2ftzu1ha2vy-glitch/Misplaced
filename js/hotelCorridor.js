/**
 * hotelCorridor.js
 * ---------------------------------------------------------------
 * Floor 2, level 2 — the endless hotel corridor. Same "fixed shell
 * slots re-centered on the player" streaming strategy as Floor 1's
 * RoomStreamer (see roomStreamer.js for the full rationale), but
 * simplified to a 1D corridor: segments extend only along Z, each
 * with a door on the left (-X) and right (+X) wall. Walking through
 * either door hands off to hotelRooms.js to build/enter one of 5
 * hotel room interiors as a separate sub-scene.
 *
 * The access card (the Floor 2 "win" object) spawns on the floor at
 * a deterministic segment somewhere out along the corridor; walking
 * over it wins the floor, mirroring Floor 1's exit-gate trigger.
 * ---------------------------------------------------------------
 */

const HotelCorridor = (() => {
  const T = () => GAME_CONFIG.hotelCorridor.tileSize;
  const W = () => GAME_CONFIG.hotelCorridor.corridorWidth;
  const H = () => GAME_CONFIG.hotelCorridor.wallHeight;
  const DOOR_W = () => GAME_CONFIG.hotelCorridor.doorWidth;
  const DOOR_H = () => GAME_CONFIG.hotelCorridor.doorHeight;
  const WT = () => GAME_CONFIG.hotelCorridor.wallThickness;

  let _mats = null;
  function mats() {
    if (_mats) return _mats;
    _mats = {
      floor: new THREE.MeshStandardMaterial({ color: 0x3a2a28, roughness: 0.85, metalness: 0.0 }),
      floorRug: new THREE.MeshStandardMaterial({ color: 0x5a1f22, roughness: 0.9, metalness: 0.0 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x584c42, roughness: 0.85, metalness: 0.0 }),
      wallDoorFrame: new THREE.MeshStandardMaterial({ color: 0x2c2420, roughness: 0.6, metalness: 0.1 }),
      ceiling: new THREE.MeshStandardMaterial({ color: 0x241e1a, roughness: 1.0 }),
      doorNumberPlate: new THREE.MeshStandardMaterial({ color: 0xb89a5a, roughness: 0.35, metalness: 0.8, emissive: 0x2a2000, emissiveIntensity: 0.3 }),
      cardGlow: new THREE.MeshStandardMaterial({ color: 0x2a3a55, roughness: 0.5, emissive: 0x1a3a5a, emissiveIntensity: 0.55 }),
    };
    return _mats;
  }

  function box(w, h, d, mat) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  }

  /**
   * Builds one reusable corridor segment shell: floor, ceiling, side
   * walls each with a centered doorway gap (so a wooden_door.glb model
   * can sit in the opening), front/back left open (corridor continues).
   * Segments differ from Floor 1's tiles in that only the LEFT and
   * RIGHT (X) walls have doors — the corridor itself runs along Z with
   * no walls blocking forward/back travel.
   */
  function buildReusableSegment() {
    const size = T();
    const w = W();
    const h = H();
    const wt = WT();
    const doorW = DOOR_W();
    const segLen = (w - doorW) / 2; // unused directly; walls run along Z here

    const group = new THREE.Group();
    const colliders = [];

    const floor = box(w, 0.2, size, mats().floor);
    floor.position.set(0, -0.1, 0);
    group.add(floor);
    colliders.push(floor);

    const rug = box(w * 0.35, 0.02, size, mats().floorRug);
    rug.position.set(0, 0.011, 0);
    group.add(rug);

    const ceiling = box(w, 0.2, size, mats().ceiling);
    ceiling.position.set(0, h + 0.1, 0);
    group.add(ceiling);

    // Left (-X) and right (+X) walls, each with a centered doorway gap
    // along Z (door faces into the corridor at the segment's midpoint).
    const doorGapZ = Math.min(DOOR_W(), size * 0.8);
    const segZLen = (size - doorGapZ) / 2;

    for (const sign of [-1, 1]) {
      const x = sign * (w / 2);

      const segA = box(wt, h, segZLen, mats().wall);
      segA.position.set(x, h / 2, -(doorGapZ / 2 + segZLen / 2));
      group.add(segA);
      colliders.push(segA);

      const segB = box(wt, h, segZLen, mats().wall);
      segB.position.set(x, h / 2, (doorGapZ / 2 + segZLen / 2));
      group.add(segB);
      colliders.push(segB);

      const lintel = box(wt, h - DOOR_H(), doorGapZ, mats().wall);
      lintel.position.set(x, DOOR_H() + (h - DOOR_H()) / 2, 0);
      group.add(lintel);
      colliders.push(lintel);

      // Door frame trim
      const frameTop = box(wt + 0.06, 0.12, doorGapZ + 0.2, mats().wallDoorFrame);
      frameTop.position.set(x, DOOR_H() + 0.06, 0);
      group.add(frameTop);
    }

    const doorSlotsGroup = new THREE.Group();
    group.add(doorSlotsGroup);

    return { group, colliders, floorMesh: floor, doorSlotsGroup, doorGapZ };
  }

  /**
   * Furnishes one segment: places a door model + room-number plate in
   * each of the left/right doorway gaps, and (rarely, deterministically)
   * the access card on the floor. `rng` is seeded per-segment so re-
   * visiting a segment later reproduces the same room numbers/card
   * placement.
   */
  function furnishSegment(slot, assets, seg, rng, isCardSegment) {
    const size = T();
    const doorGapZ = slot.doorGapZ;
    const group = slot.doorSlotsGroup;

    for (const side of [-1, 1]) {
      const x = side * (W() / 2);
      const roomType = _pickRoomType(rng);
      const roomNumber = 100 + Math.abs(seg) * 2 + (side === -1 ? 1 : 2);

      const door = assets.get("woodenDoor");
      const footprint = door.userData.footprint || { width: 1, height: DOOR_H(), depth: 0.1 };
      const scale = DOOR_H() / Math.max(footprint.height, 0.01);
      door.scale.setScalar(scale);
      door.position.set(x, 0, 0);
      door.rotation.y = side === -1 ? -Math.PI / 2 : Math.PI / 2;
      group.add(door);
      // Deliberately NOT pushed into slot.colliders: this door sits
      // exactly in the doorway opening the player is meant to walk
      // through to reach the room-enter trigger just past it. Making it
      // solid blocked the player at the door plane — and since the
      // door mesh has real height, the ground-height raycast used to
      // settle the player's Y position could then find the TOP of the
      // door instead of the corridor floor, which is what caused the
      // player to appear to stand on top of the door instead of
      // walking into the room.

      // Small glowing number plate above the door
      const plate = box(0.28, 0.16, 0.02, mats().doorNumberPlate);
      plate.position.set(x + side * (0.03), DOOR_H() - 0.05, 0.36);
      plate.rotation.y = side === -1 ? -Math.PI / 2 : Math.PI / 2;
      group.add(plate);

      slot.doorTriggers.push({
        localPoint: new THREE.Vector3(x + side * 0.9, 1, 0),
        radius: 1.1,
        side,
        roomType,
        roomNumber,
      });
    }

    slot.cardObj = null;
    if (isCardSegment) {
      const card = assets.get("accessCard", true);
      card.position.set(0, 0.03, 0);
      card.rotation.y = rng() * Math.PI * 2;
      group.add(card);

      const glow = box(1.0, 0.03, 1.0, mats().cardGlow);
      glow.position.set(0, 0.015, 0);
      group.add(glow);

      const light = new THREE.PointLight(0x6fa8ff, 3.5, 5, 1.4);
      light.position.set(0, 1.2, 0);
      group.add(light);

      slot.cardObj = { mesh: card, glow, light };
      slot.cardTriggerLocal = new THREE.Vector3(0, 1, 0);
      slot.cardTriggerRadius = 1.3;
    }
  }

  function _pickRoomType(rng) {
    const types = ["gothicSuite", "loungeRoom", "galleryRoom", "curtainRoom", "emptyRoom"];
    return types[Math.floor(rng() * types.length)];
  }

  return {
    buildReusableSegment,
    furnishSegment,
  };
})();
