// combat.js — shooting, damage, tracers, impact particles and grenades.
// One job: turn a trigger pull into a ray, a hit, a number and a picture.
// Hitscan for the player (raycast vs bot hitboxes + wall meshes); a
// probability model for bots (fair, tunable, never aimbot-accurate).
import * as THREE from 'three';
import { C, mat, flat, box } from './palette.js';
import { losBlocked } from './world.js';

const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();

// --- Tracers + impact particles (pooled, zero per-frame allocation) ---
export function makeFx(scene) {
  const tracers = [];
  for (let i = 0; i < 24; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: C.amber, transparent: true, opacity: 0 }));
    line.frustumCulled = false; scene.add(line);
    tracers.push({ line, life: 0 });
  }
  const sparks = [];
  const sparkGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
  const sparkMat = flat(C.amber);
  for (let i = 0; i < 60; i++) {
    const m = new THREE.Mesh(sparkGeo, sparkMat);
    m.visible = false; scene.add(m);
    sparks.push({ m, vel: new THREE.Vector3(), life: 0 });
  }
  return { tracers, sparks, ti: 0, si: 0 };
}

export function spawnTracer(fx, from, to) {
  const t = fx.tracers[fx.ti]; fx.ti = (fx.ti + 1) % fx.tracers.length;
  const p = t.line.geometry.attributes.position.array;
  p[0] = from.x; p[1] = from.y; p[2] = from.z;
  p[3] = to.x; p[4] = to.y; p[5] = to.z;
  t.line.geometry.attributes.position.needsUpdate = true;
  t.line.material.opacity = 0.9; t.life = 0.08;
}

export function spawnSparks(fx, at, n, rng) {
  for (let k = 0; k < n; k++) {
    const s = fx.sparks[fx.si]; fx.si = (fx.si + 1) % fx.sparks.length;
    s.m.position.copy(at); s.m.visible = true;
    s.vel.set((rng() - 0.5) * 4, rng() * 3 + 1, (rng() - 0.5) * 4);
    s.life = 0.35 + rng() * 0.2;
  }
}

export function updateFx(fx, dt) {
  for (const t of fx.tracers) {
    if (t.frozen || t.life <= 0) continue; // the still's hero tracer stays
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.08) * 0.9;
  }
  for (const s of fx.sparks) {
    if (s.life <= 0) continue;
    s.life -= dt;
    s.vel.y -= 12 * dt;
    s.m.position.addScaledVector(s.vel, dt);
    if (s.m.position.y < 0.03) { s.m.position.y = 0.03; s.vel.y *= -0.4; }
    if (s.life <= 0) s.m.visible = false;
  }
}

// --- Damage ---
// part: 'head' | 'torso' | 'legs'. Armour absorbs half until depleted.
export function applyDamage(target, raw, part, attacker, G) {
  if (!target.alive) return 0;
  const mult = part === 'head' ? 4 : part === 'legs' ? 0.75 : 1;
  let dmg = raw * mult;
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, dmg * 0.5);
    target.armor -= absorbed; dmg -= absorbed;
  }
  dmg = Math.max(1, Math.round(dmg));
  target.hp -= dmg;
  if (target.hp <= 0) {
    target.hp = 0; target.alive = false;
    if (attacker) G.onKill(attacker, target, part === 'head');
  }
  return dmg;
}

// --- Player hitscan ---
// origin/direction in world space; returns { hit, point, target, part }.
export function hitscan(G, origin, dir, weapon, shooter) {
  _ray.set(origin, dir);
  _ray.far = weapon.range;
  const targets = [];
  for (const b of G.bots) {
    if (!b.alive || b === shooter) continue;
    for (const m of b.hitMeshes) targets.push(m);
  }
  const hits = _ray.intersectObjects([...targets, ...G.world.solids], false);
  if (!hits.length) return { hit: false, point: origin.clone().addScaledVector(dir, weapon.range) };
  const h = hits[0];
  const ud = h.object.userData;
  if (ud && ud.bot) {
    return { hit: true, point: h.point, target: ud.bot, part: ud.part, dist: h.distance };
  }
  return { hit: true, point: h.point, wall: true, dist: h.distance };
}

// Fire one pellet (or the single shot) for the player. Returns hit info.
export function playerShoot(G, dir) {
  const w = G.weapons[G.playerWeapon];
  const origin = G.playerBot.eye;
  // Spread: perturb the direction inside a cone of the live spread.
  const s = G.liveSpread;
  _dir.copy(dir);
  _dir.x += (G.rng() - 0.5) * 2 * s; _dir.y += (G.rng() - 0.5) * 2 * s; _dir.z += (G.rng() - 0.5) * 2 * s;
  _dir.normalize();
  const res = hitscan(G, origin, _dir, w, G.playerBot);
  spawnTracer(G.fx, G.muzzleWorld(), res.point);
  if (res.target) {
    const dmg = applyDamage(res.target, w.dmg, res.part, G.playerBot, G);
    G.hudHit(res.part === 'head', res.target.hp <= 0);
    spawnSparks(G.fx, res.point, res.part === 'head' ? 8 : 5, G.fxRng);
    G.sfx.play(res.target.hp <= 0 ? 'kill' : 'hit');
    return { ...res, dmg };
  }
  if (res.wall) spawnSparks(G.fx, res.point, 3, G.fxRng);
  return res;
}

// --- Bot shooting (probability model) ---
// hitChance from distance, target speed, bot aim skill and stance.
export function botShoot(G, bot, target) {
  const w = G.weapons[bot.weapon];
  const dist = bot.pos.distanceTo(target.pos);
  const tSpeed = target.vel ? target.vel.length() : 0;
  let p = 0.62 - dist * 0.008 - tSpeed * 0.045;
  if (target.crouch) p -= 0.12;
  if (bot.moving) p -= 0.06;
  p = Math.max(0.06, Math.min(0.8, p * bot.aimSkill));
  const from = bot.muzzle();
  const hit = G.rng() < p;
  if (hit) {
    const part = G.rng() < 0.12 ? 'head' : (G.rng() < 0.3 ? 'legs' : 'torso');
    const to = target.pos.clone(); to.y += part === 'head' ? 1.58 : part === 'legs' ? 0.5 : 1.15;
    spawnTracer(G.fx, from, to);
    const dmg = applyDamage(target, w.dmg, part, bot, G);
    if (target === G.playerBot) G.hudDamageFrom(bot.pos);
    return { hit: true, dmg, part };
  }
  // Miss: tracer lands near the target, offset grows with distance.
  const to = target.pos.clone();
  to.x += (G.rng() - 0.5) * (0.8 + dist * 0.05);
  to.y += 1.1 + (G.rng() - 0.5) * (0.8 + dist * 0.03);
  to.z += (G.rng() - 0.5) * (0.8 + dist * 0.05);
  spawnTracer(G.fx, from, to);
  return { hit: false };
}

// --- Grenades ---
export function throwGrenade(G, from, dir, owner) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat(C.rust, 0.5, 0.4));
  mesh.position.copy(from); G.scene.add(mesh);
  const vel = dir.clone().multiplyScalar(13); vel.y += 2.5;
  G.grenades.push({ mesh, vel, fuse: 1.6, owner });
  G.sfx.play('throw');
}

export function updateGrenades(G, dt) {
  for (let i = G.grenades.length - 1; i >= 0; i--) {
    const g = G.grenades[i];
    g.fuse -= dt;
    g.vel.y -= 14 * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    // Bounce off the floor and walls (cheap: clamp + reflect).
    if (g.mesh.position.y < 0.09) { g.mesh.position.y = 0.09; g.vel.y *= -0.45; g.vel.x *= 0.7; g.vel.z *= 0.7; }
    for (const c of G.world.colliders) {
      const p = g.mesh.position;
      if (p.y < c.y1 && p.x > c.x0 - 0.09 && p.x < c.x1 + 0.09 && p.z > c.z0 - 0.09 && p.z < c.z1 + 0.09) {
        // push out along the smallest penetration axis
        const dxl = p.x - c.x0, dxr = c.x1 - p.x, dzl = p.z - c.z0, dzr = c.z1 - p.z;
        const m = Math.min(dxl, dxr, dzl, dzr);
        if (m === dxl) { p.x = c.x0 - 0.09; g.vel.x = -Math.abs(g.vel.x) * 0.5; }
        else if (m === dxr) { p.x = c.x1 + 0.09; g.vel.x = Math.abs(g.vel.x) * 0.5; }
        else if (m === dzl) { p.z = c.z0 - 0.09; g.vel.z = -Math.abs(g.vel.z) * 0.5; }
        else { p.z = c.z1 + 0.09; g.vel.z = Math.abs(g.vel.z) * 0.5; }
      }
    }
    if (g.fuse <= 0) {
      explode(G, g);
      G.scene.remove(g.mesh);
      G.grenades.splice(i, 1);
    }
  }
}

function explode(G, g) {
  const at = g.mesh.position;
  G.sfx.play('explode');
  spawnSparks(G.fx, at, 40, G.fxRng);
  // Flash light, quick fade (reuses one pooled light via fx).
  const victims = [G.playerBot, ...G.bots];
  for (const t of victims) {
    if (!t.alive || t === g.owner) continue;
    const d = t.pos.distanceTo(at);
    if (d > 6) continue;
    let dmg = 120 - (120 - 15) * (d / 6);
    // Through walls: 40%.
    if (losBlocked(G.world.colliders, at.x, at.z, t.pos.x, t.pos.z)) dmg *= 0.4;
    applyDamage(t, dmg, 'torso', g.owner, G);
  }
}
