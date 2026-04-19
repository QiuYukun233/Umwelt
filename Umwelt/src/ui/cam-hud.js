import { LAYOUT } from '../design/tokens.js';

/**
 * CamHUD — DOM overlay elements inside the camera viewport.
 *
 * Layout regions (all positioned absolutely inside .cam-viewport):
 *   top-left:     REC dot + timecode, drone telemetry, camera params
 *   top-right:    subject tag + tracking status
 *   bottom-left:  scale bar, coordinates, environment data
 *   bottom-center: chem overlay chips (α β γ δ)
 *   bottom-right: frame counter, sim tick, playback controls
 */
export class CamHUD {
  /**
   * @param {HTMLElement} viewport — the .cam-viewport container
   */
  constructor(viewport) {
    this.viewport = viewport;
    this._buildDOM();
    this._elapsed = 0;
    this._frame = 0;
    this._tick = 0;
  }

  _buildDOM() {
    // ── top-left: REC + drone info ──
    this.topLeft = this._el('div', 'hud-top-left');
    this.topLeft.innerHTML = `
      <div class="rec-indicator">
        <span class="rec-dot"></span>
        <span class="rec-label obs-mono">rec</span>
        <span class="rec-time obs-mono" id="hud-timecode">00:00:00.0</span>
      </div>
      <div class="hud-drone obs-mono">drone 01 \u00b7 alt 0.42 m \u00b7 batt 84%</div>
      <div class="hud-cam obs-mono">f/2.8 \u00b7 1/250 s \u00b7 iso 200 \u00b7 50 mm macro</div>
    `;

    // ── top-right: subject tag ──
    this.topRight = this._el('div', 'hud-top-right');
    this.topRight.innerHTML = `
      <div class="hud-subject">subject 01 \u00b7 <em>Formica</em> cf. <em>japonica</em> \u00b7 live</div>
      <div class="hud-tracking obs-mono">tracking \u2014 lock stable \u2014 <span id="hud-track-time">0.0</span> s</div>
    `;

    // ── bottom-left: scale bar + coords ──
    this.bottomLeft = this._el('div', 'hud-bottom-left');
    this.bottomLeft.innerHTML = `
      <div class="hud-scalebar">
        <svg width="80" height="20" viewBox="0 0 80 20">
          <line x1="0" y1="0" x2="80" y2="0" stroke="currentColor" stroke-width="1"/>
          <line x1="0" y1="-4" x2="0" y2="4" stroke="currentColor" stroke-width="1"/>
          <line x1="40" y1="-3" x2="40" y2="3" stroke="currentColor" stroke-width="0.8"/>
          <line x1="80" y1="-4" x2="80" y2="4" stroke="currentColor" stroke-width="1"/>
          <text x="0" y="14" font-size="9" fill="currentColor">0</text>
          <text x="40" y="14" font-size="9" fill="currentColor" text-anchor="middle">5</text>
          <text x="80" y="14" font-size="9" fill="currentColor" text-anchor="end">10 mm</text>
        </svg>
      </div>
      <div class="hud-coords obs-mono" id="hud-coords">35\u00b027\u203238\u2033N 139\u00b038\u203221\u2033E \u00b7 env. 22.4 \u00b0C \u00b7 rh 68%</div>
    `;

    // ── bottom-center: chem chips ──
    this.bottomCenter = this._el('div', 'hud-bottom-center');
    this.bottomCenter.innerHTML = `
      <span class="hud-chip-label">overlay</span>
      <span class="hud-chip hud-chip-food">\u03b1 food</span>
      <span class="hud-chip hud-chip-off">\u03b2</span>
      <span class="hud-chip hud-chip-off">\u03b3</span>
      <span class="hud-chip hud-chip-danger">\u03b4 danger</span>
    `;

    // ── bottom-right: frame counter ──
    this.bottomRight = this._el('div', 'hud-bottom-right');
    this.bottomRight.innerHTML = `
      <div class="hud-frames obs-mono" id="hud-frames">F 0 \u00b7 60 fps</div>
      <div class="hud-simtick obs-mono" id="hud-simtick">sim tick 0 \u00b7 \u00d71.0</div>
    `;

    // cache refs
    this.els = {
      timecode: this.topLeft.querySelector('#hud-timecode'),
      trackTime: this.topRight.querySelector('#hud-track-time'),
      frames: this.bottomRight.querySelector('#hud-frames'),
      simtick: this.bottomRight.querySelector('#hud-simtick'),
    };

    // append all
    this.viewport.appendChild(this.topLeft);
    this.viewport.appendChild(this.topRight);
    this.viewport.appendChild(this.bottomLeft);
    this.viewport.appendChild(this.bottomCenter);
    this.viewport.appendChild(this.bottomRight);
  }

  _el(tag, cls) {
    const el = document.createElement(tag);
    el.className = cls;
    return el;
  }

  /** Called every render frame with simulation state. */
  update({ elapsed = 0, frame = 0, tick = 0, speed = 1, fps = 60 }) {
    // timecode
    const secs = elapsed;
    const h = (secs / 3600) | 0;
    const m = ((secs % 3600) / 60) | 0;
    const s = secs % 60;
    this.els.timecode.textContent =
      `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;

    // tracking time
    this.els.trackTime.textContent = elapsed.toFixed(1);

    // frame counter
    this.els.frames.textContent = `F ${frame.toLocaleString()} \u00b7 ${fps} fps`;

    // sim tick
    this.els.simtick.textContent = `sim tick ${tick.toLocaleString()} \u00b7 \u00d7${speed}`;
  }
}
