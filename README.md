# VOIDRUNNER

A sci-fi web roguelike, loosely in the spirit of *Enter the Gungeon* (twin-stick
rooms that lock down, dodge-dash with i-frames, bullet patterns, a boss every few
floors) and *Tiny Rogue* (compact procedurally generated floors, quick runs,
simple pickups). Pure HTML5 canvas + vanilla JavaScript — no build step, no
dependencies, no assets (graphics are drawn, sounds are synthesized with WebAudio).

![genre](https://img.shields.io/badge/genre-roguelike-blueviolet) ![tech](https://img.shields.io/badge/tech-vanilla%20JS%20%2B%20canvas-22d3ee)

## Play

Open `index.html` directly in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Controls

| Input | Action |
| --- | --- |
| `WASD` | move |
| mouse | aim |
| left mouse (hold) | fire |
| `Shift` / `Space` | dash — brief invulnerability, short cooldown |
| `Q` / wheel / `1`–`5` | swap weapon |
| `P` / `Esc` | pause |
| `M` | mute |

## The run

- Each **sector** (floor) is a procedurally generated deck of rooms joined by
  corridors. Entering a hostile room seals the doors with energy gates until
  every enemy is destroyed.
- Find the **teleporter pad** and stand on it to descend. Sectors get harder
  forever; your score is how deep you get and how many credits you bank.
- One room per sector holds a **weapon pedestal** (scatter laser, plasma
  repeater, railgun, nova launcher). Energy cells refill special-weapon ammo;
  the pulse blaster never runs dry.
- Clearing a room has a chance to leave a **stat upgrade item** (Binding of
  Isaac-style) on a glowing pedestal ring — these stack for the whole run:

  | Item | Effect |
  | --- | --- |
  | Overclock Chip | +15% fire rate |
  | Servo Actuators | +12% move speed |
  | Flux Dash Core | −15% dash cooldown |
  | Phase Rounds | shots pierce +1 enemy |
  | Ricochet Plating | shots bounce off +1 wall |
  | Nano-Hull Weave | +1 max hull, +1 repair |

- Every **3rd sector** is guarded by the **WARDEN**, a bullet-hell boss with
  telegraphed radial, spiral, and shotgun patterns. Killing it permanently
  reinforces your hull (+1 max HP) and always drops a stat upgrade.
- Crates are destructible cover and sometimes drop loot. Medbays, hearts,
  credits, and room-clear bonuses round out the economy. Death is permanent;
  your best run is kept in `localStorage`.

### Enemies

| Enemy | Behavior |
| --- | --- |
| Skitter | fast melee chaser, weaves |
| Drone | hovers at range, aimed single shots |
| Sentry turret | stationary, tracking burst fire |
| Charger | telegraphs, then rams in a straight line; stunned if it hits a wall |
| Gunner | heavy walker, fan volleys |
| Splitter | lumbering blob that bursts into two skitters on death |
| Orbiter | circles you, radial bullet rings |
| Sniper | keeps its distance, visible lock-on laser, fast precise shot |
| Warden | sector boss, multi-pattern bullet hell, summons escorts when enraged |

## Code layout

```
index.html        canvas + script tags (plain scripts, file:// friendly)
js/utils.js       math helpers, hashing, RNG conveniences
js/audio.js       WebAudio sfx synth + generative ambient drone
js/input.js       keyboard/mouse state
js/weapons.js     weapon definitions
js/map.js         procedural deck generation, tiles, gates, collision
js/entities.js    enemy AI + boss, damage/loot, pickups, particles, drawing
js/game.js        main loop, player, combat, rooms, rendering, HUD, menus
```

## Tests

```sh
node test/smoke.js      # headless logic test: level-gen fuzz + simulated session
```

`test/browser.js` additionally drives the real game in headless Chromium via
Playwright (`npm i --no-save playwright`, set `PLAYWRIGHT_BROWSERS_PATH` if your
browsers live elsewhere) and saves screenshots to `test/shots/`.

## Ideas for later

Shops to spend credits, more weapons/bosses, character upgrades between runs,
gamepad + touch support, daily seeded runs.
