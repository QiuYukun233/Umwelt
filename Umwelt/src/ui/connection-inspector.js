// Connection inspector — floating panel that edits the selected edge.
// Replaces the old double-click window.prompt weight flow; adds
// plastic toggle and mod-source selector.
//
// Mounts into an existing DOM node (e.g. #connection-inspector-panel).
// Visibility and rebuild are driven by the NeuralEditor that owns
// selectedEdgeId; this class has no knowledge of pointer events or
// canvas geometry.

export class ConnectionInspector {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.graph = null;
    this.edgeId = null;
    this._lastEdgeId = null;
    this._lastPlastic = null;

    this.el = document.createElement("div");
    this.el.className = "ci-panel";
    this.el.innerHTML = `
      <div class="ci-header">
        <span class="ci-title">连线</span>
        <span class="ci-route mono"></span>
        <button class="ci-close" type="button" aria-label="关闭">×</button>
      </div>
      <label class="ci-row">
        <span class="ci-label">权重 w_init</span>
        <input class="ci-weight mono" type="number" step="0.05" />
      </label>
      <label class="ci-row ci-plastic-row">
        <input class="ci-plastic" type="checkbox" />
        <span class="ci-label">可塑（蘑菇体突触）</span>
      </label>
      <label class="ci-row ci-mod-row">
        <span class="ci-label">调制源</span>
        <select class="ci-mod mono"></select>
      </label>
      <div class="ci-runtime mono"></div>
      <div class="ci-hint"></div>
    `;
    container.appendChild(this.el);

    this.routeEl = this.el.querySelector(".ci-route");
    this.weightEl = this.el.querySelector(".ci-weight");
    this.plasticEl = this.el.querySelector(".ci-plastic");
    this.plasticRowEl = this.el.querySelector(".ci-plastic-row");
    this.modEl = this.el.querySelector(".ci-mod");
    this.modRowEl = this.el.querySelector(".ci-mod-row");
    this.runtimeEl = this.el.querySelector(".ci-runtime");
    this.hintEl = this.el.querySelector(".ci-hint");
    this.closeBtn = this.el.querySelector(".ci-close");

    this.closeBtn.addEventListener("click", () => this.callbacks.onClose?.());
    this.weightEl.addEventListener("change", () => this._commitWeight());
    this.plasticEl.addEventListener("change", () => this._commitPlastic());
    this.modEl.addEventListener("change", () => this._commitModSource());
  }

  setGraph(graph) {
    this.graph = graph;
  }

  // Render/sync panel state for a given edge id. Call every frame if open —
  // cheap: most rebuilds are fast-path text updates.
  update(edgeId) {
    this.edgeId = edgeId;
    if (!this.graph || !edgeId) return this.hide();
    const edge = this.graph.edges.get(edgeId);
    if (!edge) return this.hide();
    this.show();

    // Heavy rebuild when edge identity or plastic flag changes; otherwise
    // only refresh the live runtime readout (w during learning).
    const plasticChanged = this._lastPlastic !== edge.plastic;
    if (this._lastEdgeId !== edgeId || plasticChanged) {
      this._rebuild(edge);
      this._lastEdgeId = edgeId;
      this._lastPlastic = edge.plastic;
    }
    this._refreshRuntime(edge);
  }

  _rebuild(edge) {
    const fromNode = this.graph.nodes.get(edge.fromId);
    const toNode = this.graph.nodes.get(edge.toId);
    this.routeEl.textContent = `${nodeLabel(fromNode)} → ${nodeLabel(toNode)}`;

    // Weight input: plastic branch allows [0, 1]; fixed branch keeps [0.1, 1].
    if (edge.plastic) {
      this.weightEl.min = "0";
      this.weightEl.max = "1";
    } else {
      this.weightEl.min = "0.1";
      this.weightEl.max = "1";
    }
    this.weightEl.value = String(edge.weight ?? 1);

    // Plastic checkbox
    const modulators = this.graph.getModulatorNodes();
    const hasModulator = modulators.length > 0;
    this.plasticEl.checked = edge.plastic === true;
    this.plasticEl.disabled = !hasModulator && !edge.plastic;
    this.plasticRowEl.classList.toggle("ci-disabled", !hasModulator && !edge.plastic);

    // Mod source dropdown: populate and show only when plastic is on.
    this._populateModOptions(modulators, edge);
    this.modRowEl.style.display = edge.plastic ? "" : "none";

    // Hint line: guide the player when something's off.
    if (!hasModulator && !edge.plastic) {
      this.hintEl.textContent = "图中还没有调制神经元，无法启用可塑。先添加一个调制节点。";
    } else if (edge.plastic && !edge.mod_source_id) {
      this.hintEl.textContent = "请选择一个调制源。";
    } else {
      this.hintEl.textContent = "";
    }
  }

  _populateModOptions(modulators, edge) {
    // Preserve currently-bound mod_source_id even if it's about to be rebuilt.
    const currentBinding = edge.mod_source_id;
    this.modEl.innerHTML = "";
    if (modulators.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "— 无调制神经元 —";
      this.modEl.appendChild(opt);
      this.modEl.disabled = true;
      return;
    }
    if (!currentBinding) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "— 选择 —";
      this.modEl.appendChild(placeholder);
    }
    for (const node of modulators) {
      const opt = document.createElement("option");
      opt.value = node.id;
      opt.textContent = nodeLabel(node);
      if (node.id === currentBinding) opt.selected = true;
      this.modEl.appendChild(opt);
    }
    this.modEl.disabled = false;
  }

  _refreshRuntime(edge) {
    if (!edge.plastic) {
      this.runtimeEl.textContent = "";
      return;
    }
    const w = Number.isFinite(edge.w) ? edge.w : edge.weight;
    const delta = w - edge.weight;
    const learned = Math.abs(delta) > 0.05;
    this.runtimeEl.textContent = `当前 w = ${w.toFixed(3)}  (Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(3)})`;
    this.runtimeEl.classList.toggle("ci-runtime-learned", learned);
  }

  show() {
    this.el.classList.add("show");
  }

  hide() {
    this.el.classList.remove("show");
    this.edgeId = null;
    this._lastEdgeId = null;
    this._lastPlastic = null;
  }

  _commitWeight() {
    if (!this.graph || !this.edgeId) return;
    const value = Number(this.weightEl.value);
    if (!Number.isFinite(value)) return;
    this.graph.updateEdgeWeight(this.edgeId, value);
    this.callbacks.onChange?.();
    // Refresh — clamp may have adjusted the committed value.
    const edge = this.graph.edges.get(this.edgeId);
    if (edge) this.weightEl.value = String(edge.weight);
  }

  _commitPlastic() {
    if (!this.graph || !this.edgeId) return;
    const edge = this.graph.edges.get(this.edgeId);
    if (!edge) return;
    if (!this.plasticEl.checked) {
      this.graph.setEdgePlastic(this.edgeId, { plastic: false });
      this.callbacks.onChange?.();
      return;
    }
    // Enabling plastic requires a mod source. If none picked yet, pick the
    // first modulator as a default; if none exist, bail and uncheck.
    const modulators = this.graph.getModulatorNodes();
    if (modulators.length === 0) {
      this.plasticEl.checked = false;
      return;
    }
    const modSourceId = edge.mod_source_id || modulators[0].id;
    const result = this.graph.setEdgePlastic(this.edgeId, { plastic: true, modSourceId });
    if (!result) {
      this.plasticEl.checked = false;
    }
    this.callbacks.onChange?.();
  }

  _commitModSource() {
    if (!this.graph || !this.edgeId) return;
    const edge = this.graph.edges.get(this.edgeId);
    if (!edge || !edge.plastic) return;
    const modSourceId = this.modEl.value;
    if (!modSourceId) return;
    this.graph.setEdgePlastic(this.edgeId, { plastic: true, modSourceId });
    this.callbacks.onChange?.();
  }
}

function nodeLabel(node) {
  if (!node) return "?";
  return node.label || node.id || "?";
}
