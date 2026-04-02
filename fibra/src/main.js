import "./style.css";
import { CONFIG, createEnvironmentState } from "./config.js";
import { WorldRenderer } from "./renderer/world.js";
import { cloneConnections, cloneSensorEnabled, cloneSensorModes, inferBehavior, NeuralGraph } from "./neural.js";
import { World } from "./world.js";
import { Topbar } from "./ui/topbar.js";
import { Footer } from "./ui/footer.js";
import { DeathOverlay } from "./ui/death.js";
import { Sidebar } from "./ui/sidebar.js";

class App {
  constructor() {
    this.environmentState = createEnvironmentState();
    this.sensorEnabled = cloneSensorEnabled();
    this.sensorModes = cloneSensorModes();
    this.connections = cloneConnections();
    this.behavior = inferBehavior(this.connections, this.sensorEnabled);
    this.paused = false;
    this.speed = 1;
    this.accumulator = 0;
    this.lastTime = 0;
    this.deathShown = false;
    this.noiseFrequency = 0.5;
    this.pauseOverlay = document.getElementById("pause-overlay");
    this.world = new World(this.environmentState);
    this.world.setNoiseFrequency(this.noiseFrequency);
    this.graph = new NeuralGraph();
    this.graph.reset(window.innerWidth, Math.max(360, window.innerHeight - 48));
    this.connections = this.graph.toConnectionsObject();
    this.behavior = inferBehavior(this.connections, this.sensorEnabled);
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
      onToggleSensor: (id) => this.toggleSensor(id),
      onToggleSensorMode: (id) => this.toggleSensorMode(id),
      isSensorEnabled: (id) => Boolean(this.sensorEnabled[id]),
      onEdit: () => this.openEditor(),
      onRun: () => this.setPausedState(false),
      onReset: () => this.resetCircuit(),
      onNoiseFrequency: (value) => this.setNoiseFrequency(value),
      onGraphChange: () => this.handleGraphChange()
    });
    this.sidebar.setGraph(this.graph);
    this.sidebar.setNoiseFrequency(this.noiseFrequency);
    this.refreshMetricsSnapshot();
    this.topbar.renderBehavior(this.behavior);
    this.topbar.setSpeed(this.speed);
    this.topbar.renderStats(this.world);
    this.footer.renderBehavior(this.behavior);
    this.footer.renderMetrics(this.world.metrics);
    this.footer.renderStateData(this.world.metrics, this.sensorEnabled, this.sensorModes);
    this.resize();
    window.addEventListener("resize", () => this.resize());
    requestAnimationFrame((timestamp) => this.loop(timestamp));
  }

  evaluateCircuit(sourceOutputs, commit = false, dt = CONFIG.FIXED_DT) {
    const { nodeSignals, edgeSignals } = this.graph.computeSignals(sourceOutputs, this.sensorEnabled, { commit, dt });
    const motorInputs = this.graph.getMotorOutputs(nodeSignals);
    const motorLevels = this.world.resolveMotorLevels(motorInputs);
    return { nodeSignals, edgeSignals, motorInputs, motorLevels };
  }

  refreshMetricsSnapshot() {
    const sensorOutputs = this.world.previewSourceOutputs(this.sensorEnabled, this.sensorModes, CONFIG.FIXED_DT);
    const sensorDrain = Object.keys(this.sensorEnabled).reduce((sum, id) => sum + (this.sensorEnabled[id] ? Math.abs(sensorOutputs[id] ?? 0) : 0), 0) * CONFIG.SENSOR_ENERGY_COST;
    const evaluation = this.evaluateCircuit(sensorOutputs, false);
    const motors = evaluation.motorLevels;
    const turnSigned = (motors.leftLeg - motors.rightLeg) * CONFIG.TURN_GAIN;
    this.circuitFrame = { ...evaluation, sourceOutputs: sensorOutputs };
    this.sidebar.setEvaluation(this.circuitFrame);
    this.sidebar.setSensorState(this.sensorEnabled, this.sensorModes);
    this.world.metrics = {
      sensorOutputs,
      leftEye: Math.max(sensorOutputs.F0 ?? 0, sensorOutputs.F5 ?? 0),
      rightEye: Math.max(sensorOutputs.F0 ?? 0, sensorOutputs.F1 ?? 0),
      leftThreat: Math.max(sensorOutputs.T0 ?? 0, sensorOutputs.T5 ?? 0),
      rightThreat: Math.max(sensorOutputs.T0 ?? 0, sensorOutputs.T1 ?? 0),
      leftLeg: motors.leftLeg,
      rightLeg: motors.rightLeg,
      speed: this.world.metrics.speed,
      energy: Math.max(0, Math.min(1, this.world.ant.energy / CONFIG.MAX_ENERGY)),
      turn: Math.max(0, Math.min(1, Math.abs(turnSigned) / (CONFIG.TURN_GAIN * 1.1))),
      turnSigned,
      sensorDrain
    };
  }

  handleGraphChange() {
    this.connections = this.graph.toConnectionsObject();
    this.behavior = inferBehavior(this.connections, this.sensorEnabled);
    this.topbar.renderBehavior(this.behavior);
    this.footer.renderBehavior(this.behavior);
    this.refreshMetricsSnapshot();
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
    this.behavior = inferBehavior(this.connections, this.sensorEnabled);
    this.topbar.renderBehavior(this.behavior);
    this.footer.renderBehavior(this.behavior);
    this.refreshMetricsSnapshot();
  }

  toggleSensorMode(id) {
    this.sensorModes[id] = this.sensorModes[id] === "diff" ? "absolute" : "diff";
    this.refreshMetricsSnapshot();
  }

  setNoiseFrequency(value) {
    this.noiseFrequency = value;
    this.world.setNoiseFrequency(value);
    this.sidebar.setNoiseFrequency(value);
    this.refreshMetricsSnapshot();
  }

  resetCircuit() {
    this.graph.reset(window.innerWidth, Math.max(360, window.innerHeight - 48));
    this.connections = this.graph.toConnectionsObject();
    this.behavior = inferBehavior(this.connections, this.sensorEnabled);
    this.topbar.renderBehavior(this.behavior);
    this.footer.renderBehavior(this.behavior);
    this.sidebar.editor.fitView();
    this.refreshMetricsSnapshot();
  }

  restart() {
    this.world.reset({ incrementGeneration: true });
    this.refreshMetricsSnapshot();
    this.deathShown = false;
    this.accumulator = 0;
    this.death.hide();
    this.footer.resetLog();
    this.topbar.setPaused(this.paused);
    this.topbar.renderStats(this.world);
    this.footer.renderMetrics(this.world.metrics);
    this.footer.renderStateData(this.world.metrics, this.sensorEnabled, this.sensorModes);
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

  loop(timestamp) {
    if (!this.lastTime) this.lastTime = timestamp;
    const delta = Math.min(0.1, (timestamp - this.lastTime) / 1000);
    this.lastTime = timestamp;
    if (!this.paused && !this.world.dead) {
      this.accumulator += delta * this.speed;
      while (this.accumulator >= CONFIG.FIXED_DT) {
        const sourceOutputs = this.world.composeSourceOutputs(this.sensorEnabled, this.sensorModes, CONFIG.FIXED_DT, true);
        const evaluation = this.evaluateCircuit(sourceOutputs, true);
        this.circuitFrame = { ...evaluation, sourceOutputs };
        this.sidebar.setEvaluation(this.circuitFrame);
        this.world.step(CONFIG.FIXED_DT, evaluation.motorInputs, this.sensorEnabled, this.sensorModes, sourceOutputs);
        this.accumulator -= CONFIG.FIXED_DT;
        if (this.world.dead) break;
      }
    }
    this.topbar.renderStats(this.world);
    this.footer.renderMetrics(this.world.metrics);
    this.footer.renderStateData(this.world.metrics, this.sensorEnabled, this.sensorModes);
    this.footer.syncLog(this.world.behaviorLog);
    if (this.world.dead) {
      if (!this.deathShown) this.death.show(this.world, this.behavior, this.connections);
      this.deathShown = true;
    } else if (this.deathShown) {
      this.deathShown = false;
      this.death.hide();
    }
    this.worldRenderer.render(timestamp);
    this.sidebar.render(timestamp, this.graph, this.circuitFrame, this.world.metrics, this.sensorEnabled, this.sensorModes, this.noiseFrequency);
    requestAnimationFrame((next) => this.loop(next));
  }
}

new App();
