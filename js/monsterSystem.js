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
 *  moment the player steps into that room type, N-tity teleports in
 *  next to them and hunts at full speed. If the player escapes the
 *  room, N-tity keeps chasing into the rest of the office but at 25%
 *  reduced speed, until it either catches the player or the player
 *  puts enough distance between them that it gives up.
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
    this.hunting = false;  // actively chasing the player
    this.inHomeRoom = false;

    this._roarBuffer = null;
    this._teleportBuffer = null;
    this._footstepBuffer = null;
    this._roarTimer = 0;
    this._footstepAudio = null; // looping PositionalAudio, only while hunting outside its room
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

  _spawnAt(pos, lookAtPos) {
    if (!this.group) {
      this.group = this.assets.get(this.cfg.modelKey, true);
      this.group.name = "Ntity";
    }
    if (!this.group.parent) this.scene.add(this.group);
    this.group.position.set(pos.x, 0, pos.z);
    if (lookAtPos) this.group.lookAt(lookAtPos.x, this.group.position.y, lookAtPos.z);
    this.active = true;
  }

  _despawn() {
    if (this.group && this.group.parent) this.group.parent.remove(this.group);
    this.active = false;
    this.hunting = false;
    this.inHomeRoom = false;
    this._stopFootsteps();
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

    if (inHomeRoom && !this.hunting) {
      // Player just walked into the cabinet room — teleport N-tity in.
      const angle = Math.random() * Math.PI * 2;
      const spawnPos = {
        x: playerPos.x + Math.cos(angle) * this.cfg.teleportLeadDistance,
        z: playerPos.z + Math.sin(angle) * this.cfg.teleportLeadDistance,
      };
      this._spawnAt(spawnPos, playerPos);
      this.hunting = true;
      this.inHomeRoom = true;
      this._stopFootsteps();
      if (this._roarTimer <= 0) {
        this._playOneShot(this._teleportBuffer, 1.0);
        this._playOneShot(this._roarBuffer, 1.0);
        this._roarTimer = this.cfg.roarCooldown;
      }
      Utils.logInfo("N-tity teleported into the cabinet room.");
    } else if (this.hunting) {
      const wasInHomeRoom = this.inHomeRoom;
      this.inHomeRoom = inHomeRoom;
      if (wasInHomeRoom && !inHomeRoom) {
        // Player just fled the room — N-tity keeps chasing, slower.
        this._startFootsteps();
      } else if (!wasInHomeRoom && inHomeRoom) {
        this._stopFootsteps();
      }
    }

    if (!this.hunting || !this.group) return;

    const speed = this.inHomeRoom ? this.cfg.fastSpeed : this.cfg.fastSpeed * this.cfg.slowSpeedMultiplier;
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
