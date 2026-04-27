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

本地 `.env` 示例：

```dotenv
AI_COACH_REQUEST_TIMEOUT_MS=2500
AI_COACH_RETRY_ATTEMPTS=2
AI_COACH_RETRY_BACKOFF_MS=300
```

未设置这些变量时，应用会使用与 `.env.example` 一致的默认值。

## 开发命令

- 类型检查：`npm run typecheck`
- 单元测试：`npm test`
- 监听测试：`npm run test:watch`
- Lint：`npm run lint`
- 格式检查：`npm run format`
- 格式化源码与配置：`npm run format:write`

## 当前范围

- 每桌仅 1 个真人用户席位
- 支持 `4-12` 人可配置现金局
- 牌桌对手由低成本 AI 驱动
- `行动前 AI 建议` 是首要训练主航道
- 整手复盘、场景生成、历史深度分析为后续强化能力
- 支持结构化手牌历史、标签体系与训练导向统计
- UI 实现以 [设计系统](DESIGN.md) 为 source of truth，并按 12 人手机牌桌规格验证移动端布局

## 工程骨架

当前 M0 已建立 Next.js App Router + TypeScript 单体仓库基础：

- 前端入口：`src/app`
- 规则引擎边界：`src/domain/poker`
- 训练领域边界：`src/domain/training`
- 服务端边界：`src/server`
- AI 编排边界：`src/ai`
- 组件与样式：`src/components`、`src/styles`

`src/domain/poker` 已有 Vitest harness，用于保证后续 M1 规则引擎可以脱离 Next.js、数据库、AI 和 UI 独立验证。
