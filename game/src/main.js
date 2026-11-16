// Pasar Senja — boot and the one loop.
//
// A fixed 60 Hz simulation feeds rendering at the display's rate. The
// simulation is the match (rounds, money, the bomb), the fighters (the
// player and nine bots) and the grenades; rendering is three.js plus the
// DOM HUD. Nothing in the simulation reads the DOM, nothing in the HUD
// writes the simulation — the HUD only displays state.
//
// ?shot=start|play|bomb|end with &seed=N sets up a deterministic frame for
// a capture: it plays the scene out, renders it twice, freezes it and sets
// window.__shotReady. That is how the entry's screenshots are taken, and
// the same scene is what a player sees when they play.

import * as THREE from 'three';
import { MATCH, WEAPONS, MOVE, BOT, NAMES } from './config.js';
import { createWorld, collideCircle } from './world.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import {
  createWeapon, weaponSpread, weaponReady, weaponFire, weaponStep,
  weaponReload, weaponRefill, createGrenade, stepGrenade, grenadeDamage,
} from './weapons.js';
import { createActor, resetActor, damageActor, moveActor, stepBot, syncActorMesh } from './actors.js';
import { createMatch, startRound, stepMatch, roundTimeLeft, aliveCount, buyWeapon, buyArmour, buyGrenade, awardMoney, onCarrierDied, endRound } from './game.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed);

// --- Renderer, scene, camera -------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const match = createMatch();

// --- Fighters ----------------------------------------------------------------
const player = createActor(scene, { team: 'senja', name: 'Kamu', isPlayer: true, weaponId: 'rifle' });
const actors = [player];
NAMES.senja.slice(1).forEach((name, i) => {
  actors.push(createActor(scene, { team: 'senja', name, weaponId: ['rifle', 'smg', 'sniper', 'smg'][i % 4] }));
});
NAMES.malam.forEach((name, i) => {
  actors.push(createActor(scene, { team: 'malam', name, weaponId: ['rifle', 'rifle', 'smg', 'sniper', 'smg'][i % 5] }));
});
const bots = actors.filter((a) => !a.isPlayer);
const senjaRoutes = ['senjaEast', 'senjaMid', 'senjaSite', 'senjaWest'];
const malamRoutes = ['malamSite', 'malamSite', 'malamMid', 'malamWest'];

function assignRoutes() {
  let si = 0;
  let mi = 0;
  for (const bot of bots) {
    const routeName = bot.team === 'senja' ? senjaRoutes[si % senjaRoutes.length] : malamRoutes[mi % malamRoutes.length];
    if (bot.team === 'senja') si += 1;
    else mi += 1;
    bot.route = world.routes[routeName].map((node) => world.waypoints[node]);
  }
}

function beginMatch() {
  match.round = 1;
  match.score = { senja: 0, malam: 0 };
  match.lossStreak = { senja: 0, malam: 0 };
  match.matchWinner = null;
  match.events = [];
  match.time = 0;
  for (const actor of actors) {
    actor.money = MATCH.startMoney;
    actor.grenades = 0;
    actor.armour = 0;
    actor.setWeapon(actor.isPlayer ? 'rifle' : actor.weapon.def.id);
    weaponRefill(actor.weapon);
  }
  assignRoutes();
  startRound(match, actors, world);
}

// --- Shooting helpers --------------------------------------------------------
const raycaster = new THREE.Raycaster();
raycaster.far = 100;
const shootDirection = new THREE.Vector3();
const tempVector = new THREE.Vector3();

function eyeOf(actor) {
  // A fresh vector every call: callers pass two eyes into one function, and
  // a shared temp would make both arguments the same eye.
  return new THREE.Vector3(actor.position.x, actor.position.y + actor.eye, actor.position.z);
}

function hasLineOfSight(from, to) {
  const distance = from.distanceTo(to);
  if (distance < 0.5) return true;
  raycaster.set(from, tempVector.copy(to).sub(from).normalize());
  raycaster.far = distance;
  return raycaster.intersectObjects(world.shootables, false).length === 0;
}

// Tracers: a small pool of lines, reused, fading fast.
const tracers = [];
for (let i = 0; i < 16; i += 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const material = new THREE.LineBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0 });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
function spawnTracer(from, to, colour) {
  const tracer = tracers.find((t) => t.life <= 0) ?? tracers[0];
  tracer.line.material.color.setHex(colour);
  const positions = tracer.line.geometry.attributes.position;
  positions.setXYZ(0, from.x, from.y, from.z);
  positions.setXYZ(1, to.x, to.y, to.z);
  positions.needsUpdate = true;
  tracer.line.material.opacity = 0.9;
  tracer.life = 0.07;
}

// Muzzle flash: a light plus a bright quad at the gun tip, alive ~40 ms.
const flashLight = new THREE.PointLight(0xffc46a, 0, 9, 1.6);
scene.add(flashLight);
let flashLife = 0;
function muzzleFlash(position) {
  flashLight.position.copy(position);
  flashLight.intensity = 26;
  flashLife = 0.045;
}

// Hit sparks: one small glowing sphere, reused.
const spark = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 }),
);
scene.add(spark);
let sparkLife = 0;
function hitSpark(point) {
  spark.position.copy(point);
  spark.material.opacity = 1;
  sparkLife = 0.12;
}

// Grenade mesh pool + explosions.
const grenades = [];
const grenadeMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 10, 8),
  new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 0.5, metalness: 0.4 }),
);
grenadeMesh.visible = false;
scene.add(grenadeMesh);
const blast = new THREE.Mesh(
  new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0 }),
);
scene.add(blast);
const blastLight = new THREE.PointLight(0xff8a20, 0, 18, 1.6);
scene.add(blastLight);
let blastLife = 0;

// Weapon viewmodel: a low-poly gun attached to the camera, bobbing as the
// player walks and kicking back when it fires.
const viewmodel = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.55, metalness: 0.45 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.62), dark);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.42);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), dark);
  grip.position.set(0, -0.14, 0.18);
  grip.rotation.x = 0.3;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.03, 0.4), accent);
  stripe.position.set(0, 0.05, -0.1);
  viewmodel.add(body, barrel, grip, stripe);
  viewmodel.position.set(0.28, -0.26, -0.55);
  camera.add(viewmodel);
}
let viewKick = 0;
let bobPhase = 0;

// --- Killing -----------------------------------------------------------------
function killFeed(killer, victim, isHead, cause) {
  const text = cause === 'grenade'
    ? `${killer.name} 💥 ${victim.name}`
    : isHead
      ? `${killer.name} ⌖ ${victim.name}`
      : `${killer.name} ✕ ${victim.name}`;
  hud.killfeedAdd(text, killer.team);
  match.events.unshift({ text, team: killer.team, at: match.time });
}

function onKilled(victim, killer, isHead, cause) {
  if (killer && killer !== victim) {
    awardMoney(killer, MATCH.killMoney);
    killFeed(killer, victim, isHead, cause);
    if (killer.isPlayer) {
      hud.hitMarker(true);
      audio.kill();
    }
  }
  if (victim.hasBomb) {
    victim.hasBomb = false;
    onCarrierDied(match, actors, victim);
  }
  if (victim.isPlayer) {
    audio.hurt();
    hud.setHealth(0, 0);
  }
}

function applyDamage(target, amount, isHead, killer, cause) {
  if (!target.alive) return;
  const died = damageActor(target, amount, isHead, match.time);
  if (killer && killer.isPlayer && !died) {
    hud.hitMarker(false);
    audio.hit();
  }
  if (died) onKilled(target, killer, isHead, cause);
}

// Bot shooting: resolved with an accuracy roll (no raycast per bullet —
// line of sight was already checked when the target was acquired).
function botShoot(shooter, target, distance, random) {
  const weapon = shooter.weapon;
  if (!weaponFire(weapon, match.time)) return false;
  const from = new THREE.Vector3(shooter.position.x, shooter.position.y + shooter.eye, shooter.position.z);
  const to = new THREE.Vector3(target.position.x, target.position.y + target.eye * (random() < 0.12 ? 1.08 : 0.82), target.position.z);
  spawnTracer(from, to, weapon.def.tracer);
  audio.shot(weapon.def.id, from.distanceTo(player.position));
  const targetSpeed = Math.hypot(target.velocity.x, target.velocity.z);
  const error = BOT.baseError + distance * BOT.errorPerMetre + targetSpeed * 0.012;
  const hitChance = Math.max(0.08, Math.min(0.55, 0.62 - error * 6));
  if (random() < hitChance) {
    const isHead = random() < 0.12;
    const falloff = distance > 30 ? 0.8 : 1;
    applyDamage(target, Math.round(weapon.def.damage * (isHead ? weapon.def.headMult : 1) * falloff), isHead, shooter, 'shot');
    if (target.isPlayer) {
      const bearing = Math.atan2(target.position.x - shooter.position.x, -(target.position.z - shooter.position.z));
      const rel = ((bearing * 180) / Math.PI - ((-player.yaw * 180) / Math.PI) + 540) % 360 - 180;
      hud.damageFrom(rel);
      audio.hurt();
    }
  }
  return true;
}

// --- Player shooting ---------------------------------------------------------
function playerShoot() {
  const weapon = player.weapon;
  if (!weaponReady(weapon, match.time)) {
    if (weapon.mag === 0 && !weapon.reloading) audio.dryFire();
    return;
  }
  weaponFire(weapon, match.time);
  const spread = weaponSpread(weapon, Math.hypot(player.velocity.x, player.velocity.z), player.position.y > 0.05, player.crouched);
  camera.getWorldDirection(shootDirection);
  shootDirection.x += (rng() * 2 - 1) * spread;
  shootDirection.y += (rng() * 2 - 1) * spread;
  shootDirection.z += (rng() * 2 - 1) * spread;
  shootDirection.normalize();
  const origin = camera.position.clone();
  raycaster.set(origin, shootDirection);
  raycaster.far = weapon.def.range;
  const botMeshes = [];
  for (const actor of actors) {
    if (actor.isPlayer || !actor.alive || !actor.mesh) continue;
    botMeshes.push(actor.bodyMesh, actor.headMesh);
  }
  const hits = raycaster.intersectObjects([...world.shootables, ...botMeshes], false);
  const hit = hits[0];
  const endPoint = hit ? hit.point.clone() : origin.clone().addScaledVector(shootDirection, weapon.def.range);
  spawnTracer(origin.clone().addScaledVector(shootDirection, 0.6), endPoint, weapon.def.tracer);
  muzzleFlash(origin.clone().addScaledVector(shootDirection, 0.9));
  audio.shot(weapon.def.id, 0);
  viewKick = Math.min(0.09, viewKick + weapon.def.recoil * 1.6);
  player.pitch += weapon.def.recoil * (0.8 + rng() * 0.4);
  player.yaw += (rng() * 2 - 1) * weapon.def.recoil * 0.35;
  if (hit) {
    hitSpark(hit.point);
    if (hit.object.userData.actor) {
      const victim = hit.object.userData.actor;
      const isHead = hit.object.userData.part === 'head';
      const distance = origin.distanceTo(hit.point);
      const falloff = distance > 30 ? 0.8 : 1;
      applyDamage(victim, Math.round(weapon.def.damage * (isHead ? weapon.def.headMult : 1) * falloff), isHead, player, 'shot');
    }
  }
  hud.setAmmo(weapon.mag, weapon.reserve, weapon.reloading);
  hud.setCrosshairSpread(6 + spread * 900);
}

// --- Bomb (player) -----------------------------------------------------------
let plantHold = 0;
let defuseHold = 0;
function playerBomb(dt) {
  const atSite = Math.hypot(player.position.x - world.site.center.x, player.position.z - world.site.center.z) < world.site.radius;
  const holding = input.state.keys.has('KeyE');
  if (match.phase !== 'live' || !holding || !atSite) {
    plantHold = 0;
    defuseHold = 0;
    hud.setBombProgress(null, 0);
    return;
  }
  if (match.bombState === 'carried' && player.hasBomb) {
    plantHold += dt;
    hud.setBombProgress('Menanam bom…', plantHold / MATCH.plantSeconds);
    if (Math.floor(plantHold * 2) !== Math.floor((plantHold - dt) * 2)) audio.plantBeep();
    if (plantHold >= MATCH.plantSeconds) {
      match.bombState = 'planted';
      match.bombTimer = MATCH.bombSeconds;
      match.planter = player;
      player.hasBomb = false;
      match.bombCarrier = null;
      awardMoney(player, MATCH.plantMoney);
      hud.banner('BOM DITANAM', 'Pertahankan Site A selama 35 detik!');
      audio.plantBeep();
      plantHold = 0;
      hud.setBombProgress(null, 0);
    }
  } else if (match.bombState === 'planted') {
    defuseHold += dt;
    hud.setBombProgress('Menjinakkan bom…', defuseHold / MATCH.defuseSeconds);
    if (Math.floor(defuseHold * 2) !== Math.floor((defuseHold - dt) * 2)) audio.plantBeep();
    if (defuseHold >= MATCH.defuseSeconds) {
      match.bombState = 'defused';
      match.events.unshift({ text: 'Kamu menjinakkan bom!', team: 'senja', at: match.time });
      defuseHold = 0;
      hud.setBombProgress(null, 0);
      endRound(match, 'senja', 'Bom dijinakkan', actors, audio);
    }
  }
}

// --- Bot callbacks -----------------------------------------------------------
const seenEnemies = new Map();
const botContext = {
  get time() { return match.time; },
  rng,
  site: world.site,
  colliders: world.colliders,
  bounds: world.bounds,
  actors,
  get bombState() { return match.bombState; },
  hasLineOfSight,
  botShoot,
  onPlanting(bot, progress) {
    hud.setBombProgress(`${bot.name} menanam bom…`, progress / MATCH.plantSeconds);
  },
  onPlanted(bot) {
    match.bombState = 'planted';
    match.bombTimer = MATCH.bombSeconds;
    match.planter = bot;
    bot.hasBomb = false;
    match.bombCarrier = null;
    awardMoney(bot, MATCH.plantMoney);
    hud.banner('BOM DITANAM', `${bot.name} menanam bom di Site A!`);
    hud.setBombProgress(null, 0);
  },
  onDefused(bot) {
    match.bombState = 'defused';
    match.events.unshift({ text: `${bot.name} menjinakkan bom`, team: 'malam', at: match.time });
    endRound(match, 'malam', 'Bom dijinakkan', actors, audio);
  },
};

// --- Input, camera, player movement ------------------------------------------
const input = createInput(renderer.domElement, onLockChange);
player.crouched = false;
player.onGround = true;
let stepTimer = 0;
let buyOpen = false;

function onLockChange(locked) {
  if (shot) return;
  audio.unlock();
  if (locked) {
    hud.hideOverlay();
    hud.hideBuy();
    buyOpen = false;
  } else if (match.phase !== 'matchEnd') {
    hud.showOverlay(playerStarted ? 'paused' : 'start');
  }
}

let playerStarted = false;
hud.onPlay(() => {
  if (shot) return;
  if (match.phase === 'matchEnd') {
    beginMatch();
    hud.setScore(0, 0, 1);
  }
  playerStarted = true;
  input.requestLock();
});
hud.onBuy((id) => {
  if (id === 'armour') buyArmour(match, player, audio);
  else if (id === 'grenade') buyGrenade(match, player, audio);
  else buyWeapon(match, player, id, audio);
  refreshHud();
  if (buyOpen) hud.showBuy(WEAPONS, player.money, player.armour, player.grenades);
});

function refreshHud() {
  hud.setHealth(player.health, player.armour);
  hud.setAmmo(player.weapon.mag, player.weapon.reserve, player.weapon.reloading);
  hud.setWeapon(player.weapon.def.name, player.grenades);
  hud.setMoney(player.money);
  hud.setScore(match.score.senja, match.score.malam, match.round);
  hud.setAlive(aliveCount(actors, 'senja'), aliveCount(actors, 'malam'));
  hud.setBomb(match.bombState, match.bombTimer);
  hud.setTimer(roundTimeLeft(match), match.phase);
}

function syncCamera() {
  const eye = player.crouched ? MOVE.eyeCrouch : MOVE.eyeStanding;
  camera.position.set(player.position.x, player.position.y + eye, player.position.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  viewmodel.position.y = -0.26 + Math.sin(bobPhase * 2) * 0.008;
  viewmodel.position.z = -0.55 + viewKick;
  viewKick = Math.max(0, viewKick - 0.35 * FIXED_STEP);
}

function playerStep(dt) {
  const keys = input.state.keys;
  const speed = player.position.y > 0.05
    ? MOVE.walkSpeed
    : keys.has('ControlLeft') || keys.has('ControlRight')
      ? MOVE.crouchSpeed
      : keys.has('ShiftLeft') || keys.has('ShiftRight')
        ? MOVE.sprintSpeed
        : MOVE.walkSpeed;
  player.crouched = keys.has('ControlLeft') || keys.has('ControlRight');
  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  const wishX = -sin * forward + cos * strafe;
  const wishZ = -cos * forward - sin * strafe;
  moveActor(player, wishX, wishZ, speed, dt, world.colliders, world.bounds);
  // Jump + gravity (vertical only; the market floor is flat).
  if (keys.has('Space') && player.onGround) {
    player.velocity.y = MOVE.jumpSpeed;
    player.onGround = false;
  }
  player.velocity.y -= MOVE.gravity * dt;
  player.position.y += player.velocity.y * dt;
  if (player.position.y <= 0) {
    player.position.y = 0;
    player.velocity.y = 0;
    player.onGround = true;
  }
  const hSpeed = Math.hypot(player.velocity.x, player.velocity.z);
  if (hSpeed > 1 && player.onGround) {
    bobPhase += dt * hSpeed * 1.6;
    stepTimer -= dt;
    if (stepTimer <= 0) {
      stepTimer = 0.38;
      audio.step(0);
    }
  }
  weaponStep(player.weapon, dt, match.time);
}

// --- Fixed-step simulation ---------------------------------------------------
function step(dt) {
  const previousPhase = match.phase;
  stepMatch(match, dt, actors, world, audio);
  if (match.phase !== previousPhase) {
    if (match.phase === 'live') hud.banner(`RONDE ${match.round}`, match.round === 1 ? 'Tanam bom di Site A!' : 'Semoga beruntung!');
    if ((match.phase === 'roundEnd' || match.phase === 'matchEnd') && match.roundWinner) {
      const won = match.roundWinner === 'senja';
      hud.banner(won ? 'SENJA MENANG' : 'MALAM MENANG', match.roundReason);
      if (match.phase === 'matchEnd') {
        hud.showOverlay(match.matchWinner === 'senja' ? 'matchWin' : 'matchLose', { senja: match.score.senja, malam: match.score.malam });
        input.releaseLock();
      }
    }
    if (match.phase === 'freeze') {
      hud.banner('BELANJA', 'Tekan B untuk membeli senjata');
    }
  }
  if (match.phase === 'live' || match.phase === 'freeze') {
    playerStep(dt);
    for (const bot of bots) stepBot(bot, dt, botContext);
    // Grenades.
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const grenade = grenades[i];
      stepGrenade(grenade, dt);
      if (grenade.exploded) {
        grenades.splice(i, 1);
        grenadeMesh.visible = false;
        blast.position.copy(grenade.position);
        blastLight.position.copy(grenade.position);
        blastLight.position.y += 1;
        blastLife = 0.35;
        audio.explosion(grenade.position.distanceTo(player.position));
        for (const actor of actors) {
          if (!actor.alive) continue;
          const damage = grenadeDamage(grenade, new THREE.Vector3(actor.position.x, actor.position.y + 1, actor.position.z));
          if (damage > 0) applyDamage(actor, damage, false, grenade.owner, 'grenade');
        }
      } else {
        grenadeMesh.position.copy(grenade.position);
        grenadeMesh.visible = true;
      }
    }
    playerBomb(dt);
    // Bomb ticking.
    if (match.bombState === 'planted' && Math.floor(match.bombTimer * 2) !== Math.floor((match.bombTimer + dt) * 2)) {
      audio.bombTick();
    }
  }
  // Enemies the player can see are marked on the minimap for a few seconds.
  for (const bot of bots) {
    if (bot.team !== 'malam' || !bot.alive) continue;
    if (hasLineOfSight(eyeOf(player), eyeOf(bot)) && eyeOf(player).distanceTo(eyeOf(bot)) < 40) {
      seenEnemies.set(bot.id, match.time + 3);
    }
  }
  for (const [id, until] of [...seenEnemies]) if (match.time > until) seenEnemies.delete(id);
}

// --- Frame loop ---------------------------------------------------------------
let accumulator = 0;
let lastTime = performance.now();
let frozen = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.yaw -= look.x * 0.0022;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - look.y * 0.0022));
    if (input.state.locked && match.phase === 'live' && player.alive) {
      if (input.state.firing) playerShoot();
    }
    if (input.takePressed('KeyR')) {
      if (weaponReload(player.weapon, match.time)) audio.reload();
    }
    if (input.takePressed('KeyB') && (match.phase === 'freeze' || match.phase === 'roundEnd')) {
      buyOpen = !buyOpen;
      if (buyOpen) hud.showBuy(WEAPONS, player.money, player.armour, player.grenades);
      else hud.hideBuy();
    }
    if (input.takePressed('KeyG') && player.grenades > 0 && match.phase === 'live' && player.alive) {
      player.grenades -= 1;
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      const grenade = createGrenade(
        new THREE.Vector3(player.position.x, player.position.y + 1.5, player.position.z),
        direction.multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0)),
      );
      grenade.owner = player;
      grenades.push(grenade);
      audio.shot('smg', 0);
    }
    for (const key of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6']) {
      if (input.takePressed(key) && buyOpen) {
        const ids = ['pistol', 'smg', 'rifle', 'sniper', 'armour', 'grenade'];
        const id = ids[Number(key.slice(-1)) - 1];
        if (id === 'armour') buyArmour(match, player, audio);
        else if (id === 'grenade') buyGrenade(match, player, audio);
        else buyWeapon(match, player, id, audio);
        refreshHud();
        hud.showBuy(WEAPONS, player.money, player.armour, player.grenades);
      }
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    refreshHud();
    const siteDx = world.site.center.x - player.position.x;
    const siteDz = world.site.center.z - player.position.z;
    const siteAngle = (Math.atan2(siteDx, -siteDz) * 180) / Math.PI;
    hud.setCompass(player.yaw, siteAngle, Math.hypot(siteDx, siteDz));
    hud.drawMinimap(world, actors, player, seenEnemies);
  }
  // Decay visual effects every rendered frame.
  for (const tracer of tracers) {
    if (tracer.life > 0) {
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / 0.07) * 0.9;
    }
  }
  if (flashLife > 0) {
    flashLife -= dt;
    if (flashLife <= 0) flashLight.intensity = 0;
  }
  if (sparkLife > 0) {
    sparkLife -= dt;
    spark.material.opacity = Math.max(0, sparkLife / 0.12);
    spark.scale.setScalar(1 + (0.12 - sparkLife) * 8);
  }
  if (blastLife > 0) {
    blastLife -= dt;
    const t = Math.max(0, blastLife / 0.35);
    blast.material.opacity = t * 0.75;
    blast.scale.setScalar(1 + (1 - t) * 6);
    blastLight.intensity = t * 40;
    if (blastLife <= 0) {
      blast.material.opacity = 0;
      blastLight.intensity = 0;
    }
  }
  renderer.render(scene, camera);
}

// --- Deterministic captures ---------------------------------------------------
// Each shot plays the scene out with the seeded rng, then freezes on a
// frame that shows the game as a player would see it: HUD, enemies, the
// market, and — for play and bomb — a live tracer and muzzle flash.
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const dx = point.x - player.position.x;
  const dy = point.y - (player.position.y + player.eye);
  const dz = point.z - player.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function placeBot(bot, x, z, yaw) {
  bot.position.set(x, 0, z);
  bot.yaw = yaw;
  bot.alive = true;
  bot.health = 100;
  syncActorMesh(bot);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  beginMatch();
  match.phase = 'live';
  match.phaseEndsAt = match.time + MATCH.roundSeconds;
  const enemy = bots.find((b) => b.team === 'malam');
  const mate = bots.find((b) => b.team === 'senja');
  if (name === 'start') {
    // Face north down the mid lane: stalls, lanterns and string lights in
    // view behind the menu panel, not the empty spawn wall.
    player.position.set(0, 0, 14);
    player.yaw = 0.1;
    player.pitch = 0.02;
    placeBot(mate, -3, 6, Math.PI);
    placeBot(enemy, 6, -4, 0);
    placeBot(bots[2], -10, 0, Math.PI / 2);
    placeBot(bots[5], 12, -8, -Math.PI / 2);
    settle(30);
    syncCamera();
    refreshHud();
    hud.showOverlay('start');
    hud.setTimer(MATCH.freezeSeconds, 'freeze');
  } else if (name === 'play') {
    player.position.set(2, 0, 6);
    placeBot(enemy, 2, -8, Math.PI);
    placeBot(bots[3], -8, -2, Math.PI / 3);
    placeBot(mate, -4, 2, 0);
    placeBot(bots[6], 12, -10, Math.PI);
    settle(40);
    // Shoot for real until the enemy in the crosshair drops: the kill feed
    // entry this produces is a genuine kill, not a staged label.
    for (let round = 0; round < 4 && enemy.alive; round += 1) {
      aimAt(new THREE.Vector3(enemy.position.x, enemy.position.y + 1.55, enemy.position.z));
      playerShoot();
      settle(9);
    }
    aimAt(new THREE.Vector3(enemy.position.x, enemy.position.y + 1.3, enemy.position.z));
  } else if (name === 'bomb') {
    player.position.set(12, 0, -7);
    player.hasBomb = true;
    match.bombCarrier = player;
    placeBot(mate, 9, -6, -Math.PI / 2);
    placeBot(enemy, 16, -13, Math.PI / 2);
    placeBot(bots[4], 6, -11, 0);
    settle(30);
    aimAt(new THREE.Vector3(14, 1.2, -11));
    hud.setBombProgress('Menanam bom…', 0.66);
    hud.setBomb('carried', 0);
  } else {
    // end: match won, banner up, the market behind it.
    match.score = { senja: 7, malam: 3 };
    match.round = 10;
    match.phase = 'matchEnd';
    player.position.set(-6, 0, 12);
    player.yaw = -0.6;
    player.pitch = 0.02;
    placeBot(mate, -5, 5, Math.PI);
    placeBot(enemy, 8, -6, 0);
    enemy.alive = false;
    if (enemy.mesh) enemy.mesh.visible = false;
    settle(30);
    syncCamera();
    hud.banner('SENJA MENANG', 'Skor akhir 7 – 3 · Pasar malam tetap milik Senja', 60000);
    hud.setScore(7, 3, 10);
  }
  syncCamera();
  refreshHud();
  // Shot-specific timer readings, applied after refreshHud so it cannot
  // overwrite them with the live round clock.
  if (name === 'play') hud.setTimer(87, 'live');
  if (name === 'bomb') hud.setTimer(54, 'live');
  if (name === 'end') hud.setTimer(0, 'matchEnd');
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

beginMatch();
syncCamera();
refreshHud();
hud.showOverlay('start');
if (shot) runShot(shot);
else requestAnimationFrame(frame);
