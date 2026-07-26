/**
 * cheatSystem.js
 * ---------------------------------------------------------------
 * A hidden "skip the search" cheat: entering the sequence
 *   up, up, down, down, left, right, left, right, jump, jump
 * immediately triggers whichever floor-advance the player is
 * currently eligible for (Floor 1's exit gate -> the hotel lobby,
 * or Floor 2's access card -> the win screen), without requiring the
 * player to actually find that trigger's geometry in the world.
 *
 * Both of those triggers are pure callbacks in floorManager.js (walking
 * into the real exit gate/card just calls goToLobby() / the win
 * callback) — so the cheat reuses those exact same entry points rather
 * than trying to physically relocate a mesh to the player, which
 * sidesteps any streaming/collision edge cases entirely.
 *
 * Input source: this watches the exact same PlayerController.keys
 * booleans that both keyboard AND the mobile touch UI already write
 * into (see playerController.js's _bindTouchInputs — the joystick maps
 * to KeyW/A/S/D and the jump button maps to Space), so the sequence
 * works identically on desktop and mobile with no separate touch path
 * needed.
 *
 * A single directional "step" is edge-triggered (false -> true) so
 * holding a key doesn't spam repeats, and the whole sequence must
 * land within SEQUENCE_TIMEOUT seconds of the first correct input or
 * it resets. After a successful trigger, ARM_COOLDOWN_SEC locks the
 * cheat out so it can't be chained to skip multiple floors back-to-back.
 * ---------------------------------------------------------------
 */

const CheatSystem = (() => {
  // up, up, down, down, left, right, left, right, jump, jump
  const SEQUENCE = ["KeyW", "KeyW", "KeyS", "KeyS", "KeyA", "KeyD", "KeyA", "KeyD", "Space", "Space"];
  const SEQUENCE_TIMEOUT = 4; // seconds allowed between the first and last input before it resets
  const ARM_COOLDOWN_SEC = 5 * 60; // 5 minutes after a successful trigger before it can fire again

  let player = null;
  let floorManager = null;
  let toastEl = null;

  let prevKeyState = {};
  let progress = 0;
  let firstInputAt = 0;
  let cooldownUntil = 0; // performance.now()-style clock (seconds since page load), 0 = not on cooldown
  let _clockSec = 0;

  function init(playerRef, floorManagerRef) {
    player = playerRef;
    floorManager = floorManagerRef;
    toastEl = document.getElementById("cheatToast");
    prevKeyState = {};
    progress = 0;
    firstInputAt = 0;
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

  /** Call once per frame with dt (seconds) — needed only to track the
   *  cooldown/timeout clocks; input reading itself is instantaneous. */
  function update(dt) {
    if (!player || !floorManager) return;
    _clockSec += dt;

    const onCooldown = cooldownUntil > 0 && _clockSec < cooldownUntil;

    // Edge-detect each tracked key: only count a fresh false->true
    // transition as one "step" of the sequence, so holding a direction
    // doesn't register dozens of repeats per second.
    for (const code of ["KeyW", "KeyS", "KeyA", "KeyD", "Space"]) {
      const now = !!player.keys[code];
      const was = !!prevKeyState[code];
      prevKeyState[code] = now;
      if (!now || was) continue; // only act on the rising edge

      if (onCooldown) continue; // still swallow input silently, no partial-progress carryover mid-cooldown

      if (progress > 0 && _clockSec - firstInputAt > SEQUENCE_TIMEOUT) {
        progress = 0; // took too long since the first correct key; start over
      }

      if (code === SEQUENCE[progress]) {
        if (progress === 0) firstInputAt = _clockSec;
        progress++;
        if (progress >= SEQUENCE.length) {
          progress = 0;
          _tryTrigger();
        }
      } else if (code === SEQUENCE[0]) {
        // Wrong key, but it happens to be a valid re-start (e.g. missed
        // on step 3 but this key is also "up") — restart the count from 1
        // instead of fully dropping it, so a stray input mid-sequence
        // isn't overly punishing.
        progress = 1;
        firstInputAt = _clockSec;
      } else {
        progress = 0;
      }
    }
  }

  function _tryTrigger() {
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
