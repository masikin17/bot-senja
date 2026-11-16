// Pasar Senja — one place for every number the game balances on.
//
// Teams: Senja (the player's team, warm orange) attacks Site A; Malam (deep
// teal) defends it. A match is first to 7 rounds, at most 13, each round
// 100 seconds. A round is won by eliminating the other team, by planting the
// bomb and letting it detonate, or by defusing it after a plant.
//
// Economy: money is earned for kills, plants and round results, and spent in
// the buy menu (B) during the freeze time at the start of a round. Every
// weapon is a different trade-off: price, damage, fire rate, accuracy, ammo.

export const MATCH = {
  roundsToWin: 7,
  maxRounds: 13,
  roundSeconds: 100,
  freezeSeconds: 4,
  plantSeconds: 3,
  defuseSeconds: 5,
  bombSeconds: 35,
  teamSize: 5,
  startMoney: 800,
  killMoney: 300,
  plantMoney: 300,
  winMoney: 3250,
  lossMoney: 1900,
  lossStreakBonus: 500,
};

export const TEAMS = {
  senja: { name: 'Senja', colour: 0xf0a830, css: '#f0a830', spawn: 'senja' },
  malam: { name: 'Malam', colour: 0x2ec4b6, css: '#2ec4b6', spawn: 'malam' },
};

// damage is per body hit; headshots multiply by HEAD_MULT. spread is the
// half-angle (radians) of the shot cone while standing still; moving,
// firing and jumping widen it. recoil is the pitch kick per shot.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Kancil P9', kind: 'Pistol', price: 0,
    damage: 26, headMult: 2.0, fireInterval: 0.16, auto: false,
    mag: 12, reserve: 48, reloadSeconds: 1.4, spread: 0.012,
    moveSpread: 0.03, recoil: 0.011, range: 55, tracer: 0xffd27a,
  },
  smg: {
    id: 'smg', name: 'Cicak-9', kind: 'SMG', price: 1500,
    damage: 22, headMult: 1.8, fireInterval: 0.085, auto: true,
    mag: 30, reserve: 120, reloadSeconds: 1.9, spread: 0.02,
    moveSpread: 0.045, recoil: 0.008, range: 45, tracer: 0xffe9a8,
  },
  rifle: {
    id: 'rifle', name: 'Garuda AR', kind: 'Rifle', price: 2700,
    damage: 33, headMult: 2.2, fireInterval: 0.11, auto: true,
    mag: 30, reserve: 90, reloadSeconds: 2.4, spread: 0.008,
    moveSpread: 0.035, recoil: 0.014, range: 70, tracer: 0xfff2c0,
  },
  sniper: {
    id: 'sniper', name: 'Elang .50', kind: 'Sniper', price: 4750,
    damage: 95, headMult: 2.0, fireInterval: 1.15, auto: false,
    mag: 5, reserve: 20, reloadSeconds: 3.1, spread: 0.001,
    moveSpread: 0.09, recoil: 0.055, range: 90, tracer: 0xcfe8ff,
  },
};

export const ARMOUR_PRICE = 650;
export const GRENADE_PRICE = 300;
export const GRENADE_DAMAGE = 85;
export const GRENADE_RADIUS = 6;

// Player movement. Acceleration and friction give the "stop to aim" feel:
// a moving player is fast but inaccurate, a still player is accurate.
export const MOVE = {
  walkSpeed: 4.6,
  sprintSpeed: 6.4,
  crouchSpeed: 2.4,
  accel: 42,
  friction: 11,
  jumpSpeed: 5.2,
  gravity: 13.5,
  eyeStanding: 1.62,
  eyeCrouch: 1.12,
  radius: 0.42,
};

export const BOT = {
  walkSpeed: 3.4,
  runSpeed: 4.4,
  eye: 1.55,
  radius: 0.42,
  health: 100,
  // A bot only re-checks line of sight this often (seconds), staggered per
  // bot, so ten bots do not raycast every frame.
  sightInterval: 0.22,
  // Aim error (radians) grows with distance and target speed; bots are
  // deliberately imperfect so a careful player wins duels.
  baseError: 0.02,
  errorPerMetre: 0.0016,
  reactionSeconds: 0.45,
  burstShots: 3,
  burstPause: 0.7,
};

export const NAMES = {
  senja: ['Arum', 'Bima', 'Citra', 'Dewi', 'Eko'],
  malam: ['Fajar', 'Gita', 'Hadi', 'Intan', 'Joko'],
};

export const STALL_SIGNS = ['SATE', 'KOPI', 'BATIK', 'BUAH', 'GORENGAN', 'JAMU', 'KUE', 'TEH'];
