/**
 * Save/load envelope for the Umwelt circuit (schema v10).
 *
 * Outer shape:
 *   {
 *     version:       10,
 *     graph:         string,   // NeuralGraph.serialize() output
 *     sensorEnabled: Record<sourceId, boolean>,
 *     bodyParams:    { turnScale, speedScale },
 *     sensorConfig:  SensorConfig.toJSON(),
 *     world:         WorldBlockV9 | null,   // v8+; v6/v7 payloads get null on migrate
 *     map:           MapBlock | null,        // v9+; reserved for the map editor (step 2)
 *     moduleMeta:    object | null           // v10+; meta of a loaded Bevy-workshop module
 *   }
 *
 * See migrations.js for the upgrade chain and io/fields.js for the chem-field codec.
 *
 * applyEnvelope takes an onSensorConfig callback rather than embedding the
 * install path, so callers control how a changed sensor config is wired
 * back into their sidebar/editor references (observation-app uses
 * _installSensorConfig). Everything else (graph deserialize, sensor-enabled
 * map, body params, world block restore) is identical and lives here.
 */

import { SensorConfig } from "../sensor-config.js";
import { cloneSensorEnabled } from "../neural.js";
import { LOGIC_CANVAS } from "../config.js";
import {
  CURRENT_STORAGE_VERSION,
  MIGRATABLE_STORAGE_VERSION,
  migrate,
} from "./migrations.js";

export { CURRENT_STORAGE_VERSION, MIGRATABLE_STORAGE_VERSION };

export const STORAGE_KEY = "umwelt_circuit";

/** Build the current-version save envelope from an app instance. */
export function serializeApp(app) {
  return {
    version: CURRENT_STORAGE_VERSION,
    graph: app.graph.serialize(),
    sensorEnabled: { ...app.sensorEnabled },
    bodyParams: { ...app.world.bodyParams },
    sensorConfig: app.sensorConfig.toJSON(),
    world: app.world.serializeWorld(),
    // Map block surfaces in v9 but stays null until the map editor (step 2)
    // emits authored maps. Apps that have no map context simply omit; we
    // still write the field for forward-compat with editor saves.
    map: app.map ?? null,
    // moduleMeta surfaces in v10: the volume / metabolic / delay metadata of
    // a loaded Bevy-workshop module (display-only; null when none loaded).
    moduleMeta: app.moduleMeta ?? null,
  };
}

/**
 * Apply an already-migrated envelope to an app.
 *
 * `onSensorConfig(cfg)` is called if the envelope includes a sensor config;
 * the caller supplies an install path (observation-app uses
 * _installSensorConfig) to keep sidebar/editor references in sync.
 *
 * Assumes `data.version === CURRENT_STORAGE_VERSION`. Callers that read
 * raw JSON must go through `migrate()` first.
 *
 * `data.world` semantics:
 *   - truthy object → world.deserializeWorld(block): restore ant pose,
 *     foods, dangers, chem fields, sim clock from the save.
 *   - null (produced by v7 → v8 migrate for legacy payloads) or undefined
 *     → world state is left untouched. In practice the caller has just
 *     constructed a fresh `new World(env)` whose constructor already ran
 *     `reset()` (random foods/dangers, warmed-up ChemA/D, ant at center).
 *     That freshly-reset state is what v6/v7 saves will play with; we do
 *     NOT call `world.reset()` a second time here.
 */
export function applyEnvelope(app, data, { onSensorConfig, onWarn } = {}) {
  if (data.sensorConfig && typeof onSensorConfig === "function") {
    onSensorConfig(SensorConfig.fromJSON(data.sensorConfig));
  }
  app.graph.deserialize(data.graph);
  app.graph.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, false, app.sourceDefs);
  if (data.sensorEnabled) {
    app.sensorEnabled = cloneSensorEnabled(data.sensorEnabled, app.sensorDefs);
  }
  if (data.bodyParams) {
    app.world.bodyParams = {
      turnScale:  Number.isFinite(data.bodyParams.turnScale)  ? data.bodyParams.turnScale  : 1,
      speedScale: Number.isFinite(data.bodyParams.speedScale) ? data.bodyParams.speedScale : 1,
    };
  }
  if (data.world) {
    app.world.deserializeWorld(data.world, onWarn);
  }
  if (data.moduleMeta !== undefined) {
    app.moduleMeta = data.moduleMeta;
  }
}

/**
 * Read localStorage, parse, migrate. Returns normalized envelope or null.
 * Wipes the key when the payload is below the migratable floor, matching
 * the pre-v8 destructive fallback.
 */
export function readSavedEnvelope() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (_) {
    return null;
  }
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return null;
  }
  const ver = data?.version ?? 1;
  if (!Number.isInteger(ver) || ver < MIGRATABLE_STORAGE_VERSION) {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    return null;
  }
  try {
    return migrate(data);
  } catch (err) {
    console.warn("readSavedEnvelope: migration failed:", err.message);
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    return null;
  }
}

/** Persist the current app state to localStorage. Silent on quota errors. */
export function writeSavedEnvelope(app) {
  try {
    const env = serializeApp(app);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(env));
    return env;
  } catch (_) {
    return null;
  }
}

/**
 * Download current app state as a JSON file. Ignores quota/DOM errors to
 * match the current best-effort behavior.
 */
export function downloadSaveJSON(app) {
  const env = serializeApp(app);
  const blob = new Blob([JSON.stringify(env, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `umwelt-circuit-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parse a text payload from a file import. Accepts missing `version`
 * (treated as CURRENT) so older exports still load cleanly. Returns the
 * migrated envelope or null if the payload is structurally invalid.
 *
 * Actually applying the envelope is the caller's responsibility (so the
 * right onSensorConfig path is used).
 */
export function parseImportText(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (_) {
    return null;
  }
  if (!raw || typeof raw !== "object" || !raw.graph) return null;
  if (raw.version === undefined) raw.version = CURRENT_STORAGE_VERSION;
  try {
    return migrate(raw);
  } catch (err) {
    console.warn("parseImportText: migration failed:", err.message);
    return null;
  }
}
