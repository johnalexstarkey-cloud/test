'use strict';
// audio.js — WebAudio synth sound effects + ambient drone, no audio assets (global Sfx)

const Sfx = (() => {
  let ctx = null, master = null, noiseBuf = null;
  let ambTimer = null, ambNext = 0, ambStep = 0;
  const api = { muted: false };

  function init() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = api.muted ? 0 : 0.5;
      master.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 0.6) || 1;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      startAmbient();
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function tone(o) {
    if (!ctx || api.muted) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f0 || 440, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.t);
    g.gain.setValueAtTime(o.vol || 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.t);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + o.t + 0.05);
  }

  function burst(o) { // filtered noise burst
    if (!ctx || api.muted) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.fType || 'lowpass';
    f.frequency.setValueAtTime(o.f0 || 1000, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t0 + o.t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.t);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + o.t + 0.05);
  }

  // quiet generative ambient: slow bass pulse + sparse high blips
  const SCALE = [55, 65.41, 73.42, 82.41, 98];
  function startAmbient() {
    if (ambTimer) return;
    ambTimer = setInterval(() => {
      if (!ctx || api.muted || ctx.state !== 'running') return;
      const ahead = ctx.currentTime + 0.6;
      while (ambNext < ahead) {
        if (ambNext < ctx.currentTime) ambNext = ctx.currentTime + 0.1;
        const dly = ambNext - ctx.currentTime;
        const f = SCALE[[0, 2, 1, 3][ambStep % 4]];
        tone({ type: 'sine', f0: f, f1: f * 0.5, t: 1.8, vol: 0.05, delay: dly });
        tone({ type: 'triangle', f0: f * 2, t: 1.2, vol: 0.02, delay: dly });
        if (Math.random() < 0.3) {
          tone({ type: 'sine', f0: U.pick([523, 659, 784, 880]), f1: 200, t: 0.8, vol: 0.018, delay: dly + Math.random() });
        }
        ambNext += 2.0; ambStep++;
      }
    }, 300);
  }

  api.init = init;
  api.toggleMute = () => {
    api.muted = !api.muted;
    if (master) master.gain.value = api.muted ? 0 : 0.5;
    return api.muted;
  };

  api.shoot = (kind) => {
    switch (kind) {
      case 'pulse': tone({ type: 'square', f0: 880, f1: 240, t: 0.09, vol: 0.07 }); break;
      case 'repeater': tone({ type: 'square', f0: 660, f1: 330, t: 0.06, vol: 0.05 }); break;
      case 'scatter':
        burst({ f0: 2400, f1: 300, t: 0.18, vol: 0.18 });
        tone({ type: 'square', f0: 300, f1: 120, t: 0.15, vol: 0.1 });
        break;
      case 'rail':
        tone({ type: 'sawtooth', f0: 1600, f1: 100, t: 0.3, vol: 0.14 });
        burst({ f0: 4000, f1: 500, t: 0.2, vol: 0.12 });
        break;
      case 'nova':
        tone({ type: 'sine', f0: 220, f1: 60, t: 0.3, vol: 0.25 });
        burst({ f0: 900, f1: 200, t: 0.2, vol: 0.12 });
        break;
      default: tone({ type: 'square', f0: 700, f1: 300, t: 0.08, vol: 0.06 });
    }
  };
  api.eshoot = () => tone({ type: 'triangle', f0: 340, f1: 160, t: 0.12, vol: 0.045 });
  api.hit = () => tone({ type: 'square', f0: 220, f1: 160, t: 0.05, vol: 0.05 });
  api.die = () => {
    burst({ f0: 1200, f1: 100, t: 0.25, vol: 0.22 });
    tone({ type: 'sawtooth', f0: 300, f1: 50, t: 0.25, vol: 0.12 });
  };
  api.boom = (big) => {
    burst({ f0: big ? 900 : 600, f1: 40, t: big ? 0.8 : 0.45, vol: big ? 0.5 : 0.35 });
    tone({ type: 'sine', f0: 110, f1: 30, t: big ? 0.7 : 0.4, vol: 0.3 });
  };
  api.hurt = () => {
    tone({ type: 'sawtooth', f0: 280, f1: 60, t: 0.3, vol: 0.22 });
    burst({ f0: 800, f1: 200, t: 0.2, vol: 0.15 });
  };
  api.pickup = () => {
    tone({ type: 'square', f0: 660, t: 0.07, vol: 0.07 });
    tone({ type: 'square', f0: 990, t: 0.09, vol: 0.07, delay: 0.07 });
  };
  api.weaponGet = () => [440, 587, 880, 1174].forEach((f, i) =>
    tone({ type: 'square', f0: f, t: 0.12, vol: 0.08, delay: i * 0.09 }));
  api.gate = () => {
    tone({ type: 'square', f0: 90, t: 0.25, vol: 0.2 });
    burst({ f0: 300, f1: 80, t: 0.25, vol: 0.18 });
  };
  api.unlock = () => [392, 523, 659].forEach((f, i) =>
    tone({ type: 'triangle', f0: f, t: 0.12, vol: 0.07, delay: i * 0.08 }));
  api.dash = () => burst({ fType: 'highpass', f0: 300, f1: 2000, t: 0.16, vol: 0.1 });
  api.teleport = () => {
    tone({ type: 'sine', f0: 200, f1: 1400, t: 0.6, vol: 0.12 });
    tone({ type: 'sine', f0: 100, f1: 700, t: 0.6, vol: 0.08, delay: 0.05 });
  };
  api.deplete = () => tone({ type: 'square', f0: 200, f1: 90, t: 0.2, vol: 0.1 });
  api.crate = () => burst({ f0: 700, f1: 150, t: 0.18, vol: 0.16 });
  api.bossDown = () => {
    api.boom(true);
    [220, 180, 140, 100].forEach((f, i) =>
      tone({ type: 'sawtooth', f0: f, f1: f * 0.5, t: 0.4, vol: 0.12, delay: i * 0.15 }));
  };
  api.click = () => tone({ type: 'square', f0: 700, t: 0.04, vol: 0.05 });

  return api;
})();
