/**
 * SensorConfig — ant anatomical sensor system (12 external slots).
 *
 * Per ant-design-spec.md §3, the ant has fixed anatomical sensor positions:
 *   - Left antenna  (5 sensors):  ChemA, ChemB, ChemC, ChemD, touch
 *   - Right antenna (5 sensors):  ChemA, ChemB, ChemC, ChemD, touch
 *   - Mouth         (1 sensor):   contact-taste
 *   - Head / eye    (1 sensor):   ambient light
 *
 * Unlike the nematode's player-configurable 14-slot body, the ant's sensor
 * layout is biologically fixed — each slot has exactly one sensor type
 * that lives there. createDefault() installs all 12.
 *
 * Body-internal sensors (energy, damage) are not slots; they live in
 * PROPRIO_DEFINITIONS (see config.js).
 */

/* ── sensor types ──────────────────────────────────────── */
// Per-chemical kinds distinguish the four independent channels. Group
// governs editor layout; field keys map to the world's samplers.

export const SENSOR_TYPES = {
  chem_A:  { kind: "chem_A",       group: "chemical",      label: "⊕A", name: "ChemA 化学感受器", color: "#7ab8a0", field: "chem_A" },
  chem_B:  { kind: "chem_B",       group: "chemical",      label: "⊕B", name: "ChemB 化学感受器", color: "#a0c49a", field: "chem_B" },
  chem_C:  { kind: "chem_C",       group: "chemical",      label: "⊕C", name: "ChemC 化学感受器", color: "#c4b56a", field: "chem_C" },
  chem_D:  { kind: "chem_D",       group: "chemical",      label: "⊕D", name: "ChemD 化学感受器", color: "#c46a5a", field: "chem_D" },
  touch:   { kind: "touch",        group: "mechanical",    label: "≋触", name: "机械感受器",       color: "#5a9ac4", field: "touch" },
  taste:   { kind: "taste",        group: "chemical",      label: "⊕味", name: "接触味觉",         color: "#b890a0", field: "mouth_taste" },
  light:   { kind: "light",        group: "environmental", label: "⊙光", name: "光感受",           color: "#d0ccc0", field: "light" },
};

/** All sensor type keys, for iteration. */
export const ALL_SENSOR_TYPE_KEYS = Object.keys(SENSOR_TYPES);

/* ── slot definitions ──────────────────────────────────── */

/**
 * Each slot: { slotId, region, label, name, offset, side, dir, displayAngle, sensorType }
 *   offset:       [forward, dorsal, lateral] in body-local units
 *   side:         "left" | "right" | "center"
 *   displayAngle: screen-space angle (0 = forward/up, + = clockwise)
 *   sensorType:   fixed (anatomically determined) sensor type installed here
 *
 * Antennae project forward at ~45° in the ground plane. Eight chemical
 * channels live at two physical tips (4 per antenna); they share a
 * direction but represent distinct sensory neurons, so each is its own
 * slot. The mouth sits forward of the head; the eye faces up.
 */

const ANT_ANGLE = Math.PI / 4;
// Antenna tips sit ~30 body-pixels forward-out from the ant centre, which
// puts them clearly past the head front and matches where the renderer
// draws them. Using the visible tip as the cone origin keeps sampled
// input and visualized cone aligned.
export const ANT_ANTENNA_REACH = 30;
const A_F = ANT_ANTENNA_REACH * Math.cos(ANT_ANGLE);
const A_L = ANT_ANTENNA_REACH * Math.sin(ANT_ANGLE);
const L_OFF = [A_F, 0,  A_L];
const R_OFF = [A_F, 0, -A_L];
const L_ANG = -ANT_ANGLE;
const R_ANG =  ANT_ANGLE;

// `angle3d` values tile the five antennal channels around each antenna's
// face (left = 30°–60°, right = 300°–330° around head circumference, with
// 0° = dorsal). Used by the legacy nematode 3D sidebar renderer until
// step 2 replaces it with an ant model — the values just need to be
// valid and distinct so nothing overlaps visually.
function antennaSlots(side) {
  const isLeft = side === "L";
  const off = isLeft ? L_OFF : R_OFF;
  const ang = isLeft ? L_ANG : R_ANG;
  const sideTag = isLeft ? "left" : "right";
  const prefix = isLeft ? "左" : "右";
  const base = isLeft ? 30 : 330;
  const step = isLeft ? 8 : -8;
  const mk = (suffix, type, label, name, i) => ({
    slotId: `${side}_${suffix}`,
    sensorType: type,
    region: "head",
    label: `${prefix}${label}`,
    name: `${prefix}${name}`,
    offset: off,
    side: sideTag,
    displayAngle: ang,
    angle3d: base + i * step,
  });
  return [
    mk("chem_A", "chem_A", "触角A", "触角 ChemA", 0),
    mk("chem_B", "chem_B", "触角B", "触角 ChemB", 1),
    mk("chem_C", "chem_C", "触角C", "触角 ChemC", 2),
    mk("chem_D", "chem_D", "触角D", "触角 ChemD", 3),
    mk("touch",  "touch",  "触角触", "触角机械感受", 4),
  ];
}

export const SLOT_DEFINITIONS = [
  ...antennaSlots("L"),
  ...antennaSlots("R"),
  { slotId: "mouth_chem", sensorType: "taste", region: "head", label: "口器味",   name: "口器接触化学感受", offset: [3, 0, 0],  side: "center", displayAngle: 0, angle3d: 180 },
  { slotId: "light",      sensorType: "light", region: "head", label: "眼光",     name: "光感受",           offset: [0, 1, 0],  side: "center", displayAngle: 0, angle3d: 0   },
];

export const SLOT_BY_ID = Object.fromEntries(SLOT_DEFINITIONS.map(s => [s.slotId, s]));

/* ── group display info ── */
export const GROUP_INFO = {
  chemical:      { label: "化学感受", color: "#7ab8a0" },
  mechanical:    { label: "机械感受", color: "#5a9ac4" },
  environmental: { label: "环境感受", color: "#d0ccc0" },
};

/* ── helpers ──────────────────────────────────────────── */

function dirFromOffset(offset) {
  const len = Math.sqrt(offset[0] ** 2 + offset[1] ** 2 + offset[2] ** 2) || 1;
  return [offset[0] / len, offset[1] / len, offset[2] / len];
}

/* ── SensorConfig class ──────────────────────────────── */

export class SensorConfig {
  /**
   * @param {Object<string, string|null>} slots  — slotId → sensorType or null
   * Ant slots are anatomically fixed; each slot either has its canonical
   * sensor installed or is empty (player removed it).
   */
  constructor(slots = {}) {
    this.slots = {};
    for (const def of SLOT_DEFINITIONS) {
      // Default each slot to its canonical type unless an explicit value
      // (including explicit null to remove) is provided.
      this.slots[def.slotId] = slots[def.slotId] !== undefined
        ? slots[def.slotId]
        : def.sensorType;
    }
  }

  /** Default: all 12 anatomical slots populated with their canonical sensor types. */
  static createDefault() {
    const slots = {};
    for (const def of SLOT_DEFINITIONS) slots[def.slotId] = def.sensorType;
    return new SensorConfig(slots);
  }

  /**
   * Install a sensor in a slot. For the ant, slots have a fixed canonical
   * type — installing a different type is a no-op. Still allowed for API
   * parity with the nematode version.
   */
  installSensor(slotId, sensorType) {
    const def = SLOT_BY_ID[slotId];
    if (!def) return false;
    if (!SENSOR_TYPES[sensorType]) return false;
    if (def.sensorType !== sensorType) return false;     // ant slots are fixed
    this.slots[slotId] = sensorType;
    return true;
  }

  /** Remove a sensor from a slot. Returns true if it was occupied. */
  removeSensor(slotId) {
    if (!this.slots[slotId]) return false;
    this.slots[slotId] = null;
    return true;
  }

  /** Get installed sensors as an array (only occupied slots). */
  getInstalled() {
    const result = [];
    for (const def of SLOT_DEFINITIONS) {
      const sensorType = this.slots[def.slotId];
      if (!sensorType) continue;
      const typeInfo = SENSOR_TYPES[sensorType];
      if (!typeInfo) continue;
      result.push({
        slotId: def.slotId,
        sensorType,
        region: def.region,
        label: def.label,
        name: def.name,
        side: def.side,
        offset: def.offset,
        displayAngle: def.displayAngle ?? 0,
        kind: typeInfo.kind,
        group: typeInfo.group,
        field: typeInfo.field,
        color: typeInfo.color,
        typeLabel: typeInfo.label,
      });
    }
    return result;
  }

  /** Count installed sensors. */
  countInstalled() {
    return Object.values(this.slots).filter(Boolean).length;
  }

  /**
   * Produce sensor definitions compatible with the rest of the codebase.
   * Each entry has: id, kind, label, name, side, offset, dir,
   * displayAngle, angle, region, field, group, defaultEnabled.
   */
  toDefinitions() {
    return this.getInstalled().map(s => ({
      id: s.slotId,
      kind: s.kind,
      label: s.typeLabel,
      name: s.name,
      side: s.side,
      offset: s.offset,
      dir: dirFromOffset(s.offset),
      displayAngle: s.displayAngle,
      angle: s.displayAngle,
      region: s.region,
      field: s.field,
      group: s.group,
      defaultEnabled: true,
    }));
  }

  toJSON() {
    // Serialize every slot, including the ones the player has explicitly
    // emptied. Dropping nulls would make a removed sensor indistinguishable
    // from an unconfigured slot on reload, so the constructor would silently
    // refill it with the canonical default — destroying the player's layout.
    return { version: 3, slots: { ...this.slots } };
  }

  static fromJSON(data) {
    if (!data) return SensorConfig.createDefault();
    if (data.version === 3 && data.slots) return new SensorConfig(data.slots);
    // Older formats (v1 nematode array, v2 nematode slots) are incompatible
    // with the ant anatomy — discard and return the ant default.
    return SensorConfig.createDefault();
  }
}
