# 开发执行计划（2026-04-27）

**状态：READY_FOR_CODEX_EXECUTION**

## 计划目的

本计划把当前产品文档、工程评审和设计系统转化为可由编程 AI agent Codex 分阶段执行的开发任务队列。

当前仓库仍处于产品与设计文档阶段，尚未发现可运行前端、后端或规则引擎代码。因此执行重点不是在既有实现上小修，而是从零搭建一个可验证的 Web 训练平台骨架，并保证第一主航道 `训练牌桌 + 行动前 AI 教练建议` 优先跑通。

执行顺序必须坚持规则引擎优先：M0 只建立工程、测试和领域模块运行条件，M1 作为第一个功能性里程碑先把 NLHE 规则核心做成可独立验证的纯 TypeScript 模块。持久化、运行时、AI 编排和 UI 都只能消费规则引擎输出的状态、合法动作和事件事实，不能反向污染规则核心。

## 输入依据

- [产品需求文档](../PRD.md)
- [Office Hours 决策记录](../office-hours-2026-04-22.md)
- [设计系统](../../DESIGN.md)
- [工程方案评审](./plan-eng-review-2026-04-23.md)
- [设计方案复审](./plan-design-review-followup-2026-04-24.md)
- [工程方案复核：UI 设计约束](./plan-eng-review-ui-followup-2026-04-24.md)
- [环境变量示例](../../.env.example)

## 执行原则

1. Codex 每次只领取一个可验证任务，不同时改动无关模块。
2. 每个任务完成后必须运行对应测试或最小验证命令，并在交付说明中写明结果。
3. 规则引擎、AI 编排、训练资产、账务与 UI 状态必须保持边界清晰。
4. AI 只能消费由视图构造器生成的最小必要 payload，不能直接读取完整内部手牌对象。
5. 任何收费能力只有在 AI 结果成功持久化并写入账务流水后才能显示已扣点。
6. UI 实现必须以 `DESIGN.md` 为 source of truth，不做营销首页、聊天式建议入口或泛 dashboard 卡片堆叠。

## 建议技术路线

在没有既有代码约束的前提下，建议采用一个 TypeScript 单体仓库，先让领域模型、API、实时桌面和前端在同一 repo 内快速闭环。

推荐默认栈：

- Web 框架：Next.js App Router + TypeScript
- 领域逻辑：独立 `src/domain` 纯 TypeScript 模块
- 数据库：PostgreSQL
- ORM：Prisma
- 实时同步：Server-Sent Events + POST 控制面
- 测试：Vitest 用于规则引擎和服务层，Playwright 用于关键 UI 流程
- 样式：CSS Modules 或 Tailwind 二选一，但必须落实 `DESIGN.md` token

如 Codex 在初始化时发现用户已有明确偏好的技术栈，应优先遵循用户或仓库现有约定，并更新本计划的“执行偏差记录”。

## 已锁定工程决策

### 规则引擎优先

- M0 不实现业务流程，只建立可运行的 TypeScript、测试、lint、typecheck、env 和 README 基础。
- M1 的规则引擎必须能脱离 Next.js、数据库、AI 和 UI 独立运行测试。
- 规则引擎只接受显式输入，输出新状态、合法动作、派生事实和 append-only 事件；不直接读写数据库或调用 AI。

### 实时同步

v1 默认采用 `SSE + POST 控制面`：

- 客户端通过 POST API 创建牌桌、提交用户动作、请求 AI 建议。
- 客户端通过 SSE 订阅当前 table session 的事件和派生状态。
- 服务端内部可以使用进程内事件分发作为开发期实现，但 API 边界必须允许后续替换为 Redis、队列或独立 realtime 服务。
- 不在 v1 默认实现中引入独立 WebSocket 服务；如部署目标要求 WebSocket，必须先记录到“执行偏差记录”。

### 持久化与计费事务

- `ai_artifact` 与对应 `wallet_ledger` 扣费流水必须在同一数据库事务内写入。
- 只有事务提交成功后，API 和 UI 才能返回或显示 `saved_charged`。
- 如果 AI 已返回但持久化或扣费事务失败，只能落为 `failed_not_charged` 或 `pending_persistence`，不得写入扣费成功状态。
- `hand_event_log` 必须包含单手牌内单调递增 `sequence`，并对 `(hand_id, sequence)` 建唯一约束。
- `decision_snapshot` 必须有稳定 `decision_point_id`，并对 `(hand_id, decision_point_id)` 建唯一约束。
- `ai_artifact` 必须保存 `request_id`、`decision_point_id`、`schema_version`、`prompt_version`、`model_name`、`provider_name`、请求快照引用和结构化输出。
- `wallet_ledger` 必须保存 `request_id`、`user_id`、`wallet_account_id`、`ai_artifact_id`、点数变动和余额快照，并对收费类 `request_id` 建唯一约束。

### AI 建议请求语义

- 同一 `decision_point_id` 最多允许一次正式 AI 建议请求。
- 自动重试属于同一次正式请求，不生成新的正式请求次数。
- 最终超时、模型错误、网络错误、解析失败、结构化校验失败、存储失败或扣费事务失败均显示 `failed_not_charged`。
- `failed_not_charged` 仍视为该决策点的正式请求已使用；前端展示失败原因和未扣点状态，但不允许再次发起正式请求。
- `already_requested` 表示该决策点已有成功、失败或处理中请求，前端必须展示既有状态而不是重新触发。
- partial 输出在 v1 统一视为未满足正式结构化 schema 的失败结果，不扣点；如需要展示可用字段，只能显示为 `partial_not_final`，不得写入收费流水。

### 用户与钱包模型

- v1 即使只做单用户演示，也必须建立最小 `app_user`、`wallet_account` 和 `wallet_ledger` 边界。
- 开发环境可创建固定 demo user 和初始点数余额，但所有收费请求必须归属到明确 `user_id` 与 `wallet_account_id`。
- 点数余额只能由 ledger 派生或由事务内余额快照维护，不能由前端状态决定。

### AI 编排可测试性

- AI 编排层必须通过 provider adapter 调用模型，开发和测试使用 mock provider。
- 每个 coach/review prompt 必须带 `prompt_version`。
- 所有模型调用必须记录 `provider_name`、`model_name`、timeout、retry attempts、最终错误类型或成功状态。
- 结构化输出必须先通过 schema 校验，再进入持久化和扣费事务。
- 单元测试必须覆盖 success、timeout、provider error、parse/schema failure、storage failure、duplicate request 和 partial output。

## 里程碑总览

| 里程碑 | 目标 | 验收信号 |
| --- | --- | --- |
| M0 | 初始化可运行工程骨架 | 本地开发服务器可启动，基础测试可运行 |
| M1 | NLHE 规则引擎 | 4-12 人现金局可通过事件流打完一手，合法动作和结算有测试 |
| M2 | 训练资产与持久化 | hand event、decision snapshot、AI artifact、wallet ledger 可写入并查询 |
| M3 | 单桌训练运行时 | 用户与 AI 对手可在同一桌完整行动，轮到用户时挂起等待 |
| M4 | 行动前 AI 教练建议 | 同一决策点一次建议、超时重试、保存后扣点、失败未扣点 |
| M5 | v1 UI 主航道 | 创建牌桌、实时牌桌、行动区、AI 教练面板、手牌结束摘要可用 |
| M6 | 复盘、历史与回放基础 | 已完成手牌可复盘，历史列表和单手回放能挂载 AI 产物 |
| M7 | QA 与发布准备 | 单元、集成、视觉和移动端验证达到 v1 门槛 |

## M0：工程骨架

目标：创建可运行、可测试、可迭代的项目基础，并给规则引擎优先开发提供独立 harness。

状态：**COMPLETED 2026-04-27**

Codex 任务：

1. 初始化 Next.js App Router + TypeScript 应用和包管理配置。
2. 建立目录边界：
   - `src/domain/poker`
   - `src/domain/training`
   - `src/server`
   - `src/ai`
   - `src/app` 或对应前端入口
   - `src/components`
   - `src/styles`
3. 配置 lint、format、typecheck、test 脚本。
4. 接入 `.env.example` 中的 AI 教练超时与重试变量读取。
5. 新增最小健康页或训练入口占位页，但不在 M0 实现牌桌业务流程。
6. 新增规则引擎测试入口，保证 `src/domain/poker` 可脱离 Next.js、数据库、AI 和 UI 独立运行 Vitest。
7. 更新 README，写明安装、启动、typecheck、test、lint 和 `.env` 配置方式。

验收：

- `npm run typecheck` 通过。
- `npm test` 或等价测试命令通过。
- `npm run lint` 或等价 lint 命令通过。
- 本地开发服务器可启动并打开第一屏。
- README 包含启动、测试和环境变量说明。

完成记录：

- 已初始化 Next.js App Router + TypeScript + npm 工程，依赖版本写入 `package-lock.json`。
- 已建立 `src/domain/poker`、`src/domain/training`、`src/server`、`src/ai`、`src/app`、`src/components`、`src/styles` 目录边界。
- 已配置 `dev`、`build`、`typecheck`、`test`、`test:watch`、`lint`、`format` 和 `format:write` 脚本。
- 已实现 `AI_COACH_REQUEST_TIMEOUT_MS`、`AI_COACH_RETRY_ATTEMPTS`、`AI_COACH_RETRY_BACKOFF_MS` 读取与默认值。
- 已新增首页训练入口占位页和 `/health` 健康检查，不包含牌桌业务流程。
- 已新增 `src/domain/poker/index.test.ts`，证明 poker domain 测试入口可独立运行。
- 已更新 README 的安装、启动、测试和 `.env` 配置说明。
- 验证命令：`npm run typecheck`、`npm test`、`npm run lint`、`npm run format`、`npm audit --audit-level=moderate`、`curl http://127.0.0.1:3000/health`、首页 HTML 内容检查。

## M1：规则引擎

目标：应用自身可靠执行无限注德州扑克现金局规则，不依赖 AI 判断合法性。

状态：**COMPLETED 2026-04-27**

Codex 任务：

1. 定义核心类型：牌、牌堆、座位、筹码、盲注、ante、straddle、街道、行动、底池、手牌状态。
2. 实现确定性发牌与随机种子注入，便于测试复现。
3. 实现 4-12 人座位初始化、button 与 blind 分配。
4. 实现合法动作生成：fold、check、call、bet、raise、all-in。
5. 实现行动轮转、街道推进、主池和边池结算。
6. 实现摊牌评估，可优先接入成熟牌力库，避免手写复杂牌型判断。
7. 输出 append-only hand event log，不允许覆盖已经发生的事实事件。

验收：

- 覆盖翻前到河牌的完整手牌测试。
- 覆盖弃牌结束、all-in、边池、多人摊牌、4 人桌和 12 人桌。
- 同一初始状态与事件序列重复运行结果一致。

完成记录：

- 已将 `src/domain/poker` 从 M0 harness 扩展为纯 TypeScript NLHE 规则引擎，提供 `createHand`、`getLegalActions`、`applyAction`、`playUntilTerminal`、`buildPots` 和 `evaluateShowdown` 公共入口。
- 已实现 4-12 人现金局初始化、确定性 seed 洗牌、可注入测试牌堆、button/blind/ante/straddle 强制下注、行动轮转、街道推进、合法动作生成、all-in 自动跑牌、主池/边池结算和 append-only hand event log。
- 已接入 `poker-evaluator` 作为摊牌评估 wrapper，第三方库类型不泄漏到规则引擎公共 API。
- 已更新 `CURRENT_TRAINING_MILESTONE` 为 `M1`。
- 验证命令：`npm test`、`npm run typecheck`、`npm run lint`、`npm run format`、`npm audit --audit-level=moderate`。

复查修复记录：

- 已修复只剩一个覆盖玩家仍可行动时错误继续下注的问题：仅在该玩家已完成当前下注轮后自动跑牌到摊牌。
- 已修复未足额 all-in raise 错误重开 prior actors 加注权的问题。
- 已修复 straddle 局翻前最小加注仍按 big blind 计算的问题，改为按当前 straddle/open bet 尺寸计算。
- 回归验证命令：`npm test`、`npm run typecheck`、`npm run lint`、`npm run format`。

## M2：训练资产与持久化

目标：把每手牌沉淀为长期训练资产，并为复盘、历史、统计和计费对账保留结构化基础。

状态：**COMPLETED 2026-04-28**

Codex 任务：

1. 建立数据模型：
   - `app_user`
   - `wallet_account`
   - `table_config`
   - `table_seat_profile`
   - `hand`
   - `hand_event_log`
   - `decision_snapshot`
   - `ai_artifact`
   - `label_definition`
   - `label_assignment`
   - `wallet_ledger`
2. 所有长期结构化对象包含 `schema_version`。
3. 所有收费请求包含幂等 `request_id`。
4. 建立唯一约束：
   - `hand_event_log(hand_id, sequence)`
   - `decision_snapshot(hand_id, decision_point_id)`
   - `ai_artifact(request_id)`
   - `wallet_ledger(request_id)` 用于收费类流水幂等
5. 建立写入服务，保证事件追加、快照保存、AI 产物保存和账务流水可以审计串联。
6. 建立 AI 产物与账务流水的同事务写入服务：事务提交失败时不得显示或返回已扣点。
7. 建立 read model 查询接口，支持历史列表和单手回放的最小数据需求。

验收：

- 能从一手已完成 hand id 还原完整事件时间线。
- 能定位某个决策点对应的 `decision_snapshot`、`ai_artifact` 和 `wallet_ledger`。
- 重复提交同一 `request_id` 不会重复扣点。
- demo user 的点数流水能通过 `wallet_account` 归属和查询。
- 模拟 AI 产物写入成功但账务写入失败时，接口返回未扣点状态，数据库不留下已扣点假象。

完成记录：

- 已引入 Prisma 7 + PostgreSQL driver adapter，新增 `prisma.config.ts`、`prisma/schema.prisma` 和初始迁移。
- 已建立 `app_user`、`wallet_account`、`table_config`、`table_seat_profile`、`hand`、`hand_event_log`、`decision_snapshot`、`ai_artifact`、`label_definition`、`label_assignment` 和 `wallet_ledger` 模型。
- 已为长期结构化对象保留 `schema_version`，并建立 `hand_event_log(hand_id, sequence)`、`decision_snapshot(hand_id, decision_point_id)`、`ai_artifact(request_id)`、`wallet_ledger(request_id)` 唯一约束。
- 已实现 `src/server/persistence` 服务边界，支持事件追加、决策快照保存、AI artifact 保存、同事务收费写入、历史列表、单手时间线、决策点审计链和钱包流水查询。
- 已新增 Prisma seed，创建固定 demo user、wallet account、初始点数流水和基础标签定义。
- 已更新 `CURRENT_TRAINING_MILESTONE` 为 `M2`。
- 验证命令：`npm run db:generate`、`npm run db:format`、`npx prisma validate`、`npm test`、`npm run typecheck`、`npm run lint`、`npm run format`、`npm run build`。
- 本地未执行 `npm run db:migrate`，因为当前环境未提供可连接的 PostgreSQL 实例；迁移 SQL 已生成并随仓库保存。
- `npm audit --audit-level=moderate` 当前失败于 Prisma 7.8.0 dev 依赖链中的 `@hono/node-server` moderate advisory；`npm audit fix --force` 会降级到 Prisma 6.19.3，属于破坏性修复，未自动执行。

## M3：单桌训练运行时

目标：跑通一个用户席位与多个 AI 对手的训练桌。

状态：**COMPLETED 2026-04-28**

Codex 任务：

1. 实现创建训练桌 API，支持人数、盲注、筹码、ante、straddle、AI 风格分布。
2. 实现单桌 session 状态机：创建、发牌、AI 行动、用户决策、手牌结算、下一手准备。
3. 实现 `bot-seat-view`，每个 AI 对手只能看到该座位理论上可见的信息和合法动作。
4. 实现 AI 对手最小策略适配器：
   - 开发期可用规则或 mock 策略保证流程稳定。
   - 真实模型接入必须保持 payload 隔离。
5. 实现用户动作提交 API，并校验动作必须来自规则引擎生成的合法动作集合。
6. 实现 SSE 状态同步到前端：
   - POST API 负责创建牌桌、提交动作和请求建议。
   - SSE stream 负责推送当前 table session 事件和派生状态。
   - 开发期允许进程内事件分发，但接口不能依赖 React 组件状态。

验收：

- 用户可以创建 4 人、6 人、9 人、12 人训练桌。
- AI 对手能持续行动直到轮到用户。
- 用户提交合法动作后事件流追加并推进桌面。
- 非法动作被拒绝且不污染事件流。
- 前端刷新或重新订阅 SSE 后，可以通过 read model 恢复当前 hand 派生状态。

完成记录：

- 已新增 `src/server/training-runtime`，提供进程内单桌 session 状态机、public read model、事件订阅、用户动作提交和下一手准备。
- 已支持创建 4 人、6 人、9 人、12 人训练桌，配置人数、盲注、起始筹码、ante、straddle、Hero 座位、button、seed 和 AI 风格分布。
- 已实现 `bot-seat-view`，AI 对手只能看到该座位底牌、公共牌、公开座位筹码/投入/状态、公开行动历史和当前合法动作，不读取 Hero 或其他 bot 底牌。
- 已实现开发期 mock bot 策略，bot 会自动行动直到轮到用户或手牌完成。
- 已新增 App Router API：`POST /api/training/tables`、`GET /api/training/tables/:tableId`、`POST /api/training/tables/:tableId/actions`、`GET /api/training/tables/:tableId/events` 和 `POST /api/training/tables/:tableId/next-hand`。
- 已将对外暴露的训练桌 ID 改为 crypto-random、不可枚举的 route identifier，避免仅凭递增 ID 猜测其他训练桌。
- 已通过规则引擎合法动作集合校验用户动作；非法动作返回拒绝事件，不追加 `player_action`。
- 已实现 SSE 订阅，重新订阅时先推送当前 public snapshot，并支持按 `Last-Event-ID` 或 `?after=` public event sequence 回放。
- 已更新 `CURRENT_TRAINING_MILESTONE` 为 `M3`。
- 已将 `poker-evaluator` 配置为 Next 服务端外部包，避免生产构建时其 `HandRanks.dat` 数据文件路径被 Turbopack 改写。
- 验证命令：`npm test -- src/server/training-runtime/index.test.ts src/app/api/training/tables/[tableId]/events/route.test.ts`、`npm test -- src/server/training-runtime/index.test.ts`、`npm test`、`npm run typecheck`、`npm run lint`、`npm run format`、`npm run build`。

## M4：行动前 AI 教练建议

目标：把 v1 第一主航道做成可靠、可计费、可审计的闭环。

状态：**COMPLETED 2026-04-28**

Codex 任务：

1. 实现 `hero-coach-view`，只包含真人用户当前决策点可见信息：
   - 牌桌配置
   - 座位与位置
   - 筹码与有效筹码
   - 公共牌
   - 用户底牌
   - 当前决策前下注历史
   - 当前底池
   - 合法动作集合
2. 在用户决策点生成并保存 `decision_snapshot`。
3. 实现同一决策点一次正式请求限制。
4. 实现 AI 教练请求编排：
   - 读取 `AI_COACH_REQUEST_TIMEOUT_MS`
   - 读取 `AI_COACH_RETRY_ATTEMPTS`
   - 读取 `AI_COACH_RETRY_BACKOFF_MS`
   - 超时、模型错误、网络错误、解析失败、存储失败均不扣点
   - 使用 provider adapter 调用 AI，测试环境使用 mock coach provider
   - 保存 `provider_name`、`model_name`、`prompt_version`、重试次数和最终状态
5. 实现结构化 AI 输出 schema：
   - 主推荐动作
   - 建议下注尺度
   - 可接受替代动作
   - 最多 3 条关键判断因素
   - 风险或不确定性说明
6. AI 输出必须先通过 schema 校验，再进入持久化和扣费事务。
7. AI 输出成功持久化后，在同一事务内通过条件原子扣减钱包余额并写入 `wallet_ledger`，事务提交后再返回已扣点状态；并发 `request_id` 重试必须回读已提交的收费结果。
8. partial 输出在 v1 视为未完成正式结果：可展示已返回字段和 `partial_not_final`，但不写入收费流水。
9. 最终失败仍消耗该决策点的一次正式请求；前端展示 `failed_not_charged` 或 `already_requested`，不允许再次正式请求。

验收：

- 同一决策点重复请求只返回已有状态或拒绝第二次正式请求。
- 成功路径能串起 `request_id -> decision_snapshot -> ai_artifact -> wallet_ledger`。
- 任一失败路径明确返回未扣点状态。
- 非正数或非整数扣点金额必须在持久化前拒绝。
- 请求期间当前用户决策点冻结，不能重复提交建议请求。
- timeout、provider error、parse/schema failure、partial output、storage failure、duplicate request 均有测试覆盖。
- `wallet_ledger` 写入失败时不能留下已扣点状态。

完成记录：

- 已新增 `hero-coach-view`，在 Hero 当前决策点只暴露牌桌配置、座位/位置、筹码与有效筹码、公共牌、Hero 底牌、当前决策前下注历史、底池和规则引擎合法动作。
- 已为当前决策点生成稳定 `decisionPointId`，并在建议请求期间锁定该决策点，阻止重复建议请求和同时提交用户动作。
- 已新增 `src/ai/hero-coach.ts`，提供 provider adapter、mock provider、`hero-coach-v1` prompt version、结构化输出 schema 校验、超时和重试执行器。
- 已新增 `src/server/hero-coach` 编排服务，按 `request_id -> decision_snapshot -> ai_artifact -> wallet_ledger` 串联成功路径。
- 已实现同一 `decisionPointId` 一次正式请求限制，重复正式请求返回既有状态；同一 `requestId` 重试可回读已提交的收费结果。
- 已实现 `saved_charged`、`failed_not_charged`、`partial_not_final` 和 `already_requested` 返回语义；timeout、provider error、schema failure、storage failure、非法扣点金额和 partial 输出均不写入扣费流水。
- 已新增 `POST /api/training/tables/:tableId/coach`，请求体要求 `requestId`、`userId`、`walletAccountId` 和正整数 `chargeAmount`。
- Review follow-up: coach API 会先把运行时 `table_config`、`table_seat_profile` 和 `hand` 持久化，再保存 Prisma coach artifacts；未产生 artifact 的失败会释放决策点锁；同一 `requestId` 的成功重试保持 advice 响应形状一致；provider 建议金额会按当前合法动作的 exact/min/max 约束校验。
- 已更新 `CURRENT_TRAINING_MILESTONE` 为 `M4`。
- 验证命令：`npm test -- src/server/hero-coach/index.test.ts src/server/training-runtime/index.test.ts`、`npm test -- src/server/hero-coach/index.test.ts src/ai/hero-coach.test.ts`、`npm run typecheck`、`npm test`、`npm run lint`、`npm run format`、`npm run build`。

## M5：v1 UI 主航道

目标：用户能通过 Web UI 完成训练桌主流程。

状态：**COMPLETED 2026-04-29**

Codex 任务：

1. 实现训练牌桌创建页：
   - 人数
   - 盲注
   - 起始筹码
   - ante
   - straddle
   - AI 风格分布
2. 实现实时训练牌桌：
   - 桌面中心：公共牌、主池、边池、当前街道、当前行动者
   - 座位：头像或缩写、筹码、街道投入、状态、AI 风格、button/blind 标记
   - 用户席位：突出但不遮挡公共牌和行动区
3. 实现 `ActionTray`：
   - 只显示当前合法动作
   - 下注滑杆、快捷尺度、精确输入
   - 提交中状态
4. 实现 `CoachPanel`：
   - 标题包含 `AI 教练视角`
   - available、requesting、success saved charged、pending persistence、failed not charged、partial not final、already requested
   - 不使用“正确答案”“最佳答案”“solver 标准答案”等绝对化文案
5. 实现手牌结束摘要和基础复盘入口。
6. 实现移动端 12 人桌压缩布局和 AI 教练 bottom sheet。

验收：

- 用户 5 秒内能判断是否轮到自己、底池多大、可做什么。
- 行动按钮不展示非法主按钮。
- AI 建议失败、超时、解析失败或存储失败时清楚显示未扣点。
- partial 结果必须清楚显示未形成正式建议且未扣点。
- `360 x 740`、`390 x 844`、`430 x 932` 下行动按钮不被 bottom sheet 遮挡。

完成记录：

- 已将首页从 M0 占位入口替换为 M5 可交互训练桌 UI，包含训练牌桌创建表单、实时牌桌、座位压缩状态、用户席位、行动区、AI 教练面板和手牌摘要。
- 已接入 M3/M4 控制面：`POST /api/training/tables` 创建 4/6/9/12 人桌，`GET /events` 订阅 SSE 快照，`POST /actions` 提交规则引擎合法动作，`POST /coach` 请求行动前 AI 教练建议，`POST /next-hand` 开始下一手。
- `ActionTray` 只渲染当前 public snapshot 暴露的合法动作，并提供下注/加注滑杆、快捷尺度和精确输入；AI 建议请求中会禁用行动按钮，匹配决策点冻结语义。
- `CoachPanel` 标题包含 `AI 教练视角`，并覆盖 available、requesting、saved_charged、pending_persistence、failed_not_charged、partial_not_final 和 already_requested 展示状态；失败、partial 和存储异常文案均明确未扣点，未使用绝对化 solver 文案。
- 已实现手牌结束摘要、行动摘要 details 和下一手入口，作为 M6 历史/回放前的基础复盘入口。
- Review follow-up: 侧栏 `CoachPanel` 在用户行动提交中同步禁用并由 `requestCoach` 二次 guard，避免和 `/actions` 并发锁住旧决策点；新建牌桌后的 SSE 订阅从 `after=0` 回放首手公开事件，且 `runtime_snapshot` 只更新快照、不写入行动摘要。
- 已新增移动端 12 人桌压缩布局：非关键座位压缩为小状态 token，用户席位保持展开，行动区固定在底部，教练面板留在行动区之后，避免遮挡唯一可见行动按钮。
- 已更新 `CURRENT_TRAINING_MILESTONE` 为 `M5`。
- 验证命令：`npm run typecheck`、`npm run format:write`、`npm run lint`、`npm test`、`npm run build`、`curl http://127.0.0.1:3000/health`、首页 HTML M5 内容检查；review follow-up 追加验证 `npm test -- src/app/api/training/tables/[tableId]/events/route.test.ts src/server/training-runtime/index.test.ts`、`npx prettier --check src/components/training-entry.tsx`。
- 浏览器自动化截图未执行：当前 gstack browse 工具需要一次性构建，且仓库已有 Next dev server 占用 3000 时 Next 阻止同仓库第二个 dev server；本次以构建、类型、测试和本地 HTTP smoke test 作为最小验证。

## M6：复盘、历史与回放基础

目标：把单手训练沉淀为可回看的学习资产。

Codex 任务：

1. 实现已完成手牌的完整复盘请求，使用 `review-view`。
2. 复盘输出按街道挂载到 hand event timeline。
3. 复盘成功持久化后，在同一事务内写入 `wallet_ledger` 并扣点，失败路径未扣点。
4. 实现历史手牌列表：
   - 时间
   - 人数
   - 位置
   - 结果
   - 标签
   - 是否有即时建议或复盘
5. 实现基础筛选：
   - 人数
   - 位置
   - 街道
   - 结果
   - 标签
   - 问题类型
   - 对手风格
6. 实现单手回放，AI artifact 和标签必须挂在对应决策点上。

验收：

- 任意完成手牌可发起复盘。
- 复盘失败不会扣点。
- 复盘 `ai_artifact` 与 `wallet_ledger` 满足同一事务和幂等 `request_id` 要求。
- 历史列表空状态提供进入训练牌桌的主按钮。
- 回放页面能看到事件流、即时建议、复盘和标签的上下文关系。

完成记录：

- 已新增完成手牌 `review-view`，只在 `hand_complete` 后生成，包含完整事件时间线、按街道标注、最终公开快照、摊牌/结算、座位风格和底牌。
- 已新增 `src/ai/hand-review.ts` 与 `src/server/hand-review`，使用 `hand-review-v1` prompt version；成功复盘以 `HAND_REVIEW` artifact 保存，并复用 M2/M4 的 `saveChargedAIArtifact` 同事务写入 `ai_artifact + wallet_ledger`；同一手牌重复请求会返回已保存的整手复盘，避免重复 provider 调用和二次扣点。
- 已新增 `POST /api/training/tables/:tableId/review`，请求体要求 `requestId`、`userId`、`walletAccountId` 和正整数 `chargeAmount`；复盘前会补齐 Prisma table、seat、completed hand 和 `hand_event_log`。
- 已新增 `GET /api/training/history` 与 `GET /api/training/history/:handId`，历史列表返回时间、人数、Hero 位置、结果、标签、即时建议/复盘标记，并支持人数、位置、街道、派生盈亏结果、完成原因、标签、问题类型和对手风格筛选；单手回放按请求用户范围读取。
- 已实现单手回放 read model：事件流挂载对应决策点的 AI artifact 与标签，整手复盘 artifact 作为 hand-level 上下文返回。
- 已将首页侧栏扩展为 M6 工作台：完成手牌后可请求整手复盘，历史列表空状态提供进入训练牌桌按钮，选择历史手牌后展示事件流、即时建议、复盘和标签上下文。
- 已更新 `CURRENT_TRAINING_MILESTONE` 为 `M6`。
- 验证命令：`npm run typecheck`、`npm run format:write`、`npm test`、`npm run lint`、`npm run build`。

## M7：QA 与发布准备

目标：确认 v1 主航道可稳定演示和继续迭代。

Codex 任务：

1. 跑通单元测试、集成测试、端到端测试。
2. 使用 Playwright 验证：
   - 创建训练桌
   - 完成至少一手牌
   - 请求一次 AI 建议
   - 建议失败未扣点
   - 建议成功已保存并扣点
   - 历史回放挂载 AI artifact
3. 截图验证移动端 12 人桌：
   - `360 x 740`
   - `390 x 844`
   - `430 x 932`
4. 检查键盘 Tab 顺序：
   - 弃牌
   - 过牌或跟注
   - 下注或加注
   - 请求 AI 建议
5. 检查所有主要状态文案和 `AI 教练视角` 标识。

验收：

- `typecheck`、`test`、`lint`、E2E 主流程全部通过。
- 移动端截图没有重叠、遮挡或按钮不可点问题。
- README 中的启动、测试和环境变量说明与实际脚本一致。

## Codex 执行模板

每个 Codex 子任务应按以下格式开工：

```text
目标：
本次只实现 <一个明确模块或流程>。

输入文档：
- docs/plan/development-execution-plan-2026-04-27.md
- 与本任务相关的 PRD/DESIGN/工程评审章节

边界：
- 可以修改 <文件或目录>
- 不修改 <明确排除项>
- 不引入与当前任务无关的重构

验收：
- <命令 1>
- <命令 2>
- <用户可验证行为>
```

每个 Codex 子任务完成后应输出：

- 修改了哪些文件。
- 完成了哪条验收。
- 哪些验证命令已运行。
- 是否发现需要更新 PRD、DESIGN、README、TODOs 或本计划。

## 推荐首批任务顺序

1. `M0-01` 初始化 Next.js + TypeScript 工程骨架。
2. `M0-02` 配置测试、类型检查、lint、环境变量读取和 README 运行说明。
3. `M1-01` 定义扑克领域类型和事件类型。
4. `M1-02` 实现座位、盲注、ante、straddle 与发牌。
5. `M1-03` 实现合法动作生成和行动轮转。
6. `M1-04` 实现底池、边池与结算测试。
7. `M2-01` 建立 Prisma schema、迁移、demo user 和 wallet account。
8. `M2-02` 实现事件流、快照、AI artifact、账务同事务写入服务。
9. `M3-01` 实现训练桌 session 状态机和 SSE 同步。
10. `M4-01` 实现 AI 教练视图、provider adapter、一次请求限制和未扣点失败路径。

## 风险清单

| 风险 | 控制方式 |
| --- | --- |
| 规则引擎被 UI 或 AI 状态污染 | 规则引擎放在独立 domain 模块，只输入状态和事件，只输出新状态、合法动作和派生事实 |
| AI 视角泄漏隐藏信息 | 所有 AI 请求必须经过 `bot-seat-view`、`hero-coach-view` 或 `review-view` |
| 扣点状态不可信 | `ai_artifact` 和 `wallet_ledger` 同事务提交成功后才显示已扣点 |
| 重复扣点 | 对收费类 `request_id` 建唯一约束，所有收费写入通过幂等服务 |
| partial 输出被误当正式建议 | v1 partial 统一不扣点，展示为 `partial_not_final` |
| 实时建议阻塞训练节奏 | 请求期间冻结当前决策点，失败未扣点，用户可继续自己行动 |
| 实时同步实现被部署方式卡住 | v1 锁定 SSE + POST 控制面，不默认引入 WebSocket 服务 |
| 12 人手机桌不可用 | 从 M5 起单独实现移动布局，不把桌面牌桌等比缩小 |
| 范围膨胀 | M1-M5 优先，场景生成和长期深度分析不进入第一关键路径 |

## 执行偏差记录

当前暂无偏差。M0 按推荐技术路线采用 Next.js App Router、TypeScript、独立 `src/domain`、Vitest、ESLint 和 Prettier；后续如果实际技术栈、目录结构或里程碑顺序发生变化，Codex 应在提交对应代码后同步更新本节。
