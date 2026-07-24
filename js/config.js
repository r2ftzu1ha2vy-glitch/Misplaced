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
    rustyFileCabinet:   "rusty_filing_cabinet.glb",
    scp096:             "scp-096_-_true_hd_sound_mod.glb", // model only for now, audio skipped
    whiteboard:         "whiteboard.glb",
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
    ambientIntensity: 0.06,
    flickerCheckIntervalMin: 4,
    flickerCheckIntervalMax: 11,
    flickerEventDurationMin: 0.15,
    flickerEventDurationMax: 1.2,
    rareEventIntervalMin: 25,
    rareEventIntervalMax: 70,
  },

  // Floor 1 grid — room size used to lay out the hand-authored plan
  floor1: {
    cellSize: 3.2,        // meters per grid cell
    wallHeight: 2.7,
    corridorWidth: 2,
  },
};
