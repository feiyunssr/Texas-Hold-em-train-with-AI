# 工程方案复核：UI 设计约束（2026-04-24）

**状态：DONE**

## 复核对象

- [产品需求文档](./PRD.md)
- [设计系统](../DESIGN.md)
- [工程方案评审（2026-04-23）](./plan-eng-review-2026-04-23.md)
- [设计方案复审（2026-04-24 follow-up）](./plan-design-review-followup-2026-04-24.md)

## 复核目的

确认新增设计系统和 12 人手机牌桌规格不会和既有工程方案冲突，并把 UI 实现需要保护的数据边界、状态模型和测试策略明确下来。

## 结论

新增设计约束与既有工程方案一致，可以进入实现。关键前提是前端不要把视觉状态临时拼接在组件内部，而应从会话状态、决策快照、AI artifact 和账务状态派生 UI。

## 组件边界建议

建议前端按以下边界拆分：

| 组件/模块 | 责任 | 数据来源 |
| --- | --- | --- |
| `TrainingTable` | 桌面/平板/手机牌桌布局编排 | 当前 hand state、seat state、street、pot |
| `SeatRail` | 4-12 人座位展示与移动端压缩 | seat state、position、style、stack |
| `TableCenter` | 公共牌、底池、当前街道、最近下注 | hand state、pot model |
| `ActionTray` | 合法动作、下注输入、提交状态 | legal actions、decision snapshot |
| `CoachPanel` | AI 教练请求入口、结果、失败和扣点状态 | decision snapshot、ai artifact、wallet ledger |
| `HandSummary` | 手牌结束摘要与复盘入口 | hand result、artifact availability |
| `HandHistoryList` | 历史列表和筛选 | read model |
| `HandReplay` | 街道时间线、建议和标签挂点 | event log、ai artifacts、label assignments |

## 状态模型要求

UI 至少需要显式区分这些状态，不能只用单个 loading boolean：

- `decision.available`
- `decision.submitting`
- `coach.available`
- `coach.requesting`
- `coach.succeeded_saved_charged`
- `coach.succeeded_pending_persistence`
- `coach.failed_not_charged`
- `coach.partial_not_final`
- `coach.already_requested`
- `hand.settling`
- `hand.saved`
- `review.generating`
- `review.failed_not_charged`

这些状态应从后端权威事件、AI artifact 和账务流水派生，避免前端乐观显示“已扣点”或“已保存”。

## 数据边界复核

`DESIGN.md` 要求的 UI 状态与 2026-04-23 工程评审的数据模型兼容：

- AI 教练面板绑定 `decision_snapshot`，不是完整内部手牌对象。
- AI 输出绑定 `ai_artifact`，并保留 schema version。
- 扣点展示绑定 `wallet_ledger`，不能只相信 AI 响应成功。
- 回放页面把建议和标签挂到事件流决策点上，符合 append-only hand event log。
- 手机压缩座位只改变展示密度，不改变可见信息边界。

## 实现风险与约束

| 风险 | 约束 |
| --- | --- |
| 12 人手机桌把桌面布局等比缩小 | 单独实现移动布局和座位压缩策略 |
| AI 教练 bottom sheet 遮挡行动按钮 | Action tray 必须固定并高于或避开 sheet 遮挡区域 |
| 失败建议误显示扣点 | 只有持久化成功并有账务流水后显示已扣点 |
| 历史回放把 AI 建议做成脱离上下文的卡片 | AI artifact 必须挂到对应街道和决策点 |
| 座位组件泄漏隐藏信息 | UI 只能消费 seat-view/hero-view 派生数据 |

## 测试策略补充

UI 实现后，除既有工程测试门槛外，新增以下测试要求：

- 12 人桌在 `360 x 740`、`390 x 844`、`430 x 932` viewport 下截图验证。
- AI 教练 loading、success、timeout、failure、partial、already requested 状态快照测试。
- Action tray 与 bottom sheet 同时出现时的遮挡测试。
- 键盘 Tab 顺序测试：弃牌、过牌/跟注、下注/加注、请求 AI 建议。
- 失败未扣点与成功已扣点的账务状态断言。
- 回放中 AI artifact 与决策点绑定的渲染测试。

## 最终判断

**DONE**

新增设计系统没有引入新的高风险架构缺口。它要求实现阶段把 UI 状态建模得更明确，尤其是 AI 建议和扣点状态，但这与现有事件流、快照和账务方案一致。
