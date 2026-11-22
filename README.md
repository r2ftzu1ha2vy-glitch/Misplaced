# MISPLACED — Level 1, endless backrooms (Three.js)

Infinite grid of 10 x 10 m rooms built from your six GLBs.

## Run
Browsers refuse to load modules and GLBs from `file://`, so serve the folder:

    python3 serve.py            # then open http://localhost:8080
    python3 serve.py --port 9000

Optional: `http://localhost:8080/?seed=1234` replays the same layout.

## Controls
WASD move · Shift sprint (limited stamina) · mouse look · F flashlight · ESC pause · F3 debug · B fullbright · R new run

## How it works
* **Room choice** – every cell picks one of Room1–Room5 and a random 90° rotation, deterministically from the seed. `RoomExit` is placed exactly once, 6–12 cells from the start.
* **Blockers** – each doorway has a transparent `Blocker` slab in the GLB. A doorway is switched ON (visible + solid, using the room's wall material) with probability `blockerChance` (0.35). Both rooms sharing a doorway always agree.
* **Never trapped** – every cell keeps one doorway open toward the start, so every cell, and the exit, is always reachable. The exit door itself faces a non-route doorway, which is forced shut on the far side.
* **Streaming** – only the current cell and its left / right / front / back neighbours exist in the scene. Everything else is removed immediately. GLBs are parsed once at startup and cloned per cell; shared geometry, materials and textures are never disposed.
* **Shared walls** – two neighbouring rooms both contain a wall slab on the same plane. Only one of them draws it (and collides), so there is no z-fighting.
* **Collision** – circle vs axis-aligned boxes on walls, visible blockers and furniture meshes. Set `collideFurniture: false` in `js/config.js` to collide with walls only.

## The horror
* **It** – after ~25 s something starts walking the open doorways toward you. It **freezes while you look at it** (clear line of sight, near the centre of your view) and moves when you don't. It gets faster every minute (1.5 → 3.7 m/s). Outrun it and it re-appears further along. Stare too long and the lights die and it lunges closer. Touch = death. Tuning: `CONFIG.entity`.
* **Light** – dark ambient, one flickering ceiling light per loaded room, random room blackouts, a flashlight (F). Lights go unstable as it approaches.
* **Sound** – synthesised drone, fluorescent hum, distant thumps/creaks/scrapes, positional breathing from the entity, heartbeat and tinnitus that build with proximity, footsteps, a roar on first sight, a scream on death. Headphones recommended.
* **Screen** – film grain, red vignette, camera shake and FOV pinch as dread rises.

## Files
    index.html          page + overlays
    serve.py            local static server
    js/config.js        every tunable value
    js/world.js         seeded generator (rooms, blockers, exit) — no THREE/DOM
    js/rooms.js         GLB cache + load/unload + blocker/wall/collision setup
    js/player.js        first-person controller, stamina, collision
    js/entity.js        the thing that follows you
    js/audio.js         all sound (WebAudio)
    js/main.js          renderer, loop, UI
    lib/                three.js r160 + GLTFLoader (vendored, works offline)
    assets/rooms/       the 6 GLBs
    assets/audio/       roar, screech, footsteps, body fall
    tests/              node tests/test_world.mjs, node tests/test_rooms.mjs, node tests/test_entity.mjs

## Notes
* The GLBs total ~32 MB after texture compression (originals were ~145 MB; Room1 was 52 MB). Re-run `python3 tools/shrink_glb.py <in> -o <out>` on any new GLB; options: `--max-size`, `--quality`.
* Visible edge of the world is hidden by fog (`CONFIG.fog`). With only 5 rooms loaded, fog far must stay ≈ 16 or less.
