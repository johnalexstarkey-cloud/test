'use strict';
// smoke.js — headless smoke test for VOIDRUNNER (run: node test/smoke.js)
//
// Stubs the browser APIs (canvas 2D context, AudioContext, DOM events) with an
// "absorbing proxy", loads the game scripts in a vm sandbox, then:
//   1. fuzzes the level generator (connectivity, gates, fixtures) across 60 floors
//   2. simulates a full play session frame-by-frame (combat, boss, pickups,
//      weapon swaps, floor transitions, death, restart)
// Any uncaught exception or failed assertion exits non-zero.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('  FAIL: ' + msg); }
}

// universal absorbing proxy: every property access / call / construct returns
// another proxy; numeric coercion yields 0 (for canvas + audio APIs)
function absorb() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'width' || k === 'height' || k === 'length') return 0;
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
    construct() { return proxy; },
  });
  return proxy;
}

// ── sandbox ──

const winHandlers = {};
const canvasHandlers = {};
const rafQueue = [];

const canvas = {
  width: 0, height: 0, style: {},
  getContext: () => absorb(),
  addEventListener: (type, fn) => { (canvasHandlers[type] = canvasHandlers[type] || []).push(fn); },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
};

const sandbox = {
  console,
  Math, JSON, Map, Set, Array, Object, Number, String, Boolean, Infinity, NaN,
  Uint8Array, Promise, Symbol, Proxy, Date, parseInt, parseFloat, isNaN, isFinite,
  innerWidth: 1280, innerHeight: 720,
  document: { getElementById: () => canvas },
  localStorage: { getItem: () => null, setItem: () => {} },
  performance: { now: () => 0 },
  requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
  setInterval: () => 0,
  clearInterval: () => {},
  AudioContext: absorb(),
  addEventListener: (type, fn) => { (winHandlers[type] = winHandlers[type] || []).push(fn); },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const files = ['utils.js', 'audio.js', 'input.js', 'weapons.js', 'map.js', 'entities.js', 'game.js'];
const src = files
  .map((f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'))
  .join('\n;\n');
vm.runInContext(src, sandbox, { filename: 'bundle.js' });

const Game = sandbox.window.Game;
const G = Game.G;

// event dispatch helpers
const noop = () => {};
function key(type, code) {
  for (const fn of winHandlers[type] || []) fn({ code, repeat: false, preventDefault: noop });
}
function mouse(type, x = 640, y = 360) {
  const hs = type === 'mouseup' ? winHandlers[type] : canvasHandlers[type];
  for (const fn of hs || []) fn({ button: 0, clientX: x, clientY: y, preventDefault: noop });
}

let now = 0;
function pump(frames) {
  for (let i = 0; i < frames; i++) {
    now += 16.67;
    const cbs = rafQueue.splice(0);
    assert(cbs.length > 0, 'rAF loop alive');
    for (const cb of cbs) cb(now);
  }
}

// ── 1) level generation fuzz ──

console.log('level generation fuzz (60 floors)...');
const MapGen = vm.runInContext('MapGen', sandbox);
const TILE = vm.runInContext('TILE', sandbox);
const T_FLOOR = vm.runInContext('T_FLOOR', sandbox);
const T_EXIT = vm.runInContext('T_EXIT', sandbox);

for (let floor = 1; floor <= 60; floor++) {
  const lvl = MapGen.generate(((floor - 1) % 12) + 1);
  // spawn tile must be walkable
  const stx = Math.floor(lvl.spawn.x / TILE), sty = Math.floor(lvl.spawn.y / TILE);
  assert(!MapGen.solidAt(lvl, stx, sty), `floor ${floor}: spawn walkable`);
  // flood fill from spawn (gates unlocked) must reach pad + pedestal + every room center
  const seen = new Set([stx + ',' + sty]);
  const q = [[stx, sty]];
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (seen.has(k) || MapGen.solidAt(lvl, nx, ny)) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  const reach = (px, py, what) => {
    const k = Math.floor(px / TILE) + ',' + Math.floor(py / TILE);
    assert(seen.has(k), `floor ${floor}: ${what} reachable`);
  };
  reach(lvl.padCenter.x, lvl.padCenter.y - 1, 'exit pad');
  if (lvl.pedestal) reach(lvl.pedestal.x, lvl.pedestal.y, 'pedestal');
  for (const r of lvl.rooms) {
    // some interior tile of every room must be reachable (center may hold a crate)
    let any = false;
    for (let ty = r.y; ty < r.y + r.h && !any; ty++)
      for (let tx = r.x; tx < r.x + r.w && !any; tx++)
        if (seen.has(tx + ',' + ty)) any = true;
    assert(any, `floor ${floor}: room ${r.idx} (${r.type}) reachable`);
    // every gate mouth (doorway) must be reachable while unlocked
    for (const grp of r.gates)
      for (const g of grp)
        assert(seen.has(g.x + ',' + g.y), `floor ${floor}: room ${r.idx} gate reachable`);
    if (r.type === 'combat' || r.type === 'boss') {
      assert(r.gates.length > 0, `floor ${floor}: room ${r.idx} has gates`);
    }
  }
  // pad tiles really are T_EXIT
  const ptx = Math.floor(lvl.padCenter.x / TILE), pty = Math.floor(lvl.padCenter.y / TILE);
  assert(lvl.grid[(pty - 1) * lvl.W + (ptx - 1)] === T_EXIT, `floor ${floor}: pad carved`);
}
console.log('  ok');

// ── 2) simulated play session ──

console.log('simulated session: menu -> run...');
pump(5);
assert(G.state === 'menu', 'starts in menu');
mouse('mousedown'); mouse('mouseup');
pump(2);
assert(G.state === 'play', 'click starts run');
assert(G.player && G.level, 'player + level exist');

console.log('wander + combat on floor 1...');
key('keydown', 'KeyD');
mouse('mousedown'); // hold fire
let locksSeen = 0, enemiesSeen = 0;
for (let i = 0; i < 14; i++) {
  // teleport player into each room in turn to force lockdowns + combat
  const room = G.level.rooms[i % G.level.rooms.length];
  G.player.x = room.cx;
  G.player.y = room.cy;
  mouse('mousemove', 200 + (i * 137) % 800, 100 + (i * 211) % 500);
  pump(90); // ~1.5s per room
  if (room.locked) locksSeen++;
  enemiesSeen = Math.max(enemiesSeen, G.enemies.length);
  if (i % 4 === 0) { key('keydown', 'Space'); key('keyup', 'Space'); } // dash
  if (i % 5 === 0) { key('keydown', 'KeyQ'); key('keyup', 'KeyQ'); }  // swap
}
assert(enemiesSeen > 0, 'enemies spawned during combat');
assert(G.kills >= 0 && G.pBullets.length >= 0, 'combat state sane');
mouse('mouseup');
key('keyup', 'KeyD');

console.log('pickups...');
const Ent = vm.runInContext('Ent', sandbox);
G.player.x = G.level.rooms[0].cx; // start room: always safe
G.player.y = G.level.rooms[0].cy;
G.player.hp = 2;
G.player.invuln = 5;
Ent.spawnPickup(G, G.player.x, G.player.y, 'heart', 1);
Ent.spawnPickup(G, G.player.x, G.player.y, 'credit', 3);
Ent.spawnPickup(G, G.player.x, G.player.y, 'cell', 1);
const creditsBefore = G.credits, hpBefore = G.player.hp;
pump(30);
assert(G.credits > creditsBefore, 'credits collected');
assert(G.player.hp > hpBefore, 'heart collected');

console.log('stat upgrade items...');
{
  const p = G.player;
  p.x = G.level.rooms[0].cx;
  p.y = G.level.rooms[0].cy;
  p.invuln = 9;
  const before = {
    fr: p.stats.fireRate, sp: p.stats.speed, dc: p.stats.dashCD,
    pierce: p.stats.pierce, bounce: p.stats.bounce, maxHp: p.maxHp,
  };
  const ids = vm.runInContext('Ent.ITEM_IDS', sandbox);
  assert(ids.length === 6, 'six item types defined');
  for (const id of ids) {
    Ent.spawnPickup(G, p.x, p.y, 'item', id);
    pump(3);
  }
  assert(p.stats.fireRate > before.fr, 'fire rate item applied');
  assert(p.stats.speed > before.sp, 'move speed item applied');
  assert(p.stats.dashCD < before.dc, 'dash recharge item applied');
  assert(p.stats.pierce === before.pierce + 1, 'pierce item applied');
  assert(p.stats.bounce === before.bounce + 1, 'bounce item applied');
  assert(p.maxHp === before.maxHp + 1, 'hull item applied');
  assert(Object.keys(p.itemCounts).length === 6, 'item counts tracked for HUD');
}

console.log('bullet bounce off walls...');
{
  // clear every enemy so nothing intercepts the test bullet (splitters may split, so repeat)
  for (let k = 0; k < 3; k++) {
    for (const e of G.enemies) Ent.damageEnemy(G, e, 1e9);
    pump(2);
  }
  const p = G.player;
  p.x = G.level.rooms[0].cx;
  p.y = G.level.rooms[0].cy;
  G.pBullets.length = 0;
  G.pBullets.push({
    x: p.x, y: p.y, vx: 0, vy: -500, dmg: 1, r: 3.5, life: 5.0, color: '#fff',
    pierceLeft: 0, bounceLeft: 1, rail: false, boom: 0, boomDmg: 0, hit: null, dead: false,
  });
  let flipped = false;
  for (let i = 0; i < 150 && !flipped; i++) { // a wall lies within ~2.5s in any direction
    pump(1);
    if (G.pBullets.length && G.pBullets[0].vy > 0) flipped = true;
  }
  assert(flipped, 'bullet reflected off a wall');
  assert(G.pBullets.length === 1 && G.pBullets[0].bounceLeft === 0, 'bounce charge consumed');
  pump(320); // outlives its 5s lifetime
  assert(G.pBullets.length === 0, 'bounced bullet eventually expires');
}

console.log('splitter splits on death...');
{
  const room = G.level.rooms[0];
  const before = G.enemies.length;
  const sp = Ent.spawn(G, 'splitter', room.cx + 64, room.cy, room.idx);
  sp.warp = 0;
  Ent.damageEnemy(G, sp, 1e9);
  pump(2);
  assert(G.enemies.filter((e) => e.kind === 'skitter' && !e.dead).length >= 2,
    'splitter spawned skitters (enemies before=' + before + ')');
  for (const e of G.enemies) Ent.damageEnemy(G, e, 1e9); // clean up
  pump(2);
}

console.log('weapon pedestal...');
Game.loadFloor(2);
pump(5);
if (G.pedestal) {
  const gunsBefore = G.player.guns.length;
  G.player.x = G.pedestal.x;
  G.player.y = G.pedestal.y;
  pump(5);
  assert(G.pedestal.taken, 'pedestal taken');
  assert(G.player.guns.length > gunsBefore || G.pedestal.weaponId === null, 'weapon added');
}

console.log('floor transition via pad...');
G.level.rooms[G.level.exitIdx].cleared = true;
G.player.x = G.level.padCenter.x;
G.player.y = G.level.padCenter.y - TILE / 2;
pump(150); // channel 0.9s + fade 1.0s
assert(G.floor === 3, 'descended to floor 3 (got ' + G.floor + ')');
assert(G.state === 'play', 'transition resolves to play');

console.log('boss fight (floor 3 is a warden sector)...');
assert(G.level.isBoss, 'floor 3 flagged as boss floor');
const bossRoom = G.level.rooms[G.level.exitIdx];
G.player.x = bossRoom.cx;
G.player.y = bossRoom.cy + TILE;
pump(10);
assert(G.boss !== null, 'warden spawned');
assert(bossRoom.locked, 'boss room locked');
mouse('mousedown');
let sawBullets = false;
for (let i = 0; i < 20; i++) { // ~10s of patterns, kept alive for the duration
  G.player.hp = G.player.maxHp;
  G.player.invuln = 2;
  pump(30);
  if (G.eBullets.length > 0) sawBullets = true;
}
assert(sawBullets, 'boss fired bullet patterns');
mouse('mouseup');
// finish it off deterministically and check rewards
const maxHpBefore = G.player.maxHp;
G.player.hp = G.player.maxHp;
G.player.invuln = 9;
if (G.boss) Ent.damageEnemy(G, G.boss, 1e9);
for (const e of G.enemies) if (!e.dead && e.roomIdx === bossRoom.idx) Ent.damageEnemy(G, e, 1e9);
pump(5);
assert(G.boss === null, 'warden defeated');
assert(G.player.maxHp === Math.min(10, maxHpBefore + 1), 'hull upgrade granted');
assert(bossRoom.cleared, 'boss room cleared');

console.log('death + restart...');
G.player.invuln = 0;
G.player.hp = 1;
Game.hurtPlayer(1);
pump(5);
assert(G.state === 'dead', 'death triggers game over');
pump(60);
mouse('mousedown'); mouse('mouseup');
pump(5);
assert(G.state === 'play' && G.floor === 1, 'restart returns to sector 1');

console.log('long soak: 20 floors of teleport + fight...');
for (let f = 1; f <= 20; f++) {
  Game.loadFloor(f);
  mouse('mousedown');
  for (const room of G.level.rooms) {
    G.player.x = room.cx;
    G.player.y = room.cy;
    G.player.hp = G.player.maxHp; // keep alive; we're testing for crashes
    G.player.invuln = 2;
    pump(45);
  }
  mouse('mouseup');
}
assert(G.state === 'play' || G.state === 'dead', 'soak ends in a valid state');

if (failures === 0) {
  console.log('\nALL SMOKE TESTS PASSED');
  process.exit(0);
} else {
  console.error('\n' + failures + ' FAILURE(S)');
  process.exit(1);
}
