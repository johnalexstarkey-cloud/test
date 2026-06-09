# BLACKPOWDER ISLE

A pirate roguelike on a snake-infested jungle island, loosely in the spirit of
*Enter the Gungeon* (twin-stick rooms that lock down, dodge-roll with i-frames,
bullet patterns, a boss every few isles), *Tiny Rogue* (compact procedurally
generated floors, quick runs), and *The Binding of Isaac* (stat-upgrade items
after clearing rooms). Pure HTML5 canvas + vanilla JavaScript — no build step,
no dependencies. Graphics are drawn in code (plus the pixel-art pirate sprite in
`A_swashbuckling_pirate_standing_top/`), and all audio — including the sea
shanty — is synthesized live with WebAudio.

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
| left mouse (hold) | fire / slash |
| `Shift` / `Space` | dive roll — brief invulnerability, short cooldown |
| `Q` / wheel / `1`–`6` | swap weapon |
| `P` / `Esc` | pause |
| `M` | mute |

## The voyage

- Each **isle** is a procedurally generated tangle of jungle clearings joined by
  dirt trails, surrounded by open sea. Entering a hostile clearing snares the
  exits shut with **thorned vines** until every beast is slain.
- Find the **X**, stand on it, and dig down to the next isle. It gets harder
  forever; your legend is how deep you delve and how much gold you bank.
- Past the first Colossus (isle 4+) lies **THE DEEP JUNGLE** — a darker
  tileset where eyes blink from the thickets, the music turns ominous, and a
  new bestiary hunts you: leaping primates, archers who lead their shots, and
  spear natives with telegraphed thrusts.
- Kills grant **experience**. Each level up pauses the fray and offers
  **3 random boons** — pick one: fire rate, move speed, roll cooldown, pierce,
  wall bounce, max health, or raw damage.
- You come ashore with a **flintlock pistol** (slow to reload, hits hard) and a
  **rusty sword** (low damage, fast swings — slashes in an arc and can *parry
  incoming darts*).
- One clearing per isle holds a **treasure chest** with a new gun: the
  **blunderbuss** (a roaring scattergun), **dual flintlocks** (a faster-reloading
  pair), the **long musket** (slow, piercing), or the **hand mortar** (explosive
  grenado). Powder kegs refill ammo; the starting pistol and sword never run dry.
- **Treasures** are stackable passive buffs (Isaac-style). Every voyage begins
  with one (announced with a title card), rooms have a chance to leave one when
  cleared, and bosses always drop one. Stacking deepens the effect:

  | Treasure | Effect |
  | --- | --- |
  | Voodoo Doll | when you're hit, every foe in the room takes damage |
  | Gunpowder | 1-in-10 shots burst into shrapnel (stacks: chance + blast size) |
  | Spinach | sword swings send foes flying |
  | Gasoline | dive rolls leave a fuel trail — shoot it to set it ablaze |
  | Powder Parrot | a loyal parrot dive-bombs nearby foes |
  | Lucky Doubloon | foes drop gold far more often |
  | Sharktooth Charm | kills may shake loose powder kegs |
  | Cannonball | dive rolling through foes damages them |

- Every **3rd isle** is guarded by the **TIKI COLOSSUS**, a stone bullet-hell
  boss with telegraphed ember rings, spirals, and dart volleys. Felling it
  permanently toughens you (+1 max health) and always drops a stat treasure.
- Rum bottles heal, doubloons are score, and crates splinter in a single hit,
  sometimes spilling loot. Death is permanent; your best voyage is kept in
  `localStorage`.

### Bestiary

| Creature | Behavior |
| --- | --- |
| Viper | fast snake, weaves as it slithers |
| Dart tribesman | keeps range, single aimed blowgun darts |
| Totem | carved sentinel, tracking dart bursts |
| Constrictor | coils up, then strikes in a straight line; dazed if it hits a tree |
| Hunter | shielded brute, hurls fans of javelins |
| Brood python | egg-swollen; hatches two vipers when killed |
| Shaman | circles you, casts rings of cursed bolts |
| Headhunter | distant blowgunner with a visible aim line and a fast precise dart |
| Jungle primate *(deep)* | prowls, crouches, then leaps on you suddenly |
| Native archer *(deep)* | draws a longbow and leads a moving target |
| Spear native *(deep)* | closes in with a telegraphed spear thrust |
| Tiki Colossus | isle boss: multi-pattern bullet hell, summons beasts when cracked |

## The music

Two original tracks, sequenced and synthesized entirely in WebAudio — no audio
files (see `js/audio.js`):

- **The shanty** (coast): an 8-bar jig in A minor, 6/8 — square-wave lead
  doubled an octave down, triangle bass with a fifth, kick/snare/shaker.
- **The omen** (deep jungle): a slow Phrygian drone in E with half-step creep
  and a tritone sting, low toms, sparse ticks, and far-off bell tones.

## Code layout

```
index.html        canvas + script tags (plain scripts, file:// friendly)
js/utils.js       math helpers, hashing, RNG conveniences
js/audio.js       WebAudio sfx synth + the generative sea shanty
js/input.js       keyboard/mouse state
js/weapons.js     weapon definitions (incl. melee sword)
js/map.js         procedural isle generation, tiles, vine gates, collision
js/entities.js    enemy AI + boss, items, damage/loot, pickups, drawing
js/game.js        main loop, player, combat, rooms, rendering, HUD, menus
A_swashbuckling_pirate_standing_top/  player sprite (8 rotations)
```

## Tests

```sh
node test/smoke.js      # headless logic test: level-gen fuzz + simulated session
```

`test/browser.js` additionally drives the real game in headless Chromium via
Playwright (`npm i --no-save playwright`, set `PLAYWRIGHT_BROWSERS_PATH` if your
browsers live elsewhere) and saves screenshots to `test/shots/`.

## Ideas for later

A shop to spend gold, more guns/bosses, cannons, parrots, gamepad + touch
support, daily seeded voyages.
