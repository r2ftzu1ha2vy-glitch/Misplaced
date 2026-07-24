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

  update(dt, playerPosition) {
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
}
