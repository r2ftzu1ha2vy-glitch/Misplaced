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
    scp096:             "scp-096_-_true_hd_sound_mod.glb", // also the N-tity monster model (see monsterSystem.js)
    whiteboard:         "whiteboard.glb",
    exitDoor:           "access_card.glb",
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

  // Shared sound-effect library. Keyed here so monsterSystem.js (and
  // anything else) never hardcodes a filename inline.
  audio: {
    basePath: "assets/audio/",
    ntityRoar: "freesound_community-monster-roar-02-102957.mp3",
    ntityFootsteps: "u_3x9ga8wevj-walking-sound-effect-272246.mp3",
    teleportWoosh: "ribhavagrawal-woosh-230554.mp3",
    bodyFall: "universfield-body-fall-259680.mp3",
    ghoxtScreech1: "53439420-flying-monster-screech-01-461221.mp3",
    ghoxtScreech2: "53439420-flying-monster-screech-02-461220.mp3",
  },

  // Monster AI tuning. See js/monsterSystem.js for behavior.
  monsters: {
    // N-tity ("Entity") — Floor 1. Lives in the 6-cabinet server room.
    // Stepping into that room spawns it in off to one side, wandering
    // blind, until it actually sees the player (within sightRadius AND
    // inside its forward fovDegrees cone for noticeTime seconds) — then
    // it hunts at chaseSpeed; if the player makes it out of the room it
    // keeps chasing but slower everywhere else, until it either catches
    // them or loses them.
    ntity: {
      modelKey: "scp096",
      homeRoomType: "serverRoom", // the room type with 6 file cabinets
      spawnLeadDistance: 6,       // how far from the player it spawns when entering the room
      wanderRadius: 5,            // stays within this radius of its spawn point while wandering
      wanderSpeed: 1.2,           // m/s while wandering blind
      wanderPauseMin: 1.0,        // idle pause (seconds) between wander legs
      wanderPauseMax: 2.5,
      sightRadius: 9,             // how far it can see the player at all
      fovDegrees: 100,            // forward vision cone width
      noticeTime: 0.6,            // seconds player must stay seen before it starts hunting
      chaseSpeed: 3.6,            // m/s, inside its home room once hunting
      slowSpeedMultiplier: 0.75,  // 25% slower everywhere else
      catchRadius: 0.9,
      giveUpDistance: 34,         // outside its room, past this range it gives up and vanishes
      roarCooldown: 6,
    },
    // Ghoxt — Floor 2's ghost. Only ever lurks inside hotel room
    // interiors (never the corridor). Each room has a chance to have
    // it waiting in a back corner; after a short delay it reveals
    // itself with a screech and drifts toward the player.
    ghoxt: {
      modelKey: "ghost",
      lurkChance: 0.4,
      moveSpeed: 1.15,
      catchRadius: 0.8,
      revealDelayMin: 1.5,
      revealDelayMax: 4.0,
    },
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
    // Tiles loaded around the player's current tile: a full, static
    // radius-1 = 3x3 = 9-tile grid (every tile touching the player's
    // tile, diagonals included — see roomStreamer.js's _coreOffsets).
    // atmosphere.fogFar (26) already makes anything past ~1.3 tiles
    // invisible, so this still leaves a comfortable buffer past the fog
    // line. Crossing a tile boundary can require rebuilding several of
    // those 9 slots' furniture at once (a full edge, or up to 5 on a
    // diagonal step) — rather than shrinking the grid to cut that cost
    // (which used to leave diagonal tiles unstreamed and visibly
    // "not loaded" through doorways), that rebuild work is spread over
    // multiple frames. This is how many tiles' furniture may be built
    // per frame; lower values smooth out frame time further at the cost
    // of a slightly longer (still sub-second, still off in the
    // fogged-out distance) window before a freshly entered edge tile is
    // fully dressed. Overridden per device tier in main.js's
    // applyDeviceTierConfig.
    furnishPerFrame: 3,
    streamRebuildMargin: 0.5, // fraction of a tile the player must cross before re-streaming
    minTilesFromSpawnForExit: 20, // min tiles out an exit gate can be placed
    maxTilesFromSpawnForExit: 50, // max tiles out an exit gate can be placed
    exitGateCount: 4,             // how many permanent exit gates exist on the floor
  },

  // Floor 2 — The Hotel. A small fixed "lobby" (reception + 2 elevators)
  // that the player spawns into after leaving Floor 1, and an endless
  // corridor (same streamed-tile approach as Floor 1) with doors left
  // and right leading into one of 5 hotel room interiors. The corridor
  // is only entered after riding an elevator up from the lobby.
  assetBasePathFloor2: "assets/floor2/",
  modelsFloor2: {
    receptionDesk:  "reception_desk.glb",
    elevatorDoor:   "elevator_door.glb",
    woodenDoor:     "wooden_door.glb",
    sofa:           "sofa.glb",
    chandelier:     "chandelier.glb",
    nightstand:     "nightstand.glb",
    gothicBed:      "gothic_bed.glb",
    curtain:        "curtain.glb",
    paintingLow:    "painting_lowpoly.glb",
    paintingBek2:   "painting_beksinski_2.glb",
    paintingBek3:   "painting_beksinski_3.glb",
    accessCard:     "access_card.glb",
    ghost:          "ghost_daughter.glb", // Ghoxt — Floor 2's monster, only ever lurks inside hotel rooms
  },
  // Same idea as modelScaleFixes above but for the floor2 model set —
  // several of these Sketchfab exports also bake in oversized real-world
  // scale (verified against each model's true, node-transform-composed
  // bounding box — several exports bake extra scale into a child node's
  // matrix rather than the mesh itself, so a naive look at raw vertex
  // coordinates undercounts or overcounts the real size).
  // gothicBed, curtain, elevatorDoor, chandelier, paintingLow are already
  // correctly real-world-scaled as exported and need no fix.
  modelScaleFixesFloor2: {
    sofa: 0.025,          // raw ~39x38x80 -> ~0.98x0.95x2.0m sofa
    nightstand: 0.0056,   // 100x baked into child node -> ~0.55m tall
    paintingBek2: 0.374,  // raw ~0.24x2.84x3.47 -> ~1.3m tall wall piece
    paintingBek3: 0.258,  // raw ~3.9x5.0x0.58 -> ~1.3m tall wall piece
    accessCard: 0.0065,   // raw ~8x14x1.1 -> ~0.09m long, credit-card scale
    receptionDesk: 0.644, // raw height 1.63 -> ~1.05m counter height
    woodenDoor: 1,    // raw height 6.2 -> ~2.2m doorway height
  },

  hotelLobby: {
    width: 16,
    depth: 18,
    wallHeight: 3.2,
    elevatorZ: -7,
    elevatorSpacingX: 3.2,
    elevatorDoorWidth: 2.0,
    elevatorDoorHeight: 2.4,
    spawnPoint: { x: 0, z: 6 },
  },

  hotelCorridor: {
    tileSize: 8,
    corridorWidth: 3.2,
    wallHeight: 2.9,
    doorWidth: 1.4,
    doorHeight: 2.3,
    wallThickness: 0.2,
    streamRadius: 2,
    minSegmentsFromStartForCard: 15,
    maxSegmentsFromStartForCard: 40,
  },

 // Multiplayer (Firebase Realtime Database)
  multiplayer: {
    firebaseConfig: {
      apiKey: "AIzaSyCcPQgxbntZI4e2mZU0G7TTfPz4rs-5oUo",
      authDomain: "misplaced-b169e.firebaseapp.com",
      databaseURL: "https://misplaced-b169e-default-rtdb.firebaseio.com/",
      projectId: "misplaced-b169e",
    },
    roomCodeChars: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
    roomCodeLength: 4,
    sendRateHz: 15,
    staleTimeoutSec: 8,
  },

  // Player avatar model, used for the local player's multiplayer avatar
  assetBasePathPlayer: "assets/player/",
  playerModel: {
    file: "player.glb",
    scaleFix: 1,
  },
};
