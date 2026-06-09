'use strict';
// input.js — keyboard + mouse state (global Input)

const Input = {
  keys: new Set(),     // codes currently held
  pressed: new Set(),  // codes pressed this frame
  mx: 0, my: 0,        // mouse position in canvas pixels
  down: false,         // left button held
  clicked: false,      // left button pressed this frame
  wheel: 0,            // accumulated wheel steps this frame

  init(canvas) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) { this.keys.add(e.code); this.pressed.add(e.code); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mx = e.clientX - r.left;
      this.my = e.clientY - r.top;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.down = true; this.clicked = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.down = false;
    });
    canvas.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },

  key(c) { return this.keys.has(c); },
  hit(c) { return this.pressed.has(c); },
  endFrame() { this.pressed.clear(); this.clicked = false; this.wheel = 0; },
};
