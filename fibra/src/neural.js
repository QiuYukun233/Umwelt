import {
  BEHAVIOR_PRESETS,
  CONNECTION_META,
  CONNECTION_ORDER,
  DEFAULT_CONNECTIONS,
  DEFAULT_SENSOR_ENABLED,
  GRAPH_LAYOUT,
  MOTOR_IDS,
  SOURCE_BY_ID,
  SOURCE_DEFINITIONS,
  SENSOR_DEFINITIONS,
  makeConnectionId,
  motorNodeId,
  sourceDisplayName,
  sourceNodeId
} from "./config.js";
import { clamp, lerp } from "./math.js";

// ── Inter-node dynamics constants (Matsuoka oscillator + PIR rebound) ──
const INTER_TAU = 1.5;                // membrane time constant (s)
const INTER_W = 2.0;                  // inhibitory synaptic weight multiplier
const ADAPT_TAU = 3.0;               // adaptation (fatigue) time constant (s), must be > INTER_TAU
const ADAPT_BETA = 2.0;              // adaptation strength (subtracts from state drive)
const REBOUND_G = 3.0;               // rebound conductance
const REBOUND_RATE = 0.8;            // h accumulation rate per unit inhibitory input per second
const REBOUND_TAU_DISCHARGE = 0.4;   // h decay time constant when not inhibited (s)
const REBOUND_MAX = 1.5;             // maximum h value
const REBOUND_THRESHOLD = 0.5;       // h charges only when state < this

export function cloneConnections(source = {}) {
  return Object.fromEntries(CONNECTION_ORDER.map((key) => [key, source[key] ?? 0]));
}

export function cloneSensorEnabled(source = {}) {
  return Object.fromEntries(SENSOR_DEFINITIONS.map((sensor) => [sensor.id, Boolean(source[sensor.id])]));
}

export function cloneSensorModes(source = {}) {
  return Object.fromEntries(SENSOR_DEFINITIONS.map((sensor) => [sensor.id, source[sensor.id] ?? "absolute"]));
}

export function inferBehavior(connections, sensorEnabled = DEFAULT_SENSOR_ENABLED) {
  const score = { sameExcite: 0, crossExcite: 0, sameInhibit: 0, crossInhibit: 0 };
  for (const sensor of SENSOR_DEFINITIONS) {
    if (sensor.kind !== "food" || sensor.side === "center" || !sensorEnabled[sensor.id]) continue;
    for (const target of MOTOR_IDS) {
      const state = connections[makeConnectionId(sensor.id, target)] ?? 0;
      if (!state) continue;
      const same = (sensor.side === "left" && target === "leftLeg") || (sensor.side === "right" && target === "rightLeg");
      if (state === 1) score[same ? "sameExcite" : "crossExcite"] += 1;
      if (state === -1) score[same ? "sameInhibit" : "crossInhibit"] += 1;
    }
  }
  const entries = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (!entries[0][1] || entries[0][1] === entries[1]?.[1]) return BEHAVIOR_PRESETS.custom;
  if (entries[0][0] === "sameExcite") return BEHAVIOR_PRESETS.approach;
  if (entries[0][0] === "crossExcite") return BEHAVIOR_PRESETS.chase;
  if (entries[0][0] === "sameInhibit") return BEHAVIOR_PRESETS.attach;
  if (entries[0][0] === "crossInhibit") return BEHAVIOR_PRESETS.avoid;
  return BEHAVIOR_PRESETS.custom;
}

export function describeConnections(connections) {
  const parts = CONNECTION_ORDER.filter((key) => connections[key]).map((key) => `${CONNECTION_META[key].label}${connections[key] > 0 ? "兴奋" : "抑制"}`);
  return parts.length ? parts.join(" / ") : "全部关闭";
}

export function nodeWidthFor(node) {
  return node.type === "motor" ? GRAPH_LAYOUT.motorWidth : GRAPH_LAYOUT.nodeWidth;
}

export function nodeRect(node) {
  const width = nodeWidthFor(node);
  return { x: node.x - width * 0.5, y: node.y - GRAPH_LAYOUT.nodeHeight * 0.5, width, height: GRAPH_LAYOUT.nodeHeight };
}

export function nodeHasInput(node) {
  return node.type !== "sensor";
}

export function nodeHasOutput(node) {
  return node.type !== "motor";
}

export function nodePort(node, side) {
  const rect = nodeRect(node);
  return { x: side === "in" ? rect.x : rect.x + rect.width, y: node.y };
}

export class NeuralGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.prevSignals = {};
    this.interDynamics = new Map(); // nodeId → { state, hRebound, adapt }
    this.nextInterIndex = 1;
    this.nextEdgeIndex = 1;
  }

  reset(width, height) {
    this.nodes.clear();
    this.edges.clear();
    this.prevSignals = {};
    this.interDynamics.clear();
    this.nextInterIndex = 1;
    this.nextEdgeIndex = 1;
    this.ensureAnchors(width, height, true);
    for (const edge of this.buildDefaultEdges()) this.addEdge(edge.fromId, edge.toId, edge.excitatory);
  }

  buildDefaultEdges() {
    return SOURCE_DEFINITIONS.flatMap((source) =>
      MOTOR_IDS.map((target) => ({ source, target, state: DEFAULT_CONNECTIONS[makeConnectionId(source.id, target)] ?? 0 }))
        .filter((entry) => entry.state)
        .map((entry) => ({ fromId: sourceNodeId(entry.source.id), toId: motorNodeId(entry.target), excitatory: entry.state === 1 }))
    );
  }

  ensureAnchors(width, height, forcePosition = false) {
    const top = 90;
    const bottom = Math.max(top, height - 90);
    SOURCE_DEFINITIONS.forEach((source, index) => {
      const id = sourceNodeId(source.id);
      const y = lerp(top, bottom, SOURCE_DEFINITIONS.length === 1 ? 0.5 : index / (SOURCE_DEFINITIONS.length - 1));
      this.upsertNode(id, { id, type: "sensor", sourceId: source.id, label: sourceDisplayName(source), kind: source.kind, x: GRAPH_LAYOUT.sensorX, y }, forcePosition);
    });
    this.upsertNode(motorNodeId("leftLeg"), { id: motorNodeId("leftLeg"), type: "motor", sourceId: "leftLeg", label: "左腿", kind: "motor", x: Math.max(GRAPH_LAYOUT.motorInset, width - GRAPH_LAYOUT.motorInset), y: height * 0.38 }, forcePosition);
    this.upsertNode(motorNodeId("rightLeg"), { id: motorNodeId("rightLeg"), type: "motor", sourceId: "rightLeg", label: "右腿", kind: "motor", x: Math.max(GRAPH_LAYOUT.motorInset, width - GRAPH_LAYOUT.motorInset), y: height * 0.62 }, forcePosition);
  }

  upsertNode(id, patch, forcePosition) {
    const current = this.nodes.get(id);
    if (!current) {
      this.nodes.set(id, { ...patch });
      return;
    }
    Object.assign(current, patch);
    if (!forcePosition) return;
    current.x = patch.x;
    current.y = patch.y;
  }

  addInterNode(x, y) {
    let px = x;
    let py = y;
    for (let guard = 0; guard < 20 && [...this.nodes.values()].some((node) => Math.hypot(node.x - px, node.y - py) < 44); guard += 1) {
      px += 18;
      py += 14;
    }
    const node = { id: `inter:${this.nextInterIndex}`, type: "inter", sourceId: null, label: `N${this.nextInterIndex}`, kind: "inter", x: px, y: py };
    this.nextInterIndex += 1;
    this.nodes.set(node.id, node);
    this.prevSignals[node.id] = 0;
    this.interDynamics.set(node.id, { state: 0, hRebound: 0, adapt: 0 });
    return node;
  }

  addEdge(fromId, toId, excitatory = true) {
    if (fromId === toId) return null;
    const fromNode = this.nodes.get(fromId);
    const toNode = this.nodes.get(toId);
    if (!fromNode || !toNode || !nodeHasOutput(fromNode) || !nodeHasInput(toNode)) return null;
    for (const edge of this.edges.values()) {
      if (edge.fromId === fromId && edge.toId === toId) return Object.assign(edge, { excitatory: Boolean(excitatory) });
    }
    const edge = { id: `edge:${this.nextEdgeIndex++}`, fromId, toId, excitatory: Boolean(excitatory) };
    this.edges.set(edge.id, edge);
    return edge;
  }

  removeEdge(edgeId) {
    this.edges.delete(edgeId);
  }

  removeNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node || node.type !== "inter") return;
    this.nodes.delete(nodeId);
    delete this.prevSignals[nodeId];
    this.interDynamics.delete(nodeId);
    for (const [edgeId, edge] of this.edges) if (edge.fromId === nodeId || edge.toId === nodeId) this.edges.delete(edgeId);
  }

  isNodeActive(node, sensorEnabled) {
    return node.type !== "sensor" || !node.sourceId.startsWith("F") && !node.sourceId.startsWith("T") || Boolean(sensorEnabled[node.sourceId]);
  }

  isEdgeActive(edge, sensorEnabled) {
    const fromNode = this.nodes.get(edge.fromId);
    return Boolean(fromNode) && this.isNodeActive(fromNode, sensorEnabled);
  }

  edgeGeometry(edge) {
    const fromNode = this.nodes.get(edge.fromId);
    const toNode = this.nodes.get(edge.toId);
    if (!fromNode || !toNode) return null;
    const start = nodePort(fromNode, "out");
    const end = nodePort(toNode, "in");
    const feedback = fromNode.x >= toNode.x - 8;
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

  computeSignals(sourceOutputs, sensorEnabled = {}, { commit = true, dt = 1 / 60 } = {}) {
    const previous = { ...this.prevSignals };
    const nodeSignals = {};
    const edgeSignals = {};
    for (const node of this.nodes.values()) if (node.type === "sensor") nodeSignals[node.id] = this.isNodeActive(node, sensorEnabled) ? (sourceOutputs[node.sourceId] ?? 0) : 0;
    const sorted = [...this.nodes.values()].filter((node) => node.type !== "sensor").sort((a, b) => a.x - b.x || a.y - b.y);
    for (const node of sorted) {
      let excitatorySum = 0;
      let inhibitorySum = 0;
      for (const edge of this.edges.values()) {
        if (edge.toId !== node.id) continue;
        const fromNode = this.nodes.get(edge.fromId);
        const sourceValue = fromNode && fromNode.x >= node.x - 8 ? (previous[edge.fromId] ?? 0) : (nodeSignals[edge.fromId] ?? 0);
        if (edge.excitatory) excitatorySum += sourceValue;
        else inhibitorySum += sourceValue;
        edgeSignals[edge.id] = Math.abs(nodeSignals[edge.fromId] ?? previous[edge.fromId] ?? 0);
      }
      if (node.type === "inter") {
        nodeSignals[node.id] = this._updateInterDynamics(node.id, excitatorySum, inhibitorySum, dt, commit);
      } else {
        nodeSignals[node.id] = excitatorySum - inhibitorySum;
      }
    }
    for (const edge of this.edges.values()) if (edgeSignals[edge.id] === undefined) edgeSignals[edge.id] = Math.abs(nodeSignals[edge.fromId] ?? previous[edge.fromId] ?? 0);
    if (commit) this.prevSignals = { ...nodeSignals };
    return { nodeSignals, edgeSignals };
  }

  /**
   * Matsuoka oscillator with post-inhibitory rebound (PIR) for a single inter node.
   *
   * State equation (Matsuoka form):
   *   τ · dx/dt = -x + (excitation - W·inhibition) - β·v + g·h
   *
   * Adaptation (fatigue):  τ_v · dv/dt = -v + y        where y = max(0, x)
   *
   * Rebound h:  accumulates proportionally to inhibitory input while state < threshold,
   *             decays exponentially otherwise.  Cumulative (not target-tracking) so h
   *             can exceed the instantaneous inhibitory signal — this is the key mechanism
   *             that lets rebound overcome sustained inhibition.
   */
  _updateInterDynamics(nodeId, excitatorySum, inhibitorySum, dt, commit) {
    let dyn = this.interDynamics.get(nodeId);
    if (!dyn) {
      dyn = { state: 0, hRebound: 0, adapt: 0 };
      this.interDynamics.set(nodeId, dyn);
    }

    const prevState = dyn.state;

    // ── rebound potential h (cumulative accumulation) ──
    let h = dyn.hRebound;
    if (prevState < REBOUND_THRESHOLD && inhibitorySum > 0) {
      h += inhibitorySum * REBOUND_RATE * dt;
    } else {
      h *= Math.exp(-dt / REBOUND_TAU_DISCHARGE);
    }
    h = clamp(h, 0, REBOUND_MAX);

    // ── Matsuoka state integration ──
    const drive = excitatorySum - INTER_W * inhibitorySum - ADAPT_BETA * dyn.adapt + REBOUND_G * h;
    let nextState = prevState + (-prevState + drive) * (dt / INTER_TAU);
    nextState = clamp(nextState, -1, 1);

    // ── adaptation (fatigue) ── tracks rectified output
    const output = Math.max(0, nextState);
    const nextAdapt = dyn.adapt + (-dyn.adapt + output) * (dt / ADAPT_TAU);

    if (commit) {
      dyn.state = nextState;
      dyn.hRebound = h;
      dyn.adapt = nextAdapt;
    }

    return output;
  }

  getMotorOutputs(nodeSignals) {
    return { leftLeg: nodeSignals[motorNodeId("leftLeg")] ?? 0, rightLeg: nodeSignals[motorNodeId("rightLeg")] ?? 0 };
  }

  toConnectionsObject() {
    const next = cloneConnections();
    for (const edge of this.edges.values()) {
      const fromNode = this.nodes.get(edge.fromId);
      const toNode = this.nodes.get(edge.toId);
      if (fromNode?.type === "sensor" && toNode?.type === "motor" && SOURCE_BY_ID[fromNode.sourceId]) next[makeConnectionId(fromNode.sourceId, toNode.sourceId)] = edge.excitatory ? 1 : -1;
    }
    return next;
  }

  serialize() {
    const interDyn = Object.fromEntries(this.interDynamics);
    return JSON.stringify({ nodes: [...this.nodes.values()], edges: [...this.edges.values()], prevSignals: this.prevSignals, interDynamics: interDyn, nextInterIndex: this.nextInterIndex, nextEdgeIndex: this.nextEdgeIndex });
  }

  deserialize(json) {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    this.nodes = new Map((data.nodes ?? []).map((node) => [node.id, node]));
    this.edges = new Map(
      (data.edges ?? []).map((edge) => {
        const normalized = { ...edge, fromId: edge.fromId ?? edge.from, toId: edge.toId ?? edge.to };
        delete normalized.from;
        delete normalized.to;
        return [normalized.id, normalized];
      })
    );
    this.prevSignals = { ...(data.prevSignals ?? {}) };
    this.interDynamics = new Map(Object.entries(data.interDynamics ?? {}).map(
      ([id, d]) => [id, { state: d.state ?? 0, hRebound: d.hRebound ?? 0, adapt: d.adapt ?? 0 }]
    ));
    this.nextInterIndex = data.nextInterIndex ?? 1;
    this.nextEdgeIndex = data.nextEdgeIndex ?? 1;
  }
}
