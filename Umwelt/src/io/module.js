/**
 * Workshop module loader. The Bevy 3D neural workshop exports a designed
 * organ as a `umwelt-module-v1` JSON file; this parses it for the HTML
 * main world. See docs/superpowers/specs/2026-05-20-bevy-workshop-design.md §7.1.
 *
 * The module's `graph` field is the standard NeuralGraph serialization (the
 * same nested-object shape JSON.parse(NeuralGraph.serialize()) produces),
 * with edges optionally carrying `delay_ms`. `receptors` and `meta` are
 * workshop-side metadata; receptor → sensor-channel remapping is deferred
 * (no workshop exists yet, so emitted graphs already use HTML sensor
 * sourceIds).
 */

export const MODULE_SCHEMA = "umwelt-module-v1";

/**
 * Parse a workshop module export. Returns
 *   { levelId, graph, receptors, meta }
 * or null if `text` is not a structurally valid umwelt-module-v1 payload.
 * `graph` is handed to NeuralGraph.deserialize as-is.
 */
export function parseModuleText(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (_) {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  if (raw.schema !== MODULE_SCHEMA) {
    console.warn(`parseModuleText: unknown schema "${raw.schema}" (expected ${MODULE_SCHEMA})`);
    return null;
  }
  if (!raw.graph || typeof raw.graph !== "object") {
    console.warn("parseModuleText: module has no graph block");
    return null;
  }
  return {
    levelId: typeof raw.level_id === "string" ? raw.level_id : null,
    graph: raw.graph,
    receptors: Array.isArray(raw.receptors) ? raw.receptors : [],
    meta: raw.meta && typeof raw.meta === "object" ? raw.meta : null,
  };
}
