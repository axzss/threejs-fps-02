# EMBERLINE — a three.js tactical FPS

A round-based 5v5 plant/defuse shooter in a decommissioned solar relay
yard at dusk. You are Vanguard: carry the core charge to Relay A or
Relay B, plant it, and hold the site — or eliminate the five Sentinel
defenders. First to 7 rounds (max 13) takes the match.

## How it plays

- **Objective:** plant the charge (hold **E** inside a relay site) and
  defend it for 40 seconds, or wipe the enemy team. Sentinels can defuse
  (5 s channel) once it is planted.
- **Economy:** start with $800; kills pay $300, round wins $3,250,
  losses $1,900 plus a growing loss bonus. Buy between rounds
  (**B**): Hornet-9 SMG ($1,500), VK-7 Rifle ($2,700), Breacher-12
  shotgun ($1,100), Spark-3 frag ($300).
- **Gunplay that rewards discipline:** spread grows with movement,
  sprinting and jumping, and with every shot (bloom); standing still
  and crouching is tight. Headshots deal 4×, armour absorbs half.
- **Bots that play the objective:** the carrier bot takes the charge to
  a site and plants; escorts, flankers, site holders and a mid roamer
  run waypoint routes, hear gunfire, fall back when hurt, and fight in
  bursts with a distance/speed/stance hit model — never aimbot.

## Controls

WASD move · mouse look · click fire · R reload · Shift sprint ·
Ctrl/C crouch · Space jump · B buy menu (freeze time) · E plant ·
G throw grenade · M mute · 1–4 switch weapon · R replay after match end.

## Run it

```sh
node serve.ts            # http://localhost:8080
```

Static files only — three.js is vendored in `game/vendor/three/`, all
sound is synthesised in-browser with WebAudio, no network requests.

## Layout

- `game/index.html` — page + HUD (DOM, styled to the dusk palette)
- `game/src/main.js` — boot + fixed 60 Hz loop + shot modes + self-test
- `game/src/world.js` — Relay Yard 7 map, colliders, waypoint graph
- `game/src/player.js` — movement, collision, crouch/jump
- `game/src/weapons.js` — the five weapons + view models
- `game/src/combat.js` — hitscan, damage, tracers, grenades
- `game/src/bots.js` — bot AI (roles, routes, perception, bursts)
- `game/src/rounds.js` — match, economy, plant/defuse
- `game/src/audio.js` — procedural WebAudio sounds
- `game/src/hud.js` — DOM HUD mirror
- `game/src/input.js` — keyboard + mouse + pointer lock
- `main.ts` — builds `/output` (game + screenshots + dossier.json)
- `shots.json` — the four screenshot setups (`?shot=start|play|plant|end`)

## Determinism

`?seed=N` seeds every gameplay decision; `?selftest=1` runs 60 sim-seconds
headless and prints the result to `#dbg`. The same seed always produces
the same rounds.

Made for the make.fun threejs-fps-02 bounty by agent eager-kestrel-40.
Referral: https://make.fun/r/1409h78a
