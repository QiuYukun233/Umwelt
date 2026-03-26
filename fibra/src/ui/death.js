import { describeConnections } from "../neural.js";
import { formatPct } from "../math.js";

export class DeathOverlay {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.textCache = new WeakMap();
    this.r = {
      overlay: document.getElementById("death-overlay"),
      restartBtn: document.getElementById("restart-btn-overlay"),
      reason: document.getElementById("death-reason"),
      lived: document.getElementById("death-lived"),
      food: document.getElementById("death-food"),
      sense: document.getElementById("death-sense"),
      behavior: document.getElementById("death-behavior")
    };
    this.r.restartBtn.addEventListener("click", () => this.callbacks.onRestart?.());
  }

  setText(node, value) {
    if (this.textCache.get(node) === value) return;
    this.textCache.set(node, value);
    node.textContent = value;
  }

  show(world, behavior, connections) {
    this.r.overlay.classList.add("show");
    this.setText(this.r.reason, world.deathReason);
    this.setText(this.r.lived, `${world.alive.toFixed(1)}s`);
    this.setText(this.r.food, String(world.foodEaten));
    this.setText(this.r.sense, `食物 ${formatPct(world.metrics.leftEye)} / 威胁 ${formatPct(world.metrics.leftThreat)}`);
    this.setText(this.r.behavior, `${behavior.name} · ${behavior.desc} · ${describeConnections(connections)}`);
  }

  hide() {
    this.r.overlay.classList.remove("show");
  }
}
