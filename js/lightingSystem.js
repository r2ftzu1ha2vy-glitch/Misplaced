/**
 * lightingSystem.js
 * ---------------------------------------------------------------
 * Manages every fluorescent ceiling fixture in the level:
 *  - Base steady-state flicker (subtle, always-on shimmer)
 *  - Randomized "failure events" per light (goes dark / strobes
 *    for a bit / comes back), independent per fixture
 *  - Cheap emissive glow toggling on the fixture mesh material
 *
 * Designed to be driven entirely from a flat list of registered
 * lights so new floors/rooms can add more without touching logic.
 * ---------------------------------------------------------------
 */

class LightingSystem {
  constructor(scene) {
    this.scene = scene;
    this.fixtures = []; // { light: THREE.PointLight, mesh: THREE.Object3D, seed, nextEventAt, eventUntil, eventKind, baseIntensity }
    this._clock = 0;
  }

  registerFixture(light, mesh, baseIntensity = 1.2) {
    const seed = Math.random() * 1000;
    this.fixtures.push({
      light,
      mesh,
      seed,
      baseIntensity,
      // Give every fixture a guaranteed calm period on spawn/load, on
      // top of the normal randomized interval, so the player never
      // opens their eyes into a coin-flip blackout before they've even
      // gotten their bearings in a brand-new room.
      nextEventAt: this._clock + GAME_CONFIG.atmosphere.flickerGraceSeconds + Utils.randRange(
        GAME_CONFIG.atmosphere.flickerCheckIntervalMin,
        GAME_CONFIG.atmosphere.flickerCheckIntervalMax
      ),
      eventUntil: 0,
      eventKind: null,
    });
  }

  update(dt) {
    this._clock += dt;
    const atmo = GAME_CONFIG.atmosphere;

    for (const f of this.fixtures) {
      // subtle always-on shimmer so fluorescents never feel perfectly static
      const shimmer = 0.94 + 0.06 * Math.sin(this._clock * 9 + f.seed) * Utils.hashSeed(f.seed + Math.floor(this._clock * 0.5));

      let intensityMul = shimmer;

      if (this._clock >= f.nextEventAt && !f.eventKind) {
        // start a failure event
        f.eventKind = Math.random() < 0.6 ? "strobe" : "blackout";
        f.eventUntil = this._clock + Utils.randRange(
          atmo.flickerEventDurationMin,
          atmo.flickerEventDurationMax
        );
      }

      if (f.eventKind) {
        if (f.eventKind === "strobe") {
          intensityMul = (Math.sin(this._clock * 40) > 0) ? 1.4 : 0.05;
        } else if (f.eventKind === "blackout") {
          // Not a true zero — reads as "failing fixture" rather than
          // "fixture doesn't exist," keeping the room just barely
          // navigable through the event instead of going pitch black.
          intensityMul = 0.12;
        }
        if (this._clock >= f.eventUntil) {
          f.eventKind = null;
          f.nextEventAt = this._clock + Utils.randRange(
            atmo.flickerCheckIntervalMin,
            atmo.flickerCheckIntervalMax
          );
        }
      }

      intensityMul = Utils.clamp(intensityMul, 0, 1.5);

      f.light.intensity = f.baseIntensity * intensityMul;

      if (f.mesh) {
        f.mesh.traverse((n) => {
          if (n.isMesh && n.material && "emissiveIntensity" in n.material) {
            n.material.emissiveIntensity = intensityMul;
          }
        });
      }
    }
  }
}
