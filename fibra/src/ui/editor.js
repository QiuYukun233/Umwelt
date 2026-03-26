import { GRAPH_LAYOUT } from "../config.js";
import { fitCanvas, readThemeVars, clamp } from "../math.js";
import { nodeHasInput, nodeHasOutput, nodePort, nodeRect } from "../neural.js";
import { drawCircuitScene, fitGraphView, plusButtonPoint, sampleCurveDistance, screenToWorld, worldToScreen } from "../renderer/graph.js";

export class NeuralEditor {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.overlay = document.getElementById("editor-overlay");
    this.stage = document.getElementById("editor-stage");
    this.canvas = document.getElementById("editor-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.menu = document.getElementById("editor-menu");
    this.noiseControl = document.getElementById("editor-noise-control");
    this.noiseSlider = document.getElementById("editor-noise-slider");
    this.noiseValue = document.getElementById("editor-noise-value");
    this.runBtn = document.getElementById("editor-run-btn");
    this.resetBtn = document.getElementById("editor-reset-btn");
    this.open = false;
    this.graph = null;
    this.evaluation = { nodeSignals: {}, edgeSignals: {}, motorInputs: { leftLeg: 0, rightLeg: 0 }, motorLevels: { leftLeg: 0, rightLeg: 0 } };
    this.sensorEnabled = {};
    this.sensorModes = {};
    this.noiseFrequency = 0.5;
    this.view = { x: 0, y: 0, scale: 1 };
    this.hoverNodeId = null;
    this.dragNode = null;
    this.panState = null;
    this.linkDrag = null;
    this.noiseHover = false;
    this.refreshTheme();
    this.bind();
    this.resize();
  }

  refreshTheme() {
    this.palette = readThemeVars(["surface", "surface-2", "border", "border-2", "text", "text-soft", "text-faint", "amber", "mint", "red", "brown"]);
  }

  bind() {
    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointerleave", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("contextmenu", (event) => this.onContextMenu(event));
    this.canvas.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    this.runBtn.addEventListener("click", () => this.callbacks.onRun?.());
    this.resetBtn.addEventListener("click", () => this.callbacks.onReset?.());
    this.noiseSlider.addEventListener("input", () => {
      const value = Number(this.noiseSlider.value);
      this.setNoiseFrequency(value);
      this.callbacks.onNoiseFrequency?.(value);
    });
    this.noiseControl.addEventListener("pointerenter", () => { this.noiseHover = true; });
    this.noiseControl.addEventListener("pointerleave", () => { this.noiseHover = false; this.updateNoiseControl(); });
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("pointerdown", (event) => {
      if (this.open && this.menu.classList.contains("show") && !event.target.closest("#editor-menu")) this.hideMenu();
    });
  }

  resize() {
    const { ratio } = fitCanvas(this.canvas);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
  }

  setOpen(open) {
    this.open = Boolean(open);
    this.overlay.classList.toggle("show", this.open);
    this.hideMenu();
    if (this.open) { this.resize(); this.updateNoiseControl(); }
    else this.noiseControl.classList.remove("show");
  }

  setGraph(graph) { this.graph = graph; }
  setEvaluation(evaluation) { this.evaluation = evaluation; }
  setSensorState(sensorEnabled, sensorModes) { this.sensorEnabled = sensorEnabled; this.sensorModes = sensorModes; }
  setNoiseFrequency(value) { this.noiseFrequency = clamp(value, 0.1, 3); this.noiseSlider.value = this.noiseFrequency.toFixed(1); this.noiseValue.textContent = this.noiseFrequency.toFixed(1); }

  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  toWorld(point) { return screenToWorld(this.view, point); }

  hitTest(point) {
    if (!this.graph) return null;
    for (const node of [...this.graph.nodes.values()].reverse()) {
      if (nodeHasOutput(node) && Math.hypot(point.x - plusButtonPoint(node).x, point.y - plusButtonPoint(node).y) <= 9) return { kind: "plus", nodeId: node.id };
      if (nodeHasOutput(node) && Math.hypot(point.x - nodePort(node, "out").x, point.y - nodePort(node, "out").y) <= 8) return { kind: "out-port", nodeId: node.id };
      if (nodeHasInput(node) && Math.hypot(point.x - nodePort(node, "in").x, point.y - nodePort(node, "in").y) <= 8) return { kind: "in-port", nodeId: node.id };
    }
    for (const edge of [...this.graph.edges.values()].reverse()) {
      const geometry = this.graph.edgeGeometry(edge);
      if (geometry && Math.hypot(point.x - geometry.label.x, point.y - geometry.label.y) <= 10) return { kind: "edge-label", edgeId: edge.id };
    }
    for (const node of [...this.graph.nodes.values()].reverse()) {
      const rect = nodeRect(node);
      if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) return { kind: "node", nodeId: node.id };
    }
    for (const edge of [...this.graph.edges.values()].reverse()) {
      const geometry = this.graph.edgeGeometry(edge);
      if (geometry && sampleCurveDistance(geometry, point) <= 8) return { kind: "edge", edgeId: edge.id };
    }
    return null;
  }

  onPointerDown(event) {
    if (!this.open || event.button !== 0) return;
    const worldPoint = this.toWorld(this.point(event));
    const hit = this.hitTest(worldPoint);
    this.hideMenu();
    if (hit?.kind === "edge-label") return void (this.graph.edges.get(hit.edgeId).excitatory = !this.graph.edges.get(hit.edgeId).excitatory, this.callbacks.onChange?.());
    if (hit?.kind === "plus") return this.showCreateMenu(hit.nodeId, worldPoint);
    if (hit?.kind === "out-port") return void (this.linkDrag = { fromId: hit.nodeId, start: nodePort(this.graph.nodes.get(hit.nodeId), "out"), end: worldPoint });
    if (hit?.kind === "node") {
      const node = this.graph.nodes.get(hit.nodeId);
      this.dragNode = { id: hit.nodeId, dx: worldPoint.x - node.x, dy: worldPoint.y - node.y };
      return;
    }
    this.panState = { screen: this.point(event), view: { ...this.view } };
  }

  onPointerMove(event) {
    if (!this.open || !this.graph) return;
    const screenPoint = this.point(event);
    const worldPoint = this.toWorld(screenPoint);
    const hit = this.hitTest(worldPoint);
    this.hoverNodeId = hit?.nodeId ?? null;
    this.canvas.style.cursor = ["node", "out-port", "in-port", "plus"].includes(hit?.kind) ? "pointer" : this.panState ? "grabbing" : "grab";
    if (this.dragNode) {
      const node = this.graph.nodes.get(this.dragNode.id);
      node.x = worldPoint.x - this.dragNode.dx;
      node.y = worldPoint.y - this.dragNode.dy;
      this.callbacks.onChange?.();
    } else if (this.panState) {
      this.view.x = this.panState.view.x + (screenPoint.x - this.panState.screen.x);
      this.view.y = this.panState.view.y + (screenPoint.y - this.panState.screen.y);
    } else if (this.linkDrag) {
      this.linkDrag.end = worldPoint;
    }
    this.updateNoiseControl();
  }

  onPointerUp(event) {
    if (!this.open) return;
    if (this.linkDrag) {
      const worldPoint = this.toWorld(this.point(event));
      const hit = this.hitTest(worldPoint);
      if (hit?.kind === "in-port" && hit.nodeId !== this.linkDrag.fromId) this.showConnectChoice(this.linkDrag.fromId, hit.nodeId, worldPoint);
      else this.showCreateMenu(this.linkDrag.fromId, worldPoint);
    }
    this.dragNode = null;
    this.panState = null;
    this.linkDrag = null;
  }

  onContextMenu(event) {
    if (!this.open) return;
    event.preventDefault();
    const hit = this.hitTest(this.toWorld(this.point(event)));
    if (hit?.kind === "edge" || hit?.kind === "edge-label") return this.showDeleteMenu("edge", hit.edgeId, this.point(event));
    if (hit?.kind === "node") return this.showDeleteMenu("node", hit.nodeId, this.point(event));
  }

  onWheel(event) {
    if (!this.open) return;
    event.preventDefault();
    const before = this.toWorld(this.point(event));
    this.view.scale = clamp(this.view.scale * (event.deltaY > 0 ? 0.92 : 1.08), 0.5, 2);
    const after = worldToScreen(this.view, before);
    this.view.x += event.clientX - this.canvas.getBoundingClientRect().left - after.x;
    this.view.y += event.clientY - this.canvas.getBoundingClientRect().top - after.y;
  }

  showDeleteMenu(kind, id, point) {
    if (kind === "node" && this.graph.nodes.get(id)?.type !== "inter") return;
    this.menu.innerHTML = `<button class="editor-item danger">${kind === "edge" ? "删除连线" : "删除节点"}</button>`;
    this.menu.firstElementChild.addEventListener("click", () => { kind === "edge" ? this.graph.removeEdge(id) : this.graph.removeNode(id); this.hideMenu(); this.callbacks.onChange?.(); });
    this.positionMenu(point.x, point.y);
  }

  showConnectChoice(fromId, toId, point) {
    this.menu.innerHTML = `<button class="editor-item accent">⚡ 兴奋</button><button class="editor-item danger">⊖ 抑制</button>`;
    const [excite, inhibit] = this.menu.children;
    excite.addEventListener("click", () => this.finishConnection(fromId, toId, true));
    inhibit.addEventListener("click", () => this.finishConnection(fromId, toId, false));
    this.positionMenu(point.x * this.view.scale + this.view.x, point.y * this.view.scale + this.view.y);
  }

  showCreateMenu(fromId, worldPoint) {
    const existing = [...this.graph.nodes.values()].filter((node) => node.id !== fromId && nodeHasInput(node));
    const buttons = [`<div class="editor-menu-title">创建连接</div>`, `<button class="editor-item accent" data-mode="excite-new">⚡ 兴奋 <small>新建节点</small></button>`, `<button class="editor-item danger" data-mode="inhibit-new">⊖ 抑制 <small>新建节点</small></button>`, `<div class="editor-menu-divider"></div>`];
    for (const node of existing) buttons.push(`<button class="editor-item" data-node="${node.id}">${node.label}</button>`);
    this.menu.innerHTML = buttons.join("");
    for (const button of [...this.menu.querySelectorAll("[data-mode]")]) button.addEventListener("click", () => this.createInterNodeFrom(fromId, worldPoint, button.dataset.mode === "excite-new"));
    for (const button of [...this.menu.querySelectorAll("[data-node]")]) button.addEventListener("click", () => this.showConnectChoice(fromId, button.dataset.node, worldPoint));
    this.positionMenu(worldPoint.x * this.view.scale + this.view.x, worldPoint.y * this.view.scale + this.view.y);
  }

  createInterNodeFrom(fromId, point, excitatory) {
    const node = this.graph.addInterNode(point.x + 18, point.y);
    this.graph.addEdge(fromId, node.id, excitatory);
    this.hideMenu();
    this.callbacks.onChange?.();
  }

  finishConnection(fromId, toId, excitatory) {
    this.graph.addEdge(fromId, toId, excitatory);
    this.hideMenu();
    this.callbacks.onChange?.();
  }

  positionMenu(x, y) { this.menu.style.left = `${Math.round(x)}px`; this.menu.style.top = `${Math.round(y)}px`; this.menu.classList.add("show"); }
  hideMenu() { this.menu.classList.remove("show"); this.menu.innerHTML = ""; }

  updateNoiseControl() {
    const node = this.graph?.nodes.get("source:N_noise");
    if (!this.open || !node) return this.noiseControl.classList.remove("show");
    const screen = worldToScreen(this.view, { x: node.x, y: node.y + GRAPH_LAYOUT.nodeHeight * 0.5 + 18 });
    this.noiseControl.style.left = `${Math.round(screen.x - GRAPH_LAYOUT.nodeWidth * 0.5)}px`;
    this.noiseControl.style.top = `${Math.round(screen.y)}px`;
    this.noiseControl.classList.toggle("show", this.noiseHover || this.hoverNodeId === node.id);
  }

  fitView() {
    if (!this.graph) return;
    this.view = fitGraphView(this.graph, this.width, this.height, 48);
  }

  render(time) {
    if (!this.open || !this.graph) return;
    drawCircuitScene(this.ctx, this.width, this.height, this.palette, this.graph, this.evaluation, this.sensorEnabled, this.sensorModes, this.noiseFrequency, this.view, {
      time, showGrid: true, showPorts: true, showAddButtons: true, showEdgeLabels: true, hoverNodeId: this.hoverNodeId,
      dragPreview: this.linkDrag ? { start: this.linkDrag.start, end: this.linkDrag.end } : null
    });
    this.updateNoiseControl();
  }
}
