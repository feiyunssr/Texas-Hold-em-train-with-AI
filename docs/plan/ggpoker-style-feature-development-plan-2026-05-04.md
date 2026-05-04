# GGpoker 对标牌局增强开发计划

## 背景与目标

当前项目已经具备可用的 NLHE 规则引擎、单桌训练 runtime、基础牌桌 UI、AI 教练、复盘、历史回放和自动下一手能力。下一阶段目标不是复制真实真钱客户端，而是把 GGpoker 类成熟客户端中有训练价值的牌局体验、策略自动化和历史分析能力系统化补齐。

外部对标参考来自 GGpoker 官方公开页面：`Games & Features Guide`、`PokerCraft`、`Smart HUD` 和 `Rush & Cash`。本计划只吸收适合训练产品的能力，不实现真钱、赌场、锦标赛报名、Staking、Side Games 等非训练主航道功能。

## 全量功能清单

### 1. 实时牌桌信息层

- 底池展示升级：保留现有主池/边池/当前下注，新增本街已投入筹码视觉层、待跟注额、有效底池、可赢底池和结算后底池归属说明。
- 座位状态升级：每个座位展示最近动作、动作金额、剩余思考状态、all-in/folded/等待行动标记、D/SB/BB/Straddle/Ante 标记。
- 动作线：按街道显示最近动作摘要，并支持展开完整公开动作日志。
- 下注压力摘要：Hero 决策区固定显示 `toCall`、底池赔率、最小加注到、最大可下注、有效筹码。
- 摊牌与结算：显示公开底牌、牌力名称、主池/边池获胜者、平分和 odd chip，支持多边池逐段展开。
- 牌桌节奏：新增发牌、下注、弃牌、全下、结算的轻量动画状态；动画只增强可读性，不影响规则推进。
- 响应式牌桌：桌面优先完整信息，移动端优先 Hero、公共牌、底池、当前行动者和行动按钮。

### 2. 行动与下注体验

- 合法动作按钮继续由规则引擎驱动，只渲染当前可执行动作。
- 下注控件升级：保留滑杆/精确输入/快捷尺度，新增 BB 尺度、当前底池比例、最小合法加注到、全下快捷确认。
- 快捷预设：`1/3 池`、`1/2 池`、`2/3 池`、`池`、`2.2BB`、`2.5BB`、`3BB`、`全下`，按翻前/翻后上下文过滤。
- 行动热键：支持可配置键盘操作，默认关闭，开启后在行动区显示热键提示。
- 自动行动保护：所有自动或快捷动作都必须经过当前 snapshot 的 legal actions 校验，提交失败时停留原状态并展示拒绝原因。

### 3. 翻前策略自动执行

- 新增 Hero 翻前策略模块，支持三种模式：`关闭`、`建议但不执行`、`自动执行`。
- 策略输入维度：手牌组合、Hero 位置、有效筹码 BB、前序动作类型、前序加注大小、是否 straddle、桌面人数。
- 策略输出动作：`fold`、`call`、`open raise`、`3bet`、`4bet`、`jam`、`mix`；输出必须映射为当前合法动作和合法金额。
- 范围表达：使用 13x13 起手牌矩阵，支持 suited/off-suit/pair，策略配置可序列化为 JSON。
- 混合频率：支持按百分比随机化，例如 `70% raise / 30% fold`，随机种子由 handId + decisionPointId 派生，保证可复盘。
- 安全停止条件：多前序异常、金额超出规则、策略缺口、非翻前、Hero 请求 AI 教练中、手牌已结束时不自动执行，改为等待用户。
- 审计记录：每次自动策略命中都记录策略版本、输入上下文、输出动作、实际提交动作和是否成功。
- UI 控制：牌桌侧栏提供策略开关、当前命中策略摘要、最近自动执行记录和一键暂停。

### 4. AI 对手策略升级

- 替换当前简易 mock bot 为分层策略：翻前范围策略、翻后启发式策略、风格参数、随机化。
- Bot 风格扩展：`tight-passive`、`tight-aggressive`、`loose-passive`、`loose-aggressive`、`balanced`，保留当前 UI 预设并做映射。
- Bot 仅使用 `bot-seat-view` 可见信息，不读取其他座位隐藏底牌。
- 翻前范围按位置和行动上下文生成候选动作，翻后按牌力粗评、听牌、底池赔率、下注压力和风格选择动作。
- 引入 bot 决策 trace，仅用于测试和开发面板，不暴露隐藏信息。

### 5. Session HUD 与玩家标记

- 新增训练内置 HUD，按当前训练 session 统计 VPIP、PFR、3Bet、ATS、Hands。
- HUD 对 Hero 和 AI 均可展示，但 AI 决策不直接读取面向用户的 HUD 汇总，避免跨视角信息污染。
- 支持用户给 AI 座位设置颜色标签和简短笔记，标签进入历史资产。
- HUD 数据按 session/table 维度重置，长期 Hero 统计进入历史分析模块。

### 6. PokerCraft 类历史与分析

- 历史列表升级为 session 维度：按时间、桌型、盲注、AI 风格、结果、标签筛选。
- 单手回放升级：支持逐步播放、按街道跳转、显示每步底池/筹码变化/合法动作快照。
- 统计页：盈利曲线、EV/实际结果曲线、位置盈亏、起手牌矩阵表现、对手风格表现、常见问题标签。
- Hand Moment：导出一手牌的关键摘要图片或 JSON，包含公共牌、Hero 手牌、最大底池、关键动作和 AI 教练标签。
- 训练资产联动：即时建议、整手复盘、自动策略执行和用户笔记都能在回放时间线上定位。

### 7. Rush/Fast-Fold 训练模式

- 新增 Rush 训练开关：Hero 弃牌后立即进入下一手，不等待当前手牌其他玩家完成。
- Rush 模式不复用当前固定座位桌的完整后续事件；弃牌后的旧手只保存到 Hero 退出时点，标记为 `fast_fold_abandoned`。
- Player pool 模拟：AI 风格和座位每手随机化，但仍保证 Hero 只看到当前手可见信息。
- 适配翻前自动策略：自动弃牌可立即触发下一手，自动加注/跟注则继续当前手牌。

### 8. 教练与训练增强

- 行动前 AI 教练继续作为主航道，新增“结合当前翻前策略解释差异”：策略建议与 AI 建议不一致时显示原因。
- 局后复盘新增自动策略评价：标记自动执行是否符合配置，是否因为安全停止转人工。
- 场景训练：从历史标签、起手牌矩阵和位置弱点生成指定训练局面。
- 长期训练目标：按问题类型设置训练目标，例如翻前范围过宽、3bet 防守不足、翻后下注尺度偏小。

### 9. 牌桌配置与资金模拟

- Buy-in/rebuy 设置：起始买入、自动补码到指定 BB、低于阈值提醒。
- 盲注/ante/straddle 继续保留，新增常用桌型 preset。
- 训练 session 控制：开始、暂停、继续、退出、自动下一手、自动策略暂停。
- 结果单位：支持筹码和 BB 两种显示，不引入真钱金额。

### 10. 明确不做或后置

- 不做真钱账户、充值提现、赌场游戏、锦标赛大厅、staking、leaderboard 奖励。
- 不做第三方 HUD 导入或外挂兼容。
- 不做真实用户多人联网对局。
- EV Cashout、All-In Insurance、Side Games 只可作为远期训练模拟题材，不进入下一阶段主线。

## 分阶段实施

### M7：牌桌信息密度与行动体验（已完成 2026-05-04）

- 扩展 public snapshot 的派生信息：`toCall`、`minRaiseTo`、`effectiveStack`、`lastAction`、`streetActionSummary`、`displayPots`。
- 改造 `TrainingEntry` 牌桌中心、座位 token、行动区和手牌摘要，让底池、筹码投入、当前压力和结算结果一眼可读。
- 新增动作线组件和移动端压缩布局检查。
- 验收：用户在 5 秒内能判断底池、待跟注额、当前行动者、自己可做动作和手牌结果。

执行结果：

- Runtime public snapshot 已新增行动压力、有效筹码、最近动作、按街道动作线、展示底池和座位最近动作字段，并用单元测试覆盖字段生成。
- `TrainingEntry` 已改造牌桌中心、Hero 区、行动区、座位 token 和动作线；下注控件补充最小/最大范围、翻前 BB 快捷尺度和翻后底池比例快捷尺度。
- 移动端布局已为底池明细、Hero 压力摘要、行动压力和动作线增加压缩规则，优先保留 Hero、公共牌、底池、当前行动者和行动按钮。
- Review follow-up：live hand 的 `displayPots` 不再从未匹配的当前投入派生边池；fold 结算的总池 award 会展开到每个已结算 display pot，保证赢家和 share 与 pot amount 一致。
- 验证：`npm run typecheck`、`npm test -- src/server/training-runtime/index.test.ts`、`npm run lint`。

### M8：翻前策略自动执行（已完成 2026-05-04）

- 新增 `src/domain/preflop-strategy`，实现策略配置类型、起手牌归类、上下文匹配、混合频率随机化和合法动作映射。
- 在 runtime 中增加 Hero 自动策略执行循环，仅在 `waiting_for_user + preflop + 策略开启` 时运行，并复用现有 action submit 校验路径。
- UI 增加策略开关、预设选择、当前命中说明、最近自动执行记录和暂停按钮。
- 持久化策略执行事件，进入历史和回放。
- 验收：可配置翻前策略，Hero 翻前自动 fold/open/call/3bet，异常局面安全停下等待人工。

执行结果：

- 新增 `src/domain/preflop-strategy`，实现策略配置类型、13x13 起手牌归类、范围/位置/前序动作/有效筹码匹配、混合频率确定性随机和合法动作映射。
- Runtime 已增加 Hero 翻前策略状态、自动执行循环和 `/strategy` 更新接口；只在 `waiting_for_user + preflop + Hero 行动 + 策略未暂停` 时评估，并复用 `applyAction` 合法性路径提交动作。
- 自动策略已支持关闭、建议但不执行、自动执行三种模式；安全停止覆盖未命中、非法尺度、非翻前、训练结束、暂停和 AI 教练请求锁定。
- 新增 runtime 事件 `strategy_auto_action_evaluated`、`strategy_auto_action_submitted`、`strategy_auto_action_skipped`，public snapshot 暴露当前命中摘要和最近执行记录；整手复盘持久化时会把策略事件写入回放事件流。
- Review follow-up：整手复盘现在只携带当前 hand 的策略执行事件；持久化回放使用稀疏 per-hand sequence 将策略审计插入对应决策点附近，并保留原始 hand/runtime sequence 供历史标注和复盘 insight 匹配。
- `TrainingEntry` 侧栏已新增翻前策略面板，支持模式切换、预设选择、当前命中说明、最近自动执行记录和一键暂停/恢复。
- 验证：`npm test -- src/domain/preflop-strategy/index.test.ts src/server/training-runtime/index.test.ts`、`npm test -- src/server/training-runtime/index.test.ts src/server/training-runtime/persistence.test.ts`、`npm run typecheck`、`npm run lint`、`npm test`。

### M9：AI 对手策略与 HUD（已完成 2026-05-04）

- 将 `chooseBotAction` 拆成可测试 strategy adapter。
- 新增风格范围和翻后启发式，覆盖 tight/balanced/loose/aggressive 与扩展风格。
- 统计 session HUD：VPIP、PFR、3Bet、ATS、Hands，并在座位上轻量展示。
- 支持用户颜色标签和笔记。
- 验收：bot 行为不再只是 check/call/fold，HUD 可随手数更新且不泄露隐藏信息。

执行结果：

- 新增 `src/domain/bot-strategy` 可测试 strategy adapter，runtime 通过 `bot-seat-view` 调用，不读取 Hero 或其他对手隐藏底牌。
- Bot 风格扩展为 `tight-passive`、`tight-aggressive`、`loose-passive`、`loose-aggressive`、`balanced`；旧 `tight`、`loose`、`aggressive` 输入会归一化到扩展风格，现有 UI 预设已映射到新风格组合。
- 翻前策略已按起手牌强度、加注历史、下注压力和风格参数选择 fold/call/raise/jam；翻后策略已按粗牌力、听牌、底池赔率、下注压力和风格参数选择 check/call/fold/bet/raise/jam，并生成 bot 决策 trace 供测试/开发使用。
- Runtime 已新增 session HUD read model，按 table/session 统计每个座位的 Hands、VPIP、PFR、3Bet、ATS，并通过 `hud_stats_updated` 事件和 public snapshot 更新；AI 决策仍只消费 bot 可见视图，不读取面向用户的 HUD 汇总。
- Public seat snapshot 已包含 HUD、颜色标签和笔记；新增 `/api/training/tables/[tableId]/seats/[seatIndex]/profile` 更新接口，侧栏支持给 AI 座位设置颜色标签和 120 字以内笔记，复盘持久化的 seat profile payload 会带上标签和笔记。
- `TrainingEntry` 已在座位 token 轻量展示 VPIP/PFR/Hands，在侧栏新增 Session HUD 面板展示 VPIP、PFR、3Bet、ATS 和 AI 座位标记编辑。
- 验证：`npm test -- src/domain/bot-strategy/index.test.ts src/server/training-runtime/index.test.ts`、`npm run typecheck`、`npm run lint`、`npm test`。

### M10：PokerCraft 类历史分析

- 扩展持久化 read model：session、策略执行、HUD 统计、起手牌矩阵、位置结果。
- 升级历史面板和单手回放，支持逐步播放与底池/筹码变化。
- 新增统计页面或侧栏 tab：盈亏曲线、位置、起手牌、对手风格、问题标签。
- 验收：用户能从历史中定位一类重复错误，并回放到具体决策点。

### M11：Rush/Fast-Fold 与高频训练

- 新增 fast-fold table mode，Hero fold 后立即启动下一手。
- 支持 player pool 风格随机化和 fast-fold hand lifecycle 标记。
- 翻前自动策略与 fast-fold 联动，适合高频练习开局范围。
- 验收：开启策略和 Rush 后可快速过掉不入池手牌，同时保留可复盘的训练资产。

### M12：高级训练闭环

- 场景训练生成：从历史弱点和预设主题创建指定局面。
- 教练对比策略：AI 建议、用户行动和自动策略三方比较。
- 训练目标和进度：按问题标签统计改善趋势。
- 可选导出 Hand Moment。

## 接口与数据变更

- `TrainingTableCreateInput` 增加可选 `tableMode`、`heroPreflopStrategyId`、`autoRebuyConfig`。
- `PublicHandState` 增加派生展示字段，避免 UI 重复推导复杂下注压力。
- 新增策略配置类型：`PreflopStrategyConfig`、`PreflopStrategyRule`、`PreflopStrategyDecision`、`StrategyExecutionEvent`。
- 新增 runtime public event：`strategy_auto_action_evaluated`、`strategy_auto_action_submitted`、`strategy_auto_action_skipped`、`hud_stats_updated`、`fast_fold_abandoned`。
- Prisma 后续迁移新增策略表、session 统计表、玩家笔记/标签表和策略执行日志表。

## 测试计划

- 单元测试：起手牌归类、范围匹配、混合频率稳定性、策略输出到 legal action 映射、bot 策略、HUD 指标计算。
- Runtime 测试：自动策略只在翻前 Hero 决策点触发；AI 教练锁定时不自动执行；非法策略输出安全跳过；Rush fold 后立即下一手。
- UI 测试：4/6/9/12 人桌、桌面/移动端、底池/边池/行动者/下注压力展示、策略开关、策略暂停、HUD 更新。
- 持久化测试：策略执行事件、历史回放时间线、session 统计、用户标签笔记。
- 回归测试：现有 NLHE 规则、AI 教练扣点、复盘、自动下一手、退出训练不可被新自动化破坏。

## 默认取舍

- 下一阶段建议先做 M7 + M8，因为它们直接解决“牌局太基础”和“翻前策略自动执行”两个最明显缺口。
- 所有自动策略都必须低于规则引擎权限：策略只能提出动作，最终合法性由 `src/domain/poker` 校验。
- 所有 GGpoker 对标功能都以训练价值为准，不把真钱客户端的商业功能搬进 v1。

## 外部参考

- GGpoker Games & Features Guide: https://ggpoker.com/blog/games-features-guide/
- GGpoker PokerCraft: https://ggpoker.com/poker-games/pokercraft/
- GGpoker Smart HUD guide: https://ggpoker.com/blog/your-strategy-guide-to-ggpokers-smart-hud
- GGpoker Rush & Cash guide: https://ggpoker.com/blog/rush-cash-ggpokers-fast-fold-game
