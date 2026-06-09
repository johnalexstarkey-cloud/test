'use strict';
// audio.js — WebAudio synth sound effects + generative pirate shanty, no audio assets (global Sfx)

const Sfx = (() => {
  let ctx = null, master = null, noiseBuf = null;
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
      startMusic();
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

  // ── MUSIC ───────────────────────────────────────────────────
  // Two sequenced tracks, all synthesized:
  //  coast — an original 8-bar jig in A minor, 6/8 (~125 bpm dotted feel):
  //          square lead doubled an octave down, triangle bass + fifth,
  //          kick / snare / shaker.
  //  deep  — the deep jungle: slow Phrygian drone in E with half-step
  //          creep and a tritone sting, low toms, sparse ticks, far-off
  //          bell tones.
  const N = {
    D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0,
    Bb4: 466.16, B4: 493.88, C5: 523.25, D5: 587.33,
  };
  const HOLD = -1, REST = 0;
  const TRACKS = {
    coast: {
      step: 0.16,
      lead: { type: 'square', vol: 0.045, subType: 'triangle', subVol: 0.028 },
      mel: [ // 8 bars x 6 eighths
        N.A4, N.A4, N.A4, N.C5, N.B4, N.C5,
        N.A4, HOLD, HOLD, N.E4, HOLD, HOLD,
        N.G4, N.G4, N.G4, N.B4, N.A4, N.B4,
        N.G4, HOLD, HOLD, N.E4, HOLD, HOLD,
        N.A4, N.A4, N.A4, N.C5, N.B4, N.C5,
        N.D5, HOLD, N.C5, N.B4, HOLD, N.A4,
        N.G4, N.E4, N.G4, N.A4, N.B4, N.C5,
        N.A4, HOLD, HOLD, REST, N.E4, N.G4,
      ],
      bass: [110, 110, 98, 82.41, 110, 87.31, 98, 110], // A A G E / A F G A
      drums: 'jig',
    },
    deep: {
      step: 0.21,
      lead: { type: 'triangle', vol: 0.04, subType: 'sine', subVol: 0.025 },
      mel: [
        N.E4, HOLD, HOLD, HOLD, HOLD, HOLD,
        N.G4, HOLD, HOLD, N.F4, HOLD, HOLD,
        N.E4, HOLD, HOLD, HOLD, N.Bb4, HOLD,
        N.A4, HOLD, HOLD, N.G4, HOLD, N.F4,
        N.E4, HOLD, HOLD, HOLD, HOLD, HOLD,
        N.F4, HOLD, N.E4, N.F4, HOLD, HOLD,
        N.D4, HOLD, HOLD, N.Bb4, HOLD, N.A4,
        N.E4, HOLD, HOLD, REST, REST, REST,
      ],
      bass: [82.41, 82.41, 87.31, 82.41, 82.41, 87.31, 73.42, 82.41], // E E F E / E F D E
      drums: 'omen',
    },
  };
  let track = 'coast';
  let musTimer = null, musNext = 0, musStep = 0;

  api.setTrack = (t) => {
    if (TRACKS[t] && t !== track) { track = t; musStep = 0; }
  };

  function scheduleStep(i, when) {
    const T = TRACKS[track];
    const dly = when - ctx.currentTime;
    const beat = i % 6, bar = (i / 6) | 0;
    // lead
    const f = T.mel[i];
    if (f > 0) {
      let dur = 1, j = i + 1;
      while (T.mel[j % T.mel.length] === HOLD && dur < 6) { dur++; j++; }
      const t = dur * T.step * 0.92;
      tone({ type: T.lead.type, f0: f, t, vol: T.lead.vol, delay: dly });
      tone({ type: T.lead.subType, f0: f / 2, t, vol: T.lead.subVol, delay: dly });
    }
    // bass + fifth on the two big beats of the bar
    if (beat === 0 || beat === 3) {
      const b = T.bass[bar];
      tone({ type: 'triangle', f0: b, t: T.step * 2, vol: 0.06, delay: dly });
      tone({ type: 'sine', f0: b * 1.5, t: T.step * 1.4, vol: 0.02, delay: dly });
    }
    if (T.drums === 'jig') { // kick / snare / shaker
      if (beat === 0) tone({ type: 'sine', f0: 150, f1: 50, t: 0.12, vol: 0.11, delay: dly });
      if (beat === 3) {
        tone({ type: 'sine', f0: 130, f1: 50, t: 0.1, vol: 0.07, delay: dly });
        burst({ f0: 1800, f1: 400, t: 0.09, vol: 0.05, delay: dly });
      }
      burst({ fType: 'highpass', f0: 5500, f1: 7500, t: 0.03, vol: beat === 0 || beat === 3 ? 0.022 : 0.013, delay: dly });
    } else { // omen: low toms, sparse ticks, far-off bells
      if (beat === 0) tone({ type: 'sine', f0: 95, f1: 38, t: 0.3, vol: 0.13, delay: dly });
      if (beat === 3 && bar % 2 === 1) tone({ type: 'sine', f0: 70, f1: 32, t: 0.35, vol: 0.1, delay: dly });
      if (beat % 2 === 0) burst({ fType: 'highpass', f0: 4000, f1: 5000, t: 0.025, vol: 0.008, delay: dly });
      if (beat === 0 && Math.random() < 0.18) {
        tone({ type: 'sine', f0: Math.random() < 0.5 ? 1318.5 : 987.8, f1: 600, t: 1.4, vol: 0.014, delay: dly + Math.random() * 0.4 });
      }
    }
  }

  function startMusic() {
    if (musTimer) return;
    musTimer = setInterval(() => {
      if (!ctx || api.muted || ctx.state !== 'running') return;
      const T = TRACKS[track];
      const ahead = ctx.currentTime + 0.7;
      if (musNext < ctx.currentTime) musNext = ctx.currentTime + 0.05;
      while (musNext < ahead) {
        scheduleStep(musStep % T.mel.length, musNext);
        musNext += T.step;
        musStep++;
      }
    }, 200);
  }

  // ── sound effects ───────────────────────────────────────────

  api.init = init;
  api.toggleMute = () => {
    api.muted = !api.muted;
    if (master) master.gain.value = api.muted ? 0 : 0.5;
    return api.muted;
  };

  api.shoot = (kind) => {
    switch (kind) {
      case 'flintlock': // sharp black-powder crack + thump
        burst({ f0: 2500, f1: 300, t: 0.18, vol: 0.26 });
        tone({ type: 'sine', f0: 150, f1: 50, t: 0.14, vol: 0.18 });
        break;
      case 'dualflint':
        burst({ f0: 2200, f1: 350, t: 0.13, vol: 0.18 });
        tone({ type: 'sine', f0: 160, f1: 60, t: 0.1, vol: 0.12 });
        break;
      case 'blunderbuss': // roaring scattergun
        burst({ f0: 1200, f1: 80, t: 0.4, vol: 0.42 });
        tone({ type: 'sine', f0: 100, f1: 35, t: 0.3, vol: 0.26 });
        break;
      case 'musket': // long rifle crack with ring
        burst({ f0: 3500, f1: 200, t: 0.25, vol: 0.3 });
        tone({ type: 'sawtooth', f0: 1200, f1: 150, t: 0.2, vol: 0.1 });
        break;
      case 'mortar': // hollow thoomp
        tone({ type: 'sine', f0: 180, f1: 50, t: 0.35, vol: 0.3 });
        burst({ f0: 700, f1: 120, t: 0.25, vol: 0.16 });
        break;
      case 'sword': // steel whoosh
        burst({ fType: 'highpass', f0: 800, f1: 4000, t: 0.12, vol: 0.13 });
        break;
      default:
        tone({ type: 'square', f0: 700, f1: 300, t: 0.08, vol: 0.06 });
    }
  };
  api.eshoot = () => burst({ fType: 'highpass', f0: 1200, f1: 2600, t: 0.06, vol: 0.06 }); // dart pft
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
  api.gate = () => { // vines lashing shut
    burst({ f0: 500, f1: 90, t: 0.3, vol: 0.2 });
    tone({ type: 'square', f0: 90, t: 0.22, vol: 0.16 });
  };
  api.unlock = () => [392, 523, 659].forEach((f, i) =>
    tone({ type: 'triangle', f0: f, t: 0.12, vol: 0.07, delay: i * 0.08 }));
  api.dash = () => burst({ fType: 'highpass', f0: 300, f1: 2000, t: 0.16, vol: 0.1 });
  api.teleport = () => { // digging
    burst({ f0: 600, f1: 150, t: 0.18, vol: 0.18 });
    burst({ f0: 500, f1: 120, t: 0.18, vol: 0.16, delay: 0.22 });
    tone({ type: 'sine', f0: 200, f1: 700, t: 0.5, vol: 0.07, delay: 0.1 });
  };
  api.deplete = () => tone({ type: 'square', f0: 200, f1: 90, t: 0.2, vol: 0.1 });
  api.ignite = () => burst({ f0: 900, f1: 200, t: 0.3, vol: 0.13 }); // gasoline catching
  api.shrap = () => burst({ f0: 2000, f1: 250, t: 0.14, vol: 0.16 }); // shrapnel crackle
  api.levelup = () => [523, 659, 784, 1046].forEach((f, i) =>
    tone({ type: 'triangle', f0: f, t: 0.14, vol: 0.09, delay: i * 0.07 }));
  api.crate = () => burst({ f0: 700, f1: 150, t: 0.18, vol: 0.16 });
  api.bossDown = () => {
    api.boom(true);
    [220, 180, 140, 100].forEach((f, i) =>
      tone({ type: 'sawtooth', f0: f, f1: f * 0.5, t: 0.4, vol: 0.12, delay: i * 0.15 }));
  };
  api.click = () => tone({ type: 'square', f0: 700, t: 0.04, vol: 0.05 });

  return api;
})();
