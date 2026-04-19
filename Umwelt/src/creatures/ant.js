/**
 * Ant (蚂蚁) creature definition — per ant-design-spec.md §3 and §4.
 *
 * Sensor directions follow the nematode convention:
 *   dir = [forward, dorsal, lateral]
 * where lateral is forward × dorsal (positive = the ant's LEFT).
 *
 * Antennae project forward at ~45° from the body axis. With dorsal = +z
 * (world-up), lateral = +left in the ground plane. Left-antenna sensors
 * use dir ≈ [cos45°, 0, +sin45°]; right-antenna sensors mirror with −sin45°.
 *
 * Locomotion is transform + forward thrust. Six-leg gait is not modelled
 * (see ant-design-spec.md §4.1): motors are `motor_forward`, `motor_turn_L`,
 * `motor_turn_R`. There is no backward motor — real ants rarely reverse.
 *
 * Chemical channels are named ChemA/B/C/D with no semantic labels:
 *   ChemA = environmental food source
 *   ChemB = gland_α secretion (ground deposit)
 *   ChemC = gland_β secretion (air-volatile)
 *   ChemD = environmental danger source
 * System does NOT tag these with meanings like "pheromone" or "alarm" —
 * those are emergent interpretations, not definitions.
 */

const ANGLE = Math.PI / 4; // ~45° antennal fan
const FX = Math.cos(ANGLE);
const LAT = Math.sin(ANGLE);

// Left antenna direction: forward-left in body frame
const L_DIR = [FX, 0,  LAT];
// Right antenna direction: forward-right
const R_DIR = [FX, 0, -LAT];

// Screen display angle (0 = up/forward, + = clockwise). Left = negative.
const L_ANG = -ANGLE;
const R_ANG =  ANGLE;

function chemSensor(side, chem) {
  const isLeft = side === "L";
  return {
    id: `${side}_chem_${chem}`,
    kind: `chem_${chem}`,                  // per-chemical kind tag
    label: `${side}⊕${chem}`,
    name: `${isLeft ? "左" : "右"}触角 Chem${chem}`,
    dir: isLeft ? L_DIR : R_DIR,
    displayAngle: isLeft ? L_ANG : R_ANG,
    side: isLeft ? "left" : "right",
    region: "antenna",
    sampling: "cone",                      // cone sampling from chemical field
    field: `chem_${chem}`,                 // reads ChemA/B/C/D field
    defaultEnabled: true,
  };
}

function touchSensor(side) {
  const isLeft = side === "L";
  return {
    id: `${side}_touch`,
    kind: "touch",
    label: `${side}≋触`,
    name: `${isLeft ? "左" : "右"}触角机械感受`,
    dir: isLeft ? L_DIR : R_DIR,
    displayAngle: isLeft ? L_ANG : R_ANG,
    side: isLeft ? "left" : "right",
    region: "antenna",
    sampling: "point_binary",              // 1.0 on contact, else 0.0
    field: "touch",
    defaultEnabled: true,
  };
}

export const ANT = {
  id: "ant",
  name: "蚂蚁",
  description: "六足昆虫，二维平面移动，左右触角对化学场敏感",

  // ── external sensors (14 channels across antennae / mouth / eye) ──
  // Not in this list: body-internal state (see `proprio` below).
  sensors: [
    // § 3.1 antennal chemoreception — 8 channels (L/R × ChemA/B/C/D)
    chemSensor("L", "A"),
    chemSensor("L", "B"),
    chemSensor("L", "C"),
    chemSensor("L", "D"),
    chemSensor("R", "A"),
    chemSensor("R", "B"),
    chemSensor("R", "C"),
    chemSensor("R", "D"),

    // § 3.2 antennal mechanoreception — 2 channels
    touchSensor("L"),
    touchSensor("R"),

    // § 3.3 mouth contact chemoreception — 1 channel
    // Reads the chemical signature of whatever the mandibles are clamped on.
    {
      id: "mouth_chem",
      kind: "taste",
      label: "口⊕味",
      name: "口器接触化学感受",
      dir: [1, 0, 0],
      displayAngle: 0,
      side: "center",
      region: "mouth",
      sampling: "contact",
      field: "mouth_taste",
      defaultEnabled: true,
    },

    // § 3.4 light — 1 channel (brightness only, no direction)
    {
      id: "light",
      kind: "light",
      label: "眼⊙光",
      name: "光感受",
      dir: [0, 1, 0],                      // upward-facing (dorsal)
      displayAngle: 0,
      side: "center",
      region: "head",
      sampling: "ambient",
      field: "light",
      defaultEnabled: true,
    },
  ],

  // § 3.5 body-internal state — 2 channels, always on (no external direction).
  // Per nematode convention these live in `proprio`, not `sensors`.
  proprio: [
    {
      id: "energy",
      kind: "interoceptive",
      label: "内⊘能",
      name: "能量储备",
      side: "center",
      alwaysOn: true,
      // 1.0 = full glycogen stores, 0.0 = depleted. Decays with metabolism,
      // rises with feeding. Not a "hunger" semantic — it is a body quantity.
    },
    {
      id: "damage",
      kind: "nociceptive",
      label: "内⊘伤",
      name: "伤害感受",
      side: "center",
      alwaysOn: true,
      // Active when tissue is being harmed (e.g., immersed in ChemD above
      // threshold). Not "pain" — just a nociceptor firing rate.
    },
  ],

  // ── motors (6 channels) per § 4 ──
  motors: [
    // § 4.1 locomotion — no backward (精简)
    { id: "motor_forward", label: "→进", name: "前进", group: "locomotion" },
    { id: "motor_turn_L",  label: "→左", name: "左转", group: "locomotion" },
    { id: "motor_turn_R",  label: "→右", name: "右转", group: "locomotion" },

    // § 4.2 glands — each gland writes its own ChemB/ChemC into the field.
    // Capacity / recovery parameters live on the world-side implementation;
    // the neural motor just emits the demand signal 0..1.
    {
      id: "gland_alpha",
      label: "→腺α",
      name: "腹部腺体 α",
      group: "gland",
      writes: "chem_B",                    // ground-deposit, low diffusion
    },
    {
      id: "gland_beta",
      label: "→腺β",
      name: "大颚腺 β",
      group: "gland",
      writes: "chem_C",                    // air-volatile, high diffusion
    },

    // § 4.3 mandible — physical clamp. Grips whatever it meets; the system
    // does not distinguish feeding / carrying / attacking semantically.
    { id: "mandible", label: "→颚", name: "大颚", group: "mandible" },
  ],

  neuronPrefixes: {
    inter_exc: "E",
    inter_inh: "I",
    modulator: "M",
  },

  bodyDefaults: {
    turnScale: 1.0,
    speedScale: 1.0,
    // Gland storage (独立 per gland, not global) — see spec §4.2.
    glandAlphaCapacity: 1.0,
    glandAlphaRecovery: 0.02,              // per second
    glandBetaCapacity:  1.0,
    glandBetaRecovery:  0.05,
  },
};
