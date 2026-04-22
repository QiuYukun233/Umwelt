import { CONFIG, CHEM_KEYS, CHEM_SPECIES, SENSOR_ORDER, SOURCE_ORDER } from "./config.js";
import { clamp, normAngle, randomBetween, respawnPoint, TAU, wrapValue } from "./math.js";
import { AntBody } from "./creatures/ant-body.js";
import { encodeField, decodeField } from "./io/fields.js";

export class ChemicalField {
  constructor(width, height, cellSize) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.grid = new Float32Array(this.cols * this.rows);
    this.next = new Float32Array(this.cols * this.rows);
  }

  inject(x, y, amount) {
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);
    const i = row * this.cols + col;
    if (i >= 0 && i < this.grid.length)
      this.grid[i] = Math.min(1, this.grid[i] + amount);
  }

  /**
   * Write `amount` of this chemical at world position (x, y).
   *
   * Semantically identical to `inject` — kept under the new name so
   * the call sites for biological secretion (glands) read differently
   * from environmental emission sources. Clamped to [0, 1] per cell.
   */
  writeAt(x, y, amount) {
    this.inject(x, y, amount);
  }

  update(dt, diffusion, decay) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        const neighbors =
          (c > 0 ? this.grid[i - 1] : 0) +
          (c < this.cols - 1 ? this.grid[i + 1] : 0) +
          (r > 0 ? this.grid[i - this.cols] : 0) +
          (r < this.rows - 1 ? this.grid[i + this.cols] : 0);
        const nc =
          (c > 0 ? 1 : 0) + (c < this.cols - 1 ? 1 : 0) +
          (r > 0 ? 1 : 0) + (r < this.rows - 1 ? 1 : 0);
        this.next[i] = Math.max(0, Math.min(1,
          this.grid[i]
          + diffusion * (neighbors - nc * this.grid[i]) * dt
          - decay * this.grid[i] * dt
        ));
      }
    }
    [this.grid, this.next] = [this.next, this.grid];
  }

  sample(x, y) {
    const cx = x / this.cellSize, cy = y / this.cellSize;
    const c0 = Math.max(0, Math.min(Math.floor(cx), this.cols - 1));
    const c1 = Math.min(c0 + 1, this.cols - 1);
    const r0 = Math.max(0, Math.min(Math.floor(cy), this.rows - 1));
    const r1 = Math.min(r0 + 1, this.rows - 1);
    const tc = Math.max(0, Math.min(cx - c0, 1));
    const tr = Math.max(0, Math.min(cy - r0, 1));
    return (
      this.grid[r0 * this.cols + c0] * (1 - tc) * (1 - tr) +
      this.grid[r0 * this.cols + c1] * tc * (1 - tr) +
      this.grid[r1 * this.cols + c0] * (1 - tc) * tr +
      this.grid[r1 * this.cols + c1] * tc * tr
    );
  }

  sampleCone(x, y, angle, halfAngle, range) {
    let total = 0, weight = 0;
    const step = this.cellSize;
    for (let d = step; d <= range; d += step) {
      for (let a = -halfAngle; a <= halfAngle; a += halfAngle / 3) {
        const sx = x + Math.cos(angle + a) * d;
        const sy = y + Math.sin(angle + a) * d;
        const w = Math.cos(a) * (1 - d / range);
        total += this.sample(sx, sy) * w;
        weight += w;
      }
    }
    return weight > 0 ? Math.min(1, total / weight) : 0;
  }

  /**
   * Peak concentration anywhere in the cone.
   *
   * An average-based cone dilutes the signal: the cone's footprint is
   * large, and a compact food source occupies only a small fraction of
   * it, so the mean sits near the floor value. A real olfactory neuron
   * responds to the strongest whiff in its receptive field, not the
   * spatial mean — this is the honest rendering of that behaviour.
   *
   * Preserving the regular `sampleCone` (averaged) because the legacy
   * nematode pathway still uses it.
   */
  sampleConePeak(x, y, angle, halfAngle, range) {
    let peak = 0;
    const step = this.cellSize * 0.5;      // finer step so we don't miss hot spots
    const da = halfAngle / 4;
    for (let d = step; d <= range; d += step) {
      for (let a = -halfAngle; a <= halfAngle; a += da) {
        const sx = x + Math.cos(angle + a) * d;
        const sy = y + Math.sin(angle + a) * d;
        const v = this.sample(sx, sy);
        if (v > peak) peak = v;
      }
    }
    return Math.min(1, peak);
  }

  resize(width, height) {
    this.cols = Math.ceil(width / this.cellSize);
    this.rows = Math.ceil(height / this.cellSize);
    this.grid = new Float32Array(this.cols * this.rows);
    this.next = new Float32Array(this.cols * this.rows);
  }
}

export function createMetrics() {
  return {
    sensorOutputs: Object.fromEntries(SOURCE_ORDER.map((id) => [id, 0])),
    leftChemA: 0,
    rightChemA: 0,
    leftChemD: 0,
    rightChemD: 0,
    motor_forward: 0,
    motor_turn_L: 0,
    motor_turn_R: 0,
    gland_alpha: 0,
    gland_beta: 0,
    mandible: 0,
    speed: 0,
    energy: 1,
    turn: 0,
    turnSigned: 0,
    sensorDrain: 0
  };
}

export class World {
  constructor(environmentState, onLog) {
    this.environmentState = environmentState;
    this.onLog = onLog;
    this.behaviorLog = [];
    this.w = 960;
    this.h = 640;
    this.generation = 1;
    this.bodyParams = { turnScale: 1.0, speedScale: 1.0 };
    this.foods = [];
    this.dangers = [];
    // Four independent chemical fields, one per species. ChemA/D track
    // environmental sources (food, danger). ChemB/C are written by the
    // ant's glands. foodField / dangerField are kept as aliases for the
    // renderer and legacy call sites.
    this.fields = {};
    for (const k of CHEM_KEYS) {
      this.fields[k] = new ChemicalField(this.w, this.h, CONFIG.FIELD_CELL_SIZE);
    }
    this.foodField   = this.fields.chem_A;
    this.dangerField = this.fields.chem_D;
    this.metrics = createMetrics();
    // Multi-ant groundwork: stable int id per AntBody (allocated by nextAntId),
    // parallel `ants` array, `focusedAntId` naming the observed one. Step 1 is
    // zero-behavior-change — `this.ant` remains authoritative and all internal
    // reads still use it; `ants` mirrors it for external code and eventual
    // batch iteration. Feature 2 flips the polarity (ants becomes canonical,
    // this.ant is deleted, serialize switches to ants[]).
    this.nextAntId = 0;
    this.focusedAntId = 0;
    this.ants = [];
    this.reset();
  }

  /**
   * The ant currently being observed (HUD / metrics / camera). Returns null
   * if no ant matches focusedAntId — callers must guard. Deliberately does
   * NOT fall back to ants[0]: a null focus is the honest signal that
   * nothing can be shown, e.g. after a total wipe or before spawn.
   */
  get focusedAnt() {
    return this.ants.find((a) => a.id === this.focusedAntId) ?? null;
  }

  setSize(width, height) {
    const newW = Math.max(320, width);
    const newH = Math.max(240, height);
    const dimsChanged = newW !== this.w || newH !== this.h;
    this.w = newW;
    this.h = newH;
    if (this.ant) {
      this.ant.x = clamp(this.ant.x, 0, this.w);
      this.ant.y = clamp(this.ant.y, 0, this.h);
    }
    for (const item of this.foods) {
      item.x = clamp(item.x, CONFIG.FOOD_MARGIN, this.w - CONFIG.FOOD_MARGIN);
      item.y = clamp(item.y, CONFIG.FOOD_MARGIN, this.h - CONFIG.FOOD_MARGIN);
    }
    for (const item of this.dangers) {
      item.x = clamp(item.x, CONFIG.DANGER_MARGIN, this.w - CONFIG.DANGER_MARGIN);
      item.y = clamp(item.y, CONFIG.DANGER_MARGIN, this.h - CONFIG.DANGER_MARGIN);
    }
    // Only touch the fields when the dimensions actually changed —
    // `ChemicalField.resize` zeroes the grid, so calling it on every
    // setSize() would wipe current plumes even if nothing changed.
    // After a genuine dimension change we rebuild ChemA/ChemD via the
    // warmup; ChemB/ChemC are transient gland secretions and losing
    // them on resize matches their biological nature.
    if (dimsChanged) {
      for (const k of CHEM_KEYS) this.fields[k].resize(this.w, this.h);
      this.warmupFields();
    }
  }

  /** Update the runtime sensor definitions. Call when sensors change. */
  setSensorDefs(sensorDefs, sourceOrder, sensorOrder) {
    this._sensorDefs = sensorDefs;
    this._sourceOrder = sourceOrder;
    this._sensorOrder = sensorOrder;
  }

  reset({ incrementGeneration = false } = {}) {
    if (incrementGeneration) this.generation += 1;
    this.behaviorLog.length = 0;
    this.alive = 0;
    this.foodEaten = 0;
    this.dead = false;
    this.lowEnergy50Logged = false;
    this.lowEnergy25Logged = false;
    this.lastDangerTime = -999;
    this._dangerLogged = false;
    this._dangerLogTime = -999;
    this.deathReason = "";
    this.turnRate = 0;
    const sensorOrder = this._sensorOrder ?? SENSOR_ORDER;
    this.prevSensorRaw = Object.fromEntries(sensorOrder.map((id) => [id, 0]));
    this.ant = new AntBody(this.w * 0.5, this.h * 0.55, -Math.PI / 2 + randomBetween(-0.2, 0.2));
    // Assign stable id and publish to the ants[] mirror. Step 1: first
    // spawn on a fresh World gets id=0, which matches the constructor's
    // focusedAntId default. Subsequent reset() calls re-use id=0 so save
    // payloads (v8, which don't carry focusedAntId) round-trip with the
    // same focus. Feature 2 will allocate fresh ids per respawn.
    this.ant.id = 0;
    this.nextAntId = 1;
    this.ants = [this.ant];
    this.metrics = createMetrics();
    for (const k of CHEM_KEYS) this.fields[k].resize(this.w, this.h);
    this.rebuildEnvironment();
  }

  rebuildEnvironment() {
    const avoid = { x: this.ant.x, y: this.ant.y, radius: 88 };
    this.foods = Array.from({ length: this.environmentState.foodDensity }, (_, index) => {
      const point = respawnPoint(this.w, this.h, CONFIG.FOOD_MARGIN, avoid);
      return { id: index + 1, x: point.x, y: point.y, r: randomBetween(5, 8), phase: randomBetween(0, TAU) };
    });
    this.dangers = Array.from({ length: this.environmentState.dangerDensity }, (_, index) => {
      const point = respawnPoint(this.w, this.h, CONFIG.DANGER_MARGIN, avoid);
      return { id: index + 1, x: point.x, y: point.y, r: randomBetween(7, 10), phase: randomBetween(0, TAU) };
    });
    // Clear environmental plumes before the new warmup. ChemB/ChemC are
    // deliberately NOT cleared — those are the ant's own gland secretions
    // (ground trail, alarm cloud). Wiping them on a density-slider change
    // would erase the path-following behavior the system is built around.
    this.fields.chem_A.grid.fill(0);
    this.fields.chem_D.grid.fill(0);
    this.warmupFields();
  }

  warmupFields() {
    const dt = CONFIG.FIXED_DT;
    const pa = CHEM_SPECIES.chem_A;
    const pd = CHEM_SPECIES.chem_D;
    for (let i = 0; i < CONFIG.FIELD_WARMUP_STEPS; i++) {
      for (const food of this.foods)
        this.foodField.inject(food.x, food.y, CONFIG.FOOD_EMIT_RATE * dt);
      this.foodField.update(dt, pa.diffusion, pa.decay);
      for (const danger of this.dangers)
        this.dangerField.inject(danger.x, danger.y, CONFIG.DANGER_EMIT_RATE * dt);
      this.dangerField.update(dt, pd.diffusion, pd.decay);
      // ChemB and ChemC have no environmental sources — the warmup is
      // empty for them. We still tick diffusion/decay so any residue
      // from a prior reset collapses to zero quickly.
      this.fields.chem_B.update(dt, CHEM_SPECIES.chem_B.diffusion, CHEM_SPECIES.chem_B.decay);
      this.fields.chem_C.update(dt, CHEM_SPECIES.chem_C.diffusion, CHEM_SPECIES.chem_C.decay);
    }
  }

  applyEnvironment(foodCount, dangerCount) {
    this.environmentState.foodDensity = foodCount;
    this.environmentState.dangerDensity = dangerCount;
    this.rebuildEnvironment();
  }

  log(tone, message) {
    const entry = { tone, message, seconds: this.alive, text: `[t=${this.alive.toFixed(1)}s] ${message}` };
    this.behaviorLog.push(entry);
    this.onLog?.(entry);
    return entry;
  }

  /**
   * Estimate a body-local coordinate frame at a fraction along the trail.
   * @param {number} t  0 = head, 1 = tail-end
   * @returns {{ x, y, fwdX, fwdY }} position and forward direction
   */
  _trailFrame(t) {
    const trail = this.ant.trail;
    const len = trail.length;
    if (len < 2) {
      // Fallback: project backward from head
      const dist = t * 30; // ~30px total worm length
      return {
        x: this.ant.x - this.ant.forward.x * dist,
        y: this.ant.y - this.ant.forward.y * dist,
        fwdX: this.ant.forward.x,
        fwdY: this.ant.forward.y,
      };
    }
    // Trail is newest-last: index 0 = oldest, len-1 = newest (head)
    const fi = (len - 1) * (1 - t);
    const i0 = Math.max(0, Math.min(len - 1, Math.floor(fi)));
    const i1 = Math.min(len - 1, i0 + 1);
    const frac = fi - i0;
    const p0 = trail[i0], p1 = trail[i1];
    const px = p0.x + (p1.x - p0.x) * frac;
    const py = p0.y + (p1.y - p0.y) * frac;
    // Tangent from neighboring points
    const di0 = Math.max(0, i0 - 1);
    const di1 = Math.min(len - 1, i0 + 1);
    let dx = trail[di1].x - trail[di0].x;
    let dy = trail[di1].y - trail[di0].y;
    const dLen = Math.sqrt(dx * dx + dy * dy);
    if (dLen > 1e-6) { dx /= dLen; dy /= dLen; }
    else { dx = this.ant.forward.x; dy = this.ant.forward.y; }
    return { x: px, y: py, fwdX: dx, fwdY: dy };
  }

  /**
   * Point-sample each enabled sensor at its anatomical body position.
   * Head sensors use head position, body sensors use trail, tail sensors use trail tail.
   */
  sampleSensors(sensorEnabled, sensorDefs, sourceOrder) {
    const outputs = Object.fromEntries(sourceOrder.map((id) => [id, 0]));
    // Pre-compute head frame (used by most sensors)
    const headFwd = this.ant.forward;
    const headDor = this.ant.dorsal;
    const headLat = headFwd.cross(headDor);
    const antAngle = Math.atan2(headFwd.y, headFwd.x);

    // Cone sampling params for antennal chemoreception — per ant-design-spec.md §3.1.
    // Each antenna's cone points forward ± 45° with a 60° spread so the two
    // cones overlap forward and diverge to the sides. Range is large enough
    // (4+ field cells) that L vs R readings differ before the ant arrives.
    const CONE_SIDE_ANGLE = Math.PI / 4;   // ±45° from heading
    const CONE_HALF_ANGLE = Math.PI / 6;   // ±30° spread
    // Range must extend past the food field's characteristic length
    // sqrt(D/decay) ≈ 76 px so the gradient is detectable before arrival.
    const CONE_RANGE = 160;                // ~2× characteristic length

    for (const sensor of sensorDefs) {
      if (!sensorEnabled[sensor.id]) continue;

      const o = sensor.offset;
      let wx, wy;
      if (sensor.region === "head" || !sensor.region) {
        const worldOff = headFwd.scale(o[0]).add(headDor.scale(o[1])).add(headLat.scale(o[2]));
        wx = this.ant.x + worldOff.x;
        wy = this.ant.y + worldOff.y;
      } else {
        const frame = this._trailFrame(sensor.bodyT ?? 0.5);
        const fx = frame.fwdX, fy = frame.fwdY;
        const lx = -fy, ly = fx;
        wx = frame.x + fx * o[0] + lx * o[2];
        wy = frame.y + fy * o[0] + ly * o[2];
      }

      // Antennal chemoreception: cone sampling from the antenna tip, aimed
      // forward-left (left antenna) or forward-right (right antenna). This
      // is what gives the ant directional gradient sensitivity — without
      // it, L and R antennae sit ~3 px apart in a 20 px grid cell and
      // read almost identical values.
      //
      // Screen coords have +y down, so the ant's own left is -π/4 from
      // heading (rotating CCW visually = decreasing angle in screen math).
      const isChem = sensor.kind === "chem_A" || sensor.kind === "chem_B"
                  || sensor.kind === "chem_C" || sensor.kind === "chem_D";
      const isAntenna = isChem && (sensor.side === "left" || sensor.side === "right");

      if (isAntenna) {
        const field = this.fields[sensor.field] ?? null;
        if (field) {
          const coneAngle = antAngle + (sensor.side === "left" ? -CONE_SIDE_ANGLE : CONE_SIDE_ANGLE);
          outputs[sensor.id] = field.sampleConePeak(wx, wy, coneAngle, CONE_HALF_ANGLE, CONE_RANGE);
        } else {
          outputs[sensor.id] = 0;
        }
      } else if (sensor.field === "chem_A" || sensor.field === "chem_B" || sensor.field === "chem_C" || sensor.field === "chem_D") {
        outputs[sensor.id] = this.fields[sensor.field].sample(wx, wy);
      } else if (sensor.field === "touch") {
        outputs[sensor.id] = this._sampleTouch(wx, wy);
      } else if (sensor.field === "mouth_taste") {
        // Contact taste — placeholder until step 3/5 wires the mandible clamp.
        outputs[sensor.id] = this._sampleTouch(wx, wy);
      } else if (sensor.field === "light") {
        outputs[sensor.id] = 0.5;
      } else {
        outputs[sensor.id] = 0;
      }
    }
    return outputs;
  }

  /**
   * Touch / mechanoreceptor sampling.
   * Returns 1 if position is within contact distance of any food, danger, or boundary.
   */
  _sampleTouch(wx, wy) {
    const TOUCH_RADIUS = 12; // px — contact distance
    // World boundary
    if (wx < TOUCH_RADIUS || wx > this.w - TOUCH_RADIUS ||
        wy < TOUCH_RADIUS || wy > this.h - TOUCH_RADIUS) {
      return 1;
    }
    // Food items
    for (const f of this.foods) {
      if (Math.hypot(f.x - wx, f.y - wy) < f.r + TOUCH_RADIUS) return 1;
    }
    // Danger items
    for (const d of this.dangers) {
      if (Math.hypot(d.x - wx, d.y - wy) < d.r + TOUCH_RADIUS) return 1;
    }
    return 0;
  }

  /**
   * Update one gland: if the motor signal is above threshold and the
   * reservoir is non-empty, write `motor × emitRate × dt` units into the
   * field at (x, y) and drain the reservoir by the same amount. Otherwise
   * the reservoir refills passively toward its capacity.
   */
  _updateGland(gland, motorLevel, emitRate, field, x, y, dt) {
    if (motorLevel > CONFIG.GLAND_EMIT_THRESHOLD && gland.current > 0) {
      const demand = motorLevel * emitRate * dt;
      const dose = Math.min(demand, gland.current);
      field.writeAt(x, y, dose);
      gland.current = Math.max(0, gland.current - dose);
    } else {
      gland.current = Math.min(gland.capacity, gland.current + gland.recovery * dt);
    }
  }

  composeSourceOutputs(sensorEnabled, dt, commit = false, sensorDefs = null, sourceOrder = null) {
    const sd = sensorDefs ?? this._sensorDefs ?? [];
    const so = sourceOrder ?? this._sourceOrder ?? SOURCE_ORDER;
    const outputs = this.sampleSensors(sensorEnabled, sd, so);
    if (commit) {
      for (const sensor of sd) {
        this.prevSensorRaw[sensor.id] = outputs[sensor.id] ?? 0;
      }
    }
    // Ant body-internal state — per ant-design-spec.md §3.5.
    // `energy` is the glycogen storage level (1 = full).
    // `damage` fires when the ant is inside a danger plume above threshold.
    outputs.energy = clamp(this.ant.energy / CONFIG.MAX_ENERGY, 0, 1);
    const dangerLevel = this.dangerField.sample(this.ant.x, this.ant.y);
    outputs.damage = clamp((dangerLevel - CONFIG.DANGER_THRESHOLD) / (1 - CONFIG.DANGER_THRESHOLD), 0, 1);
    return outputs;
  }

  previewSourceOutputs(sensorEnabled, dt = CONFIG.FIXED_DT, sensorDefs = null, sourceOrder = null) {
    return this.composeSourceOutputs(sensorEnabled, dt, false, sensorDefs, sourceOrder);
  }

  resolveMotorLevels(motorInputs) {
    return {
      motor_forward: clamp(CONFIG.TONIC_DRIVE + (motorInputs?.motor_forward ?? 0) * CONFIG.SENSOR_GAIN, 0, 1),
      motor_turn_L:  clamp((motorInputs?.motor_turn_L ?? 0) * CONFIG.SENSOR_GAIN, 0, 1),
      motor_turn_R:  clamp((motorInputs?.motor_turn_R ?? 0) * CONFIG.SENSOR_GAIN, 0, 1),
      gland_alpha:   clamp((motorInputs?.gland_alpha  ?? 0) * CONFIG.SENSOR_GAIN, 0, 1),
      gland_beta:    clamp((motorInputs?.gland_beta   ?? 0) * CONFIG.SENSOR_GAIN, 0, 1),
      mandible:      clamp((motorInputs?.mandible     ?? 0) * CONFIG.SENSOR_GAIN, 0, 1),
    };
  }

  step(dt, motorInputs, sensorEnabled, sourceOutputsOverride = null) {
    if (this.dead) return;
    this.alive += dt;

    const motors = this.resolveMotorLevels(motorInputs);

    // Environmental emissions: food sources release ChemA, danger sources ChemD.
    for (const food of this.foods)
      this.fields.chem_A.inject(food.x, food.y, CONFIG.FOOD_EMIT_RATE * dt);
    for (const danger of this.dangers)
      this.fields.chem_D.inject(danger.x, danger.y, CONFIG.DANGER_EMIT_RATE * dt);

    // Ant gland secretions: gland_α → ChemB (ground deposit at the
    // ant's position), gland_β → ChemC (air release from the head).
    // Both draw from their reservoir; empty reservoirs refill passively.
    this._updateGland(this.ant.glandAlpha, motors.gland_alpha, CONFIG.GLAND_ALPHA_EMIT_RATE, this.fields.chem_B, this.ant.x, this.ant.y, dt);
    this._updateGland(this.ant.glandBeta,  motors.gland_beta,  CONFIG.GLAND_BETA_EMIT_RATE,  this.fields.chem_C, this.ant.x, this.ant.y, dt);

    // Diffuse and decay all four fields.
    for (const k of CHEM_KEYS) {
      const p = CHEM_SPECIES[k];
      this.fields[k].update(dt, p.diffusion, p.decay);
    }

    const sourceOutputs = sourceOutputsOverride ?? this.composeSourceOutputs(sensorEnabled, dt, true);
    const sensorOrder = this._sensorOrder ?? SENSOR_ORDER;
    const sensorDrain = sensorOrder.reduce((sum, id) => sum + (sensorEnabled[id] ? Math.abs(sourceOutputs[id] ?? 0) : 0), 0) * CONFIG.SENSOR_ENERGY_COST;
    const { turnRate, turnSigned, thrustLevel } = this.ant.step(dt, motors, this.bodyParams);
    this.turnRate = turnRate;
    const wrapped = this.wrapAntTrail();
    if (!wrapped) this.updateTrail();
    this.ant.energy = Math.max(0, this.ant.energy - (CONFIG.ENERGY_DECAY + thrustLevel * CONFIG.ENERGY_MOTION_COST + sensorDrain) * dt);
    this.consumeFood();
    this.handleDangers(dt);
    this.handleEnergyWarnings();
    this.updateMetrics(sourceOutputs, motors, turnSigned, sensorDrain);
    if (this.ant.energy <= 0) this.handleDeath();
  }

  wrapAntTrail() {
    let wrapped = false;
    if (this.ant.x < 0 || this.ant.x > this.w) {
      this.ant.x = wrapValue(this.ant.x, this.w);
      wrapped = true;
    }
    if (this.ant.y < 0 || this.ant.y > this.h) {
      this.ant.y = wrapValue(this.ant.y, this.h);
      wrapped = true;
    }
    if (wrapped) this.ant.trail.length = 0;
    return wrapped;
  }

  updateTrail() {
    const last = this.ant.trail[this.ant.trail.length - 1];
    if (!last || Math.hypot(this.ant.x - last.x, this.ant.y - last.y) > 0.4) this.ant.trail.push({ x: this.ant.x, y: this.ant.y });
    while (this.ant.trail.length > CONFIG.TRAIL_LENGTH) this.ant.trail.shift();
  }

  consumeFood() {
    for (const food of this.foods) {
      if (Math.hypot(food.x - this.ant.x, food.y - this.ant.y) > CONFIG.FOOD_EAT_RADIUS + food.r) continue;
      const before = Math.round(this.ant.energy);
      this.ant.energy = clamp(this.ant.energy + CONFIG.FOOD_ENERGY, 0, CONFIG.MAX_ENERGY);
      this.foodEaten += 1;
      this.log("food", `吃到食物 #${food.id}，能量 +${Math.round(this.ant.energy - before)} → ${Math.round(this.ant.energy)}`);
      Object.assign(food, respawnPoint(this.w, this.h, CONFIG.FOOD_MARGIN, { x: this.ant.x, y: this.ant.y, radius: 76 }), { phase: randomBetween(0, TAU) });
    }
  }

  handleDangers(dt) {
    const dangerLevel = this.dangerField.sample(this.ant.x, this.ant.y);
    if (dangerLevel > CONFIG.DANGER_THRESHOLD) {
      const damage = (dangerLevel - CONFIG.DANGER_THRESHOLD) * CONFIG.DANGER_DAMAGE_RATE * dt;
      this.ant.energy = Math.max(0, this.ant.energy - damage);
      this.lastDangerTime = this.alive;
      if (!this._dangerLogged || this.alive - this._dangerLogTime > 2) {
        this._dangerLogged = true;
        this._dangerLogTime = this.alive;
        this.log("danger", `进入危险区域，浓度 ${dangerLevel.toFixed(2)}，持续受损`);
      }
    } else {
      this._dangerLogged = false;
    }
  }

  handleEnergyWarnings() {
    if (!this.lowEnergy50Logged && this.ant.energy <= CONFIG.MAX_ENERGY * 0.5) {
      this.lowEnergy50Logged = true;
      this.log("energy", `能量首次低于 50%，当前 ${Math.round(this.ant.energy)}`);
    }
    if (!this.lowEnergy25Logged && this.ant.energy <= CONFIG.MAX_ENERGY * 0.25) {
      this.lowEnergy25Logged = true;
      this.log("energy", `能量首次低于 25%，当前 ${Math.round(this.ant.energy)}`);
    }
  }

  updateMetrics(sourceOutputs, motors, turnSigned, sensorDrain) {
    const maxSpeed = CONFIG.BASE_SPEED * this.bodyParams.speedScale;
    const displayOutputs = {
      ...sourceOutputs,
      energy: clamp(this.ant.energy / CONFIG.MAX_ENERGY, 0, 1),
      damage: sourceOutputs.damage ?? 0,
    };
    this.metrics = {
      sensorOutputs: displayOutputs,
      leftChemA:  displayOutputs.L_chem_A ?? 0,
      rightChemA: displayOutputs.R_chem_A ?? 0,
      leftChemD:  displayOutputs.L_chem_D ?? 0,
      rightChemD: displayOutputs.R_chem_D ?? 0,
      motor_forward: motors.motor_forward,
      motor_turn_L:  motors.motor_turn_L,
      motor_turn_R:  motors.motor_turn_R,
      gland_alpha:   motors.gland_alpha,
      gland_beta:    motors.gland_beta,
      mandible:      motors.mandible,
      speed: clamp(this.ant.speed / (maxSpeed * 1.1), 0, 1),
      energy: clamp(this.ant.energy / CONFIG.MAX_ENERGY, 0, 1),
      turn: clamp(Math.abs(turnSigned) / (CONFIG.TURN_GAIN * this.bodyParams.turnScale * 1.1), 0, 1),
      turnSigned,
      sensorDrain
    };
  }

  handleDeath() {
    this.dead = true;
    this.ant.speed = 0;
    this.deathReason = this.alive - this.lastDangerTime < 1.2 ? "能量耗尽，最后阶段连续撞上危险。" : "能量耗尽，没有及时找到足够食物。";
    this.log("death", `死亡原因：${this.deathReason} 存活 ${this.alive.toFixed(1)}s`);
  }

  /**
   * Serialize world state for save/load (schema v8).
   *
   * Captures ant pose + energy + trail + gland reservoirs, environmental
   * items (foods, dangers), chem fields (base64-encoded raw bytes), and
   * the sim clock. behaviorLog is deliberately ephemeral.
   */
  serializeWorld() {
    return {
      alive: this.alive ?? 0,
      generation: this.generation ?? 1,
      foodEaten: this.foodEaten ?? 0,
      ant: {
        x: this.ant.x,
        y: this.ant.y,
        angle: this.ant.angle,
        energy: this.ant.energy,
        trail: this.ant.trail.map((p) => ({ x: p.x, y: p.y })),
        glandAlpha: { ...this.ant.glandAlpha },
        glandBeta:  { ...this.ant.glandBeta  },
      },
      foods:   this.foods.map((f)   => ({ id: f.id, x: f.x, y: f.y, r: f.r, phase: f.phase })),
      dangers: this.dangers.map((d) => ({ id: d.id, x: d.x, y: d.y, r: d.r, phase: d.phase })),
      fields: {
        chem_A: encodeField(this.fields.chem_A),
        chem_B: encodeField(this.fields.chem_B),
        chem_C: encodeField(this.fields.chem_C),
        chem_D: encodeField(this.fields.chem_D),
      },
    };
  }

  /**
   * Restore world state from a v8 `world` block. Tolerant of missing
   * sub-blocks — leaves the live value in place when a field is absent or
   * malformed. Does NOT call rebuildEnvironment() or warmupFields();
   * restoring a save is supposed to be idempotent. Field dimension
   * mismatches are logged by decodeField and the corresponding live field
   * is left as-is (see io/fields.js comment).
   */
  /**
   * @param {object|null} data
   * @param {(msg: string) => void} [onWarn]  field-mismatch callback; caller
   *   (e.g. import UI) can show the message to the user. console.warn always
   *   fires in addition, regardless of this callback.
   * @returns {string[]} warnings collected (empty on clean restore)
   */
  deserializeWorld(data, onWarn = null) {
    const warnings = [];
    const collect = (msg) => { warnings.push(msg); if (onWarn) onWarn(msg); };
    if (!data || typeof data !== "object") return warnings;

    if (Number.isFinite(data.alive))      this.alive      = data.alive;
    if (Number.isFinite(data.generation)) this.generation = data.generation;
    if (Number.isFinite(data.foodEaten))  this.foodEaten  = data.foodEaten;

    if (data.ant && typeof data.ant === "object") {
      const a = data.ant;
      if (Number.isFinite(a.x))      this.ant.x      = a.x;
      if (Number.isFinite(a.y))      this.ant.y      = a.y;
      if (Number.isFinite(a.angle))  this.ant.angle  = a.angle;
      if (Number.isFinite(a.energy)) this.ant.energy = a.energy;
      if (Array.isArray(a.trail)) {
        this.ant.trail = a.trail
          .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
          .map((p) => ({ x: p.x, y: p.y }));
      }
      if (a.glandAlpha) {
        for (const k of ["current", "capacity", "recovery"]) {
          if (Number.isFinite(a.glandAlpha[k])) this.ant.glandAlpha[k] = a.glandAlpha[k];
        }
      }
      if (a.glandBeta) {
        for (const k of ["current", "capacity", "recovery"]) {
          if (Number.isFinite(a.glandBeta[k])) this.ant.glandBeta[k] = a.glandBeta[k];
        }
      }
    }

    if (Array.isArray(data.foods)) {
      this.foods = data.foods.map((f, i) => ({
        id:    Number.isFinite(f?.id)    ? f.id    : i + 1,
        x:     Number.isFinite(f?.x)     ? f.x     : this.w * 0.5,
        y:     Number.isFinite(f?.y)     ? f.y     : this.h * 0.5,
        r:     Number.isFinite(f?.r)     ? f.r     : 6,
        phase: Number.isFinite(f?.phase) ? f.phase : 0,
      }));
      // Keep environmentState in sync so the topbar slider reflects the
      // restored density and applyEnvironment()/restart() behave sensibly.
      this.environmentState.foodDensity = this.foods.length;
    }
    if (Array.isArray(data.dangers)) {
      this.dangers = data.dangers.map((d, i) => ({
        id:    Number.isFinite(d?.id)    ? d.id    : i + 1,
        x:     Number.isFinite(d?.x)     ? d.x     : this.w * 0.5,
        y:     Number.isFinite(d?.y)     ? d.y     : this.h * 0.5,
        r:     Number.isFinite(d?.r)     ? d.r     : 8,
        phase: Number.isFinite(d?.phase) ? d.phase : 0,
      }));
      this.environmentState.dangerDensity = this.dangers.length;
    }

    if (data.fields && typeof data.fields === "object") {
      for (const k of CHEM_KEYS) {
        if (data.fields[k]) decodeField(data.fields[k], this.fields[k], collect);
      }
    }
    return warnings;
  }
}
