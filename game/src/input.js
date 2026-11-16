// Pasar Senja — keyboard, mouse and pointer lock, kept apart from the game
// logic. The game reads `state` (which keys are held, whether the trigger
// is down) and consumes look deltas with takeLook(). Pointer lock is the
// browser's way of saying "the player is playing": losing it pauses the
// match, gaining it resumes it.

export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    locked: false,
  };
  let lookX = 0;
  let lookY = 0;
  // Edge-triggered keys: the game consumes each press once (buy menu, use,
  // grenade, jump is held in keys but also reported here for reliability).
  const pressed = new Set();

  function onKeyDown(event) {
    if (event.repeat) return;
    state.keys.add(event.code);
    pressed.add(event.code);
    // Keep the page from scrolling or the browser from stealing focus while
    // playing: Space, Tab and the arrows belong to the game.
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(event.code)) event.preventDefault();
  }

  function onKeyUp(event) {
    state.keys.delete(event.code);
  }

  function onMouseDown(event) {
    if (event.button !== 0) return;
    if (!state.locked) return;
    state.firing = true;
  }

  function onMouseUp(event) {
    if (event.button !== 0) return;
    state.firing = false;
  }

  function onMouseMove(event) {
    if (!state.locked) return;
    lookX += event.movementX;
    lookY += event.movementY;
  }

  function onLock() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) state.firing = false;
    if (onLockChange) onLockChange(state.locked);
  }

  function onBlur() {
    state.keys.clear();
    state.firing = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLock);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    // True once for each physical press since the last call.
    takePressed(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },
    consumePressed() {
      pressed.clear();
    },
  };
}
