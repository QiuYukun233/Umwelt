import { CONFIG } from "../config.js";
import { fitCanvas, readThemeVars, TAU } from "../math.js";

export class WorldRenderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.world = world;
    this.ctx = canvas.getContext("2d");
    this.refreshTheme();
    this.resize();
  }

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

  drawAnt(c, p, ant, senses) {
    c.save();
    c.translate(ant.x, ant.y);
    c.rotate(ant.angle);
    c.lineCap = "round";
    c.strokeStyle = "rgba(141,112,84,0.82)";
    c.lineWidth = 1.3;
    for (const [fx, fy, tx, ty] of [[-2.5, -3.4, -11, -11], [3.2, -3.4, 10, -12], [-6.8, 0.4, -17, 0], [7.4, 0.4, 18, 0], [-2.5, 3.8, -11, 11], [3.2, 3.8, 10, 12]]) {
      c.beginPath();
      c.moveTo(fx, fy);
      c.lineTo(tx, ty);
      c.stroke();
    }
    c.strokeStyle = "rgba(160,128,96,0.6)";
    c.lineWidth = 1.2;
    for (const [fx, fy, tx, ty] of [[12, -2, 24, -8], [12, 2, 24, 8]]) {
      c.beginPath();
      c.moveTo(fx, fy);
      c.quadraticCurveTo(20, fy < 0 ? -10 : 10, tx, ty);
      c.stroke();
    }
    c.strokeStyle = "rgba(61,48,37,0.9)";
    c.beginPath();
    c.ellipse(-5.5, 0, 7, 5, 0, 0, TAU);
    c.fillStyle = "rgba(111,84,56,0.95)";
    c.fill();
    c.stroke();
    c.beginPath();
    c.arc(1.5, 0, 5.3, 0, TAU);
    c.fillStyle = "rgba(145,112,76,0.98)";
    c.fill();
    c.stroke();
    c.beginPath();
    c.arc(9.2, 0, 4.6, 0, TAU);
    c.fillStyle = "rgba(196,133,58,0.95)";
    c.fill();
    c.stroke();
    c.globalAlpha = 0.25 + senses.leftEye * 0.65;
    c.fillStyle = p.mint;
    c.beginPath();
    c.arc(11.2, -2.5, 1.9, 0, TAU);
    c.fill();
    c.globalAlpha = 0.25 + senses.rightEye * 0.65;
    c.beginPath();
    c.arc(11.2, 2.5, 1.9, 0, TAU);
    c.fill();
    c.globalAlpha = 1;
    c.strokeStyle = this.world.ant.energy > 50 ? p.mint : this.world.ant.energy > 25 ? p.amber : p.red;
    c.lineWidth = 1.7;
    c.beginPath();
    c.arc(0, 0, 14, -Math.PI / 2, -Math.PI / 2 + (this.world.ant.energy / CONFIG.MAX_ENERGY) * TAU);
    c.stroke();
    c.restore();
  }

  render(time) {
    const c = this.ctx;
    const p = this.palette;
    const ant = this.world.ant;
    const t = time * 0.001;
    c.fillStyle = p.world;
    c.fillRect(0, 0, this.width, this.height);
    c.fillStyle = "rgba(255,255,255,0.015)";
    c.fillRect(0, 0, this.width, this.height);
    if (ant.trail.length > 1) {
      c.lineCap = "round";
      c.lineWidth = 1.35;
      for (let i = 1; i < ant.trail.length; i += 1) {
        c.strokeStyle = `rgba(160,128,96,${((i / ant.trail.length) * 0.18).toFixed(3)})`;
        c.beginPath();
        c.moveTo(ant.trail[i - 1].x, ant.trail[i - 1].y);
        c.lineTo(ant.trail[i].x, ant.trail[i].y);
        c.stroke();
      }
    }
    for (const side of [-1, 1]) {
      c.beginPath();
      c.moveTo(ant.x, ant.y);
      c.arc(ant.x, ant.y, CONFIG.FOOD_SENSE_RANGE * 0.78, ant.angle + side * CONFIG.EYE_CONE_ANGLE - CONFIG.EYE_CONE_WIDTH * 0.58, ant.angle + side * CONFIG.EYE_CONE_ANGLE + CONFIG.EYE_CONE_WIDTH * 0.58);
      c.closePath();
      c.fillStyle = "rgba(122,184,160,0.045)";
      c.fill();
    }
    for (const food of this.world.foods) {
      const breath = 0.6 + 0.4 * ((Math.sin(t * 2.1 + food.phase) + 1) * 0.5);
      c.beginPath();
      c.arc(food.x, food.y, food.r * 2.7, 0, TAU);
      c.fillStyle = `rgba(122,184,160,${(0.12 + breath * 0.12).toFixed(3)})`;
      c.fill();
      c.beginPath();
      c.arc(food.x, food.y, food.r, 0, TAU);
      c.fillStyle = `rgba(122,184,160,${(0.58 + breath * 0.18).toFixed(3)})`;
      c.fill();
    }
    for (const danger of this.world.dangers) {
      const breath = 0.6 + 0.4 * ((Math.sin(t * 2.4 + danger.phase) + 1) * 0.5);
      c.beginPath();
      c.arc(danger.x, danger.y, danger.r * 2.8, 0, TAU);
      c.fillStyle = `rgba(196,106,90,${(0.1 + breath * 0.1).toFixed(3)})`;
      c.fill();
      c.beginPath();
      c.arc(danger.x, danger.y, danger.r, 0, TAU);
      c.fillStyle = `rgba(196,106,90,${(0.52 + breath * 0.18).toFixed(3)})`;
      c.fill();
      c.strokeStyle = "rgba(61,48,37,0.92)";
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(danger.x - danger.r * 0.45, danger.y - danger.r * 0.45);
      c.lineTo(danger.x + danger.r * 0.45, danger.y + danger.r * 0.45);
      c.moveTo(danger.x + danger.r * 0.45, danger.y - danger.r * 0.45);
      c.lineTo(danger.x - danger.r * 0.45, danger.y + danger.r * 0.45);
      c.stroke();
    }
    this.drawAnt(c, p, ant, this.world.metrics);
  }
}
