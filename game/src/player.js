// player.js — first-person movement: acceleration, friction, gravity,
// jump, crouch, sprint, and AABB collision against the world's colliders.
// One axis at a time, feet and crown lifted out of horizontal tests, so
// walls never swallow the player and standing on a floor is not a wall.
import * as THREE from 'three';

export const EYE_STAND = 1.6, EYE_CROUCH = 1.02;
export const H_STAND = 1.72, H_CROUCH = 1.12;
const RADIUS = 0.35; // half-width of the player's box
const WALK = 5.2, SPRINT = 6.4, CROUCH_SPEED = 2.4;
const ACCEL_G = 42, ACCEL_A = 9, FRICTION = 9, GRAVITY = 20, JUMP = 6.2;

export class Player {
  constructor(x, z) {
    this.pos = new THREE.Vector3(x, 0, z); // feet position
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.hp = 100; this.armor = 0;
    this.crouch = false; this.onGround = true;
    this.alive = true;
    this.sprinting = false;
    this.stepPhase = 0; // for footstep timing
    this.lastStepAt = 0;
  }
  get height() { return this.crouch ? H_CROUCH : H_STAND; }
  get eyeY() { return this.pos.y + (this.crouch ? EYE_CROUCH : EYE_STAND); }
  get eye() { return new THREE.Vector3(this.pos.x, this.eyeY, this.pos.z); }
  get speed2d() { return Math.hypot(this.vel.x, this.vel.z); }

  // input: {f, b, l, r, jump, crouch, sprint} as 0/1; dt in seconds.
  update(dt, input, colliders) {
    if (!this.alive) return;
    const wantCrouch = !!input.crouch;
    // Standing up under a low ceiling is refused (vent lintel).
    if (!wantCrouch && this.crouch && !this.canStand(colliders)) {
      // stay crouched
    } else this.crouch = wantCrouch;

    const maxSpeed = this.crouch ? CROUCH_SPEED : (input.sprint ? SPRINT : WALK);
    this.sprinting = !!input.sprint && !this.crouch && this.speed2d > 4;
    // Wish direction in world space from yaw.
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = (-sin * (input.f - input.b)) + (-cos * (input.r - input.l));
    let wz = (-cos * (input.f - input.b)) + (sin * (input.r - input.l));
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const accel = this.onGround ? ACCEL_G : ACCEL_A;
    this.vel.x += wx * accel * dt;
    this.vel.z += wz * accel * dt;
    // Friction when grounded and no input; clamp to max speed.
    const sp = this.speed2d;
    if (this.onGround) {
      if (wl === 0) {
        const f = Math.max(0, 1 - FRICTION * dt);
        this.vel.x *= f; this.vel.z *= f;
      } else if (sp > maxSpeed) {
        this.vel.x *= maxSpeed / sp; this.vel.z *= maxSpeed / sp;
      }
    }
    // Jump.
    if (input.jump && this.onGround) { this.vel.y = JUMP; this.onGround = false; }
    this.vel.y -= GRAVITY * dt;
    if (this.vel.y < -18) this.vel.y = -18;

    // Integrate + collide, one axis at a time.
    this.moveAxis(dt, 'x', colliders);
    this.moveAxis(dt, 'z', colliders);
    this.moveAxis(dt, 'y', colliders);

    // Footstep phase for sound + bob.
    if (this.onGround && sp > 0.5) this.stepPhase += sp * dt * 1.6;
  }

  canStand(colliders) {
    // Would the standing box fit here? Test the crown band [1.12, 1.72].
    return !this.overlapsAny(this.pos.x, this.pos.z, 1.12, 1.72, colliders);
  }
  overlapsAny(x, z, y0, y1, colliders) {
    for (const c of colliders) {
      if (y1 <= c.y0 || y0 >= c.y1) continue;
      if (x + RADIUS > c.x0 && x - RADIUS < c.x1 && z + RADIUS > c.z0 && z - RADIUS < c.z1) return true;
    }
    return false;
  }

  moveAxis(dt, axis, colliders) {
    const h = this.height;
    if (axis === 'x') this.pos.x += this.vel.x * dt;
    if (axis === 'z') this.pos.z += this.vel.z * dt;
    if (axis === 'y') this.pos.y += this.vel.y * dt;
    // Floor.
    if (this.pos.y < 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }
    for (const c of colliders) {
      // Vertical overlap of the player box [pos.y, pos.y + h] with the collider.
      if (this.pos.y + h <= c.y0 || this.pos.y >= c.y1) continue;
      if (this.pos.x + RADIUS <= c.x0 || this.pos.x - RADIUS >= c.x1) continue;
      if (this.pos.z + RADIUS <= c.z0 || this.pos.z - RADIUS >= c.z1) continue;
      // Overlap: push out along this axis.
      if (axis === 'x') {
        this.pos.x = this.vel.x > 0 ? c.x0 - RADIUS : c.x1 + RADIUS;
        this.vel.x = 0;
      } else if (axis === 'z') {
        this.pos.z = this.vel.z > 0 ? c.z0 - RADIUS : c.z1 + RADIUS;
        this.vel.z = 0;
      } else {
        if (this.vel.y <= 0) { this.pos.y = c.y1; this.onGround = true; }
        else this.pos.y = c.y0 - h;
        this.vel.y = 0;
      }
    }
  }
}
