/**
 * floorManager.js
 * ---------------------------------------------------------------
 * Owns every scene-level transition in the game: Floor 1's office →
 * Floor 2's hotel lobby → the endless hotel corridor → in/out of a
 * hotel room → the final win (finding the access card). Every one of
 * these is the same basic move: fade to black, swap what's active
 * (visibility/position, not a full scene rebuild — see hotelStreamer's
 * enterRoom for why), fade back in. This file is the single place that
 * choreographs that, so main.js's game loop stays a thin dispatcher.
 *
 * States: "floor1" -> "lobby" -> "corridor" <-> "room" -> "won"
 * ---------------------------------------------------------------
 */

class FloorManager {
  constructor({ scene, assets, lighting, atmosphere, player, camera, audioListener }) {
    this.scene = scene;
    this.assets = assets;
    this.lighting = lighting;
    this.atmosphere = atmosphere;
    this.player = player;
    this.camera = camera;

    this.state = "floor1";
    this.colliders = [];

    this.roomStreamer = null;   // Floor 1
    this.lobby = null;          // { group, colliders, spawnPoint, elevators }
    this.hotelStreamer = null;  // Floor 2 corridor + rooms

    // Enemies — N-tity (Floor 1) and Ghoxt (Floor 2). See monsterSystem.js.
    this.ntity = new NtityAI(scene, assets, audioListener);
    this.ghoxt = new GhoxtAI(assets, audioListener);
    this._onDeathCallback = null;

    this._fading = false;
    this._doorCooldown = 0; // brief lockout after a room transition so the same trigger can't immediately re-fire

    this._fadeEl = document.getElementById("fadeOverlay");
    this._floorLabelEl = document.getElementById("fpsLabel");
    this._interactPromptEl = document.getElementById("interactPrompt");
    this._transitionCardEl = document.getElementById("transitionCard");
  }

  /** main.js registers its death sequence here — fired the instant
   *  either enemy reaches the player. `who` is "ntity" or "ghoxt" so
   *  the death screen can show flavor text specific to what got you. */
  onDeath(cb) {
    this._onDeathCallback = cb;
  }

  _handleCatch(who) {
    if (this._fading) return; // already mid-transition/already handled
    if (this._onDeathCallback) this._onDeathCallback(who);
  }

  /** Called once from main.js right after Floor 1's RoomStreamer has
   *  built the initial level, so this manager can take over ongoing
   *  per-frame updates/collider bookkeeping from that point on. */
  initFloor1(roomStreamer) {
    this.roomStreamer = roomStreamer;
    this.colliders = roomStreamer.colliders;
  }

  /** Core fade helper: fades #fadeOverlay to black over `ms`, runs
   *  `duringBlack` while fully black, then fades back in. Resolves once
   *  the fade-in transition has visually finished. Optionally shows a
   *  title-card message (e.g. "FLOOR 2 — THE HOTEL") for the duration
   *  of the black screen. */
async _fadeTransition({ duringBlack, titleText, holdMs }) {
  this._fading = true;
  const fadeMs = 1000;

  if (this._fadeEl) this._fadeEl.classList.add("show");
  await _wait(fadeMs);

  if (titleText && this._transitionCardEl) {
    this._transitionCardEl.textContent = titleText;
    this._transitionCardEl.classList.add("show");
  }

  try {
    if (duringBlack) duringBlack();
  } catch (e) {
    Utils.logError("Error during fade transition: " + (e && e.message ? e.message : e));
  }

  await _wait(holdMs != null ? holdMs : 250);

  if (titleText && this._transitionCardEl) {
    this._transitionCardEl.classList.remove("show");
  }

  if (this._fadeEl) this._fadeEl.classList.remove("show");
  await _wait(fadeMs);

  this._fading = false;
}

  // ---------------------------------------------------------------
  // Floor 1 -> Floor 2 lobby
  // ---------------------------------------------------------------
  async goToLobby() {
    if (this._fading) return;

    await this._fadeTransition({
      titleText: "FLOOR 2 — THE HOTEL",
      holdMs: 900,
      duringBlack: () => {
        // Tear down Floor 1's streamer output entirely — the office
        // never needs to be seen again once the player leaves through
        // the exit gate.
        if (this.roomStreamer) {
          for (const slot of this.roomStreamer.slots) {
            this.scene.remove(slot.group);
          }
          this.roomStreamer = null;
        }
        this.ntity.reset(); // Floor 1 is gone — clear any active hunt/mesh/audio

        this.lobbyGroup = new THREE.Group();
        this.lobbyGroup.name = "HotelLobby";
        this.scene.add(this.lobbyGroup);
        this.lobby = HotelLobby.build(this.lobbyGroup, this.assets, this.lighting);
        // See hotelStreamer.js's enterRoom() for why this is needed: a
        // freshly-built group's meshes don't get a valid matrixWorld
        // until the next render() pass, but the player is about to be
        // placed here via a ground-height raycast on the very next
        // frame, before that render happens.
        this.lobbyGroup.updateMatrixWorld(true);

        this.colliders = this.lobby.colliders;
        this.player.position.copy(this.lobby.spawnPoint);
        this.player.position.y = GAME_CONFIG.player.eyeHeight;
        this.player.velocity.set(0, 0, 0);
        this.player.yaw = 0; // face the elevators (elevatorZ is negative/-Z from spawn)

        if (this._floorLabelEl) this._floorLabelEl.textContent = "FLOOR 2 // HOTEL LOBBY";
      },
    });

    this.state = "lobby";
  }

  // ---------------------------------------------------------------
  // Lobby elevator logic — called every frame while state === "lobby"
  // ---------------------------------------------------------------
  updateLobby(dt, playerPos) {
    if (!this.lobby) return;

    let nearestElevator = null;
    let nearestDist = Infinity;
    for (const el of this.lobby.elevators) {
      const d = playerPos.distanceTo(el.triggerPos);
      if (d < nearestDist) { nearestDist = d; nearestElevator = el; }
    }

    for (const el of this.lobby.elevators) {
      const playerNear = playerPos.distanceTo(el.triggerPos) <= el.triggerRadius;
      const playerInside = playerPos.distanceTo(el.insidePos) <= 1.0;

      if (!this._fading) {
        if (playerInside && el.state === "open") {
          // Player stepped fully inside an open elevator -> ride it up.
          this._rideElevator(el);
          return; // riding takes over; skip further per-frame elevator logic this tick
        }
        if (playerNear && (el.state === "closed")) {
          el.state = "opening";
        } else if (!playerNear && !playerInside && (el.state === "open")) {
          el.state = "closing";
        }
      }

      HotelLobby.updateDoors(el, dt, 1.6);
    }

    if (this._interactPromptEl) {
      const show = nearestElevator && nearestDist <= nearestElevator.triggerRadius && !this._fading;
      this._interactPromptEl.classList.toggle("show", !!show);
      if (show) this._interactPromptEl.textContent = "WALK IN TO CALL ELEVATOR";
    }
  }

  async _rideElevator(elevator) {
    if (this._fading) return;
    elevator.state = "closing";
    // Let the doors visually close before the fade starts, briefly.
    await _wait(350);

    await this._fadeTransition({
      holdMs: 700,
      duringBlack: () => {
        this.scene.remove(this.lobbyGroup);
        this.lobby = null;
        this.lobbyGroup = null;

        this.hotelStreamer = new HotelStreamer(this.scene, this.assets, this.lighting, () => this._onCardFound());
        const result = this.hotelStreamer.buildInitial();
        this.colliders = result.colliders;

        this.player.position.copy(result.spawnPoint);
        this.player.position.y = GAME_CONFIG.player.eyeHeight;
        this.player.velocity.set(0, 0, 0);

        if (this._floorLabelEl) this._floorLabelEl.textContent = "FLOOR 2 // GUEST WING";
      },
    });

    this.state = "corridor";
  }

  // ---------------------------------------------------------------
  // Corridor <-> room transitions, and the access-card win check —
  // called every frame while state === "corridor"
  // ---------------------------------------------------------------
  updateCorridor(dt, playerPos) {
    if (!this.hotelStreamer) return;

    if (this._doorCooldown > 0) this._doorCooldown -= dt;

    this.hotelStreamer.update(playerPos);
    this.colliders = this.hotelStreamer.colliders;

    if (!this.hotelStreamer.inRoom) {
      if (!this._fading && this._doorCooldown <= 0) {
        const trig = this.hotelStreamer.findDoorTrigger(playerPos);
        if (trig) {
          this._enterRoomTransition(trig, playerPos);
          return;
        }
        if (this.hotelStreamer.checkCardTrigger(playerPos)) {
          this._onCardFound();
          return;
        }
      }
      if (this._interactPromptEl) this._interactPromptEl.classList.remove("show");
    } else {
      if (!this._fading && this._doorCooldown <= 0 && this.hotelStreamer.checkRoomExitTrigger(playerPos)) {
        this._exitRoomTransition();
      }
    }
  }

  async _enterRoomTransition(trig, playerWorldPos) {
    if (this._fading) return;
    await this._fadeTransition({
      holdMs: 300,
      duringBlack: () => {
        const spawnWorld = this.hotelStreamer.enterRoom(trig.roomType, playerWorldPos);
        this.colliders = this.hotelStreamer.colliders;
        this.player.position.copy(spawnWorld);
        this.player.position.y = GAME_CONFIG.player.eyeHeight;
        this.player.velocity.set(0, 0, 0);
        // Remember which way the player was actually facing in the
        // corridor before we forcibly reorient them into the room's
        // own frame below — restored on exit so leaving a room doesn't
        // leave the camera facing the room's "into room" heading
        // instead of the corridor's real layout (this was the source
        // of the reported "orientation 90 degrees off" after exiting
        // rooms: exit never reset yaw at all).
        this._corridorEntryYaw = this.player.yaw;
        this.player.yaw = 0; // face into the room, away from the door
        this._doorCooldown = 1.0;
        this.ghoxt.onRoomEnter(this.hotelStreamer.roomGroup);

        if (this._floorLabelEl) this._floorLabelEl.textContent = `FLOOR 2 // ROOM ${trig.roomNumber}`;
      },
    });
  }

  async _exitRoomTransition() {
    if (this._fading) return;
    await this._fadeTransition({
      holdMs: 300,
      duringBlack: () => {
        this.ghoxt.onRoomExit();
        const returnWorld = this.hotelStreamer.exitRoom();
        this.colliders = this.hotelStreamer.colliders;
        this.player.position.copy(returnWorld);
        this.player.position.y = GAME_CONFIG.player.eyeHeight;
        this.player.velocity.set(0, 0, 0);
        // Restore the heading they had in the corridor before entering
        // (see _enterRoomTransition) instead of leaving them facing
        // whichever way the room's own frame pointed.
        this.player.yaw = this._corridorEntryYaw != null ? this._corridorEntryYaw : this.player.yaw;
        this._doorCooldown = 1.0;

        if (this._floorLabelEl) this._floorLabelEl.textContent = "FLOOR 2 // GUEST WING";
      },
    });
  }

  _onCardFound() {
    if (this._fading) return;
    this.state = "won";
    if (this._onWinCallback) this._onWinCallback();
  }

  /** main.js registers its final win-screen presentation here. */
  onWin(cb) {
    this._onWinCallback = cb;
  }

  // ---------------------------------------------------------------
  // Per-frame dispatch
  // ---------------------------------------------------------------
  update(dt, playerPos) {
    switch (this.state) {
      case "floor1":
        if (this.roomStreamer) {
          this.roomStreamer.update(playerPos);
          this.colliders = this.roomStreamer.colliders;
          if (this.roomStreamer.checkExitTrigger(playerPos)) {
            this.goToLobby();
            break;
          }
          if (!this._fading) {
            this.ntity.update(dt, playerPos, this.roomStreamer, (who) => this._handleCatch(who));
          }
        }
        break;
      case "lobby":
        this.updateLobby(dt, playerPos);
        break;
      case "corridor":
        this.updateCorridor(dt, playerPos);
        if (!this._fading && this.hotelStreamer && this.hotelStreamer.inRoom && this.hotelStreamer.roomGroup) {
          // Ghoxt operates in the room's own local space — the room
          // group sits at a fixed world offset (see hotelStreamer's
          // enterRoom), so convert the player's world position into
          // that local space before handing it to the AI.
          const localPos = playerPos.clone().sub(this.hotelStreamer.roomGroup.position);
          this.ghoxt.update(dt, localPos, (who) => this._handleCatch(who));
        }
        break;
      default:
        break;
    }
  }

  getColliders() {
    return this.colliders;
  }
}

function _wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
