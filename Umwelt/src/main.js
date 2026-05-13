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
import {
  applyEnvelope,
  downloadSaveJSON,
  parseImportText,
  readSavedEnvelope,
  writeSavedEnvelope,
} from "./io/schema.js";
import {
  compileTopology,
  createBatchState,
  seedBatchFromGraph,
  stepBatch,
  writebackFromBatch,
  readMotorOutputs,
} from "./neural/batch.js";

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
    // Batched evaluator state. Lazily compiled on first use and rebuilt
    // whenever the graph topology changes (handleGraphChange / resetCircuit
    // / loadCircuit). The editor-preview path stays on computeSignals so
    // sidebar tweaks don't force a recompile per keystroke.
    this.topology = null;
    this.batch = null;
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
    this._invalidateBatch();   // sensor count / ids may have changed
    this.refreshMetricsSnapshot();
    this.saveCircuit();
  }

  evaluateCircuit(sourceOutputs, commit = false, dt = CONFIG.FIXED_DT) {
    const { nodeSignals, edgeSignals } = this.graph.computeSignals(sourceOutputs, this.sensorEnabled, { commit, dt });
    const motorInputs = this.graph.getMotorOutputs(nodeSignals);
    const motorLevels = this.world.resolveMotorLevels(motorInputs);
    return { nodeSignals, edgeSignals, motorInputs, motorLevels };
  }

  /**
   * (Re)compile the batched evaluator. Called lazily by _ensureBatch when
   * the topology is missing or has been invalidated; safe to call directly
   * after any graph mutation that should reflect immediately.
   */
  _rebuildBatch() {
    this.topology = compileTopology(this.graph);
    this.batch = createBatchState(this.topology, Math.max(1, this.world.ants.length));
    // Seed batch state for each ant from the graph's current node state.
    // For now all ants share the graph's authoring state — the only
    // per-ant divergence comes from sensor inputs over subsequent ticks.
    for (let a = 0; a < this.batch.A; a++) seedBatchFromGraph(this.topology, this.batch, this.graph, a);
  }

  _ensureBatch() {
    if (!this.topology || !this.batch) {
      this._rebuildBatch();
      return;
    }
    // ants[] count may have changed (spawn / death) — resize the batch.
    if (this.batch.A !== Math.max(1, this.world.ants.length)) {
      this._rebuildBatch();
    }
  }

  _invalidateBatch() {
    this.topology = null;
    this.batch = null;
  }

  /**
   * Per-tick batched eval. Composes sensor inputs for each live ant,
   * runs stepBatch, and reads back motor outputs. Returns the focused
   * ant's circuit frame plus the per-ant motor inputs array.
   */
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
      if (!ant) {
        // Dead slot — keep alive mask down but still fill zero sensors.
        batch.alive[a] = 0;
        sourceOutputsByAnt[a] = null;
        continue;
      }
      batch.alive[a] = 1;
      const isFocused = ant.id === this.world.focusedAntId;
      const so = this.world.composeSourceOutputs(ant, this.sensorEnabled, dt, isFocused);
      sourceOutputsByAnt[a] = so;
      for (let s = 0; s < topo.S; s++) {
        const id = topo.sensorSourceIds[s];
        const enabled = this.sensorEnabled[id];
        // Body-internal channels are always on (matches sensorOutputForNode).
        const active = enabled === undefined ? true : Boolean(enabled);
        sensorInputs[a * topo.S + s] = active ? (so[id] ?? 0) : 0;
      }
    }
    stepBatch(topo, batch, sensorInputs, { dt });
    // Mirror the focused ant's state back into the graph so the editor /
    // sidebar see live node activations. Non-focused ants live only in
    // the batch.
    const focusIdx = ants.findIndex((a) => a.id === this.world.focusedAntId);
    if (focusIdx >= 0) writebackFromBatch(topo, batch, this.graph, focusIdx);

    const motorInputsByAnt = new Array(A);
    for (let a = 0; a < A; a++) {
      motorInputsByAnt[a] = ants[a] ? readMotorOutputs(topo, batch, a) : null;
    }
    return { motorInputsByAnt, sourceOutputsByAnt, focusIdx };
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
      energy: Math.max(0, Math.min(1, (this.world.focusedAnt?.energy ?? 0) / CONFIG.MAX_ENERGY)),
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
    this._invalidateBatch();
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
    this._invalidateBatch();
    this.saveCircuit();
  }

  restart() {
    const savedBody = { ...this.world.bodyParams };
    this.world.reset({ incrementGeneration: true });
    this.world.bodyParams = savedBody;
    this.graph.resetState();
    this._invalidateBatch();
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
    writeSavedEnvelope(this);
  }

  loadCircuit() {
    const data = readSavedEnvelope();
    if (!data) return false;
    applyEnvelope(this, data, {
      onSensorConfig: (cfg) => {
        // Constructor-time path: sidebar/editor don't exist yet, so install
        // the config directly. The caller wires sidebar/editor afterward.
        this.sensorConfig = cfg;
        this.rebuildDerived();
        this.world.setSensorDefs(this.sensorDefs, this.sourceOrder, this.sensorOrder);
      },
    });
    return true;
  }

  exportCircuit() {
    downloadSaveJSON(this);
  }

  importCircuit(text) {
    const data = parseImportText(text);
    if (!data) return;
    // Go through the shared install path so sidebar 3D view, body editor's
    // sensorConfig reference, and graph anchors all line up with the
    // imported layout.
    applyEnvelope(this, data, {
      onSensorConfig: (cfg) => this._installSensorConfig(cfg),
      onWarn: (msg) => this.world.log("danger", `导入：${msg}`),
    });
    if (data.bodyParams) this.sidebar.editor.setBodyParams(this.world.bodyParams);
    this.connections = this.graph.toConnectionsObject();
    this.behavior = inferBehavior(this.connections, this.sensorEnabled, this.sensorDefs);
    this.topbar.renderBehavior(this.behavior);
    this.footer.renderBehavior(this.behavior);
    this.sidebar.editor.fitView();
    this._invalidateBatch();
    this.refreshMetricsSnapshot();
    this.saveCircuit();
  }

  loop(timestamp) {
    if (!this.lastTime) this.lastTime = timestamp;
    const delta = Math.min(0.1, (timestamp - this.lastTime) / 1000);
    this.lastTime = timestamp;
    if (!this.paused && !this.world.dead) {
      this.accumulator += delta * this.speed;
      while (this.accumulator >= CONFIG.FIXED_DT) {
        // Batched eval: composes per-ant sensor inputs, runs stepBatch,
        // mirrors focused-ant state back into the graph for the sidebar.
        const { motorInputsByAnt, sourceOutputsByAnt, focusIdx } =
          this._runBatchedTick(CONFIG.FIXED_DT);

        // Sidebar / metrics frame is focused-ant only — read motors and
        // source outputs from the focused slot.
        const focusMotors = focusIdx >= 0 ? motorInputsByAnt[focusIdx] : {};
        const focusSources = focusIdx >= 0 ? sourceOutputsByAnt[focusIdx] : {};
        const focusMotorLevels = this.world.resolveMotorLevels(focusMotors);
        // edgeSignals / nodeSignals on the editor frame come from the
        // writeback into the graph plus a fresh sidebar-side eval; the
        // sidebar already reads graph.node.state, so we pass an empty
        // signals map here. Keeping the field present keeps Sidebar's
        // existing shape happy.
        this.circuitFrame = {
          nodeSignals: {},
          edgeSignals: {},
          motorInputs: focusMotors,
          motorLevels: focusMotorLevels,
          sourceOutputs: focusSources,
        };
        this.sidebar.setEvaluation(this.circuitFrame);

        // world.step accepts per-ant arrays — feed the batched motors /
        // source outputs straight through so each ant gets its own.
        this.world.step(CONFIG.FIXED_DT, motorInputsByAnt, this.sensorEnabled, sourceOutputsByAnt);
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
