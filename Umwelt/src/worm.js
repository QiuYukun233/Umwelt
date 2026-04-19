import { Vec3 } from "./vec3.js";
import { CONFIG } from "./config.js";
import { clamp, normAngle } from "./math.js";

/**
 * Locomotion roll coupling — how fast the worm rolls onto its side
 * when moving.  At tonic-drive speed the equilibrium roll ≈ π/2,
 * so dorsal/ventral bending maps 1-to-1 to yaw.
 */
const ROLL_DRIVE = 8.0;

/** Gravity restoring torque — pulls dorsal back toward world-up. */
const GRAVITY_RESTORE = 3.0;

const UP = new Vec3(0, 0, 1);

export class Worm {
  /**
   * @param {number} x      initial world-X
   * @param {number} y      initial world-Y
   * @param {number} angle   initial heading (radians, in XY ground plane)
   */
  constructor(x, y, angle) {
    // ── 3D state ───────────────────────────────────
    this.position = new Vec3(x, y, 0);
    this.forward  = new Vec3(Math.cos(angle), Math.sin(angle), 0);
    this.dorsal   = new Vec3(0, 0, 1);          // initially pointing up
    this.speed    = 0;
    this.rollAngle = 0;                          // 0 = upright, π/2 = on its side

    // ── shared mutable state (energy, trail) ──────
    this.energy = CONFIG.MAX_ENERGY;
    this.trail  = [];
  }

  // ── 2D projection getters/setters (backward compat) ──

  get x()       { return this.position.x; }
  set x(v)      { this.position.x = v; }

  get y()       { return this.position.y; }
  set y(v)      { this.position.y = v; }

  get angle()   { return Math.atan2(this.forward.y, this.forward.x); }
  set angle(v)  {
    this.forward = new Vec3(Math.cos(v), Math.sin(v), 0);
  }

  // ── 3D physics step ──────────────────────────────

  /**
   * Advance one tick of biologically-honest 3D kinematics.
   *
   * Four motor channels:
   *   forward / backward  → thrust along body axis
   *   dorsalBend / ventralBend → angular velocity around lateral axis
   *
   * The bend rotates `forward` around the lateral axis (forward × dorsal).
   * A ground-plane constraint then projects `forward` back to z = 0.
   * Because the worm naturally rolls onto its side during locomotion,
   * sin(rollAngle) ≈ 1, so bending maps almost directly to yaw.
   *
   * @param {number} dt             fixed timestep (seconds)
   * @param {{forward:number, backward:number, dorsalBend:number, ventralBend:number}} motors
   * @param {{turnScale:number, speedScale:number}} bodyParams
   * @returns {{turnRate:number, turnSigned:number, thrustLevel:number}}
   */
  step(dt, motors, bodyParams) {
    const prevAngle = this.angle;

    // ── 4-motor biological controls ──
    const thrust    = clamp(motors.forward - motors.backward, 0, 1);
    const bendInput = (motors.dorsalBend - motors.ventralBend)
                      * CONFIG.TURN_GAIN * bodyParams.turnScale;

    // ── forward speed along body axis ──
    this.speed = CONFIG.BASE_SPEED * thrust * bodyParams.speedScale;

    // ── roll dynamics ──
    // Locomotion drives the worm onto its side; gravity restores upright.
    const speedFrac   = clamp(thrust, 0, 1);
    const rollDrive   = speedFrac * ROLL_DRIVE;
    const rollGravity = Math.sin(this.rollAngle) * GRAVITY_RESTORE;
    this.rollAngle    = clamp(
      this.rollAngle + (rollDrive - rollGravity) * dt,
      0, Math.PI * 0.5
    );

    // ── reconstruct dorsal from rollAngle ──
    // rightDir = world-up × forward  (perpendicular to forward, in ground plane)
    const rightDir = UP.cross(this.forward).normalize();
    if (rightDir.lengthSq() > 1e-6) {
      this.dorsal = UP.scale(Math.cos(this.rollAngle))
        .add(rightDir.scale(Math.sin(this.rollAngle)))
        .normalize();
    }

    // ── dorsal/ventral bend → rotate forward around lateral axis ──
    if (Math.abs(bendInput) > 1e-8) {
      const lateral = this.forward.cross(this.dorsal);
      const latLen  = lateral.length();
      if (latLen > 1e-8) {
        const lateralNorm = lateral.scale(1 / latLen);
        this.forward = this.forward.rotateAround(lateralNorm, bendInput * dt);
      }
    }

    // ── ground-plane constraint: forward must lie in z = 0 ──
    this.forward = new Vec3(this.forward.x, this.forward.y, 0);
    const fwdLen = this.forward.length();
    if (fwdLen < 1e-8) {
      // degenerate — restore previous heading
      this.forward = new Vec3(Math.cos(prevAngle), Math.sin(prevAngle), 0);
    } else {
      this.forward = this.forward.scale(1 / fwdLen);
    }

    // ── translate along forward ──
    this.position = this.position.add(this.forward.scale(this.speed * dt));
    this.position = new Vec3(this.position.x, this.position.y, 0);

    // ── compute effective yaw rate for proprioception / UI ──
    const newAngle   = this.angle;
    const yawDelta   = normAngle(newAngle - prevAngle);
    const turnRate   = Math.abs(yawDelta) / Math.max(dt, 1e-4);
    const turnSigned = yawDelta / Math.max(dt, 1e-4);

    return { turnRate, turnSigned, thrustLevel: thrust };
  }
}
