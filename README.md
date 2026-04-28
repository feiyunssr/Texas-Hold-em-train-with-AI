# AI 德州扑克训练平台

一个面向 Web 的 AI 驱动型无限注德州扑克现金局训练平台。

产品核心围绕可配置的 `4-12` 人牌桌、低成本 AI 对手，以及训练过程中可按需调用的 `行动前 AI 教练建议` 展开；局后复盘、场景训练与长期统计作为强化学习闭环的后续能力存在。

## 文档

- [产品需求文档](docs/PRD.md)
- [设计系统](DESIGN.md)
- [Office Hours 决策记录（2026-04-22）](docs/office-hours-2026-04-22.md)
- [工程方案评审（2026-04-23）](docs/plan/plan-eng-review-2026-04-23.md)
- [设计方案评审（2026-04-24）](docs/plan/plan-design-review-2026-04-24.md)
- [设计方案复审（2026-04-24 follow-up）](docs/plan/plan-design-review-followup-2026-04-24.md)
- [工程方案复核：UI 设计约束（2026-04-24）](docs/plan/plan-eng-review-ui-followup-2026-04-24.md)
- [开发执行计划（2026-04-27）](docs/plan/development-execution-plan-2026-04-27.md)
- [TODOs](TODOS.md)

## 运行配置

- Node.js `24.14.0` 和 npm `11.9.0` 已用于初始化当前工程骨架。
- 安装依赖：`npm install`
- 启动开发服务器：`npm run dev`
- 打开首页：`http://localhost:3000`
- 健康检查：`http://localhost:3000/health`
- AI 教练建议的超时时间、自动重试次数和重试退避时间通过 `.env` 配置，变量名参考 [.env.example](.env.example)。
- 训练资产持久化使用 PostgreSQL + Prisma，`DATABASE_URL` 也通过 `.env` 配置。

本地 `.env` 示例：

```dotenv
AI_COACH_REQUEST_TIMEOUT_MS=2500
AI_COACH_RETRY_ATTEMPTS=2
AI_COACH_RETRY_BACKOFF_MS=300
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/texas_holdem_train?schema=public"
```

未设置这些变量时，应用会使用与 `.env.example` 一致的默认值。

## 开发命令

- 类型检查：`npm run typecheck`
- 单元测试：`npm test`
- 监听测试：`npm run test:watch`
- Lint：`npm run lint`
- 格式检查：`npm run format`
- 格式化源码与配置：`npm run format:write`
- 生成 Prisma client：`npm run db:generate`
- 格式化 Prisma schema：`npm run db:format`
- 执行 Prisma 迁移：`npm run db:migrate`
- 写入 demo user、wallet account 和基础标签：`npm run db:seed`

## 当前范围

- 每桌仅 1 个真人用户席位
- 支持 `4-12` 人可配置现金局
- 牌桌对手由低成本 AI 驱动
- `行动前 AI 建议` 是首要训练主航道
- 整手复盘、场景生成、历史深度分析为后续强化能力
- 支持结构化手牌历史、标签体系与训练导向统计
- UI 实现以 [设计系统](DESIGN.md) 为 source of truth，并按 12 人手机牌桌规格验证移动端布局

## 工程骨架

M0 已建立 Next.js App Router + TypeScript 单体仓库基础：

- 前端入口：`src/app`
- 规则引擎边界：`src/domain/poker`
- 训练领域边界：`src/domain/training`
- 服务端边界：`src/server`
- AI 编排边界：`src/ai`
- 组件与样式：`src/components`、`src/styles`

`src/domain/poker` 已实现可独立验证的 NLHE 规则引擎，不依赖 Next.js、数据库、AI 或 UI。

## 训练资产持久化

当前 M2 已建立 PostgreSQL 持久化基础：

- Prisma schema 和初始迁移位于 `prisma/`，覆盖 `app_user`、`wallet_account`、`table_config`、`table_seat_profile`、`hand`、`hand_event_log`、`decision_snapshot`、`ai_artifact`、`label_definition`、`label_assignment` 和 `wallet_ledger`。
- 所有长期结构化对象带 `schema_version`，并建立 `hand_event_log(hand_id, sequence)`、`decision_snapshot(hand_id, decision_point_id)`、`ai_artifact(request_id)`、`wallet_ledger(request_id)` 唯一约束。
- `src/server/persistence` 提供事件追加、决策快照、AI artifact、同事务扣点账务和 read model 查询服务。
- 收费类 AI artifact 与 `wallet_ledger` 在同一事务内写入；扣点使用条件原子扣减，`request_id` 并发重试返回已提交结果，事务失败会返回未扣点状态。

## 单桌训练运行时

当前 M3 已建立开发期单桌运行时：

- `src/server/training-runtime` 提供进程内训练桌 session、用户席位、AI 对手 mock 策略、public read model、`bot-seat-view` 和事件订阅。
- POST 控制面：
  - `POST /api/training/tables` 创建 4、6、9 或 12 人训练桌。
  - `POST /api/training/tables/:tableId/actions` 提交用户动作，并由规则引擎校验合法动作集合。
  - `POST /api/training/tables/:tableId/next-hand` 在当前手牌完成后准备下一手。
- 状态读取与同步：
  - `GET /api/training/tables/:tableId` 返回当前 public snapshot，可用于刷新后恢复。
  - `GET /api/training/tables/:tableId/events` 提供 SSE stream，并在订阅时先推送当前 snapshot；重连回放优先使用浏览器 `Last-Event-ID`，再回退到 `?after=`。
- 对外暴露的 `tableId` 使用 crypto-random ID，避免递增 ID 被猜测后读取或操作其他训练桌。
- AI 对手只能通过 `bot-seat-view` 获取该座位理论可见信息；public snapshot 在手牌完成前隐藏非 Hero 底牌。

## 行动前 AI 教练建议

当前 M4 已建立行动前 AI 教练服务闭环：

- `src/server/training-runtime` 可在 Hero 当前决策点生成 `hero-coach-view`，只包含牌桌配置、座位/位置、筹码与有效筹码、公共牌、Hero 底牌、当前决策前下注历史、底池和合法动作。
- `src/server/hero-coach` 编排一次正式建议请求：保存 `decision_snapshot`，调用 provider adapter，校验结构化输出，并把成功结果通过 `ai_artifact + wallet_ledger` 同事务扣点持久化；未写入任何 artifact 的失败会释放运行时锁，允许同一决策点修正后重试。
- `src/ai/hero-coach` 提供 mock provider、`hero-coach-v1` prompt version、结构化 schema 校验、合法动作金额校验、超时和重试执行器。
- `POST /api/training/tables/:tableId/coach` 请求一次行动前建议，请求体必须包含 `requestId`、`userId`、`walletAccountId` 和正整数 `chargeAmount`；运行时训练桌会先补齐 Prisma `table_config`、`table_seat_profile` 和 `hand` 后再保存教练资产。
- 同一 `decisionPointId` 在运行时只允许一次正式请求；请求处理中会锁定当前决策点，防止重复请求或同时提交用户动作。
- 成功结果返回 `saved_charged`，同一 `requestId` 重试返回相同 advice 形状；timeout、provider error、schema failure、storage failure 和非法扣点金额返回 `failed_not_charged`；partial 输出返回 `partial_not_final` 且不写入账务流水。
