'use strict';
// map.js — procedural deck generation + tile collision (global MapGen, TILE, T_*)
//
// Layout: rooms are placed on an abstract cell grid by random walk (Gungeon-style),
// then carved into a tile grid and connected with 3-tile-wide corridors along the
// cell centerlines. Each room knows its "gate" tiles (corridor mouths) which become
// solid energy gates while the room is in combat lockdown.

const TILE = 32;
const T_VOID = 0, T_FLOOR = 1, T_WALL = 2, T_CRATE = 3, T_EXIT = 4;

const MapGen = (() => {
  const CW = 28, CH = 20; // abstract layout cell size, in tiles
  const PAD = 2;          // tile padding around the whole map

  function generate(floor) {
    const isBoss = floor % 3 === 0;
    const target = Math.min(6 + Math.ceil(floor * 0.7), 10);

    // ── 1) abstract layout: random walk over cells ──
    const cells = new Map(); // "gx,gy" -> abstract index
    const abs = [];          // { gx, gy, edges:Set }
    const key = (x, y) => x + ',' + y;
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const addCell = (gx, gy) => {
      const i = abs.length;
      abs.push({ gx, gy, edges: new Set() });
      cells.set(key(gx, gy), i);
      return i;
    };
    addCell(0, 0);
    let guard = 600;
    while (abs.length < target && guard-- > 0) {
      const from = U.ri(0, abs.length - 1);
      const [dx, dy] = U.pick(DIRS);
      const nx = abs[from].gx + dx, ny = abs[from].gy + dy;
      if (cells.has(key(nx, ny))) continue;
      const i = addCell(nx, ny);
      abs[from].edges.add(i);
      abs[i].edges.add(from);
    }
    // occasional extra connections so the deck has loops
    for (let i = 0; i < abs.length; i++) {
      for (const [dx, dy] of DIRS) {
        const j = cells.get(key(abs[i].gx + dx, abs[i].gy + dy));
        if (j !== undefined && j > i && !abs[i].edges.has(j) && U.chance(0.12)) {
          abs[i].edges.add(j);
          abs[j].edges.add(i);
        }
      }
    }

    // ── 2) assign special rooms by graph depth ──
    const depth = new Array(abs.length).fill(-1);
    depth[0] = 0;
    const q = [0];
    while (q.length) {
      const c = q.shift();
      for (const n of abs[c].edges) if (depth[n] < 0) { depth[n] = depth[c] + 1; q.push(n); }
    }
    let exitIdx = abs.length > 1 ? 1 : 0;
    for (let i = 1; i < abs.length; i++) if (depth[i] > depth[exitIdx]) exitIdx = i;
    const leaves = [];
    for (let i = 1; i < abs.length; i++) if (i !== exitIdx && abs[i].edges.size === 1) leaves.push(i);
    let treasureIdx = -1;
    if (leaves.length) treasureIdx = U.pick(leaves);
    else for (let i = 1; i < abs.length; i++) if (i !== exitIdx) { treasureIdx = i; break; }
    let medIdx = -1;
    const medC = leaves.filter((i) => i !== treasureIdx);
    if (floor >= 2 && medC.length && U.chance(0.55)) medIdx = U.pick(medC);

    // ── 3) carve rooms into the tile grid ──
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const a of abs) {
      minX = Math.min(minX, a.gx); maxX = Math.max(maxX, a.gx);
      minY = Math.min(minY, a.gy); maxY = Math.max(maxY, a.gy);
    }
    const W = (maxX - minX + 1) * CW + PAD * 2;
    const H = (maxY - minY + 1) * CH + PAD * 2;
    const grid = new Uint8Array(W * H);
    const at = (tx, ty) => grid[ty * W + tx];
    const set = (tx, ty, v) => { grid[ty * W + tx] = v; };

    const rooms = [];
    for (let i = 0; i < abs.length; i++) {
      const gx = abs[i].gx - minX, gy = abs[i].gy - minY;
      const cellX = PAD + gx * CW, cellY = PAD + gy * CH;
      const ccx = cellX + (CW >> 1), ccy = cellY + (CH >> 1); // cell-center tile

      let type = 'combat';
      if (i === 0) type = 'start';
      else if (i === exitIdx) type = isBoss ? 'boss' : 'exit';
      else if (i === treasureIdx) type = 'treasure';
      else if (i === medIdx) type = 'medbay';

      let w, h;
      if (type === 'boss') { w = CW - 4; h = CH - 4; }
      else if (type === 'start') { w = 12; h = 9; }
      else if (type === 'treasure' || type === 'medbay') { w = 10; h = 8; }
      else if (type === 'exit') { w = 11; h = 9; }
      else { w = U.ri(14, CW - 6); h = U.ri(11, CH - 5); }

      // place so the room's floor always covers cell-center ±1 in both axes
      // (guarantees the 3-wide centerline corridors land on floor)
      const xLo = Math.max(cellX + 1, ccx + 2 - w);
      const xHi = Math.min(ccx - 1, cellX + CW - 1 - w);
      const yLo = Math.max(cellY + 1, ccy + 2 - h);
      const yHi = Math.min(ccy - 1, cellY + CH - 1 - h);
      const x = U.ri(xLo, Math.max(xLo, xHi));
      const y = U.ri(yLo, Math.max(yLo, yHi));

      for (let ty = y; ty < y + h; ty++)
        for (let tx = x; tx < x + w; tx++) set(tx, ty, T_FLOOR);

      rooms.push({
        idx: i, gx, gy, x, y, w, h, type,
        cx: (x + w / 2) * TILE, cy: (y + h / 2) * TILE,
        cleared: !(type === 'combat' || type === 'boss'),
        locked: false, visited: false, seen: false, gates: [],
      });
    }

    // ── 4) carve corridors along cell centerlines ──
    const edges = [];
    for (let i = 0; i < abs.length; i++) {
      for (const j of abs[i].edges) {
        if (j <= i) continue;
        edges.push([i, j]);
        const A = rooms[i], B = rooms[j];
        if (A.gy === B.gy) { // horizontal neighbors
          const L = A.gx < B.gx ? A : B, R = A.gx < B.gx ? B : A;
          const ccy = PAD + A.gy * CH + (CH >> 1);
          for (let tx = L.x + L.w; tx < R.x; tx++)
            for (let ty = ccy - 1; ty <= ccy + 1; ty++) set(tx, ty, T_FLOOR);
        } else { // vertical neighbors
          const T = A.gy < B.gy ? A : B, Bo = A.gy < B.gy ? B : A;
          const ccx = PAD + A.gx * CW + (CW >> 1);
          for (let ty = T.y + T.h; ty < Bo.y; ty++)
            for (let tx = ccx - 1; tx <= ccx + 1; tx++) set(tx, ty, T_FLOOR);
        }
      }
    }

    // ── 5) exit/boss teleporter pad (2x2 at room center) ──
    const exitRoom = rooms[exitIdx];
    const pcx = exitRoom.x + (exitRoom.w >> 1), pcy = exitRoom.y + (exitRoom.h >> 1);
    for (let ty = pcy - 1; ty <= pcy; ty++)
      for (let tx = pcx - 1; tx <= pcx; tx++) set(tx, ty, T_EXIT);
    const padCenter = { x: pcx * TILE, y: pcy * TILE };

    // ── 6) walls: any void tile touching floor ──
    const floorish = (v) => v === T_FLOOR || v === T_EXIT;
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        if (at(tx, ty) !== T_VOID) continue;
        let touch = false;
        for (let oy = -1; oy <= 1 && !touch; oy++)
          for (let ox = -1; ox <= 1 && !touch; ox++) {
            const nx = tx + ox, ny = ty + oy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && floorish(at(nx, ny))) touch = true;
          }
        if (touch) set(tx, ty, T_WALL);
      }
    }

    // ── 7) gates: corridor mouths just outside each room's rect ──
    const gateMap = new Map(); // "tx,ty" -> room idx
    for (const r of rooms) {
      const sides = [
        { x0: r.x - 1, y0: r.y, dx: 0, dy: 1, n: r.h },
        { x0: r.x + r.w, y0: r.y, dx: 0, dy: 1, n: r.h },
        { x0: r.x, y0: r.y - 1, dx: 1, dy: 0, n: r.w },
        { x0: r.x, y0: r.y + r.h, dx: 1, dy: 0, n: r.w },
      ];
      for (const s of sides) {
        let run = [];
        for (let i = 0; i <= s.n; i++) {
          const tx = s.x0 + s.dx * i, ty = s.y0 + s.dy * i;
          const isFloor = i < s.n && at(tx, ty) === T_FLOOR;
          if (isFloor) run.push({ x: tx, y: ty });
          else if (run.length) { r.gates.push(run); run = []; }
        }
      }
      for (const grp of r.gates)
        for (const g of grp) gateMap.set(g.x + ',' + g.y, r.idx);
    }

    // ── 8) crates for cover in combat rooms ──
    const crates = new Map(); // "tx,ty" -> hp
    for (const r of rooms) {
      if (r.type !== 'combat') continue;
      const n = U.ri(3, 7);
      for (let i = 0; i < n; i++) {
        for (let t = 0; t < 30; t++) {
          const tx = U.ri(r.x + 2, r.x + r.w - 3), ty = U.ri(r.y + 2, r.y + r.h - 3);
          if (at(tx, ty) !== T_FLOOR) continue;
          let nearGate = false;
          for (const grp of r.gates)
            for (const g of grp)
              if (Math.max(Math.abs(g.x - tx), Math.abs(g.y - ty)) <= 2) nearGate = true;
          if (nearGate) continue;
          set(tx, ty, T_CRATE);
          crates.set(tx + ',' + ty, 3);
          break;
        }
      }
    }

    // ── 9) fixtures ──
    let pedestal = null;
    if (treasureIdx >= 0) {
      const r = rooms.find((rr) => rr.idx === treasureIdx);
      pedestal = { x: r.cx, y: r.cy };
    }
    const medkits = [];
    if (medIdx >= 0) {
      const r = rooms.find((rr) => rr.idx === medIdx);
      medkits.push({ x: r.cx - TILE, y: r.cy }, { x: r.cx + TILE, y: r.cy });
    }
    const spawn = { x: rooms[0].cx, y: rooms[0].cy };

    // per-tile room ownership (for floor tinting; -1 = corridor)
    const roomOf = new Int16Array(W * H).fill(-1);
    for (const r of rooms)
      for (let ty = r.y; ty < r.y + r.h; ty++)
        for (let tx = r.x; tx < r.x + r.w; tx++) roomOf[ty * W + tx] = r.idx;

    return {
      grid, W, H, rooms, edges, gateMap, crates, roomOf,
      spawn, padCenter, pedestal, medkits,
      exitIdx, treasureIdx, floor, isBoss,
    };
  }

  // ── collision / queries ──

  function solidAt(level, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= level.W || ty >= level.H) return true;
    const v = level.grid[ty * level.W + tx];
    if (v === T_FLOOR || v === T_EXIT) {
      const g = level.gateMap.get(tx + ',' + ty);
      return g !== undefined && level.rooms[g].locked;
    }
    return true; // void, wall, crate
  }

  function resolve(level, e, sx, sy) {
    const r = e.r;
    const tx0 = Math.floor((e.x - r) / TILE), tx1 = Math.floor((e.x + r) / TILE);
    const ty0 = Math.floor((e.y - r) / TILE), ty1 = Math.floor((e.y + r) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!solidAt(level, tx, ty)) continue;
        if (sx > 0) e.x = Math.min(e.x, tx * TILE - r - 0.01);
        else if (sx < 0) e.x = Math.max(e.x, (tx + 1) * TILE + r + 0.01);
        else if (sy > 0) e.y = Math.min(e.y, ty * TILE - r - 0.01);
        else if (sy < 0) e.y = Math.max(e.y, (ty + 1) * TILE + r + 0.01);
      }
    }
  }

  // axis-separated movement with wall sliding
  function moveEntity(level, e, dx, dy) {
    if (dx !== 0) { e.x += dx; resolve(level, e, dx > 0 ? 1 : -1, 0); }
    if (dy !== 0) { e.y += dy; resolve(level, e, 0, dy > 0 ? 1 : -1); }
  }

  function raycastClear(level, x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(d / 10));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const tx = Math.floor((x0 + (x1 - x0) * t) / TILE);
      const ty = Math.floor((y0 + (y1 - y0) * t) / TILE);
      if (solidAt(level, tx, ty)) return false;
    }
    return true;
  }

  function roomAt(level, px, py) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    for (const r of level.rooms)
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return r;
    return null;
  }

  // random clear floor tile inside a room (for enemy spawns), away from a point and gates
  function randFloorInRoom(level, room, opts = {}) {
    for (let i = 0; i < 60; i++) {
      const tx = U.ri(room.x + 1, room.x + room.w - 2);
      const ty = U.ri(room.y + 1, room.y + room.h - 2);
      if (level.grid[ty * level.W + tx] !== T_FLOOR) continue;
      const px = (tx + 0.5) * TILE, py = (ty + 0.5) * TILE;
      if (opts.awayFromX !== undefined &&
          U.dist(px, py, opts.awayFromX, opts.awayFromY) < (opts.minDist || 0)) continue;
      let nearGate = false;
      for (const grp of room.gates)
        for (const g of grp)
          if (Math.abs(g.x - tx) + Math.abs(g.y - ty) < 3) nearGate = true;
      if (nearGate) continue;
      return { x: px, y: py };
    }
    return null;
  }

  return { generate, solidAt, moveEntity, raycastClear, roomAt, randFloorInRoom };
})();
