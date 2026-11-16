// Pasar Senja — the match: rounds, economy, the bomb, and the score.
//
// One match is a small state machine:
//   freeze (4 s, buy menu open) -> live (100 s, fight / plant / defuse)
//   -> roundEnd (banner, 4 s) -> freeze ... until one team reaches 7 or
//   13 rounds are played. The player is Senja; the bomb starts with the
//   player. If the player dies carrying it, the nearest living Senja bot
//   picks it up and pushes Site A.
//
// Money is per-fighter and simple: kills, plants and round results pay,
// the buy menu spends. The HUD reads this module's `state` every frame, so
// the screen and the simulation can never disagree about the score.

import { MATCH, WEAPONS, ARMOUR_PRICE, GRENADE_PRICE } from './config.js';

export function createMatch() {
  return {
    phase: 'freeze', // freeze | live | roundEnd | matchEnd
    phaseEndsAt: MATCH.freezeSeconds,
    round: 1,
    score: { senja: 0, malam: 0 },
    bombState: 'carried', // carried | planted | exploded | defused
    bombTimer: 0,
    bombCarrier: null,
    planter: null,
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    lossStreak: { senja: 0, malam: 0 },
    kills: [],
    events: [], // {text, team, at} for the kill feed, newest first
    time: 0,
  };
}

export function startRound(match, actors, world) {
  match.phase = 'freeze';
  match.phaseEndsAt = match.time + MATCH.freezeSeconds;
  match.bombState = 'carried';
  match.bombTimer = 0;
  match.planter = null;
  match.roundWinner = null;
  match.roundReason = '';
  // Spawns: Senja south, Malam north, facing each other across the market.
  const senjaSpawns = world.spawnSenja;
  const malamSpawns = world.spawnMalam;
  let si = 0;
  let mi = 0;
  for (const actor of actors) {
    if (actor.team === 'senja') {
      const [x, z] = senjaSpawns[si % senjaSpawns.length];
      si += 1;
      actor.reset(x, z, Math.PI);
    } else {
      const [x, z] = malamSpawns[mi % malamSpawns.length];
      mi += 1;
      actor.reset(x, z, 0);
    }
    actor.hasBomb = false;
  }
  // The player carries the bomb into every round.
  const player = actors.find((a) => a.isPlayer);
  if (player) {
    player.hasBomb = true;
    match.bombCarrier = player;
  }
}

export function awardMoney(actor, amount) {
  actor.money = Math.min(16000, (actor.money ?? MATCH.startMoney) + amount);
}

export function buyWeapon(match, actor, weaponId, audio) {
  const def = WEAPONS[weaponId];
  if (!def) return false;
  if (match.phase !== 'freeze' && match.phase !== 'roundEnd') return false;
  if (actor.weapon.def.id === weaponId) return false;
  if ((actor.money ?? 0) < def.price) {
    if (audio) audio.denied();
    return false;
  }
  actor.money -= def.price;
  actor.setWeapon(weaponId);
  if (audio) audio.buy();
  return true;
}

export function buyArmour(match, actor, audio) {
  if (match.phase !== 'freeze') return false;
  if (actor.armour >= 100 || (actor.money ?? 0) < ARMOUR_PRICE) {
    if (audio) audio.denied();
    return false;
  }
  actor.money -= ARMOUR_PRICE;
  actor.armour = 100;
  if (audio) audio.buy();
  return true;
}

export function buyGrenade(match, actor, audio) {
  if (match.phase !== 'freeze') return false;
  if (actor.grenades >= 1 || (actor.money ?? 0) < GRENADE_PRICE) {
    if (audio) audio.denied();
    return false;
  }
  actor.money -= GRENADE_PRICE;
  actor.grenades = 1;
  if (audio) audio.buy();
  return true;
}

export function endRound(match, winner, reason, actors, audio) {
  if (match.phase === 'roundEnd' || match.phase === 'matchEnd') return;
  match.phase = 'roundEnd';
  match.phaseEndsAt = match.time + 4;
  match.roundWinner = winner;
  match.roundReason = reason;
  match.score[winner] += 1;
  const loser = winner === 'senja' ? 'malam' : 'senja';
  match.lossStreak[winner] = 0;
  match.lossStreak[loser] += 1;
  for (const actor of actors) {
    if (!actor.alive && actor.team !== winner) continue;
    if (actor.team === winner) {
      awardMoney(actor, MATCH.winMoney);
    } else {
      awardMoney(actor, MATCH.lossMoney + (match.lossStreak[loser] >= 2 ? MATCH.lossStreakBonus : 0));
    }
    // Survivors keep their weapon; the fallen rebuy next freeze.
    if (!actor.alive) actor.setWeapon('pistol');
  }
  const player = actors.find((a) => a.isPlayer);
  if (audio) {
    if (player && player.team === winner) audio.roundWin();
    else audio.roundLose();
  }
  if (match.score[winner] >= MATCH.roundsToWin || match.round >= MATCH.maxRounds) {
    match.phase = 'matchEnd';
    match.matchWinner = match.score.senja === match.score.malam
      ? (match.score.senja >= MATCH.roundsToWin ? 'senja' : 'malam')
      : (match.score.senja > match.score.malam ? 'senja' : 'malam');
    match.phaseEndsAt = match.time + 9999;
  }
}

export function nextRound(match, actors, world) {
  match.round += 1;
  startRound(match, actors, world);
}

// The bomb changes hands when its carrier dies.
export function onCarrierDied(match, actors, carrier) {
  if (match.bombState !== 'carried' || match.bombCarrier !== carrier) return;
  match.bombCarrier = null;
  const candidates = actors.filter((a) => a.team === 'senja' && a.alive && !a.isPlayer);
  if (candidates.length > 0) {
    const next = candidates[0];
    next.hasBomb = true;
    match.bombCarrier = next;
    match.events.unshift({ text: `${next.name} picked up the bomb`, team: 'senja', at: match.time });
  }
}

export function stepMatch(match, dt, actors, world, audio, hooks) {
  match.time += dt;
  if (match.phase === 'freeze' && match.time >= match.phaseEndsAt) {
    match.phase = 'live';
    match.phaseEndsAt = match.time + MATCH.roundSeconds;
  } else if (match.phase === 'live') {
    if (match.bombState === 'planted') {
      match.bombTimer -= dt;
      if (match.bombTimer <= 0) {
        match.bombState = 'exploded';
        if (audio) audio.explosion(0);
        endRound(match, 'senja', 'Bomb detonated at Site A', actors, audio);
        return;
      }
    } else if (match.time >= match.phaseEndsAt) {
      // Time out: defenders win, unless the bomb is planted (handled above).
      endRound(match, 'malam', 'Time expired — Site A held', actors, audio);
      return;
    }
    // A live round also ends when one team is eliminated.
    const senjaAlive = actors.some((a) => a.team === 'senja' && a.alive);
    const malamAlive = actors.some((a) => a.team === 'malam' && a.alive);
    if (!senjaAlive) endRound(match, 'malam', 'Senja team eliminated', actors, audio);
    else if (!malamAlive) endRound(match, 'senja', 'Malam team eliminated', actors, audio);
  } else if (match.phase === 'roundEnd' && match.time >= match.phaseEndsAt) {
    nextRound(match, actors, world);
  }
  if (hooks) hooks.onStep(match);
}

export function roundTimeLeft(match) {
  if (match.phase === 'freeze') return Math.max(0, match.phaseEndsAt - match.time);
  if (match.phase === 'live') return Math.max(0, match.phaseEndsAt - match.time);
  return 0;
}

export function aliveCount(actors, team) {
  return actors.filter((a) => a.team === team && a.alive).length;
}
