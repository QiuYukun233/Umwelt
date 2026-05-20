import { GRAPH_LAYOUT } from "../config.js";
import { fitCanvas, readThemeVars, clamp } from "../math.js";
import { nodeHasInput, nodeHasOutput, nodePort, nodeRect } from "../neural.js";
import { drawCircuitScene, fitGraphView, sampleCurveDistance, screenToWorld, worldToScreen, computeGroupBoxes, resolveEdgeGeometry } from "../renderer/graph.js";
import { BodyEditor } from "./body-editor.js";
import { ConnectionInspector } from "./connection-inspector.js";

const CREATABLE_TYPES = [
  { type: "inter_exc",  label: "兴奋神经元", desc: "传递并积累兴奋信号" },
  { type: "inter_inh",  label: "抑制神经元", desc: "压制目标节点的激活" },
  { type: "modulator",  label: "调制神经元", desc: "改变目标节点的敏感度" }
];

function nodeTypeOf(node) {
  return node?.neuronType ?? node?.type;
}

function isEditableNode(node) {
  const neuronType = nodeTypeOf(node);
  return neuronType === "inter_exc" || neuronType === "inter_inh" || neuronType === "modulator";
}

function promptNumber(message, currentValue, min, max) {
  const raw = window.prompt(message, String(currentValue));
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return clamp(value, min, max);
}

const DRAG_THRESHOLD = 5;

function connectionBlockReason(node, direction) {
  const neuronType = nodeTypeOf(node);
  if (direction === "input" && neuronType === "sensor_on") return "sensor_on 是只出不入的感受器，不能接收输入边。";
  if (direction === "output" && neuronType === "motor") return "motor 是只入不出的输出节点，不能发出输出边。";
  return "这个节点不支持当前连线方向。";
}

export class NeuralEditor {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.overlay = document.getElementById("editor-overlay");
    this.stage = document.getElementById("editor-stage");
    this.canvas = document.getElementById("editor-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.menu = document.getElementById("editor-menu");
    this.runBtn = document.getElementById("editor-run-btn");
    this.resetBtn = document.getElementById("editor-reset-btn");
    this.exportBtn = document.getElementById("editor-export-btn");
    this.importBtn = document.getElementById("editor-import-btn");
    this.importFile = document.getElementById("editor-import-file");
    this.loadModuleBtn = document.getElementById("editor-load-module-btn");
    this.moduleFile = document.getElementById("editor-module-file");
    this.bodyTurnSlider = document.getElementById("body-turn");
    this.bodyTurnVal = document.getElementById("body-turn-val");
    this.bodySpeedSlider = document.getElementById("body-speed");
    this.bodySpeedVal = document.getElementById("body-speed-val");
    this.bodyEditorBtn = document.getElementById("body-editor-btn");
    this.bodyEditor = new BodyEditor(document.getElementById("body-editor-panel"), {
      onClose: () => this.toggleBodyEditor(false),
      onSensorConfigChange: (config) => this.callbacks.onSensorConfigChange?.(config)
    });
    const inspectorMount = document.getElementById("connection-inspector-panel");
    this.inspector = inspectorMount
      ? new ConnectionInspector(inspectorMount, {
          onClose: () => this.clearSelection(),
          onChange: () => this.callbacks.onChange?.()
        })
      : null;
    this.open = false;
    this.graph = null;
    this.evaluation = {
      nodeSignals: {}, edgeSignals: {},
      motorInputs: { motor_forward: 0, motor_turn_L: 0, motor_turn_R: 0, gland_alpha: 0, gland_beta: 0, mandible: 0 },
      motorLevels: { motor_forward: 0, motor_turn_L: 0, motor_turn_R: 0, gland_alpha: 0, gland_beta: 0, mandible: 0 }
    };
    this.sensorEnabled = {};
    this.view = { x: 0, y: 0, scale: 1 };
    this.hoverNodeId = null;
    this.pendingDrag = null;
    this.dragNode = null;
    this.panState = null;
    this.linkDrag = null;
    this.hoverEdgeId = null;
    this.selectedEdgeId = null;
    this.pendingEdgeClick = null;
    this.collapsedGroups = this.loadCollapseState();
    this.groupBoxes = null;
    this.pendingGroupClick = null;
    this.noticeTimer = null;
    this.refreshTheme();
    this.bind();
    this.resize();
  }

  refreshTheme() {
    this.palette = readThemeVars(["surface", "surface-2", "border", "border-2", "text", "text-soft", "text-faint", "amber", "mint", "red", "brown", "blue"]);
  }

  bind() {
    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointerleave", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("dblclick", (event) => this.onDoubleClick(event));
    this.canvas.addEventListener("contextmenu", (event) => this.onContextMenu(event));
    this.canvas.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    this.runBtn.addEventListener("click", () => this.callbacks.onRun?.());
    this.resetBtn.addEventListener("click", () => this.callbacks.onReset?.());
    this.exportBtn.addEventListener("click", () => this.callbacks.onExport?.());
    this.importBtn.addEventListener("click", () => this.importFile.click());
    this.importFile.addEventListener("change", () => {
      const file = this.importFile.files[0];
      if (file) {
        file.text().then((text) => this.callbacks.onImport?.(text));
        this.importFile.value = "";
      }
    });
    this.loadModuleBtn.addEventListener("click", () => this.moduleFile.click());
    this.moduleFile.addEventListener("change", () => {
      const file = this.moduleFile.files[0];
      if (file) {
        file.text().then((text) => this.callbacks.onLoadModule?.(text));
        this.moduleFile.value = "";
      }
    });
    this.bodyTurnSlider.addEventListener("input", () => this.onBodyParamChange());
    this.bodySpeedSlider.addEventListener("input", () => this.onBodyParamChange());
    this.bodyEditorBtn.addEventListener("click", () => this.toggleBodyEditor());
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("pointerdown", (event) => {
      if (this.open && this.menu.classList.contains("show") && !event.target.closest("#editor-menu")) this.hideMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (!this.open) return;
      if (event.key === "Escape" && this.selectedEdgeId) {
        this.clearSelection();
      }
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
    if (this.open) {
      this.resize();
      this.fitView();
    }
  }

  setGraph(graph) {
    this.graph = graph;
    if (this.inspector) this.inspector.setGraph(graph);
    // If the previously-selected edge vanished, drop the selection so the
    // panel doesn't linger with stale data.
    if (this.selectedEdgeId && !graph?.edges?.has(this.selectedEdgeId)) {
      this.clearSelection();
    }
  }

  selectEdge(edgeId) {
    if (!this.graph || !this.graph.edges.has(edgeId)) return;
    this.selectedEdgeId = edgeId;
    this.callbacks.onSelectionChange?.(edgeId);
  }

  clearSelection() {
    if (!this.selectedEdgeId) return;
    this.selectedEdgeId = null;
    if (this.inspector) this.inspector.hide();
    this.callbacks.onSelectionChange?.(null);
  }
  setEvaluation(evaluation) { this.evaluation = evaluation; }
  setSensorState(sensorEnabled) { this.sensorEnabled = sensorEnabled; }

  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  toWorld(point) {
    return screenToWorld(this.view, point);
  }

  showNotice(message, point = null) {
    if (this.noticeTimer) window.clearTimeout(this.noticeTimer);
    this.menu.innerHTML = `<div class="editor-menu-title">${message}</div>`;
    const fallback = point ?? { x: this.width * 0.5, y: 24 };
    this.positionMenu(fallback.x, fallback.y);
    this.noticeTimer = window.setTimeout(() => {
      if (this.menu.textContent === message) this.hideMenu();
    }, 1400);
  }

  hitTest(point) {
    if (!this.graph) return null;
    if (this.groupBoxes) {
      for (const [key, box] of Object.entries(this.groupBoxes)) {
        const r = box.rect;
        if (point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + box.headerH) {
          return { kind: "group-header", groupKey: key };
        }
      }
    }
    const hidden = this._hiddenNodeIds();
    for (const edge of [...this.graph.edges.values()].reverse()) {
      const geometry = this._resolveEdgeGeo(edge);
      if (geometry && Math.hypot(point.x - geometry.label.x, point.y - geometry.label.y) <= 12) return { kind: "edge-label", edgeId: edge.id };
    }
    for (const node of [...this.graph.nodes.values()].reverse()) {
      if (hidden.has(node.id)) continue;
      const rect = nodeRect(node);
      if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) return { kind: "node", nodeId: node.id };
    }
    for (const edge of [...this.graph.edges.values()].reverse()) {
      const geometry = this._resolveEdgeGeo(edge);
      if (geometry && sampleCurveDistance(geometry, point) <= 8) return { kind: "edge", edgeId: edge.id };
    }
    return null;
  }

  _resolveEdgeGeo(edge) {
    if (!this.groupBoxes || !this.collapsedGroups) return this.graph.edgeGeometry(edge);
    return resolveEdgeGeometry(this.graph, edge, this.groupBoxes, this.collapsedGroups);
  }

  _hiddenNodeIds() {
    const hidden = new Set();
    if (this.groupBoxes) {
      for (const [key, box] of Object.entries(this.groupBoxes)) {
        if (this.collapsedGroups?.[key]) for (const id of box.nodeIds) hidden.add(id);
      }
    }
    return hidden;
  }

  onPointerDown(event) {
    if (!this.open || event.button !== 0) return;
    const screenPoint = this.point(event);
    const worldPoint = this.toWorld(screenPoint);
    const hit = this.hitTest(worldPoint);
    this.hideMenu();
    if (hit?.kind === "group-header") {
      this.pendingGroupClick = hit.groupKey;
      return;
    }
    if (hit?.kind === "node") {
      this.pendingDrag = { nodeId: hit.nodeId, startScreen: { ...screenPoint }, startWorld: { ...worldPoint }, hoverTimer: null };
      // A node-hit click clears any edge selection once it resolves as a
      // click rather than a drag (see onPointerUp); we leave selection
      // intact here so drag-to-move doesn't flicker the panel.
      return;
    }
    if (hit?.kind === "edge" || hit?.kind === "edge-label") {
      this.pendingEdgeClick = { edgeId: hit.edgeId, startScreen: { ...screenPoint } };
      return;
    }
    // Empty canvas: clear selection so the click reads as "deselect", then
    // pan.
    if (this.selectedEdgeId) this.clearSelection();
    this.panState = { screen: screenPoint, view: { ...this.view } };
  }

  onPointerMove(event) {
    if (!this.open || !this.graph) return;
    const screenPoint = this.point(event);
    const worldPoint = this.toWorld(screenPoint);
    const hit = this.hitTest(worldPoint);
    this.hoverNodeId = hit?.kind === "node" ? hit.nodeId : null;
    this.hoverEdgeId = (hit?.kind === "edge" || hit?.kind === "edge-label") ? hit.edgeId : null;
    let cursor = "grab";
    if (this.dragNode) cursor = "grabbing";
    else if (this.linkDrag) cursor = "crosshair";
    else if (this.panState) cursor = "grabbing";
    else if (hit?.kind === "node" || hit?.kind === "edge-label") {
      const hNode = hit?.kind === "node" ? this.graph.nodes.get(hit.nodeId) : null;
      if (hNode && nodeHasOutput(hNode)) {
        const outPort = nodePort(hNode, "out");
        if (Math.hypot(worldPoint.x - outPort.x, worldPoint.y - outPort.y) <= 14) cursor = "crosshair";
        else cursor = "pointer";
      } else {
        cursor = "pointer";
      }
    }
    this.canvas.style.cursor = cursor;

    if (this.pendingEdgeClick) {
      const dx = screenPoint.x - this.pendingEdgeClick.startScreen.x;
      const dy = screenPoint.y - this.pendingEdgeClick.startScreen.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        // Treat it as a pan, not a click.
        this.pendingEdgeClick = null;
        this.panState = { screen: screenPoint, view: { ...this.view } };
      }
    }

    if (this.pendingDrag) {
      const dx = screenPoint.x - this.pendingDrag.startScreen.x;
      const dy = screenPoint.y - this.pendingDrag.startScreen.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        const node = this.graph.nodes.get(this.pendingDrag.nodeId);
        if (node && isEditableNode(node)) {
          // If drag started near the output port → link; otherwise → move
          const outPort = nodePort(node, "out");
          const distToPort = Math.hypot(this.pendingDrag.startWorld.x - outPort.x, this.pendingDrag.startWorld.y - outPort.y);
          if (distToPort <= 14 && nodeHasOutput(node)) {
            this.linkDrag = { fromId: node.id, start: { x: node.x, y: node.y }, end: worldPoint };
          } else {
            this.dragNode = { id: node.id, originX: node.x, originY: node.y, dx: this.pendingDrag.startWorld.x - node.x, dy: this.pendingDrag.startWorld.y - node.y };
          }
        } else if (node && nodeHasOutput(node)) {
          this.linkDrag = { fromId: node.id, start: { x: node.x, y: node.y }, end: worldPoint };
        } else if (node) {
          this.showNotice(connectionBlockReason(node, "output"), screenPoint);
        }
        this.pendingDrag = null;
      }
    } else if (this.dragNode) {
      const node = this.graph.nodes.get(this.dragNode.id);
      if (node) {
        let newX = worldPoint.x - this.dragNode.dx;
        let newY = worldPoint.y - this.dragNode.dy;
        for (const other of this.graph.nodes.values()) {
          if (other.id === node.id) continue;
          const r = nodeRect(other);
          const nw = nodeRect(node).width;
          const nh = nodeRect(node).height;
          const cx = newX, cy = newY;
          if (cx + nw / 2 > r.x && cx - nw / 2 < r.x + r.width && cy + nh / 2 > r.y && cy - nh / 2 < r.y + r.height) {
            const pushX = cx < other.x ? r.x - nw / 2 - 2 : r.x + r.width + nw / 2 + 2;
            newX = pushX;
          }
        }
        node.x = newX;
        node.y = newY;
        this.callbacks.onChange?.();
      }
    } else if (this.panState) {
      this.view.x = this.panState.view.x + (screenPoint.x - this.panState.screen.x);
      this.view.y = this.panState.view.y + (screenPoint.y - this.panState.screen.y);
    } else if (this.linkDrag) {
      this.linkDrag.end = worldPoint;
    }
  }

  onPointerUp(event) {
    if (!this.open) return;
    if (this.pendingGroupClick) {
      const key = this.pendingGroupClick;
      this.pendingGroupClick = null;
      this.collapsedGroups[key] = !this.collapsedGroups[key];
      this.saveCollapseState();
      return;
    }
    if (this.pendingEdgeClick) {
      this.selectEdge(this.pendingEdgeClick.edgeId);
      this.pendingEdgeClick = null;
      this.panState = null;
      return;
    }
    if (this.pendingDrag) {
      const node = this.graph.nodes.get(this.pendingDrag.nodeId);
      if (node && isEditableNode(node)) {
        this.hoverNodeId = node.id;
        // Click resolved on an editable node — deselect any edge.
        if (this.selectedEdgeId) this.clearSelection();
      } else if (node && node.neuronType === "sensor_on" && node.sourceId) {
        this.callbacks.onToggleSensor?.(node.sourceId);
        if (this.selectedEdgeId) this.clearSelection();
      }
      this.pendingDrag = null;
    } else if (this.dragNode) {
      this.dragNode = null;
    } else if (this.linkDrag) {
      const worldPoint = this.toWorld(this.point(event));
      const hit = this.hitTest(worldPoint);
      if (hit?.kind === "node" && hit.nodeId !== this.linkDrag.fromId) {
        const targetNode = this.graph.nodes.get(hit.nodeId);
        if (targetNode && nodeHasInput(targetNode)) {
          this.graph.addEdge(this.linkDrag.fromId, hit.nodeId);
          this.callbacks.onChange?.();
        } else if (targetNode) {
          this.showNotice(connectionBlockReason(targetNode, "input"), this.point(event));
        }
      }
    }
    this.panState = null;
    this.linkDrag = null;
  }

  onDoubleClick(event) {
    if (!this.open || !this.graph) return;
    const worldPoint = this.toWorld(this.point(event));
    const hit = this.hitTest(worldPoint);
    event.preventDefault();
    this.hideMenu();
    if (!hit) return this.showNewNodeMenu(worldPoint, this.point(event));

    // Edge double-click is absorbed by single-click selection + inspector panel.
    // Keeping node-tau prompt unchanged.
    if (hit.kind === "edge" || hit.kind === "edge-label") {
      this.selectEdge(hit.edgeId);
      return;
    }

    if (hit.kind === "node") {
      const node = this.graph.nodes.get(hit.nodeId);
      if (!isEditableNode(node)) return;
      const tau = promptNumber("Set node tau in seconds (0.5 to 10.0)", node.tau ?? 3, 0.5, 10.0);
      if (tau === null) return;
      this.graph.updateNodeTau(hit.nodeId, tau);
      this.callbacks.onChange?.();
    }
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
    if (kind === "node" && !isEditableNode(this.graph.nodes.get(id))) return;
    this.menu.innerHTML = `<button class="editor-item danger">${kind === "edge" ? "删除连线" : "删除节点"}</button>`;
    this.menu.firstElementChild.addEventListener("click", () => {
      if (kind === "edge") {
        this.graph.removeEdge(id);
        if (this.selectedEdgeId === id) this.clearSelection();
      } else {
        // removeNode may cascade-delete edges including the selected one,
        // or revert plastic edges bound to a deleted modulator. Resync.
        this.graph.removeNode(id);
        if (this.selectedEdgeId && !this.graph.edges.has(this.selectedEdgeId)) {
          this.clearSelection();
        }
      }
      this.hideMenu();
      this.callbacks.onChange?.();
    });
    this.positionMenu(point.x, point.y);
  }

  showNewNodeMenu(worldPoint, screenPoint) {
    const buttons = CREATABLE_TYPES.map(
      (t) => `<button class="editor-item" data-type="${t.type}">${t.label} <small>${t.desc}</small></button>`
    );
    this.menu.innerHTML = `<div class="editor-menu-title">新建节点</div>${buttons.join("")}`;
    for (const button of this.menu.querySelectorAll("[data-type]")) {
      button.addEventListener("click", () => {
        this.graph.addInterNode(worldPoint.x, worldPoint.y, button.dataset.type);
        this.hideMenu();
        this.callbacks.onChange?.();
      });
    }
    this.positionMenu(screenPoint.x, screenPoint.y);
  }

  positionMenu(x, y) {
    this.menu.style.left = `${Math.round(x)}px`;
    this.menu.style.top = `${Math.round(y)}px`;
    this.menu.classList.add("show");
  }

  hideMenu() {
    if (this.noticeTimer) {
      window.clearTimeout(this.noticeTimer);
      this.noticeTimer = null;
    }
    this.menu.classList.remove("show");
    this.menu.innerHTML = "";
  }

  onBodyParamChange() {
    const turnScale = this.bodyTurnSlider.value / 100;
    const speedScale = this.bodySpeedSlider.value / 100;
    this.bodyTurnVal.textContent = turnScale.toFixed(1);
    this.bodySpeedVal.textContent = speedScale.toFixed(1);
    this.callbacks.onBodyParams?.({ turnScale, speedScale });
  }

  getBodyParams() {
    return {
      turnScale: this.bodyTurnSlider.value / 100,
      speedScale: this.bodySpeedSlider.value / 100
    };
  }

  setBodyParams(params) {
    this.bodyTurnSlider.value = Math.round(params.turnScale * 100);
    this.bodySpeedSlider.value = Math.round(params.speedScale * 100);
    this.bodyTurnVal.textContent = params.turnScale.toFixed(1);
    this.bodySpeedVal.textContent = params.speedScale.toFixed(1);
  }

  toggleBodyEditor(forceState) {
    const open = forceState ?? !this.bodyEditor.isOpen();
    if (open) {
      this.bodyEditor.open(this._sensorConfig);
    } else {
      this.bodyEditor.close();
      // Defer resize until CSS has repainted (be-active class removed)
      requestAnimationFrame(() => {
        this.resize();
        this.fitView();
      });
    }
    this.bodyEditorBtn.classList.toggle("on", open);
  }

  setSensorConfig(config) {
    this._sensorConfig = config;
    if (this.bodyEditor.isOpen()) this.bodyEditor.open(config);
  }

  fitView() {
    if (!this.graph) return;
    this.view = fitGraphView(this.graph, this.width, this.height, 48);
  }

  loadCollapseState() {
    try {
      const raw = localStorage.getItem("umwelt_groups");
      if (raw) return JSON.parse(raw);
    } catch (_) { /* silent */ }
    return { chemical: false, mechanical: true, environmental: true, proprio: true, motor: true };
  }

  saveCollapseState() {
    try {
      localStorage.setItem("umwelt_groups", JSON.stringify(this.collapsedGroups));
    } catch (_) { /* silent */ }
  }

  render(time) {
    if (!this.open || !this.graph) return;
    this.groupBoxes = computeGroupBoxes(this.graph);
    drawCircuitScene(this.ctx, this.width, this.height, this.palette, this.graph, this.evaluation, this.sensorEnabled, {}, this.view, {
      time,
      showGrid: true,
      showPorts: true,
      showEdgeLabels: true,
      hoverNodeId: this.hoverNodeId,
      hoverEdgeId: this.hoverEdgeId,
      selectedEdgeId: this.selectedEdgeId,
      dragPreview: this.linkDrag ? { start: this.linkDrag.start, end: this.linkDrag.end } : null,
      collapsedGroups: this.collapsedGroups
    });
    if (this.inspector) this.inspector.update(this.selectedEdgeId);
  }
}
