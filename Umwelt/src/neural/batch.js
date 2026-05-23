// Multi-ant batched evaluator. Compiles a NeuralGraph into flat TypedArrays
// (Topology) so the per-tick eval loop can process A ants over the same
// circuit without per-tick Map lookups or object allocation. Authoring
// stays on NeuralGraph; this module is read-only over graph shape and
// rebuilds Topology only when the graph mutates.
//
// Layout is ant-major: state[a*N + i] is node i of ant a. The inner loop
// touches all N nodes of one ant before advancing to the next, so cache
// lines stay warm across the eval-order walk for that ant.
//
// Math must stay bit-equivalent to NeuralGraph.computeSignals for graphs
// with no edge delays — see the parity test in batch-parity-test.mjs.
// edge.delay_ms is honoured here but not in computeSignals; a delayed
// graph is intentionally outside the parity contract (see delay-test.mjs).

import { LEARNING_RATE, WEIGHT_DECAY_RATE } from "./constants.js";

// ── Node type encoding ──────────────────────────────────────────────────
export const NT_SENSOR   = 0;
export const NT_INTER_EXC = 1;
export const NT_INTER_INH = 2;
export const NT_MOD       = 3;
export const NT_MOTOR     = 4;

const NEURON_TYPE_CODE = {
  sensor_on:  NT_SENSOR,
  inter_exc:  NT_INTER_EXC,
  inter_inh:  NT_INTER_INH,
  modulator:  NT_MOD,
  motor:      NT_MOTOR,
};

// ── Edge kind encoding ─────────────────────────────────────────────────
export const EK_EXC = 0;
export const EK_INH = 1;
export const EK_MOD = 2;

// ── Defaults / constants matching neural.js ────────────────────────────
const EDGE_WEIGHT_MIN = 0.1;
const EDGE_WEIGHT_MAX = 1.0;
const MOD_GAIN_MIN = 0.1;
const MOD_GAIN_MAX = 3.0;
const MOD_GAIN_BASELINE = 1.0;
const W_INH = 2.0;                       // inter_inh drive amplification
const ADAPT_SUBTRACT_SCALE = 0.6;
const MAX_H_REBOUND = 1.5;
const DEFAULT_TAU = { 0: 0.5, 1: 3.0, 2: 3.0, 3: 15.0, 4: 0 };
const DEFAULT_TAU_CHARGE = 4.0;
const DEFAULT_TAU_DISCHARGE = 10.0;
const DEFAULT_G_REBOUND = 7.0;
const DEFAULT_REBOUND_THRESHOLD = 0.5;
const DEFAULT_REBOUND_GATE_CENTER = -0.2;
const DEFAULT_REBOUND_GATE_SLOPE = 15;

function clampM(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function clampWeight(w) {
  if (!Number.isFinite(w)) return 1;
  return clampM(w, EDGE_WEIGHT_MIN, EDGE_WEIGHT_MAX);
}
function clampDale(w) {
  if (!Number.isFinite(w)) return 0;
  return clampM(w, 0, EDGE_WEIGHT_MAX);
}
function clampAtten(a) {
  if (!Number.isFinite(a)) return 1;
  return clampM(a, 0, 1);
}
function gainFromMod(sourceSignal, effWeight) {
  const s = clampM(sourceSignal, 0, 1);
  const w = clampWeight(effWeight);
  const rawGain = MOD_GAIN_MIN + s * (MOD_GAIN_MAX - MOD_GAIN_MIN);
  return clampM(MOD_GAIN_BASELINE + (rawGain - MOD_GAIN_BASELINE) * w, MOD_GAIN_MIN, MOD_GAIN_MAX);
}

function nodeOutputForType(typeCode, state, adapt) {
  if (typeCode === NT_INTER_EXC || typeCode === NT_INTER_INH) {
    const eff = clampM(state, 0, 1);
    return clampM(eff - adapt * ADAPT_SUBTRACT_SCALE, 0, 1);
  }
  return clampM(state, 0, 1);
}

// ── compileTopology ────────────────────────────────────────────────────
// Walks the graph once. Stable indexing: sensors first (in iteration
// order of graph.nodes), then non-sensors. Eval order = non-sensors
// sorted by (x, then y), matching computeSignals.
export function compileTopology(graph, refDtMs = 1000 / 60) {
  const allNodes = [...graph.nodes.values()];
  const sensors = allNodes.filter((n) => (n.neuronType ?? n.type) === "sensor_on");
  const nonSensors = allNodes.filter((n) => (n.neuronType ?? n.type) !== "sensor_on");
  // Same sort key computeSignals uses.
  nonSensors.sort((a, b) => a.x - b.x || a.y - b.y);

  const orderedNodes = [...sensors, ...nonSensors];
  const N = orderedNodes.length;
  const idToIndex = new Map();
  for (let i = 0; i < N; i++) idToIndex.set(orderedNodes[i].id, i);

  const nodeIds = new Array(N);
  const nodeSourceIds = new Array(N);
  const nodeType = new Int8Array(N);
  const tau = new Float32Array(N);
  const tauCharge = new Float32Array(N);
  const tauDischarge = new Float32Array(N);
  const tauAdapt = new Float32Array(N);
  const gRebound = new Float32Array(N);
  const reboundThreshold = new Float32Array(N);
  // gate center / slope kept for parity even though the simple drive
  // formula doesn't use them yet — future extension surface.
  const reboundGateCenter = new Float32Array(N);
  const reboundGateSlope = new Float32Array(N);
  // Initial state seed values, used by createBatchState to fill state[]
  // when no per-ant seed is provided.
  const initState = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    const n = orderedNodes[i];
    const t = n.neuronType ?? n.type;
    const code = NEURON_TYPE_CODE[t] ?? NT_INTER_EXC;
    nodeIds[i] = n.id;
    nodeSourceIds[i] = n.sourceId ?? null;
    nodeType[i] = code;
    const tDefault = DEFAULT_TAU[code] ?? 1.0;
    const tVal = Number.isFinite(n.tau) ? n.tau : tDefault;
    tau[i] = Math.max(0.05, tVal);
    tauCharge[i] = Math.max(0.05, Number.isFinite(n.tau_charge) ? n.tau_charge : DEFAULT_TAU_CHARGE);
    tauDischarge[i] = Math.max(0.05, Number.isFinite(n.tau_discharge) ? n.tau_discharge : DEFAULT_TAU_DISCHARGE);
    tauAdapt[i] = Math.max(0.05, tau[i] * 4);
    gRebound[i] = Math.max(0, Number.isFinite(n.g_rebound) ? n.g_rebound : DEFAULT_G_REBOUND);
    reboundThreshold[i] = Number.isFinite(n.rebound_threshold) ? n.rebound_threshold : DEFAULT_REBOUND_THRESHOLD;
    reboundGateCenter[i] = Number.isFinite(n.rebound_gate_center) ? n.rebound_gate_center : DEFAULT_REBOUND_GATE_CENTER;
    reboundGateSlope[i] = Math.max(0.1, Number.isFinite(n.rebound_gate_slope) ? n.rebound_gate_slope : DEFAULT_REBOUND_GATE_SLOPE);
    // modulator default state is the baseline (=1.0 gain) per neural.js.
    if (code === NT_MOD) {
      const baseline = (MOD_GAIN_BASELINE - MOD_GAIN_MIN) / (MOD_GAIN_MAX - MOD_GAIN_MIN);
      initState[i] = baseline;
    } else {
      initState[i] = 0;
    }
  }

  // S = first sensor count; sensors live at indices [0, S).
  const S = sensors.length;
  const sensorNodeIndices = new Int32Array(S);
  const sensorSourceIds = new Array(S);
  for (let i = 0; i < S; i++) {
    sensorNodeIndices[i] = i;
    sensorSourceIds[i] = sensors[i].sourceId ?? sensors[i].id;
  }

  // Eval order = non-sensors, in x/y order. Stored as N-indices.
  const evalNodeIndices = new Int32Array(N - S);
  for (let k = 0; k < N - S; k++) evalNodeIndices[k] = S + k;

  // Motor lookup: indices of motor nodes for motor-output extraction.
  const motorList = [];
  for (let i = 0; i < N; i++) if (nodeType[i] === NT_MOTOR) motorList.push(i);
  const motorNodeIndices = new Int32Array(motorList);
  const motorSourceIds = motorList.map((i) => nodeSourceIds[i]);

  // Edges
  const allEdges = [...graph.edges.values()];
  const E = allEdges.length;
  const edgeFrom = new Int32Array(E);
  const edgeTo = new Int32Array(E);
  const edgeWeight = new Float32Array(E);
  const edgeKind = new Int8Array(E);
  const edgePlastic = new Uint8Array(E);
  const edgeModSrc = new Int32Array(E);
  const edgeInitW = new Float32Array(E);   // initial plastic weight per edge

  for (let e = 0; e < E; e++) {
    const edge = allEdges[e];
    const fromIdx = idToIndex.get(edge.fromId);
    const toIdx = idToIndex.get(edge.toId);
    if (fromIdx === undefined || toIdx === undefined) {
      // shouldn't happen — graph integrity is enforced by NeuralGraph
      edgeFrom[e] = 0;
      edgeTo[e] = 0;
      edgeWeight[e] = 0;
      edgeModSrc[e] = -1;
      continue;
    }
    edgeFrom[e] = fromIdx;
    edgeTo[e] = toIdx;
    const fromType = nodeType[fromIdx];
    let kind;
    if (fromType === NT_MOD) kind = EK_MOD;
    else if (fromType === NT_INTER_INH) kind = EK_INH;
    else kind = EK_EXC;
    edgeKind[e] = kind;
    edgePlastic[e] = edge.plastic ? 1 : 0;
    if (edge.plastic) {
      const modIdx = edge.mod_source_id ? idToIndex.get(edge.mod_source_id) : undefined;
      if (modIdx === undefined || nodeType[modIdx] !== NT_MOD) {
        // Dangling modulator → revert to fixed at compile time. neural.js
        // does the same in setEdgePlastic/deserialize but a graph could
        // be modified between writeback and recompile, so guard here.
        edgePlastic[e] = 0;
        edgeModSrc[e] = -1;
        edgeWeight[e] = clampWeight(edge.weight ?? 1);
        edgeInitW[e] = clampDale(edge.weight ?? 0);
      } else {
        edgeModSrc[e] = modIdx;
        edgeWeight[e] = clampDale(edge.weight ?? 1);  // plastic baseline
        edgeInitW[e] = clampDale(Number.isFinite(edge.w) ? edge.w : edge.weight);
      }
    } else {
      edgeModSrc[e] = -1;
      edgeWeight[e] = clampWeight(edge.weight ?? 1);
      edgeInitW[e] = 0;
    }
  }

  // Per-edge signal attenuation ∈ [0,1]. Parallel to edgeWeight; default
  // 1.0 (full passthrough) so edges without the field behave identically
  // to pre-v11. Same lane as edgeDelayTicks — both are honest physical
  // baggage compiled in by the Bevy workshop, §7.4.
  const edgeAttenuation = new Float32Array(E);
  for (let e = 0; e < E; e++) {
    edgeAttenuation[e] = clampAtten(allEdges[e].attenuation);
  }

  // Per-edge conduction delay, rounded to whole ticks at the fixed step.
  // ringSize covers the longest delay so the history buffer never aliases.
  const edgeDelayTicks = new Int32Array(E);
  let maxDelayTicks = 0;
  for (let e = 0; e < E; e++) {
    const ms = Number.isFinite(allEdges[e].delay_ms) ? Math.max(0, allEdges[e].delay_ms) : 0;
    const ticks = Math.round(ms / refDtMs);
    edgeDelayTicks[e] = ticks;
    if (ticks > maxDelayTicks) maxDelayTicks = ticks;
  }
  const ringSize = maxDelayTicks + 1;

  // CSR-like incoming-edge index: for each node i, edges with edgeTo===i
  // live in edgeIncomingList[edgeIncomingStart[i] .. edgeIncomingStart[i+1]).
  const counts = new Int32Array(N);
  for (let e = 0; e < E; e++) counts[edgeTo[e]]++;
  const edgeIncomingStart = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) edgeIncomingStart[i + 1] = edgeIncomingStart[i] + counts[i];
  const cursor = new Int32Array(N);
  const edgeIncomingList = new Int32Array(E);
  for (let e = 0; e < E; e++) {
    const to = edgeTo[e];
    edgeIncomingList[edgeIncomingStart[to] + cursor[to]++] = e;
  }

  return {
    N, E, S,
    nodeIds, nodeSourceIds, nodeType,
    tau, tauCharge, tauDischarge, tauAdapt, gRebound,
    reboundThreshold, reboundGateCenter, reboundGateSlope,
    initState,
    sensorNodeIndices, sensorSourceIds,
    evalNodeIndices,
    motorNodeIndices, motorSourceIds,
    edgeFrom, edgeTo, edgeWeight, edgeKind, edgePlastic, edgeModSrc,
    edgeInitW, edgeAttenuation, edgeDelayTicks, ringSize,
    edgeIncomingStart, edgeIncomingList,
  };
}

// ── createBatchState ───────────────────────────────────────────────────
export function createBatchState(topo, A) {
  const { N, E, initState, ringSize } = topo;
  const state = new Float32Array(A * N);
  // Initialize each ant's state to the per-node defaults (modulator
  // baseline, others zero).
  for (let a = 0; a < A; a++) {
    for (let i = 0; i < N; i++) state[a * N + i] = initState[i];
  }
  const plasticW = new Float32Array(A * E);
  for (let a = 0; a < A; a++) {
    for (let e = 0; e < E; e++) {
      plasticW[a * E + e] = topo.edgePlastic[e] ? topo.edgeInitW[e] : 0;
    }
  }
  return {
    A,
    alive: new Uint8Array(A).fill(1),
    state,
    adapt: new Float32Array(A * N),
    hRebound: new Float32Array(A * N),
    output: new Float32Array(A * N),
    prevOutput: new Float32Array(A * N),
    plasticW,
    // Delay ring buffer: outputHistory[a*N*ringSize + i*ringSize + slot]
    // holds node i of ant a, written once per tick at slot = tick % ringSize.
    outputHistory: new Float32Array(A * N * ringSize),
    ringSize,
    tick: 0,
  };
}

// Seed a single ant's slot from a graph's current node state. Used at
// World boot so the batch starts from the same place as the graph; not
// needed after that (the batch becomes authoritative).
export function seedBatchFromGraph(topo, batch, graph, antIndex) {
  const { N, E, nodeIds } = topo;
  for (let i = 0; i < N; i++) {
    const node = graph.nodes.get(nodeIds[i]);
    if (!node) continue;
    batch.state[antIndex * N + i] = Number.isFinite(node.state) ? node.state : topo.initState[i];
    batch.adapt[antIndex * N + i] = Number.isFinite(node.adapt) ? node.adapt : 0;
    batch.hRebound[antIndex * N + i] = Number.isFinite(node.h_rebound) ? node.h_rebound : 0;
  }
  for (let e = 0; e < E; e++) {
    if (!topo.edgePlastic[e]) continue;
    batch.plasticW[antIndex * E + e] = topo.edgeInitW[e];
  }
}

// Mirror a single ant's slot back into the graph. Used for the focused
// ant only — keeps the editor / inspector showing live state for the
// observed individual. Other ants' state lives only in the batch.
export function writebackFromBatch(topo, batch, graph, antIndex) {
  const { N, nodeIds } = topo;
  for (let i = 0; i < N; i++) {
    const node = graph.nodes.get(nodeIds[i]);
    if (!node) continue;
    node.state = batch.state[antIndex * N + i];
    node.adapt = batch.adapt[antIndex * N + i];
    node.h_rebound = batch.hRebound[antIndex * N + i];
  }
  // Plastic weights too — but only one ant's view. For batched plasticity
  // each ant has its own w; mirroring back any single ant's w into the
  // shared graph.edge.w is a UI compromise. (See doc 七.2 footnote.)
  for (const edge of graph.edges.values()) {
    if (!edge.plastic) continue;
  }
}

// ── stepBatch ──────────────────────────────────────────────────────────
// One simulation tick. Mutates batch in-place. Caller pre-fills
// sensorInputs[a*S + s] with the post-sensorEnabled-gating value for
// sensor s of ant a.
//
// Options:
//   dt: number (seconds)
//   noise: { sigma: number|Float32Array, rng: ()=>number, mask?: Uint8Array(N) } | null
//   aliveOverride: optional Uint8Array(A); when present, replaces batch.alive
//     for this tick (does not write back).
export function stepBatch(topo, batch, sensorInputs, options = {}) {
  const { dt = 1 / 60, noise = null, aliveOverride = null } = options;
  const {
    N, E, S,
    nodeType, tau, tauDischarge, tauAdapt, gRebound, reboundThreshold,
    sensorNodeIndices,
    evalNodeIndices,
    edgeFrom, edgeWeight, edgeKind, edgePlastic, edgeModSrc,
    edgeAttenuation, edgeDelayTicks, ringSize,
    edgeIncomingStart, edgeIncomingList,
  } = topo;
  const A = batch.A;
  const alive = aliveOverride ?? batch.alive;
  const { state, adapt, hRebound, output, prevOutput, plasticW, outputHistory } = batch;

  const noiseSigmaArr = (noise && noise.sigma instanceof Float32Array) ? noise.sigma : null;
  const noiseSigmaScalar = (noise && typeof noise.sigma === "number") ? noise.sigma : 0;
  const noiseMask = noise?.mask ?? null;
  const noiseRng = noise?.rng ?? null;

  // 1. Precompute prevOutput for ALL nodes from the (about-to-be-replaced)
  //    state/adapt. Feedback edges read from this buffer.
  for (let a = 0; a < A; a++) {
    if (!alive[a]) continue;
    const baseN = a * N;
    for (let i = 0; i < N; i++) {
      prevOutput[baseN + i] = nodeOutputForType(nodeType[i], state[baseN + i], adapt[baseN + i]);
    }
  }

  // 2. Latch sensor states from inputs. output[sensor] = state[sensor]
  //    (clamped to [0,1] — sensorInputs already in that range, but clamp
  //    for safety).
  for (let a = 0; a < A; a++) {
    if (!alive[a]) continue;
    const baseN = a * N;
    const baseS = a * S;
    for (let s = 0; s < S; s++) {
      const idx = sensorNodeIndices[s];
      const v = clampM(sensorInputs[baseS + s], 0, 1);
      state[baseN + idx] = v;
      adapt[baseN + idx] = 0;
      hRebound[baseN + idx] = 0;
      output[baseN + idx] = v;
    }
  }

  // 3. Feedforward eval. For each non-sensor target in eval order, for
  //    each ant, accumulate incoming and integrate.
  //
  //    Source-signal rule (matches computeSignals exactly):
  //      - Sensor source  → freshly-latched output (this tick).
  //      - Non-sensor src → prev-tick output (currentNodeOutput-equivalent).
  //
  //    This is *not* "feedback vs feedforward" — computeSignals does its
  //    whole edge accumulation in one pass before integrating, so
  //    non-sensor sources never have a fresh output at edge-accumulation
  //    time, regardless of eval order. Removing the per-target
  //    interleaved fresh-read here is what restores parity.
  const orderLen = evalNodeIndices.length;
  for (let k = 0; k < orderLen; k++) {
    const i = evalNodeIndices[k];
    const t = nodeType[i];
    const inStart = edgeIncomingStart[i];
    const inEnd = edgeIncomingStart[i + 1];

    for (let a = 0; a < A; a++) {
      if (!alive[a]) continue;
      const baseN = a * N;
      const baseE = a * E;

      let excSum = 0, inhSum = 0, gain = 1;
      for (let p = inStart; p < inEnd; p++) {
        const e = edgeIncomingList[p];
        const fromIdx = edgeFrom[e];
        // Delayed edges read the source's output delay_ticks ago from the
        // history ring. delay_ticks === 0 keeps the original read exactly:
        // sensor → this tick's freshly-latched output; non-sensor → last
        // tick's output (== history[now-1], so 0→1 tick is continuous for
        // non-sensor sources).
        const dTicks = edgeDelayTicks[e];
        let src;
        if (dTicks <= 0) {
          src = fromIdx < S
            ? output[baseN + fromIdx]      // fresh-latched sensor signal
            : prevOutput[baseN + fromIdx]; // prev-tick output, computeSignals-style
        } else {
          const slot = ((batch.tick - dTicks) % ringSize + ringSize) % ringSize;
          src = outputHistory[a * N * ringSize + fromIdx * ringSize + slot];
        }
        const srcClamped = clampM(src, 0, 1);
        const effW = edgePlastic[e]
          ? clampDale(plasticW[baseE + e])
          : clampWeight(edgeWeight[e]);
        const atten = edgeAttenuation[e];
        const contrib = srcClamped * effW * atten;
        const kind = edgeKind[e];
        if (kind === EK_MOD) {
          gain *= gainFromMod(srcClamped * atten, effW);
        } else if (kind === EK_INH) {
          inhSum += contrib;
        } else {
          excSum += contrib;
        }
      }
      gain = clampM(gain, MOD_GAIN_MIN, MOD_GAIN_MAX);

      let netInput = (excSum - inhSum) * gain;
      // Noise injection — into netInput before the integrator so the
      // integrator's tau shapes the response.
      if (noiseRng && (noiseMask === null || noiseMask[i])) {
        const sigma = noiseSigmaArr ? noiseSigmaArr[i] : noiseSigmaScalar;
        if (sigma > 0) {
          // Box-Muller — one tap per call; second sample discarded.
          const u1 = Math.max(1e-12, noiseRng());
          const u2 = noiseRng();
          const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          netInput += sigma * z;
        }
      }

      const prevState = state[baseN + i];
      const prevAdapt = adapt[baseN + i];
      const prevH = hRebound[baseN + i];
      const safeTau = tau[i];

      let nextState, nextAdapt = 0, nextH = 0, outVal;

      if (t === NT_MOTOR) {
        outVal = clampM(netInput, -1, 1);
        nextState = outVal;
      } else if (t === NT_MOD) {
        const drive = clampM(netInput, 0, 1);
        nextState = clampM(prevState + (drive - prevState) * (dt / safeTau), 0, 1);
        outVal = nextState;
      } else if (t === NT_INTER_INH) {
        // Cumulative PIR rebound: state subthreshold + getting inhibited
        // accumulates h_rebound; otherwise discharge.
        let h = prevH;
        if (prevState < reboundThreshold[i] && inhSum > 0) {
          h += inhSum * 0.8 * dt;
        } else {
          h *= Math.exp(-dt / tauDischarge[i]);
        }
        nextH = clampM(h, 0, MAX_H_REBOUND);
        const drive = excSum * gain - W_INH * inhSum * gain - 2.0 * prevAdapt + gRebound[i] * nextH;
        nextState = clampM(prevState + (-prevState + drive) * (dt / safeTau), -1, 1);
        const eff = clampM(nextState, 0, 1);
        nextAdapt = clampM(prevAdapt + (-prevAdapt + eff) * (dt / tauAdapt[i]), 0, 1);
        outVal = clampM(eff - nextAdapt * ADAPT_SUBTRACT_SCALE, 0, 1);
      } else {
        // NT_INTER_EXC
        nextState = clampM(prevState + (netInput - prevState) * (dt / safeTau), -1, 1);
        const eff = clampM(nextState, 0, 1);
        nextAdapt = clampM(prevAdapt + (eff - prevAdapt) * (dt / tauAdapt[i]), 0, 1);
        outVal = clampM(eff - nextAdapt * ADAPT_SUBTRACT_SCALE, 0, 1);
      }

      state[baseN + i] = nextState;
      adapt[baseN + i] = nextAdapt;
      hRebound[baseN + i] = nextH;
      output[baseN + i] = outVal;
    }
  }

  // 3.5 Record this tick's outputs into the delay ring buffer, then advance
  //     the tick counter. Delayed edges (step 3) read past slots from here.
  const histSlot = batch.tick % ringSize;
  for (let a = 0; a < A; a++) {
    const baseN = a * N;
    const baseH = a * N * ringSize;
    for (let i = 0; i < N; i++) {
      outputHistory[baseH + i * ringSize + histSlot] = output[baseN + i];
    }
  }
  batch.tick++;

  // 4. Plastic weight updates. Use this tick's outputs.
  for (let e = 0; e < E; e++) {
    if (!edgePlastic[e]) continue;
    const modIdx = edgeModSrc[e];
    if (modIdx < 0) continue;
    const fromIdx = edgeFrom[e];
    const toIdx = topo.edgeTo[e];
    const baselineW = edgeWeight[e];
    for (let a = 0; a < A; a++) {
      if (!alive[a]) continue;
      const baseN = a * N;
      const baseE = a * E;
      const pre = clampM(output[baseN + fromIdx], 0, 1);
      const post = clampM(output[baseN + toIdx], 0, 1);
      const mod = clampM(output[baseN + modIdx], 0, 1);
      const cur = plasticW[baseE + e];
      const dw = LEARNING_RATE * pre * post * mod;
      const decay = WEIGHT_DECAY_RATE * (baselineW - cur);
      plasticW[baseE + e] = clampDale(cur + dw + decay);
    }
  }
}

// Helper: read motor outputs for one ant as a plain object the rest of
// the runtime expects.
export function readMotorOutputs(topo, batch, antIndex) {
  const out = {};
  const baseN = antIndex * topo.N;
  for (let m = 0; m < topo.motorNodeIndices.length; m++) {
    out[topo.motorSourceIds[m]] = batch.output[baseN + topo.motorNodeIndices[m]];
  }
  return out;
}
