/**
 * Chemical-field codec for save/load (schema v8).
 *
 * A ChemicalField is a Float32Array(cols*rows) + cell size. Round-tripping
 * a field as a JSON array works but inflates ~10–15× (each float becomes
 * 8–10 ASCII chars). Base64-encoding the raw buffer keeps overhead at the
 * ~1.33× theoretical minimum and decodes bit-for-bit.
 *
 * btoa/atob are used (globals in modern browsers and Node ≥ 16). No new
 * dependency is added.
 *
 * Dimension mismatch between saved and live field is treated as a
 * non-fatal skip — same recovery shape the v7 deserialize uses for
 * dangling mod_source_id. The caller keeps the live field's existing
 * contents and a console.warn explains why.
 */

const CHUNK = 0x8000; // 32k bytes per fromCharCode.apply — safe under call-stack limits

function float32ArrayToBase64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(bin);
}

function base64ToFloat32Array(b64) {
  const bin = atob(b64);
  const len = bin.length;
  if (len % 4 !== 0) {
    throw new Error(`base64ToFloat32Array: byte length ${len} is not a multiple of 4`);
  }
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function encodeField(field) {
  return {
    cols: field.cols,
    rows: field.rows,
    cellSize: field.cellSize,
    data: float32ArrayToBase64(field.grid),
  };
}

/**
 * Restore `obj` (from encodeField) into `field`. Returns true on success.
 * Returns false (and warns) if dimensions or cell size don't match — in
 * that case the live field's contents are left untouched.
 */
export function decodeField(obj, field, onWarn = null) {
  const warn = (msg) => {
    console.warn(msg);
    if (typeof onWarn === "function") onWarn(msg);
  };
  if (!obj || typeof obj !== "object" || typeof obj.data !== "string") return false;
  if (obj.cols !== field.cols || obj.rows !== field.rows || obj.cellSize !== field.cellSize) {
    warn(
      `chemical field discarded (size mismatch — saved ${obj.cols}x${obj.rows}@${obj.cellSize}, ` +
      `live ${field.cols}x${field.rows}@${field.cellSize})`
    );
    return false;
  }
  let arr;
  try {
    arr = base64ToFloat32Array(obj.data);
  } catch (err) {
    warn(`chemical field discarded (base64 decode failed: ${err.message})`);
    return false;
  }
  if (arr.length !== field.grid.length) {
    warn(`chemical field discarded (cell count ${arr.length} ≠ live ${field.grid.length})`);
    return false;
  }
  field.grid.set(arr);
  return true;
}
