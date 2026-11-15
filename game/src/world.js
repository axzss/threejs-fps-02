// world.js — "Relay Yard 7": a decommissioned solar relay yard at dusk.
// One job: build the map (geometry + colliders + sites + lights + props)
// and the waypoint graph bots walk. All colliders are axis-aligned boxes
// with a vertical span, so crouch-only gaps (the vent) work for free.
// The waypoint graph was hand-checked link by link against the walls:
// every link is a straight walk with 0.35 m (player radius) of clearance.
import * as THREE from 'three';
import { C, mat, flat, box, cyl } from './palette.js';

// A collider: {x0,z0,x1,z1,y0,y1} — blocks anything whose vertical span
// [feet, feet+height] overlaps [y0,y1] and whose XZ box overlaps.
function col(x0, z0, x1, z1, y0 = 0, y1 = 3.2) {
  return { x0, z0, x1, z1, y0, y1 };
}

// Wall data: [centreX, centreZ, widthX, depthZ, height, yBase, material]
// yBase>0 makes a lintel (open below it — the vent).
const WALLS = [
  // Perimeter (36 x 28 m yard, 1 m thick, 3.2 m high).
  [0, -14.5, 38, 1, 3.2, 0, 'steel'], [0, 14.5, 38, 1, 3.2, 0, 'steel'],
  [-18.5, 0, 1, 30, 3.2, 0, 'steel'], [18.5, 0, 1, 30, 3.2, 0, 'steel'],
  // Attacker spawn pen (SW): north wall full-width, so the only exit is
  // east through the gap past x=-9. The west stub wall shapes the pen.
  [-13, 8, 8, 1, 3.2, 0, 'steel'], [-16.5, 11, 1, 5, 3.2, 0, 'steel'],
  // Mid doors: wall across the middle with a 4 m doorway at x -2..2.
  [-6, 2, 8, 1, 3.2, 0, 'steel'], [6, 2, 8, 1, 3.2, 0, 'steel'],
  // Site B hall (east, enclosed): south wall in two segments with a 2 m
  // main door gap at x 11..13; west wall with a crouch-only vent
  // (lintel at 1.25 m, see below); north wall; east wall = perimeter.
  [9.5, -2.5, 3, 1, 3.2, 0, 'steel'],  // hall south wall, west segment
  [15, -2.5, 4, 1, 3.2, 0, 'steel'],   // hall south wall, east segment
  [8, -10.5, 1, 2, 3.2, 0, 'steel'],   // hall west wall, north segment
  [8, -8.5, 1, 2, 1.95, 1.25, 'steel'],// hall west wall, vent lintel (open below 1.25 m)
  [8, -5, 1, 5, 3.2, 0, 'steel'],      // hall west wall, south segment
  [12.5, -11.5, 9, 1, 3.2, 0, 'steel'], // hall north wall
  // Site A yard: low walls (2.6 m) shaping the pocket around site A.
  [-12, -10.5, 9, 1, 2.6, 0, 'steel'],
  [-16, -6, 1, 8, 2.6, 0, 'steel'],
  // Central pillar block + lane dividers.
  [-4, -6, 1.5, 6, 3.2, 0, 'steel'], [4, -6, 1.5, 6, 3.2, 0, 'steel'],
  [-4, 8, 1.5, 4, 3.2, 0, 'steel'], [4, 8, 1.5, 4, 3.2, 0, 'steel'],
];

// Crates / barrels / pillars: [x, z, w, d, h, kind]
// kind: crate (1.1 m cube stack), barrel (cylinder 0.9 m), pillar (1x1).
// Positions are kept off the waypoint lanes (see WP below).
const PROPS = [
  [-14, -3, 1.2, 1.2, 1.1, 'crate'], [-11.5, -9, 1.2, 1.2, 1.1, 'crate'],
  [-15, -8.5, 1.2, 1.2, 1.1, 'crate'], [-9, -4.5, 1.2, 1.2, 1.1, 'crate'],
  [10, -5, 1.2, 1.2, 1.1, 'crate'], [16.5, -9, 1.2, 1.2, 1.1, 'crate'],
  [11, -9.5, 1.2, 1.2, 2.2, 'crate'], [15, -4.5, 1.2, 1.2, 1.1, 'crate'],
  [-2, -2, 1.2, 1.2, 1.1, 'crate'], [2, 3.5, 1.2, 1.2, 1.1, 'crate'],
  [-16.5, 4, 1.2, 1.2, 1.1, 'crate'], [16.5, 7, 1.2, 1.2, 1.1, 'crate'],
  [2, -10, 1, 1, 3.2, 'pillar'], [0, 9, 1, 1, 3.2, 'pillar'],
  [-8, 6.5, 0.9, 0.9, 0.9, 'barrel'], [10, -2.5, 0.9, 0.9, 0.9, 'barrel'],
  [-6, -13.2, 0.9, 0.9, 0.9, 'barrel'], [6, 12.5, 0.9, 0.9, 0.9, 'barrel'],
];

// Waypoints: id -> [x, z]. Links hand-placed (walkable, sighted).
// Rows: south z=11 (0-6), mid-south z=5 (7-11), mid z=-1 (12-16),
// north z=-6 (17-23), far-north z=-12/-13 (24-30), spurs 31-34.
// The pen's only exit is east (wp 0-1-2), the mid wall is crossed at the
// centre gap (9-14) or around its ends (7-12, 11-16), and the B hall is
// entered only through its south door (15-33-34-22).
const WP = [
  [-15, 11], [-11, 11], [-6, 11], [0, 11], [6, 11], [11, 11], [15, 11], // 0-6 south row
  [-15, 5], [-10, 5], [0, 5], [8, 5], [15, 5],                         // 7-11 mid-south
  [-15, -1], [-8, -1], [0, -1], [9, -1], [15, -1],                     // 12-16 mid
  [-15, -6], [-12, -6], [-8, -6], [0, -6], [6, -6], [12.5, -7], [15, -6], // 17-23 north row
  [-15, -12], [-11, -12], [-6, -12], [0, -12], [6, -12], [11, -13.5], [15, -13.5], // 24-30 far-north
  [-13, -8.5], [10, -9], [11, -1], [12.5, -4.5],                      // 31 A platform, 32 B room, 33 door approach, 34 hall south
];
const LINKS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6],
  [2, 9], [3, 10], [4, 10], [5, 11], [6, 11],
  [7, 8], [8, 9], [9, 10], [10, 11],
  [7, 12], [9, 14], [11, 16],
  [12, 13], [13, 14], [14, 15], [15, 16],
  [12, 17], [13, 18], [14, 20], [15, 33], [15, 21],
  [17, 18], [18, 19], [18, 31], [31, 19],
  [22, 23], [22, 32], [32, 34], [34, 22], [33, 34], [33, 16],
  [19, 26], [20, 27], [21, 28],
  [24, 25], [25, 26], [26, 27], [27, 28], [28, 29], [29, 30],
];

export function buildWorld(scene) {
  scene.background = new THREE.Color(C.sky);
  scene.fog = new THREE.Fog(C.sky, 18, 55);

  // Lights: warm low sun + cool sky fill + site glows.
  const sun = new THREE.DirectionalLight(0xffc06a, 2.2);
  sun.position.set(-14, 18, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24; sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 60;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8fb4d9, 0x2a2620, 0.7));
  const lightA = new THREE.PointLight(C.amber, 14, 14, 1.6);
  lightA.position.set(-12, 3.4, -6); scene.add(lightA);
  const lightB = new THREE.PointLight(C.teal, 14, 14, 1.6);
  lightB.position.set(12.5, 3.4, -7); scene.add(lightB);

  const colliders = [];
  const solids = []; // meshes the bullet raycaster tests
  const steel = mat(C.steel, 0.85, 0.15), conc = mat(C.concrete, 0.95, 0);

  // Floor + yard skirt.
  const floor = box(38, 0.2, 30, conc, 0, -0.1, 0);
  floor.receiveShadow = true; scene.add(floor); solids.push(floor);

  // Walls.
  for (const [x, z, w, d, h, y0, kind] of WALLS) {
    const m = box(w, h, d, steel, x, y0 + h / 2, z);
    scene.add(m); solids.push(m);
    colliders.push(col(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y0, y0 + h));
  }

  // A platform: a raised 2.4 m deck over site A, on four thin legs.
  // Walkable underneath (deck bottom at 2.0 m, player is 1.72 m) — it is
  // overhead cover for the site, not a climbable perch.
  const deck = box(5, 0.4, 4, steel, -13, 2.2, -8.5);
  scene.add(deck); solids.push(deck);
  for (const [lx, lz] of [[-15.3, -10.3], [-10.7, -10.3], [-15.3, -6.7], [-10.7, -6.7]]) {
    const leg = box(0.25, 2.0, 0.25, steel, lx, 1.0, lz);
    scene.add(leg); solids.push(leg);
    colliders.push(col(lx - 0.125, lz - 0.125, lx + 0.125, lz + 0.125, 0, 2.0));
  }

  // Props: crates, barrels, pillars.
  for (const [x, z, w, d, h, kind] of PROPS) {
    let m;
    if (kind === 'barrel') {
      m = cyl(w / 2, w / 2, h, mat(C.rust, 0.7, 0.3), x, h / 2, z);
    } else if (kind === 'pillar') {
      m = box(w, h, d, mat(C.dark, 0.9, 0.1), x, h / 2, z);
    } else {
      m = box(w, h, d, mat(C.amber, 0.8, 0.2), x, h / 2, z);
      // Hazard stripe on crate tops.
      const stripe = box(w + 0.02, 0.06, d * 0.25, flat(C.amber), x, h + 0.01, z, false);
      scene.add(stripe);
    }
    scene.add(m); solids.push(m);
    colliders.push(col(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 0, h));
  }

  // Relay dishes (props, no collision — on the yard edges).
  for (const [x, z, ry] of [[-17, -12, 0.6], [17, 12, -0.9], [-17, 12, 2.4]]) {
    const post = cyl(0.12, 0.16, 2.2, mat(C.dark), x, 1.1, z);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8, 0, Math.PI * 2, 0, 1.1), mat(C.concrete, 0.6, 0.4));
    dish.scale.set(1, 0.45, 1); dish.position.set(x, 2.5, z); dish.rotation.y = ry;
    dish.castShadow = true; scene.add(post, dish);
  }
  // Cable drums.
  for (const [x, z] of [[-6, 12.5], [9, 12.5]]) {
    const drum = cyl(0.8, 0.8, 0.9, mat(C.steel, 0.7, 0.3), x, 0.45, z);
    drum.rotation.z = Math.PI / 2; scene.add(drum);
  }

  // Site markers: emissive floor rings + floating holo labels.
  const sites = {
    A: { x: -12, z: -6, r: 3.5, color: C.amber, name: 'RELAY A' },
    B: { x: 12.5, z: -7, r: 3.5, color: C.teal, name: 'RELAY B' },
  };
  for (const s of Object.values(sites)) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.18, s.r, 40), flat(s.color));
    ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, 0.02, s.z);
    scene.add(ring);
    const label = makeLabel(s.name, s.color);
    label.position.set(s.x, 3.6, s.z); scene.add(label);
    const strip = box(2.4, 0.08, 0.3, flat(s.color), s.x, 0.06, s.z + s.r - 0.4, false);
    scene.add(strip);
  }

  // Waypoint graph.
  const waypoints = WP.map(([x, z], i) => ({ id: i, x, z, links: [] }));
  for (const [a, b] of LINKS) { waypoints[a].links.push(b); waypoints[b].links.push(a); }

  return {
    colliders, solids,
    sites,
    spawns: {
      vanguard: [[-15.5, 12], [-14, 12.5], [-12, 12], [-10, 12.5], [-15, 10]],
      sentinel: [[9.5, -10.5], [13, -10], [16, -10.5], [9.5, -3.5], [16.5, -4]],
    },
    waypoints,
  };
}

// Floating text label drawn on a canvas, as a sprite.
function makeLabel(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#10141acc'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sp.scale.set(4.4, 1.1, 1);
  return sp;
}

// Breadth-first search on the waypoint graph. Returns a list of node ids
// from `from` to `to` (inclusive), or [] when unreachable.
export function findPath(waypoints, from, to) {
  if (from === to) return [to];
  const prev = new Int16Array(waypoints.length).fill(-1);
  const q = [from]; prev[from] = from;
  while (q.length) {
    const cur = q.shift();
    for (const nb of waypoints[cur].links) {
      if (prev[nb] !== -1) continue;
      prev[nb] = cur;
      if (nb === to) {
        const path = [to]; let n = to;
        while (n !== from) { n = prev[n]; path.unshift(n); }
        return path;
      }
      q.push(nb);
    }
  }
  return [];
}

// Nearest waypoint id to a point.
export function nearestWp(waypoints, x, z) {
  let best = 0, bd = Infinity;
  for (const w of waypoints) {
    const d = (w.x - x) ** 2 + (w.z - z) ** 2;
    if (d < bd) { bd = d; best = w.id; }
  }
  return best;
}

// Nearest waypoint reachable in a straight line (no wall between).
// Bots start a route from here: the plain nearest waypoint can sit on
// the other side of a wall (e.g. a hall spawn vs the door approach),
// and a bot walking straight at it would push against the wall forever.
export function nearestReachableWp(waypoints, colliders, x, z) {
  const sorted = [...waypoints].sort((a, b) =>
    ((a.x - x) ** 2 + (a.z - z) ** 2) - ((b.x - x) ** 2 + (b.z - z) ** 2));
  for (const w of sorted) {
    if (!losBlocked(colliders, x, z, w.x, w.z)) return w.id;
  }
  return sorted[0].id;
}

// Segment (x0,z0)-(x1,z1) vs AABB collider: does the 2D segment cross it?
// Used for bot line-of-sight (y ignored: walls are tall, the vent is low
// and only matters for movement, not sight).
export function losBlocked(colliders, x0, z0, x1, z1) {
  for (const c of colliders) {
    if (c.y1 < 1.4) continue; // low cover never blocks sight
    if (segHitsBox(x0, z0, x1, z1, c)) return true;
  }
  return false;
}
function segHitsBox(x0, z0, x1, z1, b) {
  // Slab test in 2D.
  const dx = x1 - x0, dz = z1 - z0;
  let t0 = 0, t1 = 1;
  for (const [o, d, lo, hi] of [[x0, dx, b.x0, b.x1], [z0, dz, b.z0, b.z1]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
    let a = (lo - o) / d, c = (hi - o) / d;
    if (a > c) { const t = a; a = c; c = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
}
