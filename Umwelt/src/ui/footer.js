import { SENSOR_BY_ID } from "../config.js";
import { formatPct } from "../math.js";

export class Footer {
  constructor() {
    this.textCache = new WeakMap();
    this.widthCache = new WeakMap();
    this.stateRows = new Map();
    this.stateDefs = [];
    this.stateSignature = "";
    this.logCount = 0;
    this.emptyLogNode = document.createElement("div");
    this.emptyLogNode.className = "log-item";
    this.emptyLogNode.textContent = "暂无事件";
    this.r = {
      logList: document.getElementById("log-list"),
      stateBars: document.getElementById("state-bars"),
      bars: {
        leftChemA:     [document.getElementById("bar-left-chem-a"),  document.getElementById("val-left-chem-a")],
        rightChemA:    [document.getElementById("bar-right-chem-a"), document.getElementById("val-right-chem-a")],
        motor_forward: [document.getElementById("bar-forward"),      document.getElementById("val-forward")],
        motor_turn_L:  [document.getElementById("bar-turn-l"),       document.getElementById("val-turn-l")],
        motor_turn_R:  [document.getElementById("bar-turn-r"),       document.getElementById("val-turn-r")],
        speed:         [document.getElementById("bar-speed"),        document.getElementById("val-speed")],
        energy:        [document.getElementById("bar-energy"),       document.getElementById("val-energy")]
      }
    };
    this.resetLog();
  }

  setText(node, value) {
    if (this.textCache.get(node) === value) return;
    this.textCache.set(node, value);
    node.textContent = value;
  }

  setWidth(node, value) {
    const width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
    if (this.widthCache.get(node) === width) return;
    this.widthCache.set(node, width);
    node.style.width = width;
  }

  renderBehavior() {}

  renderMetrics(metrics) {
    const rows = [
      ["leftChemA",     metrics.leftChemA ?? 0],
      ["rightChemA",    metrics.rightChemA ?? 0],
      ["motor_forward", metrics.motor_forward ?? 0],
      ["motor_turn_L",  metrics.motor_turn_L ?? 0],
      ["motor_turn_R",  metrics.motor_turn_R ?? 0],
      ["speed",         metrics.speed ?? 0],
      ["energy",        metrics.energy ?? 0],
    ];
    for (const [key, value] of rows) {
      const bar = this.r.bars[key];
      if (!bar) continue;
      this.setWidth(bar[0], value);
      this.setText(bar[1], formatPct(value));
    }
  }

  ensureStateRows(sensorEnabled) {
    const sensorColor = (kind) => {
      if (kind === "chem_A") return "var(--mint)";
      if (kind === "chem_D") return "var(--red)";
      if (kind === "chem_B" || kind === "chem_C") return "var(--amber)";
      if (kind === "touch") return "var(--blue, #5a9ac4)";
      if (kind === "light") return "var(--brown)";
      return "var(--mint)";
    };
    const defs = [
      ...Object.keys(sensorEnabled).filter((id) => sensorEnabled[id])
        .map((id) => ({ id, label: SENSOR_BY_ID[id]?.label ?? id, color: sensorColor(SENSOR_BY_ID[id]?.kind) })),
      { id: "energy", label: "内⊘能", color: "var(--brown)" },
      { id: "damage", label: "内⊘伤", color: "var(--red)" },
      { id: "motor_forward", label: "→进", color: "var(--amber)" },
      { id: "motor_turn_L",  label: "→左", color: "var(--amber)" },
      { id: "motor_turn_R",  label: "→右", color: "var(--amber)" },
      { id: "gland_alpha",   label: "→腺α", color: "var(--amber)" },
      { id: "gland_beta",    label: "→腺β", color: "var(--amber)" },
      { id: "mandible",      label: "→颚", color: "var(--amber)" },
      { id: "speed", label: "V", color: "var(--brown)" },
      { id: "turn",  label: "ω", color: "var(--red)" }
    ];
    const signature = defs.map((def) => `${def.id}:${def.label}`).join("|");
    if (signature === this.stateSignature) return;
    this.stateSignature = signature;
    this.stateDefs = defs;
    this.stateRows.clear();
    const fragment = document.createDocumentFragment();
    for (const def of defs) {
      const row = document.createElement("div");
      row.className = "state-row";
      row.innerHTML = `<span class="state-key">${def.label}</span><div class="state-track"><div class="state-fill" style="background:${def.color}"></div></div><span class="state-val">0</span>`;
      const [, track, value] = row.children;
      fragment.appendChild(row);
      this.stateRows.set(def.id, { fill: track.firstElementChild, value });
    }
    this.r.stateBars.replaceChildren(fragment);
  }

  renderStateData(metrics, sensorEnabled) {
    this.ensureStateRows(sensorEnabled);
    const PROPRIO_IDS = new Set(["energy", "damage"]);
    for (const def of this.stateDefs) {
      const refs = this.stateRows.get(def.id);
      if (!refs) continue;
      const sensorValue = metrics.sensorOutputs?.[def.id];
      const isSensor = !!SENSOR_BY_ID[def.id];
      const isProprio = PROPRIO_IDS.has(def.id);
      const value = isSensor
        ? Math.abs(sensorValue ?? 0)
        : isProprio
          ? (sensorValue ?? metrics[def.id] ?? 0)
          : def.id === "turn"
            ? (metrics.turn ?? 0)
            : (metrics[def.id] ?? 0);
      const label = (isSensor || isProprio)
        ? (sensorValue ?? metrics[def.id] ?? 0).toFixed(2)
        : def.id === "turn"
          ? (metrics.turnSigned ?? 0).toFixed(2)
          : formatPct(value);
      this.setWidth(refs.fill, value);
      this.setText(refs.value, label);
    }
  }

  resetLog() {
    this.logCount = 0;
    this.r.logList.replaceChildren(this.emptyLogNode.cloneNode(true));
  }

  syncLog(logItems) {
    if (this.logCount === 0 && logItems.length) this.r.logList.replaceChildren();
    for (let index = this.logCount; index < logItems.length; index += 1) {
      const item = logItems[index];
      const row = document.createElement("div");
      row.className = `log-item ${item.tone}`;
      row.textContent = item.text;
      this.r.logList.appendChild(row);
    }
    if (logItems.length !== this.logCount) {
      this.logCount = logItems.length;
      this.r.logList.scrollTop = this.r.logList.scrollHeight;
    }
  }
}
