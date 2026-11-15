// bots.js — the other nine players. A bot is a Player with a brain:
// a role, a route through the waypoint graph, a state machine, eyes and
// ears. Shooting is a probability model (never aimbot): distance, target
// speed and stance set the hit chance, so a still, crouched player is
// genuinely hard to hit and a sprinting one in the open is not.
import * as THREE from 'three';
import { C, mat, flat, box } from './palette.js';
import { Player } from './player.js';
import { findPath, nearestReachableWp, losBlocked } from './world.js';
import { range, pick, chance } from './rng.js';
import { botShoot } from './combat.js';

const CALLSIGNS = {
  V: ['Vex', 'Iris', 'Koda', 'Mira', 'Juno'],
  S: ['Ash', 'Bram', 'Cy', 'Dax', 'Ember'],
};
const VISION_RANGE = 45, VISION_HALF = 1.05; // ~120° cone (half-angle rad)
const HEAR_SHOT = 28, HEAR_STEP = 8;

export class Bot extends Player {
  constructor(G, team, idx, x, z) {
    super(x, z);
    this.G = G;
    this.team = team; // 'V' Vanguard (attack) or 'S' Sentinel (defend)
    this.name = CALLSIGNS[team][idx];
    this.weapon = 'vk7';
    this.ammo = { mag: 30, reserve: 96, reloading: false, reloadEnd: 0 };
    this.aimSkill = range(G.rng, 0.75, 1.05);
    this.react = range(G.rng, 0.25, 0.45);
    this.state = 'push';
    this.role = 'push';
    this.path = []; this.pathIdx = 0;
    this.target = null; this.lastSeen = 0; this.reactAt = 0;
    this.nextThink = 0; this.burstLeft = 0; this.burstAt = 0; this.burstPause = 0;
    this.objProgress = 0; this.carrier = false;
    this.moving = false; this.strafeDir = 1; this.strafeAt = 0;
    this.hearAt = 0; this.hearPos = null;
    this.group = this.buildBody();
    this.group.position.copy(this.pos);
    G.scene.add(this.group);
  }

  buildBody() {
    const g = new THREE.Group();
    const cloth = mat(this.team === 'V' ? C.vanguard : C.sentinel, 0.7, 0.1);
    const dark = mat(C.dark, 0.6, 0.3);
    const add = (mesh, part, y) => {
      mesh.position.y = y;
      mesh.userData = { bot: this, part };
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    // Head (sphere), torso (box), legs (box) — the three hit zones.
    add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), cloth), 'head', 1.58);
    add(box(0.5, 0.62, 0.3, cloth, 0, 0, 0), 'torso', 1.16);
    add(box(0.44, 0.72, 0.28, dark, 0, 0, 0), 'legs', 0.42);
    // Visor stripe + gun so the bot reads as a soldier, not a mannequin.
    const visor = box(0.2, 0.05, 0.02, flat(C.amber), 0, 1.6, 0.16, false);
    g.add(visor);
    const gun = box(0.07, 0.1, 0.55, dark, 0.18, 1.25, 0.2);
    g.add(gun);
    this.hitMeshes = g.children.filter((m) => m.userData.bot);
    return g;
  }

  muzzle() {
    const p = this.pos.clone();
    p.y += 1.35;
    p.x += Math.sin(this.yaw) * -0.5; p.z += Math.cos(this.yaw) * -0.5;
    return p;
  }

  // --- Round setup: role + route, re-rolled every round. ---
  assignRole(G, role, site) {
    this.role = role;
    this.site = site; // 'A' | 'B'
    this.objProgress = 0;
    const wps = G.world.waypoints;
    const here = nearestReachableWp(wps, G.world.colliders, this.pos.x, this.pos.z);
    let dest;
    if (role === 'carrier') dest = site === 'A' ? 18 : 22; // the site centre
    else if (role === 'escort') dest = site === 'A' ? pick(G.rng, [17, 19, 18, 31]) : pick(G.rng, [23, 33, 34, 22]);
    else if (role === 'flank') dest = site === 'A' ? pick(G.rng, [23, 33, 16]) : pick(G.rng, [17, 19, 12]);
    else if (role === 'holdA') dest = pick(G.rng, [17, 18, 19, 31]);
    else if (role === 'holdB') dest = pick(G.rng, [22, 23, 32, 34]);
    else dest = pick(G.rng, [9, 10, 14, 20]); // roam mid
    this.path = findPath(wps, here, dest);
    this.pathIdx = 0;
    this.state = 'push';
  }

  // --- Perception ---
  sees(G, e) {
    if (!e.alive) return false;
    const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > VISION_RANGE) return false;
    // Vision cone around current facing (or 360° just after a heard shot).
    const ang = Math.atan2(-dx, -dz); // yaw that faces the enemy
    let diff = ang - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > VISION_HALF && G.time - this.hearAt > 1.5) return false;
    return !losBlocked(G.world.colliders, this.pos.x, this.pos.z, e.pos.x, e.pos.z);
  }

  enemies(G) {
    const list = G.bots.filter((b) => b.alive && b.team !== this.team);
    // The player is Vanguard: only Sentinels count them as an enemy.
    if (this.team === 'S' && G.playerBot.alive) list.push(G.playerBot);
    return list;
  }

  nearestEnemy(G) {
    let best = null, bd = Infinity;
    for (const e of this.enemies(G)) {
      const d = (e.pos.x - this.pos.x) ** 2 + (e.pos.z - this.pos.z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // --- Main update (called at fixed 60 Hz) ---
  update(dt, G) {
    if (!this.alive) { this.group.visible = false; return; }
    const now = G.time;
    // Hearing: a recent shot nearby turns the bot toward it.
    if (G.lastShot && now - G.lastShot.t < 1.2) {
      const d = Math.hypot(G.lastShot.x - this.pos.x, G.lastShot.z - this.pos.z);
      if (d < HEAR_SHOT) { this.hearAt = now; this.hearPos = { x: G.lastShot.x, z: G.lastShot.z }; }
    }
    if (now >= this.nextThink) {
      this.nextThink = now + 0.25;
      this.think(G, now);
    }
    // Movement input from the current state.
    const input = { f: 0, b: 0, l: 0, r: 0, jump: 0, crouch: 0, sprint: 0 };
    this.drive(G, input, now);
    super.update(dt, input, G.world.colliders);
    // Reload behind cover: when the mag is dry and no enemy is seen.
    if (this.ammo.mag === 0 && !this.target) this.startReload(G);
    if (this.ammo.reloading && now >= this.ammo.reloadEnd) {
      this.ammo.reloading = false;
      const need = 30 - this.ammo.mag, take = Math.min(need, this.ammo.reserve);
      this.ammo.mag += take; this.ammo.reserve -= take;
    }
    // Shooting (burst fire) while engaged.
    if (this.target && this.target.alive && now >= this.reactAt && now >= this.burstPause) {
      if (this.burstLeft > 0 && now >= this.burstAt && !this.ammo.reloading && this.ammo.mag > 0) {
        this.burstLeft--; this.burstAt = now + 0.096;
        this.ammo.mag--;
        botShoot(G, this, this.target);
        G.sfx.playAt('shot', this.pos, G.playerBot.pos);
        if (this.burstLeft === 0) this.burstPause = now + range(G.rng, 0.4, 0.9);
      } else if (this.burstLeft === 0 && now >= this.burstPause) {
        this.burstLeft = 3 + Math.floor(G.rng() * 3);
      }
    }
    // Sync the visual body.
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.moving = this.speed2d > 0.5;
  }

  think(G, now) {
    // Find a visible enemy.
    let seen = null;
    for (const e of this.enemies(G)) if (this.sees(G, e)) { seen = e; break; }
    if (seen) {
      if (this.target !== seen) { this.reactAt = now + this.react; }
      this.target = seen; this.lastSeen = now;
      this.state = 'engage';
      return;
    }
    if (this.target && now - this.lastSeen > 1.2) this.target = null;
    // Low HP: fall back toward the own site.
    if (this.hp < 30 && this.state !== 'retreat') {
      this.state = 'retreat';
      const wps = G.world.waypoints;
      const here = nearestReachableWp(wps, G.world.colliders, this.pos.x, this.pos.z);
      const dest = this.team === 'V' ? (this.site === 'A' ? 19 : 22) : (this.site === 'A' ? 31 : 32);
      this.path = findPath(wps, here, dest); this.pathIdx = 0;
      return;
    }
    // Objective states.
    if (this.role === 'carrier' && this.carrier && this.atSite(G)) {
      this.state = 'plant'; return;
    }
    if (this.team === 'S' && G.planted && this.nearCharge(G)) {
      this.state = 'defuse'; return;
    }
    if (this.state === 'engage' || this.state === 'plant' || this.state === 'defuse' || this.state === 'retreat') {
      if (this.state === 'retreat' && this.pathIdx >= this.path.length) this.state = 'hold';
      else if (this.state !== 'retreat') this.state = this.pathIdx >= this.path.length ? 'hold' : 'push';
    }
    // Heard a shot: investigate briefly.
    if (this.hearPos && now - this.hearAt < 2 && this.state === 'hold') {
      const wps = G.world.waypoints;
      const here = nearestReachableWp(wps, G.world.colliders, this.pos.x, this.pos.z);
      this.path = findPath(wps, here, nearestReachableWp(wps, G.world.colliders, this.hearPos.x, this.hearPos.z));
      this.pathIdx = 0; this.state = 'push';
    }
  }

  atSite(G) {
    const s = G.world.sites[this.site];
    return Math.hypot(this.pos.x - s.x, this.pos.z - s.z) < s.r;
  }
  nearCharge(G) {
    return G.plantAt && Math.hypot(this.pos.x - G.plantAt.x, this.pos.z - G.plantAt.z) < 2.5;
  }

  drive(G, input, now) {
    // Face the enemy while engaged; otherwise face the walk direction.
    if (this.target && this.target.alive) {
      const dx = this.target.pos.x - this.pos.x, dz = this.target.pos.z - this.pos.z;
      const want = Math.atan2(-dx, -dz);
      this.yaw = turnToward(this.yaw, want, 6 * (1 / 60));
      // Strafe while fighting.
      if (now >= this.strafeAt) { this.strafeDir *= -1; this.strafeAt = now + range(G.rng, 0.5, 1.2); }
      if (chance(G.rng, 0.5)) input[this.strafeDir > 0 ? 'r' : 'l'] = 1;
      return;
    }
    if (this.state === 'plant' || this.state === 'defuse') {
      this.objProgress += 1 / 60;
      return; // stand still and channel
    }
    if (this.state === 'hold') {
      // Peek: slow yaw sweep.
      this.yaw += Math.sin(now * 0.5 + this.name.charCodeAt(0)) * 0.004;
      return;
    }
    // Walk the path.
    const wp = G.world.waypoints[this.path[this.pathIdx]];
    if (!wp) return;
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) { this.pathIdx++; return; }
    const want = Math.atan2(-dx, -dz);
    this.yaw = turnToward(this.yaw, want, 5 * (1 / 60));
    input.f = 1;
  }

  startReload(G) {
    if (this.ammo.reloading || this.ammo.reserve <= 0 || this.ammo.mag >= 30) return;
    this.ammo.reloading = true;
    this.ammo.reloadEnd = G.time + 1.9;
    G.sfx.playAt('reload', this.pos, G.playerBot.pos);
  }

  // Called by rounds.js when this bot takes the charge / dies carrying it.
  dropCharge(G) {
    if (this.carrier) { this.carrier = false; G.chargeAt = { x: this.pos.x, z: this.pos.z }; }
  }
}

function turnToward(cur, want, maxStep) {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}
