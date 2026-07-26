/**
 * hotelLobby.js
 * ---------------------------------------------------------------
 * Floor 2, level 1 — a small, fixed (non-streamed) hotel lobby the
 * player spawns into right after leaving Floor 1. Contains the
 * reception desk and two elevators on the back wall. Walking up to
 * either elevator opens its doors automatically; stepping inside and
 * waiting closes them and hands off to the fade-to-black elevator
 * ride, which is where the caller (floorManager.js) actually swaps
 * the player into the endless hotel corridor.
 *
 * Kept deliberately simple/static (one box room, no streaming) since
 * it's a small one-time space, not a repeating tile.
 * ---------------------------------------------------------------
 */

const HotelLobby = (() => {
  let _mats = null;
  function mats() {
    if (_mats) return _mats;
    _mats = {
      floor: new THREE.MeshStandardMaterial({ color: 0x2c2320, roughness: 0.6, metalness: 0.1 }),
      floorRug: new THREE.MeshStandardMaterial({ color: 0x4a1f1f, roughness: 0.85, metalness: 0.0 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x2a2422, roughness: 0.9, metalness: 0.0 }),
      wallPanel: new THREE.MeshStandardMaterial({ color: 0x3a2f28, roughness: 0.7, metalness: 0.15 }),
      ceiling: new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: 1.0 }),
      elevatorFrame: new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.4, metalness: 0.75 }),
      elevatorPanel: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.3 }),
      elevatorBtnIdle: new THREE.MeshStandardMaterial({ color: 0xdfa040, emissive: 0x3a2200, emissiveIntensity: 0.6, roughness: 0.4 }),
    };
    return _mats;
  }

  function box(w, h, d, mat) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  }

  /**
   * Builds the whole lobby into `group` (already added to the scene by
   * the caller at world origin — the lobby always lives at a fixed
   * offset, never re-centered/streamed).
   * Returns { colliders, spawnPoint, elevators } where elevators is an
   * array of { doorGroupL, doorGroupR, triggerPos, triggerRadius,
   * insidePos, state }, one per elevator, for floorManager.js to drive.
   */
  function build(group, assets, lighting) {
    const cfg = GAME_CONFIG.hotelLobby;
    const colliders = [];
    const w = cfg.width, d = cfg.depth, h = cfg.wallHeight;

    const floor = box(w, 0.2, d, mats().floor);
    floor.position.set(0, -0.1, 0);
    group.add(floor);
    colliders.push(floor);

    const rug = box(w * 0.4, 0.02, d * 0.5, mats().floorRug);
    rug.position.set(0, 0.011, 1);
    group.add(rug);

    const ceiling = box(w, 0.2, d, mats().ceiling);
    ceiling.position.set(0, h + 0.1, 0);
    group.add(ceiling);

    // Perimeter walls — solid except for a doorway gap on the south (+Z)
    // wall, which is where the player transitions in from Floor 1's
    // exit gate fade and is purely decorative/for orientation (no
    // collider gap needed since the player spawns already inside).
    const wt = 0.25;
    const north = box(w, h, wt, mats().wall);
    north.position.set(0, h / 2, -d / 2);
    group.add(north);
    colliders.push(north);

    const south = box(w, h, wt, mats().wall);
    south.position.set(0, h / 2, d / 2);
    group.add(south);
    colliders.push(south);

    const east = box(wt, h, d, mats().wall);
    east.position.set(w / 2, h / 2, 0);
    group.add(east);
    colliders.push(east);

    const west = box(wt, h, d, mats().wall);
    west.position.set(-w / 2, h / 2, 0);
    group.add(west);
    colliders.push(west);

    // Wainscoting panel strip for a bit of hotel-lobby texture
    const panel = box(w - 0.4, 1.1, 0.04, mats().wallPanel);
    panel.position.set(0, 1.0, -d / 2 + wt / 2 + 0.03);
    group.add(panel);

    // --- Reception desk, facing the spawn point ---
    const desk = assets.get("receptionDesk");
    desk.position.set(0, 0, d / 2 - 3.2);
    desk.rotation.y = Math.PI;
    group.add(desk);
    colliders.push(desk);

    // --- Ambient lobby lighting (a couple of warm point lights; no
    // flicker system here — the lobby is meant to read as "still safe",
    // a beat of calm before the endless corridor) ---
    const lamp1 = new THREE.PointLight(0xffcf9a, 6, 14, 1.2);
    lamp1.position.set(-3, h - 0.3, 2);
    group.add(lamp1);
    const lamp2 = new THREE.PointLight(0xffcf9a, 6, 14, 1.2);
    lamp2.position.set(3, h - 0.3, 2);
    group.add(lamp2);
    const lamp3 = new THREE.PointLight(0xd9c9b0, 4.5, 12, 1.2);
    lamp3.position.set(0, h - 0.3, -4);
    group.add(lamp3);

    // --- Two elevators on the north wall ---
    const elevators = [];
    const spacing = cfg.elevatorSpacingX;
    const ex = [-spacing / 2, spacing / 2];
    for (let i = 0; i < 2; i++) {
      const elevator = _buildElevator(group, assets, ex[i], cfg.elevatorZ, colliders);
      elevators.push(elevator);
    }

    return {
      colliders,
      spawnPoint: new THREE.Vector3(cfg.spawnPoint.x, 0, cfg.spawnPoint.z),
      elevators,
    };
  }

  /**
   * One elevator = a recessed alcove in the north wall, a call-button
   * panel, and a pair of sliding door leaves built from elevator_door.glb
   * (its "Door_1"/"Door_2" sub-meshes are used as separate leaves so
   * they can animate open/closed independently — see _splitDoorLeaves).
   */
  function _buildElevator(group, assets, x, z, colliders) {
    const cfg = GAME_CONFIG.hotelLobby;
    const doorW = cfg.elevatorDoorWidth;
    const doorH = cfg.elevatorDoorHeight;

    // Alcove side walls so the elevator reads as recessed, not flush
    const sideL = box(0.2, doorH + 0.4, 1.0, mats().elevatorFrame);
    sideL.position.set(x - doorW / 2 - 0.1, (doorH + 0.4) / 2, z - 0.5);
    group.add(sideL);
    colliders.push(sideL);

    const sideR = box(0.2, doorH + 0.4, 1.0, mats().elevatorFrame);
    sideR.position.set(x + doorW / 2 + 0.1, (doorH + 0.4) / 2, z - 0.5);
    group.add(sideR);
    colliders.push(sideR);

    const lintel = box(doorW + 0.4, 0.3, 1.0, mats().elevatorFrame);
    lintel.position.set(x, doorH + 0.15, z - 0.5);
    group.add(lintel);
    colliders.push(lintel);

    // Dark recessed panel behind the doors (so the alcove doesn't look
    // like it opens straight into the void when doors are shut)
    const backPanel = box(doorW, doorH, 0.1, mats().elevatorPanel);
    backPanel.position.set(x, doorH / 2, z - 0.9);
    group.add(backPanel);

    // Door model — split into two leaves that slide apart. The source
    // asset's own "Door" hierarchy already separates left/right panels
    // by name (Door_1 / Door_2 in the export), so instead of guessing
    // geometry bounds we just grab those two named sub-objects and
    // treat them as independent leaves.
    const doorRoot = assets.get("elevatorDoor", true);
    const footprint = doorRoot.userData.footprint || { width: doorW, height: doorH, depth: 0.15 };
    const scale = doorH / Math.max(footprint.height, 0.01);
    doorRoot.scale.setScalar(scale);
    doorRoot.position.set(x, 0, z);
    doorRoot.rotation.y = Math.PI; // face into the lobby
    group.add(doorRoot);

    const leaves = _splitDoorLeaves(doorRoot);

    // Call button panel beside the door
    const btnPanel = box(0.18, 0.5, 0.06, mats().elevatorFrame);
    btnPanel.position.set(x + doorW / 2 + 0.4, 1.2, z + 0.15);
    group.add(btnPanel);

    const btn = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), mats().elevatorBtnIdle);
    btn.position.set(x + doorW / 2 + 0.4, 1.25, z + 0.19);
    group.add(btn);

    // Soft light glow above each elevator so it's findable across the room
    const glow = new THREE.PointLight(0xdfe8ea, 4, 6, 1.2);
    glow.position.set(x, doorH + 0.5, z - 0.3);
    group.add(glow);

    return {
      x, z,
      doorLeaves: leaves,
      leafOpenOffset: doorW * 0.52, // how far each leaf slides sideways when fully open
      state: "closed", // closed | opening | open | closing
      progress: 0,      // 0 = closed, 1 = open
      triggerPos: new THREE.Vector3(x, 1, z + 0.6),
      triggerRadius: 1.6,
      insidePos: new THREE.Vector3(x, 1, z - 0.55),
      button: btn,
    };
  }

  /**
   * Finds the door leaf meshes inside a loaded elevator_door.glb clone
   * by their exported node names (Door_1_..., Door_2_...) and returns
   * them as { left, right } so the caller can animate two independent
   * sliding panels. Falls back to treating the whole model as one leaf
   * (no slide animation, just a visibility toggle) if the expected
   * sub-names aren't found — keeps the lobby working even if a
   * different door export is swapped in later.
   */
  function _splitDoorLeaves(doorRoot) {
    let left = null, right = null;
    doorRoot.traverse((n) => {
      if (!n.name) return;
      if (/Door_1/i.test(n.name) && !left) left = n;
      else if (/Door_2/i.test(n.name) && !right) right = n;
    });
    if (left && right) {
      left.userData.baseX = left.position.x;
      right.userData.baseX = right.position.x;
      return { left, right, wholeModel: doorRoot };
    }
    // Fallback: no named split found — animate the whole root sliding up
    // instead, so there's still SOME visible door motion.
    doorRoot.userData.baseY = doorRoot.position.y;
    return { left: doorRoot, right: null, wholeModel: doorRoot, fallbackSlideUp: true };
  }

  /**
   * Advances one elevator's door animation. speed is leaves-per-second
   * (progress units/sec); call every frame for every elevator whose
   * state isn't "closed" or "open" (idle states need no work).
   * Returns nothing — mutates the elevator object's door leaf transforms.
   */
  function updateDoors(elevator, dt, openSpeed) {
    const target = (elevator.state === "opening" || elevator.state === "open") ? 1 : 0;
    const dir = target > elevator.progress ? 1 : -1;
    elevator.progress = Utils.clamp(elevator.progress + dir * openSpeed * dt, 0, 1);

    if (elevator.state === "opening" && elevator.progress >= 1) elevator.state = "open";
    if (elevator.state === "closing" && elevator.progress <= 0) elevator.state = "closed";

    const leaves = elevator.doorLeaves;
    if (!leaves) return;
    if (leaves.fallbackSlideUp) {
      leaves.wholeModel.position.y = leaves.wholeModel.userData.baseY + elevator.progress * 2.4;
      return;
    }
    const offset = elevator.leafOpenOffset * elevator.progress;
    if (leaves.left) leaves.left.position.x = leaves.left.userData.baseX - offset;
    if (leaves.right) leaves.right.position.x = leaves.right.userData.baseX + offset;
  }

  return { build, updateDoors };
})();
