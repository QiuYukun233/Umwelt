# 蚂蚁神经回路 Roadmap — Ant Circuit Roadmap

> **类型**:研究性 roadmap(不是实现 plan)。回答「为搭出一整只蚂蚁,需要哪些神经回路、每个怎么用 5 类节点搭、按什么顺序、缺什么硬件」。
> **日期**:2026-06-02
> **方法**:6 个并行论文研究子代理(odor 导航 / locomotion / 学习·蘑菇体 / 化学通讯 / 空间导航 gap-hunt / 其余反射+缺失模态),全部带真源。
> **状态框架**:Bevy 工坊先行;蚂蚁 = 已命名、推后的 campaign 层(见 CLAUDE.md「产品形态」)。本图把整只蚂蚁画全,但相位明确标出哪些现在能验、哪些需嵌入、哪些需扩硬件。
> **指导原则**:设计宪法 §1–4 + Decision Protocol + [[umwelt-honesty-cost]]「有时我们要为诚实付出代价,但不要畏惧,这定义了我们是谁」。

---

## 0. 一句话总览

蚂蚁的回路分 **7 簇**:A 运动底座 · B 趋化导航 · C 近场交互 · D 化学通讯 · E 内态与学习 · **F 空间导航(研究新增的一等簇)** · G 感知扩展(扩硬件解锁)。其中 **F 是原清单的大洞**——path integration 是蚂蚁最标志性的行为,既缺硬件、又撞上 5-节点前馈模型的架构墙。我们的决定:**导航做成一等簇,分级扩真器官硬件**,该承认的架构墙老实标出来,不藏、不假造。

---

## 1. 贯穿全图的设计公理(从研究里浮现)

这几条是反复出现、跨多个簇复用的结构事实,先立在这里,后面回路配方都引用它们。

1. **双侧差分转向 = 基石 motif。** 蚂蚁趋化/循迹的主机制是 **osmotropotaxis**:左右触角*瞬时*比较,`turn ∝ (R − L)`,且是*对比*不是绝对值(Perna et al. 2012 实测转角 ∝ (L−R)/(L+R),Weber 律)。果蝇侧角三阶神经元用**对侧抑制**实现这个差分(Mohamed et al. 2019);果蝇下行转向神经元 R−L 差 ∝ 身体转速、且**与前进速度解耦**(2024)。→ 我们的 L/R × 4 化学 触角布局**就是为这个 motif 设计的**。这是 Braitenberg 车在真脑里的实测实现,不是玩具类比。

2. **时间微分 motif(快副本 − 漏积分慢副本 = d/dt)= 最可复用电路。** 单个传感器靠「现在 vs 片刻前」恢复出梯度。用一条快的兴奋路 + 一条经 inter_inh 的延迟/漏积分路,二者之差 ≈ d(信号)/dt。这一个 motif 解锁:单眼光 klinokinesis、丢信号后的 casting 搜索、温/湿趋性。**应作为早期教学谜题。** 这就是 spike-frequency adaptation 在做的事(高通/变化探测)。

3. **modulator = 内态引擎,一个原语用三次。** 饥饿(energy 低)、饱足(energy 高、反号、慢衰减)、伤害致敏(damage)——都是「一条内感受线驱动一个 modulator、对整套反射重新加权」。已被线虫 test4 验证(饥饿→速度 +75%)。

4. **前进 = 紧张性分级驱动,不是振荡器。** 昆虫速度 = 下行增益,紧张性激活一个下行神经元就足以维持结构化行走(Bidaye et al. 2018)。**半中枢振荡器(两 inter_inh 互抑 + PIR)的真正归宿是搜索摆动 / casting,不是前进节律器**——给无腿身体做前进节律振荡是「工程剧场」,加了没人消费。【这是研究对原 A2 的修正。】

5. **涌现优先(§2)。** 群体留迹跟随、自终止招募、习惯化、casting 搜索——都从原语涌现,不做内置功能。

6. **延迟在谜题尺度是 sub-tick(已知模型边界)。** 几十格内 `delay_ms_to_ticks ≈ 0`(worklog 2026-05-29)。→ 一切**符合探测/精细时序**类回路(Reichardt 运动探测)出局;我们活在**幅值 + 慢动力学**区(衰减、振荡、抑制、门控、漏积分记忆)。**推论**:振荡干涉(oscillatory-interference)类 PI 模型也出局(它活在精细相位/timing 区),所以 PI 只能走漏积分路线(见 F4)。

7. **导航有一堵数学墙(精确定位)。** 朝向能力分三级:**(a) 瞬时 decode** = 前馈可搭(对侧 opponency + WTA/归一);**(b) 离散 N 态 HOLD** = 互抑 flip-flop 可搭(短暂保持粗扇区,有抖动/漂移);**(c) 连续、抗漂、黑暗中靠角速度积分的朝向** = **环吸引子,5 类前馈分级节点搭不出**。数学原因:连续吸引子要零特征值的精调递归兴奋(Seung 1996;Zhang 1996;Noorman et al. 2024),离散双稳元件是"搓衣板"势垒、势必量化 + 漂向最近态,填不平成连续流形。**墙落在 (b)→(c) 之间。这堵墙不藏、不假造,反做成教学内容**([[umwelt-honesty-cost]])。来源:用户研究 brief `docs/research/2026-06-02-navigation-wall-brief.md`(下称【brief】),已整合进 F 簇与 §5。

> **★ 墙是关卡设计的责任,不是电路事实(F1/F4 共用约束)。** (b) 离散 N 态 hold "电路上搭得出来"是事实;但**墙只在关卡逼着要连续朝向 / 黑暗持向 / 积分慢转时才*教得出*** ——否则玩家搭个高 N 环觉得"挺好用",墙就糊了。所以"让玩家撞上并理解这堵墙"是 F1/F4 **关卡**的设计目标,不能指望电路本身把它逼出来。

---

## 2. 硬件账本

### 2.1 现有(JS `src/creatures/ant.js` 基线,14 sensors / 6 motors)

| 类 | 通道 | 备注 |
|---|---|---|
| 触角化学 | 8 = L/R × ChemA/B/C/D | 锥形采样自扩散化学场 |
| 触角机械 | 2 = L/R touch | 二元接触 |
| 口器味觉 | 1 mouth taste | 需物理接触 |
| 光 | 1 light | **仅亮度**:无方向、无偏振、无颜色 |
| 内感受 | 2 = energy, damage | 常开 |
| 运动 | 3 = forward, turn_L, turn_R | **无倒车** |
| 腺体 | 2 = gland_α(ChemB 地面·低扩散·持久)、gland_β(ChemC 空气·高扩散·挥发) | 有储量/恢复 |
| 大颚 | 1 mandible | 夹持/进食/攻击不分 |

### 2.2 分级扩展(研究建议的**真器官**新增,已拍板加入 roadmap)

每条都对应真实蚂蚁感官器官(忠实,非假造)。按相位分级解锁,不是现在全上。

| Tier | 新增硬件 | 生物器官 / 源 | 解锁 |
|---|---|---|---|
| H1 | **light 拆 L/R**(双侧亮度) | 复眼双侧 | beacon taxis(空间光趋性,复用双侧差分 motif) |
| H2 | **温度 + 湿度** 各 1ch | 触角 sacculus(IR21a/25a/93a;hygro IR40a/93a/25a,Enjin 2016) | 温趋性 / 湿趋性(抗旱是头号死因);电路形状同光 |
| H3 | **原始偏振 e-vector 通道** 2–3ch(正弦调谐,**非**算好的朝向) | 背眼偏振区 DRA 的 POL 神经元(蟋蟀 ~10°/60°/130° 三型,Sakura et al. 2008) | menotaxis、PI 的方向项 —— ⚠ 朝向 **decode 是玩家可搭的谜题**(群体向量/opponency+WTA),不直接给标量(【brief】A1) |
| H4 | **里程计 odometer** 1ch | 步幅积分器/自体感(Wittlinger et al. 2006「踩高跷」) | PI 的距离项。⚠ 只有漏积分 → 必然是「会遗忘的里程」 |
| H5 | **视网膜亮度阵列** N ch(6–12 路定向) | 复眼 ommatidia | view-based homing / 路线跟随 / 光流(接现有可塑突触快照学习) |
| campaign | **基质振动感** + **stridulation 发声 actuator** | 胫节 subgenual organ / 摩擦发声 | 振动报警/招募(我们完全缺的报警模态) |

### 2.3 红线(绝不加 —— 加了就违宪)

- ✗ 给**单通道亮度编方向**(假装它有它没有的能力,违 §1)。
- ✗ 加一个直报「回家方向/距离」的 **home-vector 传感器**——那是把 PI 涌现出来的量直接喂给玩家(违 §2)。若非要,只能当 debug/training aid,绝不叫生物器官。
- ✗ 加**第 6 类节点**或一个「环吸引子原语」把中央复合体整体搬进来(违「5 类不新增」+ §2)。宁可给 compass 传感器、让平凡的前馈 null-error 环做 menotaxis。

---

## 3. 回路簇清单

> 每条:**行为** · **节点配方**(5 类 + Dale 符号 + 连法) · **靠哪个神经特性** · **可验性**(① 现编辑器纯电路可验 / ② 需嵌入 chem场+身体 / ③ 需扩硬件) · **依赖** · **关键源**。坐标级布局留到真搭那天。

### A. 运动底座

**A1 — 转向仲裁总线(先建这个,所有反射都插它)**
- 行为:多反射的「想左/想右/想前」汇到 3 个 motor 而不打架。
- 配方:每个反射给一个 left-turn 节点和 right-turn 节点贡献分级兴奋;left-turn ↔ right-turn 间一对 `inter_inh` 互抑算出**净**转向(= winner-take-direction,pivot↔swerve 连续谱 = 推多狠);`motor_forward` 由速度驱动单独走。
- 特性:求和 + 互抑(诚实涌现的冲突解决,非硬编优先级,§2)。
- 可验:① · 依赖:无(基底) · 源:Yang et al. 2024(下行转向 R−L);本身是 §2 的范例。
- **设计提示**:这是全图唯一的共享输出总线——趋化、避障、搜索振荡、导航朝向误差、威胁逃逸全在这汇合。**先设计它,别的簇才有处接。**

**A2 — 搜索/扫描振荡器(原「运动 CPG」改名)**
- 行为:丢失线索后区域受限搜索(系统性摆动 meandering、casting);Cataglyphis「隐藏螺旋」的摆动成分。
- 配方:left-turn ↔ right-turn 一对 `inter_inh` 互抑 + **PIR**(g_rebound=7.0)+ 漏积分定周期,由一个「lost」`modulator`(线索 d/dt 转负 / 食物缺)门控开启,输出交替 turn_L/turn_R。
- 特性:互抑 + post-inhibitory rebound = 振荡(线虫 test3 已验)。
- 可验:① 振荡本身;② 搜索行为 · 依赖:A1、时间微分 motif(公理2) · 源:Brown 1911/1914;Marder & Bucher 2001;Müller & Wehner 1994(螺旋的*扩张*来自 PI 不是马达,见 F)。
- 注:**不是前进节律器**(公理4)。半中枢在这里挣到它的位置。

**A3 — go-gate(紧张性前进驱动)**
- 行为:走不走、走多快。
- 配方:一个下行 `modulator`(或紧张兴奋)门控 `motor_forward` 的增益并 scale 它。
- 特性:modulator 增益。可验:① · 依赖:无 · 源:Bidaye et al. 2018(紧张激活足以维持行走;速度=下行增益)。

**A4 — stop / freeze**
- 行为:强威胁时停步。配方:`inter_inh` 压 A3 的 go 驱动。特性:抑制。可验:① · 依赖:A3。

**A5 — 转身逃(替代不存在的倒车)**
- 行为:危险在前 → 急转 + 前进离开(因为没有 reverse motor)。
- 配方:`damage`/威胁 → 高增益快转 burst(saccade 样)喂 A1,再 forward。
- 特性:高增益反射。可验:② · 依赖:A1、C3 · 源:Bidaye et al. 2014(MDN 倒车,我们没有→必须转身替代)。
- **路由 fork F-REVERSE**:倒车是真实的独立马达模式(逃跑命令神经元),折成转身逃是有意的模型选择(可辩护:蚂蚁确能转身逃),但确实丢了一个独立马达模式。倾向接受,记此处。

### B. 趋化导航

**B1 — 食物趋近(ChemA,osmotropotaxis)**
- 行为:静止空气/平滑梯度里向食物气味源转。
- 配方(双侧差分,公理1):
  ```
  sensor(L_ChemA) → inter_exc_L → motor_turn_L
  sensor(L_ChemA) → inter_inh_L ⊣ motor_turn_R   (对侧抑制)
  sensor(R_ChemA) → inter_exc_R → motor_turn_R
  sensor(R_ChemA) → inter_inh_R ⊣ motor_turn_L
  forward = (L 或 R 有信号) → motor_forward
  ```
  转向强者一侧;复用线虫 test1「同侧抑制→食物趋近」家族。
- 特性:对侧抑制差分。可验:① 拓扑/成本;② 趋近行为 · 依赖:A1 · 源:Hangartner 1967;Draft et al. 2018;Perna et al. 2012;Mohamed et al. 2019。
- **路由 fork F-WEBER**:真实转向 ∝ (L−R)/(L+R) 要除法归一。纯权重和给的是 raw (L−R)。用 (L+R) 喂一个 modulator 做除法增益可近似。倾向:接受 raw (L−R) 为「够用」,modulator 归一作为进阶解。
- **路由 fork F-WIND**:湍流羽流追踪(沙漠蚁 surge-and-cast,Wolf & Wehner 2000;Buehlmann 2014)需要**风向感,我们没有**。→ B1 现在只覆盖**静止空气/平滑梯度**这一(真实的)区间。倾向:化学场保持层流(不建湍流),还原 osmotropotaxis 为唯一觅食机制;风留 campaign(若做需加风场 + 触角风感,触角确感气流,是忠实可加项)。

**B2 — 危险回避(ChemD)**
- 行为:转离危险源 + 提速。配方:B1 反极性(差分驱动**反向**转 + 喂 A3 增速)。特性:对侧抑制。可验:②(用现有触角 ChemD,不需新硬件)· 依赖:A1、B1。

**B3 — 光(kinesis + klinokinesis)**
- 行为:多数蚂蚁避光(暗=庇护);光=暴露/威胁线索。
- 配方:
  - **光动性(orthokinesis)**:`light → inter_exc → motor_forward`(亮→快;经抑制可反成暗→慢→安顿)。无方向需求,忠实。
  - **暗趋(klinokinesis,优雅版)**:单眼无空间梯度→只能时间比较。用**时间微分 motif**(公理2):亮度上升(走进光)→ 升高转频逃;亮度下降→压低转频直行。
- 特性:漏积分做 d/dt。可验:① d/dt 电路;②③ 行为(空间光趋性 beacon taxis 需 **H1 split-light**,见 F0)· 依赖:公理2 motif · 源:Humberg & Sprecher 2020(果蝇幼虫时间光趋);Chen & Engert 2014(ESTIMATE 跨taxa)。
- **诚实边界**:单非定向亮度只能 kinesis + 时间 klinokinesis。**真定向趋光/避光、太阳罗盘 = 设计上的 GAP**,不假造方向。

### C. 近场交互

**C1 — 触碰 / 壁随 / 逃避(L/R touch)**
- 行为:撞→转离;沿墙(thigmotaxis)保持轻接触;突触硬撞→急转逃。
- 配方:`touch_L → inter_exc → motor_turn_R`(转离撞侧)+ 镜像 = 全硬件里最干净的双传感器转向。壁随 = 不交叉 + 平衡抑制,让环稳在「保持接触」而非弹开。逃逸 = 高增益 + **适应**(持续按压习惯化,新撞重触发)。
- 特性:对侧/同侧差分 + 适应(novelty)。可验:① ② · 依赖:A1 · 源:Camhi & Johnson 1999(蟑螂壁随);Krause & Dürr 2012。**这是现有 14 传感器里最富的反射族。**

**C2 — 进食(mandible + mouth taste)**
- 行为:口器尝到好食→合颚+停步+摄入;饱→停。
- 配方:`taste → inter_exc → motor(mandible)` + 经 A4 停步;饱足由 E1b 门控压下。
- 特性:反射 + 饱足 modulator。可验:② · 依赖:A4、E1b · 源:Dethier《The Hungry Fly》;Gelperin 1967(前肠牵张饱足)。
- **路由 fork(部分 GAP)**:单 taste 通道分不了甜/苦。甜引诱 vs 苦拒绝的**对立味觉门控**只能部分实现(高 taste 可经 damage 路当「有害」),或承认这是单味觉线的 GAP。

**C3 — 伤害反射 + 致敏(damage)**
- 行为:伤害→急逃(A5);伤后**致敏**(阈值下降、警觉持续数小时)。
- 配方:`damage → inter_exc → motor`(逃)**且** `damage → modulator`(致敏):该 modulator 既调高逃逸路增益、又驱动 **Hebbian 可塑**强化威胁回避边;modulator 漏积分时间常数给「伤后持续一阵」的衰减。
- 特性:modulator 增益 + 可塑。可验:② · 依赖:A5、E2 · 源:Tracey et al. 2003(painless);Khuong et al. 2019(神经损伤致警觉)。
- **诚实标注**:真 allodynia 部分是抑制丢失(GABA 细胞死),我们没有细胞死,用 modulator 增益模拟——行为层忠实、机制层简化,明说。**「伤害记忆」和关联学习落在同一台 Hebbian-gated-by-modulator 机器上**——好的 aha。
- **诚实标注**:有无昆虫「痛觉」的*感受*成分有争议;我们只搭 sensitization 现象,不替它下「感到痛」的判断。

### D. 化学通讯(群体涌现的接口)

**D1 — 留迹(gland_α 写 ChemB,状态门控)**
- 行为:找到并取食后,**归途**间歇拖腹沉积;量随**食物质量/饥饿**调,随**已有信息素/拥挤**抑制(负反馈刹车);离食物近处沉积可达 ~22×(Czaczkes lab)。
- 配方:`mouth taste(到达食物) → modulator(「已食/归返」态)`,门控 `inter_exc → motor(gland_α)`;质量 = modulator 增益 ∝ taste;饥饿 = energy 经 inter_inh 入 modulator;**自抑刹车** = 自身触角 ChemB/touch → inter_inh ⊣ gland 马达。
- 特性:modulator 门控马达。可验:② · 依赖:E1 · 源:Wilson 1962(火蚁三部曲,自终止反馈);Czaczkes et al. 2015(综述)。
- **群体正反馈是涌现的,不在单蚁内**:A 留 ChemB→B 的触角 ChemB 传感器循迹上行(D2)→B 到食→B 的 modulator 触发→B 也留→迹放大。ChemB **低扩散/持久**让迹活得够久闭环。= **CLAUDE.md test7**,纯涌现(§2 正确)。

**D2 — 循迹(antenna ChemB)**
- 行为:把信息素带保持在两触角之间、跨带摆动、触角尖触带缘(Draft et al. 2018 三种采样模式)。配方:**= B1 家族**,源换成 ChemB。可验:②(test7)· 依赖:A1、B1。
- **极性是迹拓扑涌现的,不是传感器**:Y 岔口 ~60° 几何 + 走错→U 转(Jackson et al. 2004)。**别加迹方向传感器(违 §1)。**

**D3 — 报警(gland_β 写 ChemC)**
- 行为:伤害/威胁/天敌接触→挥发性大颚腺爆发;**剂量依赖**:低浓度/远=警觉+趋向调查,高浓度/近=恐慌逃/攻击(Wilson & Bossert 1963 active space)。
- 配方:`damage/威胁 → inter_exc → motor(gland_β)`(反射释放,不需状态门控);ChemC **高扩散/挥发**给瞬态快扩 active space(忠实)。
- 可验:② · 源:Morgan 2009;Li et al. 2019(火蚁吡嗪剂量依赖)。
- **路由 fork F-ALARM**:剂量依赖反转(low=吸引 high=恐慌)是**感知侧非线性**——同一 ChemC、浓度不同行为相反。单调传感器要靠玩家搭高阈 inter_inh 覆盖低剂量趋向电路才能实现,可行但非显然。是真 fork,不由宪法settle。

**D4 — no-entry 排斥迹(GAP)**
- 行为:Pharaoh 蚁在岔口标*不奖励*的支为排斥(Robinson et al. 2005;该种用 ≥3 种迹信息素)。
- **路由 fork F-NOENTRY**:需要地面通道**第二个极性**。单 ChemB 没法同时「来」和「别来」。选项:(a) 接受 GAP 丢 no-entry;(b) 把*第二种*持久化学物当排斥。别默认 gland_α 能两用。

### E. 内态与学习

**E1 — 饥饿调制(energy → 觅食 gain)**
- 行为:饿→活动亢进、觅食增益升、接受阈降。配方:`sensor(energy) → modulator`:低能→调高运动+趋食路增益、降逃逸阈。特性:modulator 增益(线虫 test4 已验)。可验:② · 源:Yang et al. 2015(章鱼胺驱饥饿亢进);Greenwald et al. 2018(嗉囊负载规则)。**忠实**。

**E1b — 饱足(独立于饥饿,反号、慢衰减)**
- 行为:嗉囊/肠牵张→结束进食、返巢。配方:`energy 高 → modulator ⊣ 进食/摄入路增益`;前肠饱足的慢衰减 = 该 modulator 漏积分时间常数。可验:② · 依赖:C2 · 源:Gelperin 1967;Min et al. 2021(Piezo 肠机械感受)。
- 注:**不是「饥饿 off」**——不同信号(energy/嗉囊)、反号、慢衰减。最干净的「漏积分挂 modulator」演示。

**E2 — 关联学习(蘑菇体类比)**
- 行为:气味↔食物联想;蜂单次试验即可成记忆(ESTIMATE for ant;Lasius niger 多试验,Wissink & Nehring 2021);分钟级习得、时-天级遗忘。
- 配方:`sensor(气味) → inter_exc(KC 样中继) →[可塑边]→ motor`;US 通道(味觉=appetitive / damage=aversive)→ `modulator` 门控那条可塑边。= **KC→MBON 突触 + DAN 教学信号**;把可塑放在*边*上、绑一个 modulator,忠实于「每分区一个 DAN」组织。
- 特性:Hebbian 可塑 + modulator 门控。可验:② campaign(test5/6)· 源:Fiala & Kaun 2024;Hige et al. 2015;Wissink & Nehring 2021(ant:OA→习得、DA→24h 巩固)。
- **★ 路由 fork F-LEARN(重要,触 CLAUDE.md 写死的规则)**:真实蘑菇体规则是 **`Δw ∝ pre × mod`(两因子、突触前),方向是抑制(配对后 ~90% depression),突触后活动无关**(Hige et al. 2015)。我们的 `η·pre·post·mod` 多了个 `post`,且默认增强不是抑制。建议二选一:① 保留 `pre·post·mod` 但**明标为「工程 Hebbian 便利」,不是 MB 生物**(三因子规则是正当工程选择,只是别穿生物外衣);② 改成 `pre·mod` + 教学信号默认**压低**被门控边(更忠实,且呼应宪法「OFF 是搭出来的、学习本身是减法」)。**不擅自定,交你/review。**
- **诚实标注**:`decay·(w_init − w)` 是*被动遗忘*,忠实;但**消退(extinction)≠ 衰减到基线**——消退是形成第二条反号记忆痕迹(Felsenberg et al. 2018),单边衰减搭不出。已知简化,记。

**E3 — 习惯化(非关联,独立一类)**
- 行为:同巢识别本质是 habituation(熟悉→降反应),novelty/dishabituation。配方:**靠 spike-frequency adaptation + inter_inh(OFF-builder)涌现,无 modulator**——不走 Hebbian 规则。可验:① · 源:学习子代理 + 同巢识别综述。
- 注:**这是和 E2 不同的学习**(无 US、无 modulator)。宪法 §2 角度:习惯化应从适应涌现,不做新节点。

### F. 空间导航(研究新增的一等簇 —— 原清单的大洞)

> 双重不可达:**硬件洞**(无罗盘/里程计/朝向/定向视觉)+ **架构洞**(PI 核心是中央复合体**环吸引子**:递归、持续、环形拓扑的朝向 bump;5 类前馈分级节点诚实搭不出——唯一状态原语是*会衰减的*漏积分,Stone et al. 2017)。按 [[umwelt-honesty-cost]]:导航做成一等簇、分级补真硬件、PI 的墙老实标成 boss-fork。

**F-now — 化学面包屑归巢(现硬件可达,但不是 PI)**
- 行为:出巢路上 gland_α 留 ChemB,再循 ChemB 梯度回。配方:D1 留迹 + D2 循迹组合。可验:② · 依赖:D1、D2。
- **诚实红线**:这是 stigmergy/化学替代,**不是航位推算**——迹被抹就失效、不是向量、不能抄近路、要物理标路。文案/教程**绝不叫它 path integration**。是诚实、可达的「找到回家的路」的表亲。

**F0 — beacon taxis(需 H1 split-light)**
- 行为:朝亮/暗缝转。配方:**复用 B1 双侧差分**,源换 L/R 亮度。可验:③(需 H1)· 依赖:A1、H1。入门导航谜题。

**F1 — 朝向 decode + menotaxis(需 H3 原始偏振通道)—— ⚠ 墙就落在这一簇内部**
【brief】把"朝向"精确切成三段(= §1 公理7),墙落在 (b)→(c):
- **(a) 瞬时朝向 decode = 可搭谜题(前馈)**:原始正弦偏振通道 → 对侧 opponency(两正交通道之差 = 有符号正弦)→ 一小排不同偏好角的 opponent 单元 = 朝向群体码 → WTA(互抑)或除法归一 → 粗朝向读出。全在幅值 + 侧抑区。**最小的*真罗盘* Zach-like 谜题。** 源:Gkanias et al. 2019;Sakura et al. 2008;Stone 2017 的 TL→CL1→TB1 前端。
  - 诚实告诫:**180° 歧义**(e-vector 是轴非向)→ 加第二线索(强度/色彩梯度,真实由 anterior optic tubercle 整合)或当谜题;**星历时间补偿**(太阳移动)= 进阶。
- **(b) 离散朝向 HOLD = 可搭(互抑 flip-flop,N 离散态)**:短暂保持粗扇区,但只 N 态、有抖动/漂移。
- **(c) 连续抗漂、黑暗中积分角速度的朝向 = 墙**(环吸引子,搭不出)。
- **menotaxis**:有 (a)/(b) 的朝向后,持向 = 前馈 L/R 误差归零喂 A1。可验:③ · 依赖:A1、H3 · 源:Giraldo et al. 2018。

**F2 — 里程计(需 H4 odometer,会遗忘版)**
- 行为:走够距离 X 就停。配方:纯漏积分累距。可验:③ · 依赖:H4 · 源:Wittlinger et al. 2006(步幅积分「踩高跷」)。
- **诚实标注**:真 PI 距离记忆相当持久,我们只有漏积分→「会遗忘的里程」,记为已知模型分歧,不当 feature 装生物。

**F3 — view-based homing / 路线跟随(需 H5 视网膜阵列)**
- 行为:存视网膜快照,转动使当前视图 vs 存储视图失配最小(rIDF 谷底)。配方:familiarity = 存视 vs 当前视比较;**转向是前馈的**(Wystrach 侧化累加器);快照存储骑现有 modulator-gated 可塑。可验:③ · 依赖:A1、E2、H5 · 源:Ardin et al. 2016;Le Möel & Wystrach 2020;Buehlmann et al. 2020(MB 也是视觉路线学习地);Zeil et al. 2003(rIDF)。
- **★ 前馈胜利(【brief】核心建议)**:MB familiarity(Ardin 2016)= 稀疏 KC 编码(高阈兴奋 inter = 幅值 AND,合规非精细 timing)→ **一条 modulator 门控、depression 主导**的可塑边 → 单输出神经元;左右 MB 的 familiarity 差 = 前馈双侧转向(在 familiarity 上做 tropotaxis)。**无吸引子、无黑暗持久需求**,几乎 1:1 映射我们原语。情感高点:玩家诚实电路*直接就 work*。**优先 H5,胜过一头扎进全 PI。**

**F-loop — 双系统冗余(完整导航环)**
- 漏 PI(F4)+ view-based(F3)**并行,按可靠性加权**:向量长→信 PI;近巢/熟路→信 view。view 在近目标处**重置/校正** PI 漂移(PI 自己只会漏、纠不了自己)。→ 完整满足的导航环,**墙只被关在 PI 的朝向输入里**,两半都可搭。源:Wystrach, Mangan & Webb 2015;Hoinville & Wehner 2018;Müller & Wehner 2010(PI = landmark 学习的脚手架)。

**F4 — path integration(★ F-PI 由【brief】解决:做「PI with forgetting」,墙立着、教它)**
按 Stone et al. 2017 拆 buildability(该模型本就 rate-based、权重∈{−1,0,+1}、sigmoid,极贴我们原语):
- TL→CL1→**TB1**(朝向):前端前馈可搭,**TB1 = 环吸引子 = 唯一搭不出的核**(§1 公理7)。
- TN(速度):传感器,可搭。
- **CPU4(累加器)= 一排漏积分**,每朝向列累加被朝向门控的速度——**可搭,只要喂得进朝向 + 速度**。关键:Stone 模型自己的 CPU4 记忆**就是漏的**(显式 leak k=0.1)。
- Pontine:抑制归一,可搭。CPU1(转向):**前馈双侧差分**,最干净的可搭部分(= 比较当前 vs 目标朝向;Stone 等认为这"转向比较"可能是 PI 演化的祖先核心)。
- **结论:F-PI = 漏积分 home vector,是忠实不是妥协**——行为证据(Müller & Wehner 1994 隐藏螺旋;Merkle et al. 2006 搜索宽 ∝ 跑程;Sommer & Wehner 2004 距离系统性低估;"重复训练不改善积分器")说真 PI 本就漏、会"耗尽"。**叫它「PI with forgetting」,不叫 path integration。** 向量耗尽 → 涌现系统性搜索(F5)。
- **墙立着、做成教学**:让玩家拿离散 flip-flop 环试黑暗持向,亲历记录在案的失败模式(量化 360°/N / 漂向最近态 / 跳变 / 丢慢转),理解蚂蚁为何进化出专门结构。**可选进阶**:暴露 velocity copy-and-shift(E-PG/P-EN 式),让玩家发现没有精调递归兴奋撑 bump 它照样漂——最诚实的"差一点就成"。
- 可验:③ · 依赖:H3、H4、F1、F2 · 源:Stone et al. 2017(**蜂**脑 PI 电路,蜂非蚁,诚实引);Seung 1996 / Zhang 1996 / Noorman et al. 2024(墙的数学);Merkle/Lehrer/Wehner 系列(漏 PI 的行为证据)。详见【brief】。

**F5 — 系统搜索 + backtracking**
- 行为:home vector 耗尽但未到巢→以向量端点为心扩张螺旋。配方:A2 搜索振荡器 × PI(螺旋的*扩张*来自 PI 系统)。可验:③ · 依赖:F4(有向量端点才有意义)· 源:Müller & Wehner 1994。F4 定了再做。

### G. 感知扩展(扩硬件解锁,与 F 同期)

- **G1 温趋性(需 H2 温度)**:行为=选热区/避过热;配方=温度的**时间微分 motif**(同 B3)。源:Ruchty(蚁红外/热);Knecht/Garrity(果蝇温感)。
- **G2 湿趋性(需 H2 湿度)**:行为=趋湿避旱(抗旱头号);配方同上。源:Enjin et al. 2016。
- **G3 振动报警(campaign,需振动感 + 发声 actuator)**:我们完全缺的报警模态,可能比光更核心于「蚂蚁性」。源:Hölldobler & Wilson;Hill《Vibrational Communication》。

---

## 4. 相位顺序(roadmap 脊柱)

| 相位 | 内容 | 可验性 | 对齐 CLAUDE.md test |
|---|---|---|---|
| **P0** | 运动底座 A(先 A1 总线,再 A2/A3/A4/A5) | ① 编辑器纯电路(振荡/读数/成本) | — |
| **P1** | 第一闭环 + 时间微分教学谜题(B1、B3-klinokinesis、C1) | ① 拓扑/成本;行为待 P2 | test1(同侧抑制趋近)、test2(积分记忆) |
| **P2** | **嵌入里程碑**:chem_field ↔ editor ↔ body 接入 | 解锁②全部行为级验证 | — |
| **P3** | 反射全套(B2、C2、C3、E1、E1b) | ② 行为可验 | test4(调制状态依赖) |
| **P4** | 化学通讯 D + 多蚁涌现 + 化学面包屑归巢(F-now) | ② | **test7**(群体 ChemB 路径跟随) |
| **P5** | 学习 E2、E3 | ② campaign | **test5/6**(关联学习 / 学习+遗忘) |
| **P6** | 导航分级上(H1→F0、H3→F1、H4→F2、H5→F3)+ 感知扩展(H2→G1/G2) | ③ 扩硬件 | — |
| **P7** | path integration boss F4 + 系统搜索 F5 | ③ 待 F-PI 决定 | — |
| campaign 远期 | 振动报警 G3、no-entry D4、同巢识别(CHC)、trophallaxis、grooming、风/anemotaxis | 需新硬件/新化学/伙伴蚁 | — |

P0 现在就能在编辑器开工(纯电路);P1 起的「行为」验证都卡在 P2 嵌入里程碑——这是诚实的依赖,不藏。test 3(互抑振荡)在 P0 的 A2 即可验。

---

## 5. Forks routed to review(必须你/review 拍,我不用工程默认糊弄)

| ID | 岔口 | 我的推荐 |
|---|---|---|
| **F-LEARN** | 可塑规则的 `post` 因子 + 增强/抑制方向(触 CLAUDE.md 写死的 `η·pre·post·mod`) | **【brief】+ 学习子代理双独立证实:depression 主导 + modulator 门控 + 突触前**(Hige 2015)。强烈倾向改 `pre·mod`、默认 depression(view-homing F3 也要这个);若留三因子则**明标工程便利、非 MB 生物** |
| **F-PI** | path integration 的环吸引子墙 | **已由【brief】解决** → 做漏「PI with forgetting」(比完美 PI 更忠实:Stone CPU4 本就 leak k=0.1、蚁行为本就漏)。墙(TB1 环吸引子)**立着做教学**,不加环吸引子原语。绝不叫 path integration |
| **F-COMPASS** | 给算好的朝向标量 vs 给原始偏振通道 | **【brief】:给原始偏振 opponent 通道**(忠实 DRA),朝向 decode 当谜题;给标量 = 埋了"光学不是谜题"的决定且接近直接给答案。180° 歧义 + 星历当进阶/谜题 |
| **F-WIND** | 湍流羽流追踪需风感 | 化学场保持层流,osmotropotaxis 为唯一觅食机制;风留 campaign |
| **F-WEBER** | 转向 (L−R) vs (L−R)/(L+R) 归一 | 接受 raw (L−R) 够用;modulator 除法增益作进阶解 |
| **F-ALARM** | 剂量依赖报警反转(感知非线性) | 留作硬谜题(高阈 inter_inh 覆盖低剂量趋向);确认传感器锥动态范围够 |
| **F-NOENTRY** | no-entry 排斥迹需地面第二极性 | 接受 GAP 或用第二种持久化学物当排斥;别默认单腺两用 |
| **F-CHC** | 同巢识别需 CHC 颜色签名化学物 | 缺失原语,非 4 化学可导出;要做须加 CHC 通道,记为 campaign |
| **F-REVERSE** | 无倒车 → 转身逃替代(A5) | 接受(可辩护),记此处是有意模型选择 |

---

## 6. 硬件 GAP 汇总

| 模态 | 对蚁的核心度 | 现状 | 需要什么 | 忠实? | 相位 |
|---|---|---|---|---|---|
| 朝向罗盘(偏振) | 极高(PI 前提) | GAP | compass 1ch(建模 CX 输出,非光学) | 忠实(实现标 ESTIMATE) | P6 |
| 里程计 | 极高(PI 前提) | GAP | 自运动 1ch | 忠实(但只能「会遗忘」) | P6 |
| 定向视觉(复眼阵列) | 高 | GAP | 视网膜亮度阵列 N ch | 忠实 | P6 |
| 温度 | 高(热调节) | GAP | 温度 1ch(sacculus) | 忠实 | P6 |
| 湿度 | 高(抗旱) | GAP | 湿度 1ch(sacculus) | 忠实 | P6 |
| 基质振动 + 发声 | 高(社会报警) | GAP | 振动感 + stridulation 马达 | 忠实 | campaign |
| 风/气流 | 中(羽流追踪) | 软 GAP | 风场 + 触角风感 | 忠实 | campaign |
| CO₂ | 中(育幼/巢气候) | GAP | CO₂ 1ch(非适应) | 忠实 | campaign |
| 重力/坡度 | 中(平面上 moot) | GAP | 颈/柄毛板 | 忠实 | 仅地形玩法时 |
| 磁感 | 低(远程专门) | GAP | 磁罗盘 | 忠实但小众 | skip |
| 甜/苦对立味觉 | 中(取食) | 部分 GAP | 第二味觉极性 | 忠实 | 看 C2 fork |
| 同巢 CHC 签名 | 高(社会) | GAP | CHC 通道 | 忠实 | campaign(F-CHC) |
| 倒车马达 | 中 | GAP(有意) | reverse motor | — | 转身逃替代 |

**红线重申(§1/§2)**:绝不给单眼亮度编方向、绝不加 home-vector「答案」传感器、绝不加第 6 类节点/环吸引子原语。

---

## 7. 引用(按域,均经子代理 web 核实)

**Odor 导航(B/D)**:Hangartner 1967 (*Z. vergl. Physiol.* 57); Draft, McGill, Kapoor & Murthy 2018 (*J. Exp. Biol.* 221:jeb185124); Perna et al. 2012 (*PLoS Comput. Biol.* 8:e1002592); Jackson, Holcombe & Ratnieks 2004 (*Nature* 432:907); Wolf & Wehner 2000 (*JEB* 203:857); Buehlmann, Hansson & Knaden 2014 (*Curr. Biol.* 24); Mohamed, Hansson & Sachse 2019 (*Front. Physiol.* 10:851); Steck, Knaden & Hansson 2010 (*Anim. Behav.* 79:939); Steinbeck et al. 2022 (*Neural Comput.* 34:2205); Hölldobler & Wilson 1990 *The Ants*.

**Locomotion(A)**:Brown 1911 (*Proc. R. Soc. B* 84:308) / 1914 (*J. Physiol.* 48:18); Marder & Bucher 2001 (*Curr. Biol.* 11:R986); Bidaye, Bockemühl & Büschges 2018 (*J. Neurophysiol.* 119:459); Mantziaris et al. 2020 (*Dev. Neurobiol.* 80:16); Schilling et al. 2013 (*Biol. Cybern.* 107:397, Walknet); Drosophila 下行转向 2024 (eLife/PMC10614758); Bidaye et al. 2014 (*Science*, MDN 倒车); Geurten et al. 2014 (*Front. Behav. Neurosci.* 8:365); Müller & Wehner 1994 (*J. Comp. Physiol. A* 175:525); Popp & Dornhaus 2023 (*iScience* 26:105916); 蚁 CX lesion(Schultheiss/Wystrach 群 2023, *J. Comp. Physiol. A*)。

**学习/蘑菇体(E)**:Fiala & Kaun 2024 (*Learn. Mem.* 31:a053827); Hige, Aso, Modi, Rubin & Turner 2015 (*Neuron* 88:985); Aso et al. 2014 (*eLife* 3:e04577); Wissink & Nehring 2021 (*JEB* 224:jeb242732, **ant**); Schwaerzel et al. 2003 (*J. Neurosci.* 23:10495); Burke et al. 2012 (*Nature* 492:433); Villar et al. 2020 (*Cell Rep.* 30:2603); Felsenberg et al. 2018 (*Cell* 175:709); Berry et al. 2015 (*PNAS*); Buehlmann et al. 2020 (*Curr. Biol.* 30, 视觉路线 MB); Collett, Collett & Wehner 1998 (*Nature* 394:269)。

**化学通讯(D)**:Wilson 1962 (*Anim. Behav.* 10:134, 火蚁三部曲); Wilson & Bossert 1963 (*Recent Prog. Horm. Res.* 19:673); Czaczkes, Grüter & Ratnieks 2015 (*Annu. Rev. Entomol.* 60:581); Morgan 2009 (*Physiol. Entomol.* 34:1); Robinson, Jackson, Holcombe & Ratnieks 2005 (*Nature* 438:442, no-entry); Li et al. 2019 (*Insects* 10:451); Greenwald, Segre & Feinerman 2018 (*eLife* 7:e31730); Basari et al. 2014 (*Sci. Nat.* 101:549, tandem)。

**空间导航(F)**:Wittlinger, Wehner & Wolf 2006 (*Science* 312:1965) / 2007 (*JEB* 210:198); Ronacher & Wehner 2000 (*JEB* 203:1113); Pfeffer & Wittlinger 2016 (*Science* 353:1155); Lebhardt & Ronacher 2012 (*JEB* 215:526); Labhart & Meyer 1999 (*Microsc. Res. Tech.*); Homberg(综述 PMC3049008); Stone, Webb, Wystrach, Heinze et al. 2017 (*Curr. Biol.* 27:3069, **蜂脑**); Seelig & Jayaraman 2015 (*Nature* 521:186); Kim et al. 2017 (*Science* 356:849); Giraldo et al. 2018 (*Curr. Biol.*); Ardin et al. 2016 (view-based, PMC4829585); Wystrach & Le Moël 2020 (bioRxiv 2020.08.13.249193); Müller & Wehner 1994。

**导航深化(【brief】:朝向墙的数学 / 漏 PI / 偏振罗盘 / view-homing 冗余)**:Seung 1996 (*PNAS* 93:13339, line attractor 需精调); Zhang 1996 (*J. Neurosci.* 16:2112, even/odd 权重分解); Noorman et al. 2024 (*Nat. Neurosci.* 27:2207, 少数神经元的角积分 / 零特征值); Green et al. 2017 (*Nature* 546:101) & Turner-Evans et al. 2017 (*eLife* 6:e23496, copy-and-shift); Pisokas, Heinze & Webb 2020 (*eLife* 9:e53985, fly+locust 环路对比); Song & Wang 2005 (*J. Neurosci.* 25:1002, 无递归兴奋的移动山); Gkanias et al. 2019 (*PLOS Comput. Biol.* 15:e1007123, 偏振罗盘模型); Sakura, Lambrinos & Labhart 2008 (*J. Neurophysiol.* 100:469, 蟋蟀 POL1 三型); Heinze & Homberg 2007 (*Science* 315:995, 蝗 e-vector 图谱); Ardin et al. 2016 (*PLOS Comput. Biol.* 12:e1004683, MB 路线记忆); Le Möel & Wystrach 2020 (*PLOS Comput. Biol.* 16:e1007631, 视觉记忆对立过程); Zeil et al. 2003 (*JOSA A* 20:450, rIDF); Merkle, Knaden & Wehner 2006 (*JEB* 209:3545, 搜索宽 ∝ 跑程); Sommer & Wehner 2004 (距离低估); Müller & Wehner 2010 (*Curr. Biol.* 20:1368, PI=landmark 脚手架); Wystrach, Mangan & Webb 2015 (*Proc. R. Soc. B* 282:20151484, 最优线索整合); Hoinville & Wehner 2018 (*PNAS* 115:2824); Burgess 2008 (*Hippocampus* 18:1157, 振荡干涉——**本模型 sub-tick 约束下出局**)。源汇于用户研究 brief。

**其余反射 + 缺失模态(B3/C/E/G)**:Tracey et al. 2003 (*Cell*, painless); Babcock, Landry & Galko 2009 (*Curr. Biol.*); Khuong et al. 2019 (*Sci. Adv.*); Humberg & Sprecher 2020 (bioRxiv 2020.01.06.896142); Chen & Engert 2014 (*eLife*, ESTIMATE); Camhi & Johnson 1999 (*JEB*); Krause & Dürr 2012 (*Front. Behav. Neurosci.*); Dethier 1976 *The Hungry Fly*; Gelperin 1967 (*Science*); Min et al. 2021 (*eLife*, Piezo); Yang et al. 2015 (*PNAS*, OA 饥饿); Enjin et al. 2016 (*Curr. Biol.*, 湿度); Römer et al. 2018 (*J. Insect Physiol.*, CO₂); Fleischmann et al. 2024 (*Curr. Biol.*, 磁罗盘)。

> 跨 taxa 处已标 ESTIMATE。蚁特异薄弱处主要在*细胞机制*(果蝇/蜂主导)、丰富处在*行为/时间尺度*。Stone et al. 2017 是蜂脑(同组主张守恒,诚实引)。

---

## 8. 下一步

1. **你审本 roadmap** —— §5 fork 表里:**F-PI / F-COMPASS 已由你的 brief 解决**(漏「PI with forgetting」+ 原始偏振通道、decode 当谜题、墙立着教),**F-LEARN 双独立证实**(倾向改 `pre·mod` + depression 主导)。**剩待你点的**:F-WIND / F-WEBER / F-ALARM / F-NOENTRY / F-CHC / F-REVERSE,加 §2.2 扩硬件账本够不够。
2. fork 拍板后(尤其 **F-LEARN 触 CLAUDE.md 写死的可塑规则**),把定论回写 CLAUDE.md 相关节:可塑规则、扩硬件清单、导航的"墙"作为正式设计声明(诚实付代价、做成教学)。
3. P0(运动底座 A,先 A1 转向总线)是现编辑器纯电路就能开工的——若要从纸面转手搭,这是入口。
4. (可选)这份 brief 文件名是工具自动生成的,要的话我把它挪成 `docs/research/2026-06-02-navigation-wall-brief.md` 之类,引用更稳。
