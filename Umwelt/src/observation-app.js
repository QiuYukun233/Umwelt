/**
 * Observation App — boots the game inside the new observation UI.
 *
 * This is a parallel entry point to main.js. It reuses the same
 * World, NeuralGraph, WorldRenderer, and circuit logic, but renders
 * into the Observation artboard instead of the old grid layout.
 */
// style.css first — provides structural CSS for the shared editor overlay
// and utility classes (.btn, #editor-*, #body-editor-*). observation.css
// loads after (via ui/observation.js) so its token values win in :root.
import "./style.css";
import { CONFIG, LOGIC_CANVAS, createEnvironmentState, buildSourceDefinitions, buildSensorMaps, buildDefaultConnections } from "./config.js";
import { WorldRenderer } from "./renderer/world.js";
import { GraphRenderer } from "./renderer/graph.js";
import { cloneSensorEnabled, inferBehavior, NeuralGraph } from "./neural.js";
import { World } from "./world.js";
import { SensorConfig } from "./sensor-config.js";
import { ACTIVE_CREATURE } from "./creatures/index.js";
import { Observation } from "./ui/observation.js";
import { NeuralEditor } from "./ui/editor.js";

const STORAGE_KEY = "umwelt_circuit";
const STORAGE_VERSION = 6;

class ObservationApp {
  constructor() {
    this.creature = ACTIVE_CREATURE;
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
    this._frameCount = 0;
    this._tickCount = 0;
    this._fpsAccum = 0;
    this._fpsSamples = 0;
    this._currentFps = 60;

    // ── World ──
    this.world = new World(this.environmentState);
    this.world.setSensorDefs(this.sensorDefs, this.sourceOrder, this.sensorOrder);

    // ── Neural graph ──
    this.graph = new NeuralGraph();
    if (!this.loadCircuit()) {
      this.graph.reset(LOGIC_CANVAS.width, LOGIC_CANVAS.height);
    }
    this.connections = this.graph.toConnectionsObject();
    this.behavior = inferBehavior(this.connections, this.sensorEnabled, this.sensorDefs);

    // ── Observation UI ──
    this.obs = new Observation(document.getElementById("obs-root"), {
      initialMode: "visible",
      onModeChange: (mode) => this._onModeChange(mode),
      onEditCircuit: () => this._openEditor(),
    });

    // ── World renderer → observation canvas ──
    this.worldRenderer = new WorldRenderer(this.obs.camCanvas, this.world);

    // ── Graph renderer → neural panel canvas ──
    this.graphRenderer = new GraphRenderer(this.obs.neuralPanel.graphCanvas);

    // ── Neural editor overlay (opened from panel's "edit circuit →" btn) ──
    this.editor = new NeuralEditor({
      onRun: () => this._closeEditor(),
      onReset: () => this._resetCircuit(),
      onChange: () => this._handleGraphChange(),
      onToggleSensor: (id) => this._toggleSensor(id),
      onBodyParams: (params) => this._applyBodyParams(params),
      onExport: () => this._exportCircuit(),
      onImport: (text) => this._importCircuit(text),
      onSensorConfigChange: (config) => this._applySensorConfig(config),
    });
    this.editor.setGraph(this.graph);
    this.editor.setSensorState(this.sensorEnabled);
    this.editor.setSensorConfig(this.sensorConfig);
    this.editor.setBodyParams(this.world.bodyParams);

    // ── Kick off ──
    this.saveCircuit();
    window.addEventListener("resize", () => this._resize());

    // keyboard: space = pause, d = debug cones
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.code === "Space") { e.preventDefault(); this._togglePause(); }
    });

    this._resize();
    this.refreshMetrics();

    // Render the first frame synchronously so the canvas isn't blank
    // before rAF fires.
    const now = performance.now();
    this.worldRenderer.render(now, this.sensorEnabled, this.sensorDefs);
    this.graphRenderer.render(now, this.graph, this.circuitFrame, this.sensorEnabled);
    this._updateHUD();

    requestAnimationFrame((ts) => this._loop(ts));
  }

  // ── Derived data ──

  rebuildDerived() {
    this.sensorDefs = this.sensorConfig.toDefinitions();
    this.sourceDefs = buildSourceDefinitions(this.sensorDefs);
    const maps = buildSensorMaps(this.sensorDefs);
    this.sensorOrder = maps.SENSOR_ORDER;
    this.sourceOrder = maps.SOURCE_ORDER;
  }

  // ── Circuit evaluation ──

  evaluateCircuit(sourceOutputs, commit = false, dt = CONFIG.FIXED_DT) {
    const { nodeSignals, edgeSignals } = this.graph.computeSignals(sourceOutputs, this.sensorEnabled, { commit, dt });
    const motorInputs = this.graph.getMotorOutputs(nodeSignals);
    const motorLevels = this.world.resolveMotorLevels(motorInputs);
    return { nodeSignals, edgeSignals, motorInputs, motorLevels };
  }

  refreshMetrics() {
    const sensorOutputs = this.world.previewSourceOutputs(this.sensorEnabled, CONFIG.FIXED_DT, this.sensorDefs, this.sourceOrder);
    const evaluation = this.evaluateCircuit(sensorOutputs, false, CONFIG.FIXED_DT);
    const motors = evaluation.motorLevels;
    const bp = this.world.bodyParams;
    const turnSigned = ((motors.motor_turn_L ?? 0) - (motors.motor_turn_R ?? 0)) * CONFIG.TURN_GAIN * bp.turnScale;

    this.circuitFrame = { ...evaluation, sourceOutputs: sensorOutputs };

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
      sensorDrain: this.sensorOrder.reduce(
        (sum, id) => sum + (this.sensorEnabled[id] ? Math.abs(sensorOutputs[id] ?? 0) : 0), 0
      ) * CONFIG.SENSOR_ENERGY_COST
    };
  }

  // ── Persistence ──

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
    } catch (_) {}
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

  // ── UI callbacks ──

  _onModeChange(mode) {
    // Future: apply per-mode color treatment to WorldRenderer
  }

  _openEditor() {
    if (this.world.dead) return;
    this.paused = true;
    this.editor.setOpen(true);
    this.editor.fitView();
  }

  _closeEditor() {
    this.editor.setOpen(false);
    this.paused = false;
  }

  _togglePause() {
    if (this.world.dead) return;
    this.paused = !this.paused;
  }

  _handleGraphChange() {
    this.connections = this.graph.toConnectionsObject();
    this.behavior = inferBehavior(this.connections, this.sensorEnabled, this.sensorDefs);
    this.refreshMetrics();
    this.saveCircuit();
  }

  _toggleSensor(id) {
    this.sensorEnabled[id] = !this.sensorEnabled[id];
    this._handleGraphChange();
  }

  _applyBodyParams(params) {
    this.world.bodyParams.turnScale = params.turnScale;
    this.world.bodyParams.speedScale = params.speedScale;
    this.refreshMetrics();
    this.saveCircuit();
  }

  _applySensorConfig(config) {
    this.sensorConfig = config;
    this.rebuildDerived();
    this.world.setSensorDefs(this.sensorDefs, this.sourceOrder, this.sensorOrder);
    this.sensorEnabled = cloneSensorEnabled(this.sensorEnabled, this.sensorDefs);
    this.graph.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, false, this.sourceDefs);
    this.editor.setSensorConfig(this.sensorConfig);
    this._handleGraphChange();
  }

  _resetCircuit() {
    this.sensorConfig = SensorConfig.createDefault();
    this.rebuildDerived();
    this.world.setSensorDefs(this.sensorDefs, this.sourceOrder, this.sensorOrder);
    this.sensorEnabled = cloneSensorEnabled(undefined, this.sensorDefs);
    this.world.bodyParams = { turnScale: 1.0, speedScale: 1.0 };
    this.editor.setBodyParams(this.world.bodyParams);
    this.editor.setSensorConfig(this.sensorConfig);
    this.graph.reset(LOGIC_CANVAS.width, LOGIC_CANVAS.height);
    this._handleGraphChange();
  }

  _exportCircuit() {
    const data = {
      graph: this.graph.serialize(),
      sensorEnabled: { ...this.sensorEnabled },
      bodyParams: { ...this.world.bodyParams },
      sensorConfig: this.sensorConfig.toJSON(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `umwelt-circuit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  _importCircuit(text) {
    try {
      const data = JSON.parse(text);
      if (!data.graph) return;
      if (data.sensorConfig) this._applySensorConfig(SensorConfig.fromJSON(data.sensorConfig));
      this.graph.deserialize(data.graph);
      this.graph.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, false, this.sourceDefs);
      if (data.sensorEnabled) this.sensorEnabled = cloneSensorEnabled(data.sensorEnabled, this.sensorDefs);
      if (data.bodyParams) {
        this.world.bodyParams = { turnScale: data.bodyParams.turnScale ?? 1, speedScale: data.bodyParams.speedScale ?? 1 };
        this.editor.setBodyParams(this.world.bodyParams);
      }
      this._handleGraphChange();
    } catch (_) { /* invalid JSON */ }
  }

  _resize() {
    this.worldRenderer.resize();
    this.refreshMetrics();
  }

  _updateHUD() {
    const ant = this.world.ant;
    const rw = 170, rh = 100;
    this.obs.setReticle(ant.x - rw / 2, ant.y - rh / 2, rw, rh);

    // GCaMP halo tracks the subject (CSS reads --glow-x/--glow-y percentages)
    const camW = this.worldRenderer.width || 760;
    const camH = this.worldRenderer.height || 720;
    this.obs.modeTreatment.style.setProperty('--glow-x', `${(ant.x / camW) * 100}%`);
    this.obs.modeTreatment.style.setProperty('--glow-y', `${(ant.y / camH) * 100}%`);

    this.obs.hud.update({
      elapsed: this.world.alive,
      frame: this._frameCount,
      tick: this._tickCount,
      speed: this.speed,
      fps: this._currentFps,
    });
  }

  // ── Main loop ──

  _loop(timestamp) {
    if (!this.lastTime) this.lastTime = timestamp;
    const delta = Math.min(0.1, (timestamp - this.lastTime) / 1000);
    this.lastTime = timestamp;

    // FPS calculation
    this._fpsAccum += delta;
    this._fpsSamples++;
    if (this._fpsAccum >= 0.5) {
      this._currentFps = Math.round(this._fpsSamples / this._fpsAccum);
      this._fpsAccum = 0;
      this._fpsSamples = 0;
    }

    // Physics
    if (!this.paused && !this.world.dead) {
      this.accumulator += delta * this.speed;
      while (this.accumulator >= CONFIG.FIXED_DT) {
        const sourceOutputs = this.world.composeSourceOutputs(this.sensorEnabled, CONFIG.FIXED_DT, true, this.sensorDefs, this.sourceOrder);
        const evaluation = this.evaluateCircuit(sourceOutputs, true, CONFIG.FIXED_DT);
        this.circuitFrame = { ...evaluation, sourceOutputs };
        this.world.step(CONFIG.FIXED_DT, evaluation.motorInputs, this.sensorEnabled, sourceOutputs);
        this.accumulator -= CONFIG.FIXED_DT;
        this._tickCount++;
        if (this.world.dead) break;
      }
    }

    this._frameCount++;
    this.worldRenderer.render(timestamp, this.sensorEnabled, this.sensorDefs);
    this.graphRenderer.render(timestamp, this.graph, this.circuitFrame, this.sensorEnabled);
    this.editor.setEvaluation(this.circuitFrame);
    this.editor.setSensorState(this.sensorEnabled);
    this.editor.render(timestamp);
    this._updateHUD();

    requestAnimationFrame((next) => this._loop(next));
  }
}

new ObservationApp();
