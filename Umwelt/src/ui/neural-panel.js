import { NODE } from '../design/tokens.js';

/**
 * NeuralPanel — populates the right-side operator panel with:
 *   - legend (node type shapes + colors)
 *   - selected cell inspector
 *   - neural graph canvas mount
 *   - live trace area
 *   - panel footer (breakpoints, tick rate, edit circuit link)
 *
 * Does NOT own the graph rendering itself — it provides mount points
 * that the existing GraphRenderer / NeuralEditor can attach to.
 */
export class NeuralPanel {
  /**
   * @param {HTMLElement} panelEl — the .neural-panel container (from Observation)
   * @param {HTMLElement} neuralMount — the #neural-mount div inside the panel
   * @param {object} [callbacks]
   * @param {function} [callbacks.onEditCircuit]
   */
  constructor(panelEl, neuralMount, callbacks = {}) {
    this.panelEl = panelEl;
    this.neuralMount = neuralMount;
    this.callbacks = callbacks;
    this._buildDOM();
  }

  _buildDOM() {
    // ── legend ──
    this.legend = this._el('div', 'np-legend');
    this.legend.innerHTML = `
      <div class="np-legend-title">node types</div>
      <div class="np-legend-row">
        ${this._legendItem('sensor', 'sensor')}
        ${this._legendItem('interPos', 'inter (+)')}
        ${this._legendItem('interNeg', 'inter (\u2212)')}
        ${this._legendItem('modulator', 'modulator')}
        ${this._legendItem('motor', 'motor')}
      </div>
    `;
    this.neuralMount.appendChild(this.legend);

    // ── selected cell inspector ──
    this.inspector = this._el('div', 'np-inspector');
    this.inspector.style.display = 'none';
    this.inspector.innerHTML = `
      <div class="np-inspector-label">selected</div>
      <div class="np-inspector-name" id="np-sel-name">—</div>
      <div class="np-inspector-detail obs-mono" id="np-sel-detail">—</div>
    `;
    this.neuralMount.appendChild(this.inspector);

    // ── graph canvas mount ──
    // Explicit CSS size so clientWidth/Height are non-zero when GraphRenderer
    // constructs and calls fitCanvas() before the flex layout is computed.
    this.graphCanvas = document.createElement('canvas');
    this.graphCanvas.className = 'np-graph-canvas';
    this.graphCanvas.width = 472;
    this.graphCanvas.height = 360;
    this.graphCanvas.style.width = '472px';
    this.graphCanvas.style.height = '360px';
    this.neuralMount.appendChild(this.graphCanvas);

    // ── live trace ──
    this.trace = this._el('div', 'np-trace');
    this.trace.innerHTML = `
      <div class="np-trace-label">live trace — 2.4 s window</div>
      <canvas class="np-trace-canvas" width="472" height="48"></canvas>
    `;
    this.neuralMount.appendChild(this.trace);

    // ── footer ──
    this.footer = this._el('div', 'np-footer');
    this.footer.innerHTML = `
      <span class="np-footer-info">0 breakpoints \u00b7 60 tick/s \u00b7 lock stable</span>
      <button class="np-edit-btn" type="button">edit circuit \u2192</button>
    `;
    this.neuralMount.appendChild(this.footer);

    // bind edit button
    this.footer.querySelector('.np-edit-btn').addEventListener('click', () => {
      this.callbacks.onEditCircuit?.();
    });
  }

  _el(tag, cls) {
    const el = document.createElement(tag);
    el.className = cls;
    return el;
  }

  _legendItem(type, label) {
    const { color, shape } = NODE[type];
    let icon = '';
    switch (shape) {
      case 'circle-dot':
        icon = `<svg width="14" height="14" viewBox="0 0 14 14">
          <circle cx="7" cy="7" r="5" fill="none" stroke="${color}" stroke-width="1.2"/>
          <circle cx="7" cy="7" r="2" fill="${color}"/>
        </svg>`;
        break;
      case 'triangle':
        icon = `<svg width="14" height="14" viewBox="0 0 14 14">
          <path d="M7 2 L13 12 L1 12 Z" fill="none" stroke="${color}" stroke-width="1.2"/>
        </svg>`;
        break;
      case 'circle':
        icon = `<svg width="14" height="14" viewBox="0 0 14 14">
          <circle cx="7" cy="7" r="5" fill="none" stroke="${color}" stroke-width="1.2"/>
        </svg>`;
        break;
      case 'diamond':
        icon = `<svg width="14" height="14" viewBox="0 0 14 14">
          <rect x="3" y="3" width="8" height="8" transform="rotate(45 7 7)" fill="none" stroke="${color}" stroke-width="1.2"/>
        </svg>`;
        break;
      case 'square':
        icon = `<svg width="14" height="14" viewBox="0 0 14 14">
          <rect x="3" y="3" width="8" height="8" fill="none" stroke="${color}" stroke-width="1.2"/>
        </svg>`;
        break;
    }
    return `<span class="np-legend-item">${icon}<span>${label}</span></span>`;
  }

  /** Show selected node info in the inspector. */
  selectNode(name, detail) {
    this.inspector.style.display = '';
    this.inspector.querySelector('#np-sel-name').textContent = name;
    this.inspector.querySelector('#np-sel-detail').textContent = detail;
  }

  clearSelection() {
    this.inspector.style.display = 'none';
  }
}
