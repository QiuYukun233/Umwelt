export const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function normAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function formatTime(seconds) {
  return seconds.toFixed(1);
}

export function formatPct(value) {
  return `${Math.round(clamp(value, 0, 1) * 100)}`;
}

export function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

export function wrapValue(value, max) {
  if (value < 0) return value + max;
  if (value > max) return value - max;
  return value;
}

export function polarPoint(x, y, angle, length) {
  return { x: x + Math.cos(angle) * length, y: y + Math.sin(angle) * length };
}

export function respawnPoint(width, height, margin, avoid) {
  let point = { x: width * 0.5, y: height * 0.5 };
  for (let tries = 0; tries < 60; tries += 1) {
    point = { x: randomBetween(margin, width - margin), y: randomBetween(margin, height - margin) };
    if (!avoid) break;
    if (Math.hypot(point.x - avoid.x, point.y - avoid.y) > avoid.radius) break;
  }
  return point;
}

export function fitCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, ratio };
}

export function readThemeVars(names) {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(names.map((name) => [name, styles.getPropertyValue(`--${name}`).trim()]));
}
