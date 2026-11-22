# MISPLACED — Level 1, endless backrooms (Three.js)

Infinite grid of 10 x 10 m rooms built from your six GLBs.

## Run
Browsers refuse to load modules and GLBs from `file://`, so serve the folder:

    python3 serve.py            # then open http://localhost:8080
    python3 serve.py --port 9000

Optional: `http://localhost:8080/?seed=1234` replays the same layout.

## Controls
WASD move · Shift sprint · mouse look · ESC pause · F3 debug · B fullbright · R new run

## How it works
* **Room choice** – every cell picks one of Room1–Room5 and a random 90° rotation, deterministically from the seed. `RoomExit` is placed exactly once, 6–12 cells from the start.
* **Blockers** – each doorway has a transparent `Blocker` slab in the GLB. A doorway is switched ON (visible + solid, using the room's wall material) with probability `blockerChance` (0.35). Both rooms sharing a doorway always agree.
* **Never trapped** – every cell keeps one doorway open toward the start, so every cell, and the exit, is always reachable. The exit door itself faces a non-route doorway, which is forced shut on the far side.
* **Streaming** – only the current cell and its left / right / front / back neighbours exist in the scene. Everything else is removed immediately. GLBs are parsed once at startup and cloned per cell; shared geometry, materials and textures are never disposed.
* **Shared walls** – two neighbouring rooms both contain a wall slab on the same plane. Only one of them draws it (and collides), so there is no z-fighting.
* **Collision** – circle vs axis-aligned boxes on walls, visible blockers and furniture meshes. Set `collideFurniture: false` in `js/config.js` to collide with walls only.

## Files
    index.html          page + overlays
    serve.py            local static server
    js/config.js        every tunable value
    js/world.js         seeded generator (rooms, blockers, exit) — no THREE/DOM
    js/rooms.js         GLB cache + load/unload + blocker/wall/collision setup
    js/player.js        first-person controller + collision
    js/main.js          renderer, loop, UI
    lib/                three.js r160 + GLTFLoader (vendored, works offline)
    assets/rooms/       the 6 GLBs
    tests/              node tests/test_world.mjs, node tests/test_rooms.mjs

## Notes
* The GLBs total ~145 MB (Room1 alone is 52 MB), so the first load takes a moment.
* Visible edge of the world is hidden by fog (`CONFIG.fog`). With only 5 rooms loaded, fog far must stay ≈ 16 or less.
