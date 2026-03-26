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
      behaviorName: document.getElementById("behavior-name"),
      behaviorDesc: document.getElementById("behavior-desc"),
      stateBars: document.getElementById("state-bars"),
      bars: {
        leftEye: [document.getElementById("bar-left-eye"), document.getElementById("val-left-eye")],
        rightEye: [document.getElementById("bar-right-eye"), document.getElementById("val-right-eye")],
        leftLeg: [document.getElementById("bar-left-leg"), document.getElementById("val-left-leg")],
        rightLeg: [document.getElementById("bar-right-leg"), document.getElementById("val-right-leg")],
        speed: [document.getElementById("bar-speed"), document.getElementById("val-speed")],
        energy: [document.getElementById("bar-energy"), document.getElementById("val-energy")]
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

  renderBehavior(behavior) {
    this.setText(this.r.behaviorName, behavior.name);
    this.setText(this.r.behaviorDesc, behavior.desc);
  }

  renderMetrics(metrics) {
    for (const [key, value, label] of [["leftEye", metrics.leftEye, formatPct(metrics.leftEye)], ["rightEye", metrics.rightEye, formatPct(metrics.rightEye)], ["leftLeg", metrics.leftLeg, formatPct(metrics.leftLeg)], ["rightLeg", metrics.rightLeg, formatPct(metrics.rightLeg)], ["speed", metrics.speed, formatPct(metrics.speed)], ["energy", metrics.energy, formatPct(metrics.energy)]]) {
      this.setWidth(this.r.bars[key][0], value);
      this.setText(this.r.bars[key][1], label);
    }
  }

  ensureStateRows(sensorEnabled, sensorModes) {
    const defs = [
      ...Object.keys(sensorEnabled).filter((id) => sensorEnabled[id]).map((id) => ({ id, label: `${SENSOR_BY_ID[id].label}${sensorModes[id] === "diff" ? "∂" : ""}`, color: SENSOR_BY_ID[id].kind === "food" ? "var(--mint)" : "var(--red)" })),
      { id: "P_turn", label: "PT", color: "var(--brown)" }, { id: "P_speed", label: "PV", color: "var(--brown)" }, { id: "N_noise", label: "NZ", color: "var(--amber)" },
      { id: "leftLeg", label: "L", color: "var(--amber)" }, { id: "rightLeg", label: "R", color: "var(--amber)" }, { id: "speed", label: "V", color: "var(--brown)" }, { id: "turn", label: "ω", color: "var(--red)" }
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

  renderStateData(metrics, sensorEnabled, sensorModes) {
    this.ensureStateRows(sensorEnabled, sensorModes);
    for (const def of this.stateDefs) {
      const refs = this.stateRows.get(def.id);
      if (!refs) continue;
      const sensorValue = metrics.sensorOutputs?.[def.id];
      const value = SENSOR_BY_ID[def.id] ? Math.abs(sensorValue ?? 0) : def.id === "P_turn" || def.id === "P_speed" || def.id === "N_noise" ? (sensorValue ?? 0) : def.id === "turn" ? (metrics.turn ?? 0) : (metrics[def.id] ?? 0);
      const label = SENSOR_BY_ID[def.id] || def.id.startsWith("P_") || def.id === "N_noise" ? (sensorValue ?? 0).toFixed(2) : def.id === "turn" ? (metrics.turnSigned ?? 0).toFixed(2) : formatPct(value);
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
