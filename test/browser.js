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
  await page.evaluate(() => { window.Game.G.player.hp = window.Game.G.player.maxHp; });
  await page.waitForTimeout(2400);
  await page.screenshot({ path: path.join(shots, '4-boss.png') });

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
