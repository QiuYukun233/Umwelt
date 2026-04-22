import { CONFIG, SENSOR_DEFINITIONS } from "../config.js";
import { ANT_ANTENNA_REACH } from "../sensor-config.js";
import { fitCanvas, readThemeVars, TAU } from "../math.js";

/* ── ant body geometry (body-local coords, +x = forward) ──
 * Scaled up roughly 1.5× from the first pass so detail reads cleanly.
 * Proportions follow a formicine worker: small head, narrower thorax
 * with all six legs, large gaster at the rear.
 */
const ANT_HEAD    = { cx: 13, cy: 0, rx: 6,  ry: 6   };
const ANT_THORAX  = { cx:  0, cy: 0, rx: 8,  ry: 6   };
const ANT_ABDOMEN = { cx:-20, cy: 0, rx: 12, ry: 9   };

// Antenna bases on the head front; tip coords are taken from sensor-config.js
// so cone origin and drawn tip coincide.
const ANT_ANTENNA_ANGLE = Math.PI / 4;
const ANT_ANTENNA_BASE_X = ANT_HEAD.cx + ANT_HEAD.rx * 0.55;

// Cone-sampling visualization — matches CONE_HALF_ANGLE / CONE_RANGE in
// world.js sampleSensors. Hidden by default (this.debug = false).
// Toggle with setDebug(true) or press D.
const ANT_CONE_HALF = Math.PI / 6;
const ANT_CONE_RANGE = 160;
const ANT_CONE_SIDE_ANGLE = Math.PI / 4;

// Six legs on the thorax edge. Alternating-tripod gait: legs sharing a
// stepPhase lift together (FL+MR+HL vs. FR+ML+HR).
const ANT_LEGS_L = [
  { hipX:  5, hipY: -5, restAngle: -Math.PI * 0.30, stepPhase: 0.00 }, // front left
  { hipX:  0, hipY: -6, restAngle: -Math.PI * 0.50, stepPhase: 0.50 }, // mid left
  { hipX: -5, hipY: -5, restAngle: -Math.PI * 0.70, stepPhase: 0.00 }, // hind left
];
const ANT_LEGS_R = [
  { hipX:  5, hipY:  5, restAngle:  Math.PI * 0.30, stepPhase: 0.50 },
  { hipX:  0, hipY:  6, restAngle:  Math.PI * 0.50, stepPhase: 0.00 },
  { hipX: -5, hipY:  5, restAngle:  Math.PI * 0.70, stepPhase: 0.50 },
];

// Chemical-field background
const BASE_R = 26;
const BASE_G = 22;
const BASE_B = 18;
const CHANNEL_GAIN = 220;
const GAMMA = 0.7;

export class WorldRenderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.world = world;
    this.ctx = canvas.getContext("2d");
    this._fieldCanvas = document.createElement("canvas");
    this._fieldCtx = this._fieldCanvas.getContext("2d");
    this.debug = false;                              // sensor cones off by default

    // Press D anywhere (outside text inputs) to toggle debug overlay.
    this._keyHandler = (e) => {
      if (e.key !== "d" && e.key !== "D") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      this.debug = !this.debug;
    };
    window.addEventListener("keydown", this._keyHandler);

    this.refreshTheme();
    this.resize();
  }

  setDebug(flag) { this.debug = !!flag; }

  refreshTheme() {
    this.palette = readThemeVars(["world", "surface", "surface-2", "border", "text", "text-soft", "amber", "mint", "red", "brown"]);
  }

  resize() {
    const { ratio } = fitCanvas(this.canvas);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.world.setSize(this.width, this.height);
  }

  renderChemicalFields(c) {
    // Four chemicals composited into RGB:
    //   ChemA (food)       → green
    //   ChemB (gland α)    → blue-cyan      — persistent ground trail
    //   ChemC (gland β)    → amber          — short-lived airborne cloud
    //   ChemD (danger)     → red
    // Per-cell we add each chemical's colour contribution on top of the
    // dark warm base, gamma-compressed so faint edges are still visible.
    const f = this.world.fields;
    const gA = f.chem_A.grid, gB = f.chem_B.grid, gC = f.chem_C.grid, gD = f.chem_D.grid;
    const cols = f.chem_A.cols, rows = f.chem_A.rows;
    const fc = this._fieldCanvas;
    const fctx = this._fieldCtx;
    if (fc.width !== cols || fc.height !== rows) {
      fc.width = cols;
      fc.height = rows;
    }
    const imageData = fctx.createImageData(cols, rows);
    const data = imageData.data;
    const len = gA.length;

    // Per-chem colour weights (R, G, B multipliers applied to the
    // gamma-compressed concentration × CHANNEL_GAIN).
    //   ChemA → mint      = (0.00, 1.00, 0.35)
    //   ChemB → blue-cyan = (0.15, 0.55, 1.00)
    //   ChemC → amber     = (1.00, 0.85, 0.20)
    //   ChemD → red       = (1.00, 0.35, 0.28)
    for (let i = 0; i < len; i++) {
      const vA = gA[i], vB = gB[i], vC = gC[i], vD = gD[i];
      const offset = i << 2;
      const cA = vA > 0.001 ? Math.pow(vA, GAMMA) * CHANNEL_GAIN : 0;
      const cB = vB > 0.001 ? Math.pow(vB, GAMMA) * CHANNEL_GAIN : 0;
      const cC = vC > 0.001 ? Math.pow(vC, GAMMA) * CHANNEL_GAIN : 0;
      const cD = vD > 0.001 ? Math.pow(vD, GAMMA) * CHANNEL_GAIN : 0;
      const R = BASE_R + 0.00 * cA + 0.15 * cB + 1.00 * cC + 1.00 * cD;
      const G = BASE_G + 1.00 * cA + 0.55 * cB + 0.85 * cC + 0.35 * cD;
      const B = BASE_B + 0.35 * cA + 1.00 * cB + 0.20 * cC + 0.28 * cD;
      data[offset]     = R > 255 ? 255 : R | 0;
      data[offset + 1] = G > 255 ? 255 : G | 0;
      data[offset + 2] = B > 255 ? 255 : B | 0;
      data[offset + 3] = 255;
    }

    fctx.putImageData(imageData, 0, 0);
    c.save();
    c.imageSmoothingEnabled = false;
    c.drawImage(fc, 0, 0, this.width, this.height);
    c.restore();
  }

  /** Radial gradient for a body segment — warm tan highlight → dark edge. */
  _segmentGradient(c, e) {
    const g = c.createRadialGradient(
      e.cx - e.rx * 0.3, e.cy - e.ry * 0.3, e.rx * 0.12,
      e.cx, e.cy, Math.max(e.rx, e.ry) * 1.2
    );
    g.addColorStop(0.00, "rgba(124, 88,  62, 0.99)");    // warm highlight
    g.addColorStop(0.55, "rgba( 62, 42,  28, 0.99)");    // dark body
    g.addColorStop(1.00, "rgba( 18, 12,   8, 1.00)");    // dark edge, still a bit above bg
    return g;
  }

  /**
   * Draw the ant: six jointed legs + three body segments + V mandibles +
   * kinked antennae with swollen clubs. Cone overlay is opt-in via
   * this.debug.
   */
  drawAnt(c, p, ant, senses, time, speed, sensorEnabled) {
    const outputs = senses.sensorOutputs ?? {};
    const t = time * 0.001;

    // ── Cone-sampling overlay (debug only) ──
    if (this.debug) {
      const antAngle = ant.angle;
      const cos = Math.cos(antAngle);
      const sin = Math.sin(antAngle);
      const tipLocalX = ANT_ANTENNA_REACH * Math.cos(ANT_ANTENNA_ANGLE);
      for (const side of [-1, 1]) {
        const tipLocalY = side * ANT_ANTENNA_REACH * Math.sin(ANT_ANTENNA_ANGLE);
        const tipWX = ant.x + cos * tipLocalX - sin * tipLocalY;
        const tipWY = ant.y + sin * tipLocalX + cos * tipLocalY;
        const coneCenter = antAngle + side * ANT_CONE_SIDE_ANGLE;

        const chemA = side < 0 ? (outputs.L_chem_A ?? 0) : (outputs.R_chem_A ?? 0);
        const chemD = side < 0 ? (outputs.L_chem_D ?? 0) : (outputs.R_chem_D ?? 0);
        const activation = Math.max(chemA, chemD);
        const isDanger = chemD > chemA;
        const tintR = isDanger ? 196 : 122;
        const tintG = isDanger ? 106 : 184;
        const tintB = isDanger ?  90 : 160;

        c.beginPath();
        c.moveTo(tipWX, tipWY);
        c.arc(tipWX, tipWY, ANT_CONE_RANGE, coneCenter - ANT_CONE_HALF, coneCenter + ANT_CONE_HALF);
        c.closePath();
        c.fillStyle = `rgba(${tintR},${tintG},${tintB},${(0.04 + activation * 0.16).toFixed(3)})`;
        c.fill();

        c.strokeStyle = `rgba(${tintR},${tintG},${tintB},${Math.min(0.5, 0.18 + activation * 0.32).toFixed(3)})`;
        c.lineWidth = 0.7;
        c.setLineDash([3, 4]);
        for (const edgeSign of [-1, 1]) {
          const a = coneCenter + edgeSign * ANT_CONE_HALF;
          c.beginPath();
          c.moveTo(tipWX, tipWY);
          c.lineTo(tipWX + Math.cos(a) * ANT_CONE_RANGE, tipWY + Math.sin(a) * ANT_CONE_RANGE);
          c.stroke();
        }
        c.setLineDash([]);
      }
    }

    // ── Body-local drawing (rotated frame) ──
    c.save();
    c.translate(ant.x, ant.y);
    c.rotate(ant.angle);

    // Visibly lighter than body edges so limbs read against the dark
    // chemical-field background.
    const LIMB_COLOR     = "rgba(95, 66, 46, 0.96)";
    const MANDIBLE_COLOR = "rgba(30, 20, 14, 0.98)";
    const ANTENNA_COLOR  = "rgba(110, 78, 54, 0.97)";
    const BODY_STROKE    = "rgba(10,  6,  4, 0.95)";

    // ── Legs (drawn under the body, so the thorax hides the inner joint
    //    stub). Two segments: femur (hip→knee) + tibia (knee→foot).
    //    Knee juts forward of the rest angle, tibia sweeps with gait.
    const gaitSpeed = 9 * Math.max(0.15, Math.min(1.4, speed / CONFIG.BASE_SPEED));
    const drawLeg = (leg, side) => {
      const wave = Math.sin(t * gaitSpeed + leg.stepPhase * TAU);
      const swing = wave * 0.32;                          // foot sweep in radians
      const lift  = Math.max(0, wave) * 0.18;             // minor shrink during lift

      const femurLen = 7.0 - lift * 3;
      // Knee direction rotates slightly forward of the rest angle so the
      // leg reads as clearly bent rather than straight.
      const femurAngle = leg.restAngle - side * (0.35 - 0.05 * wave);
      const kneeX = leg.hipX + Math.cos(femurAngle) * femurLen;
      const kneeY = leg.hipY + Math.sin(femurAngle) * femurLen;

      const tibiaLen = 9.5;
      const tibiaAngle = leg.restAngle + swing;
      const footX = kneeX + Math.cos(tibiaAngle) * tibiaLen;
      const footY = kneeY + Math.sin(tibiaAngle) * tibiaLen;

      c.strokeStyle = LIMB_COLOR;
      c.lineCap = "round";
      // Femur slightly thicker than tibia for taper
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(leg.hipX, leg.hipY);
      c.lineTo(kneeX, kneeY);
      c.stroke();
      c.lineWidth = 1.1;
      c.beginPath();
      c.moveTo(kneeX, kneeY);
      c.lineTo(footX, footY);
      c.stroke();
      // Tiny foot dot so the tip reads clearly
      c.beginPath();
      c.arc(footX, footY, 0.9, 0, TAU);
      c.fillStyle = LIMB_COLOR;
      c.fill();
    };
    for (const leg of ANT_LEGS_L) drawLeg(leg, -1);
    for (const leg of ANT_LEGS_R) drawLeg(leg,  1);

    // ── Petiole between thorax and abdomen ──
    c.strokeStyle = BODY_STROKE;
    c.lineWidth = 2.0;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(ANT_THORAX.cx - ANT_THORAX.rx * 0.9, 0);
    c.lineTo(ANT_ABDOMEN.cx + ANT_ABDOMEN.rx * 0.9, 0);
    c.stroke();

    // ── Body segments with radial shading ──
    const drawSegment = (e) => {
      c.beginPath();
      c.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, TAU);
      c.fillStyle = this._segmentGradient(c, e);
      c.fill();
      c.strokeStyle = BODY_STROKE;
      c.lineWidth = 1.0;
      c.stroke();
    };
    drawSegment(ANT_ABDOMEN);
    drawSegment(ANT_THORAX);
    drawSegment(ANT_HEAD);

    // ── Mandibles — V-shape at the head front. Two straight strokes
    //    from mid-head-front splay apart to an apex pair in front of
    //    the head; meeting at the centerline when the motor is at full
    //    clamp (level 1), splaying wide open when it drops to 0.
    {
      const mandibleLevel = Math.max(0, Math.min(1, senses.mandible ?? 0));
      const openFrac = 1 - mandibleLevel;               // 1 = open, 0 = closed
      const baseX = ANT_HEAD.cx + ANT_HEAD.rx * 0.55;
      const baseY = ANT_HEAD.ry * 0.40;
      const apexX = ANT_HEAD.cx + ANT_HEAD.rx + 5;
      const apexY = 0.4 + openFrac * 3.2;               // tips pull apart when open
      c.strokeStyle = MANDIBLE_COLOR;
      c.lineCap = "round";
      c.lineWidth = 1.8;
      for (const side of [-1, 1]) {
        c.beginPath();
        c.moveTo(baseX, side * baseY);
        c.lineTo(apexX, side * apexY);
        c.stroke();
      }
    }

    // ── Antennae — scape (base→elbow) + funiculus (elbow→tip) with a
    //    kinked elbow and a swollen club at the very end. Tip lies at
    //    the sensor offset so cone origin == drawn tip.
    const tipFx = ANT_ANTENNA_REACH * Math.cos(ANT_ANTENNA_ANGLE);
    const tipFy = ANT_ANTENNA_REACH * Math.sin(ANT_ANTENNA_ANGLE);
    for (const side of [-1, 1]) {
      const baseX = ANT_ANTENNA_BASE_X;
      const baseY = side * ANT_HEAD.ry * 0.55;
      const tipX  = tipFx;
      const tipY  = side * tipFy;
      // Elbow roughly 42 % along, kicked outward for a clear kink.
      const ex = baseX + (tipX - baseX) * 0.42;
      const ey = baseY + (tipY - baseY) * 0.42 + side * 1.6;

      c.strokeStyle = ANTENNA_COLOR;
      c.lineCap = "round";
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(baseX, baseY);
      c.lineTo(ex, ey);
      c.lineTo(tipX, tipY);
      c.stroke();

      // Swollen club at the tip.
      c.beginPath();
      c.arc(tipX, tipY, 1.7, 0, TAU);
      c.fillStyle = ANTENNA_COLOR;
      c.fill();

      // Activation glow on the club when ChemA / ChemD is above threshold.
      const chemA = side < 0 ? (outputs.L_chem_A ?? 0) : (outputs.R_chem_A ?? 0);
      const chemD = side < 0 ? (outputs.L_chem_D ?? 0) : (outputs.R_chem_D ?? 0);
      const dotVal = Math.max(chemA, chemD);
      if (dotVal > 0.005) {
        const isDanger = chemD > chemA;
        const dotColor = isDanger ? "196,106,90" : "122,184,160";
        c.beginPath();
        c.arc(tipX, tipY, 1.8 + dotVal * 2.6, 0, TAU);
        c.fillStyle = `rgba(${dotColor},${(0.55 + dotVal * 0.42).toFixed(3)})`;
        c.fill();
      }
    }

    // ── Turn indicator — arrow arc (kept; small, doesn't obscure). ──
    const turnSigned = senses.turnSigned ?? 0;
    const turnAbs = Math.min(Math.abs(turnSigned), CONFIG.TURN_GAIN);
    if (turnAbs > 0.15) {
      const turnFrac = turnAbs / CONFIG.TURN_GAIN;
      const alpha = Math.min(0.5, 0.18 + turnFrac * 0.42);
      const sweep = (0.3 + turnFrac * 0.9) * Math.PI;
      const sign = turnSigned > 0 ? -1 : 1;
      const arcR = 28;
      const startA = -sweep * 0.5 * sign;
      const endA   =  sweep * 0.5 * sign;
      c.strokeStyle = `rgba(220,200,170,${alpha.toFixed(3)})`;
      c.lineWidth = 1.2 + turnFrac * 1.0;
      c.beginPath();
      if (sign > 0) c.arc(0, 0, arcR, startA, endA);
      else c.arc(0, 0, arcR, endA, startA);
      c.stroke();
      const tipA = endA;
      const tipX = Math.cos(tipA) * arcR;
      const tipY = Math.sin(tipA) * arcR;
      const tangentA = tipA + sign * Math.PI * 0.5;
      const aw = 3;
      c.fillStyle = `rgba(220,200,170,${alpha.toFixed(3)})`;
      c.beginPath();
      c.moveTo(tipX + Math.cos(tangentA) * 5, tipY + Math.sin(tangentA) * 5);
      c.lineTo(tipX + Math.cos(tipA + Math.PI * 0.5) * aw, tipY + Math.sin(tipA + Math.PI * 0.5) * aw);
      c.lineTo(tipX - Math.cos(tipA + Math.PI * 0.5) * aw, tipY - Math.sin(tipA + Math.PI * 0.5) * aw);
      c.closePath();
      c.fill();
    }

    c.restore();
  }

  render(time, sensorEnabled = {}, sensorDefs = SENSOR_DEFINITIONS) {
    const c = this.ctx;
    const p = this.palette;
    const ant = this.world.focusedAnt;
    if (!ant) return;   // no focused ant — skip this frame's render
    const tSec = time * 0.001;

    // 1. Chemical field background mosaic
    this.renderChemicalFields(c);

    // 2. Food and danger entities
    for (const food of this.world.foods) {
      const breath = 0.6 + 0.4 * ((Math.sin(tSec * 2.1 + food.phase) + 1) * 0.5);
      c.beginPath();
      c.arc(food.x, food.y, food.r, 0, TAU);
      c.fillStyle = `rgba(180,240,200,${(0.6 + breath * 0.2).toFixed(3)})`;
      c.fill();
    }
    for (const danger of this.world.dangers) {
      const breath = 0.6 + 0.4 * ((Math.sin(tSec * 2.4 + danger.phase) + 1) * 0.5);
      c.beginPath();
      c.arc(danger.x, danger.y, danger.r, 0, TAU);
      c.fillStyle = `rgba(240,130,130,${(0.55 + breath * 0.2).toFixed(3)})`;
      c.fill();
      c.strokeStyle = "rgba(255,200,200,0.5)";
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(danger.x - danger.r * 0.4, danger.y - danger.r * 0.4);
      c.lineTo(danger.x + danger.r * 0.4, danger.y + danger.r * 0.4);
      c.moveTo(danger.x + danger.r * 0.4, danger.y - danger.r * 0.4);
      c.lineTo(danger.x - danger.r * 0.4, danger.y + danger.r * 0.4);
      c.stroke();
    }

    // 3. Ant
    this.drawAnt(c, p, ant, this.world.metrics, time, this.world.metrics.speed, sensorEnabled);
  }
}
