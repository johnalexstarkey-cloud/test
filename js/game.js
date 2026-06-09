'use strict';
// game.js — main loop, player, combat, rooms, rendering, UI
// BLACKPOWDER ISLE: a pirate roguelike on a jungle island.

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let VW = 0, VH = 0, stars = [], vignette = null;

function resize() {
  VW = canvas.width = window.innerWidth;
  VH = canvas.height = window.innerHeight;
  ctx.imageSmoothingEnabled = false; // crisp pixel-art player sprite
  stars = [];
  for (let i = 0; i < 140; i++) stars.push({ x: U.rand(VW), y: U.rand(VH), z: U.rand(0.3, 1) });
  vignette = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.45, VW / 2, VH / 2, Math.max(VW, VH) * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
}
window.addEventListener('resize', resize);
resize();

const FLAVOR = [
  'the jungle watches',
  'drums echo somewhere deep',
  'parrots scatter from the canopy',
  'the tide brought ye here',
  'the air smells of powder and salt',
  'dead men walked this path',
];

const G = {
  state: 'menu', time: 0, runTime: 0, deadT: 0,
  floor: 1, credits: 0, kills: 0,
  level: null, player: null,
  enemies: [], pBullets: [], eBullets: [],
  particles: [], pickups: [], texts: [], flashes: [], trail: [], slashes: [],
  gas: [], parrot: null, splash: null, dashId: 0,
  xp: 0, xpNeed: 6, plvl: 1, pendingLevels: 0, lvlChoices: [],
  cam: { x: 0, y: 0 }, shake: 0, hurtFlash: 0,
  banner: null, boss: null, pedestal: null, weaponQueue: [],
  channel: 0, trans: null, best: null, newBest: false,
};
try { G.best = JSON.parse(localStorage.getItem('blackpowder_best')); } catch { G.best = null; }

// ── run / floor setup ──

function newRun() {
  G.floor = 1; G.credits = 0; G.kills = 0; G.runTime = 0; G.newBest = false;
  G.xp = 0; G.xpNeed = 6; G.plvl = 1; G.pendingLevels = 0; G.lvlChoices = [];
  G.splash = null;
  G.player = {
    x: 0, y: 0, r: 11, hp: 6, maxHp: 6, spd: 235,
    dashT: 0, dashCD: 0, dashCDMax: 0.95, dashDX: 1, dashDY: 0, invuln: 0, fireCD: 0,
    guns: [makeGun('flintlock'), makeGun('sword')], gunIndex: 0, aimAng: 0,
    moving: false, moveAng: 0, gunFlip: false, slashFlip: false, lastGasX: 0, lastGasY: 0,
    stats: { fireRate: 1, speed: 1, dashCD: 1, pierce: 0, bounce: 0, dmg: 1 },
    itemCounts: {},
  };
  G.weaponQueue = U.shuffle(WEAPON_POOL);
  loadFloor(1);
  grantItem(U.pick(Ent.ITEM_IDS)); // every voyage begins with a treasure
  G.state = 'play';
}

// ── items: stackable passive treasures ──

function ic(id) { return (G.player && G.player.itemCounts[id]) || 0; }

function grantItem(id, x, y) {
  const p = G.player;
  p.itemCounts[id] = (p.itemCounts[id] || 0) + 1;
  G.splash = { id, t: 0, count: p.itemCounts[id] }; // the slam-in title card
  Sfx.weaponGet();
  Ent.burst(G, x === undefined ? p.x : x, y === undefined ? p.y : y, Ent.ITEMS[id].color, 18, 180, 0.6, 3);
}

// ── experience & level-up boons ──

const LEVEL_OPTS = [
  { id: 'firerate', name: 'QUICK HANDS', desc: '+15% fire rate', color: '#fde047',
    apply: (p) => { p.stats.fireRate += 0.15; } },
  { id: 'speed', name: 'FLEET FOOT', desc: '+10% move speed', color: '#4ade80',
    apply: (p) => { p.stats.speed += 0.10; } },
  { id: 'roll', name: 'TUMBLER', desc: '-12% roll cooldown', color: '#22d3ee',
    apply: (p) => { p.stats.dashCD *= 0.88; } },
  { id: 'pierce', name: 'CHAIN SHOT', desc: 'shots pierce +1 enemy', color: '#c084fc',
    apply: (p) => { p.stats.pierce += 1; } },
  { id: 'bounce', name: 'SKIPPING SHOT', desc: 'shots bounce +1 wall', color: '#fb923c',
    apply: (p) => { p.stats.bounce += 1; } },
  { id: 'health', name: 'HEART OF OAK', desc: '+1 max health, healed', color: '#f87171',
    apply: (p) => { p.maxHp = Math.min(12, p.maxHp + 1); p.hp = Math.min(p.maxHp, p.hp + 1); } },
  { id: 'damage', name: 'HEAVY BALLS', desc: '+12% damage', color: '#e2e8f0',
    apply: (p) => { p.stats.dmg += 0.12; } },
];

function addXP(n) {
  if (G.state === 'menu') return;
  G.xp += n;
  while (G.xp >= G.xpNeed) {
    G.xp -= G.xpNeed;
    G.plvl++;
    G.pendingLevels++;
    G.xpNeed = 6 + G.plvl * 4;
  }
}

function rollChoices() {
  G.lvlChoices = U.shuffle(LEVEL_OPTS).slice(0, 3);
}

function lvlCardRects() {
  const w = 230, h = 130, gap = 24;
  const x0 = (VW - (3 * w + 2 * gap)) / 2, y = VH * 0.4;
  return [0, 1, 2].map((i) => ({ x: x0 + i * (w + gap), y, w, h }));
}

function loadFloor(n) {
  G.floor = n;
  G.level = MapGen.generate(n);
  G.enemies = []; G.pBullets = []; G.eBullets = [];
  G.particles = []; G.pickups = []; G.texts = []; G.flashes = []; G.trail = []; G.slashes = [];
  G.gas = []; G.parrot = null;
  G.boss = null; G.channel = 0;
  Sfx.setTrack(G.level.area === 'deep' ? 'deep' : 'coast');
  G.player.x = G.level.spawn.x;
  G.player.y = G.level.spawn.y;
  G.cam.x = G.player.x - VW / 2;
  G.cam.y = G.player.y - VH / 2;
  G.pedestal = null;
  if (G.level.pedestal) {
    const id = G.weaponQueue.find((w) => !G.player.guns.some((g) => g.id === w));
    G.pedestal = { x: G.level.pedestal.x, y: G.level.pedestal.y, weaponId: id || null, taken: false };
  }
  for (const m of G.level.medkits) Ent.spawnPickup(G, m.x, m.y, 'heart');
  if (n === 4) Ent.showBanner(G, 'THE DEEP JUNGLE', 'the canopy swallows the sun — new horrors stir');
  else Ent.showBanner(G, 'ISLE ' + n, G.level.isBoss ? '!! the TIKI COLOSSUS stirs !!' : U.pick(FLAVOR));
}

function screenToWorld(sx, sy) { return { x: sx + G.cam.x, y: sy + G.cam.y }; }

// ── update ──

function update(dt) {
  G.time += dt;
  if (G.splash) { G.splash.t += dt; if (G.splash.t > 2.4) G.splash = null; }
  if ((Input.hit('KeyP') || Input.hit('Escape')) && (G.state === 'play' || G.state === 'pause')) {
    G.state = G.state === 'play' ? 'pause' : 'play';
    Sfx.click();
  }
  if (Input.hit('KeyM')) Sfx.toggleMute();

  switch (G.state) {
    case 'menu':
      if (Input.clicked || Input.hit('Enter')) { Sfx.init(); Sfx.click(); newRun(); }
      break;
    case 'play':
      updatePlay(dt);
      break;
    case 'pause':
      break;
    case 'levelup': { // pick 1 of 3 boons
      let pick = -1;
      for (let i = 0; i < 3; i++) if (Input.hit('Digit' + (i + 1))) pick = i;
      if (Input.clicked) {
        const rects = lvlCardRects();
        for (let i = 0; i < 3; i++) {
          const r = rects[i];
          if (Input.mx >= r.x && Input.mx <= r.x + r.w && Input.my >= r.y && Input.my <= r.y + r.h) pick = i;
        }
      }
      if (pick >= 0 && G.lvlChoices[pick]) {
        G.lvlChoices[pick].apply(G.player);
        Sfx.levelup();
        Ent.burst(G, G.player.x, G.player.y, G.lvlChoices[pick].color, 16, 160, 0.5, 3);
        G.pendingLevels--;
        if (G.pendingLevels > 0) rollChoices();
        else G.state = 'play';
      }
      break;
    }
    case 'dead':
      G.deadT += dt;
      updateFx(dt);
      if (G.deadT > 0.8 && (Input.clicked || Input.hit('KeyR') || Input.hit('Enter'))) {
        Sfx.click(); newRun();
      }
      break;
    case 'trans': {
      const tr = G.trans;
      tr.t += dt;
      if (tr.t >= 0.5 && !tr.half) { tr.half = true; loadFloor(tr.next); }
      if (tr.t >= 1.0) { G.trans = null; G.state = 'play'; }
      break;
    }
  }
}

function updatePlay(dt) {
  G.runTime += dt;
  updatePlayer(dt);
  for (const e of G.enemies) Ent.update(G, e, dt);
  G.enemies = G.enemies.filter((e) => !e.dead);
  roomsLogic();
  updatePBullets(dt);
  G.enemies = G.enemies.filter((e) => !e.dead);
  updateEBullets(dt);
  contacts();
  updateGas(dt);
  updateParrot(dt);
  G.enemies = G.enemies.filter((e) => !e.dead);
  updatePickups(dt);
  pedestalLogic();
  exitLogic(dt);
  updateFx(dt);
  camera(dt);
  if (G.pendingLevels > 0 && G.state === 'play') { // earned a boon
    rollChoices();
    G.state = 'levelup';
    Sfx.unlock();
  }
}

// gasoline trail: puddles dropped while rolling, lit by gunfire or blasts
function updateGas(dt) {
  if (!G.gas.length) return;
  for (const g of G.gas) {
    g.life -= dt;
    if (g.fuse !== undefined && !g.burn) {
      g.fuse -= dt;
      if (g.fuse <= 0) {
        g.burn = true; g.bt = 1.5; g.tick = 0.05;
        Sfx.ignite();
        for (const o of G.gas) { // fire races along the trail
          if (!o.burn && o.fuse === undefined && U.dist(g.x, g.y, o.x, o.y) < 46) o.fuse = 0.1;
        }
      }
    }
    if (g.burn) {
      g.bt -= dt; g.tick -= dt;
      if (g.tick <= 0) {
        g.tick = 0.22;
        for (const e of G.enemies) {
          if (e.warp > 0 || e.dead) continue;
          if (U.dist(g.x, g.y, e.x, e.y) < g.r + e.r + 4) {
            Ent.damageEnemy(G, e, 0.6 + 0.3 * (g.stacks - 1));
          }
        }
      }
      if (U.chance(16 * dt)) {
        Ent.burst(G, g.x + U.rand(-6, 6), g.y + U.rand(-6, 6), U.chance(0.5) ? '#fb923c' : '#fde047', 1, 50, 0.35, 3);
      }
      if (g.bt <= 0) g.dead = true;
    }
    if (g.life <= 0) g.dead = true;
  }
  G.gas = G.gas.filter((g) => !g.dead);
}

// the powder parrot: orbits, then dive-bombs the nearest foe
function updateParrot(dt) {
  const stacks = ic('parrot');
  if (!stacks) return;
  const p = G.player;
  if (!G.parrot) G.parrot = { x: p.x, y: p.y - 20, mode: 'orbit', cd: 1.5, a: U.rand(TAU), tid: 0, flap: 0 };
  const pr = G.parrot;
  pr.flap += dt * 14;
  pr.cd -= dt;
  if (pr.mode === 'orbit') {
    pr.a += dt * 2.2;
    const tx = p.x + Math.cos(pr.a) * 30, ty = p.y + Math.sin(pr.a) * 30 - 14;
    const k = 1 - Math.exp(-8 * dt);
    pr.x += (tx - pr.x) * k;
    pr.y += (ty - pr.y) * k;
    if (pr.cd <= 0) {
      let best = null, bd = 240;
      for (const e of G.enemies) {
        if (e.warp > 0 || e.dead) continue;
        const dd = U.dist(pr.x, pr.y, e.x, e.y);
        if (dd < bd) { bd = dd; best = e; }
      }
      if (best) { pr.mode = 'dive'; pr.tid = best.id; }
    }
  } else {
    const t = G.enemies.find((e) => e.id === pr.tid && !e.dead);
    if (!t) { pr.mode = 'orbit'; pr.cd = 2.2; return; }
    const a = U.ang(pr.x, pr.y, t.x, t.y);
    pr.x += Math.cos(a) * 520 * dt;
    pr.y += Math.sin(a) * 520 * dt;
    if (U.dist(pr.x, pr.y, t.x, t.y) < t.r + 6) {
      Ent.damageEnemy(G, t, stacks * G.player.stats.dmg);
      Ent.burst(G, t.x, t.y, '#ef4444', 5, 120, 0.3, 2);
      pr.mode = 'orbit';
      pr.cd = 2.2;
    }
  }
}

// gunpowder item: shrapnel burst around a struck enemy
function shrapnel(x, y, stacks, excludeId) {
  const radius = 46 + 14 * stacks;
  Sfx.shrap();
  Ent.burst(G, x, y, '#fdba74', 8 + stacks * 3, 220, 0.35, 2.5);
  G.flashes.push({ x, y, r: radius, t: 0.12, max: 0.12, color: '#fb923c' });
  for (const e of G.enemies) {
    if (e.warp > 0 || e.dead || e.id === excludeId) continue;
    if (U.dist(x, y, e.x, e.y) < radius + e.r) {
      Ent.damageEnemy(G, e, (1 + 0.5 * (stacks - 1)) * G.player.stats.dmg);
    }
  }
}

// ── player ──

function updatePlayer(dt) {
  const p = G.player;
  p.invuln -= dt; p.dashCD -= dt; p.fireCD -= dt;

  let ix = (Input.key('KeyD') ? 1 : 0) - (Input.key('KeyA') ? 1 : 0);
  let iy = (Input.key('KeyS') ? 1 : 0) - (Input.key('KeyW') ? 1 : 0);
  const il = Math.hypot(ix, iy);
  if (il > 0) { ix /= il; iy /= il; }

  const wm = screenToWorld(Input.mx, Input.my);
  p.aimAng = Math.atan2(wm.y - p.y, wm.x - p.x);

  if ((Input.hit('ShiftLeft') || Input.hit('ShiftRight') || Input.hit('Space')) && p.dashCD <= 0) {
    p.dashT = 0.22;
    p.dashCDMax = 0.95 * p.stats.dashCD;
    p.dashCD = p.dashCDMax;
    if (il > 0) { p.dashDX = ix; p.dashDY = iy; }
    else { p.dashDX = Math.cos(p.aimAng); p.dashDY = Math.sin(p.aimAng); }
    p.invuln = Math.max(p.invuln, 0.3);
    G.dashId++; // for cannonball roll-through hits
    p.lastGasX = p.x; p.lastGasY = p.y;
    Sfx.dash();
  }

  let vx, vy;
  if (p.dashT > 0) {
    p.dashT -= dt;
    vx = p.dashDX * 640; vy = p.dashDY * 640;
    G.trail.push({ x: p.x, y: p.y, t: 0.22 });
    if (G.trail.length > 24) G.trail.shift();
    const gst = ic('gasoline'); // leave a fuel trail
    if (gst && U.dist(p.x, p.y, p.lastGasX, p.lastGasY) > 13) {
      p.lastGasX = p.x; p.lastGasY = p.y;
      G.gas.push({ x: p.x, y: p.y, r: 8 + gst * 2, life: 7, burn: false, bt: 0, tick: 0, stacks: gst });
      if (G.gas.length > 70) G.gas.shift();
    }
  } else {
    const spd = p.spd * p.stats.speed;
    vx = ix * spd; vy = iy * spd;
  }
  p.moving = vx !== 0 || vy !== 0;
  if (p.moving) {
    p.moveAng = Math.atan2(vy, vx);
    if (U.chance(7 * dt)) { // kicked-up trail dust
      Ent.burst(G, p.x - Math.cos(p.moveAng) * 8, p.y - Math.sin(p.moveAng) * 8 + 6, '#9c7b54', 1, 30, 0.45, 2.5);
    }
  }
  MapGen.moveEntity(G.level, p, vx * dt, vy * dt);

  // weapon switching: Q / wheel / number keys
  let gi = p.gunIndex;
  if (Input.hit('KeyQ')) gi++;
  gi += Input.wheel;
  for (let n = 1; n <= 6; n++)
    if (Input.hit('Digit' + n) && p.guns[n - 1]) gi = n - 1;
  gi = ((gi % p.guns.length) + p.guns.length) % p.guns.length;
  if (gi !== p.gunIndex) { p.gunIndex = gi; Sfx.click(); }

  // attacking
  const gun = p.guns[p.gunIndex];
  const W = WEAPONS[gun.id];
  if (Input.down && p.fireCD <= 0 && p.dashT <= 0) {
    if (W.melee) {
      swordSwing(p, W);
    } else if (gun.ammo <= 0) {
      p.fireCD = 0.3; Sfx.click();
    } else {
      p.fireCD = 1 / (W.rate * p.stats.fireRate);
      let mzx = p.x + Math.cos(p.aimAng) * (p.r + 8);
      let mzy = p.y + Math.sin(p.aimAng) * (p.r + 8);
      if (gun.id === 'dualflint') { // alternate left/right pistol
        p.gunFlip = !p.gunFlip;
        const s = p.gunFlip ? 4 : -4;
        mzx += Math.cos(p.aimAng + Math.PI / 2) * s;
        mzy += Math.sin(p.aimAng + Math.PI / 2) * s;
      }
      const pierceLeft = (W.pierce || 0) + p.stats.pierce;
      for (let i = 0; i < W.pellets; i++) {
        const a = p.aimAng + U.rand(-W.spread, W.spread);
        G.pBullets.push({
          x: mzx, y: mzy, vx: Math.cos(a) * W.spd, vy: Math.sin(a) * W.spd,
          dmg: W.dmg * p.stats.dmg, r: W.size, life: W.life, color: W.color,
          pierceLeft, bounceLeft: p.stats.bounce,
          rail: !!W.pierce, boom: W.boom || 0, boomDmg: (W.boomDmg || 0) * p.stats.dmg,
          hit: pierceLeft > 0 ? new Set() : null, dead: false,
        });
      }
      Ent.burst(G, mzx, mzy, W.color, 2, 90, 0.15, 2);
      Ent.burst(G, mzx, mzy, '#9ca3af', 4, 45, 0.6, 2.5); // black-powder smoke
      Sfx.shoot(W.sfx);
      G.shake = Math.max(G.shake, W.boom ? 2.5 : W.pierce ? 3 : gun.id === 'blunderbuss' ? 3.5 : 1.4);
      if (gun.ammo !== Infinity) {
        gun.ammo--;
        if (gun.ammo <= 0) {
          Sfx.deplete();
          Ent.addText(G, p.x, p.y - 20, 'OUT OF POWDER', '#f87171');
          p.gunIndex = 0;
        }
      }
    }
  }
}

// melee: a sword slash in an arc — damages enemies and barrels, parries darts
function swordSwing(p, W) {
  p.fireCD = 1 / (W.rate * p.stats.fireRate);
  p.slashFlip = !p.slashFlip;
  const ang = p.aimAng;
  G.slashes.push({
    x: p.x, y: p.y, ang, arc: W.arc, range: W.range,
    dir: p.slashFlip ? 1 : -1, t: 0, life: 0.16,
  });
  Sfx.shoot('sword');
  let hitAny = false;
  const kb = 170 + 280 * ic('spinach'); // spinach: send them flying
  for (const e of G.enemies) {
    if (e.warp > 0 || e.dead) continue;
    if (U.dist(p.x, p.y, e.x, e.y) > W.range + e.r) continue;
    if (Math.abs(U.adiff(U.ang(p.x, p.y, e.x, e.y), ang)) > W.arc / 2) continue;
    Ent.damageEnemy(G, e, W.dmg * p.stats.dmg);
    e.kbx += Math.cos(ang) * kb;
    e.kby += Math.sin(ang) * kb;
    hitAny = true;
  }
  for (const b of G.eBullets) { // parry incoming darts
    if (b.dead) continue;
    if (U.dist(p.x, p.y, b.x, b.y) > W.range + 8) continue;
    if (Math.abs(U.adiff(U.ang(p.x, p.y, b.x, b.y), ang)) > W.arc / 2 + 0.2) continue;
    b.dead = true;
    Ent.burst(G, b.x, b.y, '#cbd5e1', 3, 110, 0.2, 2);
  }
  // smash barrels in the arc
  const t0x = Math.floor((p.x - W.range) / TILE), t1x = Math.floor((p.x + W.range) / TILE);
  const t0y = Math.floor((p.y - W.range) / TILE), t1y = Math.floor((p.y + W.range) / TILE);
  for (let ty = t0y; ty <= t1y; ty++) {
    for (let tx = t0x; tx <= t1x; tx++) {
      if (tx < 0 || ty < 0 || tx >= G.level.W || ty >= G.level.H) continue;
      if (G.level.grid[ty * G.level.W + tx] !== T_CRATE) continue;
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      if (U.dist(p.x, p.y, cx, cy) > W.range + 12) continue;
      if (Math.abs(U.adiff(U.ang(p.x, p.y, cx, cy), ang)) > W.arc / 2 + 0.3) continue;
      Ent.damageCrate(G, tx, ty, W.dmg);
    }
  }
  if (hitAny) G.shake = Math.max(G.shake, 1.5);
}

function hurtPlayer(d) {
  const p = G.player;
  if (p.invuln > 0 || G.state !== 'play') return;
  p.hp -= d;
  p.invuln = 1.15;
  G.shake = Math.max(G.shake, 6);
  G.hurtFlash = 0.35;
  Sfx.hurt();
  Ent.burst(G, p.x, p.y, '#f87171', 12, 180, 0.4, 3);
  const vd = ic('voodoo'); // voodoo doll: the room shares your pain
  if (vd) {
    const room = MapGen.roomAt(G.level, p.x, p.y);
    if (room) {
      for (const e of G.enemies) {
        if (e.roomIdx !== room.idx || e.warp > 0 || e.dead) continue;
        Ent.damageEnemy(G, e, 2 * vd);
        Ent.burst(G, e.x, e.y, '#a78bfa', 5, 110, 0.35, 2.5);
      }
    }
  }
  if (p.hp <= 0) die();
}

function die() {
  G.state = 'dead';
  G.deadT = 0;
  Sfx.boom(true);
  Ent.burst(G, G.player.x, G.player.y, '#dc2626', 36, 300, 0.9, 4);
  Ent.burst(G, G.player.x, G.player.y, '#fbbf24', 16, 180, 0.5, 3);
  G.flashes.push({ x: G.player.x, y: G.player.y, r: 120, t: 0.3, max: 0.3, color: '#dc2626' });
  const b = G.best;
  if (!b || G.floor > b.floor || (G.floor === b.floor && G.credits > b.credits)) {
    G.best = { floor: G.floor, credits: G.credits, kills: G.kills };
    G.newBest = true;
    try { localStorage.setItem('blackpowder_best', JSON.stringify(G.best)); } catch { /* storage unavailable */ }
  }
}

// ── rooms: vine lockdown + clear ──

function roomsLogic() {
  const lvl = G.level, p = G.player;
  const room = MapGen.roomAt(lvl, p.x, p.y);
  if (room) {
    if (!room.visited) {
      room.visited = true;
      for (const [a, b] of lvl.edges) {
        if (a === room.idx) lvl.rooms[b].seen = true;
        if (b === room.idx) lvl.rooms[a].seen = true;
      }
    }
    if ((room.type === 'combat' || room.type === 'boss') && !room.cleared && !room.locked) {
      const inset = TILE * 0.9;
      if (p.x > room.x * TILE + inset && p.x < (room.x + room.w) * TILE - inset &&
          p.y > room.y * TILE + inset && p.y < (room.y + room.h) * TILE - inset) {
        lockRoom(room);
      }
    }
  }
  for (const r of lvl.rooms) {
    if (!r.locked) continue;
    if (!G.enemies.some((e) => e.roomIdx === r.idx)) {
      r.locked = false;
      r.cleared = true;
      Sfx.unlock();
      for (const b of G.eBullets) Ent.burst(G, b.x, b.y, '#a8a29e', 2, 60, 0.25, 2);
      G.eBullets.length = 0;
      if (r.type !== 'boss') { // Isaac-style clear reward: sometimes a stat treasure
        const roll = Math.random();
        if (roll < 0.28) Ent.spawnPickup(G, r.cx, r.cy, 'item', U.pick(Ent.ITEM_IDS));
        else if (roll < 0.72) Ent.dropLoot(G, r.cx, r.cy, 'room');
      }
    }
  }
}

function lockRoom(room) {
  room.locked = true;
  Sfx.gate();
  G.shake = Math.max(G.shake, 3);
  if (room.type === 'boss') {
    const e = Ent.spawn(G, 'tiki', room.cx, (room.y + room.h * 0.3) * TILE, room.idx);
    e.warp = 1.2;
    G.boss = e;
    Ent.showBanner(G, 'THE TIKI COLOSSUS', 'the island guardian wakes — strike it down');
  } else {
    let budget = 4 + Math.round(G.floor * 1.9);
    let kinds;
    if (G.level.area === 'coast') {
      kinds = ['viper', 'tribesman'];
      if (G.floor >= 2) kinds.push('totem');
      if (G.floor >= 3) kinds.push('constrictor');
    } else { // the deep jungle has its own horrors
      kinds = ['viper', 'spearman', 'archer', 'primate', 'spearman', 'archer', 'primate'];
      if (G.floor >= 5) kinds.push('hunter', 'brood', 'shaman');
      if (G.floor >= 6) kinds.push('headhunter', 'totem', 'constrictor');
    }
    let n = 0, guard = 80;
    while (budget > 0 && n < 13 && guard-- > 0) {
      const k = U.pick(kinds);
      const def = Ent.ENEMY_DEFS[k];
      if (def.cost > budget && n >= 2) break;
      const pos = MapGen.randFloorInRoom(G.level, room, {
        awayFromX: G.player.x, awayFromY: G.player.y, minDist: TILE * 4.5,
      });
      if (!pos) continue;
      Ent.spawn(G, k, pos.x, pos.y, room.idx, n * 0.1);
      budget -= def.cost;
      n++;
    }
  }
}

// ── bullets ──

function updatePBullets(dt) {
  const lvl = G.level;
  for (const b of G.pBullets) {
    b.life -= dt;
    if (b.life <= 0) { b.dead = true; continue; }
    const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 12));
    for (let s = 0; s < steps && !b.dead; s++) {
      const sox = b.x, soy = b.y;
      b.x += (b.vx * dt) / steps;
      b.y += (b.vy * dt) / steps;
      const tx = Math.floor(b.x / TILE), ty = Math.floor(b.y / TILE);
      if (MapGen.solidAt(lvl, tx, ty)) {
        if (tx >= 0 && ty >= 0 && tx < lvl.W && ty < lvl.H && lvl.grid[ty * lvl.W + tx] === T_CRATE) {
          Ent.damageCrate(G, tx, ty, Math.max(1, Math.round(b.dmg)));
        }
        if (b.boom) {
          Ent.boom(G, b.x, b.y, b.boom, b.boomDmg);
          b.dead = true;
        } else if (b.bounceLeft > 0) { // ricochet off the wall face that was crossed
          b.bounceLeft--;
          const otx = Math.floor(sox / TILE), oty = Math.floor(soy / TILE);
          if (tx !== otx) b.vx = -b.vx;
          if (ty !== oty) b.vy = -b.vy;
          if (tx === otx && ty === oty) { b.vx = -b.vx; b.vy = -b.vy; }
          b.x = sox; b.y = soy;
          Ent.burst(G, b.x, b.y, b.color, 2, 80, 0.15, 2);
        } else {
          Ent.burst(G, b.x, b.y, b.color, 3, 90, 0.2, 2);
          b.dead = true;
        }
        break;
      }
      for (const e of G.enemies) {
        if (e.warp > 0 || e.dead) continue;
        const rr = b.r + e.r;
        const ex = e.x - b.x, ey = e.y - b.y;
        if (ex * ex + ey * ey < rr * rr) {
          if (b.hit) {
            if (b.hit.has(e.id)) continue;
            b.hit.add(e.id);
          }
          Ent.damageEnemy(G, e, b.dmg);
          const gp = ic('gunpowder'); // chance of a shrapnel burst
          if (gp && U.chance(Math.min(0.1 + 0.08 * (gp - 1), 0.6))) shrapnel(b.x, b.y, gp, e.id);
          const ka = Math.atan2(b.vy, b.vx);
          e.kbx += Math.cos(ka) * 90;
          e.kby += Math.sin(ka) * 90;
          Ent.burst(G, b.x, b.y, b.color, 4, 120, 0.25, 2);
          if (b.boom) { Ent.boom(G, b.x, b.y, b.boom, b.boomDmg); b.dead = true; }
          else if (b.pierceLeft > 0) b.pierceLeft--;
          else b.dead = true;
          if (b.dead) break;
        }
      }
      if (G.gas.length) { // gunfire ignites fuel
        for (const g of G.gas) {
          if (!g.burn && g.fuse === undefined && U.dist(b.x, b.y, g.x, g.y) < g.r + b.r) g.fuse = 0;
        }
      }
    }
  }
  G.pBullets = G.pBullets.filter((b) => !b.dead);
}

function updateEBullets(dt) {
  const lvl = G.level, p = G.player;
  for (const b of G.eBullets) {
    if (b.dead) continue; // parried this frame
    b.life -= dt; b.t += dt;
    if (b.life <= 0) { b.dead = true; continue; }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const tx = Math.floor(b.x / TILE), ty = Math.floor(b.y / TILE);
    if (MapGen.solidAt(lvl, tx, ty)) {
      Ent.burst(G, b.x, b.y, b.color, 2, 70, 0.18, 2);
      b.dead = true;
      continue;
    }
    const rr = b.r + p.r * 0.7; // forgiving hitbox vs darts
    const ex = p.x - b.x, ey = p.y - b.y;
    if (p.invuln <= 0 && ex * ex + ey * ey < rr * rr) {
      b.dead = true;
      hurtPlayer(1);
    }
  }
  G.eBullets = G.eBullets.filter((b) => !b.dead);
}

// ── contact damage + enemy separation ──

function contacts() {
  const p = G.player;
  const cb = ic('cannonball');
  for (const e of G.enemies) {
    if (e.warp > 0 || e.dead) continue;
    if (cb && p.dashT > 0 && e.lastDash !== G.dashId &&
        U.dist(e.x, e.y, p.x, p.y) < e.r + p.r) { // cannonball: roll right through them
      e.lastDash = G.dashId;
      Ent.damageEnemy(G, e, cb * p.stats.dmg);
      const a = U.ang(p.x, p.y, e.x, e.y);
      e.kbx += Math.cos(a) * 300;
      e.kby += Math.sin(a) * 300;
      Ent.burst(G, e.x, e.y, '#94a3b8', 6, 140, 0.3, 2.5);
      continue;
    }
    if (p.invuln <= 0 && U.dist(e.x, e.y, p.x, p.y) < e.r + p.r * 0.8) {
      hurtPlayer(1);
      const a = U.ang(e.x, e.y, p.x, p.y);
      MapGen.moveEntity(G.level, p, Math.cos(a) * 14, Math.sin(a) * 14);
    }
  }
  for (let i = 0; i < G.enemies.length; i++) {
    for (let j = i + 1; j < G.enemies.length; j++) {
      const a = G.enemies[i], b = G.enemies[j];
      if (a.warp > 0 || b.warp > 0) continue;
      const d = U.dist(a.x, a.y, b.x, b.y), min = a.r + b.r;
      if (d > 0 && d < min) {
        const push = (min - d) / 2;
        const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
        if (a.spd > 0) MapGen.moveEntity(G.level, a, -nx * push, -ny * push);
        if (b.spd > 0) MapGen.moveEntity(G.level, b, nx * push, ny * push);
      }
    }
  }
}

// ── pickups / treasure chest / dig site ──

function updatePickups(dt) {
  const p = G.player;
  for (const pk of G.pickups) {
    pk.x += pk.vx * dt; pk.y += pk.vy * dt;
    pk.vx *= Math.exp(-4 * dt); pk.vy *= Math.exp(-4 * dt);
    const skipHeart = pk.kind === 'heart' && p.hp >= p.maxHp;
    const d = U.dist(pk.x, pk.y, p.x, p.y);
    const magnet = pk.kind === 'item' ? 0 : pk.kind === 'credit' ? 130 : 90;
    if (!skipHeart && d < magnet && G.state === 'play') {
      const a = U.ang(pk.x, pk.y, p.x, p.y);
      const pull = 380 * (1 - d / magnet) + 60;
      pk.x += Math.cos(a) * pull * dt;
      pk.y += Math.sin(a) * pull * dt;
    }
    if (!skipHeart && d < p.r + (pk.kind === 'item' ? 16 : 10)) {
      pk.dead = true;
      Sfx.pickup();
      if (pk.kind === 'item') {
        grantItem(pk.val, pk.x, pk.y);
      } else if (pk.kind === 'credit') {
        G.credits += pk.val;
        Ent.addText(G, pk.x, pk.y - 10, '+' + pk.val + 'g', '#fbbf24', 12);
      } else if (pk.kind === 'cell') {
        let any = false;
        for (const g of p.guns) {
          const W = WEAPONS[g.id];
          if (W.ammo === Infinity) continue;
          g.ammo = Math.min(W.ammo, g.ammo + Math.ceil(W.ammo * 0.35));
          any = true;
        }
        if (!any) G.credits += 2;
        Ent.addText(G, pk.x, pk.y - 10, any ? '+POWDER' : '+2g', '#fbbf24', 12);
      } else if (pk.kind === 'heart') {
        p.hp = Math.min(p.maxHp, p.hp + 1);
        Ent.addText(G, pk.x, pk.y - 10, '+1 HEALTH', '#f87171', 12);
      }
    }
  }
  G.pickups = G.pickups.filter((pk) => !pk.dead);
}

function pedestalLogic() {
  const pd = G.pedestal, p = G.player;
  if (!pd || pd.taken) return;
  if (U.dist(p.x, p.y, pd.x, pd.y) < 26) {
    pd.taken = true;
    Sfx.weaponGet();
    Ent.burst(G, pd.x, pd.y, '#fde68a', 18, 180, 0.6, 3);
    if (pd.weaponId) {
      p.guns.push(makeGun(pd.weaponId));
      p.gunIndex = p.guns.length - 1;
      Ent.showBanner(G, WEAPONS[pd.weaponId].name + ' PLUNDERED', 'press Q / wheel / 1-' + p.guns.length + ' to swap');
    } else {
      G.credits += 8;
      for (const g of p.guns) {
        const W = WEAPONS[g.id];
        if (W.ammo !== Infinity) g.ammo = W.ammo;
      }
      Ent.showBanner(G, 'BURIED CACHE', '+8 gold — powder restored');
    }
  }
}

function exitLogic(dt) {
  const lvl = G.level, p = G.player;
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  const onPad = tx >= 0 && ty >= 0 && tx < lvl.W && ty < lvl.H && lvl.grid[ty * lvl.W + tx] === T_EXIT;
  const exitRoom = lvl.rooms[lvl.exitIdx];
  if (onPad && exitRoom.cleared) {
    if (G.channel === 0) Sfx.teleport();
    G.channel += dt;
    if (U.chance(14 * dt)) Ent.burst(G, p.x + U.rand(-12, 12), p.y + U.rand(-4, 14), '#7c5a36', 2, 60, 0.4, 2.5); // digging
    if (G.channel >= 0.9) {
      G.state = 'trans';
      G.trans = { t: 0, half: false, next: G.floor + 1 };
    }
  } else {
    G.channel = Math.max(0, G.channel - dt * 2);
  }
}

// ── fx + camera ──

function updateFx(dt) {
  for (const pt of G.particles) {
    pt.life -= dt;
    pt.x += pt.vx * dt; pt.y += pt.vy * dt;
    pt.vx *= Math.exp(-3 * dt); pt.vy *= Math.exp(-3 * dt);
  }
  G.particles = G.particles.filter((pt) => pt.life > 0);
  for (const t of G.texts) { t.t += dt; t.y -= 26 * dt; }
  G.texts = G.texts.filter((t) => t.t < t.life);
  for (const f of G.flashes) f.t -= dt;
  G.flashes = G.flashes.filter((f) => f.t > 0);
  for (const tp of G.trail) tp.t -= dt;
  G.trail = G.trail.filter((tp) => tp.t > 0);
  for (const s of G.slashes) s.t += dt;
  G.slashes = G.slashes.filter((s) => s.t < s.life);
  if (G.banner) { G.banner.t += dt; if (G.banner.t > G.banner.life) G.banner = null; }
  G.hurtFlash = Math.max(0, G.hurtFlash - dt);
  G.shake = Math.max(0, G.shake - dt * 22);
}

function camera(dt) {
  const p = G.player;
  const lead = 0.12;
  const txp = p.x + (Input.mx - VW / 2) * lead - VW / 2;
  const typ = p.y + (Input.my - VH / 2) * lead - VH / 2;
  const k = 1 - Math.exp(-8 * dt);
  G.cam.x += (txp - G.cam.x) * k;
  G.cam.y += (typ - G.cam.y) * k;
}

// ── rendering ──

function font(size, weight = 'bold') { return weight + ' ' + size + 'px "Courier New", monospace'; }

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const pal = G.level ? (PALETTES[G.level.area] || PALETTES.coast) : PALETTES.coast;
  ctx.fillStyle = pal.sea;
  ctx.fillRect(0, 0, VW, VH);

  if (G.state === 'menu' || !G.level) {
    drawStars();
    drawMenu();
    drawReticle();
    return;
  }

  const shx = U.rand(-1, 1) * G.shake, shy = U.rand(-1, 1) * G.shake;
  ctx.save();
  ctx.translate(Math.round(-G.cam.x + shx), Math.round(-G.cam.y + shy));
  drawTiles();
  drawPad();
  drawGas();
  drawGates();
  drawPedestal();
  for (const pk of G.pickups) Ent.drawPickup(ctx, G, pk);
  for (const e of G.enemies) Ent.drawEnemy(ctx, G, e);
  if (G.state !== 'dead') Ent.drawPlayer(ctx, G);
  drawParrot();
  drawSlashes();
  drawBullets();
  drawFx();
  drawWorldTexts();
  if (G.channel > 0 && G.state === 'play') { // digging progress
    const p = G.player;
    ctx.fillStyle = '#1c1408';
    ctx.fillRect(p.x - 22, p.y - p.r - 16, 44, 5);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(p.x - 22, p.y - p.r - 16, 44 * U.clamp(G.channel / 0.9, 0, 1), 5);
  }
  ctx.restore();

  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, VW, VH);
  if (G.level && G.level.area === 'deep') { // the gloom of the deep jungle
    ctx.fillStyle = 'rgba(3,10,5,0.2)';
    ctx.fillRect(0, 0, VW, VH);
  }
  if (G.hurtFlash > 0) {
    ctx.fillStyle = 'rgba(220,38,38,' + (G.hurtFlash * 0.5) + ')';
    ctx.fillRect(0, 0, VW, VH);
  }

  drawHUD();
  drawMinimap();
  drawBossBar();
  drawBanner();
  drawSplash();

  if (G.state === 'pause') drawPause();
  if (G.state === 'levelup') drawLevelUp();
  if (G.state === 'dead') drawDead();
  if (G.state === 'trans') {
    const t = G.trans.t;
    ctx.fillStyle = 'rgba(4,8,4,' + U.clamp(t < 0.5 ? t * 2 : (1 - t) * 2, 0, 1) + ')';
    ctx.fillRect(0, 0, VW, VH);
  }
  drawReticle();
}

function drawStars() {
  ctx.fillStyle = '#071420';
  ctx.fillRect(0, 0, VW, VH);
  for (const s of stars) { // night sky over the cove
    const x = (s.x + G.time * 8 * s.z) % VW;
    ctx.globalAlpha = 0.3 + s.z * 0.5;
    ctx.fillStyle = s.z > 0.8 ? '#fde68a' : '#475569';
    ctx.fillRect(x, s.y * 0.7, s.z * 2, s.z * 2);
  }
  ctx.globalAlpha = 1;
  // moonlit water at the bottom
  ctx.fillStyle = '#0a1d2e';
  ctx.fillRect(0, VH * 0.72, VW, VH * 0.28);
  ctx.strokeStyle = '#1d3d5c';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) {
    const wy = VH * 0.74 + (i * 37) % (VH * 0.24);
    const wx = (i * 197 + G.time * 18) % VW;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.quadraticCurveTo(wx + 12, wy - 3, wx + 24, wy);
    ctx.stroke();
  }
}

const PALETTES = {
  coast: { // bright shoreline jungle
    floor: {
      start: ['#2e2716', '#352d19'],     // sandy landing
      combat: ['#16240e', '#1a2a12'],    // jungle floor
      treasure: ['#2b2210', '#241d0d'],  // golden grotto
      medbay: ['#182611', '#1d2c15'],    // sheltered camp
      exit: ['#26200f', '#2b2513'],      // dig site clearing
      boss: ['#260f0f', '#2c1313'],      // scorched shrine
    },
    corridor: ['#241a10', '#2a1f13'],
    sea: '#08141f', wave: '#1d3d5c',
    wall: '#0d2113', clumpA: '#143018', clumpB: '#0a1a0e', fringe: '#2f7d3a',
    grass: '#3f6b2a',
  },
  deep: { // the deep jungle: the canopy swallows the sun
    floor: {
      start: ['#13200e', '#16240f'],
      combat: ['#0c1607', '#0e1a09'],
      treasure: ['#1f1a0c', '#241d0d'],
      medbay: ['#101c0c', '#13200e'],
      exit: ['#1a160b', '#1f1a0d'],
      boss: ['#1b0c0c', '#200f0f'],
    },
    corridor: ['#15100a', '#19130c'],
    sea: '#050d13', wave: '#10293d',
    wall: '#06120a', clumpA: '#0a1c10', clumpB: '#040d07', fringe: '#1c5a2e',
    grass: '#27521f',
  },
};

function drawTiles() {
  const lvl = G.level;
  const pal = PALETTES[lvl.area] || PALETTES.coast;
  const deep = lvl.area === 'deep';
  const tx0 = Math.max(0, Math.floor(G.cam.x / TILE) - 1);
  const ty0 = Math.max(0, Math.floor(G.cam.y / TILE) - 1);
  const tx1 = Math.min(lvl.W - 1, Math.ceil((G.cam.x + VW) / TILE) + 1);
  const ty1 = Math.min(lvl.H - 1, Math.ceil((G.cam.y + VH) / TILE) + 1);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const v = lvl.grid[ty * lvl.W + tx];
      const px = tx * TILE, py = ty * TILE;
      const h = U.hash2(tx, ty);
      if (v === T_FLOOR || v === T_EXIT || v === T_CRATE) {
        const ri = lvl.roomOf[ty * lvl.W + tx];
        const shades = ri >= 0 ? (pal.floor[lvl.rooms[ri].type] || pal.floor.combat) : pal.corridor;
        ctx.fillStyle = shades[h > 0.5 ? 1 : 0];
        ctx.fillRect(px, py, TILE, TILE);
        if (h < 0.06) { // grass tuft
          ctx.strokeStyle = pal.grass;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(px + 14, py + 22); ctx.lineTo(px + 11, py + 14);
          ctx.moveTo(px + 16, py + 22); ctx.lineTo(px + 17, py + 13);
          ctx.moveTo(px + 18, py + 22); ctx.lineTo(px + 21, py + 15);
          ctx.stroke();
        } else if (h < 0.09) { // pebbles
          ctx.fillStyle = '#57534e';
          ctx.beginPath();
          ctx.arc(px + 11, py + 18, 2, 0, TAU);
          ctx.arc(px + 20, py + 12, 1.5, 0, TAU);
          ctx.fill();
        } else if (h < 0.105) {
          if (deep) { // pale glowing mushrooms instead of flowers
            ctx.fillStyle = '#94a3b8';
            ctx.beginPath(); ctx.arc(px + 15, py + 15, 2.2, 0, TAU); ctx.arc(px + 20, py + 17, 1.5, 0, TAU); ctx.fill();
            ctx.fillStyle = 'rgba(165,243,252,0.5)';
            ctx.beginPath(); ctx.arc(px + 15, py + 15, 1, 0, TAU); ctx.fill();
          } else { // jungle flower
            ctx.fillStyle = '#f472b6';
            ctx.beginPath(); ctx.arc(px + 16, py + 14, 2, 0, TAU); ctx.fill();
            ctx.fillStyle = '#fde047';
            ctx.beginPath(); ctx.arc(px + 16, py + 14, 0.8, 0, TAU); ctx.fill();
          }
        } else if (h < 0.16) { // leaf litter
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.fillRect(px + 6, py + 6, TILE - 12, TILE - 12);
        }
        if (v === T_EXIT) { // disturbed earth at the dig site
          ctx.fillStyle = deep ? '#171107' : '#1f1709';
          ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
        }
        if (v === T_CRATE) { // wooden cargo crate (one good hit splinters it)
          ctx.fillStyle = '#5b3a1a';
          ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
          ctx.strokeStyle = '#8a5a2b';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px + 3, py + 3, TILE - 6, TILE - 6);
          ctx.strokeStyle = '#3d2712'; // plank cross
          ctx.beginPath();
          ctx.moveTo(px + 3, py + 3); ctx.lineTo(px + TILE - 3, py + TILE - 3);
          ctx.moveTo(px + TILE - 3, py + 3); ctx.lineTo(px + 3, py + TILE - 3);
          ctx.stroke();
        }
      } else if (v === T_WALL) { // dense jungle foliage
        ctx.fillStyle = pal.wall;
        ctx.fillRect(px, py, TILE, TILE);
        if (h < 0.5) { // canopy clumps
          ctx.fillStyle = h < 0.25 ? pal.clumpA : pal.clumpB;
          ctx.beginPath();
          ctx.arc(px + 8 + h * 20, py + 8 + h * 14, 6, 0, TAU);
          ctx.arc(px + 22 - h * 10, py + 20, 5, 0, TAU);
          ctx.fill();
        }
        if (deep && h > 0.5 && h < 0.53 && Math.sin(G.time * 2.2 + h * 80) > -0.4) {
          ctx.fillStyle = '#fde047'; // something watches from the thicket
          ctx.fillRect(px + 11, py + 14, 2.5, 2.5);
          ctx.fillRect(px + 18, py + 14, 2.5, 2.5);
        }
        ctx.fillStyle = pal.fringe; // leafy fringe facing the clearing
        const fl = (ox, oy) => {
          const nx = tx + ox, ny = ty + oy;
          if (nx < 0 || ny < 0 || nx >= lvl.W || ny >= lvl.H) return false;
          const nv = lvl.grid[ny * lvl.W + nx];
          return nv === T_FLOOR || nv === T_EXIT || nv === T_CRATE;
        };
        if (fl(0, 1)) ctx.fillRect(px, py + TILE - 2, TILE, 2);
        if (fl(0, -1)) ctx.fillRect(px, py, TILE, 2);
        if (fl(1, 0)) ctx.fillRect(px + TILE - 2, py, 2, TILE);
        if (fl(-1, 0)) ctx.fillRect(px, py, 2, TILE);
      } else { // open water around the isle
        if (h < 0.08) {
          ctx.strokeStyle = pal.wave;
          ctx.lineWidth = 1.5;
          const wy = py + 8 + h * 180;
          ctx.beginPath();
          ctx.moveTo(px + 4, wy);
          ctx.quadraticCurveTo(px + 12, wy - 3, px + 20, wy);
          ctx.stroke();
        }
      }
    }
  }
}

function drawGas() {
  for (const g of G.gas) {
    ctx.fillStyle = g.burn ? 'rgba(120,80,10,0.5)' : 'rgba(70,80,25,0.45)';
    ctx.beginPath(); ctx.ellipse(g.x, g.y, g.r, g.r * 0.7, 0, 0, TAU); ctx.fill();
    if (g.burn) {
      ctx.globalCompositeOperation = 'lighter';
      const fl = 0.5 + 0.5 * Math.sin(G.time * 18 + g.x);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fb923c';
      ctx.beginPath(); ctx.ellipse(g.x, g.y - 3, g.r * 0.8, g.r * (0.8 + fl * 0.5), 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fde047';
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.ellipse(g.x, g.y - 4, g.r * 0.4, g.r * (0.5 + fl * 0.4), 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.fillStyle = 'rgba(190,210,90,0.25)'; // oily sheen
      ctx.beginPath(); ctx.ellipse(g.x - 2, g.y - 2, g.r * 0.35, g.r * 0.22, 0.6, 0, TAU); ctx.fill();
    }
  }
}

function drawParrot() {
  const pr = G.parrot;
  if (!pr || !ic('parrot')) return;
  ctx.save();
  ctx.translate(pr.x, pr.y);
  if (pr.mode === 'dive') ctx.rotate(Math.sin(G.time * 30) * 0.2);
  const flap = Math.sin(pr.flap) * 4;
  ctx.fillStyle = '#16a34a'; // wings
  ctx.beginPath();
  ctx.ellipse(-3, -flap, 5, 2.2, -0.5, 0, TAU);
  ctx.ellipse(3, -flap, 5, 2.2, 0.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ef4444'; // body
  ctx.beginPath(); ctx.ellipse(0, 0, 3.5, 4.5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fbbf24'; // beak
  ctx.beginPath();
  ctx.moveTo(0, -4); ctx.lineTo(3.5, -6); ctx.lineTo(1, -2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1c1917';
  ctx.beginPath(); ctx.arc(1, -3.5, 0.8, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawPad() { // X marks the spot
  const lvl = G.level;
  const c = lvl.padCenter;
  const active = lvl.rooms[lvl.exitIdx].cleared;
  const col = active ? '#fbbf24' : '#6b5535';
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.strokeStyle = '#57534e'; // ring of stones
  ctx.fillStyle = '#57534e';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 26, Math.sin(a) * 26, 3, 0, TAU);
    ctx.fill();
  }
  if (active) { ctx.shadowColor = col; ctx.shadowBlur = 14; }
  ctx.strokeStyle = col; // the X itself
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-15, -15); ctx.lineTo(15, 15);
  ctx.moveTo(15, -15); ctx.lineTo(-15, 15);
  ctx.stroke();
  ctx.lineCap = 'butt';
  if (active) {
    const rr = 6 + ((G.time * 26) % 22);
    ctx.globalAlpha = 1 - rr / 28;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawGates() { // walls of lashing vines
  const lvl = G.level;
  for (const r of lvl.rooms) {
    if (!r.locked) continue;
    for (const grp of r.gates) {
      for (const g of grp) {
        const px = g.x * TILE, py = g.y * TILE;
        ctx.fillStyle = 'rgba(20,83,45,0.3)';
        ctx.fillRect(px, py, TILE, TILE);
        for (let i = 0; i < 3; i++) {
          const vx = px + 6 + i * 10;
          const sway = Math.sin(G.time * 2.4 + g.x * 2 + i) * 3;
          ctx.strokeStyle = i % 2 ? '#166534' : '#15803d';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(vx, py);
          ctx.quadraticCurveTo(vx + sway, py + TILE / 2, vx, py + TILE);
          ctx.stroke();
          ctx.fillStyle = '#dc2626'; // thorns
          ctx.beginPath();
          ctx.arc(vx + sway * 0.6, py + 10 + i * 7, 1.5, 0, TAU);
          ctx.fill();
        }
      }
    }
  }
}

function drawPedestal() { // treasure chest with the floating prize
  const pd = G.pedestal;
  if (!pd || pd.taken) return;
  ctx.save();
  ctx.translate(pd.x, pd.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 12, 18, 6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#713f12'; // chest body
  ctx.strokeStyle = '#a16207';
  ctx.lineWidth = 2;
  ctx.fillRect(-14, -2, 28, 14);
  ctx.strokeRect(-14, -2, 28, 14);
  ctx.beginPath(); // domed lid
  ctx.moveTo(-14, -2);
  ctx.quadraticCurveTo(0, -12, 14, -2);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#a16207'; // bands + lock
  ctx.fillRect(-6, -9, 3, 21);
  ctx.fillRect(3, -9, 3, 21);
  ctx.fillStyle = '#fde047';
  ctx.fillRect(-2.5, 1, 5, 6);
  const bob = Math.sin(G.time * 2.4) * 3;
  ctx.translate(0, -24 + bob);
  ctx.rotate(Math.sin(G.time * 1.2) * 0.18);
  ctx.shadowBlur = 12;
  if (pd.weaponId) {
    ctx.shadowColor = WEAPONS[pd.weaponId].color;
    ctx.scale(1.15, 1.15);
    ctx.translate(-14, 0);
    Ent.drawGun(ctx, pd.weaponId);
  } else { // buried cache: a pile of doubloons
    ctx.shadowColor = '#fbbf24';
    ctx.fillStyle = '#fbbf24';
    ctx.strokeStyle = '#a16207';
    for (const [ox, oy] of [[-5, 2], [5, 2], [0, -3], [0, 4]]) {
      ctx.beginPath(); ctx.arc(ox, oy, 4, 0, TAU); ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
  if (U.dist(G.player.x, G.player.y, pd.x, pd.y) < 140) {
    ctx.fillStyle = '#fde68a';
    ctx.font = font(12);
    ctx.textAlign = 'center';
    ctx.fillText(pd.weaponId ? WEAPONS[pd.weaponId].name : 'BURIED CACHE', pd.x, pd.y - 46);
  }
}

function drawSlashes() { // sword sweeps
  for (const s of G.slashes) {
    const k = s.t / s.life;
    const a0 = s.ang - (s.arc / 2) * s.dir;
    const sweep = s.arc * s.dir * Math.min(1, k * 1.6);
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.range - 6, a0, a0 + sweep, s.dir < 0);
    ctx.stroke();
    ctx.globalAlpha = (1 - k) * 0.35;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.range - 11, a0, a0 + sweep, s.dir < 0);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawBullets() {
  // player shot: glowing musket balls
  ctx.globalCompositeOperation = 'lighter';
  for (const b of G.pBullets) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2.2, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    if (b.rail) { // musket slug: long streak
      const a = Math.atan2(b.vy, b.vx);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.r;
      ctx.beginPath();
      ctx.moveTo(b.x - Math.cos(a) * 18, b.y - Math.sin(a) * 18);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.8, 0, TAU); ctx.fill();
  }
  // enemy shots: orbs glow, darts are wooden
  for (const b of G.eBullets) {
    if (b.orb) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2.4, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fefce8';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.45, 0, TAU); ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const b of G.eBullets) {
    if (b.orb) continue;
    const a = Math.atan2(b.vy, b.vx);
    const ca = Math.cos(a), sa = Math.sin(a);
    const len = b.r * 2.4 + 5;
    ctx.strokeStyle = '#d6b25c'; // shaft
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x - ca * len, b.y - sa * len);
    ctx.lineTo(b.x + ca * 2, b.y + sa * 2);
    ctx.stroke();
    ctx.fillStyle = '#44403c'; // point
    ctx.beginPath(); ctx.arc(b.x + ca * 3, b.y + sa * 3, 1.8, 0, TAU); ctx.fill();
    ctx.fillStyle = b.color; // fletching
    ctx.beginPath(); ctx.arc(b.x - ca * len, b.y - sa * len, 2.4, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawFx() {
  ctx.globalCompositeOperation = 'lighter';
  for (const f of G.flashes) {
    ctx.globalAlpha = (f.t / f.max) * 0.35;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r * (1.3 - f.t / f.max * 0.5), 0, TAU);
    ctx.fill();
  }
  for (const pt of G.particles) {
    ctx.globalAlpha = U.clamp(pt.life / pt.maxLife, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

function drawWorldTexts() {
  ctx.textAlign = 'center';
  for (const t of G.texts) {
    ctx.globalAlpha = U.clamp(1 - t.t / t.life, 0, 1);
    ctx.fillStyle = t.color;
    ctx.font = font(t.size);
    ctx.fillText(t.str, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

// ── HUD ──

function drawHUD() {
  const p = G.player;
  if (!p) return;
  ctx.textAlign = 'left';
  // health pips
  for (let i = 0; i < p.maxHp; i++) {
    const x = 16 + i * 18;
    if (i < p.hp) {
      ctx.fillStyle = p.hp <= 2 && Math.sin(G.time * 8) > 0 ? '#fde047' : '#ef4444';
      ctx.fillRect(x, 14, 14, 20);
    } else {
      ctx.strokeStyle = '#44403c';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, 14, 14, 20);
    }
  }
  // experience toward the next boon
  ctx.fillStyle = '#1c1408';
  ctx.fillRect(16, 38, 130, 4);
  ctx.fillStyle = '#a3e635';
  ctx.fillRect(16, 38, 130 * U.clamp(G.xp / G.xpNeed, 0, 1), 4);
  ctx.font = font(11);
  ctx.fillStyle = '#a3e635';
  ctx.fillText('LV ' + G.plvl, 152, 44);
  // weapon + powder
  const gun = p.guns[p.gunIndex];
  const W = WEAPONS[gun.id];
  ctx.fillStyle = W.color;
  ctx.fillRect(16, 46, 10, 10);
  ctx.font = font(14);
  ctx.fillStyle = '#f5e9d0';
  const ammoStr = gun.ammo === Infinity ? '∞' : String(gun.ammo);
  ctx.fillText(W.name + '  ' + ammoStr, 34, 56);
  if (gun.ammo !== Infinity) {
    ctx.fillStyle = '#2a1f13';
    ctx.fillRect(16, 62, 130, 4);
    ctx.fillStyle = W.color;
    ctx.fillRect(16, 62, 130 * U.clamp(gun.ammo / W.ammo, 0, 1), 4);
  }
  // weapon slots
  for (let i = 0; i < p.guns.length; i++) {
    const x = 16 + i * 22, y = 74;
    const Wi = WEAPONS[p.guns[i].id];
    ctx.globalAlpha = i === p.gunIndex ? 1 : 0.45;
    ctx.strokeStyle = Wi.color;
    ctx.lineWidth = i === p.gunIndex ? 2 : 1;
    ctx.strokeRect(x, y, 17, 17);
    ctx.fillStyle = Wi.color;
    ctx.font = font(10);
    ctx.fillText(String(i + 1), x + 6, y + 12);
  }
  ctx.globalAlpha = 1;
  // collected treasures
  let ix = 16;
  for (const id in p.itemCounts) {
    const it = Ent.ITEMS[id];
    ctx.fillStyle = it.color;
    ctx.fillRect(ix, 98, 8, 8);
    ctx.font = font(11);
    ctx.fillStyle = '#a8a29e';
    ctx.fillText('x' + p.itemCounts[id], ix + 11, 106);
    ix += 36;
  }
  // isle / gold
  ctx.font = font(14);
  ctx.fillStyle = '#7dd3fc';
  ctx.fillText('ISLE ' + G.floor, 16, 126);
  ctx.fillStyle = '#fbbf24'; // a doubloon next to the count
  ctx.beginPath(); ctx.arc(106, 121, 5, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#a16207';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(106, 121, 5, 0, TAU); ctx.stroke();
  ctx.fillText(String(G.credits), 116, 126);
  // hints / mute
  ctx.font = font(11, '');
  ctx.fillStyle = '#57534e';
  ctx.textAlign = 'right';
  ctx.fillText((Sfx.muted ? 'MUTED · ' : '') + '[M]ute  [P]ause', VW - 14, VH - 12);
  ctx.textAlign = 'left';
}

function drawMinimap() {
  const lvl = G.level;
  if (!lvl) return;
  const CWp = 17, CHp = 13;
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  for (const r of lvl.rooms) {
    mnx = Math.min(mnx, r.gx); mxx = Math.max(mxx, r.gx);
    mny = Math.min(mny, r.gy); mxy = Math.max(mxy, r.gy);
  }
  const w = (mxx - mnx + 1) * CWp + 12, h = (mxy - mny + 1) * CHp + 12;
  const ox = VW - w - 14, oy = 14;
  ctx.fillStyle = 'rgba(12,10,5,0.8)';
  ctx.fillRect(ox, oy, w, h);
  ctx.strokeStyle = '#44403c';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox, oy, w, h);
  const cx = (r) => ox + 6 + (r.gx - mnx) * CWp + 6.5;
  const cy = (r) => oy + 6 + (r.gy - mny) * CHp + 4.5;
  ctx.strokeStyle = '#57534e';
  for (const [a, b] of lvl.edges) {
    const ra = lvl.rooms[a], rb = lvl.rooms[b];
    if (!(ra.visited || ra.seen) || !(rb.visited || rb.seen)) continue;
    ctx.beginPath();
    ctx.moveTo(cx(ra), cy(ra));
    ctx.lineTo(cx(rb), cy(rb));
    ctx.stroke();
  }
  const cur = MapGen.roomAt(lvl, G.player.x, G.player.y);
  for (const r of lvl.rooms) {
    if (!r.visited && !r.seen) continue;
    const x = ox + 6 + (r.gx - mnx) * CWp, y = oy + 6 + (r.gy - mny) * CHp;
    if (r.visited) {
      ctx.fillStyle = cur && cur.idx === r.idx ? '#4a3b22' : '#2a2218';
      ctx.fillRect(x, y, 13, 9);
      if (cur && cur.idx === r.idx) {
        ctx.strokeStyle = '#fde68a';
        ctx.strokeRect(x, y, 13, 9);
      }
    } else {
      ctx.strokeStyle = '#2a2218';
      ctx.strokeRect(x, y, 13, 9);
    }
    const mx = x + 6.5, my = y + 4.5;
    if (r.type === 'treasure' && G.pedestal && !G.pedestal.taken) {
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(mx, my - 3); ctx.lineTo(mx + 3, my); ctx.lineTo(mx, my + 3); ctx.lineTo(mx - 3, my);
      ctx.fill();
    } else if (r.type === 'exit' || r.type === 'boss') {
      ctx.strokeStyle = r.type === 'boss' ? '#ef4444' : '#fbbf24'; // X marks the spot
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx - 2.5, my - 2.5); ctx.lineTo(mx + 2.5, my + 2.5);
      ctx.moveTo(mx + 2.5, my - 2.5); ctx.lineTo(mx - 2.5, my + 2.5);
      ctx.stroke();
    } else if (r.type === 'medbay') {
      ctx.fillStyle = '#b45309'; // rum stash
      ctx.fillRect(mx - 1.5, my - 2.5, 3, 5);
    }
  }
}

function drawBossBar() {
  const b = G.boss;
  if (!b || b.dead || b.warp > 0) return;
  const w = Math.min(420, VW - 200), x = (VW - w) / 2, y = 22;
  ctx.textAlign = 'center';
  ctx.font = font(13);
  ctx.fillStyle = '#fde68a';
  ctx.fillText('TIKI COLOSSUS', VW / 2, y - 5);
  ctx.fillStyle = '#451a03';
  ctx.fillRect(x, y, w, 10);
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(x, y, w * U.clamp(b.hp / b.maxHp, 0, 1), 10);
  ctx.strokeStyle = '#a16207';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, 10);
  ctx.textAlign = 'left';
}

function drawBanner() {
  const bn = G.banner;
  if (!bn) return;
  const a = bn.t < 0.25 ? bn.t / 0.25 : bn.t > bn.life - 0.5 ? (bn.life - bn.t) / 0.5 : 1;
  ctx.globalAlpha = U.clamp(a, 0, 1);
  ctx.textAlign = 'center';
  ctx.font = font(34);
  ctx.fillStyle = '#fde68a';
  ctx.shadowColor = '#f59e0b';
  ctx.shadowBlur = 18;
  ctx.fillText(bn.str, VW / 2, VH * 0.24);
  ctx.shadowBlur = 0;
  if (bn.sub) {
    ctx.font = font(15);
    ctx.fillStyle = '#d6b25c';
    ctx.fillText(bn.sub, VW / 2, VH * 0.24 + 28);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

// the treasure title card: slams in, shines, lingers
function drawSplash() {
  const s = G.splash;
  if (!s) return;
  const it = Ent.ITEMS[s.id];
  const t = s.t;
  const inT = U.clamp(t / 0.22, 0, 1);
  const out = t > 1.9 ? U.clamp((2.4 - t) / 0.5, 0, 1) : 1;
  const a = inT * out;
  const scale = 1 + (1 - inT) * (1 - inT) * 1.6; // slam from large
  const cy = VH * 0.6;
  ctx.fillStyle = 'rgba(10,7,2,' + 0.6 * a + ')'; // banner band
  ctx.fillRect(0, cy - 52, VW, 104);
  ctx.fillStyle = 'rgba(251,191,36,' + 0.5 * a + ')';
  ctx.fillRect(0, cy - 52, VW, 2);
  ctx.fillRect(0, cy + 50, VW, 2);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(VW / 2, cy);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  const name = it.name + (s.count > 1 ? '  x' + s.count : '');
  ctx.save(); // relic icon above the name
  ctx.translate(0, -30);
  ctx.scale(1.4, 1.4);
  ctx.shadowColor = it.color;
  ctx.shadowBlur = 12;
  Ent.ITEMS && (function () {
    ctx.strokeStyle = '#a16207';
    ctx.fillStyle = '#1a130a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill(); ctx.stroke();
  })();
  ctx.restore();
  ctx.save();
  ctx.translate(0, -30);
  ctx.scale(1.4, 1.4);
  Ent.drawItemGlyph ? Ent.drawItemGlyph(ctx, s.id, it.color) : null;
  ctx.restore();
  ctx.font = font(30);
  ctx.fillStyle = it.color;
  ctx.shadowColor = it.color;
  ctx.shadowBlur = 22;
  ctx.fillText(name, 0, 8);
  if (t > 0.22 && t < 0.6) { // shine flash over the name
    ctx.globalAlpha = a * (1 - (t - 0.22) / 0.38);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, 0, 8);
    ctx.globalAlpha = a;
  }
  ctx.shadowBlur = 0;
  ctx.font = font(14);
  ctx.fillStyle = '#f5e9d0';
  ctx.fillText(it.desc, 0, 30);
  if (s.count > 1) {
    ctx.fillStyle = '#d6b25c';
    ctx.fillText('stacked: ' + it.stack, 0, 46);
  }
  ctx.restore();
  ctx.textAlign = 'left';
}

function drawLevelUp() {
  ctx.fillStyle = 'rgba(4,6,3,0.7)';
  ctx.fillRect(0, 0, VW, VH);
  ctx.textAlign = 'center';
  ctx.font = font(34);
  ctx.fillStyle = '#fde68a';
  ctx.shadowColor = '#f59e0b';
  ctx.shadowBlur = 20;
  ctx.fillText('LEVEL ' + G.plvl + ' — CHOOSE A BOON', VW / 2, VH * 0.3);
  ctx.shadowBlur = 0;
  ctx.font = font(13, '');
  ctx.fillStyle = '#a8a29e';
  ctx.fillText('click a card, or press 1 / 2 / 3', VW / 2, VH * 0.3 + 26);
  const rects = lvlCardRects();
  for (let i = 0; i < 3; i++) {
    const o = G.lvlChoices[i];
    if (!o) continue;
    const r = rects[i];
    const hover = Input.mx >= r.x && Input.mx <= r.x + r.w && Input.my >= r.y && Input.my <= r.y + r.h;
    const lift = hover ? -6 : 0;
    ctx.fillStyle = hover ? '#241a0e' : '#1a130a';
    ctx.strokeStyle = hover ? o.color : '#a16207';
    ctx.lineWidth = hover ? 3 : 2;
    ctx.fillRect(r.x, r.y + lift, r.w, r.h);
    ctx.strokeRect(r.x, r.y + lift, r.w, r.h);
    ctx.fillStyle = o.color;
    ctx.fillRect(r.x + r.w / 2 - 14, r.y + lift + 18, 28, 8);
    ctx.font = font(16);
    ctx.fillStyle = '#f5e9d0';
    ctx.fillText(o.name, r.x + r.w / 2, r.y + lift + 56);
    ctx.font = font(13, '');
    ctx.fillStyle = '#d6b25c';
    ctx.fillText(o.desc, r.x + r.w / 2, r.y + lift + 80);
    ctx.font = font(12);
    ctx.fillStyle = '#78716c';
    ctx.fillText('[' + (i + 1) + ']', r.x + r.w / 2, r.y + lift + r.h - 12);
  }
  ctx.textAlign = 'left';
}

// ── overlays ──

function drawMenu() {
  ctx.textAlign = 'center';
  ctx.font = font(64);
  ctx.fillStyle = '#fbbf24';
  ctx.shadowColor = '#f59e0b';
  ctx.shadowBlur = 30;
  ctx.fillText('BLACKPOWDER ISLE', VW / 2, VH * 0.28);
  ctx.shadowBlur = 0;
  ctx.font = font(16);
  ctx.fillStyle = '#d6b25c';
  ctx.fillText('a pirate roguelike · plunder the jungle · delve ever deeper', VW / 2, VH * 0.28 + 34);
  ctx.font = font(14, '');
  ctx.fillStyle = '#a8a29e';
  const lines = [
    'WASD — move            MOUSE — aim',
    'LMB — fire / slash      SHIFT / SPACE — dive roll (i-frames)',
    'Q / WHEEL / 1-6 — swap weapon',
    'P — pause               M — mute',
    '',
    'vines snare the clearings shut until every beast is slain',
    'find the X · dig down · every 3rd isle wakes the TIKI COLOSSUS',
  ];
  lines.forEach((l, i) => ctx.fillText(l, VW / 2, VH * 0.44 + i * 22));
  if (G.best) {
    ctx.fillStyle = '#fbbf24';
    ctx.font = font(14);
    ctx.fillText('BEST VOYAGE · ISLE ' + G.best.floor + ' · ' + G.best.credits + ' gold · ' + G.best.kills + ' kills',
      VW / 2, VH * 0.44 + lines.length * 22 + 16);
  }
  ctx.font = font(20);
  ctx.fillStyle = '#4ade80';
  ctx.globalAlpha = 0.6 + 0.4 * Math.sin(G.time * 4);
  ctx.fillText('CLICK TO COME ASHORE', VW / 2, VH * 0.85);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function drawPause() {
  ctx.fillStyle = 'rgba(4,6,3,0.6)';
  ctx.fillRect(0, 0, VW, VH);
  ctx.textAlign = 'center';
  ctx.font = font(36);
  ctx.fillStyle = '#fde68a';
  ctx.fillText('PAUSED — ANCHORED', VW / 2, VH * 0.42);
  ctx.font = font(14, '');
  ctx.fillStyle = '#a8a29e';
  ctx.fillText('P / ESC to weigh anchor', VW / 2, VH * 0.42 + 32);
  ctx.textAlign = 'left';
}

function drawDead() {
  ctx.fillStyle = 'rgba(20,4,2,' + U.clamp(G.deadT, 0, 0.7) + ')';
  ctx.fillRect(0, 0, VW, VH);
  if (G.deadT < 0.5) return;
  ctx.textAlign = 'center';
  ctx.font = font(44);
  ctx.fillStyle = '#ef4444';
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur = 24;
  ctx.fillText('DEAD MEN TELL NO TALES', VW / 2, VH * 0.36);
  ctx.shadowBlur = 0;
  ctx.font = font(16);
  ctx.fillStyle = '#f5e9d0';
  const mins = Math.floor(G.runTime / 60), secs = Math.floor(G.runTime % 60);
  const tStr = mins + ':' + String(secs).padStart(2, '0');
  ctx.fillText('ISLE ' + G.floor + '   ·   ' + G.credits + ' gold   ·   ' + G.kills + ' kills   ·   ' + tStr,
    VW / 2, VH * 0.36 + 40);
  if (G.newBest) {
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('A NEW LEGEND IS WRIT', VW / 2, VH * 0.36 + 68);
  }
  if (G.deadT > 0.8) {
    ctx.font = font(18);
    ctx.fillStyle = '#4ade80';
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(G.time * 4);
    ctx.fillText('CLICK / R TO SET SAIL AGAIN', VW / 2, VH * 0.62);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'left';
}

function drawReticle() {
  const col = G.player && G.state !== 'menu' ? WEAPONS[G.player.guns[G.player.gunIndex].id].color : '#fbbf24';
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 1.5;
  const x = Input.mx, y = Input.my;
  ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 11, y); ctx.lineTo(x - 5, y);
  ctx.moveTo(x + 5, y); ctx.lineTo(x + 11, y);
  ctx.moveTo(x, y - 11); ctx.lineTo(x, y - 5);
  ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 11);
  ctx.stroke();
  ctx.fillRect(x - 1, y - 1, 2, 2);
}

// ── main loop ──

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  update(dt);
  render();
  Input.endFrame();
  requestAnimationFrame(frame);
}

Input.init(canvas);
requestAnimationFrame(frame);

// exposed for debugging / headless smoke tests
window.Game = { G, newRun, loadFloor, update, render, hurtPlayer };
