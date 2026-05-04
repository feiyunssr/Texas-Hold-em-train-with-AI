"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import type { HeroCoachAdvice } from "@/ai/hero-coach";
import type { HandReview } from "@/ai/hand-review";
import type { AiCoachConfig } from "@/ai/config";
import type { ActionType, CardCode, LegalAction } from "@/domain/poker";
import type {
  BotStyle,
  PublicActionSummary,
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

type ReviewPanelState =
  | {
      status: "idle";
      message: string;
    }
  | {
      status: "requesting";
      requestId: string;
      message: string;
    }
  | {
      status: "saved_charged";
      requestId: string;
      handId: string;
      chargedAmount: number;
      balanceAfter: number;
      review: HandReview;
      message: string;
    }
  | {
      status: "failed_not_charged";
      requestId: string;
      handId: string | null;
      errorType: string;
      errorMessage: string;
      message: string;
    };

type ReviewApiResult = {
  status: "saved_charged" | "failed_not_charged";
  requestId: string;
  handId: string;
  chargedAmount?: number;
  balanceAfter?: number;
  review?: unknown;
  errorType?: string;
  errorMessage?: string;
  message?: string;
};

type HandHistoryFilters = {
  playerCount: string;
  position: string;
  street: string;
  result: string;
  tag: string;
  problemType: string;
  opponentStyle: string;
};

type HandHistoryRowView = {
  handId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  completionReason: string | null;
  playerCount: number;
  heroSeatIndex: number | null;
  heroPosition: string | null;
  result: string | null;
  hasAIArtifacts: boolean;
  hasHeroCoach: boolean;
  hasHandReview: boolean;
  labelKeys: string[];
  streets: string[];
  opponentStyles: string[];
};

type HandReplayView = {
  handId: string;
  history: HandHistoryRowView;
  timeline: Array<{
    id: string;
    sequence: number;
    eventType: string;
    street: string | null;
    payload: unknown;
    aiArtifacts: Array<{
      id: string;
      artifactKind: string;
      status: string;
      requestId: string;
    }>;
    labels: Array<{
      key: string;
      title: string;
      source: string;
      note: string | null;
      aiArtifactId: string | null;
    }>;
    handReviewInsights: Array<{
      aiArtifactId: string;
      summary: string;
      tags: string[];
    }>;
  }>;
  handReviewArtifacts: Array<{
    id: string;
    status: string;
    requestId: string;
    responsePayload: unknown;
  }>;
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
const REVIEW_CHARGE_AMOUNT = 2;
const INITIAL_EVENT_REPLAY_AFTER_SEQUENCE = 0;
const DEFAULT_HISTORY_FILTERS: HandHistoryFilters = {
  playerCount: "",
  position: "",
  street: "",
  result: "",
  tag: "",
  problemType: "",
  opponentStyle: ""
};

const SSE_EVENT_TYPES = [
  "table_created",
  "hand_started",
  "training_ended",
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
  const [isQuittingTraining, setIsQuittingTraining] = useState(false);
  const [continueEnabled, setContinueEnabled] = useState(true);
  const [selectedAmount, setSelectedAmount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [coachState, setCoachState] = useState<CoachPanelState>({
    status: "available",
    message: "轮到你行动时可请求一次正式 AI 建议。"
  });
  const [reviewState, setReviewState] = useState<ReviewPanelState>({
    status: "idle",
    message: "手牌结束后可请求完整复盘。"
  });
  const [historyRows, setHistoryRows] = useState<HandHistoryRowView[]>([]);
  const [historyFilters, setHistoryFilters] = useState<HandHistoryFilters>(
    DEFAULT_HISTORY_FILTERS
  );
  const [selectedReplay, setSelectedReplay] = useState<HandReplayView | null>(
    null
  );
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingReplay, setIsLoadingReplay] = useState(false);
  const [lastDecisionKey, setLastDecisionKey] = useState<string | null>(null);
  const isSubmittingActionRef = useRef(false);
  const autoContinueHandRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (
      !snapshot ||
      !continueEnabled ||
      snapshot.status !== "hand_complete" ||
      isStartingNextHand ||
      autoContinueHandRef.current === snapshot.hand.handId
    ) {
      return;
    }

    const handId = snapshot.hand.handId;
    const timeout = window.setTimeout(() => {
      if (autoContinueHandRef.current === handId) {
        return;
      }

      autoContinueHandRef.current = handId;
      void startNextHand();
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [snapshot, continueEnabled, isStartingNextHand]);

  useEffect(() => {
    void loadHistory();
  }, []);

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
      setContinueEnabled(true);
      autoContinueHandRef.current = null;
      setReviewState({
        status: "idle",
        message: "手牌结束后可请求完整复盘。"
      });
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
      setReviewState({
        status: "idle",
        message: "手牌结束后可请求完整复盘。"
      });
      autoContinueHandRef.current = null;
    } catch (error) {
      setNotice(errorMessage(error, "下一手牌启动失败。"));
    } finally {
      setIsStartingNextHand(false);
    }
  }

  async function toggleContinue() {
    if (!snapshot || snapshot.status === "training_ended") {
      return;
    }

    if (snapshot.status === "hand_complete") {
      setContinueEnabled(true);
      await startNextHand();
      return;
    }

    setContinueEnabled((current) => !current);
  }

  async function quitTraining() {
    if (!snapshot || snapshot.status === "training_ended") {
      return;
    }

    setIsQuittingTraining(true);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/training/tables/${snapshot.tableId}/quit`,
        { method: "POST" }
      );
      const payload = (await response.json()) as
        | TrainingTableSnapshot
        | { message?: string };

      if (!response.ok) {
        throw new Error("message" in payload ? payload.message : undefined);
      }

      setSnapshot(payload as TrainingTableSnapshot);
      setContinueEnabled(false);
      setCoachState({
        status: "available",
        message: "训练已结束。"
      });
    } catch (error) {
      setNotice(errorMessage(error, "退出训练失败。"));
    } finally {
      setIsQuittingTraining(false);
    }
  }

  async function requestHandReview() {
    if (!snapshot || snapshot.hand.street !== "complete") {
      return;
    }

    const requestId = crypto.randomUUID();
    setReviewState({
      status: "requesting",
      requestId,
      message: "AI 正在生成整手复盘，成功保存后才会扣点。"
    });
    setNotice(null);

    try {
      const response = await fetch(
        `/api/training/tables/${snapshot.tableId}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId,
            userId: DEMO_USER_ID,
            walletAccountId: DEMO_WALLET_ACCOUNT_ID,
            chargeAmount: REVIEW_CHARGE_AMOUNT
          })
        }
      );
      const result = (await response.json()) as ReviewApiResult;

      if (!response.ok || result.status === "failed_not_charged") {
        setReviewState({
          status: "failed_not_charged",
          requestId,
          handId: result.handId ?? snapshot.hand.handId,
          errorType: result.errorType ?? result.status ?? "review_failed",
          errorMessage:
            result.errorMessage ?? result.message ?? "本次复盘未完成，未扣点。",
          message: "本次复盘未完成，未扣点。"
        });
        return;
      }

      setReviewState({
        status: "saved_charged",
        requestId: result.requestId,
        handId: result.handId,
        chargedAmount: result.chargedAmount ?? REVIEW_CHARGE_AMOUNT,
        balanceAfter: result.balanceAfter ?? 0,
        review: parseHandReview(result.review),
        message: "整手复盘已保存，点数已扣除。"
      });
      await loadHistory();
      await loadReplay(result.handId);
    } catch (error) {
      setReviewState({
        status: "failed_not_charged",
        requestId,
        handId: snapshot.hand.handId,
        errorType: "network_error",
        errorMessage: errorMessage(error, "请求整手复盘失败。"),
        message: "本次复盘未完成，未扣点。"
      });
    }
  }

  async function loadHistory(nextFilters = historyFilters) {
    setIsLoadingHistory(true);
    try {
      const params = new URLSearchParams({
        userId: DEMO_USER_ID,
        limit: "20"
      });
      for (const [key, value] of Object.entries(nextFilters)) {
        if (value) {
          params.set(key, value);
        }
      }

      const response = await fetch(`/api/training/history?${params}`);
      const payload = (await response.json()) as {
        history?: HandHistoryRowView[];
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message);
      }

      setHistoryRows(payload.history ?? []);
    } catch (error) {
      setNotice(errorMessage(error, "历史列表加载失败。"));
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function applyHistoryFilters(nextFilters: HandHistoryFilters) {
    setHistoryFilters(nextFilters);
    await loadHistory(nextFilters);
  }

  async function loadReplay(handId: string) {
    setIsLoadingReplay(true);
    try {
      const params = new URLSearchParams({ userId: DEMO_USER_ID });
      const response = await fetch(`/api/training/history/${handId}?${params}`);
      const payload = (await response.json()) as
        | HandReplayView
        | { message?: string };

      if (!response.ok) {
        throw new Error("message" in payload ? payload.message : undefined);
      }

      setSelectedReplay(payload as HandReplayView);
    } catch (error) {
      setNotice(errorMessage(error, "单手回放加载失败。"));
    } finally {
      setIsLoadingReplay(false);
    }
  }

  return (
    <section className="trainingEntry" aria-labelledby="training-entry-title">
      <div className="workspaceHeader">
        <div>
          <p className="eyebrow">M7 牌桌信息密度</p>
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
            reviewState={reviewState}
            isStartingNextHand={isStartingNextHand}
            isQuittingTraining={isQuittingTraining}
            continueEnabled={continueEnabled}
            onRequestReview={requestHandReview}
            onStartNextHand={startNextHand}
            onToggleContinue={toggleContinue}
            onQuitTraining={quitTraining}
          />
          <HistoryPanel
            rows={historyRows}
            filters={historyFilters}
            replay={selectedReplay}
            isLoadingHistory={isLoadingHistory}
            isLoadingReplay={isLoadingReplay}
            onFiltersChange={applyHistoryFilters}
            onRefresh={() => loadHistory()}
            onSelectReplay={loadReplay}
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
  const playerCount = snapshot?.config.playerCount ?? seats.length;
  const heroSeatIndex =
    snapshot?.config.heroSeatIndex ??
    seats.find((seat) => seat.isHero)?.seatIndex ??
    0;

  return (
    <section className="tableStage" aria-label="实时训练牌桌">
      <div className={`pokerTable seatCount-${playerCount}`}>
        <div className="tableSeatLayer" aria-label="座位状态">
          {seats.map((seat) => (
            <SeatToken
              key={seat.seatIndex}
              seat={seat}
              currentActorSeat={snapshot?.hand.currentActorSeat ?? null}
              style={seatPositionStyle(
                seat.seatIndex,
                heroSeatIndex,
                playerCount
              )}
            />
          ))}
        </div>
        <div className="tableCenter">
          <div className="streetPill">
            {snapshot ? STREET_LABELS[snapshot.hand.street] : "等待开桌"}
          </div>
          <CardRow cards={snapshot?.hand.board ?? []} emptyCount={5} />
          <div className="potGrid">
            <div>
              <span>总底池</span>
              <strong>
                {snapshot ? formatChips(snapshot.hand.potTotal) : "-"}
              </strong>
            </div>
            <div>
              <span>可赢底池</span>
              <strong>{snapshot ? eligiblePotCopy(snapshot) : "-"}</strong>
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
          {snapshot ? <DisplayPots snapshot={snapshot} /> : null}
        </div>
      </div>
      <HeroZone snapshot={snapshot} />
      <ActionLine snapshot={snapshot} />
    </section>
  );
}

function DisplayPots({ snapshot }: { snapshot: TrainingTableSnapshot }) {
  const visiblePots =
    snapshot.hand.displayPots.length > 0
      ? snapshot.hand.displayPots
      : [
          {
            label: "主池",
            amount: snapshot.hand.potTotal,
            eligibleSeatIndexes: [],
            winnerSeatIndexes: [],
            share: null,
            oddChips: 0
          }
        ];

  return (
    <div className="displayPots" aria-label="底池明细">
      {visiblePots.slice(0, 3).map((pot) => (
        <div key={`${pot.label}-${pot.amount}`}>
          <span>{pot.label}</span>
          <strong>{formatChips(pot.amount)}</strong>
          <small>{potDisplayDetail(pot)}</small>
        </div>
      ))}
    </div>
  );
}

function ActionLine({ snapshot }: { snapshot: TrainingTableSnapshot | null }) {
  const summaries = snapshot?.hand.streetActionSummary ?? [];

  return (
    <section className="actionLine" aria-label="按街道行动线">
      <div className="actionLineHeader">
        <div>
          <span className="sectionLabel">动作线</span>
          <strong>{lastActionCopy(snapshot?.hand.lastAction ?? null)}</strong>
        </div>
        <span className="streetPill">
          {snapshot ? `${summaries.length} 街有记录` : "等待行动"}
        </span>
      </div>
      <div className="streetActionGrid">
        {summaries.length > 0 ? (
          summaries.map((summary) => (
            <div key={summary.street}>
              <span>{STREET_LABELS[summary.street]}</span>
              <strong>{streetActionCopy(summary.actions)}</strong>
            </div>
          ))
        ) : (
          <div>
            <span>翻前</span>
            <strong>创建牌桌后显示公开行动</strong>
          </div>
        )}
      </div>
      {summaries.some((summary) => summary.actions.length > 0) ? (
        <details className="fullActionLog">
          <summary>展开完整公开动作</summary>
          <ol>
            {summaries.flatMap((summary) =>
              summary.actions.map((action) => (
                <li key={action.sequence}>{publicActionCopy(action)}</li>
              ))
            )}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

function SeatToken({
  seat,
  currentActorSeat,
  style
}: {
  seat: PublicSeatState;
  currentActorSeat: number | null;
  style?: SeatPositionStyle;
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
      style={style}
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
      <div className="seatAction">
        {seat.lastAction ? publicActionBrief(seat.lastAction) : "暂无行动"}
      </div>
      <div className="seatMarkers">
        {markers.map((marker) => (
          <span key={marker}>{marker}</span>
        ))}
        {seat.streetCommitment > 0 ? (
          <span>本街 {formatChips(seat.streetCommitment)}</span>
        ) : null}
        {seat.totalCommitment > 0 ? (
          <span>总投 {formatChips(seat.totalCommitment)}</span>
        ) : null}
      </div>
    </div>
  );
}

type SeatPositionStyle = CSSProperties & {
  "--seat-x": string;
  "--seat-y": string;
};

function seatPositionStyle(
  seatIndex: number,
  heroSeatIndex: number,
  playerCount: number
): SeatPositionStyle {
  const normalizedPlayerCount = Math.max(playerCount, 1);
  const relativeSeat =
    (seatIndex - heroSeatIndex + normalizedPlayerCount) % normalizedPlayerCount;
  const angle =
    Math.PI / 2 + (relativeSeat * Math.PI * 2) / normalizedPlayerCount;
  const x = 50 + Math.cos(angle) * 44;
  const y = 50 + Math.sin(angle) * 42;

  return {
    "--seat-x": `${x.toFixed(2)}%`,
    "--seat-y": `${y.toFixed(2)}%`
  };
}

function HeroZone({ snapshot }: { snapshot: TrainingTableSnapshot | null }) {
  const hero = snapshot?.hand.seats.find((seat) => seat.isHero);
  const pressureItems = snapshot
    ? [
        ["待跟注", formatChips(snapshot.hand.toCall)],
        ["底池赔率", potOddsCopy(snapshot.hand.toCall, snapshot.hand.potTotal)],
        ["最小加注到", nullableChips(snapshot.hand.minRaiseTo)],
        ["有效筹码", formatChips(snapshot.hand.effectiveStack)]
      ]
    : [];

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
      {pressureItems.length > 0 ? (
        <div className="heroPressureGrid" aria-label="Hero 行动压力">
          {pressureItems.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      ) : null}
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
      <ActionPressure snapshot={snapshot} />
      {betLikeAction ? (
        <BetSizingControls
          action={betLikeAction}
          potTotal={snapshot?.hand.potTotal ?? 0}
          bigBlind={snapshot?.config.bigBlind ?? 1}
          street={snapshot?.hand.street ?? "preflop"}
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

function ActionPressure({
  snapshot
}: {
  snapshot: TrainingTableSnapshot | null;
}) {
  const rows = snapshot
    ? [
        ["待跟注", formatChips(snapshot.hand.toCall)],
        ["底池赔率", potOddsCopy(snapshot.hand.toCall, snapshot.hand.potTotal)],
        ["最小加注到", nullableChips(snapshot.hand.minRaiseTo)],
        ["最大可下注", nullableChips(snapshot.hand.maxBetAmount)],
        ["有效筹码", formatChips(snapshot.hand.effectiveStack)]
      ]
    : [
        ["待跟注", "-"],
        ["底池赔率", "-"],
        ["最小加注到", "-"],
        ["最大可下注", "-"],
        ["有效筹码", "-"]
      ];

  return (
    <div className="actionPressure" aria-label="行动压力摘要">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function BetSizingControls({
  action,
  potTotal,
  bigBlind,
  street,
  selectedAmount,
  onAmountChange
}: {
  action: LegalAction;
  potTotal: number;
  bigBlind: number;
  street: TrainingTableSnapshot["hand"]["street"];
  selectedAmount: number;
  onAmountChange: (amount: number) => void;
}) {
  const min = action.minAmount ?? action.amount ?? 0;
  const max = action.maxAmount ?? action.amount ?? min;
  const potQuickSizes = [
    ["1/3 池", Math.round(potTotal / 3)],
    ["1/2 池", Math.round(potTotal / 2)],
    ["2/3 池", Math.round((potTotal * 2) / 3)],
    ["池", potTotal],
    ["全下", max]
  ] as const;
  const preflopQuickSizes = [
    ["2.2BB", Math.round(bigBlind * 2.2)],
    ["2.5BB", Math.round(bigBlind * 2.5)],
    ["3BB", bigBlind * 3]
  ] as const;
  const quickSizes =
    street === "preflop"
      ? [...preflopQuickSizes, ...potQuickSizes.slice(-1)]
      : potQuickSizes;

  return (
    <div className="sizingControls">
      <div className="sizingMeta">
        <span>最小 {formatChips(min)}</span>
        <span>最大 {formatChips(max)}</span>
      </div>
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
  reviewState,
  isStartingNextHand,
  isQuittingTraining,
  continueEnabled,
  onRequestReview,
  onStartNextHand,
  onToggleContinue,
  onQuitTraining
}: {
  snapshot: TrainingTableSnapshot | null;
  events: RuntimePublicEvent[];
  reviewState: ReviewPanelState;
  isStartingNextHand: boolean;
  isQuittingTraining: boolean;
  continueEnabled: boolean;
  onRequestReview: () => void;
  onStartNextHand: () => void;
  onToggleContinue: () => void;
  onQuitTraining: () => void;
}) {
  const awards = snapshot?.hand.awards ?? [];
  const recentEvents = events.slice(-8).reverse();
  const isTrainingEnded = snapshot?.status === "training_ended";
  const isCompletedHand = snapshot?.hand.street === "complete";

  return (
    <section className="handSummary" aria-label="手牌结束摘要和复盘入口">
      <div className="panelHeader">
        <div>
          <span className="sectionLabel">手牌摘要</span>
          <h2>{snapshot?.hand.handId ?? "等待第一手"}</h2>
        </div>
      </div>
      {snapshot ? (
        <div className="trainingControls" aria-label="训练控制">
          <button
            type="button"
            className="primaryButton fullWidthButton"
            aria-pressed={continueEnabled}
            disabled={isTrainingEnded || isStartingNextHand}
            onClick={onToggleContinue}
          >
            {continueButtonCopy(snapshot, continueEnabled, isStartingNextHand)}
          </button>
          <button
            type="button"
            className="dangerButton fullWidthButton"
            disabled={isTrainingEnded || isQuittingTraining}
            onClick={onQuitTraining}
          >
            {isQuittingTraining ? "退出中" : "退出训练"}
          </button>
        </div>
      ) : null}
      {isTrainingEnded ? (
        <p className="coachMessage">{trainingEndedCopy(snapshot)}</p>
      ) : null}
      {isCompletedHand ? (
        <>
          <p className="coachMessage">
            {snapshot?.status === "hand_complete"
              ? continueEnabled
                ? "本手牌已结束，系统会自动准备下一手。"
                : "本手牌已结束，可停留查看结算，或按继续进入下一手。"
              : "本手牌已结束，可查看最终结算。"}
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
            disabled={reviewState.status === "requesting"}
            onClick={onRequestReview}
          >
            {reviewState.status === "requesting" ? "复盘中" : "请求整手复盘"}
          </button>
          <ReviewResult reviewState={reviewState} />
          <button
            type="button"
            className="secondaryButton fullWidthButton"
            disabled={isStartingNextHand || isTrainingEnded}
            onClick={onStartNextHand}
          >
            {isStartingNextHand ? "准备中" : "开始下一手"}
          </button>
        </>
      ) : (
        <p className="coachMessage">
          {snapshot
            ? "手牌结束后这里会显示结算摘要和基础复盘入口。"
            : "创建训练桌后这里会显示训练控制和手牌摘要。"}
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

function ReviewResult({ reviewState }: { reviewState: ReviewPanelState }) {
  if (reviewState.status === "idle") {
    return <p className="coachMessage">{reviewState.message}</p>;
  }

  if (reviewState.status === "requesting") {
    return <p className="coachMessage">{reviewState.message}</p>;
  }

  if (reviewState.status === "failed_not_charged") {
    return (
      <p className="errorDetail">
        {reviewState.message} {reviewState.errorType}:{" "}
        {reviewState.errorMessage}
      </p>
    );
  }

  return (
    <div className="reviewResult">
      <div className="chargePill">已扣 {reviewState.chargedAmount} 点</div>
      <p>{reviewState.review.summary}</p>
      <p>{reviewState.review.result}</p>
      <ul>
        {reviewState.review.streetInsights.map((insight) => (
          <li key={insight.street}>
            {STREET_LABELS[insight.street]} · {insight.summary}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HistoryPanel({
  rows,
  filters,
  replay,
  isLoadingHistory,
  isLoadingReplay,
  onFiltersChange,
  onRefresh,
  onSelectReplay
}: {
  rows: HandHistoryRowView[];
  filters: HandHistoryFilters;
  replay: HandReplayView | null;
  isLoadingHistory: boolean;
  isLoadingReplay: boolean;
  onFiltersChange: (filters: HandHistoryFilters) => void;
  onRefresh: () => void;
  onSelectReplay: (handId: string) => void;
}) {
  return (
    <section className="historyPanel" aria-label="历史手牌和单手回放">
      <div className="panelHeader">
        <div>
          <span className="sectionLabel">历史与回放</span>
          <h2>已完成手牌</h2>
        </div>
        <button
          type="button"
          className="secondaryButton compactButton"
          disabled={isLoadingHistory}
          onClick={onRefresh}
        >
          刷新
        </button>
      </div>
      <HistoryFilters filters={filters} onChange={onFiltersChange} />
      {rows.length === 0 ? (
        <div className="emptyHistory">
          <p>暂无可回放手牌。</p>
          <a
            className="primaryButton historyStartLink"
            href="#training-entry-title"
          >
            进入训练牌桌
          </a>
        </div>
      ) : (
        <div className="historyList">
          {rows.map((row) => (
            <button
              key={row.handId}
              type="button"
              className="historyRow"
              disabled={isLoadingReplay}
              onClick={() => onSelectReplay(row.handId)}
            >
              <span>{formatDateTime(row.completedAt ?? row.startedAt)}</span>
              <strong>
                {row.playerCount} 人 · {positionLabel(row.heroPosition)}
              </strong>
              <span>
                {resultLabel(row.result)} ·{" "}
                {row.labelKeys.join(", ") || "无标签"}
              </span>
              <span>
                {row.hasHeroCoach ? "即时建议" : "无即时建议"} /{" "}
                {row.hasHandReview ? "已复盘" : "未复盘"}
              </span>
            </button>
          ))}
        </div>
      )}
      <ReplayView replay={replay} isLoading={isLoadingReplay} />
    </section>
  );
}

function HistoryFilters({
  filters,
  onChange
}: {
  filters: HandHistoryFilters;
  onChange: (filters: HandHistoryFilters) => void;
}) {
  function update(key: keyof HandHistoryFilters, value: string) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="historyFilters">
      <select
        aria-label="人数筛选"
        value={filters.playerCount}
        onChange={(event) => update("playerCount", event.target.value)}
      >
        <option value="">人数</option>
        <option value="4">4 人</option>
        <option value="6">6 人</option>
        <option value="9">9 人</option>
        <option value="12">12 人</option>
      </select>
      <select
        aria-label="位置筛选"
        value={filters.position}
        onChange={(event) => update("position", event.target.value)}
      >
        <option value="">位置</option>
        <option value="button">BTN</option>
        <option value="small_blind">SB</option>
        <option value="big_blind">BB</option>
        <option value="other">其他</option>
      </select>
      <select
        aria-label="街道筛选"
        value={filters.street}
        onChange={(event) => update("street", event.target.value)}
      >
        <option value="">街道</option>
        <option value="preflop">翻前</option>
        <option value="flop">翻牌</option>
        <option value="turn">转牌</option>
        <option value="river">河牌</option>
      </select>
      <select
        aria-label="结果筛选"
        value={filters.result}
        onChange={(event) => update("result", event.target.value)}
      >
        <option value="">结果</option>
        <option value="win">盈利</option>
        <option value="loss">亏损</option>
        <option value="even">持平</option>
        <option value="fold">弃牌结束</option>
        <option value="showdown">摊牌</option>
      </select>
      <input
        aria-label="标签筛选"
        placeholder="标签"
        value={filters.tag}
        onChange={(event) => update("tag", event.target.value)}
      />
      <input
        aria-label="问题类型筛选"
        placeholder="问题类型"
        value={filters.problemType}
        onChange={(event) => update("problemType", event.target.value)}
      />
      <select
        aria-label="对手风格筛选"
        value={filters.opponentStyle}
        onChange={(event) => update("opponentStyle", event.target.value)}
      >
        <option value="">对手风格</option>
        <option value="tight">紧</option>
        <option value="balanced">均衡</option>
        <option value="loose">松</option>
        <option value="aggressive">压迫</option>
      </select>
    </div>
  );
}

function ReplayView({
  replay,
  isLoading
}: {
  replay: HandReplayView | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <p className="coachMessage">回放加载中。</p>;
  }

  if (!replay) {
    return <p className="coachMessage">选择一手历史记录后显示事件流。</p>;
  }

  const handReview = replay.handReviewArtifacts
    .map((artifact) => parseHandReviewPayload(artifact.responsePayload))
    .find(Boolean);

  return (
    <div className="replayView">
      <h3>{replay.handId}</h3>
      {handReview ? (
        <div className="reviewResult">
          <strong>复盘</strong>
          <p>{handReview.summary}</p>
        </div>
      ) : null}
      <ol>
        {replay.timeline.map((event) => (
          <li key={event.id}>
            <span>
              #{event.sequence} {event.street ? streetLabel(event.street) : ""}{" "}
              {event.eventType}
            </span>
            {event.aiArtifacts.length > 0 ? (
              <small>
                AI:{" "}
                {event.aiArtifacts
                  .map(
                    (artifact) => `${artifact.artifactKind}/${artifact.status}`
                  )
                  .join(", ")}
              </small>
            ) : null}
            {event.labels.length > 0 ? (
              <small>
                标签: {event.labels.map((label) => label.key).join(", ")}
              </small>
            ) : null}
            {event.handReviewInsights.length > 0 ? (
              <small>
                复盘:{" "}
                {event.handReviewInsights
                  .map((insight) => insight.summary)
                  .join(" / ")}
              </small>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
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

function parseHandReview(value: unknown): HandReview {
  if (!value || typeof value !== "object") {
    return {
      summary: "复盘结果已保存。",
      result: "暂无结构化结果。",
      streetInsights: [],
      tags: []
    };
  }

  const candidate = value as HandReview;
  if (
    typeof candidate.summary !== "string" ||
    typeof candidate.result !== "string" ||
    !Array.isArray(candidate.streetInsights) ||
    !Array.isArray(candidate.tags)
  ) {
    return {
      summary: "复盘结果已保存。",
      result: "暂无结构化结果。",
      streetInsights: [],
      tags: []
    };
  }

  return candidate;
}

function parseHandReviewPayload(value: unknown): HandReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const review = (value as { review?: unknown }).review;
  return review ? parseHandReview(review) : null;
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

  if (snapshot.status === "training_ended") {
    return "训练已结束";
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
  if (snapshot.status === "training_ended") {
    return trainingEndedCopy(snapshot);
  }

  if (snapshot.status === "waiting_for_user") {
    return "轮到你行动";
  }

  if (snapshot.status === "hand_complete") {
    return "手牌结束";
  }

  return "AI 对手行动中";
}

function continueButtonCopy(
  snapshot: TrainingTableSnapshot,
  continueEnabled: boolean,
  isStartingNextHand: boolean
): string {
  if (isStartingNextHand) {
    return "准备下一手";
  }

  if (snapshot.status === "hand_complete") {
    return continueEnabled ? "自动继续中" : "继续下一手";
  }

  return continueEnabled ? "自动继续：开" : "自动继续：关";
}

function trainingEndedCopy(snapshot: TrainingTableSnapshot): string {
  if (snapshot.endReason === "hero_eliminated") {
    return "Hero 筹码归零，训练结束";
  }

  if (snapshot.endReason === "user_quit") {
    return "玩家已主动退出训练";
  }

  return "训练已结束";
}

function streetLabel(street: string): string {
  if (street in STREET_LABELS) {
    return STREET_LABELS[street as keyof typeof STREET_LABELS];
  }

  return street;
}

function positionLabel(position: string | null): string {
  const labels: Record<string, string> = {
    button: "BTN",
    small_blind: "SB",
    big_blind: "BB",
    other: "其他"
  };

  return position ? (labels[position] ?? position) : "未知位置";
}

function resultLabel(result: string | null): string {
  const labels: Record<string, string> = {
    win: "盈利",
    loss: "亏损",
    even: "持平",
    fold: "弃牌结束",
    showdown: "摊牌"
  };

  return result ? (labels[result] ?? result) : "未知结果";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
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

function eligiblePotCopy(snapshot: TrainingTableSnapshot): string {
  const heroSeat = snapshot.hand.seats.find((seat) => seat.isHero);
  if (!heroSeat) {
    return "-";
  }

  const eligibleTotal = snapshot.hand.displayPots
    .filter(
      (pot) =>
        pot.eligibleSeatIndexes.length === 0 ||
        pot.eligibleSeatIndexes.includes(heroSeat.seatIndex)
    )
    .reduce((sum, pot) => sum + pot.amount, 0);

  return formatChips(eligibleTotal || snapshot.hand.potTotal);
}

function potDisplayDetail(
  pot: TrainingTableSnapshot["hand"]["displayPots"][number]
): string {
  if (pot.winnerSeatIndexes.length > 0) {
    return `归属 座位 ${pot.winnerSeatIndexes
      .map((seatIndex) => seatIndex + 1)
      .join(", ")}${pot.oddChips > 0 ? ` · odd ${pot.oddChips}` : ""}`;
  }

  if (pot.eligibleSeatIndexes.length > 0) {
    return `可赢 座位 ${pot.eligibleSeatIndexes
      .map((seatIndex) => seatIndex + 1)
      .join(", ")}`;
  }

  return "等待投入";
}

function streetActionCopy(actions: PublicActionSummary[]): string {
  if (actions.length === 0) {
    return "无公开行动";
  }

  return actions.slice(-4).map(publicActionBrief).join(" / ");
}

function publicActionCopy(action: PublicActionSummary): string {
  return `${STREET_LABELS[action.street]} #${action.sequence} · 座位 ${
    action.seatIndex + 1
  } ${ACTION_LABELS[action.action]} ${formatChips(action.amount)}${
    action.totalBetTo > 0 ? ` · 到 ${formatChips(action.totalBetTo)}` : ""
  }`;
}

function publicActionBrief(action: PublicActionSummary): string {
  return `S${action.seatIndex + 1} ${ACTION_LABELS[action.action]}${
    action.amount > 0 ? ` ${formatChips(action.amount)}` : ""
  }`;
}

function lastActionCopy(action: PublicActionSummary | null): string {
  if (!action) {
    return "暂无公开行动";
  }

  return `最近：${publicActionBrief(action)}`;
}

function potOddsCopy(toCall: number, potTotal: number): string {
  if (toCall <= 0) {
    return "0%";
  }

  const denominator = potTotal + toCall;
  if (denominator <= 0) {
    return "-";
  }

  return `${Math.round((toCall / denominator) * 100)}%`;
}

function nullableChips(value: number | null): string {
  return value === null ? "-" : formatChips(value);
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
    training_ended: "训练结束",
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
