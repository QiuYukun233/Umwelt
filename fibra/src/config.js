export const CONFIG = {
  FOOD_COUNT: 20,
  DANGER_COUNT: 4,
  FOOD_SENSE_RANGE: 220,
  DANGER_SENSE_RANGE: 90,
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
  EYE_CONE_ANGLE: 0.72,
  EYE_CONE_WIDTH: 1.06,
  ANT_RADIUS: 16,
  DANGER_RADIUS: 16,
  DANGER_DAMAGE: 18,
  DANGER_COOLDOWN: 0.45,
  TRAIL_LENGTH: 100,
  FOOD_MARGIN: 30,
  DANGER_MARGIN: 34,
  SENSOR_ENERGY_COST: 0.8,
  MAX_DIFF: 2.0,
  MAX_TURN_RATE: 3.0,
  ENV_FOOD_MAX: 720,
  ENV_DANGER_MAX: 120
};

export const SENSOR_HALF_ANGLE = (25 * Math.PI) / 180;
export const MOTOR_IDS = ["leftLeg", "rightLeg"];
export const MOTOR_LABELS = { leftLeg: "左腿", rightLeg: "右腿" };
export const GRAPH_LAYOUT = {
  nodeWidth: 84,
  motorWidth: 94,
  nodeHeight: 34,
  nodeRadius: 8,
  portRadius: 5,
  sensorX: 120,
  motorInset: 120
};

export const SENSOR_DEFINITIONS = [
  { id: "F0", kind: "food", label: "F0", name: "正前", angle: 0, side: "center", defaultEnabled: true },
  { id: "F1", kind: "food", label: "F1", name: "右前", angle: Math.PI / 3, side: "right", defaultEnabled: true },
  { id: "F2", kind: "food", label: "F2", name: "右后", angle: (2 * Math.PI) / 3, side: "right", defaultEnabled: false },
  { id: "F3", kind: "food", label: "F3", name: "正后", angle: Math.PI, side: "center", defaultEnabled: false },
  { id: "F4", kind: "food", label: "F4", name: "左后", angle: (-2 * Math.PI) / 3, side: "left", defaultEnabled: false },
  { id: "F5", kind: "food", label: "F5", name: "左前", angle: -Math.PI / 3, side: "left", defaultEnabled: true },
  { id: "T0", kind: "threat", label: "T0", name: "正前", angle: 0, side: "center", defaultEnabled: true },
  { id: "T1", kind: "threat", label: "T1", name: "右前", angle: Math.PI / 3, side: "right", defaultEnabled: true },
  { id: "T2", kind: "threat", label: "T2", name: "右后", angle: (2 * Math.PI) / 3, side: "right", defaultEnabled: false },
  { id: "T3", kind: "threat", label: "T3", name: "正后", angle: Math.PI, side: "center", defaultEnabled: false },
  { id: "T4", kind: "threat", label: "T4", name: "左后", angle: (-2 * Math.PI) / 3, side: "left", defaultEnabled: false },
  { id: "T5", kind: "threat", label: "T5", name: "左前", angle: -Math.PI / 3, side: "left", defaultEnabled: true }
];

export const PROPRIO_DEFINITIONS = [
  { id: "P_turn", kind: "proprio", label: "转速", name: "转速传感器", side: "center", alwaysOn: true },
  { id: "P_speed", kind: "proprio", label: "速度", name: "速度传感器", side: "center", alwaysOn: true }
];

export const NOISE_DEFINITION = {
  id: "N_noise",
  kind: "noise",
  label: "Noise",
  name: "随机扰动",
  side: "center",
  alwaysOn: true
};

export const SOURCE_DEFINITIONS = [...SENSOR_DEFINITIONS, ...PROPRIO_DEFINITIONS, NOISE_DEFINITION];
export const SENSOR_BY_ID = Object.fromEntries(SENSOR_DEFINITIONS.map((sensor) => [sensor.id, sensor]));
export const SENSOR_ORDER = SENSOR_DEFINITIONS.map((sensor) => sensor.id);
export const SOURCE_BY_ID = Object.fromEntries(SOURCE_DEFINITIONS.map((source) => [source.id, source]));
export const SOURCE_ORDER = SOURCE_DEFINITIONS.map((source) => source.id);
export const DEFAULT_SENSOR_ENABLED = Object.fromEntries(SENSOR_DEFINITIONS.map((sensor) => [sensor.id, sensor.defaultEnabled]));
export const DEFAULT_SENSOR_MODES = Object.fromEntries(SENSOR_DEFINITIONS.map((sensor) => [sensor.id, "absolute"]));

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
  if (source.kind === "food") return `食·${source.name}`;
  if (source.kind === "threat") return `威·${source.name}`;
  if (source.kind === "proprio") return source.name.replace("传感器", "");
  return source.name;
}

export const CONNECTION_ORDER = [];
export const CONNECTION_META = {};
for (const source of SOURCE_DEFINITIONS) {
  for (const target of MOTOR_IDS) {
    const id = makeConnectionId(source.id, target);
    CONNECTION_ORDER.push(id);
    CONNECTION_META[id] = {
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

export const DEFAULT_CONNECTIONS = Object.fromEntries(CONNECTION_ORDER.map((id) => [id, 0]));
DEFAULT_CONNECTIONS[makeConnectionId("F5", "rightLeg")] = -1;
DEFAULT_CONNECTIONS[makeConnectionId("F1", "leftLeg")] = -1;

export const BEHAVIOR_PRESETS = {
  approach: { name: "趋近", desc: "同侧兴奋主导" },
  chase: { name: "追击", desc: "交叉兴奋主导" },
  attach: { name: "依恋", desc: "同侧抑制主导" },
  avoid: { name: "回避", desc: "交叉抑制主导" },
  custom: { name: "自定义", desc: "自行组合" }
};
