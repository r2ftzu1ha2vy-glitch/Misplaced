/**
 * config.js — every tunable value lives here.
 * Edit this file; nothing else needs to change for normal tweaks.
 */
export const CONFIG = {
  // --- Grid ---------------------------------------------------------------
  cellSize: 10,          // every room GLB is exactly 10 x 10 metres
  floorY: 0.2034,        // world Y of the floor surface (top of the "Cube" floor slab)

  // --- Room files (assets/rooms/) -----------------------------------------
  roomDir: 'assets/rooms/',
  roomFiles: {
    Room1: 'Level1_Room1.glb',
    Room2: 'Level1_Room2.glb',
    Room3: 'Level1_Room3.glb',
    Room4: 'Level1_Room4.glb',
    Room5: 'Level1_Room5.glb',
    Exit:  'Level1_RoomExit.glb',
  },
  // Rooms picked at random for ordinary cells. The exit room is placed once, separately.
  regularRooms: ['Room1', 'Room2', 'Room3', 'Room4', 'Room5'],

  // --- Doorway blockers ----------------------------------------------------
  // Each room has a (normally invisible) "Blocker" slab in every doorway.
  // For every doorway that is NOT on the guaranteed route back to the start,
  // this is the chance the blocker is switched ON (visible + solid).
  blockerChance: 0.35,

  // --- Exit placement --------------------------------------------------------
  // The exit room is placed on a ring this many cells from the start (Chebyshev distance).
  exitMinRing: 6,
  exitMaxRing: 12,

  // --- Collision ----------------------------------------------------------------
  collideFurniture: true,  // furniture meshes block the player too (axis-aligned boxes)
  minPropSize: 0.12,       // ignore furniture meshes smaller than this (metres) in X and Z

  // --- Look ---------------------------------------------------------------------
  fog: { color: 0x14110a, near: 3, far: 16 },
  lighting: {
    ambient: 1.5,          // base light everywhere
    ambientColor: 0xfff2c8,
    pointIntensity: 45,    // one ceiling light per loaded room
    pointColor: 0xfff1c9,
    pointHeight: 4.6,
    pointDistance: 24,
    exitColor: 0xcfffe0,
    exitIntensity: 70,
    flicker: true,
  },

  // --- Player ---------------------------------------------------------------------
  player: {
    eyeHeight: 1.62,
    radius: 0.3,
    walkSpeed: 2.8,
    sprintSpeed: 5.2,
    acceleration: 40,
    deceleration: 30,
    sensitivity: 0.0022,
    fov: 72,
    bobAmount: 0.03,
    bobSpeed: 7.5,
  },
};
