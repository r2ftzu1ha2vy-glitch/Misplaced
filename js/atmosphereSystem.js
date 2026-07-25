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
   * opts: { fallAxis: "x"|"z", fallDirection: 1|-1, triggerRadius }
   * The cabinet stays a normal collider until the player walks within
   * triggerRadius (in the object's own local tile space, checked against
   * the object's world position each frame), at which point it topples
   * once — a quick rotate-and-drop animated over ~0.5s — and never
   * re-arms. Cheap: this is a flat array checked once per frame, not a
   * physics simulation.
   */
  registerToppleTrap(obj, opts) {
    const worldPos = new THREE.Vector3();
    obj.getWorldPosition(worldPos);
    this.toppleTraps.push({
      obj,
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
