// Pasar Senja — the fighters: one player and nine bots, one shared body.
//
// Every fighter is the same shape: a position (feet), a velocity, a yaw and
// pitch, health and armour, a weapon, and a visible mesh built from boxes
// and a sphere — a torso in the team's colour, a head, and a gun. The
// player is a fighter with no visible mesh (first person: you see your own
// gun viewmodel instead, which main.js draws). Bots share the same movement
// and damage code as the player, so a duel is fair; only their decisions
// differ, in stepBot().
//
// Bot decisions, in order, every sight check:
//   1. If the bomb is planted and I am Malam, go defuse it.
//   2. If I carry the bomb and I am Senja, push Site A and plant.
//   3. If I can see an enemy, fight: strafe, burst-fire, take the shot.
//   4. Otherwise follow my route's waypoints, pausing at cover nodes.
// Bots are deliberately imperfect — reaction time, aim error that grows
// with distance, bursts with pauses — so a careful player wins duels.

import * as THREE from 'three';
import { BOT, TEAMS, MATCH } from './config.js';
import { collideCircle } from './world.js';
import { createWeapon, weaponReload, weaponStep } from './weapons.js';

let nextId = 1;

const BODY_GEO = new THREE.BoxGeometry(0.55, 0.85, 0.34);
const HEAD_GEO = new THREE.SphereGeometry(0.21, 12, 10);
const LEG_GEO = new THREE.BoxGeometry(0.5, 0.75, 0.3);
const GUN_GEO = new THREE.BoxGeometry(0.09, 0.16, 0.72);

export function createActor(scene, { team, name, isPlayer = false, weaponId = 'rifle' }) {
  const teamDef = TEAMS[team];
  const actor = {
    id: nextId, name, team, isPlayer,
    position: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    yaw: 0, pitch: 0,
    eye: isPlayer ? 1.62 : BOT.eye,
    radius: BOT.radius,
    health: 100, armour: 0, alive: true,
    money: MATCH.startMoney,
    weapon: createWeapon(weaponId),
    grenades: 0, hasBomb: false,
    // Bot brain.
    route: [], routeIndex: 0, target: null,
    sightTimer: Math.random() * BOT.sightInterval,
    reactionTimer: 0, burstLeft: 0, burstTimer: 0,
    strafeDir: 1, strafeTimer: 0, holdTimer: 0,
    plantProgress: 0, defuseProgress: 0, lastDamageAt: -99,
    mesh: null, headMesh: null, bodyMesh: null,
  };
  // Methods the match module calls: respawn at a spawn point, and swap the
  // loadout (buying a weapon replaces the current one, refilled).
  actor.reset = (x, z, yaw) => resetActor(actor, x, z, yaw);
  actor.setWeapon = (weaponId) => {
    actor.weapon = createWeapon(weaponId);
  };
  nextId += 1;

  if (!isPlayer) {
    const group = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: teamDef.colour, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc98d64, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.9 });
    const body = new THREE.Mesh(BODY_GEO, cloth);
    body.position.y = 1.15;
    body.castShadow = true;
    const legs = new THREE.Mesh(LEG_GEO, dark);
    legs.position.y = 0.38;
    const head = new THREE.Mesh(HEAD_GEO, skin);
    head.position.y = 1.72;
    head.castShadow = true;
    // A cap in the team colour, so teams read at a glance.
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.23, 0.09, 12), cloth);
    cap.position.y = 1.88;
    const gun = new THREE.Mesh(GUN_GEO, dark);
    gun.position.set(0.28, 1.25, 0.35);
    group.add(body, legs, head, cap, gun);
    group.visible = false;
    scene.add(group);
    actor.mesh = group;
    actor.headMesh = head;
    actor.bodyMesh = body;
    // Raycast targets: the body box and the head sphere. main.js shoots
    // these meshes; userData.actor / userData.part say who and where.
    body.userData.actor = actor;
    body.userData.part = 'body';
    head.userData.actor = actor;
    head.userData.part = 'head';
  }
  return actor;
}

export function resetActor(actor, x, z, yaw) {
  actor.position.set(x, 0, z);
  actor.velocity.set(0, 0, 0);
  actor.yaw = yaw;
  actor.pitch = 0;
  actor.health = 100;
  actor.alive = true;
  actor.routeIndex = 0;
  actor.target = null;
  actor.plantProgress = 0;
  actor.defuseProgress = 0;
  actor.burstLeft = 0;
  actor.burstTimer = 0;
  actor.reactionTimer = 0;
  actor.hasBomb = false;
  if (actor.mesh) actor.mesh.visible = true;
  syncActorMesh(actor);
}

export function syncActorMesh(actor) {
  if (!actor.mesh) return;
  actor.mesh.position.copy(actor.position);
  actor.mesh.rotation.y = actor.yaw;
  actor.mesh.visible = actor.alive;
}

// Armour absorbs half of every hit until it runs out.
export function damageActor(actor, amount, isHead, now) {
  if (!actor.alive) return false;
  let remaining = amount;
  if (actor.armour > 0) {
    const absorbed = Math.min(actor.armour, Math.ceil(remaining / 2));
    actor.armour -= absorbed;
    remaining -= absorbed;
  }
  actor.health -= remaining;
  actor.lastDamageAt = now;
  if (actor.health <= 0) {
    actor.health = 0;
    actor.alive = false;
    if (actor.mesh) actor.mesh.visible = false;
    return true;
  }
  return false;
}

// Shared movement: wish is a unit XZ direction (or zero), speed is the top
// speed. Acceleration and friction give weight; the caller decides the
// direction, this decides how the body answers it.
export function moveActor(actor, wishX, wishZ, speed, dt, colliders, bounds) {
  const accel = 42;
  const friction = 11;
  if (wishX !== 0 || wishZ !== 0) {
    const len = Math.hypot(wishX, wishZ) || 1;
    actor.velocity.x += (wishX / len) * accel * dt;
    actor.velocity.z += (wishZ / len) * accel * dt;
  } else {
    const damp = Math.max(0, 1 - friction * dt);
    actor.velocity.x *= damp;
    actor.velocity.z *= damp;
  }
  const hSpeed = Math.hypot(actor.velocity.x, actor.velocity.z);
  if (hSpeed > speed) {
    actor.velocity.x = (actor.velocity.x / hSpeed) * speed;
    actor.velocity.z = (actor.velocity.z / hSpeed) * speed;
  }
  const next = collideCircle(colliders, bounds, actor.position.x + actor.velocity.x * dt,
    actor.position.z + actor.velocity.z * dt, actor.radius, 1.8);
  actor.position.x = next.x;
  actor.position.z = next.z;
  return next.pushed;
}

function eyePosition(actor) {
  return new THREE.Vector3(actor.position.x, actor.position.y + actor.eye, actor.position.z);
}

function distance2D(a, b) {
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
}

// Pick the nearest living enemy this bot can see.
function acquireTarget(bot, actors, ctx) {
  let best = null;
  let bestDist = Infinity;
  for (const other of actors) {
    if (other.team === bot.team || !other.alive) continue;
    const dist = distance2D(bot, other);
    if (dist > 55 || dist >= bestDist) continue;
    if (ctx.hasLineOfSight(eyePosition(bot), eyePosition(other))) {
      best = other;
      bestDist = dist;
    }
  }
  return best;
}

export function stepBot(bot, dt, ctx) {
  if (!bot.alive) return;
  const { time, rng, site, actors } = ctx;
  weaponStep(bot.weapon, dt, time);

  bot.sightTimer -= dt;
  if (bot.sightTimer <= 0) {
    bot.sightTimer = BOT.sightInterval + rng() * 0.08;
    bot.target = acquireTarget(bot, actors, ctx);
    if (bot.target) bot.reactionTimer = BOT.reactionSeconds;
  }

  // Bomb duties outrank routes.
  const bombPlanted = ctx.bombState === 'planted';
  let goal = null;
  let goalSpeed = BOT.walkSpeed;
  if (bombPlanted && bot.team === 'malam') {
    goal = [site.center.x, site.center.z];
    goalSpeed = BOT.runSpeed;
    const atSite = distance2D(bot, { position: site.center }) < 2.6;
    if (atSite && !bot.target) {
      bot.defuseProgress += dt;
      if (bot.defuseProgress >= 5) ctx.onDefused(bot);
      return;
    }
    bot.defuseProgress = 0;
  } else if (bot.hasBomb && bot.team === 'senja' && !bombPlanted) {
    goal = [site.center.x, site.center.z];
    goalSpeed = BOT.runSpeed;
    const atSite = distance2D(bot, { position: site.center }) < site.radius;
    if (atSite && !bot.target) {
      bot.plantProgress += dt;
      ctx.onPlanting(bot, bot.plantProgress);
      if (bot.plantProgress >= 3) ctx.onPlanted(bot);
      return;
    }
    bot.plantProgress = 0;
  }

  // Fighting: face the target, strafe, and fire in bursts.
  if (bot.target && bot.target.alive) {
    const target = bot.target;
    const dx = target.position.x - bot.position.x;
    const dz = target.position.z - bot.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    bot.yaw = Math.atan2(-dx, -dz);
    const targetEye = eyePosition(target);
    const myEye = eyePosition(bot);
    bot.pitch = Math.asin(Math.max(-1, Math.min(1, (targetEye.y - myEye.y) / Math.max(1, myEye.distanceTo(targetEye)))));

    bot.strafeTimer -= dt;
    if (bot.strafeTimer <= 0) {
      bot.strafeTimer = 0.5 + rng() * 0.9;
      bot.strafeDir = rng() < 0.5 ? -1 : 1;
      if (rng() < 0.3) bot.strafeDir = 0;
    }
    // Hold range: too close, back off; too far, close in.
    let advance = 0;
    if (dist > 22) advance = 1;
    else if (dist < 6) advance = -1;
    const forwardX = -Math.sin(bot.yaw) * advance;
    const forwardZ = -Math.cos(bot.yaw) * advance;
    const strafeX = Math.cos(bot.yaw) * bot.strafeDir;
    const strafeZ = -Math.sin(bot.yaw) * bot.strafeDir;
    moveActor(bot, forwardX + strafeX, forwardZ + strafeZ, BOT.walkSpeed, dt, ctx.colliders, ctx.bounds);

    bot.reactionTimer -= dt;
    bot.burstTimer -= dt;
    if (bot.reactionTimer <= 0) {
      if (bot.burstLeft <= 0 && bot.burstTimer <= 0) {
        bot.burstLeft = 1 + Math.floor(rng() * BOT.burstShots);
        bot.burstTimer = BOT.burstPause;
      }
      if (bot.burstLeft > 0 && bot.weapon.cooldown <= 0) {
        if (bot.weapon.mag <= 0) {
          weaponReload(bot.weapon, time);
        } else if (ctx.botShoot(bot, target, dist, rng)) {
          bot.burstLeft -= 1;
        }
      }
    }
    syncActorMesh(bot);
    return;
  }

  // No target: follow the route, pausing briefly at each waypoint (cover).
  if (!goal) {
    if (bot.route.length === 0) { syncActorMesh(bot); return; }
    if (bot.holdTimer > 0) {
      bot.holdTimer -= dt;
      syncActorMesh(bot);
      return;
    }
    const node = bot.route[bot.routeIndex % bot.route.length];
    goal = node;
    const dx = node[0] - bot.position.x;
    const dz = node[1] - bot.position.z;
    if (Math.hypot(dx, dz) < 1.2) {
      bot.routeIndex += 1;
      bot.holdTimer = 0.4 + rng() * 0.8;
      syncActorMesh(bot);
      return;
    }
  }
  if (goal) {
    const dx = goal[0] - bot.position.x;
    const dz = goal[1] - bot.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    bot.yaw = Math.atan2(-dx, -dz);
    moveActor(bot, dx / dist, dz / dist, goalSpeed, dt, ctx.colliders, ctx.bounds);
  }
  syncActorMesh(bot);
}
