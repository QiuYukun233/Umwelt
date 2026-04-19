import { GraphRenderer } from "../renderer/graph.js";
import { SensorMapRenderer } from "../renderer/sensor-map.js";
import { NeuralEditor } from "./editor.js";

export class Sidebar {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.sensorMap = new SensorMapRenderer(document.getElementById("sensor-map"));
    this.graph = new GraphRenderer(document.getElementById("neural"));
    this.editor = new NeuralEditor({
      onRun: () => this.callbacks.onRun?.(),
      onReset: () => this.callbacks.onReset?.(),
      onChange: () => this.callbacks.onGraphChange?.(),
      onToggleSensor: (id) => this.callbacks.onToggleSensor?.(id),
      onBodyParams: (params) => this.callbacks.onBodyParams?.(params),
      onExport: () => this.callbacks.onExport?.(),
      onImport: (text) => this.callbacks.onImport?.(text),
      onSensorConfigChange: (config) => this.callbacks.onSensorConfigChange?.(config)
    });
    this.editBtn = document.getElementById("edit-circuit-btn");
    this.editBtn.addEventListener("click", () => this.callbacks.onEdit?.());
  }

  resize() {
    this.sensorMap.resize();
    this.graph.resize();
    this.editor.resize();
  }

  refreshTheme() {
    this.sensorMap.refreshTheme();
    this.graph.refreshTheme();
    this.editor.refreshTheme();
  }

  setGraph(graph) {
    this.editor.setGraph(graph);
  }

  setSensorState(sensorEnabled) {
    this.editor.setSensorState(sensorEnabled);
  }

  setEvaluation(evaluation) {
    this.editor.setEvaluation(evaluation);
  }

  rebuildSensors(sensorDefs) {
    this.sensorMap.rebuildSensors(sensorDefs);
  }

  setSensorConfig(config) {
    this.editor.setSensorConfig(config);
  }

  setEditorOpen(open) {
    this.editor.setOpen(open);
    if (open) this.editor.fitView();
  }

  render(time, graph, evaluation, metrics, sensorEnabled) {
    this.sensorMap.render(metrics, sensorEnabled);
    this.graph.render(time, graph, evaluation, sensorEnabled);
    this.editor.render(time);
  }
}
