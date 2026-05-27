# Bevy Subsystem C-4 — HTML JSON Export Design (v0.1)

> Scope: emit a `umwelt-module-v1` JSON file from the Bevy workshop that
> HTML's `parseModuleText` + envelope v10's `moduleMeta` can consume.
> MVP scope is **meta-only** — `graph` / `receptors` / `level_id` blocks
> are omitted (key not present), not stubbed.

## 1. 范围

Bevy 侧把 `Routes::organ_static(&Grid)` 派生的 7 个 OrganStatic 数字落到一份
`umwelt-module-v1` JSON 文档里。HTML 端 `src/io/module.js` 已实现解析、envelope v10
已有 `moduleMeta` passthrough,本子系统**不动 HTML 任何代码**。

**导出原则(锁死):** 只导 Bevy 此刻真正拥有、不需要编默认的字段。Bevy 不知道的
信息不在 JSON 里出现 —— 不是写 `null`、不是写空数组,而是 key 完全不存在。
三个缺席块各自归别处:

| 块 | 归宿 |
|----|------|
| `level_id` | 未来 Bevy 关卡子系统 |
| `graph` | 未来 Bevy 求值层(动力学常数) + 关卡 I/O 契约(sourceId) + HTML adapter(画布坐标) |
| `receptors` | 关卡 I/O 契约(物理 receptor 端口) |

**不在范围:**
- HTML 端任何改动(parseModuleText / moduleMeta 已够用)
- JSON 反序列化回 Bevy
- 多模块管理 / 模块比对 / UI 按钮
- Bevy 端任何"导出后保留状态"的概念

## 2. 输出格式

```jsonc
{
  "schema": "umwelt-module-v1",                  // literal,HTML 严格相等校验
  "meta": {
    "neuron_count":         <integer>,
    "total_volume_um3":     <float>,
    "total_membrane_um2":   <float>,
    "total_static_pj_s":    <float>,
    "layered_volume_um3":   <float>,
    "max_path_delay_ms":    <float>,
    "per_layer_hull_um2":   { "<layer>": <float>, ... }
  }
}
```

**字段说明**

- 7 个 meta 字段 = `OrganStatic` 字段名 1:1 对应。不重命名、不增、不减。
- `per_layer_hull_um2` 的 BTreeMap 由 serde_json 落成 JSON object。key 是层 index
  (i32) 转的字符串。**BTreeMap 的数值序在 JSON 文本中被保留**,消费侧需要保序时
  按插入顺序读;**不要把 string key 按字典序排**(否则 `"10" < "2"`,层序错乱)。
- 顶层 `compiled_at` / `level_id` / `graph` / `receptors`:**不写**。HTML 端
  parseModuleText 对缺失的 `level_id` 已映射为 `null`(已确认);缺失的
  `graph` / `receptors` 走的是另一条路径,在 §6 通过人工跨语言确认兜底。

## 3. API

```
crates/grid_workshop/src/routing/
  ├── export.rs            ← 新文件
  └── (其余照旧)
```

**自由函数 + DTO 模式:**

```rust
// export.rs
use serde::Serialize;
use crate::core::Grid;
use crate::routing::Routes;

#[derive(Serialize)]
struct ModuleJson<'a> {
    schema: &'static str,
    meta: ModuleMetaDto<'a>,
}

#[derive(Serialize)]
struct ModuleMetaDto<'a> {
    neuron_count: usize,
    total_volume_um3: f32,
    total_membrane_um2: f32,
    total_static_pj_s: f32,
    layered_volume_um3: f32,
    max_path_delay_ms: f32,
    per_layer_hull_um2: &'a BTreeMap<i32, f32>,
}

pub fn to_module_json(grid: &Grid, routes: &Routes) -> String { ... }
```

**为什么 DTO 而不是直接 `derive(Serialize) for OrganStatic`:**

§5 不变量"meta 永远恰含 7 个字段"必须**在构造上**成立,不是事后断言成立。
若 OrganStatic 哪天新增内部缓存字段,直接 derive 会让它一并漏进 JSON、meta
悄悄变 8 个、v1 契约被一次内部改动破掉,只有 §4 字段集断言能事后抓。DTO 让
OrganStatic 随便演化,对外 schema 不变;v2 演化是显式新建 v2 DTO 的动作。

**为什么自由函数而不挂 `Routes::`:**

`Routes` 是底层布线结构,不该知道 `umwelt-module-v1` 这个对外 schema。
依赖箭头朝对:`export → {Grid, Routes}`,不是反向。

**Cargo.toml:**

`serde_json` 加入 `crates/grid_workshop/Cargo.toml`。`serde` 推测已在
(`ChemicalField` 之类多半已经用了);加之前先验证、若已存在不重复。

## 4. example

```
crates/grid_workshop/examples/module_export.rs   ← 新文件
```

复用 `cost_demo.rs` 的同款 3 神经元 + 1 forked-edge 场景。MinimalPlugins + LogPlugin,
无窗口、无 mesh。Startup 系统填 grid → 调 `to_module_json` → `println!` 到 stdout →
`AppExit::Success`。

## 5. 测试

**unit (in export.rs):**

1. **empty grid**:`to_module_json` 输出合法 JSON,根 object 字段集 = `{schema, meta}`,
   `schema == "umwelt-module-v1"`,`meta.neuron_count == 0`,`meta.per_layer_hull_um2 == {}`,
   其它数值字段为 0。
2. **3 neuron + 1 edge**:`neuron_count == 3`,各派生量 > 0,`per_layer_hull_um2`
   含期望层 key。
3. **顶层字段集严格**:解析回 `serde_json::Value`,断言顶层 keys 恰 = `{"schema", "meta"}`
   —— 没有 `level_id` / `graph` / `receptors` / `compiled_at`。
4. **meta 字段集严格**:断言 `meta` object 的 keys 恰 = 那 7 个名字,不多不少。
   (这是 §3 DTO 设计的兜底防线。)

**example smoke (tests/c4_smoke.rs 或 examples 本身):**

- `cargo run --example module_export` 退出码 0
- stdout 含 `"schema":"umwelt-module-v1"`

**不做:**

- 跨语言往返单元测试(HTML 真消费 meta 时再说)。
- C-3 数字的数值正确性回归(C-3 自己已经测过)。

## 6. 人工跨语言验证(收工前 gate)

C-4 全部价值落在"HTML parseModuleText 能吃下一个 graph/receptors/level_id
整块缺席的 module"上。这事 Rust 单元测试测不了。

**步骤:**

1. 跑 `cargo run --example module_export > /tmp/c4.json`
2. 在 HTML repo 启一个 node REPL(或临时 .mjs 文件),
   `import { parseModuleText } from './src/io/module.js'`,
   `parseModuleText(fs.readFileSync('/tmp/c4.json','utf-8'))`
3. 期望:返回 `{ levelId: null, graph: ?, receptors: [], meta: {...7 字段...} }`

**两种结果:**

- **顺利通过**:模块吃下了,levelId=null、graph 是某种 falsy(看 module.js
  实现:`if (!raw.graph || typeof raw.graph !== "object") { ... return null; }`
  —— 等下,这条会**拒掉**整个 payload,因为 raw.graph 缺失即 falsy)
- **被拒**:这就是要 surface 给 user 的发现。**别**为了让它过去而吐一个空对象
  的 graph,那是假装"图是空的",违 §5 和"别编"原则。意味着 meta-only 路径需要
  HTML 侧补一个"允许 graph 缺席"的入口 —— 这是 scope 决定、给 user 拍板。

> **预测:** 读 module.js:34-37 行,`if (!raw.graph || typeof raw.graph !== "object")`
> 会**拒掉** meta-only payload。所以人工验证大概率落在第二种结果上,本子系统的
> 真正成果是 surface 出这个发现、让 user 决定下一步走 "HTML 加一个 meta-only
> 受信路径" 还是 "C-4 推迟到 graph 准备好之后"。spec 写完不假装这是闭环成功。

## 7. 不变量

- 输出永远是合法 JSON,根永远是 object
- `schema` 永远 = `"umwelt-module-v1"`(字面字串,不变)
- 根 object 字段集 ⊆ `{schema, meta}`;不允许出现 `null` 占位字段
- meta object 字段集 = 那 7 个 OrganStatic 字段名,**恰相等**(由 DTO 在构造上保证)
- `to_module_json` 是 `(Grid, Routes) → String` 的纯确定函数 —— 同输入同输出,
  无 wall-clock、无随机、无 IO

## 8. 验收

实现完成的判定:

1. `cargo test -p grid_workshop` 全绿,含 §5 的 5 条 unit + smoke
2. `cargo clippy -p grid_workshop --all-targets -- -D warnings` 干净(dev + release)
3. `cargo run --example module_export` 退出码 0,stdout 含 schema 字串
4. §6 人工跨语言验证已执行,结果(通过 / 被拒)记入 worklog
5. worklog 2026-05-27 + C-4 段
