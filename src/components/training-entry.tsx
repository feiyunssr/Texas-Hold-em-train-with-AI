"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { HeroCoachAdvice } from "@/ai/hero-coach";
import type { AiCoachConfig } from "@/ai/config";
import type { ActionType, CardCode, LegalAction } from "@/domain/poker";
import type {
  BotStyle,
  PublicSeatState,
  RuntimePublicEvent,
  TrainingTableCreateInput,
  TrainingTableSnapshot
} from "@/server/training-runtime/types";

type TrainingEntryProps = {
  coachConfig: AiCoachConfig;
};

type TableFormState = {
  playerCount: 4 | 6 | 9 | 12;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  ante: number;
  straddleEnabled: boolean;
  straddleSeat: number;
  straddleAmount: number;
  aiStylePreset: "balanced" | "mixed" | "pressure" | "patient";
};

type CoachPanelState =
  | {
      status: "available";
      message: string;
    }
  | {
      status: "requesting";
      message: string;
      requestId: string;
    }
  | {
      status: "saved_charged";
      requestId: string;
      decisionPointId: string;
      chargedAmount: number;
      balanceAfter: number;
      advice: HeroCoachAdvice | null;
      message: string;
    }
  | {
      status: "pending_persistence";
      requestId: string;
      message: string;
      advice: HeroCoachAdvice | null;
    }
  | {
      status: "failed_not_charged";
      requestId: string;
      errorType: string;
      errorMessage: string;
      message: string;
    }
  | {
      status: "partial_not_final";
      requestId: string;
      partialResponse: unknown;
      message: string;
    }
  | {
      status: "already_requested";
      requestId: string;
      existingStatus: string | null;
      message: string;
    };

type CoachApiResult = {
  status:
    | "saved_charged"
    | "partial_not_final"
    | "failed_not_charged"
    | "already_requested"
    | "pending_persistence";
  requestId: string;
  decisionPointId?: string;
  chargedAmount?: number;
  balanceAfter?: number;
  advice?: unknown;
  partialResponse?: unknown;
  errorType?: string;
  errorMessage?: string;
  existingStatus?: string | null;
  message?: string;
};

const DEFAULT_FORM: TableFormState = {
  playerCount: 6,
  smallBlind: 1,
  bigBlind: 2,
  startingStack: 200,
  ante: 0,
  straddleEnabled: false,
  straddleSeat: 3,
  straddleAmount: 4,
  aiStylePreset: "mixed"
};

const DEMO_USER_ID = "demo-user";
const DEMO_WALLET_ACCOUNT_ID = "demo-wallet-account";
const COACH_CHARGE_AMOUNT = 1;
const INITIAL_EVENT_REPLAY_AFTER_SEQUENCE = 0;

const SSE_EVENT_TYPES = [
  "table_created",
  "hand_started",
  "runtime_snapshot",
  "user_action_rejected",
  "forced_bet_posted",
  "hole_cards_dealt",
  "player_action",
  "street_advanced",
  "board_dealt",
  "showdown_evaluated",
  "pot_awarded",
  "hand_completed"
];

const ACTION_LABELS: Record<ActionType, string> = {
  fold: "弃牌",
  check: "过牌",
  call: "跟注",
  bet: "下注",
  raise: "加注",
  "all-in": "全下"
};

const STREET_LABELS: Record<TrainingTableSnapshot["hand"]["street"], string> = {
  preflop: "翻前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
  complete: "结束"
};

const STYLE_LABELS: Record<BotStyle | "hero", string> = {
  hero: "Hero",
  tight: "紧",
  balanced: "均衡",
  loose: "松",
  aggressive: "压迫"
};

export function TrainingEntry({ coachConfig }: TrainingEntryProps) {
  const [form, setForm] = useState<TableFormState>(DEFAULT_FORM);
  const [snapshot, setSnapshot] = useState<TrainingTableSnapshot | null>(null);
  const [events, setEvents] = useState<RuntimePublicEvent[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [isStartingNextHand, setIsStartingNextHand] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [coachState, setCoachState] = useState<CoachPanelState>({
    status: "available",
    message: "轮到你行动时可请求一次正式 AI 建议。"
  });
  const [lastDecisionKey, setLastDecisionKey] = useState<string | null>(null);
  const isSubmittingActionRef = useRef(false);

  const legalActions = snapshot?.hand.legalActions ?? [];
  const betLikeAction = useMemo(
    () =>
      legalActions.find((action) => action.type === "bet") ??
      legalActions.find((action) => action.type === "raise"),
    [legalActions]
  );
  const isHeroTurn = snapshot?.status === "waiting_for_user";
  const decisionKey =
    snapshot && isHeroTurn
      ? `${snapshot.hand.handId}:${snapshot.hand.street}:${snapshot.hand.lastSequence}`
      : null;

  useEffect(() => {
    if (!snapshot?.tableId) {
      return;
    }

    const source = new EventSource(
      `/api/training/tables/${snapshot.tableId}/events?after=${INITIAL_EVENT_REPLAY_AFTER_SEQUENCE}`
    );
    const handleEvent = (event: MessageEvent<string>) => {
      const parsed = JSON.parse(event.data) as {
        event: RuntimePublicEvent;
        snapshot: TrainingTableSnapshot;
      };
      setSnapshot(parsed.snapshot);
      if (parsed.event.type === "runtime_snapshot") {
        return;
      }
      setEvents((current) => appendEvent(current, parsed.event));
    };

    for (const eventType of SSE_EVENT_TYPES) {
      source.addEventListener(eventType, handleEvent);
    }
    source.onerror = () => {
      setNotice("实时连接暂时中断，仍可通过操作后的快照继续训练。");
    };

    return () => {
      for (const eventType of SSE_EVENT_TYPES) {
        source.removeEventListener(eventType, handleEvent);
      }
      source.close();
    };
  }, [snapshot?.tableId]);

  useEffect(() => {
    if (!betLikeAction) {
      setSelectedAmount(0);
      return;
    }

    setSelectedAmount((current) =>
      clampAmount(
        current || betLikeAction.amount || betLikeAction.minAmount || 0,
        betLikeAction
      )
    );
  }, [betLikeAction]);

  useEffect(() => {
    if (!decisionKey || decisionKey === lastDecisionKey) {
      return;
    }

    setLastDecisionKey(decisionKey);
    setCoachState({
      status: "available",
      message: "本决策点可请求一次正式 AI 建议。"
    });
  }, [decisionKey, lastDecisionKey]);

  async function createTable() {
    setIsCreating(true);
    setNotice(null);
    setCoachState({
      status: "available",
      message: "轮到你行动时可请求一次正式 AI 建议。"
    });

    try {
      const body: TrainingTableCreateInput = {
        playerCount: form.playerCount,
        smallBlind: form.smallBlind,
        bigBlind: form.bigBlind,
        startingStack: form.startingStack,
        ante: form.ante,
        heroSeatIndex: 0,
        buttonSeat: 0,
        aiStyles: buildAiStyles(form.aiStylePreset, form.playerCount - 1)
      };

      if (form.straddleEnabled) {
        body.straddleSeat = Math.min(form.straddleSeat, form.playerCount - 1);
        body.straddleAmount = form.straddleAmount;
      }

      const response = await fetch("/api/training/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as
        | TrainingTableSnapshot
        | { message?: string };

      if (!response.ok) {
        throw new Error("message" in payload ? payload.message : undefined);
      }

      setSnapshot(payload as TrainingTableSnapshot);
      setEvents([]);
    } catch (error) {
      setNotice(errorMessage(error, "训练桌创建失败。"));
    } finally {
      setIsCreating(false);
    }
  }

  async function submitAction(action: LegalAction) {
    if (!snapshot) {
      return;
    }

    isSubmittingActionRef.current = true;
    setIsSubmittingAction(true);
    setNotice(null);

    try {
      const amount = resolveActionAmount(action, selectedAmount);
      const response = await fetch(
        `/api/training/tables/${snapshot.tableId}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: action.type,
            ...(amount === undefined ? {} : { amount })
          })
        }
      );
      const payload = (await response.json()) as
        | TrainingTableSnapshot
        | { message?: string; snapshot?: TrainingTableSnapshot };

      if (!response.ok) {
        if ("snapshot" in payload && payload.snapshot) {
          setSnapshot(payload.snapshot);
        }
        throw new Error("message" in payload ? payload.message : undefined);
      }

      setSnapshot(payload as TrainingTableSnapshot);
    } catch (error) {
      setNotice(errorMessage(error, "行动提交失败。"));
    } finally {
      isSubmittingActionRef.current = false;
      setIsSubmittingAction(false);
    }
  }

  async function requestCoach() {
    if (
      !snapshot ||
      !isHeroTurn ||
      isSubmittingAction ||
      isSubmittingActionRef.current ||
      coachState.status === "requesting"
    ) {
      return;
    }

    const requestId = crypto.randomUUID();
    setCoachState({
      status: "requesting",
      requestId,
      message: "AI 教练正在分析，本决策点暂时冻结。"
    });
    setNotice(null);

    try {
      const response = await fetch(
        `/api/training/tables/${snapshot.tableId}/coach`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId,
            userId: DEMO_USER_ID,
            walletAccountId: DEMO_WALLET_ACCOUNT_ID,
            chargeAmount: COACH_CHARGE_AMOUNT
          })
        }
      );
      const result = (await response.json()) as CoachApiResult;

      if (!response.ok && result.status !== "already_requested") {
        setCoachState({
          status: "failed_not_charged",
          requestId,
          errorType: result.status ?? "request_failed",
          errorMessage:
            result.message ?? "本次建议未完成，未扣点。你可以继续行动。",
          message: "本次建议未完成，未扣点。你可以继续行动。"
        });
        return;
      }

      setCoachState(coachResultToPanelState(result));
    } catch (error) {
      setCoachState({
        status: "failed_not_charged",
        requestId,
        errorType: "network_error",
        errorMessage: errorMessage(error, "请求 AI 建议失败。"),
        message: "本次建议未完成，未扣点。你可以继续行动。"
      });
    }
  }

  async function startNextHand() {
    if (!snapshot) {
      return;
    }

    setIsStartingNextHand(true);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/training/tables/${snapshot.tableId}/next-hand`,
        { method: "POST" }
      );
      const payload = (await response.json()) as
        | TrainingTableSnapshot
        | { message?: string };

      if (!response.ok) {
        throw new Error("message" in payload ? payload.message : undefined);
      }

      setSnapshot(payload as TrainingTableSnapshot);
      setCoachState({
        status: "available",
        message: "轮到你行动时可请求一次正式 AI 建议。"
      });
    } catch (error) {
      setNotice(errorMessage(error, "下一手牌启动失败。"));
    } finally {
      setIsStartingNextHand(false);
    }
  }

  return (
    <section className="trainingEntry" aria-labelledby="training-entry-title">
      <div className="workspaceHeader">
        <div>
          <p className="eyebrow">M5 v1 UI 主航道</p>
          <h1 id="training-entry-title">AI 德州扑克训练桌</h1>
        </div>
        <div className="syncStatus" aria-live="polite">
          {snapshot
            ? `${STREET_LABELS[snapshot.hand.street]} · ${statusCopy(snapshot)}`
            : "未创建训练桌"}
        </div>
      </div>

      <div className="trainingWorkspace">
        <div className="tableColumn">
          <TableConfigurator
            form={form}
            isCreating={isCreating}
            onChange={setForm}
            onCreate={createTable}
          />
          <PokerTable snapshot={snapshot} />
          <ActionTray
            snapshot={snapshot}
            selectedAmount={selectedAmount}
            isSubmitting={isSubmittingAction}
            isCoachRequesting={coachState.status === "requesting"}
            onAmountChange={setSelectedAmount}
            onSubmit={submitAction}
            onRequestCoach={requestCoach}
          />
          {notice ? (
            <p className="notice" role="status">
              {notice}
            </p>
          ) : null}
        </div>

        <aside className="sideRail" aria-label="训练辅助面板">
          <CoachPanel
            coachConfig={coachConfig}
            coachState={coachState}
            isHeroTurn={isHeroTurn}
            isSubmittingAction={isSubmittingAction}
            onRequestCoach={requestCoach}
          />
          <HandSummary
            snapshot={snapshot}
            events={events}
            isStartingNextHand={isStartingNextHand}
            onStartNextHand={startNextHand}
          />
        </aside>
      </div>
    </section>
  );
}

function TableConfigurator({
  form,
  isCreating,
  onChange,
  onCreate
}: {
  form: TableFormState;
  isCreating: boolean;
  onChange: (nextForm: TableFormState) => void;
  onCreate: () => void;
}) {
  return (
    <form
      className="tableConfigurator"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate();
      }}
    >
      <label>
        人数
        <select
          value={form.playerCount}
          onChange={(event) =>
            onChange({
              ...form,
              playerCount: Number(event.target.value) as 4 | 6 | 9 | 12
            })
          }
        >
          <option value={4}>4 人</option>
          <option value={6}>6 人</option>
          <option value={9}>9 人</option>
          <option value={12}>12 人</option>
        </select>
      </label>
      <NumberField
        label="小盲"
        value={form.smallBlind}
        min={1}
        onChange={(smallBlind) => onChange({ ...form, smallBlind })}
      />
      <NumberField
        label="大盲"
        value={form.bigBlind}
        min={2}
        onChange={(bigBlind) => onChange({ ...form, bigBlind })}
      />
      <NumberField
        label="起始筹码"
        value={form.startingStack}
        min={20}
        onChange={(startingStack) => onChange({ ...form, startingStack })}
      />
      <NumberField
        label="Ante"
        value={form.ante}
        min={0}
        onChange={(ante) => onChange({ ...form, ante })}
      />
      <label>
        AI 风格
        <select
          value={form.aiStylePreset}
          onChange={(event) =>
            onChange({
              ...form,
              aiStylePreset: event.target
                .value as TableFormState["aiStylePreset"]
            })
          }
        >
          <option value="mixed">混合</option>
          <option value="balanced">均衡</option>
          <option value="pressure">压迫</option>
          <option value="patient">耐心</option>
        </select>
      </label>
      <label className="toggleField">
        <input
          type="checkbox"
          checked={form.straddleEnabled}
          onChange={(event) =>
            onChange({ ...form, straddleEnabled: event.target.checked })
          }
        />
        Straddle
      </label>
      {form.straddleEnabled ? (
        <>
          <NumberField
            label="Straddle 座位"
            value={form.straddleSeat}
            min={0}
            max={form.playerCount - 1}
            onChange={(straddleSeat) => onChange({ ...form, straddleSeat })}
          />
          <NumberField
            label="Straddle 额"
            value={form.straddleAmount}
            min={form.bigBlind + 1}
            onChange={(straddleAmount) => onChange({ ...form, straddleAmount })}
          />
        </>
      ) : null}
      <button className="primaryButton" type="submit" disabled={isCreating}>
        {isCreating ? "创建中" : "创建牌桌"}
      </button>
    </form>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={1}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function PokerTable({ snapshot }: { snapshot: TrainingTableSnapshot | null }) {
  const seats = snapshot?.hand.seats ?? [];

  return (
    <section className="tableStage" aria-label="实时训练牌桌">
      <div className="opponentRail" aria-label="座位状态">
        {seats.map((seat) => (
          <SeatToken
            key={seat.seatIndex}
            seat={seat}
            currentActorSeat={snapshot?.hand.currentActorSeat ?? null}
          />
        ))}
      </div>
      <div className="pokerTable">
        <div className="tableCenter">
          <div className="streetPill">
            {snapshot ? STREET_LABELS[snapshot.hand.street] : "等待开桌"}
          </div>
          <CardRow cards={snapshot?.hand.board ?? []} emptyCount={5} />
          <div className="potGrid">
            <div>
              <span>主池</span>
              <strong>
                {snapshot ? formatChips(snapshot.hand.potTotal) : "-"}
              </strong>
            </div>
            <div>
              <span>边池</span>
              <strong>{snapshot ? sidePotCopy(snapshot) : "-"}</strong>
            </div>
            <div>
              <span>当前下注</span>
              <strong>
                {snapshot ? formatChips(snapshot.hand.currentBet) : "-"}
              </strong>
            </div>
            <div>
              <span>当前行动者</span>
              <strong>{currentActorCopy(snapshot)}</strong>
            </div>
          </div>
        </div>
      </div>
      <HeroZone snapshot={snapshot} />
    </section>
  );
}

function SeatToken({
  seat,
  currentActorSeat
}: {
  seat: PublicSeatState;
  currentActorSeat: number | null;
}) {
  const markers = [
    seat.isButton ? "D" : null,
    seat.isSmallBlind ? "SB" : null,
    seat.isBigBlind ? "BB" : null
  ].filter(Boolean);

  return (
    <div
      className={[
        "seatToken",
        seat.isHero ? "heroSeatToken" : "",
        seat.seatIndex === currentActorSeat ? "currentSeatToken" : "",
        seat.status === "folded" ? "foldedSeatToken" : ""
      ].join(" ")}
    >
      <div className="seatTopline">
        <span className="avatar">{initials(seat.displayName)}</span>
        <strong>{seat.displayName}</strong>
      </div>
      <div className="seatFacts">
        <span>{formatChips(seat.stack)}</span>
        <span>{statusLabel(seat.status)}</span>
        <span>{STYLE_LABELS[seat.style]}</span>
      </div>
      <div className="seatMarkers">
        {markers.map((marker) => (
          <span key={marker}>{marker}</span>
        ))}
        {seat.streetCommitment > 0 ? (
          <span>本街 {formatChips(seat.streetCommitment)}</span>
        ) : null}
      </div>
    </div>
  );
}

function HeroZone({ snapshot }: { snapshot: TrainingTableSnapshot | null }) {
  const hero = snapshot?.hand.seats.find((seat) => seat.isHero);

  return (
    <section className="heroZone" aria-label="用户席位">
      <div>
        <span className="sectionLabel">用户席位</span>
        <strong>{hero ? hero.displayName : "Hero"}</strong>
        <p>
          {hero
            ? `${formatChips(hero.stack)} · 本街投入 ${formatChips(hero.streetCommitment)}`
            : "创建训练桌后显示底牌和行动压力。"}
        </p>
      </div>
      <CardRow cards={hero?.holeCards ?? []} emptyCount={2} />
    </section>
  );
}

function CardRow({
  cards,
  emptyCount
}: {
  cards: CardCode[];
  emptyCount: number;
}) {
  const placeholders = Math.max(0, emptyCount - cards.length);

  return (
    <div className="cardRow">
      {cards.map((card) => (
        <span
          key={card}
          className={`playingCard ${isRedSuit(card) ? "redCard" : ""}`}
        >
          {formatCard(card)}
        </span>
      ))}
      {Array.from({ length: placeholders }, (_, index) => (
        <span key={`empty-${index}`} className="playingCard emptyCard">
          -
        </span>
      ))}
    </div>
  );
}

function ActionTray({
  snapshot,
  selectedAmount,
  isSubmitting,
  isCoachRequesting,
  onAmountChange,
  onSubmit,
  onRequestCoach
}: {
  snapshot: TrainingTableSnapshot | null;
  selectedAmount: number;
  isSubmitting: boolean;
  isCoachRequesting: boolean;
  onAmountChange: (amount: number) => void;
  onSubmit: (action: LegalAction) => void;
  onRequestCoach: () => void;
}) {
  const legalActions = snapshot?.hand.legalActions ?? [];
  const betLikeAction =
    legalActions.find((action) => action.type === "bet") ??
    legalActions.find((action) => action.type === "raise");
  const isHeroTurn = snapshot?.status === "waiting_for_user";

  return (
    <section className="actionTray" aria-label="行动区">
      <div>
        <span className="sectionLabel">行动区</span>
        <strong>{actionTrayTitle(snapshot)}</strong>
      </div>
      {betLikeAction ? (
        <BetSizingControls
          action={betLikeAction}
          potTotal={snapshot?.hand.potTotal ?? 0}
          selectedAmount={selectedAmount}
          onAmountChange={onAmountChange}
        />
      ) : null}
      <div className="actionButtons">
        {legalActions.map((action) => (
          <button
            key={action.type}
            type="button"
            className={
              action.type === "fold" ? "dangerButton" : "primaryButton"
            }
            disabled={!isHeroTurn || isSubmitting || isCoachRequesting}
            onClick={() => onSubmit(action)}
          >
            {ACTION_LABELS[action.type]}
            {actionAmountLabel(action, selectedAmount)}
          </button>
        ))}
        <button
          type="button"
          className="coachButton"
          disabled={!isHeroTurn || isSubmitting || isCoachRequesting}
          onClick={onRequestCoach}
        >
          AI 教练
        </button>
      </div>
    </section>
  );
}

function BetSizingControls({
  action,
  potTotal,
  selectedAmount,
  onAmountChange
}: {
  action: LegalAction;
  potTotal: number;
  selectedAmount: number;
  onAmountChange: (amount: number) => void;
}) {
  const min = action.minAmount ?? action.amount ?? 0;
  const max = action.maxAmount ?? action.amount ?? min;
  const quickSizes = [
    ["1/3 池", Math.round(potTotal / 3)],
    ["1/2 池", Math.round(potTotal / 2)],
    ["2/3 池", Math.round((potTotal * 2) / 3)],
    ["池", potTotal],
    ["全下", max]
  ] as const;

  return (
    <div className="sizingControls">
      <div className="sliderRow">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={clampNumber(selectedAmount, min, max)}
          disabled={min === max}
          onChange={(event) => onAmountChange(Number(event.target.value))}
        />
        <input
          className="amountInput"
          type="number"
          min={min}
          max={max}
          value={clampNumber(selectedAmount, min, max)}
          onChange={(event) =>
            onAmountChange(clampNumber(Number(event.target.value), min, max))
          }
        />
      </div>
      <div className="quickSizes">
        {quickSizes.map(([label, amount]) => (
          <button
            key={label}
            type="button"
            onClick={() => onAmountChange(clampNumber(amount, min, max))}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CoachPanel({
  coachConfig,
  coachState,
  isHeroTurn,
  isSubmittingAction,
  onRequestCoach
}: {
  coachConfig: AiCoachConfig;
  coachState: CoachPanelState;
  isHeroTurn: boolean;
  isSubmittingAction: boolean;
  onRequestCoach: () => void;
}) {
  const advice =
    "advice" in coachState && coachState.advice ? coachState.advice : null;

  return (
    <section
      className={`coachPanel coachState-${coachState.status}`}
      aria-label="AI 教练视角"
    >
      <div className="panelHeader">
        <div>
          <span className="sectionLabel">AI 教练视角</span>
          <h2>{coachStatusTitle(coachState.status)}</h2>
        </div>
        <span className="chargePill">{chargeStateCopy(coachState)}</span>
      </div>
      <p className="coachMessage">{coachState.message}</p>
      {advice ? <AdviceView advice={advice} /> : null}
      {coachState.status === "partial_not_final" ? (
        <pre className="partialPreview">
          {JSON.stringify(coachState.partialResponse, null, 2)}
        </pre>
      ) : null}
      {coachState.status === "failed_not_charged" ? (
        <p className="errorDetail">
          {coachState.errorType}: {coachState.errorMessage}
        </p>
      ) : null}
      {coachState.status === "already_requested" ? (
        <p className="errorDetail">
          已有请求状态：{coachState.existingStatus ?? "处理中或未保存"}
        </p>
      ) : null}
      <button
        type="button"
        className="coachButton fullWidthButton"
        disabled={
          !isHeroTurn ||
          isSubmittingAction ||
          coachState.status === "requesting"
        }
        onClick={onRequestCoach}
      >
        {coachState.status === "requesting" ? "分析中" : "请求 AI 建议"}
      </button>
      <dl className="coachConfigList">
        <div>
          <dt>超时</dt>
          <dd>{coachConfig.requestTimeoutMs} ms</dd>
        </div>
        <div>
          <dt>重试</dt>
          <dd>{coachConfig.retryAttempts} 次</dd>
        </div>
      </dl>
    </section>
  );
}

function AdviceView({ advice }: { advice: HeroCoachAdvice }) {
  return (
    <div className="adviceView">
      <div>
        <span>主推荐</span>
        <strong>{ACTION_LABELS[advice.primaryAction]}</strong>
      </div>
      <div>
        <span>建议尺度</span>
        <strong>
          {advice.suggestedBetAmount === null
            ? "无需额外下注"
            : formatChips(advice.suggestedBetAmount)}
        </strong>
      </div>
      {advice.acceptableAlternatives.length > 0 ? (
        <div className="adviceBlock">
          <span>可接受替代</span>
          <ul>
            {advice.acceptableAlternatives.map((alternative) => (
              <li key={`${alternative.action}-${alternative.amount}`}>
                {ACTION_LABELS[alternative.action]}
                {alternative.amount === null
                  ? ""
                  : ` ${formatChips(alternative.amount)}`}
                {alternative.reason ? ` · ${alternative.reason}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="adviceBlock">
        <span>关键判断因素</span>
        <ul>
          {advice.keyFactors.slice(0, 3).map((factor) => (
            <li key={factor}>{factor}</li>
          ))}
        </ul>
      </div>
      <p className="riskNote">{advice.riskNote}</p>
    </div>
  );
}

function HandSummary({
  snapshot,
  events,
  isStartingNextHand,
  onStartNextHand
}: {
  snapshot: TrainingTableSnapshot | null;
  events: RuntimePublicEvent[];
  isStartingNextHand: boolean;
  onStartNextHand: () => void;
}) {
  const awards = snapshot?.hand.awards ?? [];
  const recentEvents = events.slice(-8).reverse();

  return (
    <section className="handSummary" aria-label="手牌结束摘要和复盘入口">
      <div className="panelHeader">
        <div>
          <span className="sectionLabel">手牌摘要</span>
          <h2>{snapshot?.hand.handId ?? "等待第一手"}</h2>
        </div>
      </div>
      {snapshot?.status === "hand_complete" ? (
        <>
          <p className="coachMessage">
            本手牌已结束，可从这里查看结算和行动摘要。
          </p>
          <div className="summaryRows">
            {awards.map((award, index) => (
              <div key={`${award.potAmount}-${index}`}>
                <span>底池 {formatChips(award.potAmount)}</span>
                <strong>
                  座位{" "}
                  {award.winnerSeatIndexes.map((seat) => seat + 1).join(", ")}
                </strong>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="primaryButton fullWidthButton"
            disabled={isStartingNextHand}
            onClick={onStartNextHand}
          >
            {isStartingNextHand ? "准备中" : "开始下一手"}
          </button>
        </>
      ) : (
        <p className="coachMessage">
          手牌结束后这里会显示结算摘要和基础复盘入口。
        </p>
      )}
      <details className="replayDetails">
        <summary>查看行动摘要</summary>
        <ol>
          {recentEvents.length > 0 ? (
            recentEvents.map((event) => (
              <li key={event.sequence}>
                #{event.sequence} {eventTypeCopy(event)}
              </li>
            ))
          ) : (
            <li>创建牌桌后开始记录公开事件。</li>
          )}
        </ol>
      </details>
    </section>
  );
}

function coachResultToPanelState(result: CoachApiResult): CoachPanelState {
  if (result.status === "saved_charged") {
    return {
      status: "saved_charged",
      requestId: result.requestId,
      decisionPointId: result.decisionPointId ?? "",
      chargedAmount: result.chargedAmount ?? COACH_CHARGE_AMOUNT,
      balanceAfter: result.balanceAfter ?? 0,
      advice: parseAdvice(result.advice),
      message: "建议已保存，点数已扣除。"
    };
  }

  if (result.status === "partial_not_final") {
    return {
      status: "partial_not_final",
      requestId: result.requestId,
      partialResponse: result.partialResponse ?? null,
      message: "本次建议未完成，未扣点。你可以继续行动。"
    };
  }

  if (result.status === "already_requested") {
    return {
      status: "already_requested",
      requestId: result.requestId,
      existingStatus: result.existingStatus ?? null,
      message: "本决策点已使用过正式 AI 建议请求。"
    };
  }

  if (result.status === "pending_persistence") {
    return {
      status: "pending_persistence",
      requestId: result.requestId,
      advice: parseAdvice(result.advice),
      message: "建议正在保存，暂不显示已扣点。"
    };
  }

  return {
    status: "failed_not_charged",
    requestId: result.requestId,
    errorType: result.errorType ?? "request_failed",
    errorMessage:
      result.errorMessage ?? "本次建议未完成，未扣点。你可以继续行动。",
    message: "本次建议未完成，未扣点。你可以继续行动。"
  };
}

function parseAdvice(value: unknown): HeroCoachAdvice | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as HeroCoachAdvice;
  if (
    typeof candidate.primaryAction !== "string" ||
    !Array.isArray(candidate.acceptableAlternatives) ||
    !Array.isArray(candidate.keyFactors) ||
    typeof candidate.riskNote !== "string"
  ) {
    return null;
  }

  return candidate;
}

function buildAiStyles(
  preset: TableFormState["aiStylePreset"],
  count: number
): BotStyle[] {
  const presets: Record<TableFormState["aiStylePreset"], BotStyle[]> = {
    balanced: ["balanced"],
    mixed: ["balanced", "tight", "loose", "aggressive"],
    pressure: ["aggressive", "loose", "balanced"],
    patient: ["tight", "balanced"]
  };
  const styles = presets[preset];

  return Array.from(
    { length: count },
    (_, index) => styles[index % styles.length]
  );
}

function appendEvent(
  current: RuntimePublicEvent[],
  event: RuntimePublicEvent
): RuntimePublicEvent[] {
  if (current.some((candidate) => candidate.sequence === event.sequence)) {
    return current;
  }

  return [...current, event].slice(-80);
}

function resolveActionAmount(
  action: LegalAction,
  selectedAmount: number
): number | undefined {
  if (action.type === "fold" || action.type === "check") {
    return undefined;
  }

  if (action.type === "bet" || action.type === "raise") {
    return clampAmount(selectedAmount, action);
  }

  return action.amount;
}

function clampAmount(amount: number, action: LegalAction): number {
  const min = action.minAmount ?? action.amount ?? 0;
  const max = action.maxAmount ?? action.amount ?? min;

  return clampNumber(amount, min, max);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function actionAmountLabel(
  action: LegalAction,
  selectedAmount: number
): string {
  if (action.type === "bet" || action.type === "raise") {
    return ` ${formatChips(clampAmount(selectedAmount, action))}`;
  }

  if (action.type === "call" || action.type === "all-in") {
    return action.amount === undefined ? "" : ` ${formatChips(action.amount)}`;
  }

  return "";
}

function actionTrayTitle(snapshot: TrainingTableSnapshot | null): string {
  if (!snapshot) {
    return "创建牌桌后显示合法动作";
  }

  if (snapshot.status === "waiting_for_user") {
    return "轮到你行动";
  }

  if (snapshot.status === "hand_complete") {
    return "本手牌已结束";
  }

  return "AI 对手行动中";
}

function statusCopy(snapshot: TrainingTableSnapshot): string {
  if (snapshot.status === "waiting_for_user") {
    return "轮到你行动";
  }

  if (snapshot.status === "hand_complete") {
    return "手牌结束";
  }

  return "AI 对手行动中";
}

function currentActorCopy(snapshot: TrainingTableSnapshot | null): string {
  if (!snapshot || snapshot.hand.currentActorSeat === null) {
    return "-";
  }

  const seat = snapshot.hand.seats.find(
    (candidate) => candidate.seatIndex === snapshot.hand.currentActorSeat
  );

  return seat ? `${seat.displayName} · 座位 ${seat.seatIndex + 1}` : "-";
}

function sidePotCopy(snapshot: TrainingTableSnapshot): string {
  const sidePots = snapshot.hand.pots.slice(1);

  if (sidePots.length === 0) {
    return "无";
  }

  return sidePots.map((pot) => formatChips(pot.amount)).join(" / ");
}

function coachStatusTitle(status: CoachPanelState["status"]): string {
  const titles: Record<CoachPanelState["status"], string> = {
    available: "可请求",
    requesting: "分析中",
    saved_charged: "已保存",
    pending_persistence: "保存中",
    failed_not_charged: "未完成",
    partial_not_final: "部分结果",
    already_requested: "已请求"
  };

  return titles[status];
}

function chargeStateCopy(state: CoachPanelState): string {
  if (state.status === "saved_charged") {
    return `已扣 ${state.chargedAmount} 点`;
  }

  if (
    state.status === "failed_not_charged" ||
    state.status === "partial_not_final"
  ) {
    return "未扣点";
  }

  if (state.status === "pending_persistence") {
    return "未确认扣点";
  }

  return "待请求";
}

function eventTypeCopy(event: RuntimePublicEvent): string {
  if (event.type === "player_action") {
    const payload = event.payload as {
      seatIndex?: number;
      action?: ActionType;
      amount?: number;
    };
    return `座位 ${(payload.seatIndex ?? 0) + 1} ${payload.action ? ACTION_LABELS[payload.action] : "行动"} ${formatChips(payload.amount ?? 0)}`;
  }

  const eventLabels: Record<RuntimePublicEvent["type"], string> = {
    table_created: "牌桌创建",
    hand_started: "手牌开始",
    runtime_snapshot: "状态同步",
    user_action_rejected: "行动被拒绝",
    forced_bet_posted: "强制下注",
    hole_cards_dealt: "发底牌",
    player_action: "玩家行动",
    street_advanced: "街道推进",
    board_dealt: "公共牌发出",
    showdown_evaluated: "摊牌评估",
    pot_awarded: "底池结算",
    hand_completed: "手牌完成"
  };

  return eventLabels[event.type];
}

function statusLabel(status: PublicSeatState["status"]): string {
  const labels: Record<PublicSeatState["status"], string> = {
    active: "行动中",
    folded: "已弃牌",
    "all-in": "全下"
  };

  return labels[status];
}

function formatCard(card: CardCode): string {
  const rank = card.slice(0, 1);
  const suit = card.slice(1);
  const suitLabel: Record<string, string> = {
    c: "♣",
    d: "♦",
    h: "♥",
    s: "♠"
  };

  return `${rank}${suitLabel[suit] ?? suit}`;
}

function isRedSuit(card: CardCode): boolean {
  return card.endsWith("h") || card.endsWith("d");
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatChips(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
