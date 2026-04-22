/**
 * Save-schema migration chain.
 *
 * Each entry in MIGRATIONS is a pure upgrader (dataInVersionN) → (dataInVersionN+1).
 * migrate() runs them in sequence until data.version === CURRENT_STORAGE_VERSION.
 *
 * Versions:
 *   v6  — pre-plastic-synapse; edges lacked plastic / mod_source_id fields.
 *         NeuralGraph.deserialize still tolerates these missing fields, so
 *         v6 → v7 is a version bump only.
 *   v7  — plastic synapses: edges carry plastic / mod_source_id / w.
 *   v8  — save now carries a top-level `world` block (ant pose, foods,
 *         dangers, chem field state). Old payloads get world = null so the
 *         loader knows to leave the default World state alone.
 *
 * MIGRATABLE_STORAGE_VERSION is the oldest source version migrate() will
 * accept. Payloads below that are rejected; localStorage callers wipe and
 * fall through to a fresh default circuit, matching the pre-Step-5 shape.
 */

export const CURRENT_STORAGE_VERSION = 8;
export const MIGRATABLE_STORAGE_VERSION = 6;

function v6_to_v7(data) {
  // v6 edges had no plastic / mod_source_id fields. NeuralGraph.deserialize
  // already defaults these to { plastic: false, mod_source_id: null } via
  // field-defaulting in the edge normalizer, so no graph rewriting is
  // needed here — the migrator is a version bump.
  data.version = 7;
  return data;
}

function v7_to_v8(data) {
  // v8 adds an optional `world` block. Absent → loader leaves the
  // freshly-constructed World state in place (default ant spawn + warmup).
  data.world = null;
  data.version = 8;
  return data;
}

export const MIGRATIONS = {
  6: v6_to_v7,
  7: v7_to_v8,
};

/**
 * Upgrade `data` to CURRENT_STORAGE_VERSION. Mutates and returns `data`.
 *
 * @throws if data.version is missing, below MIGRATABLE_STORAGE_VERSION,
 *         or lacks a migrator for some intermediate version.
 */
export function migrate(data) {
  const from = data.version;
  if (!Number.isInteger(from)) {
    throw new Error(`migrate: missing/invalid version (${from})`);
  }
  if (from < MIGRATABLE_STORAGE_VERSION) {
    throw new Error(
      `migrate: version ${from} is below migratable floor ${MIGRATABLE_STORAGE_VERSION}`
    );
  }
  if (from > CURRENT_STORAGE_VERSION) {
    throw new Error(
      `migrate: version ${from} is newer than current ${CURRENT_STORAGE_VERSION}`
    );
  }
  while (data.version < CURRENT_STORAGE_VERSION) {
    const up = MIGRATIONS[data.version];
    if (!up) throw new Error(`migrate: no migrator from version ${data.version}`);
    data = up(data);
  }
  return data;
}
