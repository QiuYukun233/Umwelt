import { SensorConfig } from "./sensor-config.js";

export const CONFIG = {
  FOOD_COUNT: 20,
  DANGER_COUNT: 4,
  BASE_SPEED: 70,
  ENERGY_DECAY: 1.5,
  ENERGY_MOTION_COST: 2.0,
  FOOD_ENERGY: 25,
  FOOD_EAT_RADIUS: 14,
  MAX_ENERGY: 100,
  FIXED_DT: 1 / 60,
  TONIC_DRIVE: 0.48,
  SENSOR_GAIN: 0.9,
  TURN_GAIN: 2.6,
  ANT_RADIUS: 16,
  TRAIL_LENGTH: 200,
  FOOD_MARGIN: 30,
  DANGER_MARGIN: 34,
  SENSOR_ENERGY_COST: 0.8,
  MAX_DIFF: 2.0,
  MAX_TURN_RATE: 3.0,
  ENV_FOOD_MAX: 720,
  ENV_DANGER_MAX: 120,
  // Chemical field parameters — four independent species.
  // ChemA = environmental food source; ChemD = environmental danger;
  // ChemB = gland_α (ground deposit, low diffusion + medium decay);
  // ChemC = gland_β (air-volatile, high diffusion + fast decay).
  FIELD_CELL_SIZE: 20,
  FIELD_WARMUP_STEPS: 200,
  CHEM_A_DIFFUSION: 8.0,  CHEM_A_DECAY: 0.55,
  CHEM_B_DIFFUSION: 2.5,  CHEM_B_DECAY: 0.25,
  CHEM_C_DIFFUSION: 14.0, CHEM_C_DECAY: 1.5,
  CHEM_D_DIFFUSION: 6.0,  CHEM_D_DECAY: 0.50,
  FOOD_EMIT_RATE: 1.2,
  DANGER_EMIT_RATE: 1.5,
  DANGER_THRESHOLD: 0.3,
  DANGER_DAMAGE_RATE: 30.0,
  // Legacy aliases (some sites still refer to these)
  FOOD_DIFFUSION: 8.0,
  FOOD_DECAY: 0.55,
  DANGER_DIFFUSION: 6.0,
  DANGER_DECAY: 0.50,
  // Gland emission parameters per ant-design-spec.md §4.2.
  //   emitThreshold — below this motor level the gland does not secrete.
  //   emitRate      — units of chemical deposited per second at motor = 1.
  //   capacity/recovery live on the AntBody (per-creature state).
  GLAND_EMIT_THRESHOLD: 0.05,
  GLAND_ALPHA_EMIT_RATE: 2.0,
  GLAND_BETA_EMIT_RATE:  3.0,
};

/** Per-chemical-species field params, referenced from World. */
export const CHEM_SPECIES = {
  chem_A: { diffusion: 8.0,  decay: 0.55 },
  chem_B: { diffusion: 2.5,  decay: 0.25 },
  chem_C: { diffusion: 14.0, decay: 1.5  },
  chem_D: { diffusion: 6.0,  decay: 0.50 },
};
export const CHEM_KEYS = ["chem_A", "chem_B", "chem_C", "chem_D"];

/* ── creature definition (static, from active creature: ant) ── */

const NEURON_PREFIXES_DEF = { inter_exc: "E", inter_inh: "I", modulator: "M" };

// Ant motors per ant-design-spec.md §4. No backward — ants rarely reverse.
// Glands and mandible do not affect locomotion; they appear as motor nodes
// the player can wire to but produce no movement (chemical writes / clamp
// effects are wired in step 3 / 5).
export const MOTOR_IDS = [
  "motor_forward",
  "motor_turn_L",
  "motor_turn_R",
  "gland_alpha",
  "gland_beta",
  "mandible",
];
export const MOTOR_LABELS = {
  motor_forward: "→进",
  motor_turn_L:  "→左",
  motor_turn_R:  "→右",
  gland_alpha:   "→腺α",
  gland_beta:    "→腺β",
  mandible:      "→颚",
};
export const MOTOR_NAMES = {
  motor_forward: "前进",
  motor_turn_L:  "左转",
  motor_turn_R:  "右转",
  gland_alpha:   "腺体α",
  gland_beta:    "腺体β",
  mandible:      "大颚",
};
export const NEURON_PREFIXES = NEURON_PREFIXES_DEF;

export const GRAPH_LAYOUT = {
  nodeWidth: 96,
  motorWidth: 94,
  nodeHeight: 34,
  nodeRadius: 8,
  portRadius: 5,
  sensorX: 120,
  motorInset: 120
};

/** Fixed logical coordinate space for graph layout — fitView maps this to actual canvas */
export const LOGIC_CANVAS = { width: 900, height: 600 };

/* ── interoceptive / proprioceptive (always-on body-internal sensors) ── */
// Per ant-design-spec.md §3.5. These are body quantities, not semantics:
// `energy` is the glycogen storage level (1 = full, 0 = depleted).
// `damage` is nociceptor firing rate when tissue is being harmed.
export const PROPRIO_DEFINITIONS = [
  { id: "energy", kind: "interoceptive", label: "内⊘能", name: "能量储备",   side: "center", alwaysOn: true },
  { id: "damage", kind: "nociceptive",   label: "内⊘伤", name: "伤害感受",   side: "center", alwaysOn: true },
];

/* ── builder functions for dynamic sensor lists ── */

export function buildSourceDefinitions(sensorDefs) {
  return [...sensorDefs, ...PROPRIO_DEFINITIONS];
}

export function buildSensorMaps(sensorDefs) {
  const sourceDefs = buildSourceDefinitions(sensorDefs);
  return {
    SENSOR_BY_ID: Object.fromEntries(sensorDefs.map((s) => [s.id, s])),
    SENSOR_ORDER: sensorDefs.map((s) => s.id),
    SOURCE_BY_ID: Object.fromEntries(sourceDefs.map((s) => [s.id, s])),
    SOURCE_ORDER: sourceDefs.map((s) => s.id),
    DEFAULT_SENSOR_ENABLED: Object.fromEntries(sensorDefs.map((s) => [s.id, s.defaultEnabled ?? true])),
  };
}

export function buildConnectionMeta(sensorDefs) {
  const sourceDefs = buildSourceDefinitions(sensorDefs);
  const ORDER = [];
  const META = {};
  for (const source of sourceDefs) {
    for (const target of MOTOR_IDS) {
      const id = makeConnectionId(source.id, target);
      ORDER.push(id);
      META[id] = {
        id,
        source: source.id,
        sensorId: source.id,
        sensorKind: source.kind,
        sensorSide: source.side,
        target,
        label: `${source.label} → ${MOTOR_LABELS[target]}`
      };
    }
  }
  return { CONNECTION_ORDER: ORDER, CONNECTION_META: META };
}

export function buildDefaultConnections(sensorDefs) {
  const { CONNECTION_ORDER } = buildConnectionMeta(sensorDefs);
  const connections = Object.fromEntries(CONNECTION_ORDER.map((id) => [id, 0]));
  // Default wiring for the ant: both antennal ChemA sensors drive forward,
  // and each side steers toward its own reading (same-side excitation →
  // simple gradient ascent on ChemA). Player can rewire freely.
  const trySet = (src, tgt, val) => {
    const id = makeConnectionId(src, tgt);
    if (id in connections) connections[id] = val;
  };
  trySet("L_chem_A", "motor_forward", 1);
  trySet("R_chem_A", "motor_forward", 1);
  trySet("L_chem_A", "motor_turn_L", 1);    // left reading → turn left (toward source)
  trySet("R_chem_A", "motor_turn_R", 1);    // right reading → turn right (toward source)
  return connections;
}

/* ── static defaults (built from default SensorConfig, for backward compat) ── */

const _defaultConfig = SensorConfig.createDefault();
const _defaultSensorDefs = _defaultConfig.toDefinitions();
const _defaultMaps = buildSensorMaps(_defaultSensorDefs);

export const SENSOR_DEFINITIONS = _defaultSensorDefs;
export const SOURCE_DEFINITIONS = buildSourceDefinitions(_defaultSensorDefs);
export const SENSOR_BY_ID = _defaultMaps.SENSOR_BY_ID;
export const SENSOR_ORDER = _defaultMaps.SENSOR_ORDER;
export const SOURCE_BY_ID = _defaultMaps.SOURCE_BY_ID;
export const SOURCE_ORDER = _defaultMaps.SOURCE_ORDER;
export const DEFAULT_SENSOR_ENABLED = _defaultMaps.DEFAULT_SENSOR_ENABLED;

/* ── utilities ── */

export function makeConnectionId(sourceId, targetId) {
  return `${sourceId}_${targetId}`;
}

export function sourceNodeId(sourceId) {
  return `source:${sourceId}`;
}

export function motorNodeId(targetId) {
  return `motor:${targetId}`;
}

export function createEnvironmentState() {
  return {
    foodDensity: CONFIG.FOOD_COUNT,
    dangerDensity: CONFIG.DANGER_COUNT,
    draftFoodDensity: CONFIG.FOOD_COUNT,
    draftDangerDensity: CONFIG.DANGER_COUNT
  };
}

export function sourceDisplayName(source) {
  return source.label;
}

/* ── static connection metadata (backward compat) ── */

const _cm = buildConnectionMeta(_defaultSensorDefs);
export const CONNECTION_ORDER = _cm.CONNECTION_ORDER;
export const CONNECTION_META = _cm.CONNECTION_META;
export const DEFAULT_CONNECTIONS = buildDefaultConnections(_defaultSensorDefs);

export const BEHAVIOR_PRESETS = {
  approach: { name: "趋近", desc: "同侧兴奋主导" },
  chase:    { name: "追击", desc: "交叉兴奋主导" },
  attach:   { name: "依恋", desc: "同侧抑制主导" },
  avoid:    { name: "回避", desc: "交叉抑制主导" },
  custom:   { name: "自定义", desc: "自行组合" }
};
