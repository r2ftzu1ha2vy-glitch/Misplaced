/**
 * atmosphereSystem.js
 * ---------------------------------------------------------------
 * Drives rare, subtle "did I just see that?" horror beats that are
 * independent of any enemy AI (which is intentionally out of scope
 * for this pass). Currently supports:
 *   - Rare object micro-nudge (a chair/plant shifts slightly)
 *   - Rare "far-off sound" hook point (no-op until audio is added)
 *
 * Everything here is opt-in per-object: register objects you want
 * eligible for tension events, and the system takes it from there.
 * ---------------------------------------------------------------
 */

class AtmosphereSystem {
  constructor() {
    this.eligibleObjects = [];
    this.toppleTraps = [];
    this._clock = 0;
    this._nextEventAt = Utils.randRange(
      GAME_CONFIG.atmosphere.rareEventIntervalMin,
      GAME_CONFIG.atmosphere.rareEventIntervalMax
    );

    // Set once the fall.mp3 buffer finishes loading (see main.js); topple
    // traps that fire before then just skip the sound rather than erroring.
    this._audioListener = null;
    this._fallBuffer = null;

    // Tiles unload/reload as the player moves, which used to re-run each
    // room builder from scratch and re-register a brand-new, fully "idle"
    // topple trap every time — so a cabinet that already fell would just
    // reset itself and be able to fall again on a return visit. This set
    // persists for the whole game session (never cleared on tile unload)
    // and remembers which trap keys have already fired, so a re-furnished
    // slot can skip re-arming them.
    this._toppledKeys = new Set();
  }

  /** Called once from main.js after the cabinet-topple sound has loaded. */
  setFallSound(listener, buffer) {
    this._audioListener = listener;
    this._fallBuffer = buffer;
  }

  registerObject(obj) {
    this.eligibleObjects.push({
      obj,
      originalRotationY: obj.rotation.y,
      originalPosition: obj.position.clone(),
    });
  }

  /**
   * obj: the cabinet mesh (already placed/added to the scene, already in colliders).
   * opts: { fallAxis: "x"|"z", fallDirection: 1|-1, triggerRadius, key }
   * `key` is a stable identifier for this exact trap slot (e.g. a tile
   * coordinate + slot index) — required so a re-furnished tile can tell
   * "this cabinet already fell once" apart from "this is a fresh cabinet",
   * across unload/reload cycles.
   * The cabinet stays a normal collider until the player walks within
   * triggerRadius (in the object's own local tile space, checked against
   * the object's world position each frame), at which point it topples
   * once — a quick rotate-and-drop animated over ~0.5s — and never
   * re-arms, even if the tile unloads and is rebuilt later. Cheap: this is
   * a flat array checked once per frame, not a physics simulation.
   */
  registerToppleTrap(obj, opts) {
    const key = opts.key;
    const alreadyToppled = key != null && this._toppledKeys.has(key);

    if (alreadyToppled) {
      // Spawn it already fallen — no trigger, no re-animation, no sound —
      // so the room looks consistent with what the player already saw.
      const fallAngle = Math.PI / 2;
      const fallDirection = opts.fallDirection === -1 ? -1 : 1;
      if ((opts.fallAxis === "z" ? "z" : "x") === "x") {
        obj.rotation.z -= fallDirection * fallAngle;
      } else {
        obj.rotation.x += fallDirection * fallAngle;
      }
      obj.position.y -= 0.05;
      return;
    }

    const worldPos = new THREE.Vector3();
    obj.getWorldPosition(worldPos);
    this.toppleTraps.push({
      obj,
      key,
      worldPos,
      fallAxis: opts.fallAxis === "z" ? "z" : "x",
      fallDirection: opts.fallDirection === -1 ? -1 : 1,
      triggerRadius: opts.triggerRadius || 2.2,
      state: "idle", // idle -> falling -> done
      fallElapsed: 0,
      fallDuration: 0.45,
      startRotZ: obj.rotation.z,
      startRotX: obj.rotation.x,
      startY: obj.position.y,
    });
  }

  /**
   * Called when a tile unloads. Both eligibleObjects (nudge candidates)
   * and toppleTraps reference meshes that belong to a specific tile's
   * group — without this, every tile ever streamed in leaves its chairs/
   * plants/cabinets registered forever, even after their geometry is
   * disposed and the tile is long gone. toppleTraps in particular is
   * walked and distance-checked every single frame, so that array
   * growing without bound as the player wanders is a real, worsening
   * per-frame cost — not just wasted memory.
   */
  forgetGroup(group) {
    const isInGroup = (obj) => {
      let n = obj;
      while (n) {
        if (n === group) return true;
        n = n.parent;
      }
      return false;
    };
    this.eligibleObjects = this.eligibleObjects.filter((e) => !isInGroup(e.obj));
    this.toppleTraps = this.toppleTraps.filter((t) => !isInGroup(t.obj));

    // A cabinet can start falling (and start its sound) right before the
    // player sprints far enough away to unload that tile — stop any
    // still-playing PositionalAudio in this group so it doesn't keep
    // playing detached from a disposed mesh.
    group.traverse((n) => {
      if (n.isAudio && n.isPlaying) n.stop();
    });
  }

  /** Spawns a one-shot PositionalAudio on the toppling cabinet itself, so
   *  the sound pans and attenuates with distance/direction like a real
   *  object in the room. Silently no-ops if the buffer hasn't finished
   *  loading yet (rare — only possible in the first few seconds of play). */
  _playFallSound(cabinetObj) {
    if (!this._audioListener || !this._fallBuffer) return;
    const sound = new THREE.PositionalAudio(this._audioListener);
    sound.setBuffer(this._fallBuffer);
    sound.setRefDistance(3);
    sound.setRolloffFactor(1.5);
    sound.setVolume(1.0);
    sound.setLoop(false);
    // Auto-cleanup once playback finishes so these don't pile up on the
    // cabinet mesh (which itself gets disposed when its tile unloads, but
    // this handles the common case of finishing first).
    sound.onEnded = () => {
      if (sound.parent) sound.parent.remove(sound);
    };
    cabinetObj.add(sound);
    sound.play();
  }

  update(dt, playerPosition) {
    this._updateToppleTraps(dt, playerPosition);

    this._clock += dt;
    if (this._clock < this._nextEventAt) return;

    this._nextEventAt = this._clock + Utils.randRange(
      GAME_CONFIG.atmosphere.rareEventIntervalMin,
      GAME_CONFIG.atmosphere.rareEventIntervalMax
    );

    if (this.eligibleObjects.length === 0) return;

    // Prefer objects currently out of the player's view frustum-ish
    // (cheap approximation: behind the player or far away) so changes
    // are "unseen" rather than happening in front of the player.
    const candidates = this.eligibleObjects.filter((entry) => {
      const d = entry.obj.position.distanceTo(playerPosition);
      return d > 4; // far enough to be plausible as unnoticed
    });
    const pool = candidates.length > 0 ? candidates : this.eligibleObjects;
    const pick = pool[Math.floor(Math.random() * pool.length)];

    // Subtle nudge: small rotation drift, easy to miss on a return glance
    const nudge = Utils.randRange(0.08, 0.22) * Utils.randSign();
    pick.obj.rotation.y = pick.originalRotationY + nudge;

    Utils.logInfo(`Atmosphere event: nudged "${pick.obj.userData.assetKey || pick.obj.name}"`);
  }

  _updateToppleTraps(dt, playerPosition) {
    for (const trap of this.toppleTraps) {
      if (trap.state === "done") continue;

      if (trap.state === "idle") {
        const d = trap.worldPos.distanceTo(playerPosition);
        if (d <= trap.triggerRadius) {
          trap.state = "falling";
          if (trap.key != null) this._toppledKeys.add(trap.key);
          this._playFallSound(trap.obj);
          Utils.logInfo("Atmosphere event: cabinet toppled near player");
        }
        continue;
      }

      // state === "falling"
      trap.fallElapsed += dt;
      const t = Math.min(trap.fallElapsed / trap.fallDuration, 1);
      // ease-out so it snaps hard at the start (startle) and settles slow
      const eased = 1 - Math.pow(1 - t, 3);
      const fallAngle = eased * (Math.PI / 2);

      if (trap.fallAxis === "x") {
        trap.obj.rotation.z = trap.startRotZ - trap.fallDirection * fallAngle;
      } else {
        trap.obj.rotation.x = trap.startRotX + trap.fallDirection * fallAngle;
      }
      // slight sink as it lands flat so it doesn't hover mid-fall
      trap.obj.position.y = trap.startY - eased * 0.05;

      if (t >= 1) trap.state = "done";
    }
  }
}
