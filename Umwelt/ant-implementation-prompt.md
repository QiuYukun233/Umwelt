读取项目根目录的 CLAUDE.md 和 ant-design-spec.md，然后按以下顺序改造项目。每完成一步，运行验证后再进入下一步。不要一次性改完所有东西。

---

## 第一步：封存线虫，创建蚂蚁骨架

1. 确认 src/creatures/nematode.js 存在，不动它。
2. 创建 src/creatures/ant.js，结构参照 nematode.js，但：
   - 运动模型替换为 forward + turn_L + turn_R（删除正弦波蠕动）
   - 传感器布局按 ant-design-spec.md 第 3 节定义（14 通道）
   - 执行器布局按 ant-design-spec.md 第 4 节定义（6 通道）
3. 修改入口文件，将默认生物从 nematode 切换为 ant。
4. 验证：蚂蚁在画面上出现并能前进和转向，传感器和执行器节点可以在 UI 上看到。

---

## 第二步：蚂蚁渲染

1. 替换线虫的正弦波蠕动渲染，画一个简化的蚂蚁俯视图：
   - 三段身体（头/胸/腹）用椭圆表示
   - 两根触角从头部前端向左前方和右前方伸出
   - 六条腿从胸部两侧伸出（简单线段即可）
   - 一对大颚在头部前端
2. 触角的张角可视化反映 cone sampling 的采样区域。
3. 验证：蚂蚁外观正确，运动时身体朝向跟随转向变化。

---

## 第三步：化学场写入支持

1. 改造 ChemicalField 类，目前只支持环境预设源，需要新增：
   - `writeAt(x, y, chemType, amount)` 方法，允许生物体向化学场的指定位置写入指定化学物质
   - 化学场从单一类型扩展为支持 4 种独立化学物质（ChemA/B/C/D），每种有独立的 diffusion_rate 和 decay_rate
2. 在蚂蚁的 update 循环中，当 gland_α 的 motor 节点输出 > 阈值时，调用 writeAt 在蚂蚁当前位置写入 ChemB。gland_β 同理写入 ChemC。
3. 给每个腺体加储量系统：capacity（最大值）、current（当前值）、recovery_rate（每 tick 恢复量）。分泌时消耗 current，耗尽则不分泌。
4. 验证：手动给 gland_α 的 motor 节点接一个恒定信号，蚂蚁走过的路径上应该出现 ChemB 的痕迹。痕迹应逐渐扩散和衰减。持续分泌一段时间后储量耗尽，痕迹中断，等待恢复后继续。

---

## 第四步：多化学通道传感器

1. 修改触角传感器，从单一化学通道扩展为 4 通道（对应 ChemA/B/C/D）。
2. 每个通道独立做 cone sampling，读取对应化学物质在采样区内的浓度。
3. 每个通道绑定一个独立的 sensor_on 节点。
4. 验证：放置一个 ChemA 食物源和一个 ChemB 痕迹，确认对应通道的 sensor_on 节点有正确的分级输出，其他通道保持静默。

---

## 第五步：可塑突触

1. 在连接数据结构中新增属性：
   - `plastic: boolean`（默认 false）
   - `w_init: number`（初始权重，plastic=true 时由玩家设定）
   - `modulator_id: string | null`（绑定的 modulator 节点 ID）
   - `learning_rate: number`（默认 0.01）
   - `decay: number`（默认 0.001）
   - `w_min, w_max: number`（由 Dale's Law 自动推断）
2. 在神经网络的 update 循环中，对所有 plastic=true 的连接执行：
   ```
   pre = nodes[conn.from].output
   post = nodes[conn.to].output
   mod = nodes[conn.modulator_id].output  // 如果绑定了 modulator
   
   dw = conn.learning_rate * pre * post * mod
   conn.weight += dw
   conn.weight += conn.decay * (conn.w_init - conn.weight)
   conn.weight = clamp(conn.weight, conn.w_min, conn.w_max)
   ```
3. 在 UI 上可塑连接用虚线显示（区别于固定连接的实线），连接旁显示当前权重值的实时变化。
4. 验证：
   - 创建一条可塑连接，绑定一个 modulator。当 pre、post、mod 三者同时活跃时，权重增大。任一为零时权重不变。
   - 停止 mod 信号后，权重缓慢向 w_init 衰减。
   - 权重不超过 w_max，不低于 w_min。

---

## 第六步：多个体支持

1. 允许同时存在多只蚂蚁实例，共享同一个化学场。
2. 每只蚂蚁独立运行自己的神经回路，但使用相同的回路设计（相同的接线图，独立的节点状态和突触权重）。
3. 所有蚂蚁的腺体输出写入同一个化学场，所有蚂蚁的触角从同一个化学场读取。
4. 性能目标：10 只蚂蚁同时运行时帧率不低于 30fps。
5. 验证：放出 10 只使用相同回路的蚂蚁，放置一个食物源。如果回路正确接了 ChemA 趋化 + gland_α 沿途分泌 ChemB + ChemB 趋化，应该看到蚂蚁逐渐涌现出类似蚁道的路径。

---

## 注意事项

- 每一步完成后先提交，不要把所有改动积压在一起。
- 不要引入任何语义层的命名。代码里不出现 "food_pheromone"、"alarm_signal"、"trail" 这类词。化学物质用 ChemA/B/C/D，腺体用 gland_α/gland_β，传感器用 L_chem_A / R_touch 这类物理命名。
- 不要为了"用户体验"添加系统没有定义的内置行为。蚂蚁的所有行为必须完全由神经回路决定。没接线的蚂蚁应该什么都不做。
- 遇到不确定的设计决策时，重新读 CLAUDE.md 中的设计宪法，用三条原则检验。
