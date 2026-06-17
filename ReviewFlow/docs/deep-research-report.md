# Business Dataflow Review Tool 深度研究与产品规格草案

## 结论先行

你这个方向最值得押注的，不是“代码可视化”，而是**面向 reviewer 的业务执行取证工具**。更准确的表述可以是：

> **一个把 endpoint 的业务执行过程还原成可追溯证据链的 review 工具。**  
> 它回答的不是“代码长什么样”，而是“这段后端业务在一次请求里会读什么、改什么、在什么条件下分叉、哪里会抛错、何时产生副作用，而且这些判断分别由哪些源码位置与哪些运行时证据支撑”。

这个定位比 “Business Dataflow Review Tool” 更锋利，因为它把价值锚在 reviewer 的真实任务上：**快速、可信地判断代码是否改错表、漏异常、乱加副作用**。Google 的代码评审实践把目标定义为持续提升 code health，并强调评审应以技术事实和数据为依据，同时还要尽量保持快速和可扩展；Whyline 的研究也表明，开发者真正关心的核心仍然是代码本身，表示层应该服务于代码理解，而不是取代代码。CodeSee 证明了“按一个主题组织一张图”和“用 tour 讲一个 flow”对 onboarding 与 review 有帮助；Datadog 的 Trace View 则证明了时间顺序、waterfall、flame graph 对理解请求执行路径很有效。你的产品最好的楔子，就是把这些能力拼成一个**业务行为审查层**，但把核心单位从“代码结构”换成“业务执行证据链”。citeturn40view0turn40view1turn32view0turn21view0turn21view2turn21view4

所以我建议你对外不用强调“可视化”，而强调三件事：

第一，它是 **review tool，不是 map tool**。CodeSee 类型工具更擅长仓库结构导航与 review chunking；你要解决的是“这次请求到底改了什么业务事实”。citeturn21view0turn21view2turn21view1

第二，它是 **execution evidence tool，不是 APM**。Datadog/Sentry 这类 tracing 工具能很好回答“发生了什么 span、耗了多少时长”，但不会天然给出“Order.status 从什么变成什么”“这个副作用与哪次数据库写入存在事务先后关系”。citeturn21view4turn13search0

第三，它是 **source-backed，而不是 AI summary-first**。Google 的 code review 原则里，“technical facts and data overrule opinions”；静态分析领域关于 soundiness 的论文也明确指出：真实世界的 whole-program analysis 往往都会做不完备假设，所以如果不把不确定性说清楚，用户很容易被误导。你的产品必须把“证据链可回跳源码”和“未知就显示未知”做成品牌资产。citeturn40view0turn35view0turn35view0turn36view1

如果你愿意微调命名，我会建议：

- **外部产品定位**：**Business Logic Execution Review**
- **内部技术内核**：**Source-backed Dataflow Replay**
- **一句话 slogan**：**Review business behavior, not just code diffs.**

## 核心交互模型

你现在提出的 Graph、State Table、Replay 三层是对的，但**默认入口不应该是图，而应该是“可证据回放的业务步骤列表”**。图是结构索引，表是状态证据，回放是时间轴；真正让 reviewer 快的是一个**storyboard-first** 的界面，而不是先丢给他一张图。Whyline 的设计非常值得借鉴：它强调表示层要紧贴代码，支持随机访问、同时显示数据与控制依赖，而且默认只展示那些“单靠读源码还不足以快速回答”的事件。citeturn32view0

我建议你的默认主视图是一个 **Operation Ledger**，也就是“业务步骤账本”。每一行不是 AST 节点，而是 reviewer 真正在意的业务操作：

- 读入请求参数
- 读取 `Order`
- 检查 `Order.status !== "PENDING"`
- 开启事务
- 更新 `Order.status`
- 写入 `Audit`
- 调用支付/发消息/发邮件
- 抛出异常或返回响应

每个步骤卡片都应该只回答五个问题：**做了什么、作用于谁、前后差异是什么、证据在哪里、确定性如何**。这比一上来画 controller/service/repository 全图更像 reviewer 的工作流，也更符合 Google 对“快而有效”的 review 目标。citeturn40view0turn40view1

你提到的“搬运操作表格动画”，我建议不要做成花哨的轨迹动画，而做成**状态变化显微镜**：

- **默认只高亮 touched fields**。Whyline 明确提到，好的可视化不应该把所有中间值都展示出来，而是只展示那些不能靠阅读源码轻松推出的关键信息。对你来说，这意味着不要把整个 `Order` 对象全量展开去动画，而是只显示 `status`, `confirmedAt`, `updatedBy`, `version` 等被读写或参与判断的字段。citeturn32view0
- **把 “before / patch / after” 做成三段式**。左列是进入步骤前的已知状态，中列是本步骤施加的 patch，右列是离开步骤后的状态。这样 reviewer 一眼就能看出“这一步只是搬运”“这一步是真的改字段”“这一步只是判定，没有改值”。
- **显式区分 `unchanged`、`omitted`、`unknown`**。这点在 Prisma 下尤其重要，因为 Prisma 文档明确说明：如果把 `undefined` 传给字段，它不会被包含进生成的 query，这可能造成意外结果甚至数据丢失；Prisma 还建议启用 `strictUndefinedChecks`，把“显式 undefined”变成运行时错误，并用 `Prisma.skip` 表示跳过字段。你的表格如果不把“没有修改”和“因为 undefined 被忽略掉了”区分开，reviewer 会被严重误导。citeturn26view0
- **集合不要逐行动画，先做聚合摘要**。例如 `updateMany`、`deleteMany`、批量 relation writes 这类操作，先显示“影响行数 / where 条件 / 关键字段 diff 规则”，需要时再 drill down。否则 UI 会被高基数数据拖垮。Prisma 的事务与批量操作文档本身就把 batch operations、nested writes、interactive transactions 分为不同层次，你的 UI 也应该保持这样的层级感。citeturn39view0

Graph、State Table、Replay 的职责，我建议这样切：

**Graph 负责结构。**  
它回答“有哪些业务步骤、哪些依赖谁、哪些条件会改变路径、哪些资源会被触达”。底层思想可以借鉴 PDG：把数据依赖和控制依赖都显式化，但显示层不要直接暴露编译器级节点，而要提升为业务 step。CodeQL 也说明了，成熟的代码分析系统会同时持有 AST、data flow graph 和 control flow graph，并且能把查询结果解释成源码中的单点或路径位置。你的 Graph 应该是这些底层图的**业务级投影**。citeturn31view0turn17view0

**State Table 负责业务事实。**  
它回答“哪个实体、哪个 DTO、哪个 query payload 发生了什么变化”。这里不要试图做“整个内存状态表”；只保留 review-relevant projections：请求输入、已加载实体、待写入 payload、外部调用 payload 摘要、异常对象摘要、事务状态。Whyline 专门强调过：只展示对当前问题有帮助的信息，而且在不熟悉代码或不重要的片段上采取 black box/collapse，是提升可读性的关键。citeturn32view0

**Replay 负责时间顺序。**  
它回答“实际执行顺序是什么、哪条支路被走到、事务何时开启/提交/回滚、错误在何处冒泡、外部调用与 DB 写入先后关系如何”。这部分更像 Datadog 的 waterfall，但要换成业务语义的 step timeline，而不是 span-only timeline。Datadog 文档本身就把 flame graph 归因于 execution path，把 waterfall 归因于按时间隔离相关 span；你可以沿用这个思路，但把 span 名改造成 review-friendly 的业务操作名。citeturn21view4

为了避免图爆炸，我会非常强硬地建议你遵守这几个约束：

- **一张图只讲一个 endpoint / use case**。CodeSee 的最佳实践明确建议 one topic, one map。你这里的一 topic，就是一次业务执行单元。citeturn21view0
- **默认折叠 utility / framework / 低价值链路**。CodeSee 的 map 默认大量目录折叠，并支持隐藏无关文件；Whyline 也只在选中某个 container 时显示边界，否则会出现“几十个矩形包围一切”的噪声。citeturn21view1turn32view0
- **默认隐藏未选中链接**。CodeSee 的 Review Map 明确支持 “Hide links between files” 来降低视觉噪音，这一点在你的业务图上更应该是默认，而不是设置项。citeturn21view2
- **节点上限要被产品策略硬控**。图形可视化研究的经典结果之一是：当图规模变大以后，matrix 往往在大多数任务上优于 node-link，而 node-link 持续占优的主要是 path finding。换句话说，你的 Graph 适合做“局部路径图”，不适合做“整个 endpoint 的所有可能细节图”。密度一高，就该把信息下沉到 State Table、列表和 facet filter。citeturn30search4

## 可信度与不确定性

这一类工具最大的生死线不是“炫”，而是**不能给 reviewer 造成虚假的确定感**。这一点，学术和工程文献都给了非常清楚的提醒。

一方面，静态分析领域关于 soundiness 的宣言指出：真实世界中，想同时兼顾 soundness、precision、scalability 几乎总要妥协；很多 whole-program analysis 都会对复杂语言特性做有意识的不完备处理，而且作者呼吁必须**明确指出不完备来自哪里、影响范围是什么**，否则读者会误以为分析是 sound 的。另一方面，JavaScript 静态分析研究也反复指出，JS 的动态特性会显著降低静态分析性能和精度，因此把动态分析引入静态分析来做互补，是现实工程路径。citeturn35view0turn36view1turn37view1

所以，你不应该做一个单一的 0–100 confidence 分，而应该做一个**四维可信度模型**：

- **Reachability**：这一步会不会发生  
- **Entity Identity**：作用对象是不是这个实体/这张表  
- **Field Patch**：字段变化是否可精确确定  
- **Source Anchor**：结论能否回跳到明确源码位置

只有当四个维度都强时，才能把步骤渲染成“确定”。否则就应该分层表达。

我建议把 UI 上的确定性状态固定成四类，而不是做连续色阶：

- **Observed**：运行时确实观察到，而且已与源码位置关联  
- **Exact Static**：静态上可精确建模，但当前 trace 未覆盖到  
- **Approximate**：静态上有路径/效果推断，但依赖 summary/fuzzy model/别名近似  
- **Unknown**：无法可靠说明，或仅知道“有副作用/有写入”，不知道精确字段

这样 reviewer 一眼就知道自己看到的是“事实”“推断”“近似”还是“未知”。这也和 CodeQL 的建模方式很接近：它支持 `sourceModel`、`sinkModel`、`typeModel`、`summaryModel`、`barrierModel` 等扩展谓词来补模型，而且文档明确说明 fuzzy model 更简单，但代价就是**approximate**。你完全可以把自己的不确定性表达借鉴成产品语言。citeturn18view0turn17view0

具体到 Node.js + Express + Prisma，我会把以下情况强制标成 `Approximate` 或 `Unknown`：

- 动态 property access 无法收敛到稳定 key
- `eval`、dynamic code loading、opaque native / non-analyzed code
- 原生 SQL / query builder 绕过 Prisma model 语义
- 自定义 repository wrapper 尚未建模
- 某个字段是经复杂对象 spread / merge / mapper 产生，无法还原来源
- 只拿到了 Prisma query event 的 SQL，但没有精确映射回模型字段

Soundiness 文献甚至点名了 JavaScript 中 `eval`、dynamic code loading 以及 through-DOM data flow 这类典型难点；这些特性如果不被正确建模，会导致大量执行行为直接“消失”在分析结果之外。你的产品必须把这种风险前置到 UI，而不是藏在帮助文档。citeturn35view0turn36view1

更进一步，我建议你做一个**Evidence Panel** 作为所有节点的右侧抽屉，而且把它做成强制性的。任何一个步骤点开后，都应该能看到：

- 相关源码位置 `file:startLine-endLine`
- 生成此节点的规则或模型名
- 相关静态路径片段
- 相关 runtime trace / span / log / query event
- 最后一次被运行时验证的时间与样本数
- 未覆盖原因或降级原因

Whyline 的一个关键设计点就是：选中执行事件时，系统会自动把相关 source files 打开、滚动到对应行，并把相关 data/control dependencies 一并显露出来，还通过动画保持用户方位感。你的 Evidence Panel 就应该是 review 场景下的 Whyline 化。citeturn32view0

这里还有一个非常关键的规范：**不确定字段变化，绝不能假装确定。**  
例如：如果你只能确认“`Order` 这行被 update 了”，但不知道具体 set 了哪些列，那么 State Table 里就必须显示为：

- `scope = row-level write confirmed`
- `field-level patch = unknown`
- `evidence = prisma:engine:db_query + source anchor`

而不是伪装成 `status: PENDING -> CONFIRMED`。这条纪律本身，比任何 UI 动画都更重要。citeturn42view0turn43view0turn35view0

## 静态分析与运行时架构

在技术路线层面，我不建议你一开始就追求“通用 JS whole-program analyzer”。更现实的做法是：**做一个端到端约束明确的 endpoint slicer**，借鉴 CodeQL/PDG/OTel/Whyline 的思想，但实现上以你锁定的 Node.js + Express + Prisma 约定为中心。

原因很简单。JS/TS 静态分析在真实项目上本来就会被动态特性拖累；关于 JavaScript static analysis 的研究明确指出，语言的动态与函数式特征会降低静态分析的性能与精度，host environment 与 opaque code 还会带来大量人工建模成本。Soundiness 的讨论则进一步说明，工业级 whole-program analysis 往往都会在复杂特性上做不完备假设。与其一开始宣称“理解你的所有 Node 项目”，不如在 MVP 阶段明确要求：**只支持 TypeScript 优先、Express 路由注册是字面量、Prisma 调用走约定路径、自定义 side-effect wrapper 需要配置模型**。citeturn37view1turn35view0turn36view1

静态侧，我会建议你按下面的顺序做：

**先做 endpoint discovery。**  
Express 路由层要识别 `app.METHOD()`、`router.METHOD()`、`app.all()`、`router.use()` 等注册方式。Express 官方文档明确说明：一个 route method 可以有多个 callback；middleware stack 中还存在 `next('route')` 与 `next('router')` 这种会改变执行路径的特殊跳转；Express 5 下，返回 Promise 的 handler/middleware 若 reject 或 throw，会自动调用 `next(value)` 进入错误链。也就是说，**在 Express 里，路径改变并不只来自 `if`，还来自 middleware 栈控制流**。这必须反映到你的 Graph 与 Replay 里。citeturn45view2turn46view0turn46view1turn46view2turn46view3turn46view4

**再做 bounded call chain extraction。**  
不要试图做开放世界调用图；只追：
`route -> controller -> service -> repository -> prisma/external client`
这类按 import/export 与显式调用可收敛的链路。遇到高阶函数、动态 dispatch、runtime injection、字符串拼路由、反射式调用，一律降级标记。CodeQL 的价值不一定在于直接内嵌，而在于它证明了这种“数据库化的语义表示”是可行的：它会提取 AST、语义信息、data flow graph、control flow graph，并把结果解释成单点或一串路径位置。对你的 MVP 来说，更适合“借概念，不搬整套重引擎”。citeturn17view0turn17view1

**然后做 Prisma 语义识别。**  
Prisma 这块要特别注意版本现实：Prisma ORM v7 已经移除了 client middleware，官方建议改用 Client Extensions；而且 Prisma 自己把“给所有日志附 request id 便于关联分析”列为了 extensions 的典型用例。这对你非常有利：你应该把 runtime 插桩建立在 **AsyncLocalStorage + Prisma Client Extensions** 上，而不是依赖已经被移除的 `$use` middleware。citeturn26view3turn26view2turn44view0

**最后做一个统一的 Behavior IR。**  
底层不一定叫 graph JSON，但我建议语义上至少要有这些原子类型：

- `request.input`
- `guard`
- `db.read`
- `db.write`
- `state.patch`
- `external.call`
- `exception.throw`
- `exception.catch`
- `transaction.begin`
- `transaction.commit`
- `transaction.rollback`
- `response.return`
- `unknown.effect`

这样前端层的 Graph、State Table、Replay 才有共同数据底座，而不是各做各的转换。

运行时侧，不要把 tracing 只当性能监控，而要把它当作**静态分析的证据补全层**。OpenTelemetry 的 JS 文档明确建议：可以先用 automatic instrumentation 起步，再用 manual instrumentation 丰富业务代码中的关键语义；并且 SDK 必须在其他应用模块加载之前初始化，否则库拿到的是 no-op tracer。Express instrumentation 还明确写了一个 caveat：由于 Express 的工作方式，异步 middleware/handler 的 span 时长很难自动正确计算，自动 instrumentation 往往只能代表同步执行时间，而不包括异步工作。这意味着你不能只靠自动 span；你还需要在业务边界上加自己的逻辑 step span。citeturn41view0turn24view0

我建议 runtime trace 最小记录这些事件：

- **HTTP request start / end**：方法、匹配到的路由模板、状态码、trace id、request id；HTTP 语义约定里对 `http.request.method`、`server.address`、`url.full` 等属性都有标准化定义。citeturn7view2
- **logical step enter / exit**：不是每个函数都打，而是在 controller/service/repository/external wrapper/transaction scope 上打逻辑 step span；理由是 OTel 推荐“自动 + 手动结合”，而 Express 自动 span 对异步时长并不可靠。citeturn41view0turn24view0
- **branch evaluated**：条件源码位置、条件值、进入了哪个后继；此外，把 `next('route')` / `next('router')` 也当作 branch-like control event 记录下来。citeturn46view0turn46view2
- **Prisma operation / query**：Prisma tracing 文档说明，一次 Prisma operation 会有 `prisma:client:operation` 父 span，内部会包含 `prisma:engine:db_query` 等 child spans；query logging 还可通过 `$on("query")` 拿到 `e.query`、`e.params`、`e.duration`。这对回放“读表/写表/耗时/SQL 证据”非常关键。citeturn42view0turn42view2turn43view0
- **transaction begin / commit / rollback**：Prisma 交互式事务在 tracing 中有单独的 `prisma:client:transaction` 根 span；官方还明确说抛异常会自动 rollback。你的回放必须把事务 envelope 画出来。citeturn42view2turn39view0
- **exception throw / catch / handled / rethrow**：Express 5 对 rejected promise 会自动转进 `next(value)`，而 `next(err)` 会跳过非错误处理链；Prisma 也有 `PrismaClientKnownRequestError`、`PrismaClientValidationError` 等不同错误类型。reviewer 不止要知道“会报错”，还要知道“在哪里被接住、会不会吞掉”。citeturn46view3turn46view4turn26view1
- **external call start / end**：HTTP method、sanitized URL、目标服务、状态码、错误类型、时长。HTTP 语义约定里明确了 `url.full` 应去除 credentials、并对敏感 query parameters 做清洗。citeturn7view2
- **side-effect emit**：消息队列、邮件、webhook、缓存失效、事件总线等。这个未必能完全依赖标准 instrumentation，更多要靠你让用户配置 wrapper model 或 SDK model。这里可以借鉴 CodeQL 的 `source/sink/summary/barrier` 思路来做可扩展建模。citeturn18view0

还有两点是工程上不能省的。

**其一，必须做 request context propagation。**  
Node 的 `AsyncLocalStorage` 是稳定 API，官方明确说它适合把状态贯穿整个 web request 的异步生命周期，而且示例就是“给每个 HTTP request 分配 ID，并在链路中的日志里带上这个 ID”。Prisma Client Extensions 文档也把“给所有日志附一个独特的 request id，之后便于关联分析”列为了典型场景。这几乎就是为你这个产品量身定做的基础设施。citeturn44view0turn26view2

**其二，必须做数据卫生与脱敏。**  
Prisma query logging 会直接吐出原始 SQL 和 params；OpenTelemetry 的数据库语义约定则强调 `db.query.text` 应是经过 sanitize 的查询文本，字面量值应被去标识或删掉，而且通常是 opt-in 收集。HTTP 语义约定对 `url.full` 也要求不包含凭证，并移除已知敏感 query 参数。你如果把 query params、Authorization、邮箱、手机号原样塞进 review UI，不仅有合规风险，企业环境里直接会被封杀。citeturn43view0turn7view1turn7view2

## MVP 取舍与场景优化

MVP 的成败不是“功能多不多”，而是**你是否用最小能力集，完整回答 reviewer 的核心问题**。我会建议你保留这些，坚决砍掉其他诱人但危险的方向。

**MVP 应该保留的能力**：

- **单 endpoint / 单 use case 作用域**。不要试图先做整个仓库的全局业务地图。CodeSee 的实践已经证明 one topic, one map 更利于 onboarding 和 review。citeturn21view0
- **Express 路由链 + Prisma 读写 + 条件/异常/事务/外部调用**。这几类已经覆盖了用户最关心的风险面。citeturn45view2turn46view0turn46view4turn39view0turn42view0
- **源码锚点是第一原则**。每个节点、边、状态差异、风险提示都必须能跳回 file:line。Whyline 和 CodeQL 都证明了“路径结果 + 源码定位”是高价值的组合。citeturn32view0turn17view0
- **静态不确定性明确标注 + 运行时覆盖验证**。这是你和“AI 幻觉图”之间的边界。citeturn35view0turn37view1
- **Review assistant 只做 evidence-backed summary**。AI 可以写结论、风险、test suggestions，但必须从底层证据图提炼，而且每条结论回链到节点与源码锚点。Google 代码评审原则里“technical facts and data overrule opinions”在这里非常适用。citeturn40view0

**MVP 应该砍掉的能力**：

- **通用 whole-program JS 分析**。Scope 爆炸，而且 soundiness 问题会迅速损害信任。citeturn35view0turn37view1
- **所有 locals / 所有中间表达式的全量回放**。Whyline 都明确选择只展示关键事件，不展示全部中间值。review 场景更不需要全量显微镜。citeturn32view0
- **原生 SQL 的字段级自动恢复**。如果只能拿到 SQL/query event，就先做表级/条件级证据，不要硬还原列补丁。citeturn43view0turn42view0
- **跨服务端到端业务语义统一图**。Datadog/OTel 层面能串 span，但“业务字段前后变化”跨服务会立刻变成另一个复杂产品。MVP 先把本服务边界打透。citeturn21view4turn41view0
- **自动修复 / 自动 approve**。这会削弱你“取证工具”的定位，并把风险从“辅助 review”升级成“替 reviewer 负责”。

针对你提到的三个重点场景，体验应该不是同一套皮肤，而是不同的入口模式。

**给 AI coding review 的模式**，核心是 **diff-aware risk review**。  
这里最重要的不是看全流程，而是看“这次改动改变了哪些业务事实”。默认首页应该直接显示：

- 新增/删除/改动的读表与写表
- 新增/删除/改动的事务边界
- 新增/删除/改动的异常路径
- 新增/删除/改动的外部副作用
- 受影响的 guard 条件
- 新增 unknown / approximate 节点

并且我会做几个高价值检测器。  
Prisma 的事务文档给了你非常好的真实风险样本：如果你先调 Stripe 再更新本地 team 记录，而更新失败，就会出现外部系统已生效、本地状态未落地的问题；官方因此专门讲了 idempotent API 的设计。类似地，Prisma 还用电影选座示例说明 read-modify-write 在并发下会 double-book，需要 OCC/version token；再加上“事务里避免网络请求”这个明确建议，这些都可以直接变成 review 风险规则。citeturn39view0

也就是说，AI review 模式优先做这些 **domain-risk lenses**：

- 写表集合变化：是不是改错表了
- 外部副作用发生在 commit 之前：是不是乱加副作用了
- `undefined` 导致字段被忽略：是不是看起来改了其实没改
- read-modify-write 没有 OCC/version：是不是并发下会覆写
- promise reject / `next(err)` 路径变化：是不是漏异常了
- `next('route')` / `next('router')` 导致实际处理链变化：是不是 guard 逻辑偏了

这些都比“给一张大图”更贴近你要解决的真实痛点。citeturn26view0turn39view0turn46view0turn46view2turn46view4

**给旧项目 onboarding 的模式**，核心是 **happy-path domain tour**。  
这里要弱化风险、强化讲解。CodeSee 的 tour、Google 对 code review 的知识共享价值、Whyline 的 code-centric navigation，三者合起来说明：新人最需要的是“一条能走完的业务故事线”。你的 onboarding 模式应该突出：

- 核心业务对象与表之间的映射
- happy path 默认回放
- 关键 guard 与失败分支标注
- 术语解释与字段 glossary
- 可保存的审阅注释和团队知识标签

这里图的重要性会高于 AI review 模式，但仍然应该是**稀疏图 + 丰富旁注**，不是铺满所有细节。citeturn21view0turn40view1turn32view0

**给 bug 排查 的模式**，核心是 **failure-first trace comparison**。  
Whyline 的“why / why not”思路在这里特别强：排查 bug 时，开发者想问的往往不是“代码是什么”，而是“为什么这次没有进入那个分支”“为什么这个值不是预期”“为什么副作用先发生了”。所以 bug 模式要突出：

- 失败 trace 与成功 trace 的对比
- 实际 branch choice 对比
- 实际字段 patch 对比
- exception 冒泡与处理链
- transaction rollback / partial side effect 的先后关系

这会比单看日志或 span list 更接近“业务 bug 的因果说明书”。citeturn32view0turn21view4

## 产品规格草案

下面是一版适合 MVP 启动的规格草案。我会刻意把它写得偏工程可落地，而不是概念稿。

**核心用户流程**

- 用户输入一个 endpoint，例如 `POST /orders/:id/confirm`。
- 系统解析 Express 路由定义，找到 route stack、controller、service、repository 与 Prisma / external client 的边界，并生成静态 Behavior IR。路径图里要保留 middleware、多 callback route、`next('route')` / `next('router')`、异常处理链等 Express 特性。citeturn45view2turn46view0turn46view1turn46view2turn46view4
- 系统从 Prisma 侧识别 read/write/transaction/query event，从源码识别 `if`/`throw`/external call，并把每个结论绑定到源码位置。CodeQL 与 Whyline 的共同启发是：结果必须能落回 source code，证据链必须可浏览。citeturn17view0turn32view0
- 如果用户提供运行时 trace 样本，系统把 static graph 与 actual trace overlay 合并，标记 `observed`、`not observed yet`、`unknown`。Prisma tracing 自带 operation span、transaction span 与 db_query span，适合做这层叠加。citeturn42view0turn42view2
- 首页默认进入“Review Storyboard”，先给出摘要：读了哪些表、写了哪些表、风险点在哪里、哪些字段变化不确定。
- 用户可以拖动 replay，逐步看每个业务步骤的 before/patch/after，并从任一节点跳进 source preview。
- AI assistant 只在侧栏输出“总结 / 风险 / test suggestions”，且每条都附 evidence chips。

**核心数据模型**

我建议你的中间数据结构不是单一 graph，而是一个**图 + 事件流 + 状态投影**的复合 IR：

- `ReviewUnit`：本次分析对象，包含 endpoint、commit sha、schema version、analysis version
- `BehaviorNode[]`：业务步骤节点  
  `kind = request_input | guard | db_read | db_write | external_call | tx_begin | tx_commit | tx_rollback | throw | catch | return | unknown`
- `BehaviorEdge[]`：结构边  
  `kind = control | data | call | within_tx | emits_side_effect | handles_exception | may_skip_to_route`
- `StateProjection[]`：可审查的状态片段  
  例如 `RequestDTO`, `Order`, `AuditCreateInput`, `WebhookPayloadSummary`
- `ReplayEvent[]`：时间排序事件  
  `seq`, `nodeId`, `traceRef`, `timestamp`, `duration`, `observed`
- `EvidenceRef[]`：证据引用  
  `sourceRef`, `queryEventRef`, `spanRef`, `errorRef`
- `Certainty`：四维可信度  
  `reachability`, `entityIdentity`, `fieldPatch`, `sourceAnchor`
- `UnknownReason[]`：降级原因  
  `dynamic_dispatch`, `opaque_library`, `raw_sql`, `dynamic_property`, `eval`, `unmodeled_wrapper`

下面是一版可以直接作为 JSON schema 雏形的草案：

```json
{
  "unit": {
    "kind": "endpoint",
    "method": "POST",
    "route": "/orders/:id/confirm",
    "entrySource": [{ "file": "routes/orders.ts", "startLine": 12, "endLine": 18 }]
  },
  "nodes": [
    {
      "id": "n_req",
      "kind": "request_input",
      "label": "读取 req.params.id / req.user.id",
      "sourceRefs": [{ "file": "controllers/order.ts", "startLine": 21, "endLine": 28 }],
      "certainty": {
        "reachability": "exact_static",
        "entityIdentity": "exact_static",
        "fieldPatch": "not_applicable",
        "sourceAnchor": "exact"
      }
    },
    {
      "id": "n_read_order",
      "kind": "db_read",
      "label": "读取 Order",
      "model": "Order",
      "operation": "findUnique",
      "sourceRefs": [{ "file": "repositories/orderRepo.ts", "startLine": 9, "endLine": 16 }],
      "evidenceRefs": [{ "kind": "span", "id": "span_17" }, { "kind": "query", "id": "q_17" }],
      "certainty": {
        "reachability": "observed",
        "entityIdentity": "observed",
        "fieldPatch": "not_applicable",
        "sourceAnchor": "exact"
      }
    },
    {
      "id": "n_guard_status",
      "kind": "guard",
      "label": "order.status must be PENDING",
      "sourceRefs": [{ "file": "services/confirmOrder.ts", "startLine": 33, "endLine": 38 }],
      "branchOutcomes": ["pass", "throw"],
      "certainty": {
        "reachability": "observed",
        "entityIdentity": "observed",
        "fieldPatch": "not_applicable",
        "sourceAnchor": "exact"
      }
    },
    {
      "id": "n_write_order",
      "kind": "db_write",
      "label": "更新 Order.status / confirmedAt",
      "model": "Order",
      "operation": "update",
      "sourceRefs": [{ "file": "services/confirmOrder.ts", "startLine": 41, "endLine": 52 }],
      "statePatch": {
        "entityKey": "Order#123",
        "before": { "status": "PENDING", "confirmedAt": null },
        "patch": { "status": "CONFIRMED", "confirmedAt": "$now" },
        "after": { "status": "CONFIRMED", "confirmedAt": "2026-06-07T09:12:33Z" }
      },
      "certainty": {
        "reachability": "observed",
        "entityIdentity": "observed",
        "fieldPatch": "strong",
        "sourceAnchor": "exact"
      }
    }
  ],
  "edges": [
    { "from": "n_req", "to": "n_read_order", "kind": "control" },
    { "from": "n_read_order", "to": "n_guard_status", "kind": "data" },
    { "from": "n_guard_status", "to": "n_write_order", "kind": "control", "label": "pass" }
  ],
  "replay": [
    { "seq": 1, "nodeId": "n_req", "observed": true },
    { "seq": 2, "nodeId": "n_read_order", "observed": true, "durationMs": 3 },
    { "seq": 3, "nodeId": "n_guard_status", "observed": true, "outcome": "pass" },
    { "seq": 4, "nodeId": "n_write_order", "observed": true, "durationMs": 5 }
  ]
}
```

**UI 结构**

我建议布局固定成四区，而不是自由画布优先：

- **左侧：Review Storyboard**  
  默认主视图。按顺序列出业务步骤，支持播放、暂停、下一步、只看风险、只看写入、只看异常。
- **中间：Source / Graph 双标签页**  
  默认显示 source preview，选中节点时直接跳到 file:line；Graph 作为结构索引，不作为默认主视图。Whyline 已经很清楚地说明，代码是主 artifact，表示层只是支持层。citeturn32view0
- **右侧：Evidence / Risks / Tests**  
  Evidence 是默认标签，Risks 展示规则命中，Tests 给出 evidence-backed 测试建议。
- **底部：State Table**  
  当前步骤对应的 before/patch/after；支持实体切换、字段过滤、仅显示 touched fields、显示 unknowns。

## 风险与实验计划

这个产品的最大风险，不在“能不能做图”，而在三个更硬的问题。

**第一，错误的确定感。**  
如果用户在第一次试用时就遇到“工具把一个 unknown patch 说成了确定写列”，这个产品的信任帐户基本就破产了。静态分析文献对这一点说得非常直白：真实系统中的不完备假设很普遍，而且必须明确说出来。citeturn35view0turn36view1

**第二，runtime 证据成本。**  
OTel/Prisma tracing 会带来 span 成本；Prisma 文档明确提醒，大量 spans 会有性能影响；交互式事务文档也明确提醒，长事务会伤害性能甚至导致死锁，而且不要在事务里执行网络请求。你的产品一旦鼓励用户在事务里插很多观察逻辑，反而可能制造新问题。citeturn42view0turn39view0

**第三，数据安全与合规。**  
Prisma query logging 会包含原始 query 和 params，OTel 的 database / HTTP 语义约定也都在提醒敏感数据处理。企业后端 code review 工具如果默认裸露生产 payload，很难落地。citeturn43view0turn7view1turn7view2

所以你的下一步实验，不应该先测“大家觉得酷不酷”，而应该测四组更硬的指标。

**一组是回答速度。**  
让 reviewer 在真实或仿真的 PR 上，用传统 diff + IDE + logs 与你的工具分别回答八个问题：

- 数据从哪里来
- 读了哪些表
- 改了哪些表
- 哪些字段发生变化
- 哪些条件会改变路径
- 哪里会抛错
- 有哪些外部调用
- 事务边界在哪里

为什么这样设计？因为 Google 的 code review 文档强调评审要快、要可扩展；Whyline 的小规模评估也显示，带有依赖可视化和源码联动的环境能显著缩短定位问题的时间。citeturn40view0turn40view1turn32view0

**一组是正确率与校准度。**  
不是只看工具答对没有，而是看 reviewer 在工具帮助下的**信心是否校准**。  
最理想的结果不是“用户总觉得很有把握”，而是“用户在工具说 unknown 的地方也知道该保守”。

**一组是抽取精度。**  
做一个 gold set，至少覆盖这些 seeded bug：

- 改错 Prisma model
- 漏了 `next(err)` / 漏了 async error path
- 在事务里加入网络调用
- 先副作用后本地写入，失败后不幂等
- read-modify-write 未做 OCC/version
- `undefined` 被 silently omitted
- 新增 `next('route')` 导致 guard 逃逸

这套样本很有价值，因为它们都能直接映射到 Express / Prisma 官方文档里的真实语义风险。citeturn46view0turn46view4turn39view0turn26view0

**最后一组是 UX 结构实验。**  
我会只做两个界面的 A/B：

- **graph-first** vs **storyboard-first**
- **static-only** vs **static + runtime overlay**

我对结果的预判很明确：  
在 AI coding review 场景下，storyboard-first 大概率会赢；在 onboarding 场景下，graph-first 只会在 happy path tour 中部分占优；而在 bug 排查中，hybrid overlay 的优势会最明显。这个判断的依据，来自 Whyline 的 code-centric、timeline-linked 设计，以及 CodeSee/Datadog 分别在结构与时间维度上的最佳实践差异。citeturn32view0turn21view0turn21view4

工程上，我会给 MVP 设三个硬阈值作为自保线：

- 分析结果里任何 risk 卡片都必须能展开到 evidence 与源码锚点
- 任何 unknown 都必须可见，不允许被 summary 隐去
- runtime 插桩默认目标是低开销模式，生产只保留采样 trace 与脱敏 query fingerprints，完整 payload 只在本地或沙盒环境启用

## 开放问题与限制

这版方案仍然有几个必须正视的边界。

第一，**raw SQL / query builder / stored procedure** 仍然是最大盲区。Prisma tracing 和 logging 能给到 SQL 证据，但不能天然把所有字段级 patch 可靠映回业务模型；这里如果没有额外 schema-aware parser 或人工 model，应该保守展示。citeturn42view0turn43view0

第二，**动态框架模式** 会快速侵蚀静态精度。包括运行时拼接路由、反射式注册 handler、复杂 dependency injection、decorator 元编程、生成代码、运行时 `eval` / dynamic code loading。这些在 soundiness 视角下都属于需要公开承认的限制，而不是“下个版本会更准”的 marketing 文案。citeturn35view0turn36view1turn37view1

第三，**跨请求的异步边界** 目前不应纳入 MVP。一个 endpoint 触发消息队列、再由另一个 consumer 改表，这本质上已经不是单请求 replay，而是分布式业务 saga 可视化。这个方向值得做，但不该和你的首个 wedge 混在一起。Prisma/OTel 能给你部分 trace 链接，但业务状态语义会陡增复杂度。citeturn42view3turn41view0

如果把上面的建议压缩成一句产品判断，那就是：

> **你应该做的不是“后端代码流程图工具”，而是“后端业务执行的证据化审查工具”。**  
> 默认入口是 storyboard，图只是索引；状态表只展示可审查的业务事实；静态分析必须显式承认 unknown；运行时 trace 不是锦上添花，而是建立信任的第二证据源；AI summary 必须永远站在证据之后，而不是站在证据之前。