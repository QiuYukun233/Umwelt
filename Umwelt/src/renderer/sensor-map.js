import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SENSOR_DEFINITIONS, PROPRIO_DEFINITIONS } from "../config.js";
import { SLOT_DEFINITIONS } from "../sensor-config.js";
import { clamp } from "../math.js";
import {
  HALF_LEN, HEAD_R, TAIL_R, BG_COLOR,
  buildNematodeBody, addNematodeLighting,
  sensorPos, buildEmptySlotMarkers, surfaceRadius,
} from "./nematode-geo.js";

/* ── sensor colour by kind ───────────────────────────────── */
const SENSOR_COLORS = {
  // Ant sensor kinds
  chem_A:  0x7ab8a0,
  chem_B:  0xa0c49a,
  chem_C:  0xc4b56a,
  chem_D:  0xc46a5a,
  touch:   0x5a9ac4,
  taste:   0xb890a0,
  light:   0xd0ccc0,
  // Legacy
  food:    0x7ab8a0,
  threat:  0xc46a5a,
  mech:    0x5a9ac4,
  temp:    0xc44a3a,
  gas:     0xd0ccc0,
};

/* ── proprio bar ──────────────────────────────────────────── */
function makeProprioRow(def) {
  const row = document.createElement("div");
  row.className = "proprio-row";
  row.innerHTML =
    `<span class="proprio-label">${def.label}</span>` +
    `<div class="proprio-track"><div class="proprio-fill" data-pid="${def.id}"></div></div>` +
    `<span class="proprio-val" data-pvid="${def.id}">0.00</span>`;
  return row;
}

/* ── text sprite ──────────────────────────────────────────── */
function textSprite(text, size) {
  const px = 128;
  const c = document.createElement("canvas");
  c.width = px; c.height = px;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(140,160,130,0.45)";
  g.font = `500 ${size}px "IBM Plex Sans", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, px / 2, px / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  return new THREE.Sprite(mat);
}

/* ── main ─────────────────────────────────────────────────── */
export class SensorMapRenderer {
  constructor(container) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = BG_COLOR;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(1.6, 1.0, 3.0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.view3d = document.createElement("div");
    this.view3d.className = "sensor-3d-view";
    this.view3d.appendChild(this.renderer.domElement);
    container.appendChild(this.view3d);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.7;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    /* lighting — 3-point microscopy style */
    addNematodeLighting(this.scene);

    /* body */
    this.halfLen = HALF_LEN;
    this.headR = HEAD_R;
    this.tailR = TAIL_R;

    buildNematodeBody(this.scene);
    this.emptySlotMarkers = buildEmptySlotMarkers(this.scene);

    /* sensors */
    this.sensorMeshes = {};
    this.sensorGlows = {};
    this.sensorDefs = SENSOR_DEFINITIONS;
    this._buildSensors();
    this._buildLabels();

    /* proprio */
    this.proprioWrap = document.createElement("div");
    this.proprioWrap.className = "proprio-bars";
    for (const p of PROPRIO_DEFINITIONS) this.proprioWrap.appendChild(makeProprioRow(p));
    container.appendChild(this.proprioWrap);

    /* drain */
    this.drainEl = document.createElement("div");
    this.drainEl.className = "sensor-drain";
    this.drainEl.textContent = "耗能 0.00/s";
    container.appendChild(this.drainEl);

    this.resize();
  }

  /* ── sensor spheres ── */
  _buildSensors() {
    // Unit sphere — scaled per-sensor based on local body radius
    this._unitSphere = new THREE.SphereGeometry(1, 14, 10);
    this._addSensorMeshes(this.sensorDefs);
  }

  _sensorColor(sensor) {
    return new THREE.Color(SENSOR_COLORS[sensor.kind] ?? 0xaaaaaa);
  }

  /** Compute the sphere radius for a sensor based on its body position. */
  _sensorRadius(sensor) {
    let frac;
    if (!sensor.region || sensor.region === "head") {
      frac = sensor.id === "oral" ? 0.96 : 0.91;
    } else {
      frac = 1 - (sensor.bodyT ?? 0.5);
    }
    return surfaceRadius(frac) * 0.125;   // 25% of diameter = 12.5% of radius
  }

  _addSensorMeshes(defs) {
    for (const sensor of defs) {
      const color = this._sensorColor(sensor);
      const pos = sensorPos(sensor);
      const sR = this._sensorRadius(sensor);

      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.4,
        roughness: 0.25, metalness: 0.05,
      });
      const mesh = new THREE.Mesh(this._unitSphere, mat);
      mesh.position.copy(pos);
      mesh.scale.setScalar(sR);
      this.scene.add(mesh);
      this.sensorMeshes[sensor.id] = mesh;

      const glowMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const glow = new THREE.Mesh(this._unitSphere, glowMat);
      glow.position.copy(pos);
      glow.scale.setScalar(sR * 3.5);
      this.scene.add(glow);
      this.sensorGlows[sensor.id] = glow;
    }
  }

  _removeSensorMeshes() {
    for (const id of Object.keys(this.sensorMeshes)) {
      this.scene.remove(this.sensorMeshes[id]);
      this.sensorMeshes[id].material.dispose();
      this.scene.remove(this.sensorGlows[id]);
      this.sensorGlows[id].material.dispose();
    }
    this.sensorMeshes = {};
    this.sensorGlows = {};
  }

  rebuildSensors(sensorDefs) {
    this.sensorDefs = sensorDefs;
    this._removeSensorMeshes();
    this._addSensorMeshes(sensorDefs);
    // Toggle empty slot markers — hide slots that have sensors
    const installedIds = new Set(sensorDefs.map(s => s.id));
    for (const slot of SLOT_DEFINITIONS) {
      const ring = this.emptySlotMarkers[slot.slotId];
      if (ring) ring.visible = !installedIds.has(slot.slotId);
    }
  }

  /* ── labels ── */
  _buildLabels() {
    const hl = this.halfLen;
    const r = this.headR;
    const defs = [
      { text: "前", pos: [0, -0.10, hl + r + 0.22], sz: 36 },
      { text: "背", pos: [0, r + 0.20, 0], sz: 28 },
      { text: "腹", pos: [0, -r - 0.20, 0], sz: 28 },
      { text: "右", pos: [-(r + 0.24), 0, 0], sz: 28 },
      { text: "左", pos: [r + 0.24, 0, 0], sz: 28 },
    ];
    for (const { text, pos, sz } of defs) {
      const s = textSprite(text, sz);
      s.position.set(...pos);
      s.scale.set(0.22, 0.22, 1);
      this.scene.add(s);
    }
  }

  /* ── public API ── */
  resize() {
    const w = this.view3d.clientWidth || 200;
    const h = this.view3d.clientHeight || 200;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  refreshTheme() {}

  render(metrics, sensorEnabled) {
    for (const sensor of this.sensorDefs) {
      const mesh = this.sensorMeshes[sensor.id];
      const glow = this.sensorGlows[sensor.id];
      if (!mesh) continue;

      const sR = this._sensorRadius(sensor);
      const enabled = Boolean(sensorEnabled[sensor.id]);
      const value = metrics.sensorOutputs?.[sensor.id] ?? 0;
      const mat = mesh.material;

      if (enabled) {
        mat.transparent = false;
        mat.opacity = 1;
        mat.emissiveIntensity = 0.4 + value * 4.0;
        mesh.scale.setScalar(sR * (1 + value * 0.6));
        glow.material.opacity = clamp(value * 0.5, 0, 0.35);
        glow.scale.setScalar(sR * 3.5 * (1 + value * 1.8));
      } else {
        mat.transparent = true;
        mat.opacity = 0.15;
        mat.emissiveIntensity = 0;
        mesh.scale.setScalar(sR);
        glow.material.opacity = 0;
      }
    }

    for (const p of PROPRIO_DEFINITIONS) {
      const v = metrics.sensorOutputs?.[p.id] ?? 0;
      const fill = this.proprioWrap.querySelector(`[data-pid="${p.id}"]`);
      const val = this.proprioWrap.querySelector(`[data-pvid="${p.id}"]`);
      if (fill) fill.style.width = `${clamp(v, 0, 1) * 100}%`;
      if (val) val.textContent = v.toFixed(2);
    }

    this.drainEl.textContent = `耗能 ${metrics.sensorDrain.toFixed(2)}/s`;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
    this.controls.dispose();
  }
}
