/**
 * Observation App — the app entry point. Boots the game inside the
 * observation UI (the diegetic research-drone workstation).
 *
 * Wires together World, NeuralGraph, WorldRenderer, and circuit logic,
 * rendering into the Observation artboard. Loaded by index.html.
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
import {
  applyEnvelope,
  downloadSaveJSON,
  parseImportText,
  readSavedEnvelope,
  writeSavedEnvelope,
} from "./io/schema.js";
import { parseModuleText } from "./io/module.js";
import {
  compileTopology,
  createBatchState,
  seedBatchFromGraph,
  stepBatch,
  writebackFromBatch,
  readMotorOutputs,
} from "./neural/batch.js";

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
    this.moduleMeta = null;
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

    // Batched evaluator state — lazy, rebuilt on graph mutations / sensor
    // config changes / reset. Editor preview keeps using computeSignals.
    this.topology = null;
    this.batch = null;

    // ── Observation UI ──
    this.obs = new Observation(document.getElementById("obs-root"), {
      initialMode: "visible",
      onModeChange: (mode) => this._onModeChange(mode),
      onEditCircuit: () => this._openEditor(),
      onPauseToggle: (paused) => { this.paused = paused; },
      onSpeedChange: (speed) => { this.speed = speed; },
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
      onLoadModule: (text) => this._loadModule(text),
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

  // Batched evaluator helpers — lazy compile of the NeuralGraph into flat
  // TypedArrays, invalidated on graph mutation. See src/neural/batch.js.
  _rebuildBatch() {
    this.topology = compileTopology(this.graph, 1000 * CONFIG.FIXED_DT);
    this.batch = createBatchState(this.topology, Math.max(1, this.world.ants.length));
    for (let a = 0; a < this.batch.A; a++) seedBatchFromGraph(this.topology, this.batch, this.graph, a);
  }
  _ensureBatch() {
    if (!this.topology || !this.batch) { this._rebuildBatch(); return; }
    if (this.batch.A !== Math.max(1, this.world.ants.length)) this._rebuildBatch();
  }
  _invalidateBatch() { this.topology = null; this.batch = null; }

  _runBatchedTick(dt) {
    this._ensureBatch();
    const topo = this.topology;
    const batch = this.batch;
    const A = batch.A;
    const ants = this.world.ants;
    const sensorInputs = new Float32Array(A * topo.S);
    const sourceOutputsByAnt = new Array(A);
    for (let a = 0; a < A; a++) {
      const ant = ants[a];
      if (!ant) { batch.alive[a] = 0; sourceOutputsByAnt[a] = null; continue; }
      batch.alive[a] = 1;
      const isFocused = ant.id === this.world.focusedAntId;
      const so = this.world.composeSourceOutputs(ant, this.sensorEnabled, dt, isFocused);
      sourceOutputsByAnt[a] = so;
      for (let s = 0; s < topo.S; s++) {
        const id = topo.sensorSourceIds[s];
        const enabled = this.sensorEnabled[id];
        const active = enabled === undefined ? true : Boolean(enabled);
        sensorInputs[a * topo.S + s] = active ? (so[id] ?? 0) : 0;
      }
    }
    stepBatch(topo, batch, sensorInputs, { dt });
    const focusIdx = ants.findIndex((a) => a.id === this.world.focusedAntId);
    if (focusIdx >= 0) writebackFromBatch(topo, batch, this.graph, focusIdx);
    const motorInputsByAnt = new Array(A);
    for (let a = 0; a < A; a++) motorInputsByAnt[a] = ants[a] ? readMotorOutputs(topo, batch, a) : null;
    return { motorInputsByAnt, sourceOutputsByAnt, focusIdx };
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
      energy: Math.max(0, Math.min(1, (this.world.focusedAnt?.energy ?? 0) / CONFIG.MAX_ENERGY)),
      turn: Math.max(0, Math.min(1, Math.abs(turnSigned) / (CONFIG.TURN_GAIN * bp.turnScale * 1.1))),
      turnSigned,
      sensorDrain: this.sensorOrder.reduce(
        (sum, id) => sum + (this.sensorEnabled[id] ? Math.abs(sensorOutputs[id] ?? 0) : 0), 0
      ) * CONFIG.SENSOR_ENERGY_COST
    };
  }

  // ── Persistence ──

  saveCircuit() {
    writeSavedEnvelope(this);
  }

  loadCircuit() {
    const data = readSavedEnvelope();
    if (!data) return false;
    applyEnvelope(this, data, {
      onSensorConfig: (cfg) => {
        // Constructor-time path: editor not wired yet. The _applySensorConfig
        // branch used at import time calls editor.setSensorConfig; at load
        // time that happens after the constructor threads editor through.
        this.sensorConfig = cfg;
        this.rebuildDerived();
        this.world.setSensorDefs(this.sensorDefs, this.sourceOrder, this.sensorOrder);
      },
    });
    return true;
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
    this.obs.hud.setPaused(this.paused);
  }

  _handleGraphChange() {
    this.connections = this.graph.toConnectionsObject();
    this.behavior = inferBehavior(this.connections, this.sensorEnabled, this.sensorDefs);
    this._invalidateBatch();
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
    this.moduleMeta = null;
    this._handleGraphChange();
  }

  _exportCircuit() {
    downloadSaveJSON(this);
  }

  _importCircuit(text) {
    const data = parseImportText(text);
    if (!data) return;
    applyEnvelope(this, data, {
      onSensorConfig: (cfg) => this._applySensorConfig(cfg),
      onWarn: (msg) => this.world.log("danger", `导入：${msg}`),
    });
    if (data.bodyParams) this.editor.setBodyParams(this.world.bodyParams);
    this._handleGraphChange();
  }

  _loadModule(text) {
    const mod = parseModuleText(text);
    if (!mod) {
      this.world.log("danger", "装载模块：文件不是有效的 umwelt-module 导出");
      return;
    }
    // The module graph is the standard NeuralGraph serialization; install
    // it like an imported circuit. ensureAnchors re-pins sensor/motor nodes
    // to the current sensor config. moduleMeta is display-only metadata.
    this.graph.deserialize(mod.graph);
    this.graph.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, false, this.sourceDefs);
    this.moduleMeta = mod.meta;
    this._handleGraphChange();
  }

  _resize() {
    this.worldRenderer.resize();
    this.refreshMetrics();
  }

  _updateHUD() {
    const ant = this.world.focusedAnt;
    if (!ant) return;   // nothing to observe — skip HUD updates this frame
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

    // Physics — batched eval. Focused-ant circuit frame drives the editor
    // overlay; non-focused ants live only in the batch.
    if (!this.paused && !this.world.dead) {
      this.accumulator += delta * this.speed;
      while (this.accumulator >= CONFIG.FIXED_DT) {
        const { motorInputsByAnt, sourceOutputsByAnt, focusIdx } =
          this._runBatchedTick(CONFIG.FIXED_DT);
        const focusMotors = focusIdx >= 0 ? motorInputsByAnt[focusIdx] : {};
        const focusSources = focusIdx >= 0 ? sourceOutputsByAnt[focusIdx] : {};
        const focusMotorLevels = this.world.resolveMotorLevels(focusMotors);
        this.circuitFrame = {
          nodeSignals: {},
          edgeSignals: {},
          motorInputs: focusMotors,
          motorLevels: focusMotorLevels,
          sourceOutputs: focusSources,
        };
        this.world.step(CONFIG.FIXED_DT, motorInputsByAnt, this.sensorEnabled, sourceOutputsByAnt);
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
