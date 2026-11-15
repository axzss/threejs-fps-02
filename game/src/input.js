// input.js — keyboard + mouse + pointer lock. One job: turn browser
// events into a small state object the sim reads each fixed tick.
// No game logic here; keys are named by what they do.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookDX = 0; this.lookDY = 0; // accumulated mouse deltas
    this.mouseDown = false; this.mouseClicked = false;
    this.locked = false;
    this.onKey = null; // (code) => void, for one-shot actions (R, B, E, 1-6, M)
    this.onLockChange = null;
    this._bind();
  }
  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.onKey) this.onKey(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookDX += e.movementX; this.lookDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.locked) { this.mouseDown = true; this.mouseClicked = true; }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.mouseDown = false;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }
  requestLock() {
    if (this.locked) return;
    try { this.canvas.requestPointerLock(); } catch (e) { /* headless: no lock */ }
  }
  // Movement state for this tick (0/1 per axis).
  move() {
    const k = this.keys;
    return {
      f: (k.has('KeyW') || k.has('ArrowUp')) ? 1 : 0,
      b: (k.has('KeyS') || k.has('ArrowDown')) ? 1 : 0,
      l: (k.has('KeyA') || k.has('ArrowLeft')) ? 1 : 0,
      r: (k.has('KeyD') || k.has('ArrowRight')) ? 1 : 0,
      jump: k.has('Space') ? 1 : 0,
      crouch: (k.has('ControlLeft') || k.has('KeyC')) ? 1 : 0,
      sprint: k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0,
    };
  }
  // Consume the accumulated look deltas (call once per tick).
  takeLook() {
    const dx = this.lookDX, dy = this.lookDY;
    this.lookDX = 0; this.lookDY = 0;
    return { dx, dy };
  }
  takeClick() {
    const c = this.mouseClicked;
    this.mouseClicked = false;
    return c;
  }
  holdingE() { return this.keys.has('KeyE'); }
}
