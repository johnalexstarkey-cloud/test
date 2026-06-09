'use strict';
// entities.js — enemies (AI + boss), damage, loot, pickups, particles, fx (global Ent)

const Ent = (() => {
  const ENEMY_DEFS = {
    skitter: { hp: 2,   r: 9,  spd: 155, cost: 1, color: '#f87171', credits: [1, 2] },
    drone:   { hp: 3,   r: 11, spd: 90,  cost: 2, color: '#fb7185', credits: [1, 3] },
    turret:  { hp: 5,   r: 12, spd: 0,   cost: 2, color: '#f59e0b', credits: [1, 3] },
    gunner:  { hp: 7,   r: 13, spd: 62,  cost: 3, color: '#e879f9', credits: [2, 4] },
    orbiter: { hp: 5,   r: 11, spd: 80,  cost: 3, color: '#22d3ee', credits: [2, 4] },
    warden:  { hp: 130, r: 30, spd: 55,  cost: 0, color: '#a78bfa', credits: [15, 25] },
  };

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
      case 'orbiter': { // circles the player, radial rings
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
    const p = G.player;
    p.maxHp = Math.min(10, p.maxHp + 1);
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
      vx: U.rand(-50, 50), vy: U.rand(-50, 50), dead: false,
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

  // ── drawing ──

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
        ctx.fillStyle = '#3a0d0d';
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.r + 3, 0);
        ctx.lineTo(-e.r * 0.7, e.r * 0.75);
        ctx.lineTo(-e.r * 0.3, 0);
        ctx.lineTo(-e.r * 0.7, -e.r * 0.75);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        break;
      }
      case 'drone': {
        ctx.fillStyle = '#3f0f1a';
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill(); ctx.stroke();
        for (let i = 0; i < 3; i++) { // spinning rotor stubs
          const a = e.t * 3 + (i / 3) * TAU;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * e.r, Math.sin(a) * e.r);
          ctx.lineTo(Math.cos(a) * (e.r + 5), Math.sin(a) * (e.r + 5));
          ctx.stroke();
        }
        const pa = U.ang(e.x, e.y, G.player.x, G.player.y);
        ctx.fillStyle = '#fda4af';
        ctx.beginPath();
        ctx.arc(Math.cos(pa) * 4, Math.sin(pa) * 4, 3, 0, TAU);
        ctx.fill();
        break;
      }
      case 'turret': {
        ctx.fillStyle = '#3b2503';
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.fillRect(-e.r, -e.r, e.r * 2, e.r * 2);
        ctx.strokeRect(-e.r, -e.r, e.r * 2, e.r * 2);
        ctx.rotate(e.aim);
        ctx.fillStyle = e.color;
        ctx.fillRect(0, -3, e.r + 8, 6);
        ctx.fillStyle = '#fde68a';
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
        break;
      }
      case 'gunner': {
        ctx.fillStyle = '#3b0a3d';
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
        const pa = U.ang(e.x, e.y, G.player.x, G.player.y);
        ctx.rotate(pa);
        ctx.fillStyle = e.color;
        ctx.fillRect(2, -6, e.r + 4, 3);
        ctx.fillRect(2, 3, e.r + 4, 3);
        break;
      }
      case 'orbiter': {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.stroke();
        ctx.fillStyle = '#062a30';
        ctx.beginPath(); ctx.arc(0, 0, e.r * 0.5, 0, TAU); ctx.fill();
        ctx.fillStyle = e.color;
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
        for (let i = 0; i < 2; i++) {
          const a = e.t * 4 + i * Math.PI;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * (e.r + 5), Math.sin(a) * (e.r + 5), 2.5, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'warden': {
        ctx.fillStyle = '#1e1038';
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
        ctx.strokeStyle = '#c4b5fd';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = -e.t * 0.7 + (i / 3) * TAU;
          const px = Math.cos(a) * e.r * 0.55, py = Math.sin(a) * e.r * 0.55;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        const pulse = 5 + Math.sin(e.t * 6) * 2;
        ctx.fillStyle = e.hp < e.maxHp * 0.5 ? '#f43f5e' : '#c4b5fd';
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
    ctx.shadowColor = '#4ade80';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#11331f';
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.rotate(p.aimAng);
    ctx.fillStyle = '#4ade80'; // visor
    ctx.fillRect(2, -2, 6, 4);
    const wcol = WEAPONS[p.guns[p.gunIndex].id].color;
    ctx.fillStyle = '#28324a'; // gun body
    ctx.fillRect(5, -2.5, 12, 5);
    ctx.fillStyle = wcol;      // gun tip in weapon color
    ctx.fillRect(15, -2, 5, 4);
    ctx.restore();
    if (p.dashCD > 0 && G.state === 'play') { // dash cooldown ring
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - p.dashCD / 0.95));
      ctx.stroke();
      ctx.globalAlpha = 1;
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
    }
    ctx.restore();
  }

  return {
    ENEMY_DEFS, spawn, update, eShoot, damageEnemy, damageCrate, boom,
    burst, addText, showBanner, spawnPickup, dropLoot,
    drawEnemy, drawPlayer, drawPickup,
  };
})();
