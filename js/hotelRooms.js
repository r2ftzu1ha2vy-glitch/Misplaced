/**
 * hotelRooms.js
 * ---------------------------------------------------------------
 * Defines the 5 hotel room interiors the player can step into from a
 * corridor door. Each room is a fixed-size box built fresh into a
 * given group (not streamed/reused — the player is only ever in one
 * room at a time, entered/exited through the same door), furnished
 * differently depending on roomType so the 5 doors don't all lead to
 * the same room:
 *
 *   gothicSuite  — gothic_bed + nightstand, heaviest/creepiest room
 *   loungeRoom   — sofa + low painting, a "sitting room" read
 *   galleryRoom  — both Beksinski paintings on display, no furniture
 *   curtainRoom  — floor-to-ceiling curtain + chandelier, empty floor
 *   emptyRoom    — bare/abandoned, a single dim light
 *
 * A room builder signature is (group, assets, lighting, rng) => {
 *   colliders, lights, spawnPoint (local, where the player lands
 *   walking in from the door), doorLocal (local point of the door
 *   back out)
 * }
 * `lights` is every THREE.PointLight registered with the LightingSystem
 * during this build — hotelStreamer.exitRoom() unregisters exactly
 * these when the room is torn down, so re-entering rooms repeatedly
 * doesn't leak fixtures into the global flicker system forever (see
 * lightingSystem.js's unregisterFixture for why that matters).
 * ---------------------------------------------------------------
 */

const HotelRooms = (() => {
  const SIZE_X = 6;
  const SIZE_Z = 7;
  const H = 2.8;
  const WT = 0.2;
  const DOOR_W = 1.4;

  let _mats = null;
  function mats() {
    if (_mats) return _mats;
    _mats = {
      floor: new THREE.MeshStandardMaterial({ color: 0x3d2f28, roughness: 0.85, metalness: 0.0 }),
      floorGallery: new THREE.MeshStandardMaterial({ color: 0x201c1a, roughness: 0.6, metalness: 0.05 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x5c4f42, roughness: 0.9, metalness: 0.0 }),
      wallGallery: new THREE.MeshStandardMaterial({ color: 0x161412, roughness: 0.95, metalness: 0.0 }),
      ceiling: new THREE.MeshStandardMaterial({ color: 0x201a17, roughness: 1.0 }),
    };
    return _mats;
  }

  function box(w, h, d, mat) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  }

  /**
   * Shared shell for every room type: floor/ceiling/3 solid walls, with
   * a doorway gap in the +Z wall (the wall closest to the corridor,
   * where the player entered from — matches whichever side the corridor
   * door was on, but since the room is its own isolated local space,
   * "the door" is always +Z here for simplicity).
   */
  function _buildShell(group, floorMat, wallMat, ceilingMat) {
    const colliders = [];

    const floor = box(SIZE_X, 0.2, SIZE_Z, floorMat);
    floor.position.set(0, -0.1, 0);
    group.add(floor);
    colliders.push(floor);

    const ceiling = box(SIZE_X, 0.2, SIZE_Z, ceilingMat);
    ceiling.position.set(0, H + 0.1, 0);
    group.add(ceiling);

    const back = box(SIZE_X, H, WT, wallMat);
    back.position.set(0, H / 2, -SIZE_Z / 2);
    group.add(back);
    colliders.push(back);

    const left = box(WT, H, SIZE_Z, wallMat);
    left.position.set(-SIZE_X / 2, H / 2, 0);
    group.add(left);
    colliders.push(left);

    const right = box(WT, H, SIZE_Z, wallMat);
    right.position.set(SIZE_X / 2, H / 2, 0);
    group.add(right);
    colliders.push(right);

    // Front (+Z) wall with a centered doorway gap
    const segLen = (SIZE_X - DOOR_W) / 2;
    const frontA = box(segLen, H, WT, wallMat);
    frontA.position.set(-(DOOR_W / 2 + segLen / 2), H / 2, SIZE_Z / 2);
    group.add(frontA);
    colliders.push(frontA);

    const frontB = box(segLen, H, WT, wallMat);
    frontB.position.set((DOOR_W / 2 + segLen / 2), H / 2, SIZE_Z / 2);
    group.add(frontB);
    colliders.push(frontB);

    const lintel = box(DOOR_W, H * 0.2, WT, wallMat);
    lintel.position.set(0, H - H * 0.1, SIZE_Z / 2);
    group.add(lintel);

    return colliders;
  }

  /** Creates one point light, registers it with the flicker system, and
   *  appends it to `lights` so the caller's result can hand the full
   *  list back to hotelStreamer for cleanup on room exit. */
  function _addLight(group, lighting, lights, x, z, intensity) {
    const light = new THREE.PointLight(0xe8d9c0, intensity || 7, 10, 1.2);
    light.position.set(x, H - 0.2, z);
    light.castShadow = false;
    group.add(light);
    lighting.registerFixture(light, null, intensity || 7);
    lights.push(light);
    return light;
  }

  const _doorLocal = () => new THREE.Vector3(0, 0, SIZE_Z / 2);
  const _spawnPoint = () => new THREE.Vector3(0, 0, SIZE_Z / 2 - 1.2);

  function buildGothicSuite(group, assets, lighting, rng) {
    const colliders = _buildShell(group, mats().floor, mats().wall, mats().ceiling);
    const lights = [];

    const bed = assets.get("gothicBed");
    bed.position.set(-0.6, 0, -1.6);
    bed.rotation.y = Math.PI;
    group.add(bed);
    colliders.push(bed);

    const nightstand = assets.get("nightstand");
    nightstand.position.set(1.9, 0, -2.4);
    group.add(nightstand);
    colliders.push(nightstand);

    const painting = assets.get("paintingBek2");
    painting.position.set(0, 1.4, -SIZE_Z / 2 + 0.05);
    painting.rotation.y = 0;
    group.add(painting);

    _addLight(group, lighting, lights, 0, -1, 6.5);

    return { colliders, lights, spawnPoint: _spawnPoint(), doorLocal: _doorLocal() };
  }

  function buildLoungeRoom(group, assets, lighting, rng) {
    const colliders = _buildShell(group, mats().floor, mats().wall, mats().ceiling);
    const lights = [];

    const sofa = assets.get("sofa");
    sofa.position.set(0, 0, -2);
    sofa.rotation.y = Math.PI;
    group.add(sofa);
    colliders.push(sofa);

    const painting = assets.get("paintingLow");
    painting.position.set(-SIZE_X / 2 + 0.05, 1.3, -1);
    painting.rotation.y = Math.PI / 2;
    group.add(painting);

    const nightstand = assets.get("nightstand");
    nightstand.position.set(2.2, 0, -1);
    group.add(nightstand);
    colliders.push(nightstand);

    _addLight(group, lighting, lights, 0, -0.5, 7);

    return { colliders, lights, spawnPoint: _spawnPoint(), doorLocal: _doorLocal() };
  }

  function buildGalleryRoom(group, assets, lighting, rng) {
    const colliders = _buildShell(group, mats().floorGallery, mats().wallGallery, mats().ceiling);
    const lights = [];

    const p2 = assets.get("paintingBek2");
    p2.position.set(-1.6, 1.3, -SIZE_Z / 2 + 0.05);
    group.add(p2);

    const p3 = assets.get("paintingBek3");
    p3.position.set(1.6, 1.1, -SIZE_Z / 2 + 0.08);
    group.add(p3);

    _addLight(group, lighting, lights, -1.6, -1.5, 5.5);
    _addLight(group, lighting, lights, 1.6, -1.5, 5.5);

    return { colliders, lights, spawnPoint: _spawnPoint(), doorLocal: _doorLocal() };
  }

  function buildCurtainRoom(group, assets, lighting, rng) {
    const colliders = _buildShell(group, mats().floor, mats().wall, mats().ceiling);
    const lights = [];

    const curtain = assets.get("curtain");
    const footprint = curtain.userData.footprint || { width: 1, height: 2.2, depth: 0.3 };
    const scale = (H - 0.1) / Math.max(footprint.height, 0.01);
    curtain.scale.setScalar(scale);
    curtain.position.set(0, 0, -SIZE_Z / 2 + 0.15);
    group.add(curtain);

    const chandelier = assets.get("chandelier");
    chandelier.position.set(0, H - 0.3, 0);
    group.add(chandelier);

    _addLight(group, lighting, lights, 0, 0, 6);

    return { colliders, lights, spawnPoint: _spawnPoint(), doorLocal: _doorLocal() };
  }

  function buildEmptyRoom(group, assets, lighting, rng) {
    const colliders = _buildShell(group, mats().floor, mats().wall, mats().ceiling);
    const lights = [];
    // deliberately sparse — a single dim, unstable light
    _addLight(group, lighting, lights, 0, -1, 3.5);
    return { colliders, lights, spawnPoint: _spawnPoint(), doorLocal: _doorLocal() };
  }

  function build(roomType, group, assets, lighting, rng) {
    switch (roomType) {
      case "gothicSuite": return buildGothicSuite(group, assets, lighting, rng);
      case "loungeRoom": return buildLoungeRoom(group, assets, lighting, rng);
      case "galleryRoom": return buildGalleryRoom(group, assets, lighting, rng);
      case "curtainRoom": return buildCurtainRoom(group, assets, lighting, rng);
      case "emptyRoom":
      default: return buildEmptyRoom(group, assets, lighting, rng);
    }
  }

  return { build, SIZE_X, SIZE_Z };
})();
