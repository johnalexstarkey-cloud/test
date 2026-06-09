'use strict';
// browser.js — real-browser visual check (run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node test/browser.js)
// Serves the game, drives a few seconds of play in headless Chromium,
// fails on any page error, and saves screenshots to test/shots/.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const shots = path.join(__dirname, 'shots');
  fs.mkdirSync(shots, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('http://localhost:' + port + '/');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(shots, '1-menu.png') });

  // start the run
  await page.mouse.move(640, 360);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(shots, '2-start.png') });

  // walk into a combat room (teleport via the debug handle, then fight for real)
  await page.evaluate(() => {
    const { G } = window.Game;
    const room = G.level.rooms.find((r) => r.type === 'combat') || G.level.rooms[1];
    G.player.x = room.cx;
    G.player.y = room.cy;
  });
  await page.mouse.move(900, 300);
  await page.mouse.down();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1800);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyD');
  await page.evaluate(() => { // dismiss any pending level-up so the shot shows combat
    const G = window.Game.G;
    if (G.state === 'levelup') { G.pendingLevels = 0; G.state = 'play'; }
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(shots, '3-combat.png') });
  await page.mouse.up();

  // boss arena
  await page.evaluate(() => {
    const { G, loadFloor } = window.Game;
    loadFloor(3);
    const room = G.level.rooms[G.level.exitIdx];
    G.player.x = room.cx;
    G.player.y = room.cy + 96;
  });
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const G = window.Game.G;
    G.player.hp = G.player.maxHp;
    if (G.state === 'levelup') { G.pendingLevels = 0; G.state = 'play'; }
  });
  await page.waitForTimeout(2400);
  await page.evaluate(() => {
    const G = window.Game.G;
    if (G.state === 'levelup') { G.pendingLevels = 0; G.state = 'play'; }
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(shots, '4-boss.png') });

  // art showcase: one of each enemy + all stat items in the start room
  await page.evaluate(() => {
    const { G, loadFloor } = window.Game;
    loadFloor(1);
    const r = G.level.rooms[0];
    G.player.x = r.cx;
    G.player.y = r.cy + 70;
    const kinds = [
      ['viper', 'tribesman', 'totem', 'constrictor', 'hunter', 'brood'],
      ['shaman', 'headhunter', 'primate', 'archer', 'spearman'],
    ];
    kinds.forEach((row, ri) => row.forEach((k, i) => {
      const e = Ent.spawn(G, k, r.cx - (row.length - 1) * 23 + i * 46, r.cy - 88 + ri * 44, r.idx);
      e.warp = 0;
      e.spd = 0; // hold still for the photo
      e.fireCD = 99;
    }));
    Ent.ITEM_IDS.forEach((id, i) => {
      Ent.spawnPickup(G, r.cx - (Ent.ITEM_IDS.length - 1) * 21 + i * 42, r.cy + 4, 'item', id);
    });
    G.banner = null;
    G.splash = null;
  });
  await page.mouse.move(640, 200);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(shots, '5-showcase.png') });

  // the deep jungle (isle 4+): darker tileset, new natives
  await page.evaluate(() => {
    const { G, loadFloor } = window.Game;
    loadFloor(4);
    const room = G.level.rooms.find((r) => r.type === 'combat') || G.level.rooms[1];
    G.player.x = room.cx;
    G.player.y = room.cy;
    G.splash = null;
  });
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    const G = window.Game.G;
    G.player.hp = G.player.maxHp;
    if (G.state === 'levelup') { G.pendingLevels = 0; G.state = 'play'; }
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(shots, '6-deep.png') });

  // the level-up boon cards
  await page.evaluate(() => {
    const G = window.Game.G;
    G.xp = G.xpNeed; // force a level
    G.pendingLevels = 1;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '7-levelup.png') });
  await page.evaluate(() => { // pick a boon to resume
    const G = window.Game.G;
    if (G.state === 'levelup' && G.lvlChoices[0]) {
      G.lvlChoices[0].apply(G.player);
      G.pendingLevels = 0;
      G.state = 'play';
    }
  });

  const state = await page.evaluate(() => ({
    state: window.Game.G.state,
    floor: window.Game.G.floor,
    enemies: window.Game.G.enemies.length,
    bullets: window.Game.G.eBullets.length,
  }));
  console.log('final state:', JSON.stringify(state));

  await browser.close();
  server.close();
  if (errors.length) {
    console.error('BROWSER ERRORS:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('BROWSER TEST PASSED — screenshots in test/shots/');
})().catch((e) => { console.error(e); process.exit(1); });
