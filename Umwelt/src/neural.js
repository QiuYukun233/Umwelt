import {
  BEHAVIOR_PRESETS,
  CONNECTION_META,
  CONNECTION_ORDER,
  DEFAULT_SENSOR_ENABLED,
  GRAPH_LAYOUT,
  MOTOR_IDS,
  MOTOR_LABELS,
  NEURON_PREFIXES,
  SOURCE_BY_ID,
  SOURCE_DEFINITIONS,
  SENSOR_DEFINITIONS,
  makeConnectionId,
  motorNodeId,
  sourceDisplayName,
  sourceNodeId
} from "./config.js";
import { clamp, lerp } from "./math.js";
import { KIND_TO_GROUP } from "./renderer/graph.js";
import { LEARNING_RATE, WEIGHT_DECAY_RATE, DELAY_MS_MAX } from "./neural/constants.js";

const SENSOR_NODE_TYPES = new Set(["sensor_on"]);
const EDITABLE_NODE_TYPES = new Set(["inter_exc", "inter_inh", "modulator"]);
const INTER_NODE_TYPES = new Set(["inter_exc", "inter_inh"]);
const DEFAULT_TAU_BY_TYPE = {
  sensor_on: 0.5,
  inter_exc: 3.0,
  inter_inh: 3.0,
  modulator: 15.0,
  motor: 0
};
const MIN_TAU_BY_TYPE = {
  inter_exc: 0.5,
  inter_inh: 0.5,
  modulator: 0.5
};
const MAX_TAU_BY_TYPE = {
  inter_exc: 10.0,
  inter_inh: 10.0,
  modulator: 10.0
};
const EDGE_WEIGHT_MIN = 0.1;
const EDGE_WEIGHT_MAX = 1.0;
const EDGE_WEIGHT_STEPS = [0.1, 0.25, 0.5, 0.75, 1.0];
const MOD_GAIN_MIN = 0.1;
const MOD_GAIN_MAX = 3.0;
const MOD_GAIN_BASELINE = 1.0;
const MOD_GAIN_BASELINE_STATE = (MOD_GAIN_BASELINE - MOD_GAIN_MIN) / (MOD_GAIN_MAX - MOD_GAIN_MIN);
const DEFAULT_TAU_CHARGE = 4.0;
const DEFAULT_TAU_DISCHARGE = 10.0;
const DEFAULT_G_REBOUND = 7.0;
const DEFAULT_REBOUND_THRESHOLD = 0.5;
const DEFAULT_REBOUND_GATE_CENTER = -0.2;
const DEFAULT_REBOUND_GATE_SLOPE = 15;
const MAX_H_REBOUND = 1.5;
const ADAPT_SUBTRACT_SCALE = 0.6;
const NODE_LABEL_PREFIX = {
  sensor_on: "SON",
  inter_exc: NEURON_PREFIXES.inter_exc ?? "E",
  inter_inh: NEURON_PREFIXES.inter_inh ?? "I",
  modulator: NEURON_PREFIXES.modulator ?? "M",
  motor: "M"
};

function defaultTauForType(neuronType) {
  return DEFAULT_TAU_BY_TYPE[neuronType] ?? 1.0;
}

function defaultTauAdaptForNode(node) {
  return Math.max(0.05, (node?.tau ?? defaultTauForType(node?.neuronType ?? node?.type)) * 4);
}

function defaultTauChargeForNode(node) {
  return Math.max(0.05, Number.isFinite(node?.tau_charge) ? node.tau_charge : DEFAULT_TAU_CHARGE);
}

function defaultTauDischargeForNode(node) {
  return Math.max(0.05, Number.isFinite(node?.tau_discharge) ? node.tau_discharge : DEFAULT_TAU_DISCHARGE);
}

function defaultGReboundForNode(node) {
  return Math.max(0, Number.isFinite(node?.g_rebound) ? node.g_rebound : DEFAULT_G_REBOUND);
}

function defaultReboundThresholdForNode(node) {
  return Number.isFinite(node?.rebound_threshold) ? node.rebound_threshold : DEFAULT_REBOUND_THRESHOLD;
}

function defaultReboundGateCenterForNode(node) {
  return Number.isFinite(node?.rebound_gate_center) ? node.rebound_gate_center : DEFAULT_REBOUND_GATE_CENTER;
}

function defaultReboundGateSlopeForNode(node) {
  return Math.max(0.1, Number.isFinite(node?.rebound_gate_slope) ? node.rebound_gate_slope : DEFAULT_REBOUND_GATE_SLOPE);
}

function clampWeight(weight) {
  return clamp(Number.isFinite(weight) ? weight : 1, EDGE_WEIGHT_MIN, EDGE_WEIGHT_MAX);
}

// Plastic weights range [0, EDGE_WEIGHT_MAX]; unlike fixed edges they may
// fully decay to zero. Dale's Law sign (excitatory vs inhibitory) is applied
// downstream by the evaluator based on source node type, so the magnitude
// clamp is sign-agnostic. Kept as a separate helper so callers are explicit
// about which regime a weight lives under.
function clampToDaleLaw(weight) {
  return clamp(Number.isFinite(weight) ? weight : 0, 0, EDGE_WEIGHT_MAX);
}

// Axon conduction delay clamp. delay_ms ∈ [0, DELAY_MS_MAX]; absent or
// invalid → 0 (instant — the pre-v10 default).
function clampDelayMs(ms) {
  return clamp(Number.isFinite(ms) ? ms : 0, 0, DELAY_MS_MAX);
}

// Per-edge signal attenuation ∈ [0, 1]. Multiplies the transmitted signal
// in the evaluator, in the same lane as edge.weight. Absent or invalid →
// 1.0 (full passthrough — the pre-v11 default). HTML companion to the
// Bevy workshop's §7.4 distance → attenuation honest chain.
function clampAttenuation(a) {
  return clamp(Number.isFinite(a) ? a : 1, 0, 1);
}

function nextEdgeWeight(weight) {
  const current = clampWeight(weight);
  const index = EDGE_WEIGHT_STEPS.findIndex((step) => Math.abs(step - current) < 1e-6);
  return EDGE_WEIGHT_STEPS[(index + 1 + EDGE_WEIGHT_STEPS.length) % EDGE_WEIGHT_STEPS.length];
}

function clampTau(neuronType, tau) {
  const min = MIN_TAU_BY_TYPE[neuronType] ?? defaultTauForType(neuronType);
  const max = MAX_TAU_BY_TYPE[neuronType] ?? defaultTauForType(neuronType);
  return clamp(Number.isFinite(tau) ? tau : defaultTauForType(neuronType), min, max);
}

function neuronTypeForNode(node = {}) {
  if (node.neuronType) return node.neuronType;
  if (SENSOR_NODE_TYPES.has(node.type) || EDITABLE_NODE_TYPES.has(node.type) || node.type === "motor") return node.type;
  if (node.kind === "inter_inh" || node.kind === "modulator") return node.kind;
  if (node.type === "motor") return "motor";
  if (node.type === "sensor" || node.type === "sensor_off") return "sensor_on";
  if (node.type === "inter") return "inter_exc";
  return node.sourceId ? "sensor_on" : "inter_exc";
}

function initialStateForType(neuronType) {
  if (neuronType === "modulator") return MOD_GAIN_BASELINE_STATE;
  return 0;
}

function initialAdaptForType() {
  return 0;
}

function initialHReboundForType() {
  return 0;
}

function interEffectiveOutput(state) {
  return clamp(state, 0, 1);
}

function interFinalOutput(state, adapt) {
  const effectiveOutput = interEffectiveOutput(state);
  return clamp(effectiveOutput - adapt * ADAPT_SUBTRACT_SCALE, 0, 1);
}

function nodeOutputFromValues(node, state, adapt) {
  const neuronType = node?.neuronType ?? node?.type;
  if (INTER_NODE_TYPES.has(neuronType)) return interFinalOutput(state, adapt);
  return clamp(state, 0, 1);
}

function normalizeNode(node = {}) {
  const neuronType = neuronTypeForNode(node);
  return {
    ...node,
    neuronType,
    type: neuronType,
    tau: neuronType === "motor" || SENSOR_NODE_TYPES.has(neuronType) ? defaultTauForType(neuronType) : clampTau(neuronType, node.tau ?? node.t),
    state: clamp(node.state ?? initialStateForType(neuronType), neuronType === "inter_exc" || neuronType === "inter_inh" ? -1 : 0, 1),
    adapt: clamp(node.adapt ?? initialAdaptForType(neuronType), 0, 1),
    h_rebound: clamp(node.h_rebound ?? node.rebound ?? initialHReboundForType(neuronType), 0, MAX_H_REBOUND),
    tau_charge: defaultTauChargeForNode(node),
    tau_discharge: defaultTauDischargeForNode(node),
    g_rebound: defaultGReboundForNode(node),
    rebound_threshold: defaultReboundThresholdForNode(node),
    rebound_gate_center: defaultReboundGateCenterForNode(node),
    rebound_gate_slope: defaultReboundGateSlopeForNode(node)
  };
}

function isSensorNode(node) {
  return SENSOR_NODE_TYPES.has(node?.neuronType ?? node?.type);
}

function isEditableNode(node) {
  return EDITABLE_NODE_TYPES.has(node?.neuronType ?? node?.type);
}

function isInhibitoryOutput(node) {
  return (node?.neuronType ?? node?.type) === "inter_inh";
}

function additiveContributionSign(node) {
  return isInhibitoryOutput(node) ? -1 : 1;
}

function sensorOutputForNode(node, sourceOutputs, sensorEnabled) {
  if (!node?.sourceId) return 0;
  // Body-internal proprio channels (energy, damage) are always on; only
  // external sensors consult sensorEnabled. Unknown sources default to on.
  const enabled = sensorEnabled[node.sourceId];
  const active = enabled === undefined ? true : Boolean(enabled);
  return active ? clamp(sourceOutputs[node.sourceId] ?? 0, 0, 1) : 0;
}

function currentNodeOutput(node) {
  return nodeOutputFromValues(
    node,
    node.state ?? initialStateForType(node?.neuronType ?? node?.type),
    node.adapt ?? initialAdaptForType(node?.neuronType ?? node?.type)
  );
}

function feedbackAwareSignal(fromNode, toNode, stagedOutputs) {
  if (fromNode.x >= toNode.x - 8) return currentNodeOutput(fromNode);
  return stagedOutputs[fromNode.id] ?? currentNodeOutput(fromNode);
}

function gainFromModulatorSignal(signal, weight) {
  const rawGain = MOD_GAIN_MIN + clamp(signal, 0, 1) * (MOD_GAIN_MAX - MOD_GAIN_MIN);
  return clamp(MOD_GAIN_BASELINE + (rawGain - MOD_GAIN_BASELINE) * clampWeight(weight), MOD_GAIN_MIN, MOD_GAIN_MAX);
}

export function cloneConnections(source = {}) {
  return Object.fromEntries(CONNECTION_ORDER.map((key) => [key, source[key] ?? 0]));
}

export function cloneSensorEnabled(source = DEFAULT_SENSOR_ENABLED, sensorDefs = SENSOR_DEFINITIONS) {
  return Object.fromEntries(sensorDefs.map((sensor) => [sensor.id, source[sensor.id] !== undefined ? Boolean(source[sensor.id]) : (sensor.defaultEnabled ?? true)]));
}

export function cloneSensorModes(source = {}, sensorDefs = SENSOR_DEFINITIONS) {
  return Object.fromEntries(sensorDefs.map((sensor) => [sensor.id, source[sensor.id] ?? "absolute"]));
}

export function inferBehavior(connections, sensorEnabled = DEFAULT_SENSOR_ENABLED, sensorDefs = SENSOR_DEFINITIONS) {
  // For the ant, same-side = sensor side matches turn side (L_chem_* → motor_turn_L
  // turns the ant toward a left-detected source → gradient ascent / 趋近).
  const score = { sameExcite: 0, crossExcite: 0, sameInhibit: 0, crossInhibit: 0 };
  for (const sensor of sensorDefs) {
    if (sensor.kind !== "chem_A" || sensor.side === "center" || !sensorEnabled[sensor.id]) continue;
    for (const target of MOTOR_IDS) {
      const state = connections[makeConnectionId(sensor.id, target)] ?? 0;
      if (!state) continue;
      const same = (sensor.side === "left"  && target === "motor_turn_L") ||
                   (sensor.side === "right" && target === "motor_turn_R");
      const cross = (sensor.side === "left"  && target === "motor_turn_R") ||
                    (sensor.side === "right" && target === "motor_turn_L");
      if (!same && !cross) continue;
      if (state === 1)  score[same ? "sameExcite"  : "crossExcite"]  += 1;
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
  const parts = CONNECTION_ORDER
    .filter((key) => connections[key])
    .map((key) => `${CONNECTION_META[key].label}${connections[key] > 0 ? "兴奋" : "抑制"}`);
  return parts.length ? parts.join(" / ") : "全部关闭";
}

export function nodeWidthFor(node) {
  return (node.neuronType ?? node.type) === "motor" ? GRAPH_LAYOUT.motorWidth : GRAPH_LAYOUT.nodeWidth;
}

export function nodeRect(node) {
  const width = nodeWidthFor(node);
  return { x: node.x - width * 0.5, y: node.y - GRAPH_LAYOUT.nodeHeight * 0.5, width, height: GRAPH_LAYOUT.nodeHeight };
}

export function nodeHasInput(node) {
  return !isSensorNode(node);
}

export function nodeHasOutput(node) {
  return (node?.neuronType ?? node?.type) !== "motor";
}

export function nodePort(node, side) {
  const rect = nodeRect(node);
  return { x: side === "in" ? rect.x : rect.x + rect.width, y: node.y };
}

export class NeuralGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.nextNeuronIndex = 1;
    this.nextEdgeIndex = 1;
  }

  reset(width, height) {
    this.nodes.clear();
    this.edges.clear();
    this.nextNeuronIndex = 1;
    this.nextEdgeIndex = 1;
    this.ensureAnchors(width, height, true);
    this.buildDefaultCircuit(width, height);
    this.resetState();
  }

  resetState() {
    for (const node of this.nodes.values()) {
      node.state = initialStateForType(node.neuronType);
      node.adapt = initialAdaptForType(node.neuronType);
      node.h_rebound = initialHReboundForType(node.neuronType);
    }
  }

  buildDefaultCircuit(width, height) {
    // Default ant wiring: antennal ChemA drives forward + same-side steering
    // (gradient ascent on ChemA), and antennal ChemD steers AWAY — opposite
    // turn side — so the ant veers off danger plumes. Player can rewire.
    const leftA  = this.nodes.get(sourceNodeId("L_chem_A"));
    const rightA = this.nodes.get(sourceNodeId("R_chem_A"));
    const leftD  = this.nodes.get(sourceNodeId("L_chem_D"));
    const rightD = this.nodes.get(sourceNodeId("R_chem_D"));
    const fwd    = this.nodes.get(motorNodeId("motor_forward"));
    const turnL  = this.nodes.get(motorNodeId("motor_turn_L"));
    const turnR  = this.nodes.get(motorNodeId("motor_turn_R"));
    const midX = lerp(GRAPH_LAYOUT.sensorX, Math.max(GRAPH_LAYOUT.motorInset, width - GRAPH_LAYOUT.motorInset), 0.56);

    // 兴1: L_chem_A + R_chem_A → motor_forward (ChemA → go forward)
    if (leftA && rightA && fwd) {
      const ex1 = this.addNeuronNode("inter_exc", midX, height * 0.2, { label: "E1", tau: 2 });
      this.addEdge(leftA.id,  ex1.id);
      this.addEdge(rightA.id, ex1.id);
      this.addEdge(ex1.id, fwd.id);
    }
    // 兴2: L_chem_A → motor_turn_L (left ChemA reading → turn left toward it)
    if (leftA && turnL) {
      const ex2 = this.addNeuronNode("inter_exc", midX, height * 0.45, { label: "E2", tau: 3 });
      this.addEdge(leftA.id, ex2.id);
      this.addEdge(ex2.id, turnL.id);
    }
    // 兴3: R_chem_A → motor_turn_R (right ChemA reading → turn right toward it)
    if (rightA && turnR) {
      const ex3 = this.addNeuronNode("inter_exc", midX, height * 0.6, { label: "E3", tau: 3 });
      this.addEdge(rightA.id, ex3.id);
      this.addEdge(ex3.id, turnR.id);
    }
    // 兴4: R_chem_D → motor_turn_L (danger on the right → turn left to escape)
    if (rightD && turnL) {
      const ex4 = this.addNeuronNode("inter_exc", midX * 0.85, height * 0.75, { label: "E4", tau: 1.5 });
      this.addEdge(rightD.id, ex4.id);
      this.addEdge(ex4.id, turnL.id);
    }
    // 兴5: L_chem_D → motor_turn_R (danger on the left → turn right to escape)
    if (leftD && turnR) {
      const ex5 = this.addNeuronNode("inter_exc", midX * 0.85, height * 0.9, { label: "E5", tau: 1.5 });
      this.addEdge(leftD.id, ex5.id);
      this.addEdge(ex5.id, turnR.id);
    }
  }

  ensureAnchors(width, height, forcePosition = false, sourceDefs = SOURCE_DEFINITIONS) {
    // Remove sensor nodes that no longer exist in the current config
    const validIds = new Set(sourceDefs.map((s) => sourceNodeId(s.id)));
    for (const [id, node] of this.nodes) {
      if (node.neuronType === "sensor_on" && !validIds.has(id)) {
        // Remove edges connected to this node
        for (const [edgeId, edge] of this.edges) {
          if (edge.source === id || edge.target === id) this.edges.delete(edgeId);
        }
        this.nodes.delete(id);
      }
    }
    const groupGap = 22;
    const maxSpacing = GRAPH_LAYOUT.nodeHeight + 12;  // compact: 46px between nodes
    const grouped = { chemical: [], mechanical: [], environmental: [], proprio: [] };
    for (const s of sourceDefs) {
      const group = s.group ?? KIND_TO_GROUP[s.kind] ?? "chemical";
      if (grouped[group]) grouped[group].push(s);
    }
    const groups = ["chemical", "mechanical", "environmental", "proprio"]
      .map(k => grouped[k])
      .filter(g => g.length > 0);
    const totalNodes = groups.reduce((sum, g) => sum + g.length, 0);
    const totalGaps = groups.length - 1;
    const nodeSpacing = Math.min(maxSpacing, totalNodes > 1 ? (height - 120 - totalGaps * groupGap) / (totalNodes - 1) : maxSpacing);
    // Total column height, then center vertically
    const columnH = (totalNodes - 1) * nodeSpacing + totalGaps * groupGap;
    let y = Math.max(40, (height - columnH) / 2);
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      for (let i = 0; i < group.length; i++) {
        const source = group[i];
        this.upsertNode(sourceNodeId(source.id), {
          id: sourceNodeId(source.id),
          neuronType: "sensor_on",
          sourceId: source.id,
          label: sourceDisplayName(source),
          kind: source.kind,
          x: GRAPH_LAYOUT.sensorX,
          y
        }, forcePosition);
        y += nodeSpacing;
      }
      if (g < groups.length - 1) y += groupGap;
    }
    // Motor nodes: vertically centered, at right side
    const motorX = Math.max(GRAPH_LAYOUT.motorInset, width - GRAPH_LAYOUT.motorInset);
    const motorSpacing = Math.min(maxSpacing * 1.2, 60);
    const motorH = (MOTOR_IDS.length - 1) * motorSpacing;
    const motorStartY = (height - motorH) / 2;
    for (const [idx, motorId] of MOTOR_IDS.entries()) {
      const label = MOTOR_LABELS[motorId] ?? motorId;
      this.upsertNode(motorNodeId(motorId), {
        id: motorNodeId(motorId),
        neuronType: "motor",
        sourceId: motorId,
        label,
        kind: "motor",
        x: motorX,
        y: motorStartY + idx * motorSpacing
      }, forcePosition);
    }
  }

  upsertNode(id, patch, forcePosition) {
    const current = this.nodes.get(id);
    const normalizedPatch = normalizeNode({ id, ...patch });
    if (!current) {
      this.nodes.set(id, normalizedPatch);
      return;
    }
    const nextState = current.state;
    const nextAdapt = current.adapt;
    const nextHRebound = current.h_rebound;
    Object.assign(current, normalizedPatch);
    current.state = nextState ?? normalizedPatch.state;
    current.adapt = nextAdapt ?? normalizedPatch.adapt;
    current.h_rebound = nextHRebound ?? normalizedPatch.h_rebound;
    if (!forcePosition) return;
    current.x = normalizedPatch.x;
    current.y = normalizedPatch.y;
  }

  addNeuronNode(neuronType, x, y, patch = {}) {
    let px = x;
    let py = y;
    for (let guard = 0; guard < 20 && [...this.nodes.values()].some((node) => Math.hypot(node.x - px, node.y - py) < 44); guard += 1) {
      px += 18;
      py += 14;
    }
    const normalizedType = neuronTypeForNode({ neuronType });
    const label = patch.label ?? `${NODE_LABEL_PREFIX[normalizedType] ?? "N"}${this.nextNeuronIndex}`;
    const node = normalizeNode({
      id: `node:${this.nextNeuronIndex}`,
      neuronType: normalizedType,
      sourceId: null,
      kind: normalizedType,
      x: px,
      y: py,
      ...patch,
      label
    });
    this.nextNeuronIndex += 1;
    this.nodes.set(node.id, node);
    return node;
  }

  addInterNode(x, y, neuronType = "inter_exc") {
    return this.addNeuronNode(neuronType, x, y);
  }

  updateNodeTau(nodeId, tau) {
    const node = this.nodes.get(nodeId);
    if (!node || !isEditableNode(node)) return null;
    node.tau = clampTau(node.neuronType, tau);
    return node;
  }

  addEdge(fromId, toId) {
    if (fromId === toId) return null;
    const fromNode = this.nodes.get(fromId);
    const toNode = this.nodes.get(toId);
    if (!fromNode || !toNode || !nodeHasOutput(fromNode) || !nodeHasInput(toNode)) return null;
    for (const edge of this.edges.values()) {
      if (edge.fromId === fromId && edge.toId === toId) return edge;
    }
    const fromType = fromNode.neuronType ?? fromNode.type;
    const edge = { id: `edge:${this.nextEdgeIndex++}`, fromId, toId, weight: 1, plastic: false, mod_source_id: null, delay_ms: 0, attenuation: 1 };
    if (fromType === "inter_inh") edge.excitatory = false;
    else if (fromType === "modulator") edge.modulatory = true;
    else edge.excitatory = true;
    this.edges.set(edge.id, edge);
    return edge;
  }

  setEdgePlastic(edgeId, { plastic, modSourceId } = {}) {
    const edge = this.edges.get(edgeId);
    if (!edge) return null;
    if (!plastic) {
      edge.plastic = false;
      edge.mod_source_id = null;
      delete edge.w;
      return edge;
    }
    if (!modSourceId) {
      console.warn(`setEdgePlastic: plastic=true requires modSourceId (edge ${edgeId})`);
      return null;
    }
    const modNode = this.nodes.get(modSourceId);
    if (!modNode || (modNode.neuronType ?? modNode.type) !== "modulator") {
      console.warn(`setEdgePlastic: modSourceId ${modSourceId} is not a modulator node`);
      return null;
    }
    edge.plastic = true;
    edge.mod_source_id = modSourceId;
    if (!Number.isFinite(edge.w)) edge.w = clampToDaleLaw(edge.weight);
    return edge;
  }

  cycleEdgeWeight(edgeId) {
    const edge = this.edges.get(edgeId);
    if (!edge) return null;
    edge.weight = nextEdgeWeight(edge.weight);
    return edge;
  }

  updateEdgeWeight(edgeId, weight) {
    const edge = this.edges.get(edgeId);
    if (!edge) return null;
    if (edge.plastic) {
      edge.weight = clampToDaleLaw(weight);
      edge.w = edge.weight;
    } else {
      edge.weight = clampWeight(weight);
    }
    return edge;
  }

  removeEdge(edgeId) {
    this.edges.delete(edgeId);
  }

  removeNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node || !isEditableNode(node)) return;
    this.nodes.delete(nodeId);
    for (const [edgeId, edge] of this.edges) {
      if (edge.fromId === nodeId || edge.toId === nodeId) {
        this.edges.delete(edgeId);
        continue;
      }
      if (edge.plastic && edge.mod_source_id === nodeId) {
        console.warn(`removeNode: reverting plastic edge ${edgeId} to fixed — modulator ${nodeId} was deleted`);
        edge.plastic = false;
        edge.mod_source_id = null;
        delete edge.w;
      }
    }
  }

  isNodeActive(node, sensorEnabled) {
    return !isSensorNode(node) || !node.sourceId?.startsWith("F") && !node.sourceId?.startsWith("T") || Boolean(sensorEnabled[node.sourceId]);
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
    const nodeSignals = {};
    const edgeSignals = {};
    const gainByTarget = {};
    const additiveByTarget = {};
    const excitatoryByTarget = {};
    const inhibitoryByTarget = {};
    const nextStateById = {};
    const nextAdaptById = {};
    const nextHReboundById = {};

    for (const node of this.nodes.values()) {
      if (!isSensorNode(node)) continue;
      const nextSignal = sensorOutputForNode(node, sourceOutputs, sensorEnabled);
      nextStateById[node.id] = nextSignal;
      nextAdaptById[node.id] = 0;
      nextHReboundById[node.id] = 0;
      nodeSignals[node.id] = nextSignal;
      if (commit) {
        node.state = nextSignal;
        node.adapt = 0;
        node.h_rebound = 0;
      }
    }

    const sortedTargets = [...this.nodes.values()]
      .filter((node) => !isSensorNode(node))
      .sort((a, b) => a.x - b.x || a.y - b.y);

    for (const targetNode of sortedTargets) {
      gainByTarget[targetNode.id] = 1;
      additiveByTarget[targetNode.id] = 0;
      excitatoryByTarget[targetNode.id] = 0;
      inhibitoryByTarget[targetNode.id] = 0;
    }

    for (const edge of this.edges.values()) {
      const fromNode = this.nodes.get(edge.fromId);
      const toNode = this.nodes.get(edge.toId);
      if (!fromNode || !toNode) continue;
      const sourceSignal = clamp(feedbackAwareSignal(fromNode, toNode, nodeSignals), 0, 1);
      const effectiveWeight = edge.plastic
        ? clampToDaleLaw(Number.isFinite(edge.w) ? edge.w : edge.weight)
        : clampWeight(edge.weight);
      const atten = clampAttenuation(edge.attenuation);
      edgeSignals[edge.id] = sourceSignal * effectiveWeight * atten;
      if ((fromNode.neuronType ?? fromNode.type) === "modulator") {
        gainByTarget[toNode.id] *= gainFromModulatorSignal(sourceSignal * atten, effectiveWeight);
      } else if (isInhibitoryOutput(fromNode)) {
        inhibitoryByTarget[toNode.id] += edgeSignals[edge.id];
        additiveByTarget[toNode.id] -= edgeSignals[edge.id];
      } else {
        excitatoryByTarget[toNode.id] += edgeSignals[edge.id];
        additiveByTarget[toNode.id] += edgeSignals[edge.id];
      }
    }

    for (const node of sortedTargets) {
      const gain = clamp(gainByTarget[node.id] ?? 1, MOD_GAIN_MIN, MOD_GAIN_MAX);
      const excitatorySum = excitatoryByTarget[node.id] ?? 0;
      const inhibitorySum = inhibitoryByTarget[node.id] ?? 0;
      const netInput = (excitatorySum - inhibitorySum) * gain;
      let nextState = netInput;
      let nextAdapt = 0;
      let nextHRebound = 0;
      let output = clamp(netInput, 0, 1);

      if (node.neuronType === "motor") {
        output = clamp(netInput, -1, 1);
        nextState = output;
      } else if (node.neuronType === "modulator") {
        const prevState = node.state ?? initialStateForType(node.neuronType);
        const safeTau = Math.max(0.05, node.tau ?? defaultTauForType(node.neuronType));
        nextState = clamp(prevState + (clamp(netInput, 0, 1) - prevState) * (dt / safeTau), 0, 1);
        output = nextState;
      } else {
        const prevState = node.state ?? initialStateForType(node.neuronType);
        const prevAdapt = node.adapt ?? initialAdaptForType(node.neuronType);
        const prevHRebound = node.h_rebound ?? node.rebound ?? initialHReboundForType(node.neuronType);
        const safeTau = Math.max(0.05, node.tau ?? defaultTauForType(node.neuronType));

        if (node.neuronType === "inter_inh") {
          // Matsuoka oscillator + cumulative PIR rebound
          // W=2.0 amplifies inhibitory input for proper mutual suppression
          const W_INH = 2.0;
          let h = prevHRebound;
          if (prevState < defaultReboundThresholdForNode(node) && inhibitorySum > 0) {
            h += inhibitorySum * 0.8 * dt;
          } else {
            h *= Math.exp(-dt / defaultTauDischargeForNode(node));
          }
          nextHRebound = clamp(h, 0, MAX_H_REBOUND);
          const drive = excitatorySum * gain - W_INH * inhibitorySum * gain - 2.0 * prevAdapt + defaultGReboundForNode(node) * nextHRebound;
          nextState = clamp(prevState + (-prevState + drive) * (dt / safeTau), -1, 1);
          const effectiveOutput = interEffectiveOutput(nextState);
          nextAdapt = clamp(prevAdapt + (-prevAdapt + effectiveOutput) * (dt / defaultTauAdaptForNode(node)), 0, 1);
          output = interFinalOutput(nextState, nextAdapt);
        } else {
          // Simple leaky integrator for inter_exc
          nextState = clamp(prevState + (netInput - prevState) * (dt / safeTau), -1, 1);
          const effectiveOutput = interEffectiveOutput(nextState);
          nextAdapt = clamp(prevAdapt + (effectiveOutput - prevAdapt) * (dt / defaultTauAdaptForNode(node)), 0, 1);
          output = interFinalOutput(nextState, nextAdapt);
        }
      }

      nextStateById[node.id] = nextState;
      nextAdaptById[node.id] = nextAdapt;
      nextHReboundById[node.id] = nextHRebound;
      nodeSignals[node.id] = output;
      if (commit) {
        node.state = nextState;
        node.adapt = nextAdapt;
        node.h_rebound = nextHRebound;
      }
    }

    if (commit) this.updatePlasticWeights(nodeSignals);

    return { nodeSignals, edgeSignals, gainByTarget, additiveByTarget, nextStateById, nextAdaptById, nextHReboundById };
  }

  // Modulated Hebbian weight update. Runs after node activations for the
  // current tick have been computed, so pre/post/mod reflect *this* tick
  // — evaluation of the same tick used the weights as they stood at the
  // end of the previous tick (spec §4 order).
  updatePlasticWeights(nodeSignals) {
    for (const edge of this.edges.values()) {
      if (!edge.plastic) continue;
      const modId = edge.mod_source_id;
      if (!modId || !this.nodes.has(modId)) continue;
      const pre = clamp(nodeSignals[edge.fromId] ?? 0, 0, 1);
      const post = clamp(nodeSignals[edge.toId] ?? 0, 0, 1);
      const mod = clamp(nodeSignals[modId] ?? 0, 0, 1);
      const current = Number.isFinite(edge.w) ? edge.w : edge.weight;
      const dw = LEARNING_RATE * pre * post * mod;
      const decay = WEIGHT_DECAY_RATE * (edge.weight - current);
      edge.w = clampToDaleLaw(current + dw + decay);
    }
  }

  getMotorOutputs(nodeSignals) {
    const out = {};
    for (const id of MOTOR_IDS) out[id] = nodeSignals[motorNodeId(id)] ?? 0;
    return out;
  }

  getModulatorNodes() {
    return [...this.nodes.values()].filter((node) => (node.neuronType ?? node.type) === "modulator");
  }

  toConnectionsObject() {
    const aggregate = Object.fromEntries(CONNECTION_ORDER.map((id) => [id, 0]));

    for (const edge of this.edges.values()) {
      const fromNode = this.nodes.get(edge.fromId);
      const toNode = this.nodes.get(edge.toId);

      if (isSensorNode(fromNode) && (toNode?.neuronType ?? toNode?.type) === "motor" && SOURCE_BY_ID[fromNode.sourceId]) aggregate[makeConnectionId(fromNode.sourceId, toNode.sourceId)] += 1;
      if (!isSensorNode(fromNode) || !isEditableNode(toNode) || (toNode.neuronType ?? toNode.type) === "modulator") continue;

      for (const nextEdge of this.edges.values()) {
        if (nextEdge.fromId !== toNode.id) continue;
        const motorNode = this.nodes.get(nextEdge.toId);
        if ((motorNode?.neuronType ?? motorNode?.type) !== "motor" || !SOURCE_BY_ID[fromNode.sourceId]) continue;
        aggregate[makeConnectionId(fromNode.sourceId, motorNode.sourceId)] += additiveContributionSign(toNode);
      }
    }

    return Object.fromEntries(CONNECTION_ORDER.map((id) => [id, aggregate[id] > 0 ? 1 : aggregate[id] < 0 ? -1 : 0]));
  }

  serialize() {
    return JSON.stringify({
      nodes: [...this.nodes.values()].map((node) => ({
        ...node,
        neuronType: node.neuronType,
        tau: node.tau,
        state: node.state ?? initialStateForType(node.neuronType),
        adapt: clamp(node.adapt ?? initialAdaptForType(node.neuronType), 0, 1),
        h_rebound: clamp(node.h_rebound ?? node.rebound ?? initialHReboundForType(node.neuronType), 0, MAX_H_REBOUND),
        tau_charge: defaultTauChargeForNode(node),
        tau_discharge: defaultTauDischargeForNode(node),
        g_rebound: defaultGReboundForNode(node),
        rebound_threshold: defaultReboundThresholdForNode(node),
        rebound_gate_center: defaultReboundGateCenterForNode(node),
        rebound_gate_slope: defaultReboundGateSlopeForNode(node)
      })),
      edges: [...this.edges.values()].map((edge) => ({
        ...edge,
        weight: edge.plastic ? clampToDaleLaw(edge.weight) : clampWeight(edge.weight),
        delay_ms: clampDelayMs(edge.delay_ms),
        attenuation: clampAttenuation(edge.attenuation)
      })),
      nextNeuronIndex: this.nextNeuronIndex,
      nextEdgeIndex: this.nextEdgeIndex
    });
  }

  deserialize(json) {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    this.nodes = new Map((data.nodes ?? []).map((node) => {
      const normalized = normalizeNode({
        ...node,
        state: node.state ?? data.prevSignals?.[node.id] ?? initialStateForType(neuronTypeForNode(node)),
        adapt: node.adapt ?? 0,
        h_rebound: node.h_rebound ?? node.rebound ?? 0
      });
      return [normalized.id, normalized];
    }));
    this.edges = new Map(
      (data.edges ?? []).map((edge) => {
        const normalized = {
          ...edge,
          fromId: edge.fromId ?? edge.from,
          toId: edge.toId ?? edge.to,
          plastic: edge.plastic === true,
          mod_source_id: edge.mod_source_id ?? null,
          delay_ms: clampDelayMs(edge.delay_ms),
          attenuation: clampAttenuation(edge.attenuation)
        };
        delete normalized.from;
        delete normalized.to;
        delete normalized.excitatory;

        // Plastic validity: mod_source_id must reference an existing
        // modulator node in the just-loaded graph. Dangling refs revert
        // the edge to fixed with a warning, matching the node-deletion
        // recovery path in removeNode so the evaluator never sees a
        // plastic edge without a valid modulator.
        if (normalized.plastic) {
          const modNode = normalized.mod_source_id ? this.nodes.get(normalized.mod_source_id) : null;
          if (!modNode || (modNode.neuronType ?? modNode.type) !== "modulator") {
            console.warn(`deserialize: reverting plastic edge ${normalized.id} to fixed — mod_source_id ${normalized.mod_source_id} missing or not a modulator`);
            normalized.plastic = false;
            normalized.mod_source_id = null;
            delete normalized.w;
          }
        }

        if (normalized.plastic) {
          normalized.weight = clampToDaleLaw(normalized.weight ?? 1);
          normalized.w = clampToDaleLaw(Number.isFinite(normalized.w) ? normalized.w : normalized.weight);
        } else {
          normalized.weight = clampWeight(normalized.weight ?? 1);
          delete normalized.w;
        }

        return [normalized.id, normalized];
      })
    );
    this.nextNeuronIndex = data.nextNeuronIndex ?? data.nextInterIndex ?? 1;
    this.nextEdgeIndex = data.nextEdgeIndex ?? 1;
  }
}






