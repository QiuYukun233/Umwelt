import { MODES, MODE_ACCENT } from '../design/tokens.js';

/**
 * Mode switcher — top-left segmented control in the camera viewport.
 * Swaps the artboard's data-mode attribute; only the camera feed's color
 * treatment changes. The neural panel stays identical across all modes.
 */

// SVG icon paths for each mode (14×14 viewBox, stroke-based)
const MODE_ICONS = {
  visible: '<circle cx="7" cy="7" r="3.5"/><line x1="7" y1="1" x2="7" y2="3"/><line x1="7" y1="11" x2="7" y2="13"/><line x1="1" y1="7" x2="3" y2="7"/><line x1="11" y1="7" x2="13" y2="7"/>',
  ir:      '<rect x="2" y="4" width="10" height="6" rx="1"/><path d="M5 2.5c-1.5 0-2 1-2 1.5M9 2.5c1.5 0 2 1 2 1.5"/><line x1="4" y1="7" x2="10" y2="7"/>',
  lidar:   '<polygon points="7,1.5 12.5,12 1.5,12"/><line x1="4.5" y1="7" x2="9.5" y2="7"/><circle cx="7" cy="9.5" r="0.8"/>',
  uv:      '<circle cx="7" cy="7" r="4.5"/><path d="M4 4l6 6M10 4l-6 6"/>',
  gcamp:   '<ellipse cx="7" cy="8" rx="4" ry="3.5"/><path d="M5 5.5c0-2 1.5-3 2-3s2 1 2 3"/><circle cx="7" cy="8.5" r="1"/>',
};

// Human-readable mode labels (lowercase per casing rules)
const MODE_LABELS = {
  visible: 'visible',
  ir: 'infrared',
  lidar: 'lidar',
  uv: 'ultraviolet',
  gcamp: 'gcamp',
};

export class ModeSwitcher {
  /**
   * @param {HTMLElement} artboard  — the .artboard container
   * @param {object} [callbacks]
   * @param {function} [callbacks.onModeChange] — called with (newMode)
   */
  constructor(artboard, callbacks = {}) {
    this.artboard = artboard;
    this.callbacks = callbacks;
    this.currentMode = artboard.dataset.mode || 'visible';

    this._buildDOM();
    this._bind();
    this._updateActive();
  }

  _buildDOM() {
    // switcher bar
    this.el = document.createElement('div');
    this.el.className = 'mode-switcher';

    this.buttons = {};
    for (const mode of MODES) {
      const btn = document.createElement('button');
      btn.className = 'mode-btn';
      btn.type = 'button';
      btn.dataset.mode = mode;
      btn.setAttribute('aria-label', MODE_LABELS[mode]);
      btn.innerHTML = `<svg viewBox="0 0 14 14" width="14" height="14">${MODE_ICONS[mode]}</svg>`;
      this.el.appendChild(btn);
      this.buttons[mode] = btn;
    }

    // badge (label + dot below switcher)
    this.badge = document.createElement('div');
    this.badge.className = 'mode-badge';
    this.badge.innerHTML = `<span class="mode-badge-dot"></span><span class="mode-badge-label">${MODE_LABELS[this.currentMode]}</span>`;

    // insert into artboard's cam-viewport (or artboard itself)
    const viewport = this.artboard.querySelector('.cam-viewport') || this.artboard;
    viewport.appendChild(this.el);
    viewport.appendChild(this.badge);
  }

  _bind() {
    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('.mode-btn');
      if (!btn) return;
      const mode = btn.dataset.mode;
      if (mode && mode !== this.currentMode) {
        this.setMode(mode);
      }
    });
  }

  setMode(mode) {
    if (!MODES.includes(mode)) return;
    this.currentMode = mode;
    this.artboard.dataset.mode = mode;
    this._updateActive();
    this.callbacks.onModeChange?.(mode);
  }

  _updateActive() {
    for (const [m, btn] of Object.entries(this.buttons)) {
      btn.classList.toggle('active', m === this.currentMode);
    }
    const label = this.badge.querySelector('.mode-badge-label');
    if (label) label.textContent = MODE_LABELS[this.currentMode];
  }

  get mode() {
    return this.currentMode;
  }
}
