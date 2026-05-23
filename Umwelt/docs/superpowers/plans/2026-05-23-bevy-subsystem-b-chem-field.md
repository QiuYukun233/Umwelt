# Bevy 子系统 B — 化学场仿真器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在新独立 git 仓库 `umwelt-bevy/` 中交付子系统 B(化学场仿真器),实现 spec v2 §5.2 的可扩展标量场 schema,MVP 仅支持化学点源(Σ 组合)+ 单 phase;同时把 spec §7.4 标注的 HTML `edge.attenuation` 配套小改动一并排期。

**Architecture:**
- 新独立 git 仓 `umwelt-bevy/`(spec §8 #8 已决),Cargo 工作区。
- 工作区首个 crate `chem_field/`:`src/core/` 模块为纯 Rust 仿真核心(零 Bevy 依赖),`src/plugin.rs` 是把核心挂到 Bevy 的薄壳,`src/debug_viz.rs` 是体素 gizmo 调试可视化。
- 每个 channel 的 `Field` 持有一组 `Box<dyn Contributor>` + 一个 `CombineOp`(Sum 给化学;Min 为未来几何距离场预留)。MVP 只发一种 contributor:`ChemicalPointSource`,高斯空间剖面、σ(t)=√(σ₀²+2Dt) 扩散展宽、振幅 exp(−volatility·t) 挥发衰减。
- Phase 外壳:`PhaseSchedule` 持一组有序 `Phase { duration, evolving, contributors_by_channel }`;`ChemFieldScene` 持调度 + 当前 phase 索引 + elapsed,`sample(channel, pos)` 路由到当前 phase 的对应 field,`step(dt)` 仅在 `evolving` 时推进 contributor 时间。MVP 用单 phase。
- 最后一项任务是 Umwelt 仓内的 HTML 配套:`edge.attenuation`(每边一个乘子,evaluator 乘进去,schema 升 v11)。

**Tech Stack:** Rust 2024、Bevy 0.15、`cargo test`、`cargo run --example`(目视验证 3D 场)。HTML 任务沿用现有 Vite + vanilla JS 栈。

---

## File Structure

新仓 `umwelt-bevy/`:
```
umwelt-bevy/
├─ Cargo.toml                     # workspace
├─ .gitignore
├─ README.md
└─ crates/
   └─ chem_field/
      ├─ Cargo.toml
      ├─ src/
      │  ├─ lib.rs                # 重导出 + 模块声明
      │  ├─ core/
      │  │  ├─ mod.rs
      │  │  ├─ channel.rs         # Channel, CombineOp
      │  │  ├─ contributor.rs     # Contributor trait + ChemicalPointSource
      │  │  ├─ field.rs           # Field<C>
      │  │  ├─ phase.rs           # Phase, PhaseSchedule
      │  │  └─ scene.rs           # ChemFieldScene
      │  ├─ plugin.rs             # Bevy 壳
      │  └─ debug_viz.rs          # 体素 gizmo
      ├─ tests/
      │  └─ sampling.rs           # 集成测试
      └─ examples/
         ├─ static_single_source.rs
         └─ evolving_dual_source.rs
```

Umwelt 仓改动(Task 10):
- Modify: `src/neural/graph.js`(edge attenuation 默认值 + 序列化)
- Modify: `src/neural/evaluator.js`(信号传递时乘 attenuation)
- Modify: `src/persistence/module-format.js`(schema v10 → v11)
- Modify: `tests/neural/evaluator.test.js`(若存在;否则新建)
- Modify: `docs/worklog.md`

---

## Task 1: Bootstrap 独立仓 + 工作区 + chem_field crate 骨架

**Files:**
- Create: `D:/dev/umwelt-bevy/.gitignore`
- Create: `D:/dev/umwelt-bevy/Cargo.toml`
- Create: `D:/dev/umwelt-bevy/README.md`
- Create: `D:/dev/umwelt-bevy/crates/chem_field/Cargo.toml`
- Create: `D:/dev/umwelt-bevy/crates/chem_field/src/lib.rs`

- [ ] **Step 1: 在 `D:/dev/umwelt-bevy/` 建仓与工作区**

```powershell
mkdir D:/dev/umwelt-bevy
cd D:/dev/umwelt-bevy
git init
mkdir crates
```

- [ ] **Step 2: 写 workspace `Cargo.toml`**

`D:/dev/umwelt-bevy/Cargo.toml`:
```toml
[workspace]
resolver = "2"
members = ["crates/*"]

[workspace.package]
edition = "2024"
version = "0.1.0"
license = "MIT OR Apache-2.0"

[workspace.dependencies]
bevy = { version = "0.15", default-features = false, features = ["bevy_render", "bevy_pbr", "bevy_gizmos", "bevy_winit", "x11", "wayland", "tonemapping_luts", "ktx2", "zstd"] }
glam = "0.29"
```

(若 host 是 Windows:可省 x11/wayland feature。)

- [ ] **Step 3: 写 `.gitignore` + 简短 README**

`.gitignore`:
```
/target
**/*.rs.bk
*.pdb
.idea/
.vscode/
```

`README.md`:
```markdown
# umwelt-bevy

Bevy-side workshop for Umwelt. See parent project `D:/dev/Umwelt/docs/superpowers/specs/2026-05-22-bevy-workshop-grid-substrate-design.md` for design.

Crates:
- `chem_field` — subsystem B: extensible scalar field simulator.
```

- [ ] **Step 4: 建 chem_field crate**

```powershell
cd D:/dev/umwelt-bevy
cargo new --lib crates/chem_field
```

替换 `crates/chem_field/Cargo.toml`:
```toml
[package]
name = "chem_field"
edition.workspace = true
version.workspace = true
license.workspace = true

[dependencies]
bevy = { workspace = true }
glam = { workspace = true }

[dev-dependencies]
approx = "0.5"
```

- [ ] **Step 5: 写最小 lib.rs + 编译验证**

`crates/chem_field/src/lib.rs`:
```rust
pub mod core;
pub mod plugin;
pub mod debug_viz;
```

(占位空模块,后续任务填。)

`crates/chem_field/src/core/mod.rs`:
```rust
pub mod channel;
pub mod contributor;
pub mod field;
pub mod phase;
pub mod scene;
```

留 `plugin.rs` 与 `debug_viz.rs` 为空 `pub fn _placeholder() {}` 占位。

Run: `cargo check -p chem_field`
Expected: 编译通过(因模块文件未建,会报 unresolved module;在该步建空模块文件)。

补建 `src/core/{channel,contributor,field,phase,scene}.rs` 都写 `// placeholder`;`src/plugin.rs`、`src/debug_viz.rs` 同样。

Re-run `cargo check -p chem_field`,通过。

- [ ] **Step 6: Commit**

```powershell
cd D:/dev/umwelt-bevy
git add .
git commit -m "chore: bootstrap umwelt-bevy workspace + chem_field crate skeleton"
```

---

## Task 2: Channel + CombineOp 类型

**Files:**
- Modify: `crates/chem_field/src/core/channel.rs`
- Test: 在同一文件内 `#[cfg(test)] mod tests`

- [ ] **Step 1: 写失败测试**

`crates/chem_field/src/core/channel.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chem_channels_use_sum_combine() {
        assert_eq!(Channel::ChemA.combine_op(), CombineOp::Sum);
        assert_eq!(Channel::ChemB.combine_op(), CombineOp::Sum);
        assert_eq!(Channel::ChemC.combine_op(), CombineOp::Sum);
        assert_eq!(Channel::ChemD.combine_op(), CombineOp::Sum);
    }

    #[test]
    fn geometry_distance_channel_uses_min_combine() {
        assert_eq!(Channel::GeometryDistance.combine_op(), CombineOp::Min);
    }
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cargo test -p chem_field channel`
Expected: FAIL — `Channel`、`CombineOp` 未定义。

- [ ] **Step 3: 写最小实现**

`crates/chem_field/src/core/channel.rs`(替换占位):
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Channel {
    ChemA,
    ChemB,
    ChemC,
    ChemD,
    GeometryDistance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombineOp {
    Sum,
    Min,
}

impl Channel {
    pub fn combine_op(self) -> CombineOp {
        match self {
            Channel::ChemA | Channel::ChemB | Channel::ChemC | Channel::ChemD => CombineOp::Sum,
            Channel::GeometryDistance => CombineOp::Min,
        }
    }
}

#[cfg(test)]
mod tests { /* 上面的两个测试,完整粘贴 */ }
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cargo test -p chem_field channel`
Expected: PASS(2 个测试)。

- [ ] **Step 5: Commit**

```powershell
git add crates/chem_field/src/core/channel.rs
git commit -m "feat(chem_field): Channel + CombineOp types"
```

---

## Task 3: Contributor trait + ChemicalPointSource

**Files:**
- Modify: `crates/chem_field/src/core/contributor.rs`

`ChemicalPointSource` 数学:
- 振幅 `a(t) = strength_0 * exp(-volatility * t)`
- 标准差 `σ(t) = sqrt(σ_0² + 2 * D * t)`
- 在点 r 的贡献 `c(r, t) = a(t) * exp(-‖r - position‖² / (2 * σ(t)²))`

Stage 1(static)= 时间冻结在 t=0:`a = strength_0`,`σ = σ_0`,与"evolving=false"语义自然一致。

- [ ] **Step 1: 写失败测试**

`crates/chem_field/src/core/contributor.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use glam::Vec3;

    #[test]
    fn point_source_sample_at_center_returns_strength() {
        let src = ChemicalPointSource::new(Vec3::ZERO, 1.0, 1.0, 0.0, 0.0);
        assert_relative_eq!(src.sample(Vec3::ZERO), 1.0, epsilon = 1e-6);
    }

    #[test]
    fn point_source_sample_decays_with_distance() {
        let src = ChemicalPointSource::new(Vec3::ZERO, 1.0, 1.0, 0.0, 0.0);
        // 距 1σ:exp(-0.5)
        let v = src.sample(Vec3::new(1.0, 0.0, 0.0));
        assert_relative_eq!(v, (-0.5_f32).exp(), epsilon = 1e-6);
    }

    #[test]
    fn point_source_amplitude_decays_with_time() {
        let mut src = ChemicalPointSource::new(Vec3::ZERO, 1.0, 1.0, 0.0, 0.5);
        src.step(2.0);
        // a = exp(-0.5 * 2) = exp(-1)
        assert_relative_eq!(src.sample(Vec3::ZERO), (-1.0_f32).exp(), epsilon = 1e-6);
    }

    #[test]
    fn point_source_sigma_grows_with_diffusion() {
        let mut src = ChemicalPointSource::new(Vec3::ZERO, 1.0, 1.0, 0.5, 0.0);
        src.step(1.5);
        // σ² = 1 + 2 * 0.5 * 1.5 = 2.5
        let r = 1.0;
        let expected = (-(r * r) / (2.0 * 2.5_f32)).exp();
        assert_relative_eq!(src.sample(Vec3::new(r, 0.0, 0.0)), expected, epsilon = 1e-6);
    }

    #[test]
    fn point_source_combine_op_is_sum() {
        let src = ChemicalPointSource::new(Vec3::ZERO, 1.0, 1.0, 0.0, 0.0);
        assert_eq!(src.combine_op(), CombineOp::Sum);
    }
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cargo test -p chem_field contributor`
Expected: FAIL — `Contributor`、`ChemicalPointSource` 未定义。

- [ ] **Step 3: 写最小实现**

`crates/chem_field/src/core/contributor.rs`(替换占位):
```rust
use crate::core::channel::CombineOp;
use glam::Vec3;

pub trait Contributor: Send + Sync {
    fn sample(&self, pos: Vec3) -> f32;
    fn step(&mut self, dt: f32);
    fn combine_op(&self) -> CombineOp;
}

pub struct ChemicalPointSource {
    pub position: Vec3,
    pub strength_0: f32,
    pub sigma_0: f32,
    pub diffusion_d: f32,
    pub volatility: f32,
    pub t_elapsed: f32,
}

impl ChemicalPointSource {
    pub fn new(position: Vec3, strength_0: f32, sigma_0: f32, diffusion_d: f32, volatility: f32) -> Self {
        Self {
            position,
            strength_0,
            sigma_0,
            diffusion_d,
            volatility,
            t_elapsed: 0.0,
        }
    }

    fn current_amplitude(&self) -> f32 {
        self.strength_0 * (-self.volatility * self.t_elapsed).exp()
    }

    fn current_sigma_sq(&self) -> f32 {
        self.sigma_0 * self.sigma_0 + 2.0 * self.diffusion_d * self.t_elapsed
    }
}

impl Contributor for ChemicalPointSource {
    fn sample(&self, pos: Vec3) -> f32 {
        let r_sq = (pos - self.position).length_squared();
        let sigma_sq = self.current_sigma_sq();
        self.current_amplitude() * (-r_sq / (2.0 * sigma_sq)).exp()
    }

    fn step(&mut self, dt: f32) {
        self.t_elapsed += dt;
    }

    fn combine_op(&self) -> CombineOp {
        CombineOp::Sum
    }
}

#[cfg(test)]
mod tests { /* 上面 5 个测试,完整粘贴 */ }
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cargo test -p chem_field contributor`
Expected: PASS(5 个测试)。

- [ ] **Step 5: Commit**

```powershell
git add crates/chem_field/src/core/contributor.rs
git commit -m "feat(chem_field): Contributor trait + ChemicalPointSource with diffusion/volatility"
```

---

## Task 4: Field<C> 聚合 contributor

**Files:**
- Modify: `crates/chem_field/src/core/field.rs`

- [ ] **Step 1: 写失败测试**

`crates/chem_field/src/core/field.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::channel::{Channel, CombineOp};
    use crate::core::contributor::ChemicalPointSource;
    use approx::assert_relative_eq;
    use glam::Vec3;

    #[test]
    fn empty_sum_field_samples_zero() {
        let f = Field::new(CombineOp::Sum);
        assert_relative_eq!(f.sample(Vec3::ZERO), 0.0, epsilon = 1e-6);
    }

    #[test]
    fn empty_min_field_samples_positive_infinity() {
        let f = Field::new(CombineOp::Min);
        assert!(f.sample(Vec3::ZERO).is_infinite() && f.sample(Vec3::ZERO) > 0.0);
    }

    #[test]
    fn sum_field_adds_two_point_sources() {
        let mut f = Field::new(CombineOp::Sum);
        f.add_contributor(Box::new(ChemicalPointSource::new(Vec3::ZERO, 1.0, 1.0, 0.0, 0.0)));
        f.add_contributor(Box::new(ChemicalPointSource::new(Vec3::new(2.0, 0.0, 0.0), 1.0, 1.0, 0.0, 0.0)));
        // 在 x=1 处,两个源各贡献 exp(-0.5),和应为 2 * exp(-0.5)
        let v = f.sample(Vec3::new(1.0, 0.0, 0.0));
        assert_relative_eq!(v, 2.0 * (-0.5_f32).exp(), epsilon = 1e-6);
    }

    #[test]
    fn field_step_advances_all_contributors() {
        let mut f = Field::new(CombineOp::Sum);
        f.add_contributor(Box::new(ChemicalPointSource::new(Vec3::ZERO, 1.0, 1.0, 0.0, 0.5)));
        f.step(2.0);
        assert_relative_eq!(f.sample(Vec3::ZERO), (-1.0_f32).exp(), epsilon = 1e-6);
    }

    #[test]
    fn channel_field_factory_uses_correct_combine_op() {
        let f = Field::for_channel(Channel::ChemA);
        assert_eq!(f.combine_op(), CombineOp::Sum);
        let g = Field::for_channel(Channel::GeometryDistance);
        assert_eq!(g.combine_op(), CombineOp::Min);
    }
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cargo test -p chem_field field`
Expected: FAIL — `Field` 未定义。

- [ ] **Step 3: 写最小实现**

`crates/chem_field/src/core/field.rs`(替换占位):
```rust
use crate::core::channel::{Channel, CombineOp};
use crate::core::contributor::Contributor;
use glam::Vec3;

pub struct Field {
    combine_op: CombineOp,
    contributors: Vec<Box<dyn Contributor>>,
}

impl Field {
    pub fn new(combine_op: CombineOp) -> Self {
        Self { combine_op, contributors: Vec::new() }
    }

    pub fn for_channel(channel: Channel) -> Self {
        Self::new(channel.combine_op())
    }

    pub fn add_contributor(&mut self, c: Box<dyn Contributor>) {
        self.contributors.push(c);
    }

    pub fn combine_op(&self) -> CombineOp {
        self.combine_op
    }

    pub fn sample(&self, pos: Vec3) -> f32 {
        match self.combine_op {
            CombineOp::Sum => self.contributors.iter().map(|c| c.sample(pos)).sum(),
            CombineOp::Min => self.contributors
                .iter()
                .map(|c| c.sample(pos))
                .fold(f32::INFINITY, f32::min),
        }
    }

    pub fn step(&mut self, dt: f32) {
        for c in &mut self.contributors {
            c.step(dt);
        }
    }
}

#[cfg(test)]
mod tests { /* 上面 5 个测试,完整粘贴 */ }
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cargo test -p chem_field field`
Expected: PASS(5 个测试)。

- [ ] **Step 5: Commit**

```powershell
git add crates/chem_field/src/core/field.rs
git commit -m "feat(chem_field): Field aggregating contributors with Sum/Min combine"
```

---

## Task 5: Phase + PhaseSchedule

**Files:**
- Modify: `crates/chem_field/src/core/phase.rs`

`Phase` 持每 channel 的初始 contributor 集 + duration + evolving 标志。`PhaseSchedule` 把它们排成序。MVP 用单 phase。

- [ ] **Step 1: 写失败测试**

`crates/chem_field/src/core/phase.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_starts_at_first_phase() {
        let sched = PhaseSchedule::new(vec![
            PhaseSpec { duration: 1.0, evolving: false },
            PhaseSpec { duration: 2.0, evolving: true },
        ]);
        assert_eq!(sched.current_index(), 0);
        assert_eq!(sched.elapsed_in_phase(), 0.0);
    }

    #[test]
    fn schedule_advances_phase_when_duration_elapses() {
        let mut sched = PhaseSchedule::new(vec![
            PhaseSpec { duration: 1.0, evolving: false },
            PhaseSpec { duration: 2.0, evolving: true },
        ]);
        sched.advance(0.5);
        assert_eq!(sched.current_index(), 0);
        sched.advance(0.6);
        assert_eq!(sched.current_index(), 1);
        // 多余的 0.1 进入 phase 1
        assert!((sched.elapsed_in_phase() - 0.1).abs() < 1e-6);
    }

    #[test]
    fn schedule_clamps_at_final_phase() {
        let mut sched = PhaseSchedule::new(vec![
            PhaseSpec { duration: 1.0, evolving: true },
        ]);
        sched.advance(5.0);
        assert_eq!(sched.current_index(), 0);
        assert!(sched.is_finished());
    }

    #[test]
    fn single_phase_mvp_works() {
        let sched = PhaseSchedule::new(vec![
            PhaseSpec { duration: f32::INFINITY, evolving: true },
        ]);
        assert_eq!(sched.current_phase().evolving, true);
    }
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cargo test -p chem_field phase`
Expected: FAIL — 类型未定义。

- [ ] **Step 3: 写最小实现**

`crates/chem_field/src/core/phase.rs`(替换占位):
```rust
#[derive(Debug, Clone, Copy)]
pub struct PhaseSpec {
    pub duration: f32,
    pub evolving: bool,
}

pub struct PhaseSchedule {
    phases: Vec<PhaseSpec>,
    index: usize,
    elapsed_in_phase: f32,
}

impl PhaseSchedule {
    pub fn new(phases: Vec<PhaseSpec>) -> Self {
        assert!(!phases.is_empty(), "PhaseSchedule needs at least one phase");
        Self { phases, index: 0, elapsed_in_phase: 0.0 }
    }

    pub fn current_index(&self) -> usize { self.index }
    pub fn elapsed_in_phase(&self) -> f32 { self.elapsed_in_phase }
    pub fn current_phase(&self) -> PhaseSpec { self.phases[self.index] }

    pub fn is_finished(&self) -> bool {
        self.index == self.phases.len() - 1
            && self.elapsed_in_phase >= self.phases[self.index].duration
    }

    pub fn advance(&mut self, dt: f32) {
        let mut remaining = dt;
        while remaining > 0.0 && self.index < self.phases.len() {
            let phase = self.phases[self.index];
            let left = phase.duration - self.elapsed_in_phase;
            if remaining < left {
                self.elapsed_in_phase += remaining;
                return;
            }
            remaining -= left;
            if self.index + 1 < self.phases.len() {
                self.index += 1;
                self.elapsed_in_phase = 0.0;
            } else {
                self.elapsed_in_phase = phase.duration;
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests { /* 上面 4 个测试,完整粘贴 */ }
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cargo test -p chem_field phase`
Expected: PASS(4 个测试)。

- [ ] **Step 5: Commit**

```powershell
git add crates/chem_field/src/core/phase.rs
git commit -m "feat(chem_field): PhaseSchedule with evolving flag per phase"
```

---

## Task 6: ChemFieldScene 串起 multi-channel + schedule

**Files:**
- Modify: `crates/chem_field/src/core/scene.rs`

Scene 持:每 phase 一组 per-channel field、当前 phase 索引、`sample(channel, pos)`、`step(dt)`(仅当 current_phase.evolving 时才 step contributors)。

- [ ] **Step 1: 写失败测试**

`crates/chem_field/src/core/scene.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::channel::Channel;
    use crate::core::contributor::ChemicalPointSource;
    use crate::core::phase::PhaseSpec;
    use approx::assert_relative_eq;
    use glam::Vec3;

    fn make_single_phase_static_scene() -> ChemFieldScene {
        let mut builder = SceneBuilder::new();
        builder.add_phase(PhaseSpec { duration: f32::INFINITY, evolving: false });
        builder.add_contributor(0, Channel::ChemA,
            Box::new(ChemicalPointSource::new(Vec3::ZERO, 1.0, 1.0, 0.0, 0.5)));
        builder.build()
    }

    #[test]
    fn scene_samples_active_channel() {
        let scene = make_single_phase_static_scene();
        assert_relative_eq!(scene.sample(Channel::ChemA, Vec3::ZERO), 1.0, epsilon = 1e-6);
        assert_relative_eq!(scene.sample(Channel::ChemB, Vec3::ZERO), 0.0, epsilon = 1e-6);
    }

    #[test]
    fn static_phase_does_not_evolve_contributors() {
        let mut scene = make_single_phase_static_scene();
        scene.step(10.0);  // 即便 step 了,evolving=false,振幅不变
        assert_relative_eq!(scene.sample(Channel::ChemA, Vec3::ZERO), 1.0, epsilon = 1e-6);
    }

    #[test]
    fn evolving_phase_advances_contributors() {
        let mut builder = SceneBuilder::new();
        builder.add_phase(PhaseSpec { duration: f32::INFINITY, evolving: true });
        builder.add_contributor(0, Channel::ChemA,
            Box::new(ChemicalPointSource::new(Vec3::ZERO, 1.0, 1.0, 0.0, 0.5)));
        let mut scene = builder.build();
        scene.step(2.0);
        // a(2) = exp(-1)
        assert_relative_eq!(scene.sample(Channel::ChemA, Vec3::ZERO), (-1.0_f32).exp(), epsilon = 1e-6);
    }

    #[test]
    fn scene_routes_to_current_phase_field() {
        let mut builder = SceneBuilder::new();
        builder.add_phase(PhaseSpec { duration: 1.0, evolving: false });
        builder.add_phase(PhaseSpec { duration: f32::INFINITY, evolving: false });
        builder.add_contributor(0, Channel::ChemA,
            Box::new(ChemicalPointSource::new(Vec3::ZERO, 1.0, 1.0, 0.0, 0.0)));
        builder.add_contributor(1, Channel::ChemA,
            Box::new(ChemicalPointSource::new(Vec3::ZERO, 2.0, 1.0, 0.0, 0.0)));
        let mut scene = builder.build();
        assert_relative_eq!(scene.sample(Channel::ChemA, Vec3::ZERO), 1.0, epsilon = 1e-6);
        scene.step(1.5);
        assert_relative_eq!(scene.sample(Channel::ChemA, Vec3::ZERO), 2.0, epsilon = 1e-6);
    }
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cargo test -p chem_field scene`
Expected: FAIL — 类型未定义。

- [ ] **Step 3: 写最小实现**

`crates/chem_field/src/core/scene.rs`:
```rust
use crate::core::channel::Channel;
use crate::core::contributor::Contributor;
use crate::core::field::Field;
use crate::core::phase::{PhaseSchedule, PhaseSpec};
use glam::Vec3;
use std::collections::HashMap;

pub struct ChemFieldScene {
    schedule: PhaseSchedule,
    fields_per_phase: Vec<HashMap<Channel, Field>>,
}

impl ChemFieldScene {
    pub fn sample(&self, channel: Channel, pos: Vec3) -> f32 {
        let idx = self.schedule.current_index();
        self.fields_per_phase[idx]
            .get(&channel)
            .map(|f| f.sample(pos))
            .unwrap_or(0.0)
    }

    pub fn step(&mut self, dt: f32) {
        let phase = self.schedule.current_phase();
        if phase.evolving {
            let idx = self.schedule.current_index();
            if let Some(map) = self.fields_per_phase.get_mut(idx) {
                for field in map.values_mut() {
                    field.step(dt);
                }
            }
        }
        self.schedule.advance(dt);
    }

    pub fn schedule(&self) -> &PhaseSchedule { &self.schedule }
}

pub struct SceneBuilder {
    phases: Vec<PhaseSpec>,
    fields_per_phase: Vec<HashMap<Channel, Field>>,
}

impl SceneBuilder {
    pub fn new() -> Self {
        Self { phases: Vec::new(), fields_per_phase: Vec::new() }
    }

    pub fn add_phase(&mut self, spec: PhaseSpec) -> usize {
        self.phases.push(spec);
        self.fields_per_phase.push(HashMap::new());
        self.phases.len() - 1
    }

    pub fn add_contributor(&mut self, phase_idx: usize, channel: Channel, c: Box<dyn Contributor>) {
        let entry = self.fields_per_phase[phase_idx]
            .entry(channel)
            .or_insert_with(|| Field::for_channel(channel));
        entry.add_contributor(c);
    }

    pub fn build(self) -> ChemFieldScene {
        ChemFieldScene {
            schedule: PhaseSchedule::new(self.phases),
            fields_per_phase: self.fields_per_phase,
        }
    }
}

#[cfg(test)]
mod tests { /* 上面 4 个测试,完整粘贴 */ }
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cargo test -p chem_field scene`
Expected: PASS(4 个测试)。

- [ ] **Step 5: Commit**

```powershell
git add crates/chem_field/src/core/scene.rs
git commit -m "feat(chem_field): ChemFieldScene with multi-channel + phase routing"
```

---

## Task 7: Bevy 插件:ChemFieldScene 作 Resource + step system

**Files:**
- Modify: `crates/chem_field/src/plugin.rs`
- Modify: `crates/chem_field/src/lib.rs`(确保 plugin 与 core 都被 re-export)

- [ ] **Step 1: 写最小 plugin 代码**

`crates/chem_field/src/plugin.rs`:
```rust
use crate::core::scene::ChemFieldScene;
use bevy::prelude::*;

#[derive(Resource, Deref, DerefMut)]
pub struct ChemFieldSceneRes(pub ChemFieldScene);

pub struct ChemFieldPlugin;

impl Plugin for ChemFieldPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Update, step_chem_field);
    }
}

fn step_chem_field(time: Res<Time>, scene: Option<ResMut<ChemFieldSceneRes>>) {
    if let Some(mut scene) = scene {
        scene.0.step(time.delta_secs());
    }
}
```

更新 `lib.rs`:
```rust
pub mod core;
pub mod plugin;
pub mod debug_viz;

pub use core::channel::{Channel, CombineOp};
pub use core::contributor::{ChemicalPointSource, Contributor};
pub use core::field::Field;
pub use core::phase::{PhaseSchedule, PhaseSpec};
pub use core::scene::{ChemFieldScene, SceneBuilder};
pub use plugin::{ChemFieldPlugin, ChemFieldSceneRes};
```

- [ ] **Step 2: cargo check 验证**

Run: `cargo check -p chem_field`
Expected: 无错误,可能少量未使用警告(允许)。

- [ ] **Step 3: 写 plugin smoke 测试(headless Bevy App)**

`crates/chem_field/tests/plugin_smoke.rs`:
```rust
use bevy::prelude::*;
use bevy::time::TimePlugin;
use chem_field::{
    Channel, ChemFieldPlugin, ChemFieldSceneRes, ChemicalPointSource, PhaseSpec, SceneBuilder,
};
use glam::Vec3;

#[test]
fn plugin_steps_scene_each_update() {
    let mut app = App::new();
    app.add_plugins((MinimalPlugins, ChemFieldPlugin));

    let mut builder = SceneBuilder::new();
    builder.add_phase(PhaseSpec { duration: f32::INFINITY, evolving: true });
    builder.add_contributor(0, Channel::ChemA,
        Box::new(ChemicalPointSource::new(Vec3::ZERO, 1.0, 1.0, 0.0, 1.0)));
    app.insert_resource(ChemFieldSceneRes(builder.build()));

    // 让虚拟时间跑 1 秒(Bevy Time 默认会用真实 dt,这里手动推进)
    for _ in 0..10 {
        app.world_mut().resource_mut::<Time>().advance_by(std::time::Duration::from_millis(100));
        app.update();
    }
    let scene = &app.world().resource::<ChemFieldSceneRes>().0;
    let v = scene.sample(Channel::ChemA, Vec3::ZERO);
    // 振幅应明显衰减(volatility=1, t≈1s → exp(-1))
    assert!(v < 0.5 && v > 0.2, "expected amplitude in (0.2, 0.5), got {v}");
}
```

- [ ] **Step 4: 运行测试**

Run: `cargo test -p chem_field --test plugin_smoke`
Expected: PASS。若 `Time::advance_by` API 在所用 Bevy 版本不同,改用 `time.advance_by(Duration::...)` 的实际签名。

- [ ] **Step 5: Commit**

```powershell
git add crates/chem_field/src/plugin.rs crates/chem_field/src/lib.rs crates/chem_field/tests/plugin_smoke.rs
git commit -m "feat(chem_field): Bevy plugin + ChemFieldSceneRes resource"
```

---

## Task 8: 体素调试可视化(gizmos)

**Files:**
- Modify: `crates/chem_field/src/debug_viz.rs`

把场在一个固定体素网格上采样,按值大小用 `gizmos.cuboid` 画彩色立方体。仅作目视调试,不上 production。

- [ ] **Step 1: 写 debug viz 系统**

`crates/chem_field/src/debug_viz.rs`:
```rust
use crate::core::channel::Channel;
use crate::plugin::ChemFieldSceneRes;
use bevy::prelude::*;

#[derive(Resource, Clone)]
pub struct DebugVizConfig {
    pub channel: Channel,
    pub bounds_min: Vec3,
    pub bounds_max: Vec3,
    pub resolution: UVec3,
    pub threshold: f32,
    pub max_value_for_color: f32,
}

impl Default for DebugVizConfig {
    fn default() -> Self {
        Self {
            channel: Channel::ChemA,
            bounds_min: Vec3::splat(-5.0),
            bounds_max: Vec3::splat(5.0),
            resolution: UVec3::splat(16),
            threshold: 0.05,
            max_value_for_color: 1.0,
        }
    }
}

pub struct DebugVizPlugin;

impl Plugin for DebugVizPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<DebugVizConfig>()
            .add_systems(Update, draw_voxel_field);
    }
}

fn draw_voxel_field(
    mut gizmos: Gizmos,
    cfg: Res<DebugVizConfig>,
    scene: Option<Res<ChemFieldSceneRes>>,
) {
    let Some(scene) = scene else { return; };
    let extent = cfg.bounds_max - cfg.bounds_min;
    let step = extent / cfg.resolution.as_vec3();
    for ix in 0..cfg.resolution.x {
        for iy in 0..cfg.resolution.y {
            for iz in 0..cfg.resolution.z {
                let pos = cfg.bounds_min + step * Vec3::new(ix as f32 + 0.5, iy as f32 + 0.5, iz as f32 + 0.5);
                let v = scene.0.sample(cfg.channel, pos);
                if v < cfg.threshold { continue; }
                let t = (v / cfg.max_value_for_color).clamp(0.0, 1.0);
                let color = Color::srgba(t, 0.3 * (1.0 - t), 1.0 - t, t.clamp(0.15, 0.9));
                gizmos.cuboid(
                    Transform::from_translation(pos).with_scale(step * 0.85),
                    color,
                );
            }
        }
    }
}

impl Default for DebugVizPlugin {
    fn default() -> Self { Self }
}
```

如某些 Bevy API 名(如 `Gizmos::cuboid` 签名)与所用版本不一致,在实现期调整;关键是体素中心采样 + 阈值过滤 + 颜色映射的逻辑。

- [ ] **Step 2: cargo check 验证**

Run: `cargo check -p chem_field`
Expected: 编译通过。

- [ ] **Step 3: Commit**

```powershell
git add crates/chem_field/src/debug_viz.rs
git commit -m "feat(chem_field): debug voxel gizmo visualization"
```

---

## Task 9: Example 程序 — 静态单源 + 演化双源

**Files:**
- Create: `crates/chem_field/examples/static_single_source.rs`
- Create: `crates/chem_field/examples/evolving_dual_source.rs`

目视验证:运行后人眼确认场形状、衰减、扩散行为符合预期。

- [ ] **Step 1: 写静态单源 example**

`crates/chem_field/examples/static_single_source.rs`:
```rust
use bevy::prelude::*;
use chem_field::{
    debug_viz::{DebugVizConfig, DebugVizPlugin},
    Channel, ChemFieldPlugin, ChemFieldSceneRes, ChemicalPointSource, PhaseSpec, SceneBuilder,
};

fn main() {
    let mut builder = SceneBuilder::new();
    builder.add_phase(PhaseSpec { duration: f32::INFINITY, evolving: false });
    builder.add_contributor(0, Channel::ChemA,
        Box::new(ChemicalPointSource::new(Vec3::ZERO, 1.0, 1.5, 0.0, 0.0)));
    let scene = builder.build();

    App::new()
        .add_plugins(DefaultPlugins)
        .add_plugins((ChemFieldPlugin, DebugVizPlugin))
        .insert_resource(ChemFieldSceneRes(scene))
        .insert_resource(DebugVizConfig {
            channel: Channel::ChemA,
            bounds_min: Vec3::splat(-5.0),
            bounds_max: Vec3::splat(5.0),
            resolution: UVec3::splat(20),
            threshold: 0.05,
            max_value_for_color: 1.0,
        })
        .add_systems(Startup, spawn_camera)
        .run();
}

fn spawn_camera(mut commands: Commands) {
    commands.spawn((
        Camera3d::default(),
        Transform::from_xyz(8.0, 8.0, 8.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}
```

- [ ] **Step 2: 写演化双源 example**

`crates/chem_field/examples/evolving_dual_source.rs`:
```rust
use bevy::prelude::*;
use chem_field::{
    debug_viz::{DebugVizConfig, DebugVizPlugin},
    Channel, ChemFieldPlugin, ChemFieldSceneRes, ChemicalPointSource, PhaseSpec, SceneBuilder,
};

fn main() {
    let mut builder = SceneBuilder::new();
    builder.add_phase(PhaseSpec { duration: f32::INFINITY, evolving: true });
    builder.add_contributor(0, Channel::ChemA,
        Box::new(ChemicalPointSource::new(Vec3::new(-2.0, 0.0, 0.0), 1.0, 0.8, 0.3, 0.1)));
    builder.add_contributor(0, Channel::ChemA,
        Box::new(ChemicalPointSource::new(Vec3::new(2.0, 0.0, 0.0), 1.0, 0.8, 0.3, 0.1)));
    let scene = builder.build();

    App::new()
        .add_plugins(DefaultPlugins)
        .add_plugins((ChemFieldPlugin, DebugVizPlugin))
        .insert_resource(ChemFieldSceneRes(scene))
        .insert_resource(DebugVizConfig {
            channel: Channel::ChemA,
            bounds_min: Vec3::splat(-6.0),
            bounds_max: Vec3::splat(6.0),
            resolution: UVec3::splat(24),
            threshold: 0.05,
            max_value_for_color: 1.0,
        })
        .add_systems(Startup, spawn_camera)
        .run();
}

fn spawn_camera(mut commands: Commands) {
    commands.spawn((
        Camera3d::default(),
        Transform::from_xyz(10.0, 10.0, 10.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}
```

- [ ] **Step 3: 各跑一次,目视验证**

Run: `cargo run --example static_single_source`
Expected: 出现稳定的高斯球状彩色体素云,不随时间变化。

Run: `cargo run --example evolving_dual_source`
Expected: 两团云开始紧凑明亮,随时间变得更弥散且更暗(扩散展宽 + 挥发衰减)。

- [ ] **Step 4: Commit**

```powershell
git add crates/chem_field/examples/static_single_source.rs crates/chem_field/examples/evolving_dual_source.rs
git commit -m "feat(chem_field): examples for static + evolving fields"
```

---

## Task 10: HTML 侧配套 — `edge.attenuation`(Umwelt 仓)

**Files:**
- Modify: `D:/dev/Umwelt/src/neural/graph.js`
- Modify: `D:/dev/Umwelt/src/neural/evaluator.js`
- Modify: `D:/dev/Umwelt/src/persistence/module-format.js`
- Test/Modify: `D:/dev/Umwelt/tests/neural/evaluator.attenuation.test.js`(新建)
- Modify: `D:/dev/Umwelt/docs/worklog.md`

§7.4 标的小改动:每条 edge 附一个 `attenuation` 衰减乘子(默认 1.0),evaluator 在信号传递时把 pre 激活乘上 attenuation,模块 schema 升 v11(向后兼容:旧 v10 模块加载时 attenuation 填 1.0)。

- [ ] **Step 1: 写失败测试**

`D:/dev/Umwelt/tests/neural/evaluator.attenuation.test.js`:
```js
import { describe, it, expect } from "vitest";
import { compileTopology, stepBatch } from "../../src/neural/evaluator.js";

describe("edge.attenuation", () => {
  it("defaults to 1.0 — full signal passes through", () => {
    // 构造最小图:sensor → motor,attenuation 默认
    const graph = makeSensorToMotor({ attenuation: undefined });
    const compiled = compileTopology(graph);
    const out = stepSeveralTicks(compiled, /*sensor input*/ 1.0, 20);
    expect(out.motor).toBeGreaterThan(0.5);
  });

  it("0.5 attenuation halves transmitted signal magnitude at steady state", () => {
    const graphFull = makeSensorToMotor({ attenuation: 1.0 });
    const graphHalf = makeSensorToMotor({ attenuation: 0.5 });
    const oFull = stepSeveralTicks(compileTopology(graphFull), 1.0, 50);
    const oHalf = stepSeveralTicks(compileTopology(graphHalf), 1.0, 50);
    expect(oHalf.motor / oFull.motor).toBeCloseTo(0.5, 1);
  });

  it("0 attenuation blocks signal", () => {
    const graph = makeSensorToMotor({ attenuation: 0.0 });
    const out = stepSeveralTicks(compileTopology(graph), 1.0, 50);
    expect(out.motor).toBeLessThan(0.01);
  });
});

// helpers — adjust to match existing graph + evaluator API
function makeSensorToMotor({ attenuation }) { /* … */ }
function stepSeveralTicks(compiled, input, n) { /* … */ }
```

helpers 要按现有 `src/neural/graph.js` 与 `src/neural/evaluator.js` 的真实 API 写;执行者先 `grep` 现有 evaluator 测试找参考。

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd D:/dev/Umwelt && npx vitest run tests/neural/evaluator.attenuation.test.js`
Expected: FAIL — attenuation 字段未实现,所有用例返回的 motor 值与 attenuation 无关。

- [ ] **Step 3: 在 graph.js 上加 attenuation 字段**

`D:/dev/Umwelt/src/neural/graph.js` 中 edge 构造处补默认值。先 `grep` 出 edge 工厂:

```
grep -n "delay_ms" src/neural/graph.js
```

在 delay_ms 旁边并列 `attenuation: edge.attenuation ?? 1.0`,序列化 / 反序列化对称处理。

- [ ] **Step 4: 在 evaluator.js 中乘 attenuation**

`D:/dev/Umwelt/src/neural/evaluator.js`:找信号经 edge 传递的位置(应在 stepBatch 内、读取 ring buffer 或 pre 激活后、加入 post 累加之前)。把:
```js
const contribution = preActivation * edge.weight;
```
改为:
```js
const contribution = preActivation * edge.weight * edge.attenuation;
```
(具体变量名按现有代码;`edge.attenuation` 在 compileTopology 阶段已并行展开到 typed array 里,与 delay_ms 同模式。)

- [ ] **Step 5: schema 升 v11**

`D:/dev/Umwelt/src/persistence/module-format.js`:
- 写常量 `CURRENT_MODULE_SCHEMA = "umwelt-module-v11"`(现行是 v10)
- `serialize`:edge 输出含 `attenuation`
- `parseModuleText`:接受 v10 与 v11;v10 加载时为每条 edge 补 `attenuation: 1.0`,并打印一行 console.warn 标记 migration
- 测试加载旧 v10 fixture 仍能跑

- [ ] **Step 6: 运行 attenuation 测试 + 全量回归**

Run: `npx vitest run tests/neural/evaluator.attenuation.test.js`
Expected: PASS。

Run: `npx vitest run`
Expected: 所有既有测试仍 PASS;特别留意 delay_ms 测试不受影响。

- [ ] **Step 7: 更新 worklog**

`D:/dev/Umwelt/docs/worklog.md` 追加 2026-XX-XX 当日条目,简述:edge.attenuation 实装、schema v11、为何与 Bevy 子系统 B 一并排期(§7.4)。

- [ ] **Step 8: Commit**

```powershell
cd D:/dev/Umwelt
git add src/neural/graph.js src/neural/evaluator.js src/persistence/module-format.js tests/neural/evaluator.attenuation.test.js docs/worklog.md
git commit -m "feat(neural): edge.attenuation companion to delay_ms (schema v11)"
```

---

## Self-Review 小记

- **Spec 覆盖**:§5.2 contributor + combine_op(任务 2-4)、phase 外壳(任务 5)、单 simulator 双调用(任务 6 evolving 标志)、Bevy 化(任务 7)、MVP 只用化学点源(任务 3)、几何距离场 schema 留口(CombineOp::Min 通路在任务 2 + 4 已覆盖,但 MVP 无 contributor 实现 —— 与 spec 一致)。§7.4 attenuation HTML 配套(任务 10)。§4.2 真实物理单位常数集中 —— 本计划未单建 `constants/biology.rs`,因 MVP 化学场常数(σ、D、volatility)由关卡注入而非全局,文件留到 C/D 计划再建。
- **占位扫描**:无 TBD / "类似前面的"。每段代码 / 测试都给完整体。
- **类型一致性**:`Channel`、`CombineOp`、`Contributor`、`Field`、`PhaseSpec`、`PhaseSchedule`、`ChemFieldScene`、`SceneBuilder`、`ChemFieldSceneRes` 在所有任务中拼写一致。`sample(channel, pos)`、`step(dt)` 一致。
- **风险**:Bevy 0.15 API 名(`Time::advance_by`、`Gizmos::cuboid`)略有版本敏感,实现期按 Cargo 锁定版本调整;不动测试语义。
