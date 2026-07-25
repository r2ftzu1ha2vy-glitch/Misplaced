/**
 * roomTiles.js
 * ---------------------------------------------------------------
 * Defines every room "tile" type that can be streamed into the
 * infinite Floor 1 office. Each tile is a square footprint of side
 * GAME_CONFIG.floor1.tileSize, centered on its own local origin
 * (0,0,0 at floor level, tile center at X/Z = 0), with a doorway gap
 * left open in the middle of all 4 walls so any tile can be placed
 * next to any other tile and the doorways always line up.
 *
 * A tile builder is a function:
 *   (group, assets, atmosphere, rng) => { colliders: THREE.Object3D[] }
 * `group` is already positioned/rotated at the tile's world slot by
 * the caller (roomStreamer.js) — builders work entirely in local
 * tile space.
 *
 * `rng` is a small seeded PRNG (see Utils.makeRng) so a given tile
 * coordinate always builds identically even if it's unloaded and
 * reloaded later.
 * ---------------------------------------------------------------
 */

const RoomTiles = (() => {
  const T = () => GAME_CONFIG.floor1.tileSize;
  const H = () => GAME_CONFIG.floor1.wallHeight;
  const DOOR = () => GAME_CONFIG.floor1.doorWidth;
  const WT = () => GAME_CONFIG.floor1.wallThickness;

  let _mats = null;
  function mats() {
    if (_mats) return _mats;
    _mats = {
      floor: new THREE.MeshStandardMaterial({ color: 0x6b6a63, roughness: 0.85, metalness: 0.05 }),
      floorCarpetBlue: new THREE.MeshStandardMaterial({ color: 0x35424a, roughness: 0.95, metalness: 0.0 }),
      floorServer: new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.7, metalness: 0.15 }),
      floorBreak: new THREE.MeshStandardMaterial({ color: 0x4a4136, roughness: 0.9, metalness: 0.0 }),
      wall: new THREE.MeshStandardMaterial({ color: 0xcfcac0, roughness: 0.92, metalness: 0.0 }),
      wallDivider: new THREE.MeshStandardMaterial({ color: 0x9a9488, roughness: 0.9 }),
      ceiling: new THREE.MeshStandardMaterial({ color: 0xe5e2da, roughness: 1.0 }),
      exitGlow: new THREE.MeshStandardMaterial({ color: 0x2a3a2a, roughness: 0.6, emissive: 0x1a3a1a, emissiveIntensity: 0.4 }),
    };
    return _mats;
  }

  function box(w, h, d, mat) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  }

  /**
   * Builds the 4 perimeter walls of a tile, each with a centered
   * doorway gap, plus floor + ceiling slabs. Returns the wall meshes
   * (colliders) it created. floorMat lets each room type reskin the
   * carpet without duplicating this logic.
   */
  function buildShell(group, floorMat, colliders) {
    const size = T();
    const h = H();
    const wt = WT();
    const door = DOOR();
    const segLen = (size - door) / 2;

    const floor = box(size, 0.2, size, floorMat);
    floor.position.set(0, -0.1, 0);
    floor.receiveShadow = true;
    group.add(floor);
    colliders.push(floor);

    const ceiling = box(size, 0.2, size, mats().ceiling);
    ceiling.position.set(0, h + 0.1, 0);
    ceiling.receiveShadow = true;
    group.add(ceiling);

    // North / South walls run along X, gap centered on X
    // East / West walls run along Z, gap centered on Z
    const wallDefs = [
      { axis: "x", sign: -1 }, // north (-Z)
      { axis: "x", sign: 1 },  // south (+Z)
      { axis: "z", sign: -1 }, // west (-X)
      { axis: "z", sign: 1 },  // east (+X)
    ];

    for (const w of wallDefs) {
      const half = size / 2;
      if (w.axis === "x") {
        const z = w.sign * half;
        const segA = box(segLen, h, wt, mats().wall);
        segA.position.set(-(door / 2 + segLen / 2), h / 2, z);
        group.add(segA);
        colliders.push(segA);

        const segB = box(segLen, h, wt, mats().wall);
        segB.position.set((door / 2 + segLen / 2), h / 2, z);
        group.add(segB);
        colliders.push(segB);

        // lintel above the doorway so the wall reads as a real opening, not a gap in a fence
        const lintel = box(door, h * 0.22, wt, mats().wall);
        lintel.position.set(0, h - (h * 0.11), z);
        group.add(lintel);
      } else {
        const x = w.sign * half;
        const segA = box(wt, h, segLen, mats().wall);
        segA.position.set(x, h / 2, -(door / 2 + segLen / 2));
        group.add(segA);
        colliders.push(segA);

        const segB = box(wt, h, segLen, mats().wall);
        segB.position.set(x, h / 2, (door / 2 + segLen / 2));
        group.add(segB);
        colliders.push(segB);

        const lintel = box(wt, h * 0.22, door, mats().wall);
        lintel.position.set(x, h - (h * 0.11), 0);
        group.add(lintel);
      }
    }
  }

  function addCeilingLight(group, assets, lighting, x, z) {
    const h = H();
    // decay=1 (soft, game-friendly falloff) instead of decay=2 (physically
    // correct inverse-square) — with decay=2 a fixture ~2.5m above the
    // floor was only contributing ~0.1-0.3 intensity at eye/floor level,
    // which read as near-total darkness. intensity raised to match.
    const baseIntensity = 9;
    const light = new THREE.PointLight(0xdfe8ea, baseIntensity, 14, 1);
    light.position.set(x, h - 0.15, z);
    light.castShadow = false;
    group.add(light);

    const fixtureMesh = assets.get("ceilingLight", true); // true = give this instance its own materials, it flickers independently
    fixtureMesh.position.set(x, h - 0.05, z);
    fixtureMesh.traverse((n) => {
      if (n.isMesh && n.material) {
        const ms = Array.isArray(n.material) ? n.material : [n.material];
        ms.forEach((m) => {
          m.emissive = new THREE.Color(0xdfe8ea);
          m.emissiveIntensity = 1.0;
        });
      }
    });
    group.add(fixtureMesh);
    lighting.registerFixture(light, fixtureMesh, baseIntensity);
  }

  // ---------------------------------------------------------------
  // Room type: Cubicle Farm — a small grid of cubicles with desks,
  // computers, and chairs. Uses the fixed cubicle_v2 model so its
  // partition walls actually render upright.
  // ---------------------------------------------------------------
  function buildCubicleFarm(group, assets, lighting, atmosphere, rng) {
    const colliders = [];
    buildShell(group, mats().floorCarpetBlue, colliders);

    const rows = 2, cols = 2;
    const spacing = 4.2;
    const startX = -((cols - 1) * spacing) / 2;
    const startZ = -((rows - 1) * spacing) / 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = startX + c * spacing;
        const z = startZ + r * spacing;
        const faceOut = (r === 0) ? 0 : Math.PI; // face away from the row center

        const cubicle = assets.get("cubicle");
        cubicle.position.set(x, 0, z);
        cubicle.rotation.y = faceOut + (rng() < 0.5 ? 0 : Math.PI / 2);
        group.add(cubicle);
        colliders.push(cubicle);

        // Computer sits directly on the cubicle's own desk surface height
        const deskTopY = (cubicle.userData.footprint && cubicle.userData.footprint.height * 0.4) || 0.75;
        if (rng() < 0.85) {
          const computerKey = rng() < 0.5 ? "retroComputer" : "psxComputer";
          const computer = assets.get(computerKey);
          computer.position.set(x, 0.8, z);
          computer.rotation.y = cubicle.rotation.y;
          group.add(computer);

          const kb = assets.get("keyboard");
          kb.position.set(x, 0.8, z + 0.25);
          kb.rotation.y = cubicle.rotation.y;
          group.add(kb);
        }

        if (rng() < 0.6) {
          const chair = assets.get("officeChair");
          const chairOffset = new THREE.Vector3(0, 0, 0.9).applyAxisAngle(new THREE.Vector3(0, 1, 0), cubicle.rotation.y);
          chair.position.set(x + chairOffset.x, 0, z + chairOffset.z);
          chair.rotation.y = cubicle.rotation.y + Math.PI;
          group.add(chair);
          atmosphere.registerObject(chair);
        }
      }
    }

    // A file cabinet and plant tucked in a corner
    const cab = assets.get("fileCabinet");
    cab.position.set(T() / 2 - 1.2, 0, T() / 2 - 1.2);
    group.add(cab);
    colliders.push(cab);

    const plant = assets.get(rng() < 0.5 ? "snakePlant" : "haworthiaPlant");
    plant.position.set(-T() / 2 + 1, 0, T() / 2 - 1);
    group.add(plant);
    atmosphere.registerObject(plant);

    addCeilingLight(group, assets, lighting, -3, -3);
    addCeilingLight(group, assets, lighting, 3, 3);

    return { colliders };
  }

  // ---------------------------------------------------------------
  // Room type: Meeting Room — desks arranged as a conference table,
  // chairs around it, whiteboard on the back wall.
  // ---------------------------------------------------------------
  function buildMeetingRoom(group, assets, lighting, atmosphere, rng) {
    const colliders = [];
    buildShell(group, mats().floor, colliders);

    for (let i = -1; i <= 1; i++) {
      const desk = assets.get("deskSet");
      desk.position.set(i * 1.7, 0, 0);
      group.add(desk);
      colliders.push(desk);

      const chairFront = assets.get("officeChair");
      chairFront.position.set(i * 1.7, 0, 1.1);
      chairFront.rotation.y = Math.PI;
      group.add(chairFront);
      atmosphere.registerObject(chairFront);

      const chairBack = assets.get("officeChair");
      chairBack.position.set(i * 1.7, 0, -1.1);
      group.add(chairBack);
      atmosphere.registerObject(chairBack);
    }

    const whiteboard = assets.get(rng() < 0.5 ? "whiteboardAnimated" : "whiteboard");
    whiteboard.position.set(0, 1.3, -T() / 2 + WT() + 0.02);
    whiteboard.rotation.y = 0;
    group.add(whiteboard);

    const plant = assets.get("snakePlant");
    plant.position.set(T() / 2 - 1, 0, -T() / 2 + 1);
    group.add(plant);
    atmosphere.registerObject(plant);

    addCeilingLight(group, assets, lighting, 0, 0);

    return { colliders };
  }

  // ---------------------------------------------------------------
  // Room type: Break Room — coffee machine, printer, bins, a small
  // table setup near the wall.
  // ---------------------------------------------------------------
  function buildBreakRoom(group, assets, lighting, atmosphere, rng) {
    const colliders = [];
    buildShell(group, mats().floorBreak, colliders);

    const coffee = assets.get("coffeeMachine");
    coffee.position.set(-3, 0, -T() / 2 + WT() + 0.55);
    group.add(coffee);
    colliders.push(coffee);
    atmosphere.registerObject(coffee);

    const printer = assets.get("officePrinter");
    printer.position.set(-0.5, 0, -T() / 2 + WT() + 0.35);
    group.add(printer);
    colliders.push(printer);

    const printer2 = assets.get("officePrinter");
    printer2.position.set(2.5, 0, -T() / 2 + WT() + 0.35);
    printer2.rotation.y = rng() * Math.PI * 2;
    group.add(printer2);
    colliders.push(printer2);

    const bin = assets.get("plasticBin");
    bin.position.set(4.5, 0, -T() / 2 + WT() + 0.3);
    group.add(bin);

    const desk = assets.get("deskSet");
    desk.position.set(1, 0, 2);
    group.add(desk);
    colliders.push(desk);

    for (let i = 0; i < 2; i++) {
      const chair = assets.get("officeChair");
      chair.position.set(0.2 + i * 1.6, 0, 3.4);
      chair.rotation.y = Math.PI;
      group.add(chair);
      atmosphere.registerObject(chair);
    }

    const plant = assets.get("haworthiaPlant");
    plant.position.set(-T() / 2 + 1, 0, T() / 2 - 1);
    group.add(plant);
    atmosphere.registerObject(plant);

    addCeilingLight(group, assets, lighting, 0, 0);

    return { colliders };
  }

  // ---------------------------------------------------------------
  // Room type: Server Room — dim, tight rows implied by file
  // cabinets stood on end, minimal furniture, darker floor.
  // ---------------------------------------------------------------
  function buildServerRoom(group, assets, lighting, atmosphere, rng) {
    const colliders = [];
    buildShell(group, mats().floorServer, colliders);

    const cols = 3;
    const spacing = 2.2;
    const startX = -((cols - 1) * spacing) / 2;
    for (let c = 0; c < cols; c++) {
      const cab = assets.get("fileCabinet");
      cab.position.set(startX + c * spacing, 0, -1.5);
      cab.rotation.y = rng() < 0.5 ? 0 : Math.PI;
      group.add(cab);
      colliders.push(cab);

      const cab2 = assets.get("fileCabinet");
      cab2.position.set(startX + c * spacing, 0, 1.5);
      cab2.rotation.y = rng() < 0.5 ? 0 : Math.PI;
      group.add(cab2);
      colliders.push(cab2);
    }

    // A lone flickering fixture — server rooms read creepier under-lit
    addCeilingLight(group, assets, lighting, 0, 0);

    if (rng() < 0.15) {
      // rare: SCP-096 model tucked in a dark corner facing the wall — pure set-dressing, no AI
      const anomaly = assets.get("scp096");
      anomaly.position.set(T() / 2 - 1.2, 0, T() / 2 - 1.2);
      anomaly.rotation.y = Math.PI * 1.25;
      group.add(anomaly);
    }

    return { colliders };
  }

  // ---------------------------------------------------------------
  // Room type: Storage / Archive — cabinets and bins along the
  // walls, mostly empty floor space.
  // ---------------------------------------------------------------
  function buildArchive(group, assets, lighting, atmosphere, rng) {
    const colliders = [];
    buildShell(group, mats().floor, colliders);

    const positions = [
      [-T() / 2 + 0.8, -T() / 2 + 1.5],
      [-T() / 2 + 0.8, 0],
      [-T() / 2 + 0.8, T() / 2 - 1.5],
      [T() / 2 - 0.8, -T() / 2 + 1.5],
      [T() / 2 - 0.8, T() / 2 - 1.5],
    ];
    positions.forEach(([x, z], i) => {
      const cab = assets.get("fileCabinet");
      cab.position.set(x, 0, z);
      cab.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(cab);
      colliders.push(cab);
    });

    const bin = assets.get("plasticBin");
    bin.position.set(0, 0, T() / 2 - 1.2);
    group.add(bin);

    const plant = assets.get("snakePlant");
    plant.position.set(1.5, 0, -T() / 2 + 1.2);
    group.add(plant);
    atmosphere.registerObject(plant);

    addCeilingLight(group, assets, lighting, 0, 0);

    return { colliders };
  }

  // ---------------------------------------------------------------
  // Room type: Exit / Stairwell — the "win" room. A trigger volume
  // in the middle fires the onWin callback when the player enters.
  // ---------------------------------------------------------------
  function buildExitRoom(group, assets, lighting, atmosphere, rng) {
    const colliders = [];
    buildShell(group, mats().floor, colliders);

    // A simple staircase gesture built from stacked boxes so the
    // room reads as "leads somewhere" even without a dedicated model.
    const stairMat = mats().exitGlow;
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const step = box(2.2, 0.22, 0.6, stairMat);
      step.position.set(0, 0.11 + i * 0.22, -2 + i * 0.6);
      group.add(step);
      colliders.push(step);
    }

    const doorFrame = box(2.4, H(), 0.3, mats().wallDivider);
    doorFrame.position.set(0, H() / 2, -2 + steps * 0.6);
    group.add(doorFrame);

    addCeilingLight(group, assets, lighting, 0, 2);

    // Trigger zone: a simple sphere-distance check handled by the streamer,
    // exposed here as a world-space-agnostic local point + radius.
    const triggerLocal = new THREE.Vector3(0, 1, -1);
    const triggerRadius = 2.2;

    return { colliders, exitTrigger: { localPoint: triggerLocal, radius: triggerRadius } };
  }

  return {
    buildCubicleFarm,
    buildMeetingRoom,
    buildBreakRoom,
    buildServerRoom,
    buildArchive,
    buildExitRoom,
  };
})();
