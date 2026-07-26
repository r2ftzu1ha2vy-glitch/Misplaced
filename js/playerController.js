/**
 * playerController.js
 * ---------------------------------------------------------------
 * Modern first-person controller:
 *  - Pointer-lock mouse look w/ adjustable sensitivity
 *  - Smooth accel/decel walk + sprint + crouch
 *  - Jump w/ gravity, landing camera shake
 *  - Head bob (walk/sprint distinct), FOV kick on sprint
 *  - Capsule-ish collision via raycasts against the level colliders
 * ---------------------------------------------------------------
 */

class PlayerController {
  constructor(camera, domElement, colliderMeshesGetter) {
    this.camera = camera;
    this.dom = domElement;
    this.getColliders = colliderMeshesGetter; // () => THREE.Mesh[]

    const cfg = GAME_CONFIG.player;
    this.cfg = cfg;

    this.position = new THREE.Vector3(0, cfg.eyeHeight, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.currentHeight = cfg.eyeHeight;
    this.targetHeight = cfg.eyeHeight;
    this.isCrouching = false;
    this.isSprinting = false;
    this.isGrounded = true;
    this.verticalVelocity = 0;

    this.stamina = cfg.staminaMax;

    this.bobTime = 0;
    this.landingShake = 0;

    this.currentFov = cfg.fovBase;

    this.keys = {};
    this.locked = false;

    // Photo-mode flight, toggled by the cheat sequence in
    // cheatSystem.js — not gravity/collision-bound, purely for lining
    // up screenshots. Speed is deliberately separate from
    // walk/sprint/crouchSpeed so tuning normal movement never
    // accidentally changes fly speed.
    this.flyMode = false;
    this.flySpeed = 6;
    this.flyFastMultiplier = 2.5; // sprint-held while flying moves faster
    this._preFlyVelocity = null;

    this._bindInputs();
  }

  /** Toggles photo-mode flight on/off. When turning ON, the player's
   *  current velocity is stashed and zeroed so they don't rocket off
   *  in whatever direction they were last walking; when turning OFF,
   *  gravity/ground-collision picks back up exactly where update()
   *  left off (isGrounded recomputes naturally next frame). */
  setFlyMode(enabled) {
    if (enabled === this.flyMode) return;
    this.flyMode = enabled;
    if (enabled) {
      this._preFlyVelocity = this.velocity.clone();
      this.velocity.set(0, 0, 0);
      this.verticalVelocity = 0;
    } else {
      // Don't restore old horizontal velocity — landing back on the
      // ground carrying photo-mode momentum would feel like a bug, not
      // a feature.
      this.velocity.set(0, 0, 0);
      this.verticalVelocity = 0;
      this._preFlyVelocity = null;
    }
  }

  _bindInputs() {
    document.addEventListener("keydown", (e) => (this.keys[e.code] = true));
    document.addEventListener("keyup", (e) => (this.keys[e.code] = false));

    this.dom.addEventListener("click", () => {
      if (!this.locked) this.dom.requestPointerLock();
    });

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.dom;
      const hint = document.getElementById("pausehint");
      if (hint) hint.classList.toggle("show", !this.locked);
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.cfg.sensitivity;
      this.pitch -= e.movementY * this.cfg.sensitivity;
      this.pitch = Utils.clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    });

    if ("ontouchstart" in window) {
      document.body.classList.add("is-touch");
      this._bindTouchInputs();
    }
  }

  /** Touch controls feed the exact same this.keys booleans + yaw/pitch
   *  that keyboard/mouse use, so update() needs no touch-specific logic
   *  at all — joystick maps to WASD, drag-look maps to mouse-look,
   *  buttons map to Shift/Ctrl/Space. */
  _bindTouchInputs() {
    this.locked = true; // no pointer lock on mobile — treat as always "active"

    // --- Virtual joystick (movement) ---
    const zone = document.getElementById("touchJoystickZone");
    const base = document.getElementById("joystickBase");
    const knob = document.getElementById("joystickKnob");
    let joyTouchId = null;
    let baseCenter = { x: 0, y: 0 };
    const maxRadius = 45;

    const resetJoystick = () => {
      this.keys["KeyW"] = this.keys["KeyA"] = this.keys["KeyS"] = this.keys["KeyD"] = false;
      if (knob) knob.style.transform = "translate(32px, -32px)";
    };

    zone.addEventListener("touchstart", (e) => {
      const t = e.changedTouches[0];
      joyTouchId = t.identifier;
      const rect = base.getBoundingClientRect();
      baseCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    zone.addEventListener("touchmove", (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyTouchId) continue;
        let dx = t.clientX - baseCenter.x;
        let dy = t.clientY - baseCenter.y;
        const dist = Math.hypot(dx, dy);
        if (dist > maxRadius) { dx = (dx / dist) * maxRadius; dy = (dy / dist) * maxRadius; }
        if (knob) knob.style.transform = `translate(${32 + dx}px, ${-32 + dy}px)`;

        const deadzone = 10;
        this.keys["KeyW"] = dy < -deadzone;
        this.keys["KeyS"] = dy > deadzone;
        this.keys["KeyA"] = dx < -deadzone;
        this.keys["KeyD"] = dx > deadzone;
      }
      e.preventDefault();
    }, { passive: false });

    zone.addEventListener("touchend", (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyTouchId) { joyTouchId = null; resetJoystick(); }
      }
    });
    zone.addEventListener("touchcancel", () => { joyTouchId = null; resetJoystick(); });

    // --- Look drag (right side of screen) ---
    const lookZone = document.getElementById("touchLookZone");
    let lookTouchId = null;
    let lastX = 0, lastY = 0;
    const touchSensitivity = this.cfg.sensitivity * this.cfg.touchSensitivityMultiplier;

    lookZone.addEventListener("touchstart", (e) => {
      const t = e.changedTouches[0];
      lookTouchId = t.identifier;
      lastX = t.clientX; lastY = t.clientY;
    });
    lookZone.addEventListener("touchmove", (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== lookTouchId) continue;
        const dx = t.clientX - lastX;
        const dy = t.clientY - lastY;
        lastX = t.clientX; lastY = t.clientY;
        this.yaw -= dx * touchSensitivity;
        this.pitch -= dy * touchSensitivity;
        this.pitch = Utils.clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
      }
      e.preventDefault();
    }, { passive: false });
    lookZone.addEventListener("touchend", (e) => {
      for (const t of e.changedTouches) if (t.identifier === lookTouchId) lookTouchId = null;
    });
    lookZone.addEventListener("touchcancel", () => { lookTouchId = null; });

    // --- Buttons: sprint (hold), crouch (toggle-hold), jump (tap) ---
    const bindHoldButton = (id, keyCode) => {
      const el = document.getElementById(id);
      if (!el) return;
      const setActive = (v) => {
        this.keys[keyCode] = v;
        el.classList.toggle("active", v);
      };
      el.addEventListener("touchstart", (e) => { setActive(true); e.preventDefault(); }, { passive: false });
      el.addEventListener("touchend", () => setActive(false));
      el.addEventListener("touchcancel", () => setActive(false));
    };

    bindHoldButton("btnSprint", "ShiftLeft");
    bindHoldButton("btnCrouch", "ControlLeft");

    const jumpBtn = document.getElementById("btnJump");
    if (jumpBtn) {
      jumpBtn.addEventListener("touchstart", (e) => {
        this.keys["Space"] = true;
        jumpBtn.classList.add("active");
        e.preventDefault();
      }, { passive: false });
      jumpBtn.addEventListener("touchend", () => {
        this.keys["Space"] = false;
        jumpBtn.classList.remove("active");
      });
    }
  }

  /** Raycast-based ground/wall collision resolution (simple + robust for a first pass). */
  _resolveCollisions(nextPos) {
    const colliders = this.getColliders ? this.getColliders() : [];
    if (!colliders || colliders.length === 0) return nextPos;

    const radius = this.cfg.radius;
    const dirs = [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0.7071, 0, 0.7071), new THREE.Vector3(-0.7071, 0, 0.7071),
      new THREE.Vector3(0.7071, 0, -0.7071), new THREE.Vector3(-0.7071, 0, -0.7071),
    ];

    const rayOrigin = new THREE.Vector3(nextPos.x, this.currentHeight * 0.55, nextPos.z);
    const raycaster = new THREE.Raycaster();
    raycaster.far = radius + 0.15;

    for (const dir of dirs) {
      raycaster.set(rayOrigin, dir);
      const hits = raycaster.intersectObjects(colliders, true);
      if (hits.length > 0 && hits[0].distance < radius) {
        const push = radius - hits[0].distance;
        nextPos.x -= dir.x * push;
        nextPos.z -= dir.z * push;
      }
    }
    return nextPos;
  }

  _groundHeightAt(x, z) {
    const colliders = this.getColliders ? this.getColliders() : [];
    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
    const hits = raycaster.intersectObjects(colliders, true);
    // Walking into a door/elevator-door collider used to lift the player
    // onto TOP of it — the downward ray hit the top of that tall mesh
    // before it ever reached the actual floor beneath, since both are in
    // the same flat colliders list with no floor/prop distinction. Real
    // floor is always at/near the player's current feet level; anything
    // hit noticeably above that (a doorway, elevator door, tall prop)
    // isn't ground, so skip past it to the next hit down instead.
    const currentFeetY = this.position.y - this.currentHeight;
    for (const hit of hits) {
      if (hit.point.y <= currentFeetY + 0.6) return hit.point.y;
    }
    if (hits.length > 0) return hits[0].point.y; // fallback: nothing plausible found, use nearest hit anyway
    return 0; // fallback ground plane
  }

  update(dt) {
    if (this.flyMode) {
      this._updateFly(dt);
      return;
    }

    const cfg = this.cfg;

    // --- crouch state ---
    this.isCrouching = !!this.keys["ControlLeft"] || !!this.keys["KeyC"];
    this.targetHeight = this.isCrouching ? cfg.crouchHeight : cfg.eyeHeight;
    this.currentHeight = Utils.damp(this.currentHeight, this.targetHeight, cfg.crouchTransitionSpeed, dt);

    // --- sprint / stamina ---
    const wantsSprint = !!this.keys["ShiftLeft"] && !this.isCrouching;
    const moving = this.keys["KeyW"] || this.keys["KeyA"] || this.keys["KeyS"] || this.keys["KeyD"];
    this.isSprinting = wantsSprint && moving && this.stamina > cfg.staminaMinToSprint;

    if (this.isSprinting) {
      this.stamina = Utils.clamp(this.stamina - cfg.staminaDrainPerSec * dt, 0, cfg.staminaMax);
    } else {
      this.stamina = Utils.clamp(this.stamina + cfg.staminaRegenPerSec * dt, 0, cfg.staminaMax);
    }
    const staminaFill = document.getElementById("staminaFill");
    if (staminaFill) staminaFill.style.width = (this.stamina / cfg.staminaMax * 100) + "%";

    // --- movement input vector (local space) ---
    let ix = 0, iz = 0;
    if (this.keys["KeyW"]) iz -= 1;
    if (this.keys["KeyS"]) iz += 1;
    if (this.keys["KeyA"]) ix -= 1;
    if (this.keys["KeyD"]) ix += 1;
    const inputLen = Math.hypot(ix, iz);
    if (inputLen > 0) { ix /= inputLen; iz /= inputLen; }

    const targetSpeed = this.isCrouching ? cfg.crouchSpeed : (this.isSprinting ? cfg.sprintSpeed : cfg.walkSpeed);

    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(-1);
    const right = new THREE.Vector3(Math.sin(this.yaw + Math.PI / 2), 0, Math.cos(this.yaw + Math.PI / 2));

    const wishDir = new THREE.Vector3()
      .addScaledVector(forward, -iz)
      .addScaledVector(right, ix);
    if (wishDir.lengthSq() > 0) wishDir.normalize();

    const targetVel = wishDir.multiplyScalar(targetSpeed);
    const accelRate = (inputLen > 0 ? cfg.acceleration : cfg.deceleration) * (this.isGrounded ? 1 : cfg.airControl);

    this.velocity.x = Utils.damp(this.velocity.x, targetVel.x, accelRate, dt);
    this.velocity.z = Utils.damp(this.velocity.z, targetVel.z, accelRate, dt);

    // --- jump / gravity ---
    if (this.keys["Space"] && this.isGrounded) {
      this.verticalVelocity = cfg.jumpVelocity;
      this.isGrounded = false;
    }
    this.verticalVelocity -= cfg.gravity * dt;

    // --- integrate position ---
    const nextPos = this.position.clone();
    nextPos.x += this.velocity.x * dt;
    nextPos.z += this.velocity.z * dt;

    const resolved = this._resolveCollisions(nextPos);

    const groundY = this._groundHeightAt(resolved.x, resolved.z);
    let newY = this.position.y + this.verticalVelocity * dt;
    const floorEye = groundY + this.currentHeight;

    if (newY <= floorEye) {
      if (!this.isGrounded && this.verticalVelocity < -2) {
        this.landingShake = Utils.clamp(-this.verticalVelocity * 0.05, 0, 0.35);
      }
      newY = floorEye;
      this.verticalVelocity = 0;
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }

    this.position.set(resolved.x, newY, resolved.z);

    // --- head bob ---
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const movingOnGround = speed > 0.1 && this.isGrounded;
    const bobFreq = this.isSprinting ? cfg.bobFrequencySprint : cfg.bobFrequencyWalk;
    const bobAmp = this.isSprinting ? cfg.bobAmplitudeSprint : cfg.bobAmplitudeWalk;

    if (movingOnGround) {
      this.bobTime += dt * bobFreq;
    } else {
      // ease bob back to neutral
      this.bobTime += dt * bobFreq * 0.15;
    }
    const bobIntensity = movingOnGround ? 1 : Utils.damp(0, 0, 1, dt);
    const bobY = Math.sin(this.bobTime * 2) * bobAmp * (movingOnGround ? 1 : 0);
    const bobX = Math.cos(this.bobTime) * bobAmp * 0.5 * (movingOnGround ? 1 : 0);

    // --- landing shake decay ---
    this.landingShake = Utils.damp(this.landingShake, 0, cfg.landingShakeDecay, dt);

    // --- FOV kick ---
    const targetFov = cfg.fovBase + (this.isSprinting ? cfg.fovSprintAdd : 0);
    this.currentFov = Utils.damp(this.currentFov, targetFov, cfg.fovTransitionSpeed, dt);
    if (this.camera.fov !== this.currentFov) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    // --- apply to camera ---
    this.camera.position.set(
      this.position.x + bobX,
      this.position.y + bobY - this.landingShake,
      this.position.z
    );
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch + (Math.random() - 0.5) * this.landingShake * 0.3;
    this.camera.rotation.z = 0;
  }

  /** Free-flight movement for photo mode: no gravity, no collision, no
   *  head bob — full 3D movement in the direction the camera is
   *  actually looking (including pitch), so flying "forward" while
   *  looking down actually descends instead of sliding along a flat
   *  plane. Reuses the exact same key bindings as normal movement
   *  (W/A/S/D to move, Space to rise, crouch-key to descend, Shift to
   *  go faster) so it works identically on the mobile touch buttons
   *  with no separate UI needed. */
  _updateFly(dt) {
    const cfg = this.cfg;

    let ix = 0, iz = 0;
    if (this.keys["KeyW"]) iz -= 1;
    if (this.keys["KeyS"]) iz += 1;
    if (this.keys["KeyA"]) ix -= 1;
    if (this.keys["KeyD"]) ix += 1;
    let iy = 0;
    if (this.keys["Space"]) iy += 1;
    if (this.keys["ControlLeft"] || this.keys["KeyC"]) iy -= 1;

    // Forward/right vectors follow full look direction (pitch included)
    // so looking up/down and flying "forward" moves along that same
    // tilt instead of only ever moving on a flat horizontal plane.
    const cosPitch = Math.cos(this.pitch);
    const forward = new THREE.Vector3(
      -Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosPitch
    );
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const move = new THREE.Vector3()
      .addScaledVector(forward, -iz)
      .addScaledVector(right, ix)
      .addScaledVector(new THREE.Vector3(0, 1, 0), iy);

    if (move.lengthSq() > 0) move.normalize();

    const speed = this.flySpeed * (this.keys["ShiftLeft"] ? this.flyFastMultiplier : 1);
    this.position.addScaledVector(move, speed * dt);

    this.camera.position.copy(this.position);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;

    // FOV/stamina/bob are all walking-specific state that shouldn't
    // drift while flying; snap FOV back to base in case fly mode was
    // toggled mid-sprint so the lens doesn't stay "zoomed" the whole
    // time the player is taking photos.
    if (this.camera.fov !== cfg.fovBase) {
      this.camera.fov = cfg.fovBase;
      this.currentFov = cfg.fovBase;
      this.camera.updateProjectionMatrix();
    }
  }
}
