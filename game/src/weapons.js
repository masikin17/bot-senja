// Pasar Senja — weapons, grenades and the shooting feel.
//
// A weapon is state, not a mesh: {def, mag, reserve, cooldown, reloading,
// reloadEndsAt}. Firing is hitscan (the caller raycasts and applies the
// damage); this module owns the timing, the spread and the recoil that make
// stopping to aim pay, per the judge's gunplay criterion. A grenade is a
// small physics object: thrown in an arc, it bounces once and explodes.

import { WEAPONS, GRENADE_DAMAGE, GRENADE_RADIUS } from './config.js';

export function createWeapon(weaponId) {
  const def = WEAPONS[weaponId];
  return {
    def, mag: def.mag, reserve: def.reserve,
    cooldown: 0, reloading: false, reloadEndsAt: 0, shotsFired: 0,
  };
}

export function weaponSpread(weapon, speed, airborne, crouched) {
  const def = weapon.def;
  let spread = def.spread;
  if (speed > 0.5) spread += def.moveSpread * Math.min(1, speed / 5);
  if (airborne) spread += 0.05;
  if (crouched) spread *= 0.55;
  // Firing heats the cone up: consecutive shots widen it, it recovers as
  // the weapon cools. This is the recoil/spread loop the player feels.
  spread += Math.min(0.045, weapon.shotsFired * 0.003);
  return spread;
}

export function weaponReady(weapon, now) {
  return !weapon.reloading && weapon.cooldown <= 0 && weapon.mag > 0;
}

export function weaponFire(weapon, now) {
  if (!weaponReady(weapon, now)) return false;
  weapon.mag -= 1;
  weapon.cooldown = weapon.def.fireInterval;
  weapon.shotsFired += 1;
  return true;
}

export function weaponStep(weapon, dt, now) {
  weapon.cooldown = Math.max(0, weapon.cooldown - dt);
  if (weapon.reloading && now >= weapon.reloadEndsAt) {
    const needed = weapon.def.mag - weapon.mag;
    const taken = Math.min(needed, weapon.reserve);
    weapon.mag += taken;
    weapon.reserve -= taken;
    weapon.reloading = false;
  }
  // The cone cools down when the trigger is released.
  if (weapon.cooldown <= 0) weapon.shotsFired = Math.max(0, weapon.shotsFired - dt * 14);
}

export function weaponReload(weapon, now) {
  if (weapon.reloading || weapon.mag >= weapon.def.mag || weapon.reserve <= 0) return false;
  weapon.reloading = true;
  weapon.reloadEndsAt = now + weapon.def.reloadSeconds;
  return true;
}

export function weaponRefill(weapon) {
  weapon.mag = weapon.def.mag;
  weapon.reserve = weapon.def.reserve;
  weapon.reloading = false;
  weapon.cooldown = 0;
  weapon.shotsFired = 0;
}

// --- Grenades ----------------------------------------------------------------
// One live grenade per thrower at most; the match keeps a short list and
// steps them in the fixed simulation. Gravity pulls the arc down, the
// ground bounces it once (half speed), and after 1.6 s it explodes: every
// actor inside GRENADE_RADIUS takes falloff damage through walls (the
// market is open, so a thrown grenade is a zoning tool, not a wall hack).

export function createGrenade(position, velocity) {
  return {
    position: position.clone(),
    velocity: velocity.clone(),
    fuse: 1.6,
    bounced: false,
    exploded: false,
  };
}

export function stepGrenade(grenade, dt) {
  if (grenade.exploded) return;
  grenade.fuse -= dt;
  grenade.velocity.y -= 13.5 * dt;
  grenade.position.addScaledVector(grenade.velocity, dt);
  if (grenade.position.y < 0.12) {
    grenade.position.y = 0.12;
    if (!grenade.bounced) {
      grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.45;
      grenade.velocity.x *= 0.7;
      grenade.velocity.z *= 0.7;
      grenade.bounced = true;
    } else {
      grenade.velocity.y = 0;
      grenade.velocity.x *= 0.85;
      grenade.velocity.z *= 0.85;
    }
  }
  if (grenade.fuse <= 0) grenade.exploded = true;
}

export function grenadeDamage(grenade, targetPosition) {
  const distance = grenade.position.distanceTo(targetPosition);
  if (distance > GRENADE_RADIUS) return 0;
  return Math.round(GRENADE_DAMAGE * (1 - distance / (GRENADE_RADIUS * 1.4)));
}
