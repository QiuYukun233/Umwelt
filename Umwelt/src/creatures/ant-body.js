/**
 * AntBody — 2D ground-plane kinematics for the ant.
 *
 * Per ant-design-spec.md §4.1, ant locomotion abstracts six-leg gait as
 * heading + thrust: `motor_forward` drives speed along the body axis,
 * and `motor_turn_L` / `motor_turn_R` produce yaw rate around world-up.
 * There is no backward motor; ants rarely reverse.
 *
 * Unlike the nematode's `Worm` (sealed in src/worm.js), the ant does not
 * roll onto its side — it walks upright, so `dorsal` is pinned to +z.
 *
 * The class exposes the same x / y / forward / dorsal / trail / energy
 * surface the renderer and world expect, so it is a drop-in replacement
 * at the world-integration seam.
 */

import { Vec3 } from "../vec3.js";
import { CONFIG } from "../config.js";
import { clamp, normAngle } from "../math.js";

const WORLD_UP = new Vec3(0, 0, 1);

export class AntBody {
  /**
   * @param {number} x      initial world-X
   * @param {number} y      initial world-Y
   * @param {number} angle  initial heading in the ground plane (radians)
   */
  constructor(x, y, angle) {
    this.position  = new Vec3(x, y, 0);
    this.forward   = new Vec3(Math.cos(angle), Math.sin(angle), 0);
    this.dorsal    = WORLD_UP;                 // upright — never rolls
    this.speed     = 0;
    this.rollAngle = 0;                        // retained for UI compat

    this.energy = CONFIG.MAX_ENERGY;
    this.trail  = [];

    // Gland reservoirs — ant-design-spec.md §4.2. Each gland has a
    // capacity, a current fill level (0..capacity), and a passive refill
    // rate (units per second). Secretion draws from `current`; when it
    // hits 0 the gland goes silent until recovery builds it back up.
    this.glandAlpha = { current: 1.0, capacity: 1.0, recovery: 0.02 };
    this.glandBeta  = { current: 1.0, capacity: 1.0, recovery: 0.05 };
  }

  // ── 2D projection getters / setters (shared with Worm surface) ──
  get x()      { return this.position.x; }
  set x(v)     { this.position.x = v; }
  get y()      { return this.position.y; }
  set y(v)     { this.position.y = v; }
  get angle()  { return Math.atan2(this.forward.y, this.forward.x); }
  set angle(v) { this.forward = new Vec3(Math.cos(v), Math.sin(v), 0); }

  /**
   * Advance one tick.
   *
   * @param {number} dt                    fixed timestep (seconds)
   * @param {Object<string,number>} motors ant motor levels, each 0..1:
   *        motor_forward, motor_turn_L, motor_turn_R,
   *        gland_alpha, gland_beta, mandible  (last three unused here)
   * @param {{turnScale:number, speedScale:number}} bodyParams
   * @returns {{turnRate:number, turnSigned:number, thrustLevel:number}}
   */
  step(dt, motors, bodyParams) {
    const prevAngle = this.angle;

    const thrust = clamp(motors.motor_forward ?? 0, 0, 1);
    // +turn_L − turn_R → positive yaw (counter-clockwise in screen coords
    // where +y is down this matches a left turn on screen).
    const yawInput = ((motors.motor_turn_L ?? 0) - (motors.motor_turn_R ?? 0))
                     * CONFIG.TURN_GAIN * bodyParams.turnScale;

    this.speed = CONFIG.BASE_SPEED * thrust * bodyParams.speedScale;

    if (Math.abs(yawInput) > 1e-8) {
      this.forward = this.forward.rotateAround(WORLD_UP, -yawInput * dt);
      const fLen = this.forward.length();
      if (fLen < 1e-8) this.forward = new Vec3(Math.cos(prevAngle), Math.sin(prevAngle), 0);
      else this.forward = this.forward.scale(1 / fLen);
      this.forward = new Vec3(this.forward.x, this.forward.y, 0);
    }

    this.position = this.position.add(this.forward.scale(this.speed * dt));
    this.position = new Vec3(this.position.x, this.position.y, 0);

    const newAngle   = this.angle;
    const yawDelta   = normAngle(newAngle - prevAngle);
    const turnRate   = Math.abs(yawDelta) / Math.max(dt, 1e-4);
    const turnSigned = yawDelta / Math.max(dt, 1e-4);

    return { turnRate, turnSigned, thrustLevel: thrust };
  }
}
