/**
 * BodyEditor — full-screen drag-and-drop sensor installation UI.
 *
 * Replaces the neural canvas when active.
 * Left panel: draggable sensor type cards + installed sensor list.
 * Right area: large 3D nematode model with 14 clickable/droppable slots.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SLOT_DEFINITIONS, SLOT_BY_ID, SENSOR_TYPES, ALL_SENSOR_TYPE_KEYS } from "../sensor-config.js";
import {
  HALF_LEN, HEAD_R, TAIL_R, BG_COLOR,
  buildNematodeBody, addNematodeLighting, slotTo3D, surfaceRadius,
} from "../renderer/nematode-geo.js";

/* ── colour helpers ── */
const TYPE_COLORS = {};
for (const [k, v] of Object.entries(SENSOR_TYPES)) TYPE_COLORS[k] = parseInt(v.color.slice(1), 16);
const EMPTY_COLOR = 0x607050;

export class BodyEditor {
  constructor(container, callbacks = {}) {
    this.callbacks = callbacks;
    this.container = container;
    this.sensorConfig = null;
    this.slotMeshes = {};
    this.hoveredSlot = null;
    this._dragType = null;

    /* ── DOM ── */
    this.el = document.createElement("div");
    this.el.className = "body-editor";
    this.el.innerHTML = `
      <div class="be-header">
        <button class="btn mono be-back" type="button">\u2190 \u8FD4\u56DE\u56DE\u8DEF</button>
        <span class="be-title">\u611F\u53D7\u5668\u7F16\u8F91</span>
        <span class="be-count"></span>
      </div>
      <div class="be-left">
        <div class="be-palette-title">\u611F\u53D7\u5668\u7C7B\u578B\u5E93</div>
        <div class="be-palette"></div>
        <div class="be-installed-title">\u5DF2\u5B89\u88C5</div>
        <div class="be-sensors"></div>
      </div>
      <div class="be-3d-wrap"></div>
      <div class="be-hint">\u62D6\u62FD\u5DE6\u4FA7\u5361\u7247\u5230\u867C\u866B\u4F53\u8868\u69FD\u4F4D \u00B7 \u70B9\u51FB\u5DF2\u5B89\u88C5\u7684\u611F\u53D7\u5668\u79FB\u9664</div>
    `;
    container.appendChild(this.el);

    this.countEl = this.el.querySelector(".be-count");
    this.sensorListEl = this.el.querySelector(".be-sensors");
    this.hintEl = this.el.querySelector(".be-hint");
    this.backBtn = this.el.querySelector(".be-back");
    this.palette = this.el.querySelector(".be-palette");
    this.wrap3d = this.el.querySelector(".be-3d-wrap");

    this._buildPalette();
    this.backBtn.addEventListener("click", () => this.callbacks.onClose?.());

    this._sceneReady = false;
  }

  /* ── palette cards ── */
  _buildPalette() {
    // Ant anatomy: slot types are anatomically fixed, so the palette mainly
    // serves as a legend. Player can click slots to remove, but drag-install
    // only succeeds for the slot's canonical type (see SensorConfig).
    const types = [
      { key: "chem_A", symbol: "\u2295", label: "ChemA",  sub: "\u89E6\u89D2\u5316\u5B66\u611F\u53D7" },
      { key: "chem_B", symbol: "\u2295", label: "ChemB",  sub: "\u89E6\u89D2\u5316\u5B66\u611F\u53D7" },
      { key: "chem_C", symbol: "\u2295", label: "ChemC",  sub: "\u89E6\u89D2\u5316\u5B66\u611F\u53D7" },
      { key: "chem_D", symbol: "\u2295", label: "ChemD",  sub: "\u89E6\u89D2\u5316\u5B66\u611F\u53D7" },
      { key: "touch",  symbol: "\u224B", label: "\u89E6\u89C9",  sub: "\u89E6\u89D2\u673A\u68B0\u611F\u53D7" },
      { key: "taste",  symbol: "\u2295", label: "\u5473\u89C9",  sub: "\u53E3\u5668\u63A5\u89E6\u5473\u89C9" },
      { key: "light",  symbol: "\u25CE", label: "\u5149",        sub: "\u73AF\u5883\u5149\u611F\u53D7" },
    ];
    for (const { key, symbol, label, sub } of types) {
      const info = SENSOR_TYPES[key];
      if (!info) continue;
      const card = document.createElement("div");
      card.className = "be-card";
      card.draggable = true;
      card.dataset.sensorType = key;
      card.style.setProperty("--card-color", info.color);
      card.innerHTML =
        `<span class="be-card-symbol">${symbol}</span>` +
        `<div><div class="be-card-label">${label}</div><div class="be-card-sub">${sub}</div></div>`;

      card.addEventListener("dragstart", (e) => {
        this._dragType = key;
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("text/plain", key);
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => {
        this._dragType = null;
        card.classList.remove("dragging");
        this._clearDropHighlights();
      });

      this.palette.appendChild(card);
    }
  }

  /* ── Three.js setup ── */
  _initScene() {
    if (this._sceneReady) return;
    this._sceneReady = true;

    this.scene = new THREE.Scene();
    this.scene.background = BG_COLOR;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(1.6, 1.0, 3.0);

    this.renderer3d = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer3d.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer3d.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer3d.toneMappingExposure = 1.1;
    this.wrap3d.appendChild(this.renderer3d.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer3d.domElement);
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.7;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    addNematodeLighting(this.scene);
    buildNematodeBody(this.scene);

    this._buildSlotMarkers();
    this._buildLabels();

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this._hitTargets = [];
    for (const slot of SLOT_DEFINITIONS) {
      const entry = this.slotMeshes[slot.slotId];
      if (entry?.hitMesh) this._hitTargets.push(entry.hitMesh);
    }

    const canvas = this.renderer3d.domElement;
    canvas.addEventListener("click", (e) => this._onClick(e));
    canvas.addEventListener("pointermove", (e) => this._onHover(e));
    canvas.addEventListener("pointerleave", () => {
      this.hoveredSlot = null;
      canvas.style.cursor = "grab";
      this._syncSlotAppearance();
    });

    // Drop support on the 3D canvas
    canvas.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      this._onDragOver(e);
    });
    canvas.addEventListener("dragleave", () => {
      this.hoveredSlot = null;
      this._syncSlotAppearance();
    });
    canvas.addEventListener("drop", (e) => {
      e.preventDefault();
      this._onDrop(e);
    });

    this._resizeScene();
    this._animate();
  }

  _buildSlotMarkers() {
    this._unitSphere = new THREE.SphereGeometry(1, 12, 8);

    for (const slot of SLOT_DEFINITIONS) {
      const pos3d = slotTo3D(slot);

      let localFrac;
      if (slot.region === "head") {
        localFrac = slot.slotId === "oral" || slot.slotId === "mouth_chem" ? 0.96 : 0.91;
      } else {
        localFrac = 1 - (slot.bodyT ?? 0.5);
      }
      const localR = surfaceRadius(localFrac);
      const sensorR = localR * 0.125;
      const glowR = sensorR * 3;
      const hitR = Math.max(sensorR * 2.5, 0.06);

      const emptyMat = new THREE.MeshBasicMaterial({
        color: EMPTY_COLOR, wireframe: true, transparent: true, opacity: 0.35,
      });
      const marker = new THREE.Mesh(this._unitSphere, emptyMat);
      marker.position.copy(pos3d);
      marker.scale.setScalar(sensorR);
      this.scene.add(marker);

      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const hitMesh = new THREE.Mesh(this._unitSphere, hitMat);
      hitMesh.position.copy(pos3d);
      hitMesh.scale.setScalar(hitR);
      hitMesh.userData.slotId = slot.slotId;
      this.scene.add(hitMesh);

      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const glow = new THREE.Mesh(this._unitSphere, glowMat);
      glow.position.copy(pos3d);
      glow.scale.setScalar(glowR);
      this.scene.add(glow);

      this.slotMeshes[slot.slotId] = { marker, glow, hitMesh, pos3d, sensorR };
    }
  }

  _buildLabels() {
    const hl = HALF_LEN;
    const r = HEAD_R;
    const defs = [
      { text: "\u524D", pos: [0, -0.12, hl + r + 0.25], sz: 38 },
      { text: "\u80CC", pos: [0, r + 0.22, 0], sz: 30 },
      { text: "\u8179", pos: [0, -r - 0.22, 0], sz: 30 },
      { text: "\u53F3", pos: [-(r + 0.28), 0, 0], sz: 30 },
      { text: "\u5DE6", pos: [r + 0.28, 0, 0], sz: 30 },
      { text: "\u5C3E", pos: [0, -0.12, -hl - r - 0.15], sz: 30 },
    ];
    for (const { text, pos, sz } of defs) {
      const s = this._textSprite(text, sz);
      s.position.set(...pos);
      s.scale.set(0.25, 0.25, 1);
      this.scene.add(s);
    }
  }

  _textSprite(text, size) {
    const px = 128;
    const c = document.createElement("canvas");
    c.width = px; c.height = px;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(170,155,130,0.5)";
    g.font = `500 ${size}px "IBM Plex Sans", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, px / 2, px / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    return new THREE.Sprite(mat);
  }

  /* ── slot appearance sync ── */
  _syncSlotAppearance() {
    if (!this.sensorConfig) return;
    for (const slot of SLOT_DEFINITIONS) {
      const entry = this.slotMeshes[slot.slotId];
      if (!entry) continue;
      const sensorType = this.sensorConfig.slots[slot.slotId];
      const isHover = this.hoveredSlot === slot.slotId;
      const r = entry.sensorR || 0.02;

      if (sensorType) {
        const color = TYPE_COLORS[sensorType] ?? 0xaaaaaa;
        entry.marker.material.color.set(color);
        entry.marker.material.wireframe = false;
        entry.marker.material.opacity = isHover ? 1 : 0.85;
        entry.marker.scale.setScalar(r * (isHover ? 1.5 : 1.2));
        entry.glow.material.color.set(color);
        entry.glow.material.opacity = isHover ? 0.25 : 0.08;
        entry.glow.scale.setScalar(r * 3 * (isHover ? 1.5 : 1));
      } else {
        const isDragTarget = isHover && this._dragType;
        const previewColor = isDragTarget ? (TYPE_COLORS[this._dragType] ?? 0xaaaaaa) : EMPTY_COLOR;
        entry.marker.material.color.set(previewColor);
        entry.marker.material.wireframe = !isDragTarget;
        entry.marker.material.opacity = isDragTarget ? 0.6 : (isHover ? 0.7 : 0.35);
        entry.marker.scale.setScalar(r * (isHover ? 1.3 : 1));
        entry.glow.material.opacity = isDragTarget ? 0.15 : (isHover ? 0.08 : 0);
        entry.glow.material.color.set(previewColor);
        entry.glow.scale.setScalar(r * 3);
      }
    }
  }

  _clearDropHighlights() {
    this.hoveredSlot = null;
    this._syncSlotAppearance();
  }

  /* ── raycasting ── */
  _raycastSlot(event) {
    const rect = this.renderer3d.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this._hitTargets);
    if (hits.length > 0) return hits[0].object.userData.slotId;
    return null;
  }

  _onClick(event) {
    const slotId = this._raycastSlot(event);
    if (!slotId || !this.sensorConfig) return;
    const current = this.sensorConfig.slots[slotId];
    if (current) {
      this.sensorConfig.removeSensor(slotId);
      this._syncSlotAppearance();
      this._updateSensorList();
      this.callbacks.onSensorConfigChange?.(this.sensorConfig);
    }
  }

  _onHover(event) {
    const slotId = this._raycastSlot(event);
    if (slotId !== this.hoveredSlot) {
      this.hoveredSlot = slotId;
      this.renderer3d.domElement.style.cursor = slotId ? "pointer" : "grab";
      this._syncSlotAppearance();
    }
  }

  _onDragOver(event) {
    const slotId = this._raycastSlot(event);
    if (slotId !== this.hoveredSlot) {
      this.hoveredSlot = slotId;
      this._syncSlotAppearance();
    }
  }

  _onDrop(event) {
    const slotId = this._raycastSlot(event);
    const sensorType = this._dragType || event.dataTransfer.getData("text/plain");
    this._dragType = null;
    this.hoveredSlot = null;

    if (!slotId || !sensorType || !this.sensorConfig) {
      this._syncSlotAppearance();
      return;
    }

    this.sensorConfig.installSensor(slotId, sensorType);
    this._syncSlotAppearance();
    this._updateSensorList();
    this.callbacks.onSensorConfigChange?.(this.sensorConfig);
  }

  /* ── sensor list chips ── */
  _updateSensorList() {
    if (!this.sensorConfig) return;
    const installed = this.sensorConfig.getInstalled();
    this.countEl.textContent = `${installed.length}/14`;
    this.sensorListEl.innerHTML = "";
    for (const s of installed) {
      const chip = document.createElement("span");
      chip.className = "be-sensor-chip";
      chip.style.borderColor = s.color;
      chip.style.color = s.color;
      chip.style.background = s.color + "12";
      chip.innerHTML = `<span class="chip-dot" style="background:${s.color}"></span>${s.typeLabel}${s.label}`;
      chip.title = `${s.name} \u2014 \u70B9\u51FB\u79FB\u9664`;
      chip.addEventListener("click", () => {
        this.sensorConfig.removeSensor(s.slotId);
        this._syncSlotAppearance();
        this._updateSensorList();
        this.callbacks.onSensorConfigChange?.(this.sensorConfig);
      });
      this.sensorListEl.appendChild(chip);
    }
  }

  /* ── animation loop ── */
  _animate() {
    if (!this._sceneReady) return;
    requestAnimationFrame(() => this._animate());
    if (!this._visible) return;
    this.controls.update();
    this.renderer3d.render(this.scene, this.camera);
  }

  _resizeScene() {
    const w = this.wrap3d.clientWidth || 300;
    const h = this.wrap3d.clientHeight || 300;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer3d.setSize(w, h);
  }

  /* ── public API ── */
  open(sensorConfig) {
    this.sensorConfig = sensorConfig;
    this._visible = true;
    this.container.classList.add("show");
    // Toggle editor-stage class so neural canvas hides
    const stage = this.container.closest("#editor-stage");
    if (stage) stage.classList.add("be-active");
    this._initScene();
    // Delay resize slightly so the container has actual dimensions
    requestAnimationFrame(() => {
      this._resizeScene();
      this._syncSlotAppearance();
      this._updateSensorList();
    });
  }

  close() {
    this._visible = false;
    this.container.classList.remove("show");
    const stage = this.container.closest("#editor-stage");
    if (stage) stage.classList.remove("be-active");
  }

  isOpen() {
    return this._visible === true;
  }

  resize() {
    if (this.isOpen() && this._sceneReady) this._resizeScene();
  }
}
