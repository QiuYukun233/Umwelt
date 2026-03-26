import { GraphRenderer } from "../renderer/graph.js";
import { SensorMapRenderer } from "../renderer/sensor-map.js";
import { NeuralEditor } from "./editor.js";

export class Sidebar {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.sensorMap = new SensorMapRenderer(document.getElementById("sensor-map"), {
      onToggleSensor: (id) => this.callbacks.onToggleSensor?.(id),
      onToggleSensorMode: (id) => this.callbacks.onToggleSensorMode?.(id),
      isSensorEnabled: (id) => this.callbacks.isSensorEnabled?.(id)
    });
    this.graph = new GraphRenderer(document.getElementById("neural"));
    this.editor = new NeuralEditor({
      onRun: () => this.callbacks.onRun?.(),
      onReset: () => this.callbacks.onReset?.(),
      onNoiseFrequency: (value) => this.callbacks.onNoiseFrequency?.(value),
      onChange: () => this.callbacks.onGraphChange?.()
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

  setSensorState(sensorEnabled, sensorModes) {
    this.editor.setSensorState(sensorEnabled, sensorModes);
  }

  setEvaluation(evaluation) {
    this.editor.setEvaluation(evaluation);
  }

  setNoiseFrequency(value) {
    this.editor.setNoiseFrequency(value);
  }

  setEditorOpen(open) {
    this.editor.setOpen(open);
    if (open) this.editor.fitView();
  }

  render(time, graph, evaluation, metrics, sensorEnabled, sensorModes, noiseFrequency) {
    this.sensorMap.render(metrics, sensorEnabled, sensorModes);
    this.graph.render(time, graph, evaluation, sensorEnabled, sensorModes, noiseFrequency);
    this.editor.render(time);
  }
}
