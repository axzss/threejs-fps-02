// palette.js — EMBERLINE's dusk-industrial look: six colours only, shared
// materials cached so the scene allocates nothing per frame.
import * as THREE from 'three';

// Dusk palette (hex): slate sky, steel walls, concrete floor, hazard amber,
// signal teal, rust red, warm off-white ink.
export const C = {
  sky: 0x1a2230, steel: 0x2b3648, concrete: 0x6b7686, amber: 0xf5a623,
  teal: 0x2dd4a7, rust: 0xc0392b, ink: 0xe8e4da, dark: 0x14181f,
  vanguard: 0x2dd4a7, sentinel: 0xc0392b,
};

const cache = new Map();
// Standard material, cached by colour + roughness + metalness + emissive.
export function mat(color, rough = 0.9, metal = 0.05, emissive = 0x000000, eInt = 1) {
  const key = `${color}|${rough}|${metal}|${emissive}|${eInt}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = eInt; }
    cache.set(key, m);
  }
  return m;
}
// Flat (unlit) material for markers, labels and glow strips.
export function flat(color) {
  const key = `flat|${color}`;
  let m = cache.get(key);
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); cache.set(key, m); }
  return m;
}
// A box mesh, positioned by centre, with a shared material. Casts/receives
// shadows unless told otherwise.
export function box(w, h, d, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = shadow;
  return m;
}
export function cyl(rt, rb, h, material, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
