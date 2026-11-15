// rounds.js — the match: freeze time, round timer, plant/defuse, the
// economy and the buy menu's numbers. State lives in one place (the G
// object); this module only moves it forward.
import { WEAPONS, BUY_ORDER } from './weapons.js';
import { pick } from './rng.js';

export const FREEZE_T = 5, ROUND_T = 100, PLANT_T = 3.5, DEFUSE_T = 5, BOMB_T = 40;
export const WIN_ROUNDS = 7, MAX_ROUNDS = 13;

// Economy (per player, dollars).
export const ECON = {
  start: 800, kill: 300, win: 3250, loss: 1900, lossBonus: 500, lossMax: 3400,
  plant: 300, defuse: 300,
};

export function newMatch(G) {
  G.match = {
    round: 1, scoreV: 0, scoreS: 0, phase: 'freeze', phaseT: FREEZE_T,
    bombT: 0, planted: false, plantAt: null, plantSite: null,
    lossStreak: 0, over: false, winner: null, site: 'A',
  };
  G.planted = false; G.plantAt = null;
  G.money = ECON.start;
  G.kills = 0; G.deaths = 0; G.earned = 0;
  startRound(G);
}

export function startRound(G) {
  const m = G.match;
  m.phase = 'freeze'; m.phaseT = FREEZE_T;
  m.planted = false; G.planted = false; G.plantAt = null; m.bombT = 0;
  // Pick the attack site for this round and re-roll roles.
  m.site = pick(G.rng, ['A', 'A', 'B']);
  const vBots = G.bots.filter((b) => b.team === 'V');
  const sBots = G.bots.filter((b) => b.team === 'S');
  // Vanguard: one carrier, two escorts, two flankers.
  const vRoles = ['carrier', 'escort', 'escort', 'flank', 'flank'];
  vBots.forEach((b, i) => {
    b.assignRole(G, vRoles[i], m.site);
    b.carrier = vRoles[i] === 'carrier';
    if (b.carrier) G.carrier = b;
  });
  // Sentinel: two hold A, two hold B, one roams mid.
  const sRoles = ['holdA', 'holdA', 'holdB', 'holdB', 'roam'];
  sBots.forEach((b, i) => b.assignRole(G, sRoles[i], m.site));
  // Respawn everyone at their spawn points, fresh HP/ammo.
  respawnAll(G);
  G.buyOpen = true;
  G.hudBanner(`ROUND ${m.round}`, m.site === 'A' ? 'Attack Relay A' : 'Attack Relay B', 'info');
  G.sfx.play('roundStart');
}

function respawnAll(G) {
  const vSpawns = G.world.spawns.vanguard, sSpawns = G.world.spawns.sentinel;
  G.playerBot.pos.set(vSpawns[0][0], 0, vSpawns[0][1]);
  G.playerBot.vel.set(0, 0, 0);
  G.playerBot.hp = 100; G.playerBot.armor = G.playerArmorKept ? G.playerBot.armor : 0;
  G.playerBot.alive = true; G.playerBot.yaw = 0; // face north, into the yard
  G.playerBot.pitch = 0;
  G.bots.forEach((b, i) => {
    const sp = b.team === 'V' ? vSpawns[(i % 4) + 1] : sSpawns[i % 5];
    b.pos.set(sp[0], 0, sp[1]);
    b.vel.set(0, 0, 0);
    b.hp = 100; b.armor = 0; b.alive = true;
    b.yaw = b.team === 'V' ? 0 : Math.PI; // Vanguard north, Sentinel south
    b.group.visible = true;
    b.ammo = { mag: 30, reserve: 96, reloading: false, reloadEnd: 0 };
    b.objProgress = 0; b.target = null; b.state = 'push';
  });
  // Player keeps their weapons across rounds if alive at round end; on
  // death the loadout resets to the sidearm (re-buy next round).
  if (G.playerDiedLastRound) {
    G.playerWeapon = 'p9';
    G.playerAmmo = { p9: { mag: 12, reserve: 48, reloading: false, reloadEnd: 0 } };
    G.playerDiedLastRound = false;
  }
  G.playerPlanting = 0; G.playerDefusing = 0;
}

// Buy an item for the player. Returns a message for the HUD.
export function buy(G, wid) {
  const w = WEAPONS[wid];
  if (!w) return '';
  if (G.match.phase !== 'freeze') return 'Buy menu is closed — round is live.';
  if (wid === 'spark') {
    if (G.grenadeCount >= 1) return 'Already carrying a Spark-3.';
    if (G.money < w.price) return 'Not enough money.';
    G.money -= w.price; G.grenadeCount = 1;
    return 'Spark-3 bought.';
  }
  if (wid === 'p9') return 'P9 Sidearm is always owned.';
  if (G.playerOwned.has(wid)) return `${w.name} already owned.`;
  if (G.money < w.price) return 'Not enough money.';
  G.money -= w.price;
  G.playerOwned.add(wid);
  G.playerAmmo[wid] = { mag: w.mag, reserve: w.reserve, reloading: false, reloadEnd: 0 };
  G.equip(wid);
  return `${w.name} bought.`;
}

export function buyList(G) {
  return BUY_ORDER.map((wid) => {
    const w = WEAPONS[wid];
    return {
      wid, name: w.name, price: w.price, desc: w.desc,
      owned: wid === 'p9' || G.playerOwned.has(wid),
      afford: G.money >= w.price,
    };
  });
}

// --- Per-tick update (fixed dt) ---
export function updateRounds(G, dt) {
  const m = G.match;
  if (m.over) return;
  if (m.phase === 'freeze') {
    m.phaseT -= dt;
    if (m.phaseT <= 0) { m.phase = 'live'; m.phaseT = ROUND_T; G.buyOpen = false; G.hudBanner('', '', ''); }
    return;
  }
  if (m.phase === 'live') {
    m.phaseT -= dt;
    // Plant / defuse channels.
    updateObjective(G, dt);
    if (m.planted) { m.phase = 'planted'; m.bombT = BOMB_T; }
    if (m.phaseT <= 0) return endRound(G, 'time');
    const vAlive = aliveCount(G, 'V') + (G.playerBot.alive ? 1 : 0);
    const sAlive = aliveCount(G, 'S');
    if (vAlive === 0) return endRound(G, 'elimS');
    if (sAlive === 0) return endRound(G, m.planted ? 'elimV' : 'elimV');
    return;
  }
  if (m.phase === 'planted') {
    m.bombT -= dt;
    updateObjective(G, dt);
    if (m.bombT <= 0) return endRound(G, 'detonate');
    const sAlive = aliveCount(G, 'S');
    const vAlive = aliveCount(G, 'V') + (G.playerBot.alive ? 1 : 0);
    if (sAlive === 0) return endRound(G, 'elimV');
    if (vAlive === 0) return endRound(G, 'elimS');
  }
}

function aliveCount(G, team) {
  return G.bots.reduce((n, b) => n + (b.team === team && b.alive ? 1 : 0), 0);
}

function updateObjective(G, dt) {
  const m = G.match;
  // The carrier bot plants at its site.
  const carrier = G.carrier;
  if (!m.planted && carrier && carrier.alive && carrier.carrier && carrier.state === 'plant') {
    carrier.objProgress += dt;
    if (carrier.objProgress >= PLANT_T) {
      plantCharge(G, carrier.pos, m.site);
      carrier.objProgress = 0;
    }
  } else if (carrier && carrier.state !== 'plant') carrier.objProgress = 0;
  // The player plants too (hold E inside a site, carrying the charge).
  // In a screenshot still the channel is frozen mid-progress, not advanced.
  if (!m.planted && !G.shotFreeze && G.playerHasCharge && G.playerPlanting > 0) {
    G.playerPlanting += dt;
    if (G.playerPlanting >= PLANT_T) {
      plantCharge(G, G.playerBot.pos, G.playerSite);
      G.playerPlanting = 0;
    }
  }
  // Defuse: a Sentinel bot channels at the planted charge.
  if (m.planted) {
    for (const b of G.bots) {
      if (b.team === 'S' && b.alive && b.state === 'defuse') {
        b.objProgress += dt;
        if (b.objProgress >= DEFUSE_T) {
          G.sfx.play('defuse');
          return endRound(G, 'defuse');
        }
      }
    }
  }
}

function plantCharge(G, pos, site) {
  const m = G.match;
  m.planted = true; G.planted = true;
  G.plantCount = (G.plantCount || 0) + 1;
  G.plantAt = { x: pos.x, z: pos.z };
  m.plantSite = site; m.bombT = BOMB_T;
  G.hudBanner('CHARGE PLANTED', `Detonation in ${BOMB_T}s — hold the site`, 'warn');
  G.sfx.play('plant');
  G.money += ECON.plant; G.earned += ECON.plant;
  // Show the charge mesh at the plant spot.
  if (G.chargeMesh) {
    G.chargeMesh.visible = true;
    G.chargeMesh.position.set(pos.x, 0.15, pos.z);
  }
}

export function endRound(G, why) {
  const m = G.match;
  let vWon = false, label = '';
  if (why === 'detonate') { vWon = true; label = 'CHARGE DETONATED'; }
  else if (why === 'defuse') { vWon = false; label = 'CHARGE DEFUSED'; }
  else if (why === 'elimV') { vWon = true; label = 'TEAM ELIMINATED'; }
  else if (why === 'elimS') { vWon = false; label = 'TEAM ELIMINATED'; }
  else { vWon = false; label = 'TIME EXPIRED'; }
  if (vWon) {
    m.scoreV++;
    G.money += ECON.win; G.earned += ECON.win;
    m.lossStreak = 0;
    G.hudBanner(label, 'Vanguard takes the round', 'win');
    G.sfx.play('win');
  } else {
    m.scoreS++;
    const bonus = ECON.loss + Math.min(m.lossStreak * ECON.lossBonus, ECON.lossMax - ECON.loss);
    G.money += bonus; G.earned += bonus;
    m.lossStreak++;
    G.hudBanner(label, 'Sentinel holds the round', 'lose');
    G.sfx.play('lose');
  }
  if (G.chargeMesh) G.chargeMesh.visible = false;
  G.playerDiedLastRound = !G.playerBot.alive;
  G.playerArmorKept = G.playerBot.alive;
  // Match end?
  const finalRound = m.round >= MAX_ROUNDS || (m.scoreV === 6 && m.scoreS === 6);
  if (m.scoreV >= WIN_ROUNDS || m.scoreS >= WIN_ROUNDS || (finalRound && m.scoreV !== m.scoreS)) {
    m.over = true;
    m.winner = m.scoreV > m.scoreS ? 'V' : 'S';
    G.hudMatchEnd(m.winner, m.scoreV, m.scoreS, G.kills, G.deaths, G.earned);
    return;
  }
  if (m.scoreV === 6 && m.scoreS === 6) G.hudBanner('OVERTIME', 'One final round decides it', 'warn');
  m.round++;
  m.phase = 'intermission'; m.phaseT = 3;
  G.intermission = true;
}

// Called from the main loop while intermission runs.
export function updateIntermission(G, dt) {
  const m = G.match;
  if (m.phase !== 'intermission') return;
  m.phaseT -= dt;
  if (m.phaseT <= 0) { G.intermission = false; startRound(G); }
}
