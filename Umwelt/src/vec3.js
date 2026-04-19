export class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  clone() {
    return new Vec3(this.x, this.y, this.z);
  }

  add(v) {
    return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  sub(v) {
    return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  scale(s) {
    return new Vec3(this.x * s, this.y * s, this.z * s);
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v) {
    return new Vec3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length() {
    return Math.sqrt(this.lengthSq());
  }

  normalize() {
    const len = this.length();
    return len < 1e-10 ? new Vec3(0, 0, 0) : this.scale(1 / len);
  }

  /** Rodrigues rotation: rotate this vector around `axis` by `angle` radians. */
  rotateAround(axis, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const k = axis;
    // v' = v·cos θ + (k × v)·sin θ + k·(k·v)·(1 − cos θ)
    return this.scale(c)
      .add(k.cross(this).scale(s))
      .add(k.scale(k.dot(this) * (1 - c)));
  }
}
