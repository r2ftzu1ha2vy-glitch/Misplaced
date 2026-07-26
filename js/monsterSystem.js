/**
 * monsterSystem.js
 * ---------------------------------------------------------------
 * Floor 1's "N-tity" and Floor 2's "Ghoxt" — the game's two enemies.
 * Both are simple, cheap state machines (no pathfinding — direct
 * line-of-travel is enough for the small rooms/tiles involved) driven
 * every frame from floorManager.js, which already owns all per-frame
 * scene/state dispatch.
 *
 *  N-tity (NtityAI): lives in Floor 1's 6-cabinet "server room". The
 *  moment the player steps into that room type, N-tity spawns in off
 *  to one side and wanders blind — it does not know where the player
 *  is. Only once the player is within its sight radius AND inside its
 *  forward vision cone for `noticeTime` seconds does it start hunting.
 *  Its chase speed is kept below the player's own walk speed, so a
 *  player who notices it first (or breaks line of sight) can outrun
 *  it; if the player escapes the room, N-tity keeps chasing into the
 *  rest of the office but slower still, until it either catches the
 *  player or the player puts enough distance between them that it
 *  gives up.
 *
 *  Ghoxt (GhoxtAI): only ever lurks inside Floor 2's hotel room
 *  interiors, never the corridor. Each room the player enters has a
 *  chance of having Ghoxt waiting in a back corner; after a short
 *  pause it reveals itself with a screech and drifts toward the
 *  player in that room's confined space.
 *
 * Both fire a shared onCatch(who) callback when they reach the
 * player — floorManager forwards that straight to main.js's death
 * sequence.
 * ---------------------------------------------------------------
 */

class NtityAI {
  constructor(scene, assets, audioListener) {
    this.scene = scene;
    this.assets = assets;
    this.audioListener = audioListener;
    this.cfg = GAME_CONFIG.monsters.ntity;

    this.group = null;
    this.active = false;   // currently spawned & visible in the world
    this.hunting = false;  // actively chasing the player (has noticed them)
    this.inHomeRoom = false;

    // Wander state — active while spawned but not yet hunting.
    this._homeCenter = null;      // world {x,z} of the room it spawned in, wander stays near here
    this._wanderTarget = null;    // current {x,z} it's walking toward
    this._wanderPauseTimer = 0;   // idle pause between wander legs
    this._sightTimer = 0;         // accumulates while the player is visible; hunting starts at noticeTime

    this._roarBuffer = null;
    this._teleportBuffer = null;
    this._footstepBuffer = null;
    this._roarTimer = 0;
    this._footstepAudio = null; // looping PositionalAudio while active
    this._bobTime = 0;

    this._loadAudio();
  }

  _loadAudio() {
    const loader = new THREE.AudioLoader();
    const base = GAME_CONFIG.audio.basePath;
    loader.load(base + GAME_CONFIG.audio.ntityRoar, (b) => (this._roarBuffer = b),
      undefined, (e) => Utils.logError("Failed to load N-tity roar: " + (e && e.message ? e.message : e)));
    loader.load(base + GAME_CONFIG.audio.teleportWoosh, (b) => (this._teleportBuffer = b),
      undefined, (e) => Utils.logError("Failed to load teleport woosh: " + (e && e.message ? e.message : e)));
    loader.load(base + GAME_CONFIG.audio.ntityFootsteps, (b) => (this._footstepBuffer = b),
      undefined, (e) => Utils.logError("Failed to load N-tity footsteps: " + (e && e.message ? e.message : e)));
  }

  /** Called whenever Floor 1 is (re)built fresh — clears any leftover
   *  hunt state from a previous life of the floor. */
  reset() {
    this._despawn();
  }

  _spawnWanderingAt(pos) {
    if (!this.group) {
      this.group = this.assets.get(this.cfg.modelKey, true);
      this.group.name = "Ntity";
    }
    if (!this.group.parent) this.scene.add(this.group);
    this.group.position.set(pos.x, 0, pos.z);
    this.group.rotation.y = Math.random() * Math.PI * 2;
    this.active = true;
    this.hunting = false;
    this._homeCenter = { x: pos.x, z: pos.z };
    this._wanderTarget = null;
    this._wanderPauseTimer = 0;
    this._sightTimer = 0;
    this._startFootsteps();
  }

  _despawn() {
    if (this.group && this.group.parent) this.group.parent.remove(this.group);
    this.active = false;
    this.hunting = false;
    this.inHomeRoom = false;
    this._homeCenter = null;
    this._wanderTarget = null;
    this._sightTimer = 0;
    this._stopFootsteps();
  }

  /** True if `targetPos` is within sight range AND inside N-tity's
   *  forward-facing vision cone — sneaking up from behind or staying
   *  far away both keep it from noticing the player. */
  _canSee(targetPos) {
    if (!this.group) return false;
    const dx = targetPos.x - this.group.position.x;
    const dz = targetPos.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > this.cfg.sightRadius || dist < 0.001) return dist <= this.cfg.sightRadius;

    const facing = this.group.rotation.y;
    // Forward vector matches the lookAt convention used elsewhere in
    // this file (model's forward is -Z rotated by rotation.y).
    const fx = -Math.sin(facing), fz = -Math.cos(facing);
    const toTargetX = dx / dist, toTargetZ = dz / dist;
    const dot = fx * toTargetX + fz * toTargetZ;
    const halfFovCos = Math.cos((this.cfg.fovDegrees * Math.PI / 180) / 2);
    return dot >= halfFovCos;
  }

  _pickWanderTarget() {
    const c = this._homeCenter;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * this.cfg.wanderRadius;
    return { x: c.x + Math.cos(angle) * r, z: c.z + Math.sin(angle) * r };
  }

  _updateWander(dt) {
    if (this._wanderPauseTimer > 0) {
      this._wanderPauseTimer -= dt;
      return;
    }
    if (!this._wanderTarget) {
      this._wanderTarget = this._pickWanderTarget();
    }
    const dx = this._wanderTarget.x - this.group.position.x;
    const dz = this._wanderTarget.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= 0.25) {
      // Reached the wander point — pause a beat, then pick a new one.
      this._wanderTarget = null;
      this._wanderPauseTimer = Utils.randRange(this.cfg.wanderPauseMin, this.cfg.wanderPauseMax);
      return;
    }
    const nx = dx / dist, nz = dz / dist;
    this.group.position.x += nx * this.cfg.wanderSpeed * dt;
    this.group.position.z += nz * this.cfg.wanderSpeed * dt;
    this.group.rotation.y = Math.atan2(-nx, -nz);
  }

  _playOneShot(buffer, volume) {
    if (!buffer || !this.audioListener || !this.group) return;
    const sound = new THREE.PositionalAudio(this.audioListener);
    sound.setBuffer(buffer);
    sound.setRefDistance(4);
    sound.setRolloffFactor(1.3);
    sound.setVolume(volume != null ? volume : 1.0);
    sound.setLoop(false);
    sound.onEnded = () => sound.parent && sound.parent.remove(sound);
    this.group.add(sound);
    sound.play();
  }

  _startFootsteps() {
    if (!this._footstepBuffer || !this.group || this._footstepAudio) return;
    const sound = new THREE.PositionalAudio(this.audioListener);
    sound.setBuffer(this._footstepBuffer);
    sound.setRefDistance(3);
    sound.setRolloffFactor(1.6);
    sound.setLoop(true);
    sound.setVolume(0.85);
    this.group.add(sound);
    sound.play();
    this._footstepAudio = sound;
  }

  _stopFootsteps() {
    if (!this._footstepAudio) return;
    if (this._footstepAudio.isPlaying) this._footstepAudio.stop();
    if (this._footstepAudio.parent) this._footstepAudio.parent.remove(this._footstepAudio);
    this._footstepAudio = null;
  }

  /**
   * roomStreamer: Floor 1's RoomStreamer, used to check what room type
   * the player is currently standing in.
   * onCatch(who): fired the instant N-tity reaches the player.
   */
  update(dt, playerPos, roomStreamer, onCatch) {
    if (!roomStreamer) return;

    const roomType = roomStreamer.getRoomTypeAt(playerPos.x, playerPos.z);
    const inHomeRoom = roomType === this.cfg.homeRoomType;

    if (this._roarTimer > 0) this._roarTimer -= dt;

    if (inHomeRoom && !this.active) {
      // Player just walked into the cabinet room — N-tity spawns in,
      // off to one side, and starts wandering blind. It does NOT know
      // where the player is yet; it has to actually spot them first.
      const angle = Math.random() * Math.PI * 2;
      const spawnPos = {
        x: playerPos.x + Math.cos(angle) * this.cfg.spawnLeadDistance,
        z: playerPos.z + Math.sin(angle) * this.cfg.spawnLeadDistance,
      };
      this._spawnWanderingAt(spawnPos);
      Utils.logInfo("N-tity has entered the cabinet room and is wandering.");
    }

    if (!this.active || !this.group) return;

    this.inHomeRoom = inHomeRoom;

    if (!this.hunting) {
      // --- Wandering / detection phase ---
      const seen = this._canSee(playerPos);
      if (seen) {
        this._sightTimer += dt;
        if (this._sightTimer >= this.cfg.noticeTime) {
          this.hunting = true;
          if (this._roarTimer <= 0) {
            this._playOneShot(this._roarBuffer, 1.0);
            this._roarTimer = this.cfg.roarCooldown;
          }
          Utils.logInfo("N-tity noticed the player and is now hunting.");
        }
      } else {
        this._sightTimer = Math.max(0, this._sightTimer - dt * 2);
      }

      if (!this.hunting) {
        this._updateWander(dt);
        this._bobTime += dt * 5;
        this.group.position.y = Math.abs(Math.sin(this._bobTime)) * 0.04;
        return;
      }
    }

    // --- Hunting / chase phase — always slower than the player's
    // normal walkSpeed so a player who reacts in time can put
    // distance between them, especially once outside the home room. ---
    const speed = this.inHomeRoom ? this.cfg.chaseSpeed : this.cfg.chaseSpeed * this.cfg.slowSpeedMultiplier;
    const dx = playerPos.x - this.group.position.x;
    const dz = playerPos.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.001) {
      const nx = dx / dist, nz = dz / dist;
      this.group.position.x += nx * speed * dt;
      this.group.position.z += nz * speed * dt;
      this.group.lookAt(playerPos.x, this.group.position.y, playerPos.z);
    }

    // Small vertical bob so a static (unanimated) model still reads as
    // "moving" rather than gliding like a cardboard cutout.
    this._bobTime += dt * (this.inHomeRoom ? 9 : 6.5);
    this.group.position.y = Math.abs(Math.sin(this._bobTime)) * 0.05;

    if (dist <= this.cfg.catchRadius) {
      this.hunting = false;
      this._stopFootsteps();
      if (onCatch) onCatch("ntity");
      return;
    }

    if (!this.inHomeRoom && dist > this.cfg.giveUpDistance) {
      Utils.logInfo("N-tity lost the player and gave up the hunt.");
      this._despawn();
    }
  }
}

class GhoxtAI {
  constructor(assets, audioListener) {
    this.assets = assets;
    this.audioListener = audioListener;
    this.cfg = GAME_CONFIG.monsters.ghoxt;

    this.group = null;
    this.active = false;
    this.revealed = false;
    this._revealTimer = 0;
    this._screechBufferA = null;
    this._screechBufferB = null;
    this._bobTime = 0;

    this._loadAudio();
  }

  _loadAudio() {
    const loader = new THREE.AudioLoader();
    const base = GAME_CONFIG.audio.basePath;
    loader.load(base + GAME_CONFIG.audio.ghoxtScreech1, (b) => (this._screechBufferA = b),
      undefined, (e) => Utils.logError("Failed to load Ghoxt screech 1: " + (e && e.message ? e.message : e)));
    loader.load(base + GAME_CONFIG.audio.ghoxtScreech2, (b) => (this._screechBufferB = b),
      undefined, (e) => Utils.logError("Failed to load Ghoxt screech 2: " + (e && e.message ? e.message : e)));
  }

  /** Called right after a hotel room interior is built and added to the
   *  scene. roomGroup: that room's THREE.Group (local-space room, door
   *  always at local +Z per hotelRooms.js). Rolls a chance for Ghoxt to
   *  be lurking in this particular room. */
  onRoomEnter(roomGroup) {
    this.group = null;
    this.active = false;
    this.revealed = false;
    this._revealTimer = 0;

    if (Math.random() >= this.cfg.lurkChance) return; // this room is empty

    this.group = this.assets.get(this.cfg.modelKey, true);
    this.group.name = "Ghoxt";
    const cornerX = Math.random() < 0.5 ? -2.1 : 2.1;
    this.group.position.set(cornerX, 0, -2.6); // back corner, away from the door at +Z
    this.group.rotation.y = Math.random() * Math.PI * 2;
    roomGroup.add(this.group);

    this.active = true;
    this._revealTimer = GAME_CONFIG.monsters.ghoxt.revealDelayMin +
      Math.random() * (GAME_CONFIG.monsters.ghoxt.revealDelayMax - GAME_CONFIG.monsters.ghoxt.revealDelayMin);

    Utils.logInfo("Ghoxt is lurking in this room.");
  }

  /** Called when the player leaves the room, before/after the room
   *  group itself is disposed — just drops our references, the mesh
   *  and any attached PositionalAudio get cleaned up along with the
   *  room group by hotelStreamer.exitRoom(). */
  onRoomExit() {
    this.group = null;
    this.active = false;
    this.revealed = false;
  }

  /**
   * playerLocalPos: player position converted into the room's own
   * local space (world position minus the room group's world offset —
   * hotel rooms are parked far off at (5000,0,0) so they never overlap
   * the corridor, see hotelStreamer.js).
   */
  update(dt, playerLocalPos, onCatch) {
    if (!this.active || !this.group) return;

    if (!this.revealed) {
      this._revealTimer -= dt;
      if (this._revealTimer <= 0) {
        this.revealed = true;
        this._playScreech();
      }
      return;
    }

    const dx = playerLocalPos.x - this.group.position.x;
    const dz = playerLocalPos.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.001) {
      const nx = dx / dist, nz = dz / dist;
      this.group.position.x += nx * this.cfg.moveSpeed * dt;
      this.group.position.z += nz * this.cfg.moveSpeed * dt;
      this.group.lookAt(playerLocalPos.x, this.group.position.y, playerLocalPos.z);
    }

    // Gentle float, ghosts don't walk
    this._bobTime += dt * 2.2;
    this.group.position.y = 0.08 + Math.sin(this._bobTime) * 0.05;

    if (dist <= this.cfg.catchRadius) {
      this.active = false;
      if (onCatch) onCatch("ghoxt");
    }
  }

  _playScreech() {
    if (!this.audioListener || !this.group) return;
    const buffer = Math.random() < 0.5 ? this._screechBufferA : this._screechBufferB;
    if (!buffer) return;
    const sound = new THREE.PositionalAudio(this.audioListener);
    sound.setBuffer(buffer);
    sound.setRefDistance(2.5);
    sound.setRolloffFactor(1.2);
    sound.setVolume(1.0);
    sound.setLoop(false);
    sound.onEnded = () => sound.parent && sound.parent.remove(sound);
    this.group.add(sound);
    sound.play();
  }
}
