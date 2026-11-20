// input.js — keyboard and mouse state. The autopilot and the test harness
// write into the same `virtual` layer a player's keys write into, so a driven
// car is steered through exactly the inputs a person would give it.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.prev = new Set();
    this.mouse = { x: 0, y: 0, down: false };
    this.virtual = { up: false, down: false, left: false, right: false, interact: false, fire: false, aimX: null, aimY: null, sprint: false };
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * canvas.width;
      this.mouse.y = ((e.clientY - r.top) / r.height) * canvas.height;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.down = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
    });
    // Round 27: mouse-wheel zoom for the follow camera. wheelSteps counts
    // pending notches (positive = scrolled down = zoom out); updateCamera
    // consumes and clears it each frame. Clamped so a fast scroll cannot
    // queue a long zoom run.
    this.wheelSteps = 0;
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY > 0) this.wheelSteps = Math.min(8, this.wheelSteps + 1);
      else if (e.deltaY < 0) this.wheelSteps = Math.max(-8, this.wheelSteps - 1);
    }, { passive: false });
  }

  held(code) {
    return this.keys.has(code);
  }

  pressed(code) {
    return this.keys.has(code) && !this.prev.has(code);
  }

  endFrame() {
    this.prev = new Set(this.keys);
    this.virtual.interact = false;
  }

  get up() { return this.held('KeyW') || this.held('ArrowUp') || this.virtual.up; }
  get down() { return this.held('KeyS') || this.held('ArrowDown') || this.virtual.down; }
  get left() { return this.held('KeyA') || this.held('ArrowLeft') || this.virtual.left; }
  get right() { return this.held('KeyD') || this.held('ArrowRight') || this.virtual.right; }
  get brake() { return this.held('Space'); }
  get sprint() { return this.held('ShiftLeft') || this.held('ShiftRight') || this.virtual.sprint; }
  get interact() { return this.pressed('KeyE') || this.virtual.interact; }
  get firing() { return this.mouse.down || this.virtual.fire; }
}
