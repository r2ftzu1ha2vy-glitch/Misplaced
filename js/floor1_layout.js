/**
 * floor1_layout.js
 * ---------------------------------------------------------------
 * Hand-authored Floor 1 — Office Complex.
 *
 * This is intentionally NOT procedural: room shapes, corridor
 * routes, and prop placements are explicit so the floor reads as
 * "handcrafted" per the brief. To add Floor 2+, copy this file's
 * shape (a class exposing `.build(scene, assetManager, lightingSystem, atmosphereSystem)`
 * that returns `{ colliders, spawnPoint }`) and register it in main.js.
 * ---------------------------------------------------------------
 */

class Floor1Layout {
  constructor() {
    this.colliders = [];
    this.spawnPoint = new THREE.Vector3(0, 0, 0);
  }

  build(scene, assets, lighting, atmosphere) {
    const group = new THREE.Group();
    group.name = "Floor1_OfficeComplex";
    scene.add(group);

    this._buildShell(group);
    this._buildCubicleFarm(group, assets, atmosphere);
    this._buildConferenceRoom(group, assets, atmosphere);
    this._buildCorridorProps(group, assets, atmosphere);
    this._buildCeilingLights(group, assets, lighting);

    this.spawnPoint = new THREE.Vector3(0, 0, -2);

    return { colliders: this.colliders, spawnPoint: this.spawnPoint };
  }

  // --- shared materials, kept dull/desaturated for the liminal look ---
  _materials() {
    if (this._mats) return this._mats;
    this._mats = {
      floor: new THREE.MeshStandardMaterial({ color: 0x6b6a63, roughness: 0.85, metalness: 0.05 }),
      floorCarpetBlue: new THREE.MeshStandardMaterial({ color: 0x35424a, roughness: 0.95, metalness: 0.0 }),
      wall: new THREE.MeshStandardMaterial({ color: 0xcfcac0, roughness: 0.92, metalness: 0.0 }),
      wallDivider: new THREE.MeshStandardMaterial({ color: 0x9a9488, roughness: 0.9 }),
      ceiling: new THREE.MeshStandardMaterial({ color: 0xe5e2da, roughness: 1.0 }),
      ceilingTile: new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 1.0 }),
      glassDark: new THREE.MeshStandardMaterial({ color: 0x1a1e22, roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.55 }),
    };
    return this._mats;
  }

  _addCollider(mesh) {
    this.colliders.push(mesh);
    return mesh;
  }

  _box(w, h, d, mat) {
    const geo = new THREE.BoxGeometry(w, h, d);
    return new THREE.Mesh(geo, mat);
  }

  /**
   * Overall shell: floor slab, ceiling slab, perimeter walls, and
   * a large open office footprint. Dimensions in meters.
   */
  _buildShell(group) {
    const mats = this._materials();
    const W = 40;  // overall width (X)
    const D = 60;  // overall depth (Z)
    const H = GAME_CONFIG.floor1.wallHeight;

    // Floor
    const floor = this._box(W, 0.2, D, mats.floorCarpetBlue);
    floor.position.set(0, -0.1, 0);
    floor.receiveShadow = true;
    group.add(floor);
    this._addCollider(floor);

    // Ceiling
    const ceiling = this._box(W, 0.2, D, mats.ceiling);
    ceiling.position.set(0, H + 0.1, 0);
    ceiling.receiveShadow = true;
    group.add(ceiling);

    // Perimeter walls (4 slabs, with a couple of window-ish cutout gestures via inset panels)
    const wallThickness = 0.25;

    const northWall = this._box(W, H, wallThickness, mats.wall);
    northWall.position.set(0, H / 2, -D / 2);
    group.add(northWall);
    this._addCollider(northWall);

    const southWall = this._box(W, H, wallThickness, mats.wall);
    southWall.position.set(0, H / 2, D / 2);
    group.add(southWall);
    this._addCollider(southWall);

    const eastWall = this._box(wallThickness, H, D, mats.wall);
    eastWall.position.set(W / 2, H / 2, 0);
    group.add(eastWall);
    this._addCollider(eastWall);

    const westWall = this._box(wallThickness, H, D, mats.wall);
    westWall.position.set(-W / 2, H / 2, 0);
    group.add(westWall);
    this._addCollider(westWall);

    // A long interior partition separating the cubicle farm from the conference wing,
    // with a doorway gap left open (two segments instead of one solid wall).
    const partitionY = D * 0.18;
    const doorGap = 2.4;
    const segLen = (W - doorGap) / 2;

    const partA = this._box(segLen, H, wallThickness, mats.wallDivider);
    partA.position.set(-(doorGap / 2 + segLen / 2), H / 2, partitionY);
    group.add(partA);
    this._addCollider(partA);

    const partB = this._box(segLen, H, wallThickness, mats.wallDivider);
    partB.position.set((doorGap / 2 + segLen / 2), H / 2, partitionY);
    group.add(partB);
    this._addCollider(partB);
  }

  /**
   * Cubicle farm: a grid of cubicle_v2 models with desk sets, file
   * cabinets, and computers, laid out in explicit rows (not randomized
   * positions — hand-placed rows/cols that feel like a real floor plan).
   */
  _buildCubicleFarm(group, assets, atmosphere) {
    const cell = GAME_CONFIG.floor1.cellSize;
    const rows = 4;
    const cols = 5;
    const startX = -((cols - 1) * cell) / 2;
    const startZ = -18;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = startX + c * cell;
        const z = startZ + r * cell;

        const cubicle = assets.get("cubicle");
        cubicle.position.set(x, 0, z);
        cubicle.rotation.y = (r % 2 === 0) ? 0 : Math.PI;
        group.add(cubicle);
        this._addCollider(cubicle);

        // Desk + monitor/computer inside every other cubicle for variation
        if ((r + c) % 2 === 0) {
          const desk = assets.get("deskSet");
          desk.position.set(x, 0, z + 0.3);
          desk.rotation.y = cubicle.rotation.y;
          group.add(desk);
          this._addCollider(desk);

          const deskTopY = (desk.userData.footprint && desk.userData.footprint.height) || 0.75;
          const computerKey = (r + c) % 4 === 0 ? "retroComputer" : "psxComputer";
          const computer = assets.get(computerKey);
          computer.position.set(x, deskTopY, z + 0.25);
          computer.rotation.y = cubicle.rotation.y;
          group.add(computer);

          const kb = assets.get("keyboard");
          kb.position.set(x, deskTopY, z + 0.5);
          kb.rotation.y = cubicle.rotation.y;
          group.add(kb);
        } else {
          const chair = assets.get("officeChair");
          chair.position.set(x, 0, z - 0.4);
          group.add(chair);
          atmosphere.registerObject(chair); // chairs are good candidates for subtle nudges
        }

        // Occasional file cabinet at row ends
        if (c === 0) {
          const cabinetKey = r % 2 === 0 ? "fileCabinet" : "rustyFileCabinet";
          const cabinet = assets.get(cabinetKey);
          cabinet.position.set(startX - cell * 0.85, 0, z);
          group.add(cabinet);
          this._addCollider(cabinet);
        }
      }
    }

    // A couple of plants scattered at row ends for life/decay contrast
    const plantPositions = [
      [startX - cell, 0, startZ - cell],
      [startX + (cols - 1) * cell + cell, 0, startZ + (rows - 1) * cell],
    ];
    plantPositions.forEach(([x, y, z], i) => {
      const plant = assets.get(i % 2 === 0 ? "snakePlant" : "haworthiaPlant");
      plant.position.set(x, y, z);
      group.add(plant);
      atmosphere.registerObject(plant);
    });

    // Trash bins near cubicle ends
    const bin1 = assets.get("plasticBin");
    bin1.position.set(startX - cell * 0.85, 0, startZ + cell * 1.5);
    group.add(bin1);
  }

  /**
   * Conference room: whiteboard, printer, coffee machine, seating implied by chairs.
   * Sits beyond the partition doorway toward the south wall.
   */
  _buildConferenceRoom(group, assets, atmosphere) {
    const z = GAME_CONFIG.floor1.cellSize * 6; // south of the partition
    const mats = this._materials();

    // A defining back wall segment behind the whiteboard for framing
    const backWall = this._box(6, GAME_CONFIG.floor1.wallHeight, 0.2, mats.wallDivider);
    backWall.position.set(-8, GAME_CONFIG.floor1.wallHeight / 2, z + 6);
    group.add(backWall);
    this._addCollider(backWall);

    const whiteboard = assets.get("whiteboardAnimated");
    whiteboard.position.set(-8, 1.4, z + 5.85);
    whiteboard.rotation.y = Math.PI;
    group.add(whiteboard);

    // Conference table approximated from desk sets in a row
    for (let i = -1; i <= 1; i++) {
      const desk = assets.get("deskSet");
      desk.position.set(-8 + i * 1.6, 0, z + 2);
      group.add(desk);
      this._addCollider(desk);

      const chair = assets.get("officeChair");
      chair.position.set(-8 + i * 1.6, 0, z + 3);
      chair.rotation.y = Math.PI;
      group.add(chair);
      atmosphere.registerObject(chair);
    }

    // Printer + coffee machine in a side alcove
    const printer = assets.get("officePrinter");
    printer.position.set(2, 0, z + 5.5);
    group.add(printer);
    this._addCollider(printer);

    const coffee = assets.get("coffeeMachine");
    coffee.position.set(4, 0, z + 5.5);
    group.add(coffee);
    this._addCollider(coffee);
    atmosphere.registerObject(coffee);

    // A standalone whiteboard near the printer alcove for a second work area
    const wb2 = assets.get("whiteboard");
    wb2.position.set(6.5, 1.3, z + 5.85);
    wb2.rotation.y = Math.PI;
    group.add(wb2);
  }

  /**
   * Corridor connecting cubicle farm to conference room through the
   * partition doorway — sparse, deliberately empty to build tension.
   */
  _buildCorridorProps(group, assets, atmosphere) {
    const partitionZ = 60 * 0.18;

    // A lone bin and a snake plant flank the doorway threshold
    const bin = assets.get("plasticBin");
    bin.position.set(0.9, 0, partitionZ - 0.6);
    group.add(bin);

    const plant = assets.get("snakePlant");
    plant.position.set(-1.1, 0, partitionZ + 0.6);
    group.add(plant);
    atmosphere.registerObject(plant);
  }

  /**
   * Ceiling fluorescent fixtures, registered with the lighting system
   * so they flicker/fail independently. Placed on an explicit grid
   * matching the room, not random.
   */
  _buildCeilingLights(group, assets, lighting) {
    const H = GAME_CONFIG.floor1.wallHeight;
    const positions = [
      [-6, -18], [0, -18], [6, -18],
      [-6, -12], [0, -12], [6, -12],
      [-6, -6],  [0, -6],  [6, -6],
      [-8, 40 * 0.6 * 0.3 + 4], // conference room area (approx z ~ partition + a bit)
      [2, 40 * 0.6 * 0.3 + 4],
    ];

    for (const [x, z] of positions) {
      const fixtureGroup = new THREE.Group();

      const light = new THREE.PointLight(0xdfe8ea, 1.2, 9, 2);
      light.position.set(x, H - 0.15, z);
      light.castShadow = false; // keep perf sane with many fixtures; can enable selectively later
      group.add(light);
      fixtureGroup.add(light);

      // Try to use the real ceiling light model; if it failed to load, a placeholder box still appears
      const fixtureMesh = assets.get("ceilingLight");
      fixtureMesh.position.set(x, H - 0.05, z);
      fixtureMesh.traverse((n) => {
        if (n.isMesh && n.material) {
          const mats = Array.isArray(n.material) ? n.material : [n.material];
          mats.forEach((m) => {
            m.emissive = new THREE.Color(0xdfe8ea);
            m.emissiveIntensity = 1.0;
          });
        }
      });
      group.add(fixtureMesh);

      lighting.registerFixture(light, fixtureMesh, 1.2);
    }
  }
}
