/**
 * cheatSystem.js
 * ---------------------------------------------------------------
 * Two hidden cheat sequences, both read from the same edge-triggered
 * key stream:
 *
 *   1) up up down down left right left right jump jump
 *      "Skip the search" — immediately triggers whichever floor-advance
 *      the player is currently eligible for (Floor 1's exit gate -> the
 *      hotel lobby, or Floor 2's access card -> the win screen), without
 *      requiring the player to actually find that trigger's geometry in
 *      the world. 5-minute cooldown after each successful trigger.
 *
 *   2) up down up down left right left right jump jump
 *      "Photo mode" — toggles free-flight (no gravity/collision) on and
 *      off, for lining up screenshots. Re-entering the same sequence
 *      turns it back off. All floor-transition triggers (room doors,
 *      the access card, the exit gate) are paused for as long as flight
 *      is active, so flying around never accidentally advances the
 *      game — see main.js's animate loop, which skips
 *      floorManager.update() while player.flyMode is true.
 *
 * Both sequences share the same first 4 inputs (up/down/up/down or
 * up/up/down/down) so they're tracked as two independent state
 * machines in parallel rather than one, to avoid one sequence's
 * partial progress corrupting the other's.
 *
 * Both of cheat #1's triggers are pure callbacks in floorManager.js
 * (walking into the real exit gate/card just calls goToLobby() / the
 * win callback) — so the cheat reuses those exact same entry points
 * rather than trying to physically relocate a mesh to the player,
 * which sidesteps any streaming/collision edge cases entirely.
 *
 * Input source: this watches the exact same PlayerController.keys
 * booleans that both keyboard AND the mobile touch UI already write
 * into (see playerController.js's _bindTouchInputs — the joystick maps
 * to KeyW/A/S/D, jump maps to Space, crouch maps to ControlLeft/KeyC),
 * so both sequences work identically on desktop and mobile, and photo
 * mode's fly-up/fly-down controls (Space / crouch) already have live
 * touch buttons with zero new UI needed.
 *
 * A single directional "step" is edge-triggered (false -> true) so
 * holding a key doesn't spam repeats, and each sequence must complete
 * within SEQUENCE_TIMEOUT seconds of its first correct input or it
 * resets.
 * ---------------------------------------------------------------
 */

const CheatSystem = (() => {
  // up, up, down, down, left, right, left, right, jump, jump
  const SKIP_SEQUENCE = ["KeyW", "KeyW", "KeyS", "KeyS", "KeyA", "KeyD", "KeyA", "KeyD", "Space", "Space"];
  // up, down, up, down, left, right, left, right, jump, jump
  const FLY_SEQUENCE = ["KeyW", "KeyS", "KeyW", "KeyS", "KeyA", "KeyD", "KeyA", "KeyD", "Space", "Space"];
  const SEQUENCE_TIMEOUT = 4; // seconds allowed between the first and last input before it resets
  const ARM_COOLDOWN_SEC = 5 * 60; // 5 minutes after a successful SKIP trigger before it can fire again (fly mode has no cooldown — it's just a toggle)

  let player = null;
  let floorManager = null;
  let toastEl = null;

  let prevKeyState = {};
  let skipProgress = 0;
  let skipFirstInputAt = 0;
  let flyProgress = 0;
  let flyFirstInputAt = 0;
  let cooldownUntil = 0; // performance.now()-style clock (seconds since page load), 0 = not on cooldown
  let _clockSec = 0;

  function init(playerRef, floorManagerRef) {
    player = playerRef;
    floorManager = floorManagerRef;
    toastEl = document.getElementById("cheatToast");
    prevKeyState = {};
    skipProgress = 0;
    skipFirstInputAt = 0;
    flyProgress = 0;
    flyFirstInputAt = 0;
    cooldownUntil = 0;
    _clockSec = 0;
  }

  function _showToast(text, ms) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastEl._hideTimer);
    toastEl._hideTimer = setTimeout(() => toastEl.classList.remove("show"), ms || 2200);
  }

  /** Advances one sequence's state machine given a freshly-pressed key
   *  (already known to be a rising edge). Returns true if the sequence
   *  just completed. `state` is {progress, firstInputAt} passed by
   *  reference via the two setter callbacks so both sequences can share
   *  this exact same matching logic without duplicating it. */
  function _advance(code, sequence, getProgress, setProgress, getFirstInputAt, setFirstInputAt) {
    let progress = getProgress();
    let firstInputAt = getFirstInputAt();

    if (progress > 0 && _clockSec - firstInputAt > SEQUENCE_TIMEOUT) {
      progress = 0; // took too long since the first correct key; start over
    }

    if (code === sequence[progress]) {
      if (progress === 0) firstInputAt = _clockSec;
      progress++;
      setFirstInputAt(firstInputAt);
      if (progress >= sequence.length) {
        setProgress(0);
        return true;
      }
      setProgress(progress);
      return false;
    } else if (code === sequence[0]) {
      // Wrong key, but it happens to be a valid re-start (e.g. missed on
      // step 3 but this key is also the sequence's first input) —
      // restart the count from 1 instead of fully dropping it, so a
      // stray input mid-sequence isn't overly punishing.
      setProgress(1);
      setFirstInputAt(_clockSec);
      return false;
    } else {
      setProgress(0);
      return false;
    }
  }

  /** Call once per frame with dt (seconds) — needed only to track the
   *  cooldown/timeout clocks; input reading itself is instantaneous. */
  function update(dt) {
    if (!player || !floorManager) return;
    _clockSec += dt;

    const onCooldown = cooldownUntil > 0 && _clockSec < cooldownUntil;

    // Edge-detect each tracked key: only count a fresh false->true
    // transition as one "step" of either sequence, so holding a
    // direction doesn't register dozens of repeats per second.
    for (const code of ["KeyW", "KeyS", "KeyA", "KeyD", "Space"]) {
      const now = !!player.keys[code];
      const was = !!prevKeyState[code];
      prevKeyState[code] = now;
      if (!now || was) continue; // only act on the rising edge

      // Fly-mode toggle has no cooldown and works even while the skip
      // cheat is cooling down — it doesn't affect game progression at
      // all, so there's no reason to gate it.
      const flyCompleted = _advance(
        code, FLY_SEQUENCE,
        () => flyProgress, (v) => (flyProgress = v),
        () => flyFirstInputAt, (v) => (flyFirstInputAt = v)
      );
      if (flyCompleted) {
        _toggleFlyMode();
        continue; // don't also feed this same key-press into the skip sequence this frame
      }

      if (onCooldown) continue; // skip-sequence progress is swallowed silently while on cooldown

      const skipCompleted = _advance(
        code, SKIP_SEQUENCE,
        () => skipProgress, (v) => (skipProgress = v),
        () => skipFirstInputAt, (v) => (skipFirstInputAt = v)
      );
      if (skipCompleted) _trySkip();
    }
  }

  function _toggleFlyMode() {
    const next = !player.flyMode;
    player.setFlyMode(next);
    _showToast(next ? "PHOTO MODE — FLIGHT ENABLED" : "PHOTO MODE — FLIGHT DISABLED");
  }

  function _trySkip() {
    if (!floorManager) return;
    const state = floorManager.state;

    if (state === "floor1") {
      _showToast("CHEAT ACTIVATED — SKIPPING TO FLOOR 2");
      floorManager.goToLobby();
      _armCooldown();
    } else if (state === "corridor" && floorManager.hotelStreamer && !floorManager.hotelStreamer.inRoom) {
      _showToast("CHEAT ACTIVATED — ACCESS GRANTED");
      floorManager._onCardFound();
      _armCooldown();
    } else {
      // Cheat recognized but there's nothing sensible to skip to right
      // now (e.g. mid-fade, inside a hotel room, in the lobby waiting
      // on an elevator, or already won) — acknowledge it was heard
      // without silently no-oping, so it doesn't look broken.
      _showToast("CHEAT RECOGNIZED — NOTHING TO SKIP HERE");
    }
  }

  function _armCooldown() {
    cooldownUntil = _clockSec + ARM_COOLDOWN_SEC;
  }

  return { init, update };
})();
