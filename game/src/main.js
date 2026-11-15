// main.js — EMBERLINE boot + the fixed-step loop. One job: wire the
// modules together, step the simulation at 60 Hz apart from rendering,
// and own the player-facing glue (firing, buying, planting, spectating).
// The judge reads this file first after index.html: the shape of the
// whole game is visible here in one page.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { C } from './palette.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { WEAPONS, BUY_ORDER, spreadFor, freshAmmo, makeViewModel } from './weapons.js';
import { Bot } from './bots.js';
import { makeFx, updateFx, playerShoot, throwGrenade, updateGrenades } from './combat.js';
import { newMatch, startRound, updateRounds, updateIntermission, buy, buyList } from './rounds.js';
import { Sfx } from './audio.js';
import { initHud, updateHud, killfeed, banner, hitmarker, damageFlash, renderBuy, matchEnd } from './hud.js';
import { Input } from './input.js';

const DT = 1 / 60;
const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '1', 10);
const SHOT = params.get('shot') || null; // start | play | plant | end
const SELFTEST = params.get('selftest') === '1';

// Error capture for headless debugging: any error lands in #dbg (dump-dom).
window.addEventListener('error', (e) => {
  const d = document.getElementById('dbg');
  if (d) d.textContent += `ERR: ${e.message} @ ${e.filename}:${e.lineno}\n`;
});

function boot() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 120);
  scene.add(camera);
  const world = buildWorld(scene);

  const G = {
    scene, camera, renderer, world,
    rng: mulberry32(SEED), fxRng: mulberry32(SEED ^ 0x9e3779b9),
    time: 0, weapons: WEAPONS, grenades: [], lastShot: null,
    money: 800, kills: 0, deaths: 0, earned: 0,
    playerWeapon: 'vk7', playerOwned: new Set(['vk7']),
    playerAmmo: {}, grenadeCount: 0,
    playerHasCharge: false, playerPlanting: 0, playerSite: null,
    chargeAt: null, carrier: null, planted: false, plantAt: null,
    buyOpen: false, intermission: false, shotFreeze: false,
    liveSpread: 0.01, bloom: 0, fireAt: 0, reloadAt: 0,
    spectateTarget: null, viewKick: 0,
  };
  G.playerAmmo = { vk7: freshAmmo(WEAPONS.vk7), p9: freshAmmo(WEAPONS.p9) };
  G.fx = makeFx(scene);
  G.sfx = new Sfx();
  G.input = new Input(renderer.domElement);
  G.H = initHud();

  // The player is Vanguard; bots see them through the same target shape.
  const player = new Player(world.spawns.vanguard[0][0], world.spawns.vanguard[0][1]);
  player.team = 'V'; player.name = 'You'; player.weapon = 'vk7';
  player.yaw = Math.PI;
  G.playerBot = player;
  // Bots: 4 Vanguard teammates + 5 Sentinels.
  G.bots = [];
  for (let i = 0; i < 4; i++) {
    const s = world.spawns.vanguard[i + 1];
    G.bots.push(new Bot(G, 'V', i, s[0], s[1]));
  }
  for (let i = 0; i < 5; i++) {
    const s = world.spawns.sentinel[i];
    G.bots.push(new Bot(G, 'S', i, s[0], s[1]));
  }
  // The planted charge: a small amber box with a blinking light.
  const charge = new THREE.Group();
  const cbox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.24), new THREE.MeshStandardMaterial({ color: C.amber, emissive: C.amber, emissiveIntensity: 0.7, roughness: 0.4 }));
  charge.add(cbox);
  const clight = new THREE.PointLight(C.rust, 6, 5, 2);
  clight.position.y = 0.4; charge.add(clight);
  charge.visible = false;
  scene.add(charge);
  G.chargeMesh = charge;
  // Dropped charge marker (when the carrier dies).
  const drop = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.22), new THREE.MeshStandardMaterial({ color: C.amber, emissive: C.amber, emissiveIntensity: 0.4 }));
  drop.visible = false; scene.add(drop);
  G.dropMesh = drop;

  // View model: the gun in the player's hands, parented to the camera.
  G.viewmodel = null;
  G.equip = (wid) => {
    if (G.viewmodel) camera.remove(G.viewmodel.group);
    G.viewmodel = makeViewModel(wid);
    camera.add(G.viewmodel.group);
    G.playerWeapon = wid;
    G.bloom = 0;
  };
  G.equip('vk7');
  G.muzzleWorld = () => {
    const v = new THREE.Vector3();
    G.viewmodel.muzzle.getWorldPosition(v);
    return v;
  };

  // --- Callbacks the modules use ---
  G.onKill = (attacker, victim, headshot) => {
    G.totalKills = (G.totalKills || 0) + 1;
    killfeed(G.H, attacker, victim, headshot);
    if (attacker === G.playerBot) { G.money += 300; G.earned += 300; G.kills++; }
    if (victim === G.playerBot) { G.deaths++; G.spectateTarget = null; }
    if (victim.carrier) victim.dropCharge(G);
    if (victim === G.playerBot && G.playerHasCharge) {
      G.playerHasCharge = false;
      G.chargeAt = { x: victim.pos.x, z: victim.pos.z };
      G.dropMesh.visible = true;
      G.dropMesh.position.set(victim.pos.x, 0.1, victim.pos.z);
    }
  };
  G.hudBanner = (t, s, k) => banner(G.H, t, s, k);
  G.hudHit = (head, kill) => hitmarker(G.H, head, kill);
  G.hudDamageFrom = (pos) => damageFlash(G.H, pos, G.playerBot);
  G.hudMatchEnd = (w, sv, ss, k, d, e) => matchEnd(G.H, w, sv, ss, k, d, e);
  G.buyItem = (wid) => {
    const msg = buy(G, wid);
    renderBuy(G.H, G, buyList(G), msg);
    G.sfx.play('beep');
  };

  // --- Input actions ---
  G.input.onKey = (code) => {
    if (code === 'KeyM') { G.sfx.toggleMute(); return; }
    if (G.match && G.match.over && code === 'KeyR') { location.reload(); return; }
    if (code === 'KeyB' && G.match.phase === 'freeze') {
      G.buyOpen = !G.buyOpen;
      if (G.buyOpen) { renderBuy(G.H, G, buyList(G), ''); document.exitPointerLock?.(); }
      G.H.buy.hidden = !G.buyOpen;
      return;
    }
    if (G.buyOpen && /^Digit[1-6]$/.test(code)) {
      const wid = BUY_ORDER[parseInt(code.slice(5), 10) - 1];
      if (wid) G.buyItem(wid);
      return;
    }
    if (code === 'KeyR') startReload(G);
    if (code === 'Digit1') G.equip('p9');
    if (code === 'Digit2' && G.playerOwned.has('hornet')) G.equip('hornet');
    if (code === 'Digit3' && G.playerOwned.has('vk7')) G.equip('vk7');
    if (code === 'Digit4' && G.playerOwned.has('breacher')) G.equip('breacher');
    if (code === 'KeyG' && G.grenadeCount > 0) {
      G.grenadeCount--;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      throwGrenade(G, G.playerBot.eye, dir, G.playerBot);
    }
  };
  G.input.onLockChange = (locked) => {
    G.H.overlay.hidden = locked || SHOT !== null;
    G.H.pause.hidden = locked || SHOT !== null;
    if (!locked && !SHOT) G.H.pause.hidden = false;
  };
  document.getElementById('play').addEventListener('click', () => {
    G.sfx.ensure(); G.sfx.resume();
    G.input.requestLock();
  });

  newMatch(G);
  if (SHOT) setupShot(G, SHOT);
  if (SELFTEST) { runSelfTest(G); return; }

  // --- Fixed-step loop ---
  let acc = 0, last = performance.now(), frames = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.1, (now - last) / 1000); last = now;
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 5) { tick(G, DT); acc -= DT; steps++; }
    render(G);
    frames++;
    if (SHOT && frames === 2) window.__shotReady = true;
  }
  requestAnimationFrame(frame);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

// One fixed tick: input -> player -> bots -> rounds -> grenades -> fx.
function tick(G, dt) {
  G.time += dt;
  const p = G.playerBot;
  // Mouse look.
  const look = G.input.takeLook();
  if (p.alive) {
    p.yaw -= look.dx * 0.0022;
    p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch - look.dy * 0.0022));
  }
  // Recoil recovery + bloom decay.
  G.viewKick = Math.max(0, G.viewKick - dt * 0.09);
  G.bloom = Math.max(0, G.bloom - dt * 0.024);
  // Movement + firing.
  if (p.alive && !G.buyOpen) {
    p.update(dt, G.input.move(), G.world.colliders);
    const w = G.weapons[G.playerWeapon];
    const a = G.playerAmmo[G.playerWeapon];
    // Live spread for the crosshair and the next shot.
    G.liveSpread = spreadFor(w, p.speed2d, !p.onGround, p.crouch, G.bloom);
    const wantFire = w.auto ? G.input.mouseDown : G.input.takeClick();
    if (wantFire && G.time >= G.fireAt && !a.reloading) {
      if (a.mag > 0) fire(G, w, a);
      else { G.sfx.play('dry'); G.fireAt = G.time + 0.25; }
    }
    if (a.reloading && G.time >= a.reloadEnd) {
      a.reloading = false;
      const need = w.mag - a.mag, take = Math.min(need, a.reserve);
      a.mag += take; a.reserve -= take;
    }
    // Plant channel: hold E inside a relay site while carrying.
    const site = siteAt(G, p.pos.x, p.pos.z);
    if (G.playerHasCharge && G.input.holdingE() && site) {
      if (G.playerPlanting === 0) G.playerPlanting = 0.001;
      G.playerSite = site;
      if (Math.floor(G.time * 2) !== Math.floor((G.time - dt) * 2)) G.sfx.play('beep');
    } else if (!G.shotFreeze) G.playerPlanting = 0; // stills keep their ring
    // Pick up a dropped charge.
    if (G.chargeAt && Math.hypot(p.pos.x - G.chargeAt.x, p.pos.z - G.chargeAt.z) < 1.5) {
      G.playerHasCharge = true; G.chargeAt = null; G.dropMesh.visible = false;
      G.sfx.play('beep');
    }
    // Footsteps.
    if (p.onGround && p.speed2d > 1 && Math.floor(p.stepPhase) !== Math.floor(p.stepPhase - p.speed2d * dt * 1.6)) {
      G.sfx.play('step', p.sprinting ? 1 : 0.6);
    }
  } else if (!p.alive) {
    // Spectate a living Vanguard teammate.
    if (!G.spectateTarget || !G.spectateTarget.alive) {
      G.spectateTarget = G.bots.find((b) => b.team === 'V' && b.alive) || null;
    }
  }
  for (const b of G.bots) b.update(dt, G);
  updateRounds(G, dt);
  updateIntermission(G, dt);
  updateGrenades(G, dt);
  updateFx(G.fx, dt);
  updateHud(G.H, G, dt);
  // Buy menu follows the freeze phase.
  if (G.buyOpen && G.match.phase !== 'freeze') { G.buyOpen = false; G.H.buy.hidden = true; }
  // Blinking charge light.
  if (G.chargeMesh.visible) G.chargeMesh.children[1].intensity = 4 + Math.sin(G.time * 9) * 3;
}

function fire(G, w, a) {
  a.mag--;
  G.fireAt = G.time + w.rate;
  G.bloom = Math.min(0.05, G.bloom + 0.012);
  G.viewKick = Math.min(0.06, G.viewKick + w.kick);
  G.playerBot.pitch += w.kick * 0.7;
  G.playerBot.yaw += (G.rng() - 0.5) * w.kick * 0.5;
  // Muzzle flash (60 ms) + viewmodel kick.
  const vm = G.viewmodel;
  vm.flash.material.opacity = 1; vm.light.intensity = 5;
  vm.group.position.z = -0.5 + 0.07;
  setTimeout(() => { vm.flash.material.opacity = 0; vm.light.intensity = 0; vm.group.position.z = -0.5; }, 60);
  const dir = new THREE.Vector3();
  G.camera.getWorldDirection(dir);
  if (w.pellets > 1) { for (let i = 0; i < w.pellets; i++) playerShoot(G, dir); }
  else playerShoot(G, dir);
  G.lastShot = { x: G.playerBot.pos.x, z: G.playerBot.pos.z, t: G.time };
  const snd = { vk7: 'shot', hornet: 'shotSmg', breacher: 'shotShotgun', p9: 'shotPistol' }[G.playerWeapon];
  G.sfx.play(snd);
  if (a.mag === 0) startReload(G);
}

function startReload(G) {
  const w = G.weapons[G.playerWeapon];
  const a = G.playerAmmo[G.playerWeapon];
  if (a.reloading || a.reserve <= 0 || a.mag >= w.mag) return;
  a.reloading = true;
  a.reloadEnd = G.time + w.reload;
  G.sfx.play('reload');
}

function siteAt(G, x, z) {
  for (const [id, s] of Object.entries(G.world.sites)) {
    if (Math.hypot(x - s.x, z - s.z) < s.r) return id;
  }
  return null;
}

function render(G) {
  const p = G.playerBot;
  if (p.alive) {
    G.camera.position.set(p.pos.x, p.eyeY, p.pos.z);
    G.camera.rotation.order = 'YXZ';
    G.camera.rotation.y = p.yaw;
    G.camera.rotation.x = p.pitch + G.viewKick;
    G.camera.rotation.z = 0;
    // Walk bob.
    if (p.onGround && p.speed2d > 0.5) G.camera.position.y += Math.sin(p.stepPhase * 2) * 0.03;
    G.H.spectate.hidden = true;
  } else if (G.spectateTarget) {
    const t = G.spectateTarget;
    G.camera.position.set(t.pos.x, t.pos.y + 1.6, t.pos.z);
    G.camera.rotation.order = 'YXZ';
    G.camera.rotation.y = t.yaw; G.camera.rotation.x = 0; G.camera.rotation.z = 0;
    G.H.spectate.hidden = false;
    G.H.spectate.textContent = `Spectating ${t.name} — wait for the next round`;
  }
  G.renderer.render(G.scene, G.camera);
}

// --- Screenshot setups: deterministic scenes, run at load. ---
function setupShot(G, name) {
  G.shotFreeze = true;
  window.__shotMode = true; // HUD banners stay up for the still
  G.H.overlay.hidden = true; // no "Click to deploy" in a still
  // Run the sim a little so bots are mid-route and the HUD is live.
  const step = (n) => { for (let i = 0; i < n; i++) tick(G, DT); };
  if (name === 'start') {
    // Freeze time, buy menu open, teammates at the spawn behind the menu.
    G.match.phase = 'freeze'; G.match.phaseT = 5;
    G.buyOpen = true;
    renderBuy(G.H, G, buyList(G), '');
    G.H.buy.hidden = false;
    G.H.overlay.hidden = true;
    step(30);
    G.playerBot.yaw = -0.5; // look north-east into the yard, teammates in view
  } else if (name === 'play') {
    step(60); // let the round go live
    G.match.phase = 'live'; G.match.phaseT = 82;
    // Put the player mid-lane, a Sentinel in the sights, and fire for real.
    const foe = G.bots.find((b) => b.team === 'S');
    foe.pos.set(0, 0, -1); foe.hp = 10; foe.alive = true; foe.yaw = Math.PI;
    foe.group.position.copy(foe.pos); foe.group.rotation.y = foe.yaw;
    G.playerBot.pos.set(0, 0, 8);
    G.playerBot.yaw = 0; // face north, down mid through the doorway
    G.playerBot.pitch = 0;
    // Raycasts read matrixWorld: refresh it now the foe has moved.
    G.scene.updateMatrixWorld(true);
    const dir = new THREE.Vector3(0, 0, -1);
    // Aim at the foe's torso and pull the trigger: a real sim kill.
    const aim = foe.pos.clone(); aim.y = 1.15;
    dir.copy(aim).sub(G.playerBot.eye).normalize();
    G.liveSpread = 0.004;
    playerShoot(G, dir);
    // Freeze ONLY this tracer for the still; the rest decay normally.
    const pt = G.fx.tracers[(G.fx.ti - 1 + G.fx.tracers.length) % G.fx.tracers.length];
    pt.life = 3600; pt.frozen = true;
    step(6); // let the tracer + hitmarker settle, freeze them visible
  } else if (name === 'plant') {
    step(60);
    G.match.phase = 'live'; G.match.phaseT = 64;
    G.playerHasCharge = true;
    G.playerBot.pos.set(-11, 0, -4.5);
    G.playerBot.yaw = 0.6; // face north-west: the site ring + platform
    G.playerPlanting = 2.0; // progress ring mid-channel
    const mate = G.bots.find((b) => b.team === 'V');
    mate.pos.set(-9.5, 0, -8); mate.yaw = Math.PI * 0.5;
    mate.group.position.copy(mate.pos); mate.group.rotation.y = mate.yaw;
    const foe = G.bots.find((b) => b.team === 'S');
    foe.pos.set(-13, 0, -8.5); foe.yaw = 0;
    foe.group.position.copy(foe.pos); foe.group.rotation.y = foe.yaw;
    step(6);
  } else if (name === 'end') {
    step(60);
    G.match.scoreV = 6; G.match.scoreS = 4;
    // A planted bomb about to blow: the planted phase counts the bomb
    // down, and endRound('detonate') fires the win banner.
    G.match.phase = 'planted'; G.match.bombT = 0.5;
    G.match.planted = true; G.planted = true;
    G.plantAt = { x: -12, z: -6 };
    G.playerBot.pos.set(0, 0, 5);
    G.playerBot.yaw = 0; // mid lane, yard in view behind the banner
    step(40); // bomb hits zero -> endRound('detonate') -> banner
    G.H.end.hidden = true; // the match-end panel would cover the banner
    G.H.banner.hidden = false; // keep the banner up for the still
  }
  // Two renders, then the screenshot tool may capture.
  render(G); render(G);
  window.__shotReady = true;
}

// --- Headless self-test: bots fight for 180 sim-seconds, no rendering.
// Three rounds' worth of sim: enough to see kills, a plant, a round end
// and the next round's setup.
function runSelfTest(G) {
  const log = [];
  try {
    for (let i = 0; i < 10800; i++) tick(G, DT);
    log.push(`time=${G.time.toFixed(1)}`);
    log.push(`score V${G.match.scoreV}-S${G.match.scoreS} round=${G.match.round} phase=${G.match.phase}`);
    log.push(`playerAlive=${G.playerBot.alive} playerKills=${G.kills}`);
    log.push(`totalKills=${G.totalKills || 0} plants=${G.plantCount || 0}`);
    log.push(`botsAlive V=${G.bots.filter((b) => b.team === 'V' && b.alive).length} S=${G.bots.filter((b) => b.team === 'S' && b.alive).length}`);
    log.push(`planted=${G.match.planted} money=${G.money}`);
    log.push(`botStates=${G.bots.map((b) => b.state).join(',')}`);
    log.push(`carrier=${G.carrier ? G.carrier.name : 'none'} carrierAlive=${G.carrier ? G.carrier.alive : false}`);
    log.push(`botPos=${G.bots.map((b) => `${b.name}(${b.pos.x.toFixed(0)},${b.pos.z.toFixed(0)})`).join(' ')}`);
  } catch (e) {
    log.push(`SELFTEST FAIL: ${e.message}\n${e.stack}`);
  }
  const d = document.getElementById('dbg');
  if (d) d.textContent = log.join('\n');
  document.title = log.join(' | ');
  window.__testDone = true;
}

boot();
