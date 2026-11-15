// weapons.js — the five weapons of EMBERLINE. One table drives the buy
// menu, the HUD, the view models and the shooting code, so the numbers the
// player sees are the numbers the sim uses.
import * as THREE from 'three';
import { C, mat, flat, box } from './palette.js';

// damage: torso damage per hit (pellets for the shotgun). rate: seconds
// between shots. spread: radians still / moving. kick: view pitch per shot.
export const WEAPONS = {
  p9: {
    name: 'P9 Sidearm', price: 0, dmg: 26, head: 4, rate: 0.14, auto: false,
    mag: 12, reserve: 48, reload: 1.4, spread: 0.011, spreadMove: 0.030,
    kick: 0.006, range: 40, pellets: 1, desc: 'Reliable sidearm. Always owned.',
  },
  hornet: {
    name: 'Hornet-9 SMG', price: 1500, dmg: 22, head: 4, rate: 0.07, auto: true,
    mag: 32, reserve: 128, reload: 1.7, spread: 0.014, spreadMove: 0.038,
    kick: 0.005, range: 38, pellets: 1, desc: 'Fast close-quarters spray.',
  },
  vk7: {
    name: 'VK-7 Rifle', price: 2700, dmg: 34, head: 4, rate: 0.096, auto: true,
    mag: 30, reserve: 96, reload: 1.9, spread: 0.008, spreadMove: 0.034,
    kick: 0.009, range: 60, pellets: 1, desc: 'The workhorse. Stops to aim, wins.',
  },
  breacher: {
    name: 'Breacher-12', price: 1100, dmg: 9, head: 4, rate: 0.85, auto: false,
    mag: 6, reserve: 24, reload: 2.4, spread: 0.030, spreadMove: 0.055,
    kick: 0.028, range: 22, pellets: 12, falloff: 14, desc: '12 pellets. Devastating up close.',
  },
  spark: {
    name: 'Spark-3 Frag', price: 300, dmg: 120, head: 1, rate: 0.9, auto: false,
    mag: 1, reserve: 0, reload: 0, spread: 0, spreadMove: 0, kick: 0,
    range: 0, pellets: 0, consumable: true, desc: 'Thrown. 1.6 s fuse, 6 m blast.',
  },
};

export const BUY_ORDER = ['p9', 'hornet', 'vk7', 'breacher', 'spark'];

// Effective spread for a shot, in radians. Standing still and crouched is
// tight; sprinting or airborne is wild; recent shots bloom it.
export function spreadFor(w, speed, airborne, crouched, bloom) {
  let s = w.spread + (w.spreadMove - w.spread) * Math.min(1, speed / 5.2);
  if (airborne) s *= 1.6;
  if (crouched) s *= 0.75;
  return s + bloom;
}

// A weapon's ammo state: { mag, reserve, reloading, reloadEnd }.
export function freshAmmo(w) {
  return { mag: w.mag, reserve: w.reserve, reloading: false, reloadEnd: 0 };
}

// Simple low-poly view model: a dark body + amber accents, parented to the
// camera. Returns { group, muzzle } — muzzle is the flash/tracer origin.
export function makeViewModel(wid) {
  const g = new THREE.Group();
  const dark = mat(C.dark, 0.6, 0.4);
  const amber = mat(C.amber, 0.5, 0.4);
  const add = (m) => { g.add(m); return m; };
  if (wid === 'vk7' || wid === 'hornet') {
    const len = wid === 'vk7' ? 0.62 : 0.5;
    add(box(0.09, 0.11, len, dark, 0, -0.02, -0.2));
    add(box(0.05, 0.05, 0.22, amber, 0, 0.035, -0.32)); // barrel
    add(box(0.07, 0.16, 0.1, dark, 0, -0.11, -0.08)); // grip
    add(box(0.03, 0.09, 0.12, dark, 0, -0.1, -0.28)); // mag
    if (wid === 'vk7') add(box(0.04, 0.05, 0.1, amber, 0, 0.05, -0.12)); // sight
  } else if (wid === 'breacher') {
    add(box(0.1, 0.1, 0.55, dark, 0, -0.02, -0.2));
    add(box(0.07, 0.07, 0.3, amber, 0, 0.02, -0.35)); // pump tube
    add(box(0.07, 0.15, 0.09, dark, 0, -0.1, -0.06));
  } else if (wid === 'spark') {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat(C.rust, 0.5, 0.4));
    ball.position.set(0, -0.05, -0.25); g.add(ball);
    add(box(0.03, 0.05, 0.03, amber, 0, 0.03, -0.25));
  } else { // p9
    add(box(0.07, 0.09, 0.3, dark, 0, -0.02, -0.18));
    add(box(0.05, 0.12, 0.08, dark, 0, -0.08, -0.05));
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, wid === 'spark' ? -0.3 : -0.52);
  g.add(muzzle);
  // Muzzle flash: a small emissive plane + point light, shown 60 ms per shot.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0, depthWrite: false }),
  );
  flash.position.copy(muzzle.position); g.add(flash);
  const light = new THREE.PointLight(C.amber, 0, 6, 2);
  light.position.copy(muzzle.position); g.add(light);
  g.scale.setScalar(0.7);
  g.position.set(0.26, -0.26, -0.5);
  return { group: g, muzzle, flash, light };
}
