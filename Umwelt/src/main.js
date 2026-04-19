import "./style.css";
import { CONFIG, LOGIC_CANVAS, createEnvironmentState, buildSourceDefinitions, buildSensorMaps, buildDefaultConnections } from "./config.js";
import { WorldRenderer } from "./renderer/world.js";
import { cloneSensorEnabled, inferBehavior, NeuralGraph } from "./neural.js";
import { World } from "./world.js";
import { Topbar } from "./ui/topbar.js";
import { Footer } from "./ui/footer.js";
import { DeathOverlay } from "./ui/death.js";
import { Sidebar } from "./ui/sidebar.js";
import { SensorConfig } from "./sensor-config.js";
import { ACTIVE_CREATURE } from "./creatures/index.js";

const STORAGE_KEY = "umwelt_circuit";
const STORAGE_VERSION = 6; // bumped: ant anatomy (12 slots + 2 proprio, 6 motors)

class App {
  constructor() {
    this.creature = ACTIVE_CREATURE;        // ant; runtime wiring migrates step-by-step
    this.environmentState = createEnvironmentState();
    this.sensorConfig = SensorConfig.createDefault();
    this.rebuildDerived();
    this.sensorEnabled = cloneSensorEnabled(undefined, this.sensorDefs);
    this.connections = buildDefaultConnections(this.sensorDefs);
    this.behavior = inferBehavior(this.connections, this.sensorEnabled, this.sensorDefs);
    this.paused = false;
    this.speed = 1;
    this.accumulator = 0;
    this.lastTime = 0;
    this.deathShown = false;
    this.pauseOverlay = document.getElementById("pause-overlay");
    this.world = new World(this.environmentState);
    this.world.setSensorDefs(this.sensorDefs, this.sourceOrder, this.sensorOrder);
    this.graph = new NeuralGraph();
    if (!this.loadCircuit()) {
      this.graph.reset(LOGIC_CANVAS.width, LOGIC_CANVAS.height);
    }
    this.connections = this.graph.toConnectionsObject();
    this.behavior = inferBehavior(this.connections, this.sensorEnabled, this.sensorDefs);
    this.worldRenderer = new WorldRenderer(document.getElementById("world"), this.world);
    this.topbar = new Topbar(this.environmentState, {
      onPause: () => this.togglePause(),
      onRestart: () => this.restart(),
      onResetConnections: () => this.resetCircuit(),
      onTheme: () => this.refreshTheme(),
      onSpeed: (speed) => { this.speed = speed; this.topbar.setSpeed(speed); },
      onApplyEnvironment: (food, danger) => this.applyEnvironment(food, danger)
    });
    this.footer = new Footer();
    this.death = new DeathOverlay({ onRestart: () => this.restart() });
    this.sidebar = new Sidebar({
      onEdit: () => this.openEditor(),
      onRun: () => this.setPausedState(false),
      onReset: () => this.resetCircuit(),
      onGraphChange: () => this.handleGraphChange(),
      onToggleSensor: (id) => this.toggleSensor(id),
      onBodyParams: (params) => this.applyBodyParams(params),
      onExport: () => this.exportCircuit(),
      onImport: (text) => this.importCircuit(text),
      onSensorConfigChange: (config) => this.applySensorConfig(config)
    });
    this.sidebar.setGraph(this.graph);
    this.sidebar.editor.setBodyParams(this.world.bodyParams);
    this.sidebar.setSensorConfig(this.sensorConfig);
    this.sidebar.rebuildSensors(this.sensorDefs);   // match loaded config
    this.refreshMetricsSnapshot();
    this.saveCircuit();
    this.topbar.renderBehavior(this.behavior);
    this.topbar.setSpeed(this.speed);
    this.topbar.renderStats(this.world);
    this.footer.renderBehavior(this.behavior);
    this.footer.renderMetrics(this.world.metrics);
    this.footer.renderStateData(this.world.metrics, this.sensorEnabled);
    this.resize();
    window.addEventListener("resize", () => this.resize());
    requestAnimationFrame((timestamp) => this.loop(timestamp));
  }

  /** Recompute all derived data from the current sensorConfig. */
  rebuildDerived() {
    this.sensorDefs = this.sensorConfig.toDefinitions();
    this.sourceDefs = buildSourceDefinitions(this.sensorDefs);
    const maps = buildSensorMaps(this.sensorDefs);
    this.sensorOrder = maps.SENSOR_ORDER;
    this.sourceOrder = maps.SOURCE_ORDER;
  }

  /**
   * Install a new SensorConfig and refresh every piece of state that
   * depends on the sensor layout: derived maps, world sampling, sidebar
   * views, neural-graph anchors. Does NOT touch `sensorEnabled` — the
   * caller decides whether to preserve or overwrite that (e.g. body
   * editor preserves, import replaces). Does NOT persist either —
   * callers follow up with their own bookkeeping + saveCircuit.
   */
  _installSensorConfig(config) {
    this.sensorConfig = config;
    this.rebuildDerived();
    this.world.setSensorDefs(this.sensorDefs, this.sourceOrder, this.sensorOrder);
    this.sidebar.rebuildSensors(this.sensorDefs);
    this.sidebar.setSensorConfig(this.sensorConfig);
    this.graph.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, false, this.sourceDefs);
  }

  /** Called when the sensor config changes (from body editor). */
  applySensorConfig(config) {
    this._installSensorConfig(config);
    // Preserve the current on/off flags across the new layout.
    this.sensorEnabled = cloneSensorEnabled(this.sensorEnabled, this.sensorDefs);
    this.connections = this.graph.toConnectionsObject();
    this.behavior = inferBehavior(this.connections, this.sensorEnabled, this.sensorDefs);
    this.topbar.renderBehavior(this.behavior);
    this.footer.renderBehavior(this.behavior);
    this.refreshMetricsSnapshot();
    this.saveCircuit();
  }

  evaluateCircuit(sourceOutputs, commit = false, dt = CONFIG.FIXED_DT) {
    const { nodeSignals, edgeSignals } = this.graph.computeSignals(sourceOutputs, this.sensorEnabled, { commit, dt });
    const motorInputs = this.graph.getMotorOutputs(nodeSignals);
    const motorLevels = this.world.resolveMotorLevels(motorInputs);
    return { nodeSignals, edgeSignals, motorInputs, motorLevels };
  }

  refreshMetricsSnapshot() {
    const sensorOutputs = this.world.previewSourceOutputs(this.sensorEnabled, CONFIG.FIXED_DT, this.sensorDefs, this.sourceOrder);
    const sensorDrain = this.sensorOrder.reduce((sum, id) => sum + (this.sensorEnabled[id] ? Math.abs(sensorOutputs[id] ?? 0) : 0), 0) * CONFIG.SENSOR_ENERGY_COST;
    const evaluation = this.evaluateCircuit(sensorOutputs, false, CONFIG.FIXED_DT);
    const motors = evaluation.motorLevels;
    const bp = this.world.bodyParams;
    const turnSigned = ((motors.motor_turn_L ?? 0) - (motors.motor_turn_R ?? 0)) * CONFIG.TURN_GAIN * bp.turnScale;
    this.circuitFrame = { ...evaluation, sourceOutputs: sensorOutputs };
    this.sidebar.setEvaluation(this.circuitFrame);
    this.sidebar.setSensorState(this.sensorEnabled);
    // L/R summary across ChemA (food analogue) and ChemD (danger analogue).
    const sideMax = (kind, side) => this.sensorDefs
      .filter(s => s.kind === kind && s.side === side)
      .reduce((m, s) => Math.max(m, sensorOutputs[s.id] ?? 0), 0);
    this.world.metrics = {
      sensorOutputs,
      leftChemA:  sideMax("chem_A", "left"),
      rightChemA: sideMax("chem_A", "right"),
      leftChemD:  sideMax("chem_D", "left"),
      rightChemD: sideMax("chem_D", "right"),
      motor_forward: motors.motor_forward,
      motor_turn_L:  motors.motor_turn_L,
      motor_turn_R:  motors.motor_turn_R,
      gland_alpha:   motors.gland_alpha,
      gland_beta:    motors.gland_beta,
      mandible:      motors.mandible,
      speed: this.world.metrics.speed,
      energy: Math.max(0, Math.min(1, this.world.ant.energy / CONFIG.MAX_ENERGY)),
      turn: Math.max(0, Math.min(1, Math.abs(turnSigned) / (CONFIG.TURN_GAIN * bp.turnScale * 1.1))),
      turnSigned,
      sensorDrain
    };
  }

  handleGraphChange() {
    this.connections = this.graph.toConnectionsObject();
    this.behavior = inferBehavior(this.connections, this.sensorEnabled, this.sensorDefs);
    this.topbar.renderBehavior(this.behavior);
    this.footer.renderBehavior(this.behavior);
    this.refreshMetricsSnapshot();
    this.saveCircuit();
  }

  resize() {
    this.worldRenderer.resize();
    this.sidebar.resize();
    this.refreshMetricsSnapshot();
    this.sidebar.editor.fitView();
  }

  refreshTheme() {
    this.worldRenderer.refreshTheme();
    this.sidebar.refreshTheme();
  }

  toggleSensor(id) {
    this.sensorEnabled[id] = !this.sensorEnabled[id];
    this.connections = this.graph.toConnectionsObject();
    this.behavior = inferBehavior(this.connections, this.sensorEnabled, this.sensorDefs);
    this.topbar.renderBehavior(this.behavior);
    this.footer.renderBehavior(this.behavior);
    this.refreshMetricsSnapshot();
    this.saveCircuit();
  }

  resetCircuit() {
    this.sensorConfig = SensorConfig.createDefault();
    this.rebuildDerived();
    this.world.setSensorDefs(this.sensorDefs, this.sourceOrder, this.sensorOrder);
    this.sensorEnabled = cloneSensorEnabled(undefined, this.sensorDefs);
    this.world.bodyParams = { turnScale: 1.0, speedScale: 1.0 };
    this.sidebar.editor.setBodyParams(this.world.bodyParams);
    this.sidebar.setSensorConfig(this.sensorConfig);
    this.sidebar.rebuildSensors(this.sensorDefs);
    this.graph.reset(LOGIC_CANVAS.width, LOGIC_CANVAS.height);
    this.connections = this.graph.toConnectionsObject();
    this.behavior = inferBehavior(this.connections, this.sensorEnabled, this.sensorDefs);
    this.topbar.renderBehavior(this.behavior);
    this.footer.renderBehavior(this.behavior);
    this.sidebar.editor.fitView();
    this.refreshMetricsSnapshot();
    this.saveCircuit();
  }

  restart() {
    const savedBody = { ...this.world.bodyParams };
    this.world.reset({ incrementGeneration: true });
    this.world.bodyParams = savedBody;
    this.graph.resetState();
    this.refreshMetricsSnapshot();
    this.deathShown = false;
    this.accumulator = 0;
    this.death.hide();
    this.footer.resetLog();
    this.topbar.renderStats(this.world);
    this.footer.renderMetrics(this.world.metrics);
    this.footer.renderStateData(this.world.metrics, this.sensorEnabled);
    this.setPausedState(true);
  }

  applyBodyParams(params) {
    this.world.bodyParams.turnScale = params.turnScale;
    this.world.bodyParams.speedScale = params.speedScale;
    this.refreshMetricsSnapshot();
    this.saveCircuit();
  }

  applyEnvironment(foodCount, dangerCount) {
    this.topbar.setEnvironmentDraft(foodCount, dangerCount);
    this.environmentState.foodDensity = foodCount;
    this.environmentState.dangerDensity = dangerCount;
    if (this.world.dead) return this.restart();
    this.world.applyEnvironment(foodCount, dangerCount);
    this.refreshMetricsSnapshot();
  }

  setPausedState(paused) {
    if (this.world.dead && paused) return;
    this.paused = paused;
    this.topbar.setPaused(paused);
    this.pauseOverlay.classList.toggle("show", paused);
    this.sidebar.setEditorOpen(paused);
  }

  openEditor() {
    if (!this.world.dead) this.setPausedState(true);
  }

  togglePause() {
    if (!this.world.dead) this.setPausedState(!this.paused);
  }

  saveCircuit() {
    try {
      const data = {
        version: STORAGE_VERSION,
        graph: this.graph.serialize(),
        sensorEnabled: { ...this.sensorEnabled },
        bodyParams: { ...this.world.bodyParams },
        sensorConfig: this.sensorConfig.toJSON()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (_) { /* quota exceeded or private mode — silent */ }
  }

  loadCircuit() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if ((data.version ?? 1) < STORAGE_VERSION) {
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }
      // Restore sensor config
      if (data.sensorConfig) {
        this.sensorConfig = SensorConfig.fromJSON(data.sensorConfig);
        this.rebuildDerived();
        this.world.setSensorDefs(this.sensorDefs, this.sourceOrder, this.sensorOrder);
      }
      this.graph.deserialize(data.graph);
      this.graph.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, false, this.sourceDefs);
      if (data.sensorEnabled) this.sensorEnabled = cloneSensorEnabled(data.sensorEnabled, this.sensorDefs);
      if (data.bodyParams) {
        this.world.bodyParams = { turnScale: data.bodyParams.turnScale ?? 1, speedScale: data.bodyParams.speedScale ?? 1 };
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  exportCircuit() {
    const data = {
      graph: this.graph.serialize(),
      sensorEnabled: { ...this.sensorEnabled },
      bodyParams: { ...this.world.bodyParams },
      sensorConfig: this.sensorConfig.toJSON()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `umwelt-circuit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importCircuit(text) {
    try {
      const data = JSON.parse(text);
      if (!data.graph) return;
      if (data.sensorConfig) {
        // Go through the shared install path so the sidebar 3D view,
        // the body editor's sensorConfig reference, and the graph
        // anchors all line up with the imported layout.
        this._installSensorConfig(SensorConfig.fromJSON(data.sensorConfig));
      }
      this.graph.deserialize(data.graph);
      this.graph.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, false, this.sourceDefs);
      if (data.sensorEnabled) this.sensorEnabled = cloneSensorEnabled(data.sensorEnabled, this.sensorDefs);
      if (data.bodyParams) {
        this.world.bodyParams = { turnScale: data.bodyParams.turnScale ?? 1, speedScale: data.bodyParams.speedScale ?? 1 };
        this.sidebar.editor.setBodyParams(this.world.bodyParams);
      }
      this.connections = this.graph.toConnectionsObject();
      this.behavior = inferBehavior(this.connections, this.sensorEnabled, this.sensorDefs);
      this.topbar.renderBehavior(this.behavior);
      this.footer.renderBehavior(this.behavior);
      this.sidebar.editor.fitView();
      this.refreshMetricsSnapshot();
      this.saveCircuit();
    } catch (_) { /* invalid JSON — silent */ }
  }

  loop(timestamp) {
    if (!this.lastTime) this.lastTime = timestamp;
    const delta = Math.min(0.1, (timestamp - this.lastTime) / 1000);
    this.lastTime = timestamp;
    if (!this.paused && !this.world.dead) {
      this.accumulator += delta * this.speed;
      while (this.accumulator >= CONFIG.FIXED_DT) {
        const sourceOutputs = this.world.composeSourceOutputs(this.sensorEnabled, CONFIG.FIXED_DT, true, this.sensorDefs, this.sourceOrder);
        const evaluation = this.evaluateCircuit(sourceOutputs, true, CONFIG.FIXED_DT);
        this.circuitFrame = { ...evaluation, sourceOutputs };
        this.sidebar.setEvaluation(this.circuitFrame);
        this.world.step(CONFIG.FIXED_DT, evaluation.motorInputs, this.sensorEnabled, sourceOutputs);
        this.accumulator -= CONFIG.FIXED_DT;
        if (this.world.dead) break;
      }
    }
    this.topbar.renderStats(this.world);
    this.footer.renderMetrics(this.world.metrics);
    this.footer.renderStateData(this.world.metrics, this.sensorEnabled);
    this.footer.syncLog(this.world.behaviorLog);
    if (this.world.dead) {
      if (!this.deathShown) this.death.show(this.world, this.behavior, this.connections);
      this.deathShown = true;
    } else if (this.deathShown) {
      this.deathShown = false;
      this.death.hide();
    }
    this.worldRenderer.render(timestamp, this.sensorEnabled, this.sensorDefs);
    this.sidebar.render(timestamp, this.graph, this.circuitFrame, this.world.metrics, this.sensorEnabled);
    requestAnimationFrame((next) => this.loop(next));
  }
}

new App();
