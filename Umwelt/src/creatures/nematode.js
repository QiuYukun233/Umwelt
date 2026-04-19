/**
 * Nematode (线虫) creature definition.
 *
 * Sensor directions are expressed in body coordinates:
 *   dir = [forward, dorsal, lateral]
 * where lateral = forward × dorsal (points to the worm's right).
 *
 * At runtime, the engine converts these to world-space using the
 * worm's current forward / dorsal vectors, then projects to the
 * ground plane for chemical-field sampling.
 */

export const NEMATODE = {
  id: "nematode",
  name: "线虫",
  description: "最简单的神经动物，通过背腹弯曲在化学世界中觅食",

  sensors: [
    // ── food (⊕) ──
    { id: "F0", kind: "food",   label: "⊕前", name: "前方", dir: [1,  0,  0], displayAngle: 0,               side: "center", defaultEnabled: true },
    { id: "F1", kind: "food",   label: "⊕右", name: "右侧", dir: [0,  0, -1], displayAngle:  Math.PI / 3,    side: "right",  defaultEnabled: true },
    { id: "F2", kind: "food",   label: "⊕背", name: "背侧", dir: [0,  1,  0], displayAngle:  Math.PI * 2/3,  side: "center", defaultEnabled: false },
    { id: "F3", kind: "food",   label: "⊕腹", name: "腹侧", dir: [0, -1,  0], displayAngle: -Math.PI * 2/3,  side: "center", defaultEnabled: false },
    { id: "F5", kind: "food",   label: "⊕左", name: "左侧", dir: [0,  0,  1], displayAngle: -Math.PI / 3,    side: "left",   defaultEnabled: true },

    // ── threat (⊗) ──
    { id: "T0", kind: "threat", label: "⊗前", name: "前方", dir: [1,  0,  0], displayAngle: 0,               side: "center", defaultEnabled: true },
    { id: "T1", kind: "threat", label: "⊗右", name: "右侧", dir: [0,  0, -1], displayAngle:  Math.PI / 3,    side: "right",  defaultEnabled: true },
    { id: "T2", kind: "threat", label: "⊗背", name: "背侧", dir: [0,  1,  0], displayAngle:  Math.PI * 2/3,  side: "center", defaultEnabled: false },
    { id: "T3", kind: "threat", label: "⊗腹", name: "腹侧", dir: [0, -1,  0], displayAngle: -Math.PI * 2/3,  side: "center", defaultEnabled: false },
    { id: "T5", kind: "threat", label: "⊗左", name: "左侧", dir: [0,  0,  1], displayAngle: -Math.PI / 3,    side: "left",   defaultEnabled: true },
  ],

  proprio: [
    { id: "P_turn",   kind: "proprio", label: "∿转", name: "转速传感器", side: "center", alwaysOn: true },
    { id: "P_speed",  kind: "proprio", label: "∿速", name: "速度传感器", side: "center", alwaysOn: true },
    { id: "P_hunger", kind: "proprio", label: "∿饥", name: "饥饿传感器", side: "center", alwaysOn: true },
  ],

  motors: [
    { id: "forward",      label: "→进", name: "前进" },
    { id: "backward",     label: "→退", name: "后退" },
    { id: "dorsalBend",   label: "→背", name: "背弯" },
    { id: "ventralBend",  label: "→腹", name: "腹弯" },
  ],

  neuronPrefixes: {
    inter_exc: "E",
    inter_inh: "I",
    modulator: "M",
  },

  bodyDefaults: {
    turnScale: 1.0,
    speedScale: 1.0,
  },
};
