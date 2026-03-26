import { GRAPH_LAYOUT, SENSOR_BY_ID, SOURCE_BY_ID, sourceDisplayName } from "../config.js";
import { fitCanvas, lerp, readThemeVars, TAU, clamp } from "../math.js";
import { nodeHasInput, nodeHasOutput, nodePort, nodeRect } from "../neural.js";

export function graphNodeLabel(node, sensorModes) {
  if (node.type !== "sensor") return node.label;
  const source = SOURCE_BY_ID[node.sourceId];
  if (!source) return node.label;
  const base = sourceDisplayName(source);
  return SENSOR_BY_ID[node.sourceId] && sensorModes?.[node.sourceId] === "diff" ? `${base}∂` : base;
}

export function graphKindColor(kind, palette) {
  if (kind === "food") return palette.mint;
  if (kind === "threat") return palette.red;
  if (kind === "proprio") return palette.brown;
  if (kind === "noise" || kind === "motor") return palette.amber;
  return palette["border-2"];
}

export function worldToScreen(view, point) {
  return { x: point.x * view.scale + view.x, y: point.y * view.scale + view.y };
}

export function screenToWorld(view, point) {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

export function plusButtonPoint(node) {
  const rect = nodeRect(node);
  return { x: rect.x + rect.width + 14, y: node.y };
}

export function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return { x: p0.x * mt ** 3 + p1.x * 3 * mt ** 2 * t + p2.x * 3 * mt * t ** 2 + p3.x * t ** 3, y: p0.y * mt ** 3 + p1.y * 3 * mt ** 2 * t + p2.y * 3 * mt * t ** 2 + p3.y * t ** 3 };
}

export function cubicTangent(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return { x: 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x), y: 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y) };
}

export function roundedRectPath(c, x, y, width, height, radius) {
  c.beginPath();
  c.moveTo(x + radius, y);
  c.arcTo(x + width, y, x + width, y + height, radius);
  c.arcTo(x + width, y + height, x, y + height, radius);
  c.arcTo(x, y + height, x, y, radius);
  c.arcTo(x, y, x + width, y, radius);
  c.closePath();
}

export function fitGraphView(graph, width, height, padding = 28) {
  const nodes = [...graph.nodes.values()];
  if (!nodes.length) return { x: 0, y: 0, scale: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const rect = nodeRect(node);
    minX = Math.min(minX, rect.x); minY = Math.min(minY, rect.y); maxX = Math.max(maxX, rect.x + rect.width); maxY = Math.max(maxY, rect.y + rect.height);
  }
  const scale = clamp(Math.min((width - padding * 2) / Math.max(1, maxX - minX), (height - padding * 2) / Math.max(1, maxY - minY)), 0.4, 1.4);
  return { scale, x: padding + (width - padding * 2 - (maxX - minX) * scale) * 0.5 - minX * scale, y: padding + (height - padding * 2 - (maxY - minY) * scale) * 0.5 - minY * scale };
}

export function sampleCurveDistance(geometry, point) {
  let last = geometry.start;
  let best = Infinity;
  for (let i = 1; i <= 20; i += 1) {
    const next = cubicPoint(geometry.start, geometry.cp1, geometry.cp2, geometry.end, i / 20);
    const vx = next.x - last.x, vy = next.y - last.y, wx = point.x - last.x, wy = point.y - last.y;
    const t = clamp((wx * vx + wy * vy) / ((vx * vx + vy * vy) || 1), 0, 1);
    best = Math.min(best, Math.hypot(point.x - (last.x + vx * t), point.y - (last.y + vy * t)));
    last = next;
  }
  return best;
}

export function drawArrowHead(c, tip, tangent, color, alpha = 1) {
  const norm = Math.hypot(tangent.x, tangent.y) || 1;
  const ux = tangent.x / norm, uy = tangent.y / norm;
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(tip.x, tip.y);
  c.lineTo(tip.x - ux * 8 - uy * 4, tip.y - uy * 8 + ux * 4);
  c.lineTo(tip.x - ux * 8 + uy * 4, tip.y - uy * 8 - ux * 4);
  c.closePath();
  c.fill();
  c.restore();
}

export function drawEditorGrid(c, width, height, view) {
  const spacing = 40;
  c.save();
  c.fillStyle = document.documentElement.dataset.theme === "light" ? "rgba(137,120,104,0.14)" : "rgba(232,213,176,0.08)";
  for (let x = Math.floor((-view.x / view.scale) / spacing) * spacing; x <= (width - view.x) / view.scale; x += spacing) {
    for (let y = Math.floor((-view.y / view.scale) / spacing) * spacing; y <= (height - view.y) / view.scale; y += spacing) {
      c.beginPath(); c.arc(x, y, 1.1, 0, TAU); c.fill();
    }
  }
  c.restore();
}

export function drawCircuitScene(c, width, height, palette, graph, evaluation, sensorEnabled, sensorModes, noiseFrequency, view, options = {}) {
  const { showGrid = false, showBorder = true, showPorts = false, showAddButtons = false, showEdgeLabels = false, hoverNodeId = null, dragPreview = null, time = 0 } = options;
  c.fillStyle = palette["surface-2"];
  c.fillRect(0, 0, width, height);
  if (showBorder) { c.strokeStyle = "rgba(74,58,40,0.75)"; c.lineWidth = 1; c.strokeRect(0.5, 0.5, width - 1, height - 1); }
  c.save(); c.translate(view.x, view.y); c.scale(view.scale, view.scale); if (showGrid) drawEditorGrid(c, width, height, view);
  const nodeSignals = evaluation?.nodeSignals ?? {}, edgeSignals = evaluation?.edgeSignals ?? {}, motorLevels = evaluation?.motorLevels ?? { leftLeg: 0, rightLeg: 0 };
  [...graph.edges.values()].forEach((edge, index) => {
    const geometry = graph.edgeGeometry(edge);
    if (!geometry) return;
    const active = graph.isEdgeActive(edge, sensorEnabled), forward = !geometry.feedback;
    const color = !active ? palette["border-2"] : geometry.feedback ? (edge.excitatory ? palette.mint : palette.red) : (edge.excitatory ? palette.amber : palette.red);
    const alpha = !active ? 0.35 : (geometry.feedback && !edge.excitatory ? 0.65 : 1);
    const signal = Math.abs(edgeSignals[edge.id] ?? nodeSignals[edge.fromId] ?? 0);
    c.save();
    c.globalAlpha = alpha;
    c.strokeStyle = color;
    c.lineWidth = geometry.feedback ? 1.2 : 1.5;
    c.setLineDash(edge.excitatory ? [] : [6, 4]);
    if (active && signal > 0.1) {
      c.shadowBlur = 4 + signal * 7;
      c.shadowColor = color;
    }
    c.beginPath(); c.moveTo(geometry.start.x, geometry.start.y); c.bezierCurveTo(geometry.cp1.x, geometry.cp1.y, geometry.cp2.x, geometry.cp2.y, geometry.end.x, geometry.end.y); c.stroke();
    c.setLineDash([]); c.restore();
    drawArrowHead(c, geometry.end, cubicTangent(geometry.start, geometry.cp1, geometry.cp2, geometry.end, 0.96), color, alpha);
    if (active && signal > 0.02) {
      const point = cubicPoint(geometry.start, geometry.cp1, geometry.cp2, geometry.end, ((time * 0.00016) + index * 0.17) % 1);
      c.beginPath(); c.arc(point.x, point.y, 2.2 + signal * 1.8, 0, TAU);
      c.fillStyle = forward ? (edge.excitatory ? `rgba(196,133,58,${(0.24 + signal * 0.48).toFixed(3)})` : `rgba(196,106,90,${(0.24 + signal * 0.48).toFixed(3)})`) : (edge.excitatory ? `rgba(122,184,160,${(0.22 + signal * 0.44).toFixed(3)})` : `rgba(196,106,90,${(0.18 + signal * 0.38).toFixed(3)})`);
      c.fill();
    }
    if (!showEdgeLabels) return;
    c.beginPath(); c.arc(geometry.label.x, geometry.label.y, 8, 0, TAU); c.fillStyle = palette.surface; c.fill(); c.strokeStyle = color; c.lineWidth = 1.2; c.stroke();
    c.fillStyle = color; c.font = '600 10px "IBM Plex Mono", monospace'; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(edge.excitatory ? "＋" : "－", geometry.label.x, geometry.label.y + 0.5);
  });
  if (dragPreview) { c.save(); c.setLineDash([7, 5]); c.strokeStyle = palette["text-faint"]; c.lineWidth = 1.2; c.beginPath(); c.moveTo(dragPreview.start.x, dragPreview.start.y); c.lineTo(dragPreview.end.x, dragPreview.end.y); c.stroke(); c.restore(); }
  for (const node of graph.nodes.values()) {
    const active = graph.isNodeActive(node, sensorEnabled);
    const color = graphKindColor(node.kind, palette);
    const strength = Math.abs(node.type === "motor" ? (motorLevels[node.sourceId] ?? 0) : (nodeSignals[node.id] ?? 0));
    const rect = nodeRect(node);
    c.save();
    c.globalAlpha = active ? 1 : 0.42;
    roundedRectPath(c, rect.x, rect.y, rect.width, rect.height, GRAPH_LAYOUT.nodeRadius);
    c.fillStyle = node.kind === "inter" ? palette["surface-2"] : node.kind === "food" ? `rgba(122,184,160,${(0.12 + strength * 0.36).toFixed(3)})` : node.kind === "threat" ? `rgba(196,106,90,${(0.12 + strength * 0.36).toFixed(3)})` : node.kind === "proprio" ? `rgba(160,128,96,${(0.12 + strength * 0.32).toFixed(3)})` : `rgba(196,133,58,${(0.12 + strength * 0.36).toFixed(3)})`;
    c.fill();
    if (active && strength > 0.1) {
      c.shadowBlur = 6 + strength * 8;
      c.shadowColor = color;
      c.globalAlpha = Math.min(0.85, 0.4 + strength * 0.5);
    }
    c.strokeStyle = color; c.lineWidth = 1.35;
    roundedRectPath(c, rect.x, rect.y, rect.width, rect.height, GRAPH_LAYOUT.nodeRadius);
    c.stroke();
    c.restore();
    if (showPorts && nodeHasInput(node)) { const input = nodePort(node, "in"); c.beginPath(); c.arc(input.x, input.y, GRAPH_LAYOUT.portRadius, 0, TAU); c.fillStyle = color; c.fill(); }
    if (showPorts && nodeHasOutput(node)) { const output = nodePort(node, "out"); c.beginPath(); c.arc(output.x, output.y, GRAPH_LAYOUT.portRadius, 0, TAU); c.fillStyle = color; c.fill(); }
    c.fillStyle = palette.text; c.font = '500 10px "IBM Plex Mono", monospace'; c.textAlign = "center"; c.textBaseline = "middle";
    c.globalAlpha = active ? 1 : 0.42;
    c.fillText(graphNodeLabel(node, sensorModes), node.x, node.y);
    if (active) {
      const signalVal = nodeSignals[node.id] ?? 0;
      c.fillStyle = color;
      c.font = '500 9px "IBM Plex Mono", monospace';
      c.textAlign = "right";
      c.textBaseline = "bottom";
      c.fillText(signalVal.toFixed(2), rect.x + rect.width - 4, rect.y + rect.height - 2);
    }
    c.globalAlpha = 1;
    if (node.sourceId === "N_noise") { c.fillStyle = palette.amber; c.font = '500 9px "IBM Plex Mono", monospace'; c.textAlign = "center"; c.textBaseline = "top"; c.fillText(`${noiseFrequency.toFixed(1)}Hz`, node.x, rect.y + rect.height + 2); }
    if (showAddButtons && hoverNodeId === node.id && nodeHasOutput(node)) { const plus = plusButtonPoint(node); c.beginPath(); c.arc(plus.x, plus.y, 8, 0, TAU); c.fillStyle = palette.surface; c.fill(); c.strokeStyle = palette["border-2"]; c.lineWidth = 1; c.stroke(); c.fillStyle = palette.text; c.font = '600 11px "IBM Plex Mono", monospace'; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("+", plus.x, plus.y + 0.5); }
  }
  c.restore();
}

export class GraphRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.refreshTheme();
    this.resize();
  }

  refreshTheme() {
    this.palette = readThemeVars(["surface", "surface-2", "border", "border-2", "text", "text-soft", "text-faint", "amber", "mint", "red", "brown"]);
  }

  resize() {
    const { ratio } = fitCanvas(this.canvas);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
  }

  render(time, graph, evaluation, sensorEnabled, sensorModes, noiseFrequency) {
    drawCircuitScene(this.ctx, this.width, this.height, this.palette, graph, evaluation, sensorEnabled, sensorModes, noiseFrequency, fitGraphView(graph, this.width, this.height, 20), { time, showBorder: true });
  }
}
