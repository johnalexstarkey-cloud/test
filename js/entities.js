'use strict';
// entities.js — enemies (AI + boss), items, damage, loot, pickups, particles, fx (global Ent)

const Ent = (() => {
  const ENEMY_DEFS = {
    skitter:  { hp: 2,   r: 9,  spd: 155, cost: 1, color: '#f87171', credits: [1, 2] },
    drone:    { hp: 3,   r: 11, spd: 90,  cost: 2, color: '#fb7185', credits: [1, 3] },
    turret:   { hp: 5,   r: 12, spd: 0,   cost: 2, color: '#f59e0b', credits: [1, 3] },
    charger:  { hp: 5,   r: 12, spd: 95,  cost: 3, color: '#f97316', credits: [2, 3] },
    gunner:   { hp: 7,   r: 13, spd: 62,  cost: 3, color: '#e879f9', credits: [2, 4] },
    splitter: { hp: 6,   r: 13, spd: 72,  cost: 3, color: '#a3e635', credits: [2, 3] },
    orbiter:  { hp: 5,   r: 11, spd: 80,  cost: 3, color: '#22d3ee', credits: [2, 4] },
    sniper:   { hp: 4,   r: 11, spd: 70,  cost: 3, color: '#38bdf8', credits: [2, 4] },
    warden:   { hp: 130, r: 30, spd: 55,  cost: 0, color: '#a78bfa', credits: [15, 25] },
  };

  // stat-upgrade items (Isaac-style): chance drop on room clear, guaranteed from bosses
  const ITEMS = {
    overclock: {
      name: 'OVERCLOCK CHIP', desc: '+15% fire rate', color: '#fde047',
      apply: (p) => { p.stats.fireRate += 0.15; },
    },
    servo: {
      name: 'SERVO ACTUATORS', desc: '+12% move speed', color: '#4ade80',
      apply: (p) => { p.stats.speed += 0.12; },
    },
    flux: {
      name: 'FLUX DASH CORE', desc: '-15% dash cooldown', color: '#22d3ee',
      apply: (p) => { p.stats.dashCD *= 0.85; },
    },
    phase: {
      name: 'PHASE ROUNDS', desc: 'shots pierce +1 enemy', color: '#c084fc',
      apply: (p) => { p.stats.pierce += 1; },
    },
    ricochet: {
      name: 'RICOCHET PLATING', desc: 'shots bounce +1 wall', color: '#fb923c',
      apply: (p) => { p.stats.bounce += 1; },
    },
    hull: {
      name: 'NANO-HULL WEAVE', desc: '+1 max hull, +1 repair', color: '#f87171',
      apply: (p) => { p.maxHp = Math.min(12, p.maxHp + 1); p.hp = Math.min(p.maxHp, p.hp + 1); },
    },
  };
  const ITEM_IDS = Object.keys(ITEMS);

  let nextId = 1;

  function spawn(G, kind, x, y, roomIdx, warpDelay = 0) {
    const d = ENEMY_DEFS[kind];
    const hpScale = kind === 'warden'
      ? 1 + 0.3 * (Math.floor(G.floor / 3) - 1)
      : 1 + 0.13 * (G.floor - 1);
    const hp = Math.ceil(d.hp * hpScale);
    const e = {
      id: nextId++, kind, x, y, r: d.r, hp, maxHp: hp,
      spd: d.spd, color: d.color, roomIdx,
      warp: 0.55 + warpDelay, t: U.rand(TAU), flash: 0, tele: 0,
      fireCD: U.rand(0.8, 1.6), kbx: 0, kby: 0,
      aim: U.rand(TAU), face: 0, burst: 0, atk: '', atkT: U.rand(0.6, 1.2),
      state: 'roam', stT: 0, cdx: 1, cdy: 0, lock: 0,
      dir: U.chance(0.5) ? 1 : -1, dead: false,
    };
    G.enemies.push(e);
    return e;
  }

  function eShoot(G, x, y, ang, spd, opts = {}) {
    if (G.eBullets.length > 500) return;
    G.eBullets.push({
      x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      r: opts.r || 4, life: opts.life || 3.4, color: opts.color || '#f43f5e',
      t: 0, dead: false,
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
      case 'skitter': { // fast melee chaser, weaves as it runs
        const a = Math.atan2(uy, ux) + Math.sin(e.t * 7) * 0.35;
        mx = Math.cos(a) * e.spd; my = Math.sin(a) * e.spd;
        break;
      }
      case 'drone': { // hovers at range, single aimed shots
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
      case 'turret': { // stationary, tracks and fires bursts
        const want = Math.atan2(uy, ux);
        let da = want - e.aim;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        e.aim += U.clamp(da, -2.4 * dt, 2.4 * dt);
        if (e.burst > 0 && e.fireCD <= 0) {
          eShoot(G, e.x + Math.cos(e.aim) * (e.r + 6), e.y + Math.sin(e.aim) * (e.r + 6),
            e.aim, 240, { color: '#fbbf24' });
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
      case 'charger': { // telegraphs, then rams in a straight line
        if (e.state === 'charge') {
          const ox = e.x, oy = e.y;
          MapGen.moveEntity(lvl, e, e.cdx * 520 * dt, e.cdy * 520 * dt);
          e.stT -= dt;
          if (U.dist(ox, oy, e.x, e.y) < 520 * dt * 0.35 || e.stT <= 0) { // hit a wall / spent
            e.state = 'stun'; e.stT = 0.7;
            burst(G, e.x + e.cdx * e.r, e.y + e.cdy * e.r, e.color, 8, 160, 0.4, 3);
            G.shake = Math.max(G.shake, 3);
          }
          if (U.chance(0.5)) burst(G, e.x - e.cdx * e.r, e.y - e.cdy * e.r, '#fdba74', 1, 40, 0.25, 2);
          return;
        }
        if (e.state === 'stun') {
          e.stT -= dt;
          if (e.stT <= 0) e.state = 'roam';
          break;
        }
        if (e.state === 'tele') {
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
      case 'gunner': { // heavy walker, fan volleys
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
            eShoot(G, e.x, e.y, base + (i - (n - 1) / 2) * 0.21, 195, { color: '#e879f9' });
          Sfx.eshoot();
          e.fireCD = U.rand(1.8, 2.4);
        }
        break;
      }
      case 'splitter': { // lumbering blob, splits into skitters on death
        const a = Math.atan2(uy, ux) + Math.sin(e.t * 3) * 0.5;
        mx = Math.cos(a) * e.spd; my = Math.sin(a) * e.spd;
        break;
      }
      case 'orbiter': { // circles the player, radial bullet rings
        const oa = e.t * 0.9 * e.dir;
        const txp = p.x + Math.cos(oa) * 190, typ = p.y + Math.sin(oa) * 190;
        const dd = Math.hypot(txp - e.x, typ - e.y);
        if (dd > 6) { mx = (txp - e.x) / dd * e.spd; my = (typ - e.y) / dd * e.spd; }
        if (e.fireCD <= 0) {
          for (let i = 0; i < 8; i++)
            eShoot(G, e.x, e.y, (i / 8) * TAU + e.t, 150, { color: '#22d3ee' });
          Sfx.eshoot();
          e.fireCD = U.rand(2.4, 3.0);
        }
        break;
      }
      case 'sniper': { // keeps far, locks on with a laser, fires a fast precise shot
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
      case 'warden':
        updateWarden(G, e, dt, d, ux, uy);
        return;
    }

    mx += e.kbx; my += e.kby;
    e.kbx *= Math.exp(-12 * dt);
    e.kby *= Math.exp(-12 * dt);
    if (mx || my) e.face = Math.atan2(my, mx);
    MapGen.moveEntity(lvl, e, mx * dt, my * dt);
  }

  // ── boss: the Warden — telegraphed bullet-hell patterns ──

  function updateWarden(G, e, dt, d, ux, uy) {
    const p = G.player;
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
        const opts = ['radial', 'shotgun', 'spiral'];
        if (enraged) opts.push('summon', 'spiral');
        e.atk = U.pick(opts);
        e.tele = 0.45; e.atkT = 0.45; e.burst = 0;
      }
      return;
    }
    if (e.atkT > 0) return;

    switch (e.atk) {
      case 'radial': { // expanding rings
        const off = U.rand(TAU);
        const n = e.hp < e.maxHp * 0.5 ? 18 : 14;
        for (let i = 0; i < n; i++)
          eShoot(G, e.x, e.y, off + (i / n) * TAU, 165, { r: 5, color: '#a78bfa' });
        Sfx.eshoot();
        e.burst++;
        if (e.burst >= 3) { e.atk = ''; e.atkT = U.rand(1.0, 1.6); }
        else e.atkT = 0.55;
        break;
      }
      case 'shotgun': { // aimed triple volley
        const base = Math.atan2(uy, ux);
        for (let i = -2; i <= 2; i++)
          eShoot(G, e.x, e.y, base + i * 0.13, 260, { color: '#f43f5e' });
        Sfx.eshoot();
        e.burst++;
        if (e.burst >= 3) { e.atk = ''; e.atkT = U.rand(0.9, 1.4); }
        else e.atkT = 0.4;
        break;
      }
      case 'spiral': { // rotating double-arm spiral
        e.spiralA = (e.spiralA === undefined ? U.rand(TAU) : e.spiralA) + 0.42;
        eShoot(G, e.x, e.y, e.spiralA, 150, { r: 4.5, color: '#c084fc' });
        eShoot(G, e.x, e.y, e.spiralA + Math.PI, 150, { r: 4.5, color: '#c084fc' });
        e.burst++;
        if (e.burst === 1 || e.burst % 6 === 0) Sfx.eshoot();
        if (e.burst >= 26) { e.atk = ''; e.atkT = U.rand(1.2, 1.8); e.spiralA = undefined; }
        else e.atkT = 0.07;
        break;
      }
      case 'summon': { // warp in escorts
        const minions = G.enemies.filter((o) => o.roomIdx === e.roomIdx && o.kind !== 'warden' && !o.dead).length;
        for (let i = 0; i < Math.max(0, 3 - minions); i++) {
          const room = G.level.rooms[e.roomIdx];
          const pos = MapGen.randFloorInRoom(G.level, room,
            { awayFromX: G.player.x, awayFromY: G.player.y, minDist: TILE * 4 });
          if (pos) spawn(G, U.pick(['skitter', 'skitter', 'drone']), pos.x, pos.y, e.roomIdx, i * 0.15);
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
      if (e.kind === 'splitter') {
        spawn(G, 'skitter', e.x - 12, e.y + U.rand(-6, 6), e.roomIdx, 0.05);
        spawn(G, 'skitter', e.x + 12, e.y + U.rand(-6, 6), e.roomIdx, 0.15);
        addText(G, e.x, e.y - 14, 'SPLIT!', '#a3e635', 12);
      }
      if (e.kind === 'warden') onBossDeath(G, e);
      else dropLoot(G, e.x, e.y, 'enemy', e.kind);
    } else {
      Sfx.hit();
    }
  }

  function onBossDeath(G, e) {
    Sfx.bossDown();
    G.shake = Math.max(G.shake, 14);
    burst(G, e.x, e.y, '#a78bfa', 40, 320, 1.0, 5);
    burst(G, e.x, e.y, '#ffffff', 20, 200, 0.6, 3);
    G.flashes.push({ x: e.x, y: e.y, r: 160, t: 0.35, max: 0.35, color: '#a78bfa' });
    const def = ENEMY_DEFS.warden;
    const n = U.ri(def.credits[0], def.credits[1]);
    for (let i = 0; i < n; i++) spawnPickup(G, e.x + U.rand(-40, 40), e.y + U.rand(-40, 40), 'credit', 1);
    spawnPickup(G, e.x - 30, e.y, 'heart', 1);
    spawnPickup(G, e.x + 30, e.y, 'heart', 1);
    spawnPickup(G, e.x, e.y - 30, 'cell', 1);
    spawnPickup(G, e.x, e.y + 34, 'item', U.pick(ITEM_IDS)); // bosses always drop an upgrade
    const p = G.player;
    p.maxHp = Math.min(12, p.maxHp + 1);
    p.hp = Math.min(p.maxHp, p.hp + 3);
    showBanner(G, 'WARDEN DESTROYED', 'hull reinforced +1 — teleporter online');
    G.boss = null;
  }

  function dropLoot(G, x, y, table, kind) {
    const roll = Math.random();
    if (table === 'enemy') {
      const cr = ENEMY_DEFS[kind] ? ENEMY_DEFS[kind].credits : [1, 2];
      if (roll < 0.32) spawnPickup(G, x, y, 'credit', U.ri(cr[0], cr[1]));
      else if (roll < 0.44) spawnPickup(G, x, y, 'cell', 1);
      else if (roll < 0.52) spawnPickup(G, x, y, 'heart', 1);
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

  // ── crates ──

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
      burst(G, px, py, '#94a3b8', 10, 140, 0.45, 3);
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

  function drawEnemy(ctx, G, e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.warp > 0) { // materialize ring
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
    ctx.shadowBlur = 12;
    switch (e.kind) {
      case 'skitter': {
        ctx.rotate(e.face);
        ctx.strokeStyle = '#7f1d1d'; // scuttling legs
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          const ph = Math.sin(e.t * 16 + i * 2.1) * 3;
          ctx.beginPath();
          ctx.moveTo(i * 5 - 6, 5); ctx.lineTo(i * 5 - 9 + ph, 11);
          ctx.moveTo(i * 5 - 6, -5); ctx.lineTo(i * 5 - 9 - ph, -11);
          ctx.stroke();
        }
        ctx.fillStyle = '#450a0a'; // chitin wedge body
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.r + 4, 0);
        ctx.lineTo(-e.r * 0.6, e.r * 0.65);
        ctx.lineTo(-e.r * 0.9, 0);
        ctx.lineTo(-e.r * 0.6, -e.r * 0.65);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#fca5a5'; // mandibles
        ctx.beginPath();
        ctx.moveTo(e.r + 1, 2); ctx.lineTo(e.r + 7, 5);
        ctx.moveTo(e.r + 1, -2); ctx.lineTo(e.r + 7, -5);
        ctx.stroke();
        ctx.fillStyle = '#fecaca'; // eye slit
        ctx.fillRect(0, -1.25, 5.5, 2.5);
        break;
      }
      case 'drone': {
        for (let i = 0; i < 4; i++) { // spinning rotor arcs
          const a = e.t * 5 + (i / 4) * TAU;
          ctx.strokeStyle = '#fda4af';
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, 0, e.r + 4, a, a + 0.7); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = '#3f0f1a'; // saucer hull
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#5b1626'; // dome
        ctx.beginPath(); ctx.arc(0, 0, e.r * 0.55, 0, TAU); ctx.fill();
        for (let i = 0; i < 3; i++) { // rim running lights
          const a = e.t * 1.5 + (i / 3) * TAU;
          ctx.fillStyle = '#fb7185';
          ctx.beginPath();
          ctx.arc(Math.cos(a) * (e.r - 2.5), Math.sin(a) * (e.r - 2.5), 1.5, 0, TAU);
          ctx.fill();
        }
        ctx.strokeStyle = '#fb7185'; // antenna with blinking tip
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, -e.r * 0.55); ctx.lineTo(0, -e.r - 5); ctx.stroke();
        if (Math.sin(e.t * 6) > 0) {
          ctx.fillStyle = '#fecdd3';
          ctx.beginPath(); ctx.arc(0, -e.r - 5, 2, 0, TAU); ctx.fill();
        }
        const pa = U.ang(e.x, e.y, G.player.x, G.player.y); // targeting eye
        ctx.fillStyle = '#fda4af';
        ctx.beginPath();
        ctx.arc(Math.cos(pa) * 4, Math.sin(pa) * 4, 3, 0, TAU);
        ctx.fill();
        break;
      }
      case 'turret': {
        ctx.fillStyle = '#3b2503'; // octagonal base
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + Math.PI / 8;
          const px = Math.cos(a) * (e.r + 2), py = Math.sin(a) * (e.r + 2);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#92400e'; // corner bolts
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + Math.PI / 4;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * (e.r - 2), Math.sin(a) * (e.r - 2), 1.5, 0, TAU);
          ctx.fill();
        }
        ctx.strokeStyle = '#92400e'; // swivel ring
        ctx.beginPath(); ctx.arc(0, 0, e.r * 0.65, 0, TAU); ctx.stroke();
        ctx.save();
        ctx.rotate(e.aim);
        const recoil = e.burst > 0 && e.fireCD > 0.06 ? -3 : 0;
        ctx.fillStyle = '#78350f'; // barrel housing
        ctx.fillRect(2 + recoil, -3.5, e.r + 8, 7);
        ctx.fillStyle = e.color;
        ctx.fillRect(e.r + 7 + recoil, -2.5, 5, 5); // muzzle
        ctx.fillRect(2 + recoil, -1, e.r + 4, 2);   // rail groove
        ctx.restore();
        ctx.fillStyle = e.burst > 0 && Math.sin(e.t * 30) > 0 ? '#fde68a' : '#713f12'; // warning lamp
        ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill();
        break;
      }
      case 'charger': {
        ctx.rotate(e.face);
        ctx.strokeStyle = '#7c2d12'; // treads with rolling dashes
        ctx.lineWidth = 4;
        const roll = (e.t * 30) % 6;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(-e.r, side * (e.r - 2));
          ctx.lineTo(e.r - 2, side * (e.r - 2));
          ctx.stroke();
        }
        ctx.strokeStyle = '#431407';
        ctx.lineWidth = 2;
        for (let x = -e.r + roll; x < e.r - 2; x += 6) {
          ctx.beginPath();
          ctx.moveTo(x, e.r - 4); ctx.lineTo(x, e.r);
          ctx.moveTo(x, -e.r + 4); ctx.lineTo(x, -e.r);
          ctx.stroke();
        }
        ctx.fillStyle = '#431407'; // hull
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.r + 2, 0);
        ctx.lineTo(2, e.r - 3);
        ctx.lineTo(-e.r, e.r - 5);
        ctx.lineTo(-e.r, -(e.r - 5));
        ctx.lineTo(2, -(e.r - 3));
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        const hot = e.state === 'tele' && Math.sin(e.t * 30) > 0; // ram blade, flashes on telegraph
        ctx.fillStyle = hot ? '#ffffff' : e.state === 'charge' ? '#fdba74' : '#9a3412';
        ctx.beginPath();
        ctx.moveTo(e.r + 8, 0);
        ctx.lineTo(e.r - 2, 6);
        ctx.lineTo(e.r - 2, -6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = e.state === 'stun' ? '#525252' : '#fdba74'; // engine eye
        ctx.beginPath(); ctx.arc(-3, 0, 3, 0, TAU); ctx.fill();
        break;
      }
      case 'gunner': {
        const bob = Math.sin(e.t * 6) * 1.5;
        ctx.translate(0, bob);
        ctx.fillStyle = '#3b0a3d'; // hex chassis
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + Math.PI / 6;
          const px = Math.cos(a) * e.r, py = Math.sin(a) * e.r;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#701a75'; // inner plating
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + Math.PI / 6;
          const px = Math.cos(a) * e.r * 0.6, py = Math.sin(a) * e.r * 0.6;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = '#701a75'; // shoulder pods
        ctx.fillRect(-4, -e.r - 4, 8, 5);
        ctx.fillRect(-4, e.r - 1, 8, 5);
        ctx.fillStyle = '#f0abfc';
        ctx.fillRect(2, -e.r - 3, 2, 3);
        ctx.fillRect(2, e.r + 1, 2, 3);
        const pa = U.ang(e.x, e.y, G.player.x, G.player.y);
        ctx.rotate(pa);
        ctx.fillStyle = e.color; // twin cannons
        ctx.fillRect(2, -6.5, e.r + 5, 3.5);
        ctx.fillRect(2, 3, e.r + 5, 3.5);
        ctx.fillStyle = '#fae8ff';
        ctx.fillRect(e.r + 4, -6, 3, 2.5);
        ctx.fillRect(e.r + 4, 3.5, 3, 2.5);
        ctx.fillStyle = '#f0abfc'; // visor
        ctx.beginPath(); ctx.arc(3, 0, 3.5, -0.9, 0.9); ctx.fill();
        break;
      }
      case 'splitter': {
        const sq = 1 + Math.sin(e.t * 4) * 0.08; // breathing squash
        ctx.scale(sq, 2 - sq);
        ctx.globalAlpha = 0.5; // outer membrane
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, e.r + 3, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        for (let i = 0; i < 3; i++) { // three lobes, each a future skitter
          const a = e.t * 0.8 + (i / 3) * TAU;
          const lx = Math.cos(a) * 5, ly = Math.sin(a) * 5;
          ctx.fillStyle = '#1a2e05';
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(lx, ly, e.r * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#d9f99d'; // nucleus
          ctx.beginPath();
          ctx.arc(lx, ly, 2 + Math.sin(e.t * 5 + i) * 1, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'orbiter': {
        ctx.save(); // gyroscope rings
        ctx.rotate(e.t * 1.8);
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, 0, e.r, e.r * 0.38, 0, 0, TAU); ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.rotate(-e.t * 1.3 + Math.PI / 3);
        ctx.strokeStyle = '#67e8f9';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(0, 0, e.r, e.r * 0.38, 0, 0, TAU); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#062a30'; // core housing
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, e.r * 0.5, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = e.color; // pulsing core
        ctx.beginPath(); ctx.arc(0, 0, 3 + Math.sin(e.t * 6) * 1.2, 0, TAU); ctx.fill();
        for (let i = 0; i < 3; i++) { // orbiting charge motes
          const a = e.t * 4 + (i / 3) * TAU;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * (e.r + 6), Math.sin(a) * (e.r + 6), 2.2, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'sniper': {
        if (e.lock > 0) { // lock-on laser to the player
          const lx = G.player.x - e.x, ly = G.player.y - e.y;
          ctx.strokeStyle = e.lock > 0.75 ? 'rgba(244,63,94,' + (0.3 + e.lock * 0.5) + ')'
            : 'rgba(56,189,248,' + (0.15 + e.lock * 0.4) + ')';
          ctx.lineWidth = e.lock > 0.75 ? 2 : 1;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(lx, ly); ctx.stroke();
        }
        ctx.strokeStyle = '#0c4a6e'; // tripod legs
        ctx.lineWidth = 2.5;
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * TAU + Math.PI / 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3);
          ctx.lineTo(Math.cos(a) * (e.r + 3), Math.sin(a) * (e.r + 3));
          ctx.stroke();
        }
        ctx.fillStyle = '#082f49'; // sensor body
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, e.r * 0.7, 0, TAU); ctx.fill(); ctx.stroke();
        const pa = U.ang(e.x, e.y, G.player.x, G.player.y);
        ctx.save();
        ctx.rotate(pa);
        ctx.fillStyle = '#0ea5e9'; // long rail
        ctx.fillRect(2, -1.75, e.r + 14, 3.5);
        ctx.fillStyle = '#7dd3fc';
        ctx.fillRect(e.r + 12, -1, 4, 2);
        ctx.restore();
        const glow = 2 + e.lock * 3; // scope eye brightens as it locks
        ctx.fillStyle = e.lock > 0.75 ? '#f43f5e' : '#7dd3fc';
        ctx.beginPath(); ctx.arc(0, 0, glow, 0, TAU); ctx.fill();
        break;
      }
      case 'warden': {
        for (let i = 0; i < 3; i++) { // orbiting weapon pods
          const a = e.t * 1.2 + (i / 3) * TAU;
          const px = Math.cos(a) * (e.r + 14), py = Math.sin(a) * (e.r + 14);
          ctx.fillStyle = '#2e1065';
          ctx.strokeStyle = '#7c3aed';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let j = 0; j < 6; j++) {
            const b = (j / 6) * TAU - a;
            const qx = px + Math.cos(b) * 5, qy = py + Math.sin(b) * 5;
            if (j === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
          }
          ctx.closePath();
          ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = '#1e1038'; // outer shell
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + e.t * 0.2;
          const px = Math.cos(a) * e.r, py = Math.sin(a) * e.r;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#7c3aed'; // counter-rotating inner shell
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = -e.t * 0.45 + (i / 6) * TAU;
          const px = Math.cos(a) * e.r * 0.72, py = Math.sin(a) * e.r * 0.72;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.strokeStyle = '#c4b5fd'; // spinning tri-frame
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = -e.t * 0.7 + (i / 3) * TAU;
          const px = Math.cos(a) * e.r * 0.5, py = Math.sin(a) * e.r * 0.5;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        const CORE = { radial: '#a78bfa', shotgun: '#f43f5e', spiral: '#e879f9', summon: '#4ade80' };
        const pulse = 5 + Math.sin(e.t * 6) * 2; // core hints at the next attack
        ctx.fillStyle = CORE[e.atk] || (e.hp < e.maxHp * 0.5 ? '#f43f5e' : '#c4b5fd');
        ctx.beginPath(); ctx.arc(0, 0, pulse, 0, TAU); ctx.fill();
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

  // per-weapon gun silhouettes, drawn pointing along +x
  function drawGun(ctx, id) {
    ctx.fillStyle = '#28324a';
    const col = WEAPONS[id].color;
    switch (id) {
      case 'repeater':
        ctx.fillRect(5, -4.5, 13, 3.5);
        ctx.fillRect(5, 1, 13, 3.5);
        ctx.fillStyle = col;
        ctx.fillRect(16, -4, 4, 2.5);
        ctx.fillRect(16, 1.5, 4, 2.5);
        break;
      case 'scatter':
        ctx.fillRect(4, -2.5, 9, 5);
        ctx.beginPath(); // flared muzzle
        ctx.moveTo(13, -3); ctx.lineTo(19, -5.5); ctx.lineTo(19, 5.5); ctx.lineTo(13, 3);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = col;
        ctx.fillRect(17.5, -4.5, 2, 9);
        break;
      case 'rail':
        ctx.fillRect(4, -2, 19, 4);
        ctx.fillStyle = col; // accelerator coils
        ctx.fillRect(8, -3.5, 2.5, 7);
        ctx.fillRect(13, -3.5, 2.5, 7);
        ctx.fillRect(18, -3.5, 2.5, 7);
        ctx.fillRect(23, -1.5, 3, 3);
        break;
      case 'nova':
        ctx.fillRect(5, -4.5, 13, 9);
        ctx.fillStyle = col; // charge ring
        ctx.fillRect(9, -5.5, 3, 11);
        ctx.fillStyle = '#0c0f16'; // muzzle bore
        ctx.beginPath(); ctx.arc(18, 0, 3, 0, TAU); ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(18, 0, 3, 0, TAU); ctx.stroke();
        break;
      default: // pulse
        ctx.fillRect(5, -2.5, 12, 5);
        ctx.fillStyle = col;
        ctx.fillRect(15, -2, 5, 4);
    }
  }

  function drawPlayer(ctx, G) {
    const p = G.player;
    for (const tp of G.trail) { // dash afterimages
      ctx.globalAlpha = U.clamp(tp.t / 0.22, 0, 1) * 0.35;
      ctx.fillStyle = '#4ade80';
      ctx.beginPath(); ctx.arc(tp.x, tp.y, p.r * 0.8, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.invuln > 0 && Math.sin(G.time * 36) > 0) ctx.globalAlpha = 0.45;
    if (p.moving) { // thruster flame opposite travel
      const flick = 4 + Math.sin(G.time * 40) * 2.5;
      ctx.save();
      ctx.rotate(p.moveAng + Math.PI);
      ctx.fillStyle = 'rgba(125,249,255,0.75)';
      ctx.beginPath();
      ctx.moveTo(p.r - 1, 3.5);
      ctx.lineTo(p.r + 5 + flick, 0);
      ctx.lineTo(p.r - 1, -3.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.moveTo(p.r - 1, 1.5);
      ctx.lineTo(p.r + 2 + flick * 0.4, 0);
      ctx.lineTo(p.r - 1, -1.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.shadowColor = '#4ade80';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#0d2818'; // hull
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.rotate(p.aimAng);
    ctx.fillStyle = '#1c4532'; // rear thruster pods
    ctx.fillRect(-p.r - 2, -7.5, 5, 5);
    ctx.fillRect(-p.r - 2, 2.5, 5, 5);
    ctx.strokeStyle = '#86efac'; // armor plate seams
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, p.r - 3, 1.9, 2.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, p.r - 3, -2.9, -1.9); ctx.stroke();
    ctx.fillStyle = '#bbf7d0'; // cockpit visor facing aim
    ctx.beginPath(); ctx.arc(3.5, 0, 4.5, -1.1, 1.1); ctx.fill();
    drawGun(ctx, p.guns[p.gunIndex].id);
    ctx.restore();
    if (p.dashCD > 0 && G.state === 'play') { // dash cooldown ring
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - p.dashCD / p.dashCDMax));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // small icon glyphs for stat items, drawn centered at origin
  function drawItemGlyph(ctx, id, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    switch (id) {
      case 'overclock': // lightning bolt
        ctx.moveTo(2, -6); ctx.lineTo(-3, 1); ctx.lineTo(0.5, 1); ctx.lineTo(-2, 6); ctx.lineTo(3.5, -1); ctx.lineTo(0, -1);
        ctx.closePath(); ctx.fill();
        break;
      case 'servo': // double chevron
        ctx.moveTo(-5, -4); ctx.lineTo(-1, 0); ctx.lineTo(-5, 4);
        ctx.moveTo(0, -4); ctx.lineTo(4, 0); ctx.lineTo(0, 4);
        ctx.stroke();
        break;
      case 'flux': // recharge swirl with arrowhead
        ctx.arc(0, 0, 4.5, 0.5, TAU - 0.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(4.5, -2.5); ctx.lineTo(6.5, 1); ctx.lineTo(2.5, 1);
        ctx.closePath(); ctx.fill();
        break;
      case 'phase': // arrow through a barrier
        ctx.moveTo(-6, 0); ctx.lineTo(4, 0);
        ctx.moveTo(1.5, -3); ctx.lineTo(5, 0); ctx.lineTo(1.5, 3);
        ctx.stroke();
        ctx.fillRect(-1.5, -6, 2, 4);
        ctx.fillRect(-1.5, 2, 2, 4);
        break;
      case 'ricochet': // bouncing zigzag
        ctx.moveTo(-6, -4); ctx.lineTo(-1, 4); ctx.lineTo(2, -3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(5, -6); ctx.lineTo(2.5, -2.5); ctx.lineTo(-0.5, -4.5);
        ctx.closePath(); ctx.fill();
        break;
      case 'hull': // plus
        ctx.fillRect(-1.5, -5.5, 3, 11);
        ctx.fillRect(-5.5, -1.5, 11, 3);
        break;
    }
  }

  function drawPickup(ctx, G, pk) {
    const bob = Math.sin(G.time * 3 + pk.t) * 2.5;
    ctx.save();
    ctx.translate(pk.x, pk.y + bob);
    switch (pk.kind) {
      case 'credit': {
        ctx.rotate(G.time * 2 + pk.t);
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.moveTo(0, -6); ctx.lineTo(5, 0); ctx.lineTo(0, 6); ctx.lineTo(-5, 0);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fef3c7';
        ctx.beginPath();
        ctx.moveTo(0, -2.5); ctx.lineTo(2, 0); ctx.lineTo(0, 2.5); ctx.lineTo(-2, 0);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'cell': {
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#0c4a6e';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.fillRect(-5, -7, 10, 14);
        ctx.strokeRect(-5, -7, 10, 14);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(-2, -9, 4, 2); // terminal
        const lv = 3 + Math.abs(Math.sin(G.time * 2 + pk.t)) * 8;
        ctx.fillRect(-3.5, 5 - lv, 7, lv); // charge level
        break;
      }
      case 'heart': {
        ctx.shadowColor = '#f87171';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#7f1d1d';
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 1.5;
        ctx.fillRect(-7, -7, 14, 14);
        ctx.strokeRect(-7, -7, 14, 14);
        ctx.fillStyle = '#fecaca';
        ctx.fillRect(-1.5, -5, 3, 10);
        ctx.fillRect(-5, -1.5, 10, 3);
        break;
      }
      case 'item': { // stat upgrade: glowing hex capsule on a ground ring
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
        ctx.fillStyle = '#0b0e16';
        ctx.strokeStyle = it.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); // rotating hex frame
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + G.time * 1.2;
          const px = Math.cos(a) * 11, py = Math.sin(a) * 11;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        drawItemGlyph(ctx, pk.val, it.color);
        break;
      }
    }
    ctx.restore();
  }

  return {
    ENEMY_DEFS, ITEMS, ITEM_IDS, spawn, update, eShoot, damageEnemy, damageCrate, boom,
    burst, addText, showBanner, spawnPickup, dropLoot,
    drawEnemy, drawPlayer, drawPickup,
  };
})();
