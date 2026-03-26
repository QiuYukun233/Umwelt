import { CONFIG } from "../config.js";

export class Topbar {
  constructor(environmentState, callbacks = {}) {
    this.environmentState = environmentState;
    this.callbacks = callbacks;
    this.textCache = new WeakMap();
    this.r = {
      alive: document.getElementById("alive-time"),
      food: document.getElementById("food-count"),
      generation: document.getElementById("generation"),
      pauseBtn: document.getElementById("pause-btn"),
      speedButtons: [...document.querySelectorAll(".speed-btn")],
      behaviorPill: document.getElementById("behavior-pill"),
      envBtn: document.getElementById("env-btn"),
      envPanel: document.getElementById("env-panel"),
      foodDensity: document.getElementById("food-density"),
      dangerDensity: document.getElementById("danger-density"),
      foodDensityLabel: document.getElementById("food-density-label"),
      dangerDensityLabel: document.getElementById("danger-density-label"),
      envApplyBtn: document.getElementById("env-apply-btn"),
      restartBtn: document.getElementById("restart-btn"),
      resetConnectionsBtn: document.getElementById("reset-connections-btn"),
      themeBtn: document.getElementById("theme-btn")
    };
    this.r.foodDensity.max = String(CONFIG.ENV_FOOD_MAX);
    this.r.dangerDensity.max = String(CONFIG.ENV_DANGER_MAX);
    this.bind();
    this.setEnvironmentDraft(environmentState.draftFoodDensity, environmentState.draftDangerDensity);
  }

  bind() {
    this.r.pauseBtn.addEventListener("click", () => this.callbacks.onPause?.());
    this.r.restartBtn.addEventListener("click", () => this.callbacks.onRestart?.());
    this.r.resetConnectionsBtn.addEventListener("click", () => this.callbacks.onResetConnections?.());
    this.r.themeBtn.addEventListener("click", () => this.callbacks.onTheme?.(document.documentElement.dataset.theme = document.documentElement.dataset.theme === "light" ? "dark" : "light"));
    this.r.envBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleEnvironmentPanel();
    });
    this.r.foodDensity.addEventListener("input", () => {
      this.environmentState.draftFoodDensity = Number(this.r.foodDensity.value);
      this.syncEnvironmentLabels();
    });
    this.r.dangerDensity.addEventListener("input", () => {
      this.environmentState.draftDangerDensity = Number(this.r.dangerDensity.value);
      this.syncEnvironmentLabels();
    });
    this.r.envApplyBtn.addEventListener("click", () => {
      this.callbacks.onApplyEnvironment?.(Number(this.r.foodDensity.value), Number(this.r.dangerDensity.value));
      this.toggleEnvironmentPanel(false);
    });
    for (const button of this.r.speedButtons) button.addEventListener("click", () => this.callbacks.onSpeed?.(Number(button.dataset.speed)));
    document.addEventListener("keydown", (event) => {
      const tag = event.target?.tagName;
      if (event.code === "Space" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "BUTTON") {
        event.preventDefault();
        this.callbacks.onPause?.();
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (!this.r.envPanel.classList.contains("show")) return;
      if (event.target.closest("#env-panel") || event.target.closest("#env-btn")) return;
      this.toggleEnvironmentPanel(false);
    });
  }

  setText(node, value) {
    if (this.textCache.get(node) === value) return;
    this.textCache.set(node, value);
    node.textContent = value;
  }

  toggleEnvironmentPanel(force) {
    const next = typeof force === "boolean" ? force : !this.r.envPanel.classList.contains("show");
    this.r.envPanel.classList.toggle("show", next);
    this.r.envBtn.classList.toggle("on", next);
  }

  setEnvironmentDraft(foodCount, dangerCount) {
    this.environmentState.draftFoodDensity = foodCount;
    this.environmentState.draftDangerDensity = dangerCount;
    this.r.foodDensity.value = String(foodCount);
    this.r.dangerDensity.value = String(dangerCount);
    this.syncEnvironmentLabels();
  }

  syncEnvironmentLabels() {
    this.setText(this.r.foodDensityLabel, `食物 ×${this.r.foodDensity.value}`);
    this.setText(this.r.dangerDensityLabel, `威胁 ×${this.r.dangerDensity.value}`);
  }

  setPaused(paused) {
    this.setText(this.r.pauseBtn, paused ? "▶ 运行" : "暂停");
  }

  setSpeed(speed) {
    for (const button of this.r.speedButtons) button.classList.toggle("active", Number(button.dataset.speed) === speed);
  }

  renderBehavior(behavior) {
    this.setText(this.r.behaviorPill, behavior.name);
  }

  renderStats(world) {
    this.setText(this.r.alive, world.alive.toFixed(1));
    this.setText(this.r.food, String(world.foodEaten));
    this.setText(this.r.generation, String(world.generation));
  }
}
