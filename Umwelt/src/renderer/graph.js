import { GRAPH_LAYOUT, MOTOR_NAMES, SENSOR_BY_ID, SOURCE_BY_ID, sourceDisplayName } from "../config.js";
import { fitCanvas, readThemeVars, TAU, clamp } from "../math.js";
import { nodeHasInput, nodeHasOutput, nodePort, nodeRect } from "../neural.js";

const FALLBACK_BLUE = "#6f97d8";

// ── group & highlight helpers ──

const GROUP_DEFS = {
  chemical:      { title: "化学感受", rgb: "122,184,160" },
  mechanical:    { title: "机械感受", rgb: "90,154,196" },
  environmental: { title: "环境感受", rgb: "160,140,96" },
  proprio:       { title: "本体感受", rgb: "160,128,96" },
  motor:         { title: "动作输出", rgb: "212,168,90" }
};

export const KIND_TO_GROUP = {
  // Ant sensor kinds
  chem_A: "chemical", chem_B: "chemical", chem_C: "chemical", chem_D: "chemical",
  taste: "chemical",
  touch: "mechanical",
  light: "environmental",
  interoceptive: "proprio", nociceptive: "proprio",
  // Legacy nematode kinds — kept so the sealed nematode definition still
  // renders if reused for reference.
  food: "chemical", threat: "chemical", temp: "chemical", contact: "chemical",
  mech: "mechanical",
  gas: "environmental",
  proprio: "proprio",
};

export function nodeGroupKey(node) {
  const nt = node?.neuronType ?? node?.type;
  if (nt === "motor") return "motor";
  if (nt === "sensor_on") return KIND_TO_GROUP[node.kind] ?? "chemical";
  return null;
}

export function computeGroupBoxes(graph) {
  const bins = {};
  for (const key of Object.keys(GROUP_DEFS)) bins[key] = [];
  for (const node of graph.nodes.values()) {
    const key = nodeGroupKey(node);
    if (key && bins[key]) bins[key].push(node);
  }
  const result = {};
  const pad = 14;
  const hdrH = 24;
  for (const [key, nodes] of Object.entries(bins)) {
    if (!nodes.length) continue;
    const def = GROUP_DEFS[key];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      const r = nodeRect(node);
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    result[key] = {
      ...def,
      nodeIds: new Set(nodes.map(n => n.id)),
      rect: { x: minX - pad, y: minY - pad - hdrH, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 + hdrH },
      headerH: hdrH,
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      count: nodes.length
    };
  }
  return result;
}

function computeHighlight(graph, hoverNodeId, hoverEdgeId) {
  const nodes = new Set();
  const edges = new Set();
  if (hoverNodeId) {
    nodes.add(hoverNodeId);
    for (const edge of graph.edges.values()) {
      if (edge.fromId === hoverNodeId || edge.toId === hoverNodeId) {
        edges.add(edge.id);
        nodes.add(edge.fromId);
        nodes.add(edge.toId);
      }
    }
  }
  if (hoverEdgeId) {
    const edge = graph.edges.get(hoverEdgeId);
    if (edge) {
      edges.add(edge.id);
      nodes.add(edge.fromId);
      nodes.add(edge.toId);
    }
  }
  return { nodes, edges, active: nodes.size > 0 };
}

function collapsedPort(box, side) {
  const cy = box.rect.y + box.headerH * 0.5;
  return side === "out"
    ? { x: box.rect.x + box.rect.w, y: cy }
    : { x: box.rect.x, y: cy };
}

function makeEdgeGeometry(start, end) {
  const feedback = start.x >= end.x - 8;
  if (feedback) {
    const bend = Math.max(92, Math.abs(end.x - start.x) * 0.28 + Math.abs(end.y - start.y) * 0.4 + 76);
    const cp1 = { x: start.x + 60, y: start.y + bend };
    const cp2 = { x: end.x - 60, y: end.y + bend };
    return { start, cp1, cp2, end, label: { x: cp1.x + (cp2.x - cp1.x) * 0.55, y: cp1.y + (cp2.y - cp1.y) * 0.55 }, feedback };
  }
  const cp1 = { x: start.x + 60, y: start.y };
  const cp2 = { x: end.x - 60, y: end.y };
  return { start, cp1, cp2, end, label: { x: cp1.x + (cp2.x - cp1.x) * 0.5, y: cp1.y + (cp2.y - cp1.y) * 0.5 }, feedback };
}

export function resolveEdgeGeometry(graph, edge, groupBoxes, collapsed) {
  const fromNode = graph.nodes.get(edge.fromId);
  const toNode = graph.nodes.get(edge.toId);
  if (!fromNode || !toNode) return null;
  const fromKey = nodeGroupKey(fromNode);
  const toKey = nodeGroupKey(toNode);
  const fromHidden = fromKey && collapsed[fromKey] && groupBoxes[fromKey];
  const toHidden = toKey && collapsed[toKey] && groupBoxes[toKey];
  if (!fromHidden && !toHidden) return graph.edgeGeometry(edge);
  const start = fromHidden ? collapsedPort(groupBoxes[fromKey], "out") : nodePort(fromNode, "out");
  const end = toHidden ? collapsedPort(groupBoxes[toKey], "in") : nodePort(toNode, "in");
  return makeEdgeGeometry(start, end);
}

function nodeTypeOf(node) {
  return node?.neuronType ?? node?.type;
}

function isSensorType(type) {
  return type === "sensor_on";
}

function isInhibitoryType(type) {
  return type === "inter_inh";
}

function blueOf(palette) {
  return palette.blue || FALLBACK_BLUE;
}

export function graphNodeLabel(node, sensorModes = {}, groupMode = false) {
  const neuronType = nodeTypeOf(node);
  if (neuronType === "motor") {
    return groupMode ? (MOTOR_NAMES[node.sourceId] ?? node.label) : node.label;
  }
  if (!isSensorType(neuronType)) return node.label;
  const source = SOURCE_BY_ID[node.sourceId];
  if (!source) return node.label;
  if (groupMode) {
    return source.kind === "proprio" ? source.name.replace("传感器", "") : source.name;
  }
  return sourceDisplayName(source);
}

export function graphKindColor(kind, palette) {
  if (kind === "chem_A" || kind === "food" || kind === "sensor_on") return palette.mint;
  if (kind === "chem_D" || kind === "threat" || kind === "inter_inh") return palette.red;
  if (kind === "chem_B" || kind === "chem_C") return "#c4b56a";
  if (kind === "touch" || kind === "mech") return "#5a9ac4";
  if (kind === "taste") return "#b890a0";
  if (kind === "light") return "#d0ccc0";
  if (kind === "interoceptive" || kind === "nociceptive" || kind === "proprio" || kind === "modulator") return palette.brown;
  if (kind === "inter_exc") return palette.amber;
  if (kind === "motor") return "#d4a85a";
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
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const rect = nodeRect(node);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  const scale = clamp(Math.min((width - padding * 2) / Math.max(1, maxX - minX), (height - padding * 2) / Math.max(1, maxY - minY)), 0.4, 1.4);
  return {
    scale,
    x: padding + (width - padding * 2 - (maxX - minX) * scale) * 0.5 - minX * scale,
    y: padding + (height - padding * 2 - (maxY - minY) * scale) * 0.5 - minY * scale
  };
}

export function sampleCurveDistance(geometry, point) {
  let last = geometry.start;
  let best = Infinity;
  for (let i = 1; i <= 20; i += 1) {
    const next = cubicPoint(geometry.start, geometry.cp1, geometry.cp2, geometry.end, i / 20);
    const vx = next.x - last.x;
    const vy = next.y - last.y;
    const wx = point.x - last.x;
    const wy = point.y - last.y;
    const t = clamp((wx * vx + wy * vy) / ((vx * vx + vy * vy) || 1), 0, 1);
    best = Math.min(best, Math.hypot(point.x - (last.x + vx * t), point.y - (last.y + vy * t)));
    last = next;
  }
  return best;
}

export function drawArrowHead(c, tip, tangent, color, alpha = 1) {
  const norm = Math.hypot(tangent.x, tangent.y) || 1;
  const ux = tangent.x / norm;
  const uy = tangent.y / norm;
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
      c.beginPath();
      c.arc(x, y, 1.1, 0, TAU);
      c.fill();
    }
  }
  c.restore();
}

function effectiveEdgeWeight(edge) {
  if (edge.plastic && Number.isFinite(edge.w)) return edge.w;
  return edge.weight ?? 1;
}

function edgeStyle(fromNode, edge, palette) {
  if (!fromNode) return { color: palette["border-2"], alpha: 0.35, lineWidth: 1.2 };
  const weight = clamp(effectiveEdgeWeight(edge), 0, 1);
  const neuronType = nodeTypeOf(fromNode);
  return {
    color: graphKindColor(isSensorType(neuronType) ? fromNode.kind : neuronType, palette),
    alpha: neuronType === "modulator" ? 0.95 : 1,
    lineWidth: 0.9 + weight * 2.1
  };
}

function nodeFill(node, strength, palette) {
  const kind = isSensorType(nodeTypeOf(node)) ? node.kind : nodeTypeOf(node);
  if (kind === "chem_A" || kind === "food" || kind === "sensor_on") return `rgba(122,184,160,${(0.1 + strength * 0.32).toFixed(3)})`;
  if (kind === "chem_D" || kind === "threat" || kind === "inter_inh") return `rgba(196,106,90,${(0.08 + strength * 0.26).toFixed(3)})`;
  if (kind === "chem_B" || kind === "chem_C") return `rgba(196,181,106,${(0.08 + strength * 0.26).toFixed(3)})`;
  if (kind === "touch" || kind === "mech") return `rgba(90,154,196,${(0.08 + strength * 0.26).toFixed(3)})`;
  if (kind === "taste") return `rgba(184,144,160,${(0.08 + strength * 0.26).toFixed(3)})`;
  if (kind === "light") return `rgba(208,204,192,${(0.08 + strength * 0.26).toFixed(3)})`;
  if (kind === "interoceptive" || kind === "nociceptive" || kind === "proprio" || kind === "modulator") return `rgba(160,128,96,${(0.08 + strength * 0.26).toFixed(3)})`;
  if (kind === "inter_exc") return `rgba(196,133,58,${(0.08 + strength * 0.26).toFixed(3)})`;
  if (kind === "motor") return `rgba(212,168,90,${(0.06 + strength * 0.18).toFixed(3)})`;
  return palette["surface-2"];
}

export function drawCircuitScene(c, width, height, palette, graph, evaluation, sensorEnabled, sensorModes, view, options = {}) {
  const { showGrid = false, showBorder = true, showPorts = false, showEdgeLabels = false, hoverNodeId = null, hoverEdgeId = null, dragPreview = null, time = 0, collapsedGroups = null } = options;
  c.fillStyle = palette["surface-2"];
  c.fillRect(0, 0, width, height);
  if (showBorder) {
    c.strokeStyle = "rgba(74,58,40,0.75)";
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, width - 1, height - 1);
  }

  c.save();
  c.translate(view.x, view.y);
  c.scale(view.scale, view.scale);
  if (showGrid) drawEditorGrid(c, width, height, view);

  const nodeSignals = evaluation?.nodeSignals ?? {};
  const edgeSignals = evaluation?.edgeSignals ?? {};
  const motorLevels = evaluation?.motorLevels ?? { motor_forward: 0, motor_turn_L: 0, motor_turn_R: 0, gland_alpha: 0, gland_beta: 0, mandible: 0 };

  const groupMode = collapsedGroups !== null;
  const collapsed = collapsedGroups ?? {};
  const groupBoxes = groupMode ? computeGroupBoxes(graph) : null;
  const hl = (hoverNodeId || hoverEdgeId) ? computeHighlight(graph, hoverNodeId, hoverEdgeId) : null;
  const hiddenNodes = new Set();
  if (groupBoxes) for (const [key, box] of Object.entries(groupBoxes)) if (collapsed[key]) for (const id of box.nodeIds) hiddenNodes.add(id);

  if (groupBoxes) {
    for (const [key, box] of Object.entries(groupBoxes)) {
      const isCollapsed = Boolean(collapsed[key]);
      const r = box.rect;
      const drawH = isCollapsed ? box.headerH + 6 : r.h;
      const rgb = box.rgb;
      roundedRectPath(c, r.x, r.y, r.w, drawH, 8);
      c.fillStyle = `rgba(${rgb},0.04)`;
      c.fill();
      c.strokeStyle = `rgba(${rgb},${isCollapsed ? 0.45 : 0.3})`;
      c.lineWidth = 1.2;
      roundedRectPath(c, r.x, r.y, r.w, drawH, 8);
      c.stroke();
      c.fillStyle = `rgba(${rgb},0.85)`;
      c.font = '500 10px "IBM Plex Sans", "Microsoft YaHei", "PingFang SC", sans-serif';
      c.textAlign = "left";
      c.textBaseline = "middle";
      c.fillText(`${isCollapsed ? "▸" : "▾"} ${box.title} (${box.count})`, r.x + 8, r.y + box.headerH * 0.5);
    }
  }

  [...graph.edges.values()].forEach((edge, index) => {
    const fromNode = graph.nodes.get(edge.fromId);
    const toNode = graph.nodes.get(edge.toId);
    if (!fromNode || !toNode) return;
    const geometry = (hiddenNodes.has(edge.fromId) || hiddenNodes.has(edge.toId))
      ? resolveEdgeGeometry(graph, edge, groupBoxes, collapsed)
      : graph.edgeGeometry(edge);
    if (!geometry) return;
    const active = graph.isEdgeActive(edge, sensorEnabled);
    const style = edgeStyle(fromNode, edge, palette);
    const signal = Math.abs(edgeSignals[edge.id] ?? nodeSignals[edge.fromId] ?? 0);
    const dimmed = hl?.active && !hl.edges.has(edge.id);
    const signalAlpha = active ? clamp(0.18 + signal * 1.4, 0.18, 1) : 0.18;
    c.save();
    c.globalAlpha = dimmed ? 0.1 : signalAlpha * style.alpha;
    c.strokeStyle = active ? style.color : palette["border-2"];
    c.lineWidth = active
      ? (geometry.feedback ? style.lineWidth * 0.9 : style.lineWidth * clamp(0.55 + signal * 0.9, 0.55, 1.5))
      : style.lineWidth * 0.6;
    if (edge.plastic) {
      // Dash length scaled with lineWidth so it stays readable at
      // very-low and very-high effective weights.
      const dashLen = Math.max(4, c.lineWidth * 2.4);
      c.setLineDash([dashLen, Math.max(3, c.lineWidth * 1.6)]);
    }
    if (active && signal > 0.06 && !dimmed) {
      c.shadowBlur = 4 + signal * 10;
      c.shadowColor = style.color;
    }
    c.beginPath();
    c.moveTo(geometry.start.x, geometry.start.y);
    c.bezierCurveTo(geometry.cp1.x, geometry.cp1.y, geometry.cp2.x, geometry.cp2.y, geometry.end.x, geometry.end.y);
    c.stroke();
    c.restore();

    drawArrowHead(c, geometry.end, cubicTangent(geometry.start, geometry.cp1, geometry.cp2, geometry.end, 0.96), active ? style.color : palette["border-2"], dimmed ? 0.1 : signalAlpha * style.alpha);

    if (active && signal > 0.02 && !dimmed) {
      const pt = cubicPoint(geometry.start, geometry.cp1, geometry.cp2, geometry.end, ((time * 0.00016) + index * 0.17) % 1);
      c.beginPath();
      c.arc(pt.x, pt.y, 1.8 + signal * 2.1, 0, TAU);
      const ek = isSensorType(nodeTypeOf(fromNode)) ? fromNode.kind : nodeTypeOf(fromNode);
      c.fillStyle = ek === "modulator" || ek === "proprio" || ek === "interoceptive" || ek === "nociceptive"
        ? `rgba(160,128,96,${(0.22 + signal * 0.4).toFixed(3)})`
        : ek === "inter_inh" || ek === "threat" || ek === "chem_D"
          ? `rgba(196,106,90,${(0.2 + signal * 0.44).toFixed(3)})`
          : `rgba(196,133,58,${(0.2 + signal * 0.46).toFixed(3)})`;
      c.fill();
    }

    if (!showEdgeLabels || dimmed) return;
    const displayWeight = effectiveEdgeWeight(edge);
    const learned = edge.plastic && Math.abs(displayWeight - (edge.weight ?? 0)) > 0.05;
    const ringColor = learned ? (palette.amber ?? "#d4a85a") : (active ? style.color : palette["border-2"]);
    c.beginPath();
    c.arc(geometry.label.x, geometry.label.y, 13, 0, TAU);
    c.fillStyle = palette.surface;
    c.fill();
    if (learned) {
      // Faint amber wash layered over the surface fill — Canvas 2D accepts
      // rgba() everywhere, unlike color-mix() which needs modern browsers.
      c.fillStyle = "rgba(212,168,90,0.16)";
      c.fill();
    }
    c.strokeStyle = ringColor;
    c.lineWidth = learned ? 1.4 : 1.1;
    c.stroke();
    c.fillStyle = learned ? ringColor : (active ? style.color : palette["text-faint"]);
    c.font = '600 9px "IBM Plex Mono", "Microsoft YaHei", "PingFang SC", monospace';
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(`${displayWeight.toFixed(2)}x`, geometry.label.x, geometry.label.y + 0.5);
  });

  // Plastic-edge modulator hints: a faint line from the bound modulator's
  // out-port to the edge's label midpoint, so the player can read which
  // modulator is gating each plastic synapse at a glance. Drawn after
  // edges so the hint goes on top of underlying strokes.
  for (const edge of graph.edges.values()) {
    if (!edge.plastic || !edge.mod_source_id) continue;
    const modNode = graph.nodes.get(edge.mod_source_id);
    if (!modNode || hiddenNodes.has(modNode.id)) continue;
    const fromNode = graph.nodes.get(edge.fromId);
    const toNode = graph.nodes.get(edge.toId);
    if (!fromNode || !toNode) continue;
    if (hiddenNodes.has(edge.fromId) || hiddenNodes.has(edge.toId)) continue;
    const geometry = graph.edgeGeometry(edge);
    if (!geometry) continue;
    const start = nodePort(modNode, "out");
    const end = geometry.label;
    c.save();
    c.globalAlpha = 0.22;
    c.strokeStyle = palette.amber ?? "#d4a85a";
    c.lineWidth = 0.7;
    c.setLineDash([3, 4]);
    c.beginPath();
    c.moveTo(start.x, start.y);
    c.lineTo(end.x, end.y);
    c.stroke();
    c.restore();
  }

  if (dragPreview) {
    c.save();
    c.setLineDash([7, 5]);
    c.strokeStyle = palette["text-faint"];
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(dragPreview.start.x, dragPreview.start.y);
    c.lineTo(dragPreview.end.x, dragPreview.end.y);
    c.stroke();
    c.restore();
  }

  // ── group titles (non-editor mode only; editor draws containers above) ──
  if (!groupBoxes) {
    const drawnGroups = new Set();
    for (const node of graph.nodes.values()) {
      const groupKey = nodeGroupKey(node);
      if (!groupKey || !GROUP_DEFS[groupKey] || drawnGroups.has(groupKey)) continue;
      drawnGroups.add(groupKey);
      const rect = nodeRect(node);
      c.fillStyle = palette["text-faint"];
      c.font = '500 10px "IBM Plex Sans", "Microsoft YaHei", "PingFang SC", sans-serif';
      c.textAlign = "left";
      c.textBaseline = "bottom";
      c.fillText(GROUP_DEFS[groupKey].title, rect.x, rect.y - 6);
    }
  }

  for (const node of graph.nodes.values()) {
    if (hiddenNodes.has(node.id)) continue;
    const active = graph.isNodeActive(node, sensorEnabled);
    const neuronType = nodeTypeOf(node);
    const colorKey = isSensorType(neuronType) ? node.kind : neuronType;
    const color = graphKindColor(colorKey ?? node.kind, palette);
    const strength = Math.abs(neuronType === "motor" ? (motorLevels[node.sourceId] ?? 0) : (nodeSignals[node.id] ?? 0));
    const rect = nodeRect(node);
    const dimmed = hl?.active && !hl.nodes.has(node.id);
    c.save();
    c.globalAlpha = dimmed ? 0.12 : (active ? 1 : 0.42);
    roundedRectPath(c, rect.x, rect.y, rect.width, rect.height, GRAPH_LAYOUT.nodeRadius);
    c.fillStyle = nodeFill(node, strength, palette);
    c.fill();
    if (active && strength > 0.05 && !dimmed) {
      c.shadowBlur = 6 + strength * 14;
      c.shadowColor = color;
      c.globalAlpha = clamp(0.35 + strength * 0.6, 0.35, 0.9);
    }
    c.strokeStyle = color;
    c.lineWidth = (neuronType === "motor" ? 1.6 : 1.35) + (active && !dimmed ? strength * 0.8 : 0);
    roundedRectPath(c, rect.x, rect.y, rect.width, rect.height, GRAPH_LAYOUT.nodeRadius);
    c.stroke();
    c.restore();

    if (dimmed) continue;

    if (showPorts && nodeHasInput(node)) {
      const input = nodePort(node, "in");
      c.beginPath();
      c.arc(input.x, input.y, GRAPH_LAYOUT.portRadius, 0, TAU);
      c.fillStyle = color;
      c.fill();
    }
    if (showPorts && nodeHasOutput(node)) {
      const output = nodePort(node, "out");
      c.beginPath();
      c.arc(output.x, output.y, GRAPH_LAYOUT.portRadius, 0, TAU);
      c.fillStyle = color;
      c.fill();
    }

    c.fillStyle = palette.text;
    c.font = '500 10px "IBM Plex Mono", "Microsoft YaHei", "PingFang SC", monospace';
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.globalAlpha = active ? 1 : 0.42;
    c.fillText(graphNodeLabel(node, sensorModes, groupMode), node.x, node.y);

    if (active) {
      const signalVal = neuronType === "motor" ? (motorLevels[node.sourceId] ?? 0) : (nodeSignals[node.id] ?? 0);
      c.fillStyle = color;
      c.font = '500 9px "IBM Plex Mono", "Microsoft YaHei", "PingFang SC", monospace';
      c.textAlign = "right";
      c.textBaseline = "bottom";
      c.fillText(signalVal.toFixed(2), rect.x + rect.width - 4, rect.y + rect.height - 2);
    }

    c.globalAlpha = 1;
    if (node.tau && neuronType !== "motor" && !isSensorType(neuronType)) {
      c.fillStyle = palette["text-faint"];
      c.font = '500 8px "IBM Plex Mono", "Microsoft YaHei", "PingFang SC", monospace';
      c.textAlign = "left";
      c.textBaseline = "bottom";
      c.fillText(`tau ${node.tau.toFixed(1)}s`, rect.x + 4, rect.y + rect.height - 2);
    }
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
    this.palette = readThemeVars(["surface", "surface-2", "border", "border-2", "text", "text-soft", "text-faint", "amber", "mint", "red", "brown", "blue"]);
  }

  resize() {
    const { ratio } = fitCanvas(this.canvas);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
  }

  render(time, graph, evaluation, sensorEnabled) {
    drawCircuitScene(this.ctx, this.width, this.height, this.palette, graph, evaluation, sensorEnabled, {}, fitGraphView(graph, this.width, this.height, 20), { time, showBorder: true });
  }
}
