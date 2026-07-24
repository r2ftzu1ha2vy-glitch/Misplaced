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

    this._bindInputs();
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
      const hits = raycaster.intersectObjects(colliders, false);
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
    const hits = raycaster.intersectObjects(colliders, false);
    if (hits.length > 0) return hits[0].point.y;
    return 0; // fallback ground plane
  }

  update(dt) {
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
    const right = new THREE.Vector3(Math.sin(this.yaw + Math.PI / 2), 0, Math.cos(this.yaw + Math.PI / 2)).multiplyScalar(-1);

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
}
