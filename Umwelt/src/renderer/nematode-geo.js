/**
 * Procedural nematode body geometry with anatomical features.
 *
 * LatheGeometry-based body with:
 *   - Rounded head tip with 6 lip furrows
 *   - Annular grooves (annuli) along body surface
 *   - Tapered body from head to tail
 *   - Amphid depressions at 90° and 270°
 */

import * as THREE from "three";
import { SLOT_DEFINITIONS } from "../sensor-config.js";

/* ── constants ─────────────────────────────────────────── */
export const HALF_LEN = 1.2;
export const HEAD_R   = 0.18;
export const TAIL_R   = 0.10;
export const BG_COLOR = new THREE.Color(0x0a0f0a);

const HEAD_Z  = HALF_LEN * 1.05;   // +Z = head
const TAIL_Z  = -HALF_LEN * 1.1;   // -Z = tail
const TOTAL_Z = HEAD_Z - TAIL_Z;

const BODY_COLOR      = 0xede8d8;   // milky off-white
const FURROW_COLOR    = 0xc8bfa0;   // slightly darker for furrows
const LIP_SEGMENTS    = 6;
const FURROW_DEPTH    = 0.15;       // fraction of head radius
const ANNULUS_SPACING  = 0.035;     // world units between annuli

/* ── helpers ───────────────────────────────────────────── */

function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Actual surface radius at fractional position frac (0 = tail, 1 = head).
 * This matches the LatheGeometry body profile EXACTLY.
 */
export function surfaceRadius(frac) {
  if (frac < 0.03) {
    const localT = frac / 0.03;
    return TAIL_R * 0.3 * Math.pow(localT, 0.6);
  } else if (frac < 0.08) {
    const localT = (frac - 0.03) / 0.05;
    return TAIL_R * 0.3 + (TAIL_R - TAIL_R * 0.3) * smoothstep(localT);
  } else if (frac < 0.88) {
    const bodyT = (frac - 0.08) / 0.80;
    return TAIL_R + (HEAD_R - TAIL_R) * bodyT;
  } else if (frac < 0.93) {
    const localT = (frac - 0.88) / 0.05;
    return HEAD_R + (HEAD_R * 1.06 - HEAD_R) * Math.sin(localT * Math.PI);
  } else if (frac < 0.97) {
    const localT = (frac - 0.93) / 0.04;
    return HEAD_R * 1.02 + (HEAD_R * 0.55 - HEAD_R * 1.02) * smoothstep(localT);
  } else {
    const localT = (frac - 0.97) / 0.03;
    return Math.max(0.001, HEAD_R * 0.55 * (1 - smoothstep(localT)));
  }
}

/** Simple linear radius (kept for ring lines only). */
export function radiusAt(t) {
  return TAIL_R + (HEAD_R - TAIL_R) * t;
}

/** frac from z coordinate (0 = tail end, 1 = head end). */
function fracFromZ(z) {
  return Math.max(0, Math.min(1, (z - TAIL_Z) / TOTAL_Z));
}

/* ── annuli normal map ─────────────────────────────────── */

function createAnnuliNormalMap() {
  const w = 256, h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  // Base neutral normal (pointing outward)
  ctx.fillStyle = "#8080ff";
  ctx.fillRect(0, 0, w, h);

  // Draw annular groove bumps — each groove is a thin dark-light pair
  const grooveSpacing = h * ANNULUS_SPACING / (TOTAL_Z / h * 0.5);
  const spacing = Math.max(6, Math.round(h / 60));
  for (let y = spacing; y < h; y += spacing) {
    // Top edge of groove — normal tilts "down" (negative Y in normal map = toward tail)
    ctx.fillStyle = "rgba(128, 110, 255, 0.35)";
    ctx.fillRect(0, y - 1, w, 1);
    // Bottom edge — normal tilts "up"
    ctx.fillStyle = "rgba(128, 146, 255, 0.35)";
    ctx.fillRect(0, y, w, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/* ── body profile for LatheGeometry ────────────────────── */

function bodyProfile() {
  // Points in XY plane: X = radius, Y = position along body
  // LatheGeometry spins these around Y axis
  const pts = [];
  const N = 80;

  for (let i = 0; i <= N; i++) {
    const frac = i / N;  // 0 → tail, 1 → head
    const r = surfaceRadius(frac);
    const y = TAIL_Z + frac * TOTAL_Z;
    pts.push(new THREE.Vector2(Math.max(r, 0.001), y));
  }

  return pts;
}

/* ── lip furrow deformation ────────────────────────────── */

function applyLipFurrows(geo) {
  const pos = geo.attributes.position;
  const headStart = HEAD_Z - HEAD_R * 0.9;  // furrows start here

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    if (z < headStart) continue;  // only deform head front

    const dist = Math.sqrt(x * x + y * y);
    if (dist < 0.001) continue;

    const angle = Math.atan2(y, x);
    // 6 furrows at 60° intervals
    const furrowAngle = ((angle % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3);
    const furrowDist = Math.abs(furrowAngle - Math.PI / 6) / (Math.PI / 6);  // 0 at furrow center, 1 at lobe center

    // How deep into the head region (0 = start, 1 = tip)
    const headDepth = Math.min(1, (z - headStart) / (HEAD_R * 0.9));

    if (furrowDist < 0.3) {
      // In a furrow — push inward
      const furrowStrength = (1 - furrowDist / 0.3) * FURROW_DEPTH * HEAD_R * headDepth;
      const newDist = Math.max(0.002, dist - furrowStrength);
      pos.setX(i, (x / dist) * newDist);
      pos.setY(i, (y / dist) * newDist);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/* ── oral depression ────────────────────────────────────── */

function applyOralDepression(geo) {
  const pos = geo.attributes.position;
  const tipZ = HEAD_Z + HEAD_R * 0.1;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    if (z < HEAD_Z - HEAD_R * 0.2) continue;

    const dist = Math.sqrt(x * x + y * y);
    const tipDist = Math.sqrt(dist * dist + (z - tipZ) * (z - tipZ));

    if (tipDist < HEAD_R * 0.25) {
      // Push inward for oral depression
      const strength = (1 - tipDist / (HEAD_R * 0.25)) * HEAD_R * 0.12;
      pos.setZ(i, z - strength);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/* ── amphid depressions at 90° and 270° ──────────────── */

function applyAmphidDepressions(geo) {
  const pos = geo.attributes.position;
  // Amphid locations: 90° = +X (left), 270° = -X (right)
  // At the head, just behind the lip furrow region
  const amphidZ = HEAD_Z - HEAD_R * 0.5;

  for (const targetAngle of [Math.PI / 2, -Math.PI / 2]) {
    const cx = Math.cos(targetAngle) * HEAD_R * 0.95;
    const cy = Math.sin(targetAngle) * HEAD_R * 0.95;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);

      const dx = x - cx;
      const dy = y - cy;
      const dz = z - amphidZ;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (d < HEAD_R * 0.35) {
        // Elliptical depression
        const strength = (1 - d / (HEAD_R * 0.35)) * HEAD_R * 0.08;
        const dist = Math.sqrt(x * x + y * y);
        if (dist > 0.001) {
          const newDist = Math.max(0.001, dist - strength);
          pos.setX(i, (x / dist) * newDist);
          pos.setY(i, (y / dist) * newDist);
        }
      }
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/* ── main build function ────────────────────────────────── */

/**
 * Build a complete nematode body and add it to the given scene.
 * @param {THREE.Scene} scene
 * @returns {{ bodyMesh: THREE.Mesh }}
 */
export function buildNematodeBody(scene) {
  // ── Body mesh via LatheGeometry ──
  const profile = bodyProfile();
  const latheSegments = 48;
  const bodyGeo = new THREE.LatheGeometry(profile, latheSegments);

  // LatheGeometry creates around Y axis; rotate so Y → Z
  bodyGeo.rotateX(-Math.PI / 2);

  // Apply anatomical deformations
  applyLipFurrows(bodyGeo);
  applyOralDepression(bodyGeo);
  applyAmphidDepressions(bodyGeo);

  // Normal map for annuli
  const normalMap = createAnnuliNormalMap();

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: BODY_COLOR,
    roughness: 0.3,
    metalness: 0.0,
    transmission: 0.3,
    thickness: 0.5,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    normalMap,
    normalScale: new THREE.Vector2(0.3, 0.3),
    clearcoat: 0.1,
    clearcoatRoughness: 0.4,
    ior: 1.3,
  });

  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  scene.add(bodyMesh);

  // ── Annular ring lines (subtle reinforcement) ──
  const ringMat = new THREE.LineBasicMaterial({
    color: 0xb0a888, transparent: true, opacity: 0.08,
  });
  const ringCount = Math.floor(TOTAL_Z / ANNULUS_SPACING);
  for (let i = 3; i < ringCount - 2; i++) {
    const frac = (i + 0.5) / ringCount;
    const z = TAIL_Z + frac * TOTAL_Z;
    const r = surfaceRadius(frac);
    if (r < 0.02) continue;
    const pts = [];
    for (let j = 0; j <= 32; j++) {
      const a = (j / 32) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
  }

  // ── Dorsal/ventral ridge lines ──
  const ridgeMat = new THREE.LineBasicMaterial({
    color: 0xb0a888, transparent: true, opacity: 0.05,
  });
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const pts = [];
    for (let i = 2; i <= 38; i++) {
      const frac = i / 40;
      const z = TAIL_Z + frac * TOTAL_Z;
      const r = surfaceRadius(frac);
      pts.push(new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ridgeMat));
  }

  return { bodyMesh };
}

/* ── 3-point lighting ────────────────────────────────────── */

export function addNematodeLighting(scene) {
  // Ambient — very subtle fill
  scene.add(new THREE.AmbientLight(0xd8e0d0, 0.3));

  // Key light — right-upper, warm
  const key = new THREE.DirectionalLight(0xfff5e8, 0.65);
  key.position.set(2.5, 2.0, 3.0);
  scene.add(key);

  // Fill light — left-lower, cool
  const fill = new THREE.DirectionalLight(0xd0dde8, 0.25);
  fill.position.set(-2.5, -1.5, -1.0);
  scene.add(fill);

  // Rim / back light — behind, bright edge
  const rim = new THREE.DirectionalLight(0xe0e8f0, 0.35);
  rim.position.set(0, 0.5, -4.0);
  scene.add(rim);
}

/* ── slot / sensor positions on body surface ─────────── */

/**
 * Compute the z and frac for a head slot.
 * Head slots sit at the "head bulge" zone — frac ~0.91.
 */
function headSlotZ() {
  const frac = 0.91;            // in the head-bulge region
  return { z: TAIL_Z + frac * TOTAL_Z, frac };
}

/**
 * Map a slot to a 3D point ON the body surface.
 * Ball center sits exactly at the surface so it's half-embedded.
 */
export function slotTo3D(slot) {
  if (slot.region === "head") {
    if (slot.angle3d === null) {
      // Ambient slot — conceptual, inside body center
      const { z } = headSlotZ();
      return new THREE.Vector3(0, 0, z - 0.15);
    }

    // Oral slot (angle3d === 0) goes near the very tip
    if (slot.slotId === "oral") {
      const frac = 0.96;       // near head tip
      const z = TAIL_Z + frac * TOTAL_Z;
      const r = surfaceRadius(frac);
      return new THREE.Vector3(0, r, z); // dorsal side of tip
    }

    const { z, frac } = headSlotZ();
    const r = surfaceRadius(frac);
    const angle = (slot.angle3d * Math.PI) / 180;
    return new THREE.Vector3(
      Math.sin(angle) * r,
      Math.cos(angle) * r,
      z
    );
  }

  // Body and tail — lateral slots on the equator (y = 0)
  const bodyT = slot.bodyT ?? 0.5;
  const frac = 1 - bodyT;      // frac: 0=tail, 1=head
  const z = TAIL_Z + frac * TOTAL_Z;
  const r = surfaceRadius(frac);
  const latSign = slot.side === "left" ? 1 : slot.side === "right" ? -1 : 0;
  return new THREE.Vector3(latSign * r, 0, z);
}

/**
 * Position for an installed sensor sphere — same as slot but uses sensor fields.
 */
export function sensorPos(sensor) {
  // Look up the slot definition for this sensor
  const slot = SLOT_DEFINITIONS.find(s => s.slotId === sensor.id);
  if (slot) return slotTo3D(slot);

  // Fallback for sensors without a matching slot
  if (!sensor.region || sensor.region === "head") {
    const { z, frac } = headSlotZ();
    const r = surfaceRadius(frac);
    const dir = sensor.dir || [1, 0, 0];
    const lat = dir[2] || 0;
    const dor = dir[1] || 0;
    if (Math.abs(lat) < 0.1 && Math.abs(dor) < 0.1) {
      const tipFrac = 0.96;
      return new THREE.Vector3(0, r * 0.5, TAIL_Z + tipFrac * TOTAL_Z);
    }
    return new THREE.Vector3(-lat * r, dor * r, z);
  }

  const bodyT = sensor.bodyT ?? 0.5;
  const frac = 1 - bodyT;
  const z = TAIL_Z + frac * TOTAL_Z;
  const r = surfaceRadius(frac);
  const latSign = sensor.side === "left" ? 1 : sensor.side === "right" ? -1 : 0;
  return new THREE.Vector3(latSign * r, 0, z);
}

/* ── empty slot markers ──────────────────────────────── */

export function buildEmptySlotMarkers(scene) {
  const markers = {};
  const dashMat = new THREE.LineDashedMaterial({
    color: 0x607050, transparent: true, opacity: 0.4,
    dashSize: 0.012, gapSize: 0.008,
  });

  for (const slot of SLOT_DEFINITIONS) {
    if (slot.angle3d === null) continue;   // skip ambient (internal)

    const pos = slotTo3D(slot);

    // Ring radius = 25% of local body radius (matches sensor sphere sizing)
    let localFrac;
    if (slot.region === "head") {
      localFrac = slot.slotId === "oral" ? 0.96 : 0.91;
    } else {
      localFrac = 1 - (slot.bodyT ?? 0.5);
    }
    const localR = surfaceRadius(localFrac);
    const ringR = localR * 0.13;

    // Compute outward direction from body axis to slot position
    const outDir = new THREE.Vector3(pos.x, pos.y, 0).normalize();
    if (outDir.length() < 0.001) outDir.set(0, 1, 0);

    // Ring lies in a plane perpendicular to outDir (tangent to surface)
    // Build two tangent vectors: one along Z axis, one perpendicular
    const axisZ = new THREE.Vector3(0, 0, 1);
    const tan1 = new THREE.Vector3().crossVectors(outDir, axisZ).normalize();
    if (tan1.length() < 0.001) tan1.set(1, 0, 0);
    const tan2 = new THREE.Vector3().crossVectors(outDir, tan1).normalize();

    const pts = [];
    for (let j = 0; j <= 24; j++) {
      const a = (j / 24) * Math.PI * 2;
      pts.push(new THREE.Vector3(
        pos.x + Math.cos(a) * tan1.x * ringR + Math.sin(a) * tan2.x * ringR,
        pos.y + Math.cos(a) * tan1.y * ringR + Math.sin(a) * tan2.y * ringR,
        pos.z + Math.cos(a) * tan1.z * ringR + Math.sin(a) * tan2.z * ringR,
      ));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const ring = new THREE.Line(ringGeo, dashMat.clone());
    ring.computeLineDistances();
    scene.add(ring);
    markers[slot.slotId] = ring;
  }

  return markers;
}
