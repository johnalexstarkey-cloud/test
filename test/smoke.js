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

// pump frames, auto-picking the first boon whenever a level-up interrupts
function settle(frames) {
  for (let i = 0; i < frames; i++) {
    pump(1);
    if (G && G.state === 'levelup') { key('keydown', 'Digit1'); key('keyup', 'Digit1'); }
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
  // crates splinter in one hit
  for (const hp of lvl.crates.values()) assert(hp === 1, `floor ${floor}: crates are one-hit`);
  // the deep jungle begins past the first colossus
  const f = ((floor - 1) % 12) + 1;
  assert(lvl.area === (f <= 3 ? 'coast' : 'deep'), `floor ${floor}: area assignment`);
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
assert(Object.keys(G.player.itemCounts).length === 1, 'voyage begins with a treasure');
assert(G.splash && G.splash.t < 2.4, 'starting treasure splash shown');

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
  settle(90); // ~1.5s per room, auto-picking any level-up boons
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
settle(30);
assert(G.credits > creditsBefore, 'credits collected');
assert(G.player.hp > hpBefore, 'heart collected');

console.log('level-up boons...');
{
  const p = G.player;
  settle(5); // flush any pending boons first
  G.xp = G.xpNeed - 1;
  const lvlBefore = G.plvl;
  const v = Ent.spawn(G, 'viper', p.x + 60, p.y, 0);
  v.warp = 0;
  p.invuln = 9;
  Ent.damageEnemy(G, v, 1e9); // the kill tips the XP over
  pump(2);
  assert(G.state === 'levelup', 'level-up triggered (state=' + G.state + ')');
  assert(G.lvlChoices.length === 3, 'three boons offered');
  const snap = JSON.stringify([p.stats, p.maxHp]);
  key('keydown', 'Digit1'); key('keyup', 'Digit1');
  pump(2);
  assert(G.plvl === lvlBefore + 1, 'level increased');
  assert(G.state === 'play', 'play resumes after the choice');
  assert(JSON.stringify([p.stats, p.maxHp]) !== snap, 'a stat improved');
}

console.log('treasure items (stackable buffs)...');
{
  const p = G.player;
  p.x = G.level.rooms[0].cx;
  p.y = G.level.rooms[0].cy;
  p.invuln = 9;
  const ids = vm.runInContext('Ent.ITEM_IDS', sandbox);
  assert(ids.length === 8, 'eight treasures defined');
  for (const id of ids) {
    Ent.spawnPickup(G, p.x, p.y, 'item', id);
    settle(3);
  }
  for (const id of ids) assert(p.itemCounts[id] >= 1, 'collected ' + id);
  assert(G.splash !== null, 'item splash card shown on pickup');

  // voodoo doll: getting hit hurts every foe in the room
  const v = Ent.spawn(G, 'viper', p.x + 80, p.y, 0);
  v.warp = 0; v.spd = 0;
  settle(1);
  const vHp = v.hp;
  p.invuln = 0;
  Game.hurtPlayer(1);
  assert(v.dead || v.hp < vHp, 'voodoo doll shared the pain');
  p.invuln = 9;

  // cannonball: rolling through a foe damages it
  const v2 = Ent.spawn(G, 'viper', p.x + 60, p.y, 0);
  v2.warp = 0; v2.spd = 0;
  settle(1);
  const v2Hp = v2.hp;
  mouse('mousemove', 1200, 360); // roll to the right, through it
  p.dashCD = 0;
  key('keydown', 'Space'); key('keyup', 'Space');
  settle(16);
  assert(v2.dead || v2.hp < v2Hp, 'cannonball roll-through damage');

  // gasoline: the roll leaves fuel, gunfire ignites it, fire burns foes
  p.x = G.level.rooms[0].cx;
  p.y = G.level.rooms[0].cy;
  p.dashCD = 0;
  key('keydown', 'Space'); key('keyup', 'Space');
  settle(16);
  assert(G.gas.length > 0, 'gasoline trail dropped');
  const g0 = G.gas[0];
  const v3 = Ent.spawn(G, 'viper', g0.x, g0.y, 0);
  v3.warp = 0; v3.spd = 0;
  G.pBullets.push({ // a shot across the puddle
    x: g0.x - 4, y: g0.y, vx: 60, vy: 0, dmg: 1, r: 3, life: 0.5, color: '#fff',
    pierceLeft: 0, bounceLeft: 0, rail: false, boom: 0, boomDmg: 0, hit: null, dead: false,
  });
  settle(50);
  assert(G.gas.some((g) => g.burn) || G.gas.length === 0, 'fuel ignited by gunfire');
  assert(v3.dead || v3.hp < v3.maxHp, 'fire burned the foe standing in it');

  // powder parrot: dive-bombs a nearby foe
  const v4 = Ent.spawn(G, 'viper', p.x + 90, p.y + 20, 0);
  v4.warp = 0; v4.spd = 0;
  settle(240); // a few seconds: orbit, dive, peck
  assert(v4.dead || v4.hp < v4.maxHp, 'parrot dive-bombed the foe');
  for (const e of G.enemies) Ent.damageEnemy(G, e, 1e9);
  settle(4);
}

console.log('bullet bounce off walls...');
{
  // clear every enemy so nothing intercepts the test bullet (splitters may split, so repeat)
  for (let k = 0; k < 3; k++) {
    for (const e of G.enemies) Ent.damageEnemy(G, e, 1e9);
    settle(2);
  }
  const p = G.player;
  const r0 = G.level.rooms[0];
  p.x = r0.cx;
  p.y = r0.cy;
  // fire up a column that has a wall directly above the room (door gaps align
  // with cell centerlines, so the center column can thread through every door)
  let fx = r0.cx;
  for (let tx = r0.x + 1; tx < r0.x + r0.w - 1; tx++) {
    if (MapGen.solidAt(G.level, tx, r0.y - 1)) { fx = (tx + 0.5) * TILE; break; }
  }
  G.pBullets.length = 0;
  G.pBullets.push({
    x: fx, y: p.y, vx: 0, vy: -500, dmg: 1, r: 3.5, life: 5.0, color: '#fff',
    pierceLeft: 0, bounceLeft: 1, rail: false, boom: 0, boomDmg: 0, hit: null, dead: false,
  });
  let flipped = false;
  for (let i = 0; i < 150 && !flipped; i++) { // a wall lies within ~2.5s in any direction
    settle(1);
    if (G.pBullets.length && G.pBullets[0].vy > 0) flipped = true;
  }
  assert(flipped, 'bullet reflected off a wall');
  assert(G.pBullets.length === 1 && G.pBullets[0].bounceLeft === 0, 'bounce charge consumed');
  settle(320); // outlives its 5s lifetime
  assert(G.pBullets.length === 0, 'bounced bullet eventually expires');
}

console.log('brood python hatches on death...');
{
  const room = G.level.rooms[0];
  const before = G.enemies.length;
  const sp = Ent.spawn(G, 'brood', room.cx + 64, room.cy, room.idx);
  sp.warp = 0;
  Ent.damageEnemy(G, sp, 1e9);
  settle(2);
  assert(G.enemies.filter((e) => e.kind === 'viper' && !e.dead).length >= 2,
    'brood hatched vipers (enemies before=' + before + ')');
  for (const e of G.enemies) Ent.damageEnemy(G, e, 1e9); // clean up
  settle(2);
}

console.log('sword slash...');
{
  const p = G.player;
  p.x = G.level.rooms[0].cx;
  p.y = G.level.rooms[0].cy;
  p.invuln = 9;
  const swordIdx = p.guns.findIndex((g) => g.id === 'sword');
  assert(swordIdx >= 0, 'player starts with the rusty sword');
  p.gunIndex = swordIdx;
  const v = Ent.spawn(G, 'viper', p.x + 30, p.y, 0); // in slash range, toward mouse-right
  v.warp = 0; v.spd = 0;
  mouse('mousemove', 1000, 360); // aim right
  const kills = G.kills;
  mouse('mousedown');
  settle(40); // a few swings at 1 dmg vs 2 hp
  mouse('mouseup');
  assert(G.kills > kills, 'sword swings killed the viper');
  p.gunIndex = 0;
  for (const e of G.enemies) Ent.damageEnemy(G, e, 1e9);
  settle(2);
}

console.log('weapon pedestal...');
Game.loadFloor(2);
settle(5);
if (G.pedestal) {
  const gunsBefore = G.player.guns.length;
  G.player.x = G.pedestal.x;
  G.player.y = G.pedestal.y;
  settle(5);
  assert(G.pedestal.taken, 'pedestal taken');
  assert(G.player.guns.length > gunsBefore || G.pedestal.weaponId === null, 'weapon added');
}

console.log('floor transition via pad...');
G.level.rooms[G.level.exitIdx].cleared = true;
G.player.x = G.level.padCenter.x;
G.player.y = G.level.padCenter.y - TILE / 2;
settle(150); // channel 0.9s + fade 1.0s
assert(G.floor === 3, 'descended to floor 3 (got ' + G.floor + ')');
assert(G.state === 'play', 'transition resolves to play');

console.log('boss fight (floor 3 is a warden sector)...');
assert(G.level.isBoss, 'floor 3 flagged as boss floor');
const bossRoom = G.level.rooms[G.level.exitIdx];
G.player.x = bossRoom.cx;
G.player.y = bossRoom.cy + TILE;
settle(10);
assert(G.boss !== null, 'warden spawned');
assert(bossRoom.locked, 'boss room locked');
mouse('mousedown');
let sawBullets = false;
for (let i = 0; i < 20; i++) { // ~10s of patterns, kept alive for the duration
  G.player.hp = G.player.maxHp;
  G.player.invuln = 2;
  settle(30);
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
settle(5);
assert(G.boss === null, 'colossus defeated');
assert(G.player.maxHp >= Math.min(12, maxHpBefore + 1), 'health upgrade granted');
assert(bossRoom.cleared, 'boss room cleared');

console.log('death + restart...');
settle(3);
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
    settle(45);
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
