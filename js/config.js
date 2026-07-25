/**
 * config.js
 * ---------------------------------------------------------------
 * Central, editable configuration for the game.
 * Add new floors/enemies/items by extending the objects below —
 * nothing else in the codebase should need to change for simple
 * content additions.
 * ---------------------------------------------------------------
 */

const GAME_CONFIG = {

  // Base path where your .glb assets live, matching your repo:
  // Misplaced/assets/floor1/*.glb
  assetBasePath: "assets/floor1/",

  // Every model you currently have, from your repo screenshots.
  // key -> filename. Reference models by key everywhere else.
  models: {
    coffeeMachine:      "coffee_machine.glb",
    cubicle:            "cubicle_v2.glb",
    deskSet:            "desk_set.glb",
    fileCabinet:        "file_cabinet.glb",
    keyboard:           "keyboard.glb",
    ceilingLight:       "light_fixture_-_ceiling_recessed.glb",
    snakePlant:         "low-poly_snake_plant.glb",
    whiteboardAnimated: "low_poly_animated_whiteboard.glb",
    haworthiaPlant:     "lowpoly_haworthia_plant.glb",
    officePrinter:      "mfp_office_printer.glb",
    officeChair:        "office_chair_modern.glb",
    plasticBin:         "plastic_round_bin.glb",
    psxComputer:        "psx_retro_computer.glb",
    retroComputer:      "retro_computer.glb",
    scp096:             "scp-096_-_true_hd_sound_mod.glb", // model only for now, audio skipped
    whiteboard:         "whiteboard.glb",
    exitDoor:           "metal_door.glb",
  },

  // A handful of these Sketchfab/FBX exports bake in wrong real-world
  // scale (e.g. desk_set.glb measures ~1500 units wide as exported —
  // a "desk" the size of a football field). Uniform per-key correction
  // applied once at load time, before anything is positioned. Keys not
  // listed here default to 1 (already correct scale).
  // exitDoor was exported oversized enough to poke through the walls of
  // neighboring tiles (it visually "covered" 2-3 rooms at once) — scaled
  // down to a normal doorway-sized prop.
  modelScaleFixes: {
    exitDoor: 0.30,
  },

  // Player controller tuning
  player: {
    height: 1.75,
    eyeHeight: 1.62,
    radius: 0.32,
    walkSpeed: 2.6,
    sprintSpeed: 5.2,
    crouchSpeed: 1.3,
    acceleration: 40,
    deceleration: 28,
    airControl: 0.3,
    jumpVelocity: 4.6,
    gravity: 11.5,
    crouchHeight: 0.95,
    crouchTransitionSpeed: 8,
    sensitivity: 0.0022,
    touchSensitivityMultiplier: 5.5, // touch drags cover far less pixel distance per frame than raw mouse movementX, so this needs to be well above 1 to feel comparable
    bobFrequencyWalk: 7.2,
    bobFrequencySprint: 10.5,
    bobAmplitudeWalk: 0.035,
    bobAmplitudeSprint: 0.06,
    fovBase: 72,
    fovSprintAdd: 6,
    fovTransitionSpeed: 6,
    landingShakeDecay: 6,
    staminaMax: 100,
    staminaDrainPerSec: 18,
    staminaRegenPerSec: 12,
    staminaMinToSprint: 6,
  },

  // Lighting / horror atmosphere
  atmosphere: {
    fogColor: 0x0a0a0c,
    fogNear: 2,
    fogFar: 26,
    ambientIntensity: 0.14,
    flickerCheckIntervalMin: 4,
    flickerCheckIntervalMax: 11,
    flickerEventDurationMin: 0.15,
    flickerEventDurationMax: 1.2,
    rareEventIntervalMin: 25,
    rareEventIntervalMax: 70,
  },

  // Floor 1 — infinite tiled office. The floor is built from square
  // "rooms" (tiles) on a grid, each with doorways on all 4 sides so
  // any room type can connect to any neighbor. Rooms are streamed in
  // around the player and torn down once far behind, so the level has
  // no hard edges.
  floor1: {
    tileSize: 20,          // meters per room tile (X and Z)
    wallHeight: 2.7,
    doorWidth: 2.4,
    wallThickness: 0.25,
    // Tiles loaded in each direction around the player's current tile.
    // At radius 2 that's a 5x5 = 25 tiles loaded at once, each with its
    // own furniture and ceiling lights — but atmosphere.fogFar (26) already
    // makes anything past ~1.3 tiles invisible, so the outer ring was
    // being fully built, lit, and rendered for nothing. Radius 1 (9 tiles)
    // still leaves a comfortable buffer past the fog line for seamless
    // streaming, at roughly a third of the geometry/light cost.
    streamRadius: 1,
    streamRebuildMargin: 0.5, // fraction of a tile the player must cross before re-streaming
    minTilesFromSpawnForExit: 20, // min tiles out an exit gate can be placed
    maxTilesFromSpawnForExit: 50, // max tiles out an exit gate can be placed
    exitGateCount: 4,             // how many permanent exit gates exist on the floor
  },
};
