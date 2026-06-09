'use strict';
// weapons.js — weapon definitions (global WEAPONS / WEAPON_POOL / makeGun)
// rate: shots/sec · dmg: per projectile · spd: projectile px/sec · spread: radians
// pellets: projectiles per shot · ammo: shots (Infinity = starter) · life: projectile seconds
// pierce: number of enemies a shot passes through · boom/boomDmg: explosion radius px / AoE damage
// melee: sword swing — range px, arc radians, can parry darts

const WEAPONS = {
  flintlock: {
    name: 'FLINTLOCK PISTOL', color: '#fde68a',
    rate: 1.25, dmg: 2, spd: 520, spread: 0.06, pellets: 1,
    ammo: Infinity, size: 3, life: 0.9, sfx: 'flintlock',
  },
  sword: {
    name: 'RUSTY SWORD', color: '#cbd5e1', melee: true,
    rate: 2.6, dmg: 1, range: 46, arc: 1.95,
    ammo: Infinity, sfx: 'sword',
  },
  blunderbuss: {
    name: 'BLUNDERBUSS', color: '#fbbf24',
    rate: 0.9, dmg: 1, spd: 560, spread: 0.5, pellets: 8,
    ammo: 30, size: 3, life: 0.3, sfx: 'blunderbuss',
  },
  dualflint: {
    name: 'DUAL FLINTLOCKS', color: '#fdba74',
    rate: 3.4, dmg: 1.1, spd: 540, spread: 0.12, pellets: 1,
    ammo: 130, size: 3, life: 0.85, sfx: 'dualflint',
  },
  musket: {
    name: 'LONG MUSKET', color: '#e2e8f0',
    rate: 0.85, dmg: 6, spd: 1000, spread: 0, pellets: 1,
    ammo: 20, size: 4.5, life: 1.1, sfx: 'musket', pierce: 99,
  },
  mortar: {
    name: 'HAND MORTAR', color: '#fb923c',
    rate: 0.95, dmg: 3, spd: 330, spread: 0.03, pellets: 1,
    ammo: 12, size: 6, life: 1.5, sfx: 'mortar', boom: 80, boomDmg: 3.5,
  },
};

// guns found in treasure-room chests, shuffled per run
const WEAPON_POOL = ['blunderbuss', 'dualflint', 'musket', 'mortar'];

function makeGun(id) { return { id, ammo: WEAPONS[id].ammo }; }
