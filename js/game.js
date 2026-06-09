'use strict';
// game.js — main loop, player, combat, rooms, rendering, UI

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let VW = 0, VH = 0, stars = [], vignette = null;

function resize() {
  VW = canvas.width = window.innerWidth;
  VH = canvas.height = window.innerHeight;
  stars = [];
  for (let i = 0; i < 140; i++) stars.push({ x: U.rand(VW), y: U.rand(VH), z: U.rand(0.3, 1) });
  vignette = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.45, VW / 2, VH / 2, Math.max(VW, VH) * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
}
window.addEventListener('resize', resize);
resize();

const FLAVOR = [
  'derelict deck — hostiles active',
  'life support: nominal',
  'threat level rising',
  'no friendly signals detected',
  'reactor hum grows louder',
  'something moves in the dark',
];

const G = {
  state: 'menu', time: 0, runTime: 0, deadT: 0,
  floor: 1, credits: 0, kills: 0,
  level: null, player: null,
  enemies: [], pBullets: [], eBullets: [],
  particles: [], pickups: [], texts: [], flashes: [], trail: [],
  cam: { x: 0, y: 0 }, shake: 0, hurtFlash: 0,
  banner: null, boss: null, pedestal: null, weaponQueue: [],
  channel: 0, trans: null, best: null, newBest: false,
};
try { G.best = JSON.parse(localStorage.getItem('voidrunner_best')); } catch { G.best = null; }

// ── run / floor setup ──

function newRun() {
  G.floor = 1; G.credits = 0; G.kills = 0; G.runTime = 0; G.newBest = false;
  G.player = {
    x: 0, y: 0, r: 11, hp: 6, maxHp: 6, spd: 235,
    dashT: 0, dashCD: 0, dashCDMax: 0.95, dashDX: 1, dashDY: 0, invuln: 0, fireCD: 0,
    guns: [makeGun('pulse')], gunIndex: 0, aimAng: 0,
    moving: false, moveAng: 0,
    stats: { fireRate: 1, speed: 1, dashCD: 1, pierce: 0, bounce: 0 },
    itemCounts: {},
  };
  G.weaponQueue = U.shuffle(WEAPON_POOL);
  loadFloor(1);
  G.state = 'play';
}

function loadFloor(n) {
  G.floor = n;
  G.level = MapGen.generate(n);
  G.enemies = []; G.pBullets = []; G.eBullets = [];
  G.particles = []; G.pickups = []; G.texts = []; G.flashes = []; G.trail = [];
  G.boss = null; G.channel = 0;
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
  Ent.showBanner(G, 'SECTOR ' + n, G.level.isBoss ? '!! WARDEN SIGNATURE DETECTED !!' : U.pick(FLAVOR));
}

function screenToWorld(sx, sy) { return { x: sx + G.cam.x, y: sy + G.cam.y }; }

// ── update ──

function update(dt) {
  G.time += dt;
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
  updatePickups(dt);
  pedestalLogic();
  exitLogic(dt);
  updateFx(dt);
  camera(dt);
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
    Sfx.dash();
  }

  let vx, vy;
  if (p.dashT > 0) {
    p.dashT -= dt;
    vx = p.dashDX * 640; vy = p.dashDY * 640;
    G.trail.push({ x: p.x, y: p.y, t: 0.22 });
    if (G.trail.length > 24) G.trail.shift();
  } else {
    const spd = p.spd * p.stats.speed;
    vx = ix * spd; vy = iy * spd;
  }
  p.moving = vx !== 0 || vy !== 0;
  if (p.moving) p.moveAng = Math.atan2(vy, vx);
  MapGen.moveEntity(G.level, p, vx * dt, vy * dt);

  // weapon switching: Q / wheel / number keys
  let gi = p.gunIndex;
  if (Input.hit('KeyQ')) gi++;
  gi += Input.wheel;
  for (let n = 1; n <= 5; n++)
    if (Input.hit('Digit' + n) && p.guns[n - 1]) gi = n - 1;
  gi = ((gi % p.guns.length) + p.guns.length) % p.guns.length;
  if (gi !== p.gunIndex) { p.gunIndex = gi; Sfx.click(); }

  // firing
  const gun = p.guns[p.gunIndex];
  const W = WEAPONS[gun.id];
  if (Input.down && p.fireCD <= 0 && p.dashT <= 0) {
    if (gun.ammo <= 0) {
      p.fireCD = 0.3; Sfx.click();
    } else {
      p.fireCD = 1 / (W.rate * p.stats.fireRate);
      const mzx = p.x + Math.cos(p.aimAng) * (p.r + 8);
      const mzy = p.y + Math.sin(p.aimAng) * (p.r + 8);
      const pierceLeft = (W.pierce || 0) + p.stats.pierce;
      for (let i = 0; i < W.pellets; i++) {
        const a = p.aimAng + U.rand(-W.spread, W.spread);
        G.pBullets.push({
          x: mzx, y: mzy, vx: Math.cos(a) * W.spd, vy: Math.sin(a) * W.spd,
          dmg: W.dmg, r: W.size, life: W.life, color: W.color,
          pierceLeft, bounceLeft: p.stats.bounce,
          rail: !!W.pierce, boom: W.boom || 0, boomDmg: W.boomDmg || 0,
          hit: pierceLeft > 0 ? new Set() : null, dead: false,
        });
      }
      Ent.burst(G, mzx, mzy, W.color, 3, 90, 0.15, 2);
      Sfx.shoot(W.sfx);
      G.shake = Math.max(G.shake, W.boom ? 2.5 : W.pierce ? 3 : 1.2);
      if (gun.ammo !== Infinity) {
        gun.ammo--;
        if (gun.ammo <= 0) {
          Sfx.deplete();
          Ent.addText(G, p.x, p.y - 20, 'AMMO DEPLETED', '#f87171');
          p.gunIndex = 0;
        }
      }
    }
  }
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
  if (p.hp <= 0) die();
}

function die() {
  G.state = 'dead';
  G.deadT = 0;
  Sfx.boom(true);
  Ent.burst(G, G.player.x, G.player.y, '#4ade80', 36, 300, 0.9, 4);
  Ent.burst(G, G.player.x, G.player.y, '#ffffff', 16, 180, 0.5, 3);
  G.flashes.push({ x: G.player.x, y: G.player.y, r: 120, t: 0.3, max: 0.3, color: '#4ade80' });
  const b = G.best;
  if (!b || G.floor > b.floor || (G.floor === b.floor && G.credits > b.credits)) {
    G.best = { floor: G.floor, credits: G.credits, kills: G.kills };
    G.newBest = true;
    try { localStorage.setItem('voidrunner_best', JSON.stringify(G.best)); } catch { /* storage unavailable */ }
  }
}

// ── rooms: lockdown + clear ──

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
      for (const b of G.eBullets) Ent.burst(G, b.x, b.y, '#94a3b8', 2, 60, 0.25, 2);
      G.eBullets.length = 0;
      if (r.type !== 'boss') { // Isaac-style clear reward: sometimes a stat upgrade
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
    const e = Ent.spawn(G, 'warden', room.cx, (room.y + room.h * 0.3) * TILE, room.idx);
    e.warp = 1.2;
    G.boss = e;
    Ent.showBanner(G, 'THE WARDEN', 'sector guardian — destroy it');
  } else {
    let budget = 4 + Math.round(G.floor * 1.9);
    const kinds = ['skitter', 'drone'];
    if (G.floor >= 2) kinds.push('turret');
    if (G.floor >= 3) kinds.push('charger');
    if (G.floor >= 4) kinds.push('gunner', 'splitter');
    if (G.floor >= 5) kinds.push('orbiter', 'skitter');
    if (G.floor >= 6) kinds.push('sniper');
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
    }
  }
  G.pBullets = G.pBullets.filter((b) => !b.dead);
}

function updateEBullets(dt) {
  const lvl = G.level, p = G.player;
  for (const b of G.eBullets) {
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
    const rr = b.r + p.r * 0.7; // forgiving hitbox vs bullets
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
  for (const e of G.enemies) {
    if (e.warp > 0) continue;
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

// ── pickups / pedestal / exit ──

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
        const it = Ent.ITEMS[pk.val];
        it.apply(p);
        p.itemCounts[pk.val] = (p.itemCounts[pk.val] || 0) + 1;
        Sfx.weaponGet();
        Ent.showBanner(G, it.name, it.desc);
        Ent.burst(G, pk.x, pk.y, it.color, 16, 160, 0.5, 3);
      } else if (pk.kind === 'credit') {
        G.credits += pk.val;
        Ent.addText(G, pk.x, pk.y - 10, '+' + pk.val + '¢', '#fbbf24', 12);
      } else if (pk.kind === 'cell') {
        let any = false;
        for (const g of p.guns) {
          const W = WEAPONS[g.id];
          if (W.ammo === Infinity) continue;
          g.ammo = Math.min(W.ammo, g.ammo + Math.ceil(W.ammo * 0.35));
          any = true;
        }
        if (!any) G.credits += 2;
        Ent.addText(G, pk.x, pk.y - 10, any ? '+ENERGY' : '+2¢', '#38bdf8', 12);
      } else if (pk.kind === 'heart') {
        p.hp = Math.min(p.maxHp, p.hp + 1);
        Ent.addText(G, pk.x, pk.y - 10, '+1 HULL', '#f87171', 12);
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
    Ent.burst(G, pd.x, pd.y, '#e0f2fe', 18, 180, 0.6, 3);
    if (pd.weaponId) {
      p.guns.push(makeGun(pd.weaponId));
      p.gunIndex = p.guns.length - 1;
      Ent.showBanner(G, WEAPONS[pd.weaponId].name + ' ACQUIRED', 'press Q / wheel / 1-' + p.guns.length + ' to swap');
    } else {
      G.credits += 8;
      for (const g of p.guns) {
        const W = WEAPONS[g.id];
        if (W.ammo !== Infinity) g.ammo = W.ammo;
      }
      Ent.showBanner(G, 'SUPPLY CACHE', '+8¢ — energy restored');
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
  ctx.fillStyle = '#05060a';
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
  drawGates();
  drawPedestal();
  for (const pk of G.pickups) Ent.drawPickup(ctx, G, pk);
  for (const e of G.enemies) Ent.drawEnemy(ctx, G, e);
  if (G.state !== 'dead') Ent.drawPlayer(ctx, G);
  drawBullets();
  drawFx();
  drawWorldTexts();
  if (G.channel > 0 && G.state === 'play') { // teleport channel bar
    const p = G.player;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(p.x - 22, p.y - p.r - 16, 44, 5);
    ctx.fillStyle = '#a78bfa';
    ctx.fillRect(p.x - 22, p.y - p.r - 16, 44 * U.clamp(G.channel / 0.9, 0, 1), 5);
  }
  ctx.restore();

  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, VW, VH);
  if (G.hurtFlash > 0) {
    ctx.fillStyle = 'rgba(244,63,94,' + (G.hurtFlash * 0.5) + ')';
    ctx.fillRect(0, 0, VW, VH);
  }

  drawHUD();
  drawMinimap();
  drawBossBar();
  drawBanner();

  if (G.state === 'pause') drawPause();
  if (G.state === 'dead') drawDead();
  if (G.state === 'trans') {
    const t = G.trans.t;
    ctx.fillStyle = 'rgba(2,3,6,' + U.clamp(t < 0.5 ? t * 2 : (1 - t) * 2, 0, 1) + ')';
    ctx.fillRect(0, 0, VW, VH);
  }
  drawReticle();
}

function drawStars() {
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, VW, VH);
  for (const s of stars) {
    const x = (s.x + G.time * 8 * s.z) % VW;
    ctx.globalAlpha = 0.3 + s.z * 0.5;
    ctx.fillStyle = s.z > 0.8 ? '#7dd3fc' : '#475569';
    ctx.fillRect(x, s.y, s.z * 2, s.z * 2);
  }
  ctx.globalAlpha = 1;
}

const FLOOR_TINT = { // subtle per-room-type deck coloring
  start: '#0e1322', combat: '#0d111b', treasure: '#15110a',
  medbay: '#0b1410', exit: '#120d1f', boss: '#140d20',
};

function drawTiles() {
  const lvl = G.level;
  const tx0 = Math.max(0, Math.floor(G.cam.x / TILE) - 1);
  const ty0 = Math.max(0, Math.floor(G.cam.y / TILE) - 1);
  const tx1 = Math.min(lvl.W - 1, Math.ceil((G.cam.x + VW) / TILE) + 1);
  const ty1 = Math.min(lvl.H - 1, Math.ceil((G.cam.y + VH) / TILE) + 1);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const v = lvl.grid[ty * lvl.W + tx];
      const px = tx * TILE, py = ty * TILE;
      if (v === T_FLOOR || v === T_EXIT || v === T_CRATE) {
        const h = U.hash2(tx, ty);
        const ri = lvl.roomOf[ty * lvl.W + tx];
        const base = ri >= 0 ? (FLOOR_TINT[lvl.rooms[ri].type] || '#0d111b') : '#0b0d13';
        ctx.fillStyle = h < 0.1 ? '#0a0e16' : base;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#0a0d14'; // panel seams
        ctx.fillRect(px + TILE - 1, py, 1, TILE);
        ctx.fillRect(px, py + TILE - 1, TILE, 1);
        if (h >= 0.1 && h < 0.13) { // vent slits
          ctx.fillStyle = '#090c13';
          for (let i = 0; i < 3; i++) ctx.fillRect(px + 8, py + 9 + i * 6, 16, 2);
        } else if (h < 0.03) { // deck light
          ctx.fillStyle = '#13265e';
          ctx.fillRect(px + 13, py + 13, 6, 6);
          ctx.fillStyle = '#2563eb';
          ctx.fillRect(px + 14.5, py + 14.5, 3, 3);
        }
        if (v === T_EXIT) {
          ctx.fillStyle = '#160b2e';
          ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
        }
        if (v === T_CRATE) {
          const hp = lvl.crates.get(tx + ',' + ty) || 0;
          ctx.fillStyle = '#222c42';
          ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px + 3, py + 3, TILE - 6, TILE - 6);
          ctx.strokeStyle = '#3b4863';
          ctx.beginPath();
          ctx.moveTo(px + 3, py + 3); ctx.lineTo(px + TILE - 3, py + TILE - 3);
          ctx.moveTo(px + TILE - 3, py + 3); ctx.lineTo(px + 3, py + TILE - 3);
          ctx.stroke();
          if (hp < 3) { // cracks
            ctx.strokeStyle = '#94a3b8';
            ctx.beginPath();
            ctx.moveTo(px + 8, py + 6); ctx.lineTo(px + 14, py + 16); ctx.lineTo(px + 10, py + 25);
            if (hp < 2) { ctx.moveTo(px + 24, py + 8); ctx.lineTo(px + 18, py + 18); }
            ctx.stroke();
          }
        }
      } else if (v === T_WALL) {
        ctx.fillStyle = '#161e2e';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#3d5996'; // edge highlight facing floor
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
      }
    }
  }
}

function drawPad() {
  const lvl = G.level;
  const c = lvl.padCenter;
  const active = lvl.rooms[lvl.exitIdx].cleared;
  const col = active ? '#a78bfa' : '#475569';
  ctx.save();
  ctx.translate(c.x, c.y);
  if (active) { ctx.shadowColor = col; ctx.shadowBlur = 16; }
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + (active ? G.time * 0.6 : 0);
    const px = Math.cos(a) * 24, py = Math.sin(a) * 24;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  if (active) {
    const rr = 6 + ((G.time * 26) % 20);
    ctx.globalAlpha = 1 - rr / 26;
    ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(0, 0, 4 + Math.sin(G.time * 5) * 1.5, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawGates() {
  const lvl = G.level;
  for (const r of lvl.rooms) {
    if (!r.locked) continue;
    for (const grp of r.gates) {
      for (const g of grp) {
        const px = g.x * TILE, py = g.y * TILE;
        const pulse = 0.3 + 0.18 * Math.sin(G.time * 8 + g.x + g.y);
        ctx.fillStyle = 'rgba(244,63,94,' + pulse + ')';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = 'rgba(254,205,211,0.8)';
        for (let i = 0; i < 3; i++) {
          const off = ((G.time * 40 + i * 11 + g.x * 7) % TILE);
          ctx.fillRect(px, py + off, TILE, 2);
        }
      }
    }
  }
}

function drawPedestal() {
  const pd = G.pedestal;
  if (!pd || pd.taken) return;
  ctx.save();
  ctx.translate(pd.x, pd.y);
  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 8, 16, 7, 0, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillRect(-7, -4, 14, 12);
  const bob = Math.sin(G.time * 2.4) * 3;
  ctx.translate(0, -16 + bob);
  ctx.rotate(Math.sin(G.time * 1.2) * 0.18);
  if (pd.weaponId) {
    const W = WEAPONS[pd.weaponId];
    ctx.shadowColor = W.color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#28324a';
    ctx.fillRect(-10, -4, 20, 8);
    ctx.fillStyle = W.color;
    ctx.fillRect(6, -3, 8, 6);
    ctx.fillRect(-10, 2, 6, 5);
  } else {
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#3b2f03';
    ctx.strokeStyle = '#fbbf24';
    ctx.fillRect(-8, -8, 16, 16);
    ctx.strokeRect(-8, -8, 16, 16);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(-1.5, -5, 3, 10);
    ctx.fillRect(-5, -1.5, 10, 3);
  }
  ctx.restore();
  if (U.dist(G.player.x, G.player.y, pd.x, pd.y) < 140) {
    ctx.fillStyle = '#e0f2fe';
    ctx.font = font(12);
    ctx.textAlign = 'center';
    ctx.fillText(pd.weaponId ? WEAPONS[pd.weaponId].name : 'SUPPLY CACHE', pd.x, pd.y - 38);
  }
}

function drawBullets() {
  ctx.globalCompositeOperation = 'lighter';
  for (const b of G.pBullets) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2.2, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    if (b.rail) { // rail slug: elongated streak
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
  for (const b of G.eBullets) {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2.4, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff1f2';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.45, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
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
  // hull pips
  for (let i = 0; i < p.maxHp; i++) {
    const x = 16 + i * 18;
    if (i < p.hp) {
      ctx.fillStyle = p.hp <= 2 && Math.sin(G.time * 8) > 0 ? '#f87171' : '#4ade80';
      ctx.fillRect(x, 14, 14, 20);
    } else {
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, 14, 14, 20);
    }
  }
  // weapon + ammo
  const gun = p.guns[p.gunIndex];
  const W = WEAPONS[gun.id];
  ctx.fillStyle = W.color;
  ctx.fillRect(16, 46, 10, 10);
  ctx.font = font(14);
  ctx.fillStyle = '#e2e8f0';
  const ammoStr = gun.ammo === Infinity ? '∞' : String(gun.ammo);
  ctx.fillText(W.name + '  ' + ammoStr, 34, 56);
  if (gun.ammo !== Infinity) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(16, 62, 130, 4);
    ctx.fillStyle = W.color;
    ctx.fillRect(16, 62, 130 * U.clamp(gun.ammo / W.ammo, 0, 1), 4);
  }
  // gun slots
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
  // collected stat upgrades
  let ix = 16;
  for (const id in p.itemCounts) {
    const it = Ent.ITEMS[id];
    ctx.fillStyle = it.color;
    ctx.fillRect(ix, 98, 8, 8);
    ctx.font = font(11);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('x' + p.itemCounts[id], ix + 11, 106);
    ix += 36;
  }
  // sector / credits
  ctx.font = font(14);
  ctx.fillStyle = '#7dd3fc';
  ctx.fillText('SECTOR ' + G.floor, 16, 126);
  ctx.fillStyle = '#fbbf24';
  ctx.fillText('¢ ' + G.credits, 130, 126);
  // hints / mute
  ctx.font = font(11, '');
  ctx.fillStyle = '#475569';
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
  ctx.fillStyle = 'rgba(8,10,16,0.8)';
  ctx.fillRect(ox, oy, w, h);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox, oy, w, h);
  const cx = (r) => ox + 6 + (r.gx - mnx) * CWp + 6.5;
  const cy = (r) => oy + 6 + (r.gy - mny) * CHp + 4.5;
  ctx.strokeStyle = '#334155';
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
      ctx.fillStyle = cur && cur.idx === r.idx ? '#3b5a8c' : '#243049';
      ctx.fillRect(x, y, 13, 9);
      if (cur && cur.idx === r.idx) {
        ctx.strokeStyle = '#7dd3fc';
        ctx.strokeRect(x, y, 13, 9);
      }
    } else {
      ctx.strokeStyle = '#243049';
      ctx.strokeRect(x, y, 13, 9);
    }
    const mx = x + 6.5, my = y + 4.5;
    if (r.type === 'treasure' && G.pedestal && !G.pedestal.taken) {
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(mx, my - 3); ctx.lineTo(mx + 3, my); ctx.lineTo(mx, my + 3); ctx.lineTo(mx - 3, my);
      ctx.fill();
    } else if (r.type === 'exit' || r.type === 'boss') {
      ctx.fillStyle = r.type === 'boss' ? '#f43f5e' : '#a78bfa';
      ctx.fillRect(mx - 2.5, my - 2.5, 5, 5);
    } else if (r.type === 'medbay') {
      ctx.fillStyle = '#f87171';
      ctx.fillRect(mx - 0.75, my - 2.5, 1.5, 5);
      ctx.fillRect(mx - 2.5, my - 0.75, 5, 1.5);
    }
  }
}

function drawBossBar() {
  const b = G.boss;
  if (!b || b.dead || b.warp > 0) return;
  const w = Math.min(420, VW - 200), x = (VW - w) / 2, y = 22;
  ctx.textAlign = 'center';
  ctx.font = font(13);
  ctx.fillStyle = '#c4b5fd';
  ctx.fillText('THE WARDEN', VW / 2, y - 5);
  ctx.fillStyle = '#1e1038';
  ctx.fillRect(x, y, w, 10);
  ctx.fillStyle = '#a78bfa';
  ctx.fillRect(x, y, w * U.clamp(b.hp / b.maxHp, 0, 1), 10);
  ctx.strokeStyle = '#6d28d9';
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
  ctx.fillStyle = '#e0f2fe';
  ctx.shadowColor = '#38bdf8';
  ctx.shadowBlur = 18;
  ctx.fillText(bn.str, VW / 2, VH * 0.24);
  ctx.shadowBlur = 0;
  if (bn.sub) {
    ctx.font = font(15);
    ctx.fillStyle = '#7dd3fc';
    ctx.fillText(bn.sub, VW / 2, VH * 0.24 + 28);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

// ── overlays ──

function drawMenu() {
  ctx.textAlign = 'center';
  ctx.font = font(64);
  ctx.fillStyle = '#7df9ff';
  ctx.shadowColor = '#22d3ee';
  ctx.shadowBlur = 30;
  ctx.fillText('VOIDRUNNER', VW / 2, VH * 0.3);
  ctx.shadowBlur = 0;
  ctx.font = font(16);
  ctx.fillStyle = '#7dd3fc';
  ctx.fillText('a sci-fi roguelike · clear the decks · descend forever', VW / 2, VH * 0.3 + 34);
  ctx.font = font(14, '');
  ctx.fillStyle = '#94a3b8';
  const lines = [
    'WASD — move          MOUSE — aim',
    'LMB — fire            SHIFT / SPACE — dash (i-frames)',
    'Q / WHEEL / 1-5 — swap weapon',
    'P — pause             M — mute',
    '',
    'rooms lock until hostiles are purged',
    'find the pad · descend · every 3rd sector holds a WARDEN',
  ];
  lines.forEach((l, i) => ctx.fillText(l, VW / 2, VH * 0.46 + i * 22));
  if (G.best) {
    ctx.fillStyle = '#fbbf24';
    ctx.font = font(14);
    ctx.fillText('BEST RUN · SECTOR ' + G.best.floor + ' · ¢' + G.best.credits + ' · ' + G.best.kills + ' kills',
      VW / 2, VH * 0.46 + lines.length * 22 + 16);
  }
  ctx.font = font(20);
  ctx.fillStyle = '#4ade80';
  ctx.globalAlpha = 0.6 + 0.4 * Math.sin(G.time * 4);
  ctx.fillText('CLICK TO DEPLOY', VW / 2, VH * 0.85);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function drawPause() {
  ctx.fillStyle = 'rgba(2,3,6,0.6)';
  ctx.fillRect(0, 0, VW, VH);
  ctx.textAlign = 'center';
  ctx.font = font(36);
  ctx.fillStyle = '#7dd3fc';
  ctx.fillText('PAUSED — SYSTEMS HELD', VW / 2, VH * 0.42);
  ctx.font = font(14, '');
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('P / ESC to resume', VW / 2, VH * 0.42 + 32);
  ctx.textAlign = 'left';
}

function drawDead() {
  ctx.fillStyle = 'rgba(20,2,8,' + U.clamp(G.deadT, 0, 0.7) + ')';
  ctx.fillRect(0, 0, VW, VH);
  if (G.deadT < 0.5) return;
  ctx.textAlign = 'center';
  ctx.font = font(44);
  ctx.fillStyle = '#f43f5e';
  ctx.shadowColor = '#f43f5e';
  ctx.shadowBlur = 24;
  ctx.fillText('RUN TERMINATED', VW / 2, VH * 0.36);
  ctx.shadowBlur = 0;
  ctx.font = font(16);
  ctx.fillStyle = '#e2e8f0';
  const mins = Math.floor(G.runTime / 60), secs = Math.floor(G.runTime % 60);
  const tStr = mins + ':' + String(secs).padStart(2, '0');
  ctx.fillText('SECTOR ' + G.floor + '   ·   ¢' + G.credits + '   ·   ' + G.kills + ' kills   ·   ' + tStr,
    VW / 2, VH * 0.36 + 40);
  if (G.newBest) {
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('NEW BEST RUN', VW / 2, VH * 0.36 + 68);
  }
  if (G.deadT > 0.8) {
    ctx.font = font(18);
    ctx.fillStyle = '#4ade80';
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(G.time * 4);
    ctx.fillText('CLICK / R TO REDEPLOY', VW / 2, VH * 0.62);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'left';
}

function drawReticle() {
  const col = G.player && G.state !== 'menu' ? WEAPONS[G.player.guns[G.player.gunIndex].id].color : '#7df9ff';
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
