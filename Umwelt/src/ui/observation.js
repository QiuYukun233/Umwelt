import '../design/observation.css';
import { LAYOUT } from '../design/tokens.js';
import { ModeSwitcher } from './mode-switcher.js';
import { CamHUD } from './cam-hud.js';
import { NeuralPanel } from './neural-panel.js';

/**
 * Observation — the top-level artboard that owns the camera viewport
 * and operator panel (neural workstation).
 *
 * Layout: 1280 × 720, split 760 (cam) / 520 (panel).
 *
 * Usage:
 *   const obs = new Observation(document.getElementById('app'));
 *   // obs.camCanvas — the <canvas> for the world renderer
 *   // obs.panelEl  — the <div> for the neural panel
 *   // obs.mode     — current observation mode string
 */
export class Observation {
  /**
   * @param {HTMLElement} root — container to mount into
   * @param {object} [opts]
   * @param {string} [opts.initialMode='visible']
   * @param {function} [opts.onModeChange]
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.onModeChange = opts.onModeChange || null;

    this._buildDOM(opts.initialMode || 'visible');
    this.modeSwitcher = new ModeSwitcher(this.artboard, {
      onModeChange: (m) => this._handleModeChange(m),
    });
    this.hud = new CamHUD(this.viewport, {
      onPauseToggle: opts.onPauseToggle || null,
      onSpeedChange: opts.onSpeedChange || null,
    });
    this.neuralPanel = new NeuralPanel(this.panelEl, this.neuralMount, {
      onEditCircuit: opts.onEditCircuit || null,
    });
  }

  _buildDOM(initialMode) {
    // artboard
    this.artboard = document.createElement('div');
    this.artboard.className = 'artboard';
    this.artboard.dataset.mode = initialMode;

    // camera viewport (left 760px)
    this.viewport = document.createElement('div');
    this.viewport.className = 'cam-viewport';

    this.camCanvas = document.createElement('canvas');
    this.camCanvas.id = 'world';
    this.camCanvas.width = LAYOUT.cam.width;
    this.camCanvas.height = LAYOUT.frame.height;
    // Explicit CSS size so clientWidth/Height are available immediately
    // (before parent flex layout is computed). WorldRenderer.resize()
    // reads clientWidth synchronously in its constructor.
    this.camCanvas.style.width = `${LAYOUT.cam.width}px`;
    this.camCanvas.style.height = `${LAYOUT.frame.height}px`;
    this.viewport.appendChild(this.camCanvas);

    // per-mode color treatment layer — sits above the world canvas, below
    // the HUD / reticle. Toggled by CSS via .artboard[data-mode="..."].
    this.modeTreatment = document.createElement('div');
    this.modeTreatment.className = 'mode-treatment';
    this.modeTreatment.innerHTML =
      '<div class="mt-base"></div>' +
      '<div class="mt-grid"></div>' +
      '<div class="mt-glow"></div>';
    this.viewport.appendChild(this.modeTreatment);

    // reticle (placeholder — positioned by renderer when tracking a subject)
    this.reticle = document.createElement('div');
    this.reticle.className = 'reticle';
    this.reticle.innerHTML =
      '<span class="reticle-corner tl"></span>' +
      '<span class="reticle-corner tr"></span>' +
      '<span class="reticle-corner bl"></span>' +
      '<span class="reticle-corner br"></span>';
    this.viewport.appendChild(this.reticle);

    // chemical overlay layer (canvas or DOM — renderer will fill this)
    this.chemOverlay = document.createElement('div');
    this.chemOverlay.className = 'chem-overlay';
    this.viewport.appendChild(this.chemOverlay);

    this.artboard.appendChild(this.viewport);

    // operator panel (right 520px)
    this.panelEl = document.createElement('div');
    this.panelEl.className = 'neural-panel';

    const header = document.createElement('h2');
    header.className = 'neural-panel-header';
    header.textContent = 'subject CNS \u00b7 live';

    const sub = document.createElement('div');
    sub.className = 'neural-panel-sub';
    sub.textContent = 'neural circuit — all modes share this view';

    const divider = document.createElement('hr');
    divider.className = 'neural-panel-divider';

    // placeholder area where the neural graph will be mounted
    this.neuralMount = document.createElement('div');
    this.neuralMount.id = 'neural-mount';

    this.panelEl.appendChild(header);
    this.panelEl.appendChild(sub);
    this.panelEl.appendChild(divider);
    this.panelEl.appendChild(this.neuralMount);

    this.artboard.appendChild(this.panelEl);

    // mount
    this.root.appendChild(this.artboard);
  }

  _handleModeChange(mode) {
    this.onModeChange?.(mode);
  }

  /** Update reticle position & size (in cam-viewport coordinates). */
  setReticle(x, y, w, h) {
    const s = this.reticle.style;
    s.display = 'block';
    s.left = `${x}px`;
    s.top = `${y}px`;
    s.width = `${w}px`;
    s.height = `${h}px`;
  }

  hideReticle() {
    this.reticle.style.display = 'none';
  }

  get mode() {
    return this.modeSwitcher.mode;
  }

  setMode(mode) {
    this.modeSwitcher.setMode(mode);
  }
}
