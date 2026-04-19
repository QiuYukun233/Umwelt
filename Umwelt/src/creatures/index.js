/**
 * Active creature selection.
 *
 * Exports the currently selected creature as `ACTIVE_CREATURE`, plus the
 * full registry. Per CLAUDE.md §"当前主角：蚂蚁", the ant is the default.
 * The nematode definition is sealed in `nematode.js` and remains in the
 * registry for reference — do not delete it.
 *
 * Downstream modules (runtime sensors/motors, renderer, UI) are wired
 * to the nematode's anatomical slot system as of this commit; they will
 * be migrated to read `ACTIVE_CREATURE` over the course of the ant
 * implementation plan (see ant-implementation-prompt.md steps 2–6).
 */

import { ANT } from "./ant.js";
import { NEMATODE } from "./nematode.js";

export const CREATURES = {
  ant: ANT,
  nematode: NEMATODE,
};

export const ACTIVE_CREATURE = ANT;
