/**
 * hotelCorridor.js
 * ---------------------------------------------------------------
 * Defines a single reusable hotel-corridor SEGMENT: the physical
 * shell (floor/ceiling/walls, tileSize long along Z) plus whatever
 * gets furnished into it — doors on the left/right walls leading to
 * HotelRooms interiors, and (on exactly one segment, chosen by
 * hotelStreamer._computeCardSegment) the access-card win pickup.
 *
 * This is the "HotelCorridor" static builder that hotelStreamer.js
 * (the class that actually streams/recenters segments around the
 * player) calls into:
 *
 *   HotelCorridor.buildReusableSegment()
 *     -> { group, floorMesh, colliders, doorSlotsGroup, doorGapZ }
 *   HotelCorridor.furnishSegment(slot, assets, seg, rng, isCardSegment)
 *     -> populates slot.colliders, slot.doorTriggers[], and (only on
 *        the card segment) slot.cardObj / cardTriggerLocal / cardTriggerRadius
 *
 * NOTE: previously this file (and hotelStreamer.js) both contained a
 * copy of the STREAMER class, and this builder simply didn't exist
 * anywhere — that's what produced "HotelCorridor is not defined" the
 * instant the corridor tried to stream in its first ring of segments.
 * ---------------------------------------------------------------
 */

const HotelCorridor = (() => {
  const T = () => GAME_CONFIG.hotelCorridor.tileSize;
  const W = () => GAME_CONFIG.hotelCorridor.corridorWidth;
  const H = () => GAME_CONFIG.hotelCorridor.wallHeight;
  const WT = () => GAME_CONFIG.hotelCorridor.wallThickness;
  const DOOR_W = () => GAME_CONFIG.hotelCorridor.doorWidth;
  const DOOR_H = () => GAME_CONFIG.hotelCorridor.doorHeight;

  const ROOM_TYPES = ["gothicSuite", "loungeRoom", "galleryRoom", "curtainRoom", "emptyRoom"];

  let _mats = null;
  function mats() {
    if (_mats) return _mats;
    _mats = {
      floor: new THREE.MeshStandardMaterial({ color: 0x362a22, roughness: 0.8, metalness: 0.0 }),
      floorCard: new THREE.MeshStandardMaterial({ color: 0x3f3226, roughness: 0.6, metalness: 0.05, emissive: 0x2a1c10, emissiveIntensity: 0.25 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x4a3d33, roughness: 0.9, metalness: 0.0 }),
      ceiling: new THREE.MeshStandardMaterial({ color: 0x18130f, roughness: 1.0 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 0.55, metalness: 0.3 }),
      cardGlow: new THREE.MeshStandardMaterial({ color: 0xdfa040, emissive: 0xdfa040, emissiveIntensity: 1.2, roughness: 0.3 }),
    };
    return _mats;
  }

  function box(w, h, d, mat) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  }

  /**
   * Builds ONE persistent segment shell: floor/ceiling slab + two long
   * side walls (each with a centered doorway gap, since every segment
   * is a candidate for a left+right door pair), local origin at the
   * segment's center, spanning tileSize along Z and corridorWidth along X.
   * `doorSlotsGroup` is where furnishSegment() adds/removes per-segment
   * dressing (doors, the card, lights) without touching the shell.
   */
  function buildReusableSegment() {
    const size = T();
    const w = W();
    const h = H();
    const wt = WT();
    const doorW = DOOR_W();

    const group = new THREE.Group();
    const colliders = [];

    const floor = box(w, 0.2, size, mats().floor);
    floor.position.set(0, -0.1, 0);
    group.add(floor);
    colliders.push(floor);

    const ceiling = box(w, 0.2, size, mats().ceiling);
    ceiling.position.set(0, h + 0.1, 0);
    group.add(ceiling);

    // Side walls run along Z, each with a centered doorway gap so a
    // door can be placed there when furnishSegment() decides to.
    const segLen = (size - doorW) / 2;
    const sides = [-1, 1]; // -1 = west/left wall (-X), 1 = east/right wall (+X)
    for (const sign of sides) {
      const x = sign * (w / 2);

      const segA = box(wt, h, segLen, mats().wall);
      segA.position.set(x, h / 2, -(doorW / 2 + segLen / 2));
      group.add(segA);
      colliders.push(segA);

      const segB = box(wt, h, segLen, mats().wall);
      segB.position.set(x, h / 2, (doorW / 2 + segLen / 2));
      group.add(segB);
      colliders.push(segB);

      const lintel = box(wt, h * 0.18, doorW, mats().wall);
      lintel.position.set(x, h - (h * 0.09), 0);
      group.add(lintel);
    }

    // Thin ceiling trim strip along the corridor center for a bit of
    // hotel detailing without extra collider cost.
    const trim = box(0.3, 0.04, size, mats().trim);
    trim.position.set(0, h - 0.05, 0);
    group.add(trim);

    const doorSlotsGroup = new THREE.Group();
    doorSlotsGroup.name = "DoorSlots";
    group.add(doorSlotsGroup);

    return { group, floorMesh: floor, colliders, doorSlotsGroup, doorGapZ: doorW };
  }

  /**
   * Furnishes a segment for its world segment index `seg`. Deterministic
   * per-seg via `rng` (caller seeds it from the segment coordinate — see
   * hotelStreamer._furnishSlot). Adds up to one door on the left wall
   * and one on the right wall (each a chance roll, so corridors have
   * some plain stretches too), a dim ceiling light, and — only if
   * isCardSegment — the access card pickup sitting in the middle of
   * the floor with a warm glow.
   *
   * Populates onto `slot`:
   *   slot.doorTriggers: [{ localPoint: Vector3, radius, roomType, roomNumber }]
   *   slot.colliders: extra (non-shell) colliders for this segment
   *   slot.cardObj / cardTriggerLocal / cardTriggerRadius: only when isCardSegment
   */
  function furnishSegment(slot, assets, seg, rng, isCardSegment) {
    const w = W();
    const doorW = DOOR_W();
    const doorH = DOOR_H();
    const colliders = [];
    const doorTriggers = [];

    // Re-skin the floor for the card segment so it reads as special
    // even before the player spots the card itself.
    slot.floorMesh.material = isCardSegment ? mats().floorCard : mats().floor;

    // Room number label logic: purely cosmetic string for the HUD/floor
    // label ("FLOOR 2 // ROOM 4C" etc.) — derived deterministically from
    // the segment + side so the same door always shows the same number.
    const doorChance = 0.55;
    const h = H();
    const wt = WT();
    const sides = [
      { sign: -1, key: "L" },
      { sign: 1, key: "R" },
    ];

    for (const side of sides) {
      const x = side.sign * (w / 2);

      if (rng() >= doorChance) {
        // This wall stays blank this segment — but the shell always has a
        // structural gap here, so plug it with solid wall instead of
        // leaving an open hole with nothing behind it.
        const plug = box(wt, h, doorW, mats().wall);
        plug.position.set(x, h / 2, 0);
        slot.doorSlotsGroup.add(plug);
        colliders.push(plug);
        continue;
      }

      const roomType = ROOM_TYPES[Math.floor(rng() * ROOM_TYPES.length)];
      const roomNumber = `${Math.abs(seg) + 1}${side.key}`;

      const door = assets.get("woodenDoor");
      const footprint = door.userData.footprint || { width: doorW, height: doorH, depth: 0.1 };
      const scale = doorH / Math.max(footprint.height, 0.01);
      door.scale.setScalar(scale);
      door.position.set(x, 0, 0);
      // Face into the corridor: left wall door faces +X, right wall
      // door faces -X. Both read correctly as "a door in this wall."
      door.rotation.y = side.sign < 0 ? -Math.PI / 2 : Math.PI / 2;
      slot.doorSlotsGroup.add(door);
      // Deliberately NOT pushed into colliders (same reasoning as
      // hotelRooms.js's own door): the door sits exactly in the
      // trigger the player needs to walk into to enter the room, and
      // its own real height would otherwise catch the ground-height
      // raycast and put the player on top of it instead of through it.

      doorTriggers.push({
        localPoint: new THREE.Vector3(x - side.sign * 0.4, 0, 0),
        radius: 0.55,
        roomType,
        roomNumber,
      });
    }

    // A single dim ceiling light per segment, flicker-free (Floor 2
    // plays calmer than Floor 1 — see main.js's atmosphere gating).
    const light = new THREE.PointLight(0xe8d2a0, 5, 11, 1.2);
    light.position.set(0, GAME_CONFIG.hotelCorridor.wallHeight - 0.2, 0);
    slot.doorSlotsGroup.add(light);

    let cardObj = null, cardTriggerLocal = null, cardTriggerRadius = 0;
    if (isCardSegment) {
      const card = assets.get("accessCard", true);
      card.position.set(0, 0.05, 0);
      card.rotation.y = rng() * Math.PI * 2;
      slot.doorSlotsGroup.add(card);

      const glowPatch = box(1.6, 0.04, 1.6, mats().cardGlow);
      glowPatch.position.set(0, 0.02, 0);
      slot.doorSlotsGroup.add(glowPatch);

      const glow = new THREE.PointLight(0xdfa040, 7, 8, 1.2);
      glow.position.set(0, 1.4, 0);
      slot.doorSlotsGroup.add(glow);

      cardObj = card;
      cardTriggerLocal = new THREE.Vector3(0, 1, 0);
      cardTriggerRadius = 1.6;
    }

    slot.colliders = colliders;
    slot.doorTriggers = doorTriggers;
    slot.cardObj = cardObj;
    slot.cardTriggerLocal = cardTriggerLocal;
    slot.cardTriggerRadius = cardTriggerRadius;
  }

  return { buildReusableSegment, furnishSegment, ROOM_TYPES };
})();
