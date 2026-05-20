// Plasticity constants. Hardcoded, not exposed to the player —
// the game is about circuit topology, not parameter tuning.
//
// Scale rationale (spec §Risks to Watch #2): with saturated drive
// (pre = post = mod = 1), asymptotic w is ~η / decay = 10, well above
// the Dale's Law ceiling of 1.0 — so Hebbian learning dominates while
// the connection is driven, and decay only meaningfully moves w when
// the modulator goes silent. Learning in minutes, forgetting in
// hours; matches mushroom-body microglomeruli remodeling timescale.

export const LEARNING_RATE = 0.01;
export const WEIGHT_DECAY_RATE = 0.001;

// Maximum axon conduction delay, in milliseconds. edge.delay_ms is clamped
// to [0, DELAY_MS_MAX]. The Bevy workshop computes delay_ms from axon
// length / conduction speed; HTML only consumes it. 500ms is ~30 ticks at
// the 60 Hz fixed step — generous headroom over real insect axon delays,
// chosen so "near vs far" neuron placement is perceptible in the main world.
export const DELAY_MS_MAX = 500;
