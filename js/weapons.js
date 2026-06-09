'use strict';
// weapons.js — weapon definitions (global WEAPONS / WEAPON_POOL / makeGun)
// rate: shots/sec · dmg: per projectile · spd: projectile px/sec · spread: radians
// pellets: projectiles per shot · ammo: shots (Infinity = starter) · life: projectile seconds
// pierce: number of enemies a shot passes through · boom/boomDmg: explosion radius px / AoE damage

const WEAPONS = {
  pulse: {
    name: 'PULSE BLASTER', color: '#7df9ff',
    rate: 4.0, dmg: 1, spd: 500, spread: 0.055, pellets: 1,
    ammo: Infinity, size: 3.5, life: 0.85, sfx: 'pulse',
  },
  repeater: {
    name: 'PLASMA REPEATER', color: '#34d399',
    rate: 9.5, dmg: 0.65, spd: 540, spread: 0.13, pellets: 1,
    ammo: 190, size: 3, life: 0.8, sfx: 'repeater',
  },
  scatter: {
    name: 'SCATTER LASER', color: '#fbbf24',
    rate: 1.6, dmg: 1, spd: 560, spread: 0.42, pellets: 6,
    ammo: 48, size: 3, life: 0.32, sfx: 'scatter',
  },
  rail: {
    name: 'RAILGUN', color: '#c084fc',
    rate: 1.1, dmg: 6, spd: 1050, spread: 0, pellets: 1,
    ammo: 22, size: 4.5, life: 1.1, sfx: 'rail', pierce: 99,
  },
  nova: {
    name: 'NOVA LAUNCHER', color: '#fb923c',
    rate: 1.2, dmg: 3, spd: 340, spread: 0.03, pellets: 1,
    ammo: 15, size: 6, life: 1.5, sfx: 'nova', boom: 78, boomDmg: 3.5,
  },
};

// guns found on treasure-room pedestals, shuffled per run
const WEAPON_POOL = ['scatter', 'repeater', 'rail', 'nova'];

function makeGun(id) { return { id, ammo: WEAPONS[id].ammo }; }
