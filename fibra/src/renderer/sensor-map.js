import { SENSOR_DEFINITIONS, SENSOR_HALF_ANGLE } from "../config.js";
import { fitCanvas, polarPoint, readThemeVars, TAU } from "../math.js";

export class SensorMapRenderer {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.ctx = canvas.getContext("2d");
    this.points = [];
    this.hoverSensorId = null;
    this.pressTimer = 0;
    this.pressedSensorId = null;
    this.longPressTriggered = false;
    this.refreshTheme();
    this.resize();
    this.attach();
  }

  attach() {
    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointercancel", () => this.cancelPress());
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerleave", () => {
      this.hoverSensorId = null;
      this.canvas.style.cursor = "default";
      this.cancelPress();
    });
  }

  refreshTheme() {
    this.palette = readThemeVars(["surface-2", "border", "text", "text-soft", "text-faint", "mint", "red"]);
  }

  resize() {
    const { ratio } = fitCanvas(this.canvas);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
  }

  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  pointAt(x, y) {
    return this.points.find((item) => Math.hypot(x - item.x, y - item.y) <= 11) ?? null;
  }

  cancelPress() {
    if (this.pressTimer) clearTimeout(this.pressTimer);
    this.pressTimer = 0;
    this.pressedSensorId = null;
    this.longPressTriggered = false;
  }

  onPointerDown(event) {
    const hit = this.pointAt(...Object.values(this.point(event)));
    this.cancelPress();
    if (!hit) return;
    this.pressedSensorId = hit.sensorId;
    if (this.callbacks.isSensorEnabled?.(hit.sensorId)) {
      this.pressTimer = setTimeout(() => {
        this.longPressTriggered = true;
        this.callbacks.onToggleSensorMode?.(hit.sensorId);
      }, 420);
    }
  }

  onPointerUp(event) {
    const pressed = this.pressedSensorId;
    const longPress = this.longPressTriggered;
    const hit = this.pointAt(...Object.values(this.point(event)));
    this.cancelPress();
    if (pressed && !longPress && hit?.sensorId === pressed) this.callbacks.onToggleSensor?.(pressed);
  }

  onPointerMove(event) {
    const hit = this.pointAt(...Object.values(this.point(event)));
    this.hoverSensorId = hit?.sensorId ?? null;
    this.canvas.style.cursor = hit ? "pointer" : "default";
  }

  render(metrics, sensorEnabled, sensorModes) {
    const c = this.ctx;
    const center = { x: this.width * 0.5, y: this.height * 0.54 };
    const foodRadius = Math.min(this.width, this.height) * 0.34;
    const threatRadius = Math.min(this.width, this.height) * 0.24;
    this.points = [];
    c.fillStyle = this.palette["surface-2"];
    c.fillRect(0, 0, this.width, this.height);
    c.strokeStyle = "rgba(74,58,40,0.75)";
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, this.width - 1, this.height - 1);
    c.strokeStyle = "rgba(90,69,53,0.6)";
    c.beginPath(); c.arc(center.x, center.y, foodRadius, 0, TAU); c.stroke();
    c.beginPath(); c.arc(center.x, center.y, threatRadius, 0, TAU); c.stroke();
    for (const sensor of SENSOR_DEFINITIONS) this.drawCone(sensor, metrics, sensorEnabled, sensorModes, center, sensor.kind === "food" ? foodRadius : threatRadius);
    c.fillStyle = this.palette["text-faint"];
    c.font = '10px "IBM Plex Mono", monospace';
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("前", center.x, center.y - foodRadius - 24);
    c.fillText("后", center.x, center.y + foodRadius + 24);
    c.fillText("右", center.x + foodRadius + 24, center.y);
    c.fillText("左", center.x - foodRadius - 24, center.y);
    for (const sensor of SENSOR_DEFINITIONS) this.drawPoint(sensor, metrics, sensorEnabled, sensorModes, center, sensor.kind === "food" ? foodRadius : threatRadius);
    c.fillStyle = this.palette.text;
    c.font = '600 12px "IBM Plex Mono", monospace';
    c.fillText(`耗能 ${metrics.sensorDrain.toFixed(2)}/s`, center.x, center.y - 6);
    c.fillStyle = this.palette["text-soft"];
    c.font = '11px "IBM Plex Sans", sans-serif';
    c.fillText("传感器总消耗", center.x, center.y + 14);
  }

  drawCone(sensor, metrics, sensorEnabled, sensorModes, center, radius) {
    const c = this.ctx;
    const angle = sensor.angle - Math.PI / 2;
    const start = angle - SENSOR_HALF_ANGLE;
    const end = angle + SENSOR_HALF_ANGLE;
    const enabled = Boolean(sensorEnabled[sensor.id]);
    const hovered = this.hoverSensorId === sensor.id;
    const color = sensor.kind === "food" ? "122,184,160" : "196,106,90";
    c.beginPath();
    c.arc(center.x, center.y, radius + 16, start, end);
    c.arc(center.x, center.y, Math.max(18, radius - 16), end, start, true);
    c.closePath();
    c.fillStyle = `rgba(${color},${enabled ? 0.09 : hovered ? 0.07 : 0.035})`;
    c.fill();
    c.strokeStyle = `rgba(${color},${enabled || hovered ? 0.45 : 0.18})`;
    c.lineWidth = enabled || hovered ? 1.25 : 1;
    c.beginPath();
    c.moveTo(center.x, center.y);
    c.lineTo(center.x + Math.cos(start) * radius, center.y + Math.sin(start) * radius);
    c.moveTo(center.x, center.y);
    c.lineTo(center.x + Math.cos(end) * radius, center.y + Math.sin(end) * radius);
    c.stroke();
    c.beginPath();
    c.arc(center.x, center.y, radius + 16, start, end);
    c.stroke();
  }

  drawPoint(sensor, metrics, sensorEnabled, sensorModes, center, radius) {
    const c = this.ctx;
    const point = polarPoint(center.x, center.y, sensor.angle - Math.PI / 2, radius);
    const enabled = Boolean(sensorEnabled[sensor.id]);
    const color = sensor.kind === "food" ? this.palette.mint : this.palette.red;
    const value = metrics.sensorOutputs?.[sensor.id] ?? 0;
    this.points.push({ sensorId: sensor.id, x: point.x, y: point.y });
    c.beginPath();
    c.arc(point.x, point.y, this.hoverSensorId === sensor.id ? 9.5 : 8.5, 0, TAU);
    c.fillStyle = enabled ? "rgba(0,0,0,0.16)" : "rgba(0,0,0,0.06)";
    c.fill();
    c.beginPath();
    c.arc(point.x, point.y, this.hoverSensorId === sensor.id ? 8 : 7, 0, TAU);
    c.fillStyle = enabled ? color : "rgba(0,0,0,0)";
    if (enabled) {
      c.globalAlpha = 0.25 + value * 0.55;
      c.fill();
      c.globalAlpha = 1;
    }
    c.strokeStyle = enabled ? color : (this.hoverSensorId === sensor.id ? color : "rgba(90,69,53,0.65)");
    c.lineWidth = this.hoverSensorId === sensor.id ? 1.8 : 1.4;
    c.stroke();
    c.fillStyle = this.palette.text;
    c.font = '10px "IBM Plex Mono", monospace';
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(sensor.label, point.x, point.y - (sensor.kind === "food" ? 16 : 14));
    if ((sensorModes?.[sensor.id] ?? "absolute") === "diff") {
      c.fillStyle = color;
      c.font = '600 10px "IBM Plex Mono", monospace';
      c.fillText("∂", point.x + 10, point.y - (sensor.kind === "food" ? 12 : 10));
    }
    if (enabled) {
      c.fillStyle = color;
      c.fillText(value.toFixed(2), point.x, point.y + 16);
    }
  }
}
