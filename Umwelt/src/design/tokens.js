/**
 * Umwelt design tokens
 *
 * Single source of truth for all UI surfaces.
 * Mirrors design_tokens.md — do not hardcode hex values in components.
 */

// ---------------------------------------------------------------------------
// scene backgrounds (per observation mode)
// ---------------------------------------------------------------------------

export const SCENE = {
  visible: {
    bg: [
      { offset: 0, color: '#5A3A20' },
      { offset: 0.55, color: '#2E1C0E' },
      { offset: 1, color: '#120802' },
    ],
  },
  ir: {
    bg: [
      { offset: 0, color: '#F0C848' },
      { offset: 0.35, color: '#C85820' },
      { offset: 0.7, color: '#5E2A6E' },
      { offset: 1, color: '#0A1030' },
    ],
    hotspot: [
      { offset: 0, color: '#FFE080' },
      { offset: 0.35, color: '#E84B3C' },
    ],
    coldbody: ['#1A3B7A', '#050A20'],
  },
  lidar: {
    bg: [
      { offset: 0, color: '#3E7A98' },
      { offset: 0.35, color: '#205268' },
      { offset: 0.7, color: '#0C2A40' },
      { offset: 1, color: '#030A18' },
    ],
    wire: '#EAF8FF',
    gridFine: { color: '#80B6CE', opacity: 0.25, size: 6 },
    gridCoarse: { color: '#B0DCEE', opacity: 0.45, size: 24 },
  },
  uv: {
    bg: [
      { offset: 0, color: '#1F0A30' },
      { offset: 0.5, color: '#080310' },
      { offset: 1, color: '#020108' },
    ],
    sugar: ['#EAFBFF', '#8FDBFF'],
    cuticle: '#8860D8',
  },
  gcamp: {
    bg: [
      { offset: 0, color: '#2B312F' },
      { offset: 0.6, color: '#131614' },
      { offset: 1, color: '#060706' },
    ],
    ant: '#4DE872',
    antHighlight: '#6CF08E',
    halo: ['#B8FFD0', '#4DE872'],
  },
};

// ---------------------------------------------------------------------------
// operator panel + HUD ink
// ---------------------------------------------------------------------------

export const PANEL = {
  bg: 'rgba(20, 18, 16, 0.9)',        // #141210 @ 90%
  bgBottom: 'rgba(10, 8, 6, 0.9)',     // #0A0806 @ 90%
  divider: 'rgba(245, 240, 232, 0.15)',
};

export const INK = {
  primary: 'rgba(245, 240, 232, 0.9)',   // headers, primary labels
  body: 'rgba(245, 240, 232, 0.65)',     // body text
  dim: 'rgba(245, 240, 232, 0.55)',      // secondary labels
  faint: 'rgba(245, 240, 232, 0.28)',    // tertiary, axes, gridlines
  base: '#F5F0E8',                        // raw ink color (for compositing)
};

// ---------------------------------------------------------------------------
// accents
// ---------------------------------------------------------------------------

export const ACCENT = {
  rec: '#E84B3C',
  tracking: '#E8B878',
};

// ---------------------------------------------------------------------------
// chemical overlay (false-color on substrate)
// ---------------------------------------------------------------------------

export const CHEM = {
  food: '#8FAE58',    // α
  danger: '#E84B3C',  // δ
  beta: null,         // reserved — define when wired
  gamma: null,        // reserved — define when wired
};

// ---------------------------------------------------------------------------
// neural node families
// ---------------------------------------------------------------------------

export const NODE = {
  sensor:   { color: '#D8B060', shape: 'circle-dot' },   // ○ ring + dot
  interPos: { color: '#8FAE58', shape: 'triangle' },      // △
  interNeg: { color: '#C87050', shape: 'circle' },        // ○ ring
  modulator:{ color: '#A890BC', shape: 'diamond' },       // ◇
  motor:    { color: '#C68A5E', shape: 'square' },        // □
};

// inactive connections drop to this opacity; modulatory edges are dashed
export const CONNECTION = {
  inactiveOpacity: 0.3,
  activeStroke: 1.5,
};

// ---------------------------------------------------------------------------
// per-mode UI accent (mode-switcher highlight, badge dot)
// ---------------------------------------------------------------------------

export const MODE_ACCENT = {
  visible: '#E8B878',
  ir: '#00D4FF',
  lidar: '#D06EE8',
  uv: '#A078F0',
  gcamp: '#4DE872',
};

// ordered list for iteration
export const MODES = ['visible', 'ir', 'lidar', 'uv', 'gcamp'];

// ---------------------------------------------------------------------------
// typography
// ---------------------------------------------------------------------------

export const FONT = {
  ui: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'IBM Plex Mono', monospace",
};

export const TEXT = {
  xs: 9,   // axis labels, fine telemetry
  sm: 10,  // body labels, callouts, mode badge
  md: 11,  // REC + timecode, subject ID
  lg: 13,  // panel section headers
};

// ---------------------------------------------------------------------------
// stroke & line
// ---------------------------------------------------------------------------

export const STROKE = {
  hairline: 0.3,
  fine: 0.5,
  line: 1,       // 0.8–1
  bold: 1.5,     // max HUD stroke
};

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

export const LAYOUT = {
  frame: { width: 1280, height: 720 },
  cam: { width: 760 },
  panel: { width: 520 },
  inset: 30,          // HUD margin from corner
  panelInset: 24,     // inside panel padding
  nodeRowH: 60,       // vertical step between node rows
  nodeCol: 110,       // horizontal column step
};
