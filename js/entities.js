'use strict';
// entities.js — enemies (AI + boss), items, damage, loot, pickups, particles, fx (global Ent)
// Theme: jungle island. Melee enemies are snakes; ranged enemies are dart-blowing tribesmen.

const Ent = (() => {
  const ENEMY_DEFS = {
    viper:       { hp: 2,   r: 9,  spd: 155, cost: 1, color: '#84cc16', credits: [1, 2] },
    tribesman:   { hp: 3,   r: 11, spd: 90,  cost: 2, color: '#facc15', credits: [1, 3] },
    totem:       { hp: 5,   r: 12, spd: 0,   cost: 2, color: '#fb923c', credits: [1, 3] },
    constrictor: { hp: 5,   r: 12, spd: 95,  cost: 3, color: '#d97706', credits: [2, 3] },
    hunter:      { hp: 7,   r: 13, spd: 62,  cost: 3, color: '#ef4444', credits: [2, 4] },
    brood:       { hp: 6,   r: 13, spd: 72,  cost: 3, color: '#a3e635', credits: [2, 3] },
    shaman:      { hp: 5,   r: 11, spd: 80,  cost: 3, color: '#4ade80', credits: [2, 4] },
    headhunter:  { hp: 4,   r: 11, spd: 70,  cost: 3, color: '#38bdf8', credits: [2, 4] },
    primate:     { hp: 4,   r: 11, spd: 110, cost: 3, color: '#a8a29e', credits: [2, 3] },
    archer:      { hp: 4,   r: 11, spd: 75,  cost: 3, color: '#f472b6', credits: [2, 4] },
    spearman:    { hp: 5,   r: 12, spd: 105, cost: 2, color: '#eab308', credits: [1, 3] },
    tiki:        { hp: 130, r: 30, spd: 55,  cost: 0, color: '#fbbf24', credits: [15, 25] },
  };

  // stackable passive treasures (Isaac-style): one at run start, chance on room
  // clear, guaranteed from bosses. Effects are read from player.itemCounts.
  const ITEMS = {
    voodoo: {
      name: 'VOODOO DOLL', color: '#a78bfa',
      desc: 'when ye take a hit, every foe in the room shares the pain',
      stack: '+2 shared damage per doll',
    },
    gunpowder: {
      name: 'GUNPOWDER', color: '#f97316',
      desc: '1-in-10 shots burst into shrapnel on impact',
      stack: '+8% chance, bigger blast',
    },
    spinach: {
      name: 'SPINACH', color: '#22c55e',
      desc: 'sword swings send foes flying',
      stack: 'even further',
    },
    gasoline: {
      name: 'GASOLINE', color: '#84cc16',
      desc: 'dive rolls leave a fuel trail — shoot it to ignite',
      stack: 'longer trail, hotter fire',
    },
    parrot: {
      name: 'POWDER PARROT', color: '#ef4444',
      desc: 'a loyal parrot dive-bombs nearby foes',
      stack: '+1 peck damage',
    },
    luckycoin: {
      name: 'LUCKY DOUBLOON', color: '#fbbf24',
      desc: 'foes drop gold far more often',
      stack: 'even luckier',
    },
    sharktooth: {
      name: 'SHARKTOOTH CHARM', color: '#e2e8f0',
      desc: 'kills may shake loose powder kegs',
      stack: '+ chance',
    },
    cannonball: {
      name: 'CANNONBALL', color: '#94a3b8',
      desc: 'dive rolling through foes damages them',
      stack: '+1 roll damage',
    },
  };
  const ITEM_IDS = Object.keys(ITEMS);

  // the player's uploaded pirate sprite, 8 rotations (fallback: vector pirate)
  const PLAYER_SPRITES = (typeof Image !== 'undefined') ? (() => {
    const names = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
    return names.map((n) => {
      const img = new Image();
      img.src = 'A_swashbuckling_pirate_standing_top/rotations/' + n + '.png';
      return img;
    });
  })() : null;

  let nextId = 1;

  function spawn(G, kind, x, y, roomIdx, warpDelay = 0) {
    const d = ENEMY_DEFS[kind];
    const hpScale = kind === 'tiki'
      ? 1 + 0.3 * (Math.floor(G.floor / 3) - 1)
      : 1 + 0.13 * (G.floor - 1);
    const hp = Math.ceil(d.hp * hpScale);
    const e = {
      id: nextId++, kind, x, y, r: d.r, hp, maxHp: hp,
      spd: d.spd, color: d.color, roomIdx,
      warp: 0.55 + warpDelay, t: U.rand(TAU), flash: 0, tele: 0,
      fireCD: U.rand(0.8, 1.6), kbx: 0, kby: 0,
      aim: U.rand(TAU), face: 0, burst: 0, atk: '', atkT: U.rand(0.6, 1.2),
      state: 'roam', stT: 0, cdx: 1, cdy: 0, lock: 0, h: 0,
      leapT: 0, leapSpd: 0, lastDash: -1,
      dir: U.chance(0.5) ? 1 : -1, dead: false,
    };
    G.enemies.push(e);
    return e;
  }

  function eShoot(G, x, y, ang, spd, opts = {}) {
    if (G.eBullets.length > 500) return;
    G.eBullets.push({
      x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      r: opts.r || 4, life: opts.life || 3.4, color: opts.color || '#facc15',
      orb: !!opts.orb, t: 0, dead: false,
    });
  }

  // ── enemy AI ──

  function update(G, e, dt) {
    e.t += dt;
    if (e.warp > 0) { e.warp -= dt; return; }
    if (e.flash > 0) e.flash -= dt;
    if (e.tele > 0) e.tele -= dt;
    const p = G.player, lvl = G.level;
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    let mx = 0, my = 0;
    e.fireCD -= dt;

    switch (e.kind) {
      case 'viper': { // fast snake, weaves as it slithers
        const a = Math.atan2(uy, ux) + Math.sin(e.t * 7) * 0.35;
        mx = Math.cos(a) * e.spd; my = Math.sin(a) * e.spd;
        break;
      }
      case 'tribesman': { // keeps range, single aimed blowgun darts
        const want = 175;
        const k = d > want + 30 ? 1 : d < want - 30 ? -1 : 0;
        const strafe = Math.sin(e.t * 1.7) * 0.8;
        mx = (ux * k - uy * strafe) * e.spd;
        my = (uy * k + ux * strafe) * e.spd;
        if (e.fireCD <= 0 && d < 430 && MapGen.raycastClear(lvl, e.x, e.y, p.x, p.y)) {
          eShoot(G, e.x + ux * (e.r + 4), e.y + uy * (e.r + 4),
            Math.atan2(uy, ux) + U.rand(-0.06, 0.06), 205 + Math.min(60, G.floor * 6));
          Sfx.eshoot();
          e.fireCD = U.rand(1.3, 1.9);
        }
        break;
      }
      case 'totem': { // carved sentinel, tracks and spits dart bursts
        const want = Math.atan2(uy, ux);
        e.aim += U.clamp(U.adiff(want, e.aim), -2.4 * dt, 2.4 * dt);
        if (e.burst > 0 && e.fireCD <= 0) {
          eShoot(G, e.x + Math.cos(e.aim) * (e.r + 6), e.y + Math.sin(e.aim) * (e.r + 6),
            e.aim, 240, { color: '#fb923c' });
          Sfx.eshoot();
          e.burst--; e.fireCD = 0.13;
        } else if (e.burst <= 0 && e.fireCD <= 0) {
          if (d < 470 && MapGen.raycastClear(lvl, e.x, e.y, p.x, p.y)) {
            e.burst = G.floor >= 5 ? 4 : 3;
            e.fireCD = 0.3;
          } else e.fireCD = 0.25;
        }
        break;
      }
      case 'constrictor': { // coils up, then strikes in a straight line
        if (e.state === 'charge') {
          const ox = e.x, oy = e.y;
          MapGen.moveEntity(lvl, e, e.cdx * 520 * dt, e.cdy * 520 * dt);
          e.stT -= dt;
          if (U.dist(ox, oy, e.x, e.y) < 520 * dt * 0.35 || e.stT <= 0) { // hit something / spent
            e.state = 'stun'; e.stT = 0.7;
            burst(G, e.x + e.cdx * e.r, e.y + e.cdy * e.r, e.color, 8, 160, 0.4, 3);
            G.shake = Math.max(G.shake, 3);
          }
          return;
        }
        if (e.state === 'stun') {
          e.stT -= dt;
          if (e.stT <= 0) e.state = 'roam';
          break;
        }
        if (e.state === 'tele') { // coiled, rattling
          e.stT -= dt;
          if (e.stT <= 0) {
            e.state = 'charge'; e.stT = 0.85;
            const a = Math.atan2(uy, ux);
            e.cdx = Math.cos(a); e.cdy = Math.sin(a); e.face = a;
            Sfx.dash();
          }
          break;
        }
        mx = ux * e.spd * 0.7; my = uy * e.spd * 0.7;
        if (e.fireCD <= 0 && d < 420 && d > 60 && MapGen.raycastClear(lvl, e.x, e.y, p.x, p.y)) {
          e.state = 'tele'; e.stT = 0.5; e.tele = 0.5;
          e.face = Math.atan2(uy, ux);
          e.fireCD = U.rand(2.2, 3.0);
        }
        break;
      }
      case 'hunter': { // shielded brute, hurls fans of javelins
        if (d > 215) { mx = ux * e.spd; my = uy * e.spd; }
        else {
          mx = -uy * e.dir * e.spd * 0.7;
          my = ux * e.dir * e.spd * 0.7;
          if (U.chance(0.005)) e.dir *= -1;
        }
        if (e.fireCD <= 0 && d < 420 && MapGen.raycastClear(lvl, e.x, e.y, p.x, p.y)) {
          const n = G.floor >= 6 ? 5 : 3;
          const base = Math.atan2(uy, ux);
          for (let i = 0; i < n; i++)
            eShoot(G, e.x, e.y, base + (i - (n - 1) / 2) * 0.21, 195, { color: '#f87171', r: 5 });
          Sfx.eshoot();
          e.fireCD = U.rand(1.8, 2.4);
        }
        break;
      }
      case 'brood': { // bloated python; the eggs hatch when it dies
        const a = Math.atan2(uy, ux) + Math.sin(e.t * 3) * 0.5;
        mx = Math.cos(a) * e.spd; my = Math.sin(a) * e.spd;
        break;
      }
      case 'shaman': { // circles you, casts rings of cursed bolts
        const oa = e.t * 0.9 * e.dir;
        const txp = p.x + Math.cos(oa) * 190, typ = p.y + Math.sin(oa) * 190;
        const dd = Math.hypot(txp - e.x, typ - e.y);
        if (dd > 6) { mx = (txp - e.x) / dd * e.spd; my = (typ - e.y) / dd * e.spd; }
        if (e.fireCD <= 0) {
          for (let i = 0; i < 8; i++)
            eShoot(G, e.x, e.y, (i / 8) * TAU + e.t, 150, { color: '#4ade80', orb: true });
          Sfx.eshoot();
          e.fireCD = U.rand(2.4, 3.0);
        }
        break;
      }
      case 'headhunter': { // far blowgunner: takes aim, then a fast precise dart
        if (d < 300) { mx = -ux * e.spd; my = -uy * e.spd; }
        else if (d > 480) { mx = ux * e.spd * 0.6; my = uy * e.spd * 0.6; }
        const los = d < 560 && MapGen.raycastClear(lvl, e.x, e.y, p.x, p.y);
        if (los && e.fireCD <= 0) {
          e.lock += dt / 1.1;
          if (e.lock >= 1) {
            eShoot(G, e.x + ux * (e.r + 4), e.y + uy * (e.r + 4),
              Math.atan2(uy, ux), 430, { color: '#38bdf8', r: 3.5 });
            Sfx.eshoot();
            e.lock = 0;
            e.fireCD = U.rand(1.6, 2.2);
          }
        } else {
          e.lock = Math.max(0, e.lock - dt * 2);
        }
        break;
      }
      case 'primate': { // lurks at the edge, then leaps on you suddenly
        if (e.state === 'leap') {
          e.stT -= dt;
          const k = 1 - Math.max(0, e.stT) / e.leapT;
          MapGen.moveEntity(lvl, e, e.cdx * e.leapSpd * dt, e.cdy * e.leapSpd * dt);
          e.h = Math.sin(Math.min(1, k) * Math.PI) * 24; // airborne arc (visual)
          if (e.stT <= 0) {
            e.state = 'recover'; e.stT = U.rand(0.9, 1.4); e.h = 0;
            burst(G, e.x, e.y, '#a8a29e', 8, 150, 0.4, 3);
            G.shake = Math.max(G.shake, 2);
          }
          return;
        }
        if (e.state === 'crouch') { // coiled to spring
          e.stT -= dt;
          if (e.stT <= 0) {
            e.state = 'leap';
            const txp = p.x + (p.moving ? Math.cos(p.moveAng) * 40 : 0); // leads your run
            const typ = p.y + (p.moving ? Math.sin(p.moveAng) * 40 : 0);
            const dd = Math.max(40, U.dist(e.x, e.y, txp, typ));
            e.leapT = U.clamp(dd / 480, 0.28, 0.6);
            e.stT = e.leapT;
            e.leapSpd = dd / e.leapT;
            const a = U.ang(e.x, e.y, txp, typ);
            e.cdx = Math.cos(a); e.cdy = Math.sin(a); e.face = a;
            Sfx.dash();
          }
          break; // crouched still
        }
        if (e.state === 'recover') {
          e.stT -= dt;
          if (e.stT <= 0) e.state = 'roam';
        }
        const wantD = 150;
        const k2 = d > wantD + 30 ? 1 : d < wantD - 30 ? -0.6 : 0;
        const strafe2 = Math.sin(e.t * 2.3) * 1.0;
        mx = (ux * k2 - uy * strafe2) * e.spd;
        my = (uy * k2 + ux * strafe2) * e.spd;
        if (e.state === 'roam' && e.fireCD <= 0 && d < 260 && d > 50 &&
            MapGen.raycastClear(lvl, e.x, e.y, p.x, p.y)) {
          e.state = 'crouch'; e.stT = 0.45; e.tele = 0.45;
          e.face = Math.atan2(uy, ux);
          e.fireCD = U.rand(2.0, 3.0);
        }
        break;
      }
      case 'archer': { // draws a bow, leads a moving target
        const wantA = 300;
        if (d < wantA - 60) { mx = -ux * e.spd; my = -uy * e.spd; }
        else if (d > wantA + 120) { mx = ux * e.spd * 0.7; my = uy * e.spd * 0.7; }
        else { mx = -uy * e.dir * e.spd * 0.4; my = ux * e.dir * e.spd * 0.4; }
        const losA = d < 540 && MapGen.raycastClear(lvl, e.x, e.y, p.x, p.y);
        if (losA && e.fireCD <= 0) {
          e.lock += dt / 0.8; // drawing
          mx *= 0.25; my *= 0.25;
          if (e.lock >= 1) {
            const tof = d / 300; // lead the shot at where you're headed
            const txp = p.x + (p.moving ? Math.cos(p.moveAng) * p.spd * p.stats.speed * tof * 0.5 : 0);
            const typ = p.y + (p.moving ? Math.sin(p.moveAng) * p.spd * p.stats.speed * tof * 0.5 : 0);
            const aa = U.ang(e.x, e.y, txp, typ);
            eShoot(G, e.x + Math.cos(aa) * (e.r + 4), e.y + Math.sin(aa) * (e.r + 4),
              aa, 300, { r: 4.5, life: 2.6, color: '#f87171' });
            Sfx.eshoot();
            e.lock = 0;
            e.fireCD = U.rand(1.6, 2.3);
          }
        } else {
          e.lock = Math.max(0, e.lock - dt * 2);
        }
        break;
      }
      case 'spearman': { // closes in, telegraphed spear thrust
        if (e.state === 'tele') {
          e.stT -= dt;
          if (e.stT <= 0) {
            e.state = 'stab'; e.stT = 0.5;
            eShoot(G, e.x + Math.cos(e.face) * e.r, e.y + Math.sin(e.face) * e.r,
              e.face, 460, { r: 5, life: 0.17, color: '#eab308' }); // the jab itself
            Sfx.eshoot();
          }
          break;
        }
        if (e.state === 'stab') {
          e.stT -= dt;
          if (e.stT <= 0) e.state = 'roam';
          break;
        }
        mx = ux * e.spd; my = uy * e.spd;
        if (e.fireCD <= 0 && d < 75) {
          e.state = 'tele'; e.stT = 0.32; e.tele = 0.32;
          e.face = Math.atan2(uy, ux);
          e.fireCD = U.rand(1.1, 1.6);
        }
        break;
      }
      case 'tiki':
        updateTiki(G, e, dt, d, ux, uy);
        return;
    }

    mx += e.kbx; my += e.kby;
    e.kbx *= Math.exp(-12 * dt);
    e.kby *= Math.exp(-12 * dt);
    if (mx || my) e.face = Math.atan2(my, mx);
    MapGen.moveEntity(lvl, e, mx * dt, my * dt);
  }

  // ── boss: the Tiki Colossus — telegraphed bullet-hell patterns ──

  function updateTiki(G, e, dt, d, ux, uy) {
    let mx = 0, my = 0;
    if (e.atk !== 'spiral') {
      const want = 230;
      const k = d > want + 40 ? 0.9 : d < want - 60 ? -0.7 : 0;
      const strafe = Math.sin(e.t * 0.8) * 0.6;
      mx = (ux * k - uy * strafe) * e.spd;
      my = (uy * k + ux * strafe) * e.spd;
    }
    mx += e.kbx; my += e.kby;
    e.kbx *= Math.exp(-10 * dt);
    e.kby *= Math.exp(-10 * dt);
    MapGen.moveEntity(G.level, e, mx * dt, my * dt);

    e.atkT -= dt;
    if (e.atk === '') {
      if (e.atkT <= 0) {
        const enraged = e.hp < e.maxHp * 0.5;
        const opts = ['radial', 'volley', 'spiral'];
        if (enraged) opts.push('summon', 'spiral');
        e.atk = U.pick(opts);
        e.tele = 0.45; e.atkT = 0.45; e.burst = 0;
      }
      return;
    }
    if (e.atkT > 0) return;

    switch (e.atk) {
      case 'radial': { // rings of burning embers
        const off = U.rand(TAU);
        const n = e.hp < e.maxHp * 0.5 ? 18 : 14;
        for (let i = 0; i < n; i++)
          eShoot(G, e.x, e.y, off + (i / n) * TAU, 165, { r: 5, color: '#fbbf24', orb: true });
        Sfx.eshoot();
        e.burst++;
        if (e.burst >= 3) { e.atk = ''; e.atkT = U.rand(1.0, 1.6); }
        else e.atkT = 0.55;
        break;
      }
      case 'volley': { // aimed spray of darts
        const base = Math.atan2(uy, ux);
        for (let i = -2; i <= 2; i++)
          eShoot(G, e.x, e.y, base + i * 0.13, 260, { color: '#f43f5e' });
        Sfx.eshoot();
        e.burst++;
        if (e.burst >= 3) { e.atk = ''; e.atkT = U.rand(0.9, 1.4); }
        else e.atkT = 0.4;
        break;
      }
      case 'spiral': { // rotating double-arm spiral of jungle fire
        e.spiralA = (e.spiralA === undefined ? U.rand(TAU) : e.spiralA) + 0.42;
        eShoot(G, e.x, e.y, e.spiralA, 150, { r: 4.5, color: '#84cc16', orb: true });
        eShoot(G, e.x, e.y, e.spiralA + Math.PI, 150, { r: 4.5, color: '#84cc16', orb: true });
        e.burst++;
        if (e.burst === 1 || e.burst % 6 === 0) Sfx.eshoot();
        if (e.burst >= 26) { e.atk = ''; e.atkT = U.rand(1.2, 1.8); e.spiralA = undefined; }
        else e.atkT = 0.07;
        break;
      }
      case 'summon': { // the island sends its children
        const minions = G.enemies.filter((o) => o.roomIdx === e.roomIdx && o.kind !== 'tiki' && !o.dead).length;
        for (let i = 0; i < Math.max(0, 3 - minions); i++) {
          const room = G.level.rooms[e.roomIdx];
          const pos = MapGen.randFloorInRoom(G.level, room,
            { awayFromX: G.player.x, awayFromY: G.player.y, minDist: TILE * 4 });
          if (pos) spawn(G, U.pick(['viper', 'viper', 'tribesman']), pos.x, pos.y, e.roomIdx, i * 0.15);
        }
        Sfx.gate();
        e.atk = ''; e.atkT = U.rand(1.4, 2.0);
        break;
      }
    }
  }

  // ── damage / death / loot ──

  function damageEnemy(G, e, dmg) {
    if (e.warp > 0 || e.dead) return;
    e.hp -= dmg;
    e.flash = 0.1;
    if (e.hp <= 0) {
      e.dead = true;
      G.kills++;
      Sfx.die();
      burst(G, e.x, e.y, e.color, 14, 200, 0.55, 3.5);
      burst(G, e.x, e.y, '#ffffff', 6, 120, 0.3, 2);
      if (e.kind === 'brood') {
        spawn(G, 'viper', e.x - 12, e.y + U.rand(-6, 6), e.roomIdx, 0.05);
        spawn(G, 'viper', e.x + 12, e.y + U.rand(-6, 6), e.roomIdx, 0.15);
        addText(G, e.x, e.y - 14, 'HATCHED!', '#a3e635', 12);
      }
      addXP(e.kind === 'tiki' ? 20 : (ENEMY_DEFS[e.kind].cost || 1));
      const st = (G.player && G.player.itemCounts.sharktooth) || 0; // sharktooth charm
      if (st && U.chance(0.08 * st)) spawnPickup(G, e.x, e.y, 'cell', 1);
      if (e.kind === 'tiki') onBossDeath(G, e);
      else dropLoot(G, e.x, e.y, 'enemy', e.kind);
    } else {
      Sfx.hit();
    }
  }

  function onBossDeath(G, e) {
    Sfx.bossDown();
    G.shake = Math.max(G.shake, 14);
    burst(G, e.x, e.y, '#fbbf24', 40, 320, 1.0, 5);
    burst(G, e.x, e.y, '#78716c', 26, 220, 0.8, 4); // stone rubble
    G.flashes.push({ x: e.x, y: e.y, r: 160, t: 0.35, max: 0.35, color: '#fbbf24' });
    const def = ENEMY_DEFS.tiki;
    const n = U.ri(def.credits[0], def.credits[1]);
    for (let i = 0; i < n; i++) spawnPickup(G, e.x + U.rand(-40, 40), e.y + U.rand(-40, 40), 'credit', 1);
    spawnPickup(G, e.x - 30, e.y, 'heart', 1);
    spawnPickup(G, e.x + 30, e.y, 'heart', 1);
    spawnPickup(G, e.x, e.y - 30, 'cell', 1);
    spawnPickup(G, e.x, e.y + 34, 'item', U.pick(ITEM_IDS)); // bosses always drop a treasure
    const p = G.player;
    p.maxHp = Math.min(12, p.maxHp + 1);
    p.hp = Math.min(p.maxHp, p.hp + 3);
    showBanner(G, 'COLOSSUS CRUMBLED', 'heartier +1 — the dig site is revealed');
    G.boss = null;
  }

  function dropLoot(G, x, y, table, kind) {
    const roll = Math.random();
    if (table === 'enemy') {
      const cr = ENEMY_DEFS[kind] ? ENEMY_DEFS[kind].credits : [1, 2];
      const luck = (G.player && G.player.itemCounts.luckycoin) || 0;
      const cChance = Math.min(0.32 + luck * 0.08, 0.75);
      if (roll < cChance) spawnPickup(G, x, y, 'credit', U.ri(cr[0], cr[1]));
      else if (roll < cChance + 0.12) spawnPickup(G, x, y, 'cell', 1);
      else if (roll < cChance + 0.2) spawnPickup(G, x, y, 'heart', 1);
    } else if (table === 'crate') {
      if (roll < 0.4) spawnPickup(G, x, y, 'credit', U.ri(1, 2));
      else if (roll < 0.58) spawnPickup(G, x, y, 'cell', 1);
      else if (roll < 0.7) spawnPickup(G, x, y, 'heart', 1);
    } else if (table === 'room') {
      if (roll < 0.6) spawnPickup(G, x, y, 'credit', U.ri(2, 4));
      else if (roll < 0.85) spawnPickup(G, x, y, 'cell', 1);
      else spawnPickup(G, x, y, 'heart', 1);
    }
  }

  function spawnPickup(G, x, y, kind, val = 1) {
    G.pickups.push({
      x, y, kind, val, t: U.rand(TAU),
      vx: kind === 'item' ? 0 : U.rand(-50, 50),
      vy: kind === 'item' ? 0 : U.rand(-50, 50),
      dead: false,
    });
  }

  // ── crates (powder barrels & cargo) ──

  function damageCrate(G, tx, ty, dmg) {
    const k = tx + ',' + ty;
    const hp = G.level.crates.get(k);
    if (hp === undefined) return;
    const left = hp - dmg;
    if (left <= 0) {
      G.level.crates.delete(k);
      G.level.grid[ty * G.level.W + tx] = T_FLOOR;
      Sfx.crate();
      const px = (tx + 0.5) * TILE, py = (ty + 0.5) * TILE;
      burst(G, px, py, '#a16207', 10, 140, 0.45, 3);
      if (U.chance(0.7)) dropLoot(G, px, py, 'crate');
    } else {
      G.level.crates.set(k, left);
    }
  }

  // ── explosion (player-friendly) ──

  function boom(G, x, y, radius, dmg) {
    Sfx.boom(radius > 70);
    G.shake = Math.max(G.shake, 7);
    burst(G, x, y, '#fb923c', 26, 260, 0.6, 4);
    burst(G, x, y, '#fde68a', 14, 180, 0.4, 3);
    G.flashes.push({ x, y, r: radius, t: 0.18, max: 0.18, color: '#fb923c' });
    for (const e of G.enemies) {
      if (e.warp > 0 || e.dead) continue;
      const d = U.dist(x, y, e.x, e.y);
      if (d < radius + e.r) {
        damageEnemy(G, e, dmg * (d < radius * 0.5 ? 1 : 0.6));
        const a = U.ang(x, y, e.x, e.y);
        e.kbx += Math.cos(a) * 260;
        e.kby += Math.sin(a) * 260;
      }
    }
    const t0x = Math.floor((x - radius) / TILE), t1x = Math.floor((x + radius) / TILE);
    const t0y = Math.floor((y - radius) / TILE), t1y = Math.floor((y + radius) / TILE);
    for (let ty = t0y; ty <= t1y; ty++)
      for (let tx = t0x; tx <= t1x; tx++) {
        if (tx < 0 || ty < 0 || tx >= G.level.W || ty >= G.level.H) continue;
        if (G.level.grid[ty * G.level.W + tx] === T_CRATE) damageCrate(G, tx, ty, 99);
      }
    if (G.gas) { // blasts ignite spilled fuel
      for (const g of G.gas) {
        if (!g.burn && g.fuse === undefined && U.dist(x, y, g.x, g.y) < radius + g.r) g.fuse = 0.05;
      }
    }
  }

  // ── fx primitives ──

  function burst(G, x, y, color, n = 10, spd = 140, life = 0.5, size = 3) {
    for (let i = 0; i < n; i++) {
      if (G.particles.length > 500) break;
      const a = U.rand(TAU), s = U.rand(spd * 0.3, spd);
      G.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: U.rand(life * 0.5, life), maxLife: life,
        color, size: U.rand(size * 0.5, size),
      });
    }
  }

  function addText(G, x, y, str, color = '#e2e8f0', size = 13) {
    if (G.texts.length > 40) return;
    G.texts.push({ x, y, str, color, size, t: 0, life: 1.1 });
  }

  function showBanner(G, str, sub = '') {
    G.banner = { str, sub, t: 0, life: 2.8 };
  }

  // ════════════════════════ drawing ════════════════════════

  // a snake: chain of segments behind a head, with a sine slither
  function drawSnake(ctx, e, opts) {
    const segs = opts.segs, baseR = opts.baseR, wave = opts.wave;
    ctx.rotate(e.face);
    for (let i = segs; i >= 1; i--) { // tail first so head overlaps
      const sx = -i * baseR * 0.95;
      const sy = Math.sin(e.t * wave + i * 0.9) * 3.5 * (0.3 + i / segs);
      const sr = baseR * (1 - i / (segs + 2));
      ctx.fillStyle = i % 2 === 0 ? opts.body : opts.pattern;
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.5, sr), 0, TAU); ctx.fill();
    }
    // head
    ctx.fillStyle = opts.head;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(2, 0, baseR + 1.5, baseR * 0.8, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fde047'; // eyes
    ctx.beginPath(); ctx.arc(4, -2.5, 1.3, 0, TAU); ctx.arc(4, 2.5, 1.3, 0, TAU); ctx.fill();
    if (Math.sin(e.t * 8) > 0.55) { // forked tongue flicker
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(baseR + 3, 0); ctx.lineTo(baseR + 8, -2);
      ctx.moveTo(baseR + 3, 0); ctx.lineTo(baseR + 8, 2);
      ctx.stroke();
    }
  }

  // a tribesman: skin-toned body, feather headdress, war paint, blowgun toward the player
  function drawTribesman(ctx, G, e, opts) {
    const pa = U.ang(e.x, e.y, G.player.x, G.player.y);
    ctx.rotate(pa);
    ctx.translate(0, Math.sin(e.t * 5) * 1.2); // bob
    for (let i = -1; i <= 1; i++) { // feathers fan out behind the head
      ctx.save();
      ctx.rotate(Math.PI + i * 0.45);
      ctx.fillStyle = opts.feathers[i + 1];
      ctx.beginPath();
      ctx.ellipse(e.r + 1, 0, 6.5, 2.2, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#3f1f0a'; // shoulders
    ctx.beginPath();
    ctx.arc(-2, -e.r * 0.62, 3.5, 0, TAU);
    ctx.arc(-2, e.r * 0.62, 3.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = opts.skin; // head
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, e.r * 0.72, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = opts.paint; // war paint stripes
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-2, -4); ctx.lineTo(4, -4);
    ctx.moveTo(-2, 4); ctx.lineTo(4, 4);
    ctx.stroke();
    ctx.fillStyle = '#854d0e'; // blowgun
    ctx.fillRect(e.r * 0.5, -1.25, opts.gunLen, 2.5);
    ctx.fillStyle = '#451a03';
    ctx.fillRect(e.r * 0.5, -1.75, 3, 3.5);
  }

  function drawEnemy(ctx, G, e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.warp > 0) { // emerging from the undergrowth
      const k = 1 - U.clamp(e.warp / 0.55, 0, 1);
      ctx.globalAlpha = 0.25 + 0.5 * k;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, e.r + 18 * (1 - k), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.25 * k;
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(0, 0, e.r * k, 0, TAU);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 10;
    switch (e.kind) {
      case 'viper':
        drawSnake(ctx, e, {
          segs: 5, baseR: 4.5, wave: 10,
          body: '#3f6212', pattern: '#65a30d', head: '#4d7c0f',
        });
        break;
      case 'constrictor': {
        if (e.state === 'tele') { // coiled up, quivering
          const shake = Math.sin(e.t * 40) * 1.2;
          ctx.translate(shake, 0);
          ctx.strokeStyle = '#92400e';
          ctx.lineWidth = 5;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(0, 0, 4 + i * 4, i * 1.2, i * 1.2 + TAU * 0.8);
            ctx.stroke();
          }
          ctx.fillStyle = '#b45309'; // raised head
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 1.5;
          ctx.save();
          ctx.rotate(e.face);
          ctx.beginPath(); ctx.ellipse(10, 0, 6, 4.5, 0, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#fde047';
          ctx.beginPath(); ctx.arc(12, -2, 1.4, 0, TAU); ctx.arc(12, 2, 1.4, 0, TAU); ctx.fill();
          ctx.restore();
        } else if (e.state === 'charge') { // body at full stretch, fangs out
          ctx.rotate(e.face);
          for (let i = 8; i >= 1; i--) {
            ctx.fillStyle = i % 2 === 0 ? '#92400e' : '#b45309';
            ctx.beginPath();
            ctx.arc(-i * 4.5, Math.sin(e.t * 30 + i) * 1.5, Math.max(2, 6 - i * 0.5), 0, TAU);
            ctx.fill();
          }
          ctx.fillStyle = '#b45309';
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.ellipse(4, 0, 8, 5.5, 0, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = '#fef9c3'; // fangs
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(10, -3); ctx.lineTo(14, -1);
          ctx.moveTo(10, 3); ctx.lineTo(14, 1);
          ctx.stroke();
        } else {
          drawSnake(ctx, e, {
            segs: 6, baseR: 6, wave: e.state === 'stun' ? 3 : 7,
            body: '#92400e', pattern: '#d97706', head: '#b45309',
          });
          if (e.state === 'stun') { // dizzy stars
            ctx.fillStyle = '#fde047';
            for (let i = 0; i < 3; i++) {
              const a = e.t * 5 + (i / 3) * TAU;
              ctx.beginPath();
              ctx.arc(Math.cos(a) * 10, Math.sin(a) * 4 - 12, 1.5, 0, TAU);
              ctx.fill();
            }
          }
        }
        break;
      }
      case 'brood': { // egg-swollen python
        const sq = 1 + Math.sin(e.t * 4) * 0.06;
        ctx.rotate(e.face);
        ctx.scale(sq, 2 - sq);
        ctx.fillStyle = '#365314'; // tail
        ctx.beginPath(); ctx.ellipse(-e.r - 4, Math.sin(e.t * 6) * 2, 6, 3.5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3f6212'; // swollen belly
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(-2, 0, e.r, e.r * 0.85, 0, 0, TAU); ctx.fill(); ctx.stroke();
        for (const side of [-1, 1]) { // the eggs inside, pulsing
          ctx.fillStyle = '#d9f99d';
          ctx.globalAlpha = 0.55 + Math.sin(e.t * 5 + side) * 0.2;
          ctx.beginPath();
          ctx.arc(-3, side * 4.5, 4 + Math.sin(e.t * 5 + side) * 0.8, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = '#4d7c0f'; // small head
        ctx.beginPath(); ctx.ellipse(e.r - 1, 0, 5, 3.5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fde047';
        ctx.beginPath(); ctx.arc(e.r + 1, -1.5, 1.2, 0, TAU); ctx.arc(e.r + 1, 1.5, 1.2, 0, TAU); ctx.fill();
        break;
      }
      case 'tribesman':
        drawTribesman(ctx, G, e, {
          skin: '#92400e', paint: '#fde047', gunLen: e.r + 12,
          feathers: ['#ef4444', '#facc15', '#ef4444'],
        });
        break;
      case 'headhunter': {
        if (e.lock > 0) { // taking aim down the long blowgun
          const lx = G.player.x - e.x, ly = G.player.y - e.y;
          ctx.strokeStyle = e.lock > 0.75 ? 'rgba(244,63,94,' + (0.3 + e.lock * 0.5) + ')'
            : 'rgba(56,189,248,' + (0.15 + e.lock * 0.4) + ')';
          ctx.lineWidth = e.lock > 0.75 ? 2 : 1;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(lx, ly); ctx.stroke();
        }
        drawTribesman(ctx, G, e, {
          skin: '#854d0e', paint: '#38bdf8', gunLen: e.r + 18,
          feathers: ['#38bdf8', '#0ea5e9', '#38bdf8'],
        });
        const glow = 2 + e.lock * 2.5; // dart tip glints as the shot readies
        ctx.fillStyle = e.lock > 0.75 ? '#f43f5e' : '#7dd3fc';
        ctx.beginPath(); ctx.arc(e.r + 18, 0, glow, 0, TAU); ctx.fill();
        break;
      }
      case 'hunter': { // big tribesman with shield and javelins
        const pa = U.ang(e.x, e.y, G.player.x, G.player.y);
        ctx.rotate(pa);
        ctx.translate(0, Math.sin(e.t * 6) * 1.5);
        for (let i = -1; i <= 2; i++) { // red feather crest
          ctx.save();
          ctx.rotate(Math.PI + (i - 0.5) * 0.35);
          ctx.fillStyle = i % 2 ? '#ef4444' : '#b91c1c';
          ctx.beginPath(); ctx.ellipse(e.r + 2, 0, 7.5, 2.5, 0, 0, TAU); ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = '#7c2d12'; // broad body
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, e.r * 0.85, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fef9c3'; // bone necklace
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.arc(Math.cos(i * 0.5) * 6, Math.sin(i * 0.5) * 6, 1.2, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = '#92400e'; // javelin arm
        ctx.fillRect(2, -e.r - 2, e.r + 6, 3);
        ctx.fillStyle = '#57534e';
        ctx.beginPath(); // javelin head
        ctx.moveTo(e.r + 10, -e.r - 2.5);
        ctx.lineTo(e.r + 15, -e.r - 0.5);
        ctx.lineTo(e.r + 10, 1 - e.r);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#854d0e'; // round wooden shield
        ctx.strokeStyle = '#d6a35c';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(7, e.r * 0.6, 8, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(7, e.r * 0.6, 4, 0, TAU); ctx.stroke();
        ctx.fillStyle = '#d6a35c';
        ctx.beginPath(); ctx.arc(7, e.r * 0.6, 1.5, 0, TAU); ctx.fill();
        break;
      }
      case 'shaman': { // skull-masked caster
        ctx.setLineDash([4, 6]); // drifting curse aura
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = 0.5;
        ctx.lineDashOffset = -e.t * 20;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, e.r + 6, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        const pa = U.ang(e.x, e.y, G.player.x, G.player.y);
        ctx.rotate(pa);
        ctx.fillStyle = '#14532d'; // dark robes
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, e.r * 0.8, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#f5f5f4'; // skull mask
        ctx.beginPath(); ctx.ellipse(3, 0, 5.5, 4.5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#1c1917';
        ctx.beginPath(); ctx.arc(4.5, -2, 1.4, 0, TAU); ctx.arc(4.5, 2, 1.4, 0, TAU); ctx.fill();
        ctx.fillRect(6.5, -0.75, 3, 1.5);
        ctx.fillStyle = '#713f12'; // staff
        ctx.fillRect(-2, -e.r - 8, 2.5, e.r + 8);
        ctx.fillStyle = e.color; // glowing fetish orb
        ctx.beginPath();
        ctx.arc(-0.75, -e.r - 9, 3 + Math.sin(e.t * 6) * 1, 0, TAU);
        ctx.fill();
        for (let i = 0; i < 3; i++) { // orbiting bone charms
          const a = e.t * 4 + (i / 3) * TAU;
          ctx.fillStyle = '#fef9c3';
          ctx.beginPath();
          ctx.arc(Math.cos(a) * (e.r + 6), Math.sin(a) * (e.r + 6), 1.8, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'totem': { // carved tiki sentinel
        ctx.fillStyle = '#713f12';
        ctx.strokeStyle = '#a16207';
        ctx.lineWidth = 2;
        ctx.fillRect(-e.r, -e.r - 2, e.r * 2, e.r * 2 + 4);
        ctx.strokeRect(-e.r, -e.r - 2, e.r * 2, e.r * 2 + 4);
        ctx.strokeStyle = '#451a03'; // carved bands
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-e.r, -4); ctx.lineTo(e.r, -4);
        ctx.moveTo(-e.r, 7); ctx.lineTo(e.r, 7);
        ctx.stroke();
        const hot = e.burst > 0;
        ctx.fillStyle = hot && Math.sin(e.t * 30) > 0 ? '#fde047' : '#78350f'; // eyes
        ctx.fillRect(-e.r + 3, -e.r + 2, 6, 4);
        ctx.fillRect(e.r - 9, -e.r + 2, 6, 4);
        ctx.strokeStyle = '#451a03'; // zigzag mouth
        ctx.beginPath();
        ctx.moveTo(-6, 11);
        ctx.lineTo(-3, 14); ctx.lineTo(0, 11); ctx.lineTo(3, 14); ctx.lineTo(6, 11);
        ctx.stroke();
        ctx.fillStyle = '#365314'; // moss
        ctx.beginPath();
        ctx.arc(-e.r + 2, e.r - 1, 2.5, 0, TAU);
        ctx.arc(e.r - 3, -e.r + 1, 2, 0, TAU);
        ctx.fill();
        const bx = Math.cos(e.aim) * (e.r + 3), by = Math.sin(e.aim) * (e.r + 3); // dart hole tracks you
        ctx.fillStyle = '#1c1917';
        ctx.beginPath(); ctx.arc(bx, by, 3, 0, TAU); ctx.fill();
        ctx.strokeStyle = hot ? '#fde047' : '#78350f';
        ctx.beginPath(); ctx.arc(bx, by, 3, 0, TAU); ctx.stroke();
        break;
      }
      case 'primate': { // grey-furred jungle ape
        const crouch = e.state === 'crouch';
        const airborne = e.state === 'leap';
        const gk = 1 - e.h / 60; // ground shadow shrinks as it leaps
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(0, e.r * 0.6, e.r * gk, e.r * 0.4 * gk, 0, 0, TAU);
        ctx.fill();
        ctx.translate(0, -e.h); // lifted while leaping
        if (airborne) ctx.scale(0.92, 1.18);
        if (crouch) {
          ctx.scale(1.12, 0.78);
          ctx.translate(Math.sin(e.t * 35) * 1.2, 0); // quivering before the pounce
        }
        ctx.rotate(e.face);
        ctx.strokeStyle = '#57534e'; // long arms to fists
        ctx.lineWidth = 4;
        const reach = airborne ? 14 : 10;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(2, side * 5);
          ctx.quadraticCurveTo(reach * 0.7, side * (e.r + 2), reach, side * (e.r - 1));
          ctx.stroke();
          ctx.fillStyle = '#44403c';
          ctx.beginPath(); ctx.arc(reach, side * (e.r - 1), 3, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = '#57534e'; // body
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(-2, 0, e.r, e.r * 0.85, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#78716c'; // silver back stripe
        ctx.beginPath(); ctx.ellipse(-5, 0, e.r * 0.5, e.r * 0.6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#d6d3d1'; // face
        ctx.beginPath(); ctx.arc(6, 0, 4.5, 0, TAU); ctx.fill();
        ctx.fillStyle = crouch || airborne ? '#f43f5e' : '#1c1917'; // eyes flare on attack
        ctx.beginPath(); ctx.arc(7.5, -1.8, 1.2, 0, TAU); ctx.arc(7.5, 1.8, 1.2, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#1c1917'; // brow
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(5, -3.5); ctx.lineTo(10, -2.5); ctx.stroke();
        break;
      }
      case 'archer': { // native with a longbow
        drawTribesman(ctx, G, e, {
          skin: '#92400e', paint: '#f472b6', gunLen: 0,
          feathers: ['#f472b6', '#fb7185', '#f472b6'],
        });
        // bow held toward the player (drawTribesman left us rotated)
        const draw = U.clamp(e.lock, 0, 1);
        ctx.strokeStyle = '#854d0e';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(e.r + 2, 0, 9, -1.15, 1.15); ctx.stroke();
        ctx.strokeStyle = '#e7e5e4'; // string, pulled back as it draws
        ctx.lineWidth = 1;
        const sx = e.r + 2 + Math.cos(1.15) * 9;
        ctx.beginPath();
        ctx.moveTo(sx, -Math.sin(1.15) * 9);
        ctx.lineTo(e.r + 2 - draw * 7, 0);
        ctx.lineTo(sx, Math.sin(1.15) * 9);
        ctx.stroke();
        if (draw > 0.05) { // nocked arrow
          ctx.strokeStyle = '#d6b25c';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(e.r + 2 - draw * 7, 0);
          ctx.lineTo(e.r + 13, 0);
          ctx.stroke();
          ctx.fillStyle = draw > 0.85 ? '#f43f5e' : '#57534e';
          ctx.beginPath();
          ctx.moveTo(e.r + 16, 0); ctx.lineTo(e.r + 11, -2.2); ctx.lineTo(e.r + 11, 2.2);
          ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'spearman': { // native with a stone-tipped spear
        const pa2 = e.state === 'tele' || e.state === 'stab'
          ? e.face : U.ang(e.x, e.y, G.player.x, G.player.y);
        ctx.rotate(pa2);
        ctx.translate(0, Math.sin(e.t * 7) * 1.2);
        for (let i = -1; i <= 1; i++) { // green feathers
          ctx.save();
          ctx.rotate(Math.PI + i * 0.45);
          ctx.fillStyle = i ? '#65a30d' : '#eab308';
          ctx.beginPath(); ctx.ellipse(e.r + 1, 0, 6.5, 2.2, 0, 0, TAU); ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = '#92400e'; // body
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, e.r * 0.75, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#eab308'; // war paint
        ctx.beginPath(); ctx.moveTo(-2, -4); ctx.lineTo(4, -4); ctx.moveTo(-2, 4); ctx.lineTo(4, 4); ctx.stroke();
        // the spear: pulled back on windup, lunged on stab
        const off = e.state === 'tele' ? -6 + Math.sin(e.t * 40) * 1 : e.state === 'stab' ? 13 : 0;
        ctx.fillStyle = '#854d0e';
        ctx.fillRect(-6 + off, -1.25, e.r + 20, 2.5);
        ctx.fillStyle = '#78716c'; // stone head
        ctx.beginPath();
        ctx.moveTo(e.r + 20 + off, -3.5); ctx.lineTo(e.r + 27 + off, 0); ctx.lineTo(e.r + 20 + off, 3.5);
        ctx.closePath(); ctx.fill();
        if (e.state === 'stab') { // thrust motion lines
          ctx.strokeStyle = 'rgba(254,243,199,0.5)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(4, -6); ctx.lineTo(e.r + 12, -6);
          ctx.moveTo(4, 6); ctx.lineTo(e.r + 12, 6);
          ctx.stroke();
        }
        break;
      }
      case 'tiki': { // the stone colossus
        for (let i = 0; i < 3; i++) { // orbiting stone shards
          const a = e.t * 1.2 + (i / 3) * TAU;
          const px = Math.cos(a) * (e.r + 14), py = Math.sin(a) * (e.r + 14);
          ctx.fillStyle = '#57534e';
          ctx.strokeStyle = '#78716c';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let j = 0; j < 6; j++) {
            const b = (j / 6) * TAU - a;
            const qx = px + Math.cos(b) * 5, qy = py + Math.sin(b) * 5;
            if (j === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
          }
          ctx.closePath();
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath(); ctx.arc(px, py, 1.5, 0, TAU); ctx.fill();
        }
        const shake = e.tele > 0 ? Math.sin(e.t * 50) * 1.5 : 0;
        ctx.translate(shake, 0);
        ctx.fillStyle = '#44403c'; // stone head
        ctx.strokeStyle = '#78716c';
        ctx.lineWidth = 3;
        ctx.fillRect(-e.r * 0.95, -e.r, e.r * 1.9, e.r * 2);
        ctx.strokeRect(-e.r * 0.95, -e.r, e.r * 1.9, e.r * 2);
        ctx.fillStyle = '#365314'; // crown of leaves
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 10 - 5, -e.r);
          ctx.lineTo(i * 10, -e.r - 9 - Math.abs(i));
          ctx.lineTo(i * 10 + 5, -e.r);
          ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = '#292524'; // carved brow
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-e.r * 0.8, -e.r * 0.5);
        ctx.lineTo(0, -e.r * 0.34);
        ctx.lineTo(e.r * 0.8, -e.r * 0.5);
        ctx.stroke();
        const CORE = { radial: '#fbbf24', volley: '#f43f5e', spiral: '#84cc16', summon: '#4ade80' };
        const eye = CORE[e.atk] || (e.hp < e.maxHp * 0.5 ? '#f43f5e' : '#fbbf24');
        ctx.shadowColor = eye; // glowing eyes hint the next attack
        ctx.shadowBlur = 14;
        ctx.fillStyle = eye;
        ctx.fillRect(-e.r * 0.65, -e.r * 0.22, 11, 7);
        ctx.fillRect(e.r * 0.65 - 11, -e.r * 0.22, 11, 7);
        ctx.shadowBlur = 0;
        const open = e.tele > 0 ? 14 : 9; // mouth gapes when winding up
        ctx.fillStyle = '#1c1917';
        ctx.fillRect(-14, e.r * 0.3, 28, open);
        ctx.fillStyle = '#e7e5e4'; // teeth
        for (let i = 0; i < 4; i++) ctx.fillRect(-12 + i * 7, e.r * 0.3, 3, 3.5);
        if (e.hp < e.maxHp * 0.5) { // battle cracks
          ctx.strokeStyle = '#1c1917';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(-e.r * 0.7, -e.r * 0.9); ctx.lineTo(-e.r * 0.4, -e.r * 0.4); ctx.lineTo(-e.r * 0.55, 2);
          ctx.moveTo(e.r * 0.6, e.r * 0.9); ctx.lineTo(e.r * 0.42, e.r * 0.45);
          ctx.stroke();
        }
        if (e.tele > 0) { // attack telegraph
          ctx.globalAlpha = 0.6;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, e.r + 10 + Math.sin(G.time * 20) * 4, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        break;
      }
    }
    if (e.flash > 0) {
      ctx.globalAlpha = Math.min(1, e.flash * 8);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, e.r * 0.9, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // per-weapon silhouettes, drawn pointing along +x (also used on the treasure chest)
  function drawGun(ctx, id) {
    const col = WEAPONS[id].color;
    switch (id) {
      case 'sword': // rusty blade
        ctx.fillStyle = '#7c2d12'; // grip
        ctx.fillRect(3, -1.5, 4, 3);
        ctx.fillStyle = '#a16207'; // crossguard
        ctx.fillRect(7, -4, 2, 8);
        ctx.fillStyle = col; // blade
        ctx.beginPath();
        ctx.moveTo(9, -1.8); ctx.lineTo(24, -1); ctx.lineTo(27, 0); ctx.lineTo(24, 1); ctx.lineTo(9, 1.8);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#92400e'; // rust spots
        ctx.fillRect(13, -0.8, 2, 1.4);
        ctx.fillRect(19, -0.5, 1.5, 1);
        break;
      case 'blunderbuss':
        ctx.fillStyle = '#713f12'; // wooden stock
        ctx.fillRect(4, -2.5, 8, 5);
        ctx.fillStyle = '#94a3b8'; // flaring barrel
        ctx.beginPath();
        ctx.moveTo(12, -2.5); ctx.lineTo(20, -5.5); ctx.lineTo(20, 5.5); ctx.lineTo(12, 2.5);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = col;
        ctx.fillRect(18.5, -5, 1.8, 10);
        break;
      case 'dualflint':
        for (const side of [-1, 1]) {
          ctx.fillStyle = '#713f12';
          ctx.fillRect(4, side * 2 - 1.6, 7, 3.2);
          ctx.fillStyle = '#cbd5e1';
          ctx.fillRect(10, side * 2 - 1.2, 8, 2.4);
        }
        break;
      case 'musket':
        ctx.fillStyle = '#713f12'; // long stock
        ctx.fillRect(4, -2.2, 12, 4.4);
        ctx.fillStyle = '#cbd5e1'; // long barrel
        ctx.fillRect(14, -1.5, 13, 3);
        ctx.fillStyle = '#a16207'; // brass fittings
        ctx.fillRect(10, -2.8, 2, 5.6);
        ctx.fillRect(25, -2, 2.5, 4);
        break;
      case 'mortar':
        ctx.fillStyle = '#713f12';
        ctx.fillRect(4, -3, 5, 6);
        ctx.fillStyle = '#b45309'; // fat brass tube
        ctx.fillRect(8, -4.5, 9, 9);
        ctx.fillStyle = '#1c1917'; // bore
        ctx.beginPath(); ctx.arc(17, 0, 3.2, 0, TAU); ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(17, 0, 3.2, 0, TAU); ctx.stroke();
        break;
      default: // flintlock pistol
        ctx.fillStyle = '#713f12'; // grip + stock
        ctx.fillRect(4, -2.5, 6, 5);
        ctx.fillStyle = '#cbd5e1'; // barrel
        ctx.fillRect(9, -1.8, 10, 3.6);
        ctx.fillStyle = '#a16207'; // brass lock
        ctx.fillRect(8, -3.2, 3, 2);
    }
  }

  function drawPlayer(ctx, G) {
    const p = G.player;
    for (const tp of G.trail) { // roll afterimages
      ctx.globalAlpha = U.clamp(tp.t / 0.22, 0, 1) * 0.3;
      ctx.fillStyle = '#b91c1c';
      ctx.beginPath(); ctx.arc(tp.x, tp.y, p.r * 0.8, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.invuln > 0 && Math.sin(G.time * 36) > 0) ctx.globalAlpha = 0.45;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; // ground shadow
    ctx.beginPath(); ctx.ellipse(0, p.r * 0.7, p.r * 0.9, p.r * 0.4, 0, 0, TAU); ctx.fill();
    // weapon first so the sprite's hands sit over the grip
    ctx.save();
    ctx.rotate(p.aimAng);
    drawGun(ctx, p.guns[p.gunIndex].id);
    ctx.restore();
    const idx = ((Math.round(p.aimAng / (Math.PI / 4)) % 8) + 8) % 8;
    const img = PLAYER_SPRITES && PLAYER_SPRITES[idx];
    if (img && img.complete && img.naturalWidth > 0) { // the uploaded pirate sprite
      const bob = p.moving ? Math.sin(G.time * 11) * 1.2 : 0;
      ctx.drawImage(img, -38, -40 + bob, 76, 76);
    } else { // vector fallback: red coat + tricorn
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#7f1d1d';
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.rotate(p.aimAng);
      ctx.fillStyle = '#f59e0b'; // epaulettes
      ctx.fillRect(-3, -p.r + 1, 5, 4);
      ctx.fillRect(-3, p.r - 5, 5, 4);
      ctx.fillStyle = '#e3b285'; // face under the brim
      ctx.beginPath(); ctx.arc(7, 0, 3.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1c1917'; // tricorn hat: 3-pointed curved triangle
      ctx.strokeStyle = '#a16207';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a0 = (i / 3) * TAU, a1 = ((i + 1) / 3) * TAU;
        const x0 = Math.cos(a0) * 10, y0 = Math.sin(a0) * 10;
        const x1 = Math.cos(a1) * 10, y1 = Math.sin(a1) * 10;
        const mx = Math.cos((a0 + a1) / 2) * 4, my = Math.sin((a0 + a1) / 2) * 4;
        if (i === 0) ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(mx, my, x1, y1);
      }
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ef4444'; // feather
      ctx.beginPath(); ctx.ellipse(-7, -7, 5, 1.8, -0.7, 0, TAU); ctx.fill();
    }
    ctx.restore();
    if (p.dashCD > 0 && G.state === 'play') { // roll cooldown ring
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#d6b25c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - p.dashCD / p.dashCDMax));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // small icon glyphs for treasures, drawn centered at origin
  function drawItemGlyph(ctx, id, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    switch (id) {
      case 'voodoo': // pinned doll
        ctx.arc(0, -3.5, 2.5, 0, TAU); ctx.fill();
        ctx.fillRect(-1.2, -1.5, 2.4, 6);
        ctx.fillRect(-4.5, 0, 9, 1.8);
        ctx.beginPath();
        ctx.moveTo(-4, -6); ctx.lineTo(2, 2); // the pin
        ctx.stroke();
        break;
      case 'gunpowder': // burst star
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          const r = i % 2 ? 3 : 6.5;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, TAU); ctx.fill();
        break;
      case 'spinach': // leaf
        ctx.moveTo(0, 6);
        ctx.quadraticCurveTo(-6.5, 0, 0, -6);
        ctx.quadraticCurveTo(6.5, 0, 0, 6);
        ctx.fill();
        ctx.strokeStyle = '#14532d';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(0, -5); ctx.stroke();
        break;
      case 'gasoline': // droplet
        ctx.moveTo(0, -6);
        ctx.quadraticCurveTo(5, 1, 0, 5.5);
        ctx.quadraticCurveTo(-5, 1, 0, -6);
        ctx.fill();
        break;
      case 'parrot': // bird in flight
        ctx.moveTo(-6, 1); ctx.quadraticCurveTo(0, -6, 6, 1); // wings
        ctx.quadraticCurveTo(0, -2, -6, 1);
        ctx.fill();
        ctx.beginPath(); ctx.arc(0, 2.5, 2, 0, TAU); ctx.fill();
        break;
      case 'luckycoin': // doubloon
        ctx.arc(0, 0, 5.5, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, TAU); ctx.fill();
        break;
      case 'sharktooth': // tooth
        ctx.moveTo(-4.5, -4.5); ctx.lineTo(4.5, -4.5); ctx.lineTo(0.5, 6);
        ctx.closePath(); ctx.fill();
        break;
      case 'cannonball': // ball with speed lines
        ctx.arc(1.5, 0, 4.5, 0, TAU); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-3, -3.5); ctx.lineTo(-7, -3.5);
        ctx.moveTo(-4, 0); ctx.lineTo(-8, 0);
        ctx.moveTo(-3, 3.5); ctx.lineTo(-7, 3.5);
        ctx.stroke();
        break;
    }
  }

  function drawPickup(ctx, G, pk) {
    const bob = Math.sin(G.time * 3 + pk.t) * 2.5;
    ctx.save();
    ctx.translate(pk.x, pk.y + bob);
    switch (pk.kind) {
      case 'credit': { // spinning gold doubloon
        ctx.scale(Math.abs(Math.sin(G.time * 3 + pk.t)) * 0.7 + 0.3, 1);
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#fbbf24';
        ctx.strokeStyle = '#a16207';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#fef3c7';
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.stroke();
        break;
      }
      case 'cell': { // powder keg
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#7c2d12';
        ctx.strokeStyle = '#a16207';
        ctx.lineWidth = 1.5;
        ctx.fillRect(-5.5, -7, 11, 14);
        ctx.strokeRect(-5.5, -7, 11, 14);
        ctx.strokeStyle = '#451a03'; // barrel hoops
        ctx.beginPath();
        ctx.moveTo(-5.5, -3.5); ctx.lineTo(5.5, -3.5);
        ctx.moveTo(-5.5, 3.5); ctx.lineTo(5.5, 3.5);
        ctx.stroke();
        ctx.fillStyle = '#1c1917'; // powder at the bung
        ctx.beginPath(); ctx.arc(0, -7, 2.2, 0, TAU); ctx.fill();
        if (Math.sin(G.time * 6 + pk.t) > 0.3) { // fizzing spark
          ctx.fillStyle = '#fde047';
          ctx.beginPath(); ctx.arc(1.5, -9, 1.2, 0, TAU); ctx.fill();
        }
        break;
      }
      case 'heart': { // bottle of rum
        ctx.shadowColor = '#f87171';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#92400e';
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 1.5;
        ctx.fillRect(-4.5, -3, 9, 11); // body
        ctx.strokeRect(-4.5, -3, 9, 11);
        ctx.fillRect(-1.8, -8, 3.6, 5); // neck
        ctx.fillStyle = '#d6a35c'; // cork
        ctx.fillRect(-1.8, -10, 3.6, 2.5);
        ctx.fillStyle = '#dc2626'; // label
        ctx.fillRect(-4.5, 0, 9, 4);
        ctx.fillStyle = '#fef9c3';
        ctx.fillRect(-1, 1.2, 2, 1.6); // X on the label
        break;
      }
      case 'item': { // stat treasure: glowing relic in a rope ring
        const it = ITEMS[pk.val];
        ctx.save();
        ctx.translate(0, -bob); // ground ring doesn't bob
        ctx.strokeStyle = it.color;
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(G.time * 3);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, 10, 13, 5, 0, 0, TAU); ctx.stroke();
        ctx.restore();
        ctx.shadowColor = it.color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#1a130a';
        ctx.strokeStyle = '#a16207';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#a16207'; // rope knots
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + G.time * 1.2;
          ctx.beginPath(); ctx.arc(Math.cos(a) * 11, Math.sin(a) * 11, 1.8, 0, TAU); ctx.fill();
        }
        drawItemGlyph(ctx, pk.val, it.color);
        break;
      }
    }
    ctx.restore();
  }

  return {
    ENEMY_DEFS, ITEMS, ITEM_IDS, spawn, update, eShoot, damageEnemy, damageCrate, boom,
    burst, addText, showBanner, spawnPickup, dropLoot,
    drawEnemy, drawPlayer, drawPickup, drawGun,
  };
})();
