import type { AiCoachConfig } from "@/ai/config";

type TrainingEntryProps = {
  coachConfig: AiCoachConfig;
};

export function TrainingEntry({ coachConfig }: TrainingEntryProps) {
  return (
    <section className="trainingEntry" aria-labelledby="training-entry-title">
      <div className="tablePreview" aria-hidden="true">
        <div className="tableRail">
          <div className="communityCards">
            <span>A♠</span>
            <span>7♥</span>
            <span>4♣</span>
          </div>
          <div className="potLabel">Pot 12.5 BB</div>
        </div>
      </div>

      <aside className="entryPanel">
        <p className="eyebrow">M0 工程骨架</p>
        <h1 id="training-entry-title">训练牌桌入口</h1>
        <p className="summary">
          当前版本只提供可运行入口、AI 教练配置读取和规则引擎测试
          harness；牌桌业务流程将在后续里程碑接入。
        </p>
        <dl className="configList">
          <div>
            <dt>AI 教练超时</dt>
            <dd>{coachConfig.requestTimeoutMs} ms</dd>
          </div>
          <div>
            <dt>自动重试</dt>
            <dd>{coachConfig.retryAttempts} 次</dd>
          </div>
          <div>
            <dt>重试退避</dt>
            <dd>{coachConfig.retryBackoffMs} ms</dd>
          </div>
        </dl>
      </aside>
    </section>
  );
}
