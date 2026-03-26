import { CONFIG, SENSOR_BY_ID, SENSOR_DEFINITIONS, SENSOR_HALF_ANGLE, SENSOR_ORDER, SOURCE_ORDER } from "./config.js";
import { clamp, normAngle, randomBetween, respawnPoint, TAU, wrapValue } from "./math.js";

export function createMetrics() {
  return {
    sensorOutputs: Object.fromEntries(SOURCE_ORDER.map((id) => [id, 0])),
    leftEye: 0,
    rightEye: 0,
    leftThreat: 0,
    rightThreat: 0,
    leftLeg: 0,
    rightLeg: 0,
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
    this.foods = [];
    this.dangers = [];
    this.metrics = createMetrics();
    this.noiseFrequency = 0.5;
    this.reset();
  }

  setSize(width, height) {
    this.w = Math.max(320, width);
    this.h = Math.max(240, height);
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
  }

  reset({ incrementGeneration = false } = {}) {
    if (incrementGeneration) this.generation += 1;
    this.behaviorLog.length = 0;
    this.alive = 0;
    this.foodEaten = 0;
    this.dead = false;
    this.lowEnergy50Logged = false;
    this.lowEnergy25Logged = false;
    this.dangerCooldown = 0;
    this.lastDangerTime = -999;
    this.deathReason = "";
    this.turnRate = 0;
    this.prevSensorRaw = Object.fromEntries(SENSOR_ORDER.map((id) => [id, 0]));
    this.noiseTimer = 0;
    this.noisePulseRemaining = 0;
    this.noiseOutput = 0;
    this.ant = { x: this.w * 0.5, y: this.h * 0.55, angle: -Math.PI / 2 + randomBetween(-0.2, 0.2), speed: 0, energy: CONFIG.MAX_ENERGY, trail: [] };
    this.metrics = createMetrics();
    this.rebuildEnvironment();
  }

  setNoiseFrequency(value) {
    this.noiseFrequency = clamp(value, 0.1, 3);
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

  sampleSensor(stimuli, range, sensorAngle) {
    let total = 0;
    for (const stimulus of stimuli) {
      const dx = stimulus.x - this.ant.x;
      const dy = stimulus.y - this.ant.y;
      const dist = Math.hypot(dx, dy);
      if (!dist || dist > range) continue;
      const relative = normAngle(Math.atan2(dy, dx) - this.ant.angle);
      const offset = Math.abs(normAngle(relative - sensorAngle));
      if (offset > SENSOR_HALF_ANGLE) continue;
      total += Math.pow(1 - dist / range, 1.65) * Math.pow(1 - offset / SENSOR_HALF_ANGLE, 1.8) * 1.1;
    }
    return clamp(total, 0, 1);
  }

  sampleSensors(sensorEnabled) {
    const outputs = Object.fromEntries(SOURCE_ORDER.map((id) => [id, 0]));
    for (const sensor of SENSOR_DEFINITIONS) {
      if (!sensorEnabled[sensor.id]) continue;
      const stimuli = sensor.kind === "food" ? this.foods : this.dangers;
      const range = sensor.kind === "food" ? CONFIG.FOOD_SENSE_RANGE : CONFIG.DANGER_SENSE_RANGE;
      outputs[sensor.id] = this.sampleSensor(stimuli, range, sensor.angle);
    }
    return outputs;
  }

  applySensorModes(rawOutputs, dt, sensorModes, commit = false) {
    const outputs = { ...rawOutputs };
    const safeDt = Math.max(dt, 1e-4);
    for (const sensor of SENSOR_DEFINITIONS) {
      const current = rawOutputs[sensor.id] ?? 0;
      if (sensorModes[sensor.id] === "diff") outputs[sensor.id] = clamp(((current - (this.prevSensorRaw[sensor.id] ?? 0)) / safeDt) / CONFIG.MAX_DIFF, -1, 1);
      if (commit) this.prevSensorRaw[sensor.id] = current;
    }
    return outputs;
  }

  stepNoise(dt, commit = false) {
    if (!commit) return this.noiseOutput;
    const period = 1 / Math.max(this.noiseFrequency, 0.1);
    this.noiseTimer += dt;
    while (this.noiseTimer >= period) {
      this.noiseTimer -= period;
      if (Math.random() < 0.5) this.noisePulseRemaining = Math.max(this.noisePulseRemaining, 0.1);
    }
    const active = this.noisePulseRemaining > 0;
    if (active) this.noisePulseRemaining = Math.max(0, this.noisePulseRemaining - dt);
    this.noiseOutput = active ? 1 : 0;
    return this.noiseOutput;
  }

  composeSourceOutputs(sensorEnabled, sensorModes, dt, commit = false) {
    const outputs = this.applySensorModes(this.sampleSensors(sensorEnabled), dt, sensorModes, commit);
    outputs.P_turn = clamp(this.turnRate / CONFIG.MAX_TURN_RATE, 0, 1);
    outputs.P_speed = clamp(this.ant.speed / CONFIG.BASE_SPEED, 0, 1);
    outputs.N_noise = this.stepNoise(dt, commit);
    return outputs;
  }

  previewSourceOutputs(sensorEnabled, sensorModes, dt = CONFIG.FIXED_DT) {
    return this.composeSourceOutputs(sensorEnabled, sensorModes, dt, false);
  }

  resolveMotorLevels(motorInputs) {
    return {
      leftLeg: clamp(CONFIG.TONIC_DRIVE + (motorInputs?.leftLeg ?? 0) * CONFIG.SENSOR_GAIN, 0, 1),
      rightLeg: clamp(CONFIG.TONIC_DRIVE + (motorInputs?.rightLeg ?? 0) * CONFIG.SENSOR_GAIN, 0, 1)
    };
  }

  step(dt, motorInputs, sensorEnabled, sensorModes, sourceOutputsOverride = null) {
    if (this.dead) return;
    this.alive += dt;
    if (this.dangerCooldown > 0) this.dangerCooldown = Math.max(0, this.dangerCooldown - dt);
    const sourceOutputs = sourceOutputsOverride ?? this.composeSourceOutputs(sensorEnabled, sensorModes, dt, true);
    const sensorDrain = SENSOR_ORDER.reduce((sum, id) => sum + (sensorEnabled[id] ? Math.abs(sourceOutputs[id] ?? 0) : 0), 0) * CONFIG.SENSOR_ENERGY_COST;
    const motors = this.resolveMotorLevels(motorInputs);
    const averageMotor = (motors.leftLeg + motors.rightLeg) * 0.5;
    const turnSigned = (motors.leftLeg - motors.rightLeg) * CONFIG.TURN_GAIN;
    const previousAngle = this.ant.angle;
    this.ant.speed = CONFIG.BASE_SPEED * averageMotor;
    this.ant.angle = normAngle(this.ant.angle + turnSigned * dt);
    this.turnRate = Math.abs(normAngle(this.ant.angle - previousAngle)) / Math.max(dt, 1e-4);
    this.ant.x += Math.cos(this.ant.angle) * this.ant.speed * dt;
    this.ant.y += Math.sin(this.ant.angle) * this.ant.speed * dt;
    const wrapped = this.wrapAntTrail();
    if (!wrapped) this.updateTrail();
    this.ant.energy = Math.max(0, this.ant.energy - (CONFIG.ENERGY_DECAY + averageMotor * CONFIG.ENERGY_MOTION_COST + sensorDrain) * dt);
    this.consumeFood();
    this.handleDangers();
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

  handleDangers() {
    for (const danger of this.dangers) {
      if (Math.hypot(danger.x - this.ant.x, danger.y - this.ant.y) > CONFIG.DANGER_RADIUS + danger.r || this.dangerCooldown > 0) continue;
      this.dangerCooldown = CONFIG.DANGER_COOLDOWN;
      this.lastDangerTime = this.alive;
      this.ant.energy = Math.max(0, this.ant.energy - CONFIG.DANGER_DAMAGE);
      this.log("danger", `接触危险 #${danger.id}，能量 -${CONFIG.DANGER_DAMAGE} → ${Math.round(this.ant.energy)}`);
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
    const displayOutputs = { ...sourceOutputs, P_turn: clamp(this.turnRate / CONFIG.MAX_TURN_RATE, 0, 1), P_speed: clamp(this.ant.speed / CONFIG.BASE_SPEED, 0, 1), N_noise: this.noiseOutput };
    this.metrics = {
      sensorOutputs: displayOutputs,
      leftEye: Math.max(displayOutputs.F0 ?? 0, displayOutputs.F5 ?? 0),
      rightEye: Math.max(displayOutputs.F0 ?? 0, displayOutputs.F1 ?? 0),
      leftThreat: Math.max(displayOutputs.T0 ?? 0, displayOutputs.T5 ?? 0),
      rightThreat: Math.max(displayOutputs.T0 ?? 0, displayOutputs.T1 ?? 0),
      leftLeg: motors.leftLeg,
      rightLeg: motors.rightLeg,
      speed: clamp(this.ant.speed / (CONFIG.BASE_SPEED * 1.1), 0, 1),
      energy: clamp(this.ant.energy / CONFIG.MAX_ENERGY, 0, 1),
      turn: clamp(Math.abs(turnSigned) / (CONFIG.TURN_GAIN * 1.1), 0, 1),
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
}
