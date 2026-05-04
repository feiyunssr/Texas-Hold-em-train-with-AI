import { NextResponse } from "next/server";

import { getPrisma } from "@/server/db";
import { PrismaTrainingAssetRepository } from "@/server/persistence/prisma-training-assets";
import { TrainingAssetService } from "@/server/persistence/training-assets";
import type {
  HandHistoryFilters,
  HandHistoryRow
} from "@/server/persistence/types";

export type TrainingGoalAnalytics = {
  key: string;
  title: string;
  focus: string;
  hands: number;
  baselineNetBB: number;
  recentNetBB: number;
  trend: "improving" | "declining" | "flat" | "insufficient_data";
  progressPct: number;
};

export type TrainingScenarioRecommendation = {
  id: string;
  title: string;
  source: "history_weakness" | "preset";
  focus: string;
  rationale: string;
  playerCount: 4 | 6 | 9 | 12;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  tableMode: "standard" | "fast_fold";
  aiStylePreset: "balanced" | "mixed" | "pressure" | "patient";
  preflopStrategyPreset: "tight_open" | "button_steal" | "fit_or_fold";
  preflopStrategyMode: "off" | "suggest" | "auto";
  filters: {
    position?: string;
    problemType?: string;
    opponentStyle?: string;
    result?: string;
  };
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") ?? "demo-user";
    const limit = readLimit(url.searchParams.get("limit"));
    const filters: HandHistoryFilters = {
      playerCount: readOptionalInteger(url.searchParams.get("playerCount")),
      heroPosition: readOptionalString(url.searchParams.get("position")),
      street: readOptionalString(url.searchParams.get("street")),
      result: readOptionalString(url.searchParams.get("result")),
      label: readOptionalString(url.searchParams.get("tag")),
      problemType: readOptionalString(url.searchParams.get("problemType")),
      opponentStyle: readOptionalString(url.searchParams.get("opponentStyle"))
    };
    const service = new TrainingAssetService(
      new PrismaTrainingAssetRepository(getPrisma())
    );
    const history = await service.listHandHistory(userId, limit, filters);

    return NextResponse.json({
      history,
      analytics: buildHistoryAnalytics(history)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "history_error",
        message:
          error instanceof Error ? error.message : "Hand history load failed."
      },
      { status: 500 }
    );
  }
}

export function buildHistoryAnalytics(history: HandHistoryRow[]) {
  const chronological = [...history].sort(
    (left, right) =>
      new Date(left.completedAt ?? left.startedAt).getTime() -
      new Date(right.completedAt ?? right.startedAt).getTime()
  );
  let cumulativeChips = 0;
  let cumulativeBB = 0;

  return {
    totalHands: history.length,
    netChips: sumBy(history, (row) => row.heroProfit ?? 0),
    netBB: roundToTenth(sumBy(history, (row) => row.heroProfitBB ?? 0)),
    winningHands: history.filter((row) => (row.heroProfit ?? 0) > 0).length,
    losingHands: history.filter((row) => (row.heroProfit ?? 0) < 0).length,
    strategyExecutions: sumBy(history, (row) => row.strategyExecutionCount),
    profitCurve: chronological.map((row) => {
      cumulativeChips += row.heroProfit ?? 0;
      cumulativeBB = roundToTenth(cumulativeBB + (row.heroProfitBB ?? 0));
      return {
        handId: row.handId,
        completedAt: row.completedAt ?? row.startedAt,
        handProfit: row.heroProfit ?? 0,
        cumulativeChips,
        cumulativeBB
      };
    }),
    sessions: aggregateBy(history, (row) => row.sessionId).map(
      ([sessionId, rows]) => ({
        sessionId,
        startedAt: minDate(rows.map((row) => row.startedAt)),
        completedAt: maxDate(
          rows.map((row) => row.completedAt ?? row.startedAt)
        ),
        hands: rows.length,
        blindLevel: rows[0]?.blindLevel ?? "-",
        playerCount: rows[0]?.playerCount ?? 0,
        netChips: sumBy(rows, (row) => row.heroProfit ?? 0),
        netBB: roundToTenth(sumBy(rows, (row) => row.heroProfitBB ?? 0)),
        opponentStyles: unique(rows.flatMap((row) => row.opponentStyles))
      })
    ),
    positionResults: aggregateResults(
      history,
      (row) => row.heroPosition ?? "unknown"
    ),
    startingHandResults: aggregateResults(
      history.filter((row) => row.startingHand !== null),
      (row) => row.startingHand ?? "-"
    ).slice(0, 12),
    opponentStyleResults: aggregateResults(
      history.flatMap((row) =>
        row.opponentStyles.map((style) => ({ ...row, opponentStyle: style }))
      ),
      (row) => row.opponentStyle
    ),
    problemTags: aggregateResults(
      history.flatMap((row) =>
        row.labelKeys.map((label) => ({ ...row, label }))
      ),
      (row) => row.label
    ),
    trainingGoals: buildTrainingGoals(history, chronological),
    scenarioRecommendations: buildScenarioRecommendations(history)
  };
}

function buildTrainingGoals(
  history: HandHistoryRow[],
  chronological: HandHistoryRow[]
): TrainingGoalAnalytics[] {
  const taggedRows = history.flatMap((row) =>
    row.labelKeys.map((label) => ({ ...row, label }))
  );
  const tagBuckets = aggregateBy(taggedRows, (row) => row.label)
    .sort(
      ([, leftRows], [, rightRows]) =>
        Math.abs(sumBy(rightRows, (row) => row.heroProfitBB ?? 0)) -
        Math.abs(sumBy(leftRows, (row) => row.heroProfitBB ?? 0))
    )
    .slice(0, 4);

  const goals = tagBuckets.map(([label, rows]) =>
    buildTagTrainingGoal(label, rows, chronological)
  );

  if (goals.length > 0) {
    return goals;
  }

  const weakPosition = aggregateResults(
    history,
    (row) => row.heroPosition ?? "unknown"
  ).find((bucket) => bucket.netBB < 0);

  if (!weakPosition) {
    return [];
  }

  const positionRows = history.filter(
    (row) => (row.heroPosition ?? "unknown") === weakPosition.key
  );

  return [
    buildSyntheticTrainingGoal(
      `position:${weakPosition.key}`,
      `${positionLabelForGoal(weakPosition.key)} 位置修复`,
      "位置盈亏",
      positionRows,
      chronological
    )
  ];
}

function buildTagTrainingGoal(
  label: string,
  rows: Array<HandHistoryRow & { label: string }>,
  chronological: HandHistoryRow[]
): TrainingGoalAnalytics {
  return buildSyntheticTrainingGoal(
    `tag:${label}`,
    `${problemLabel(label)} 改善`,
    "问题标签",
    rows,
    chronological
  );
}

function buildSyntheticTrainingGoal(
  key: string,
  title: string,
  focus: string,
  rows: HandHistoryRow[],
  chronological: HandHistoryRow[]
): TrainingGoalAnalytics {
  const rowIds = new Set(rows.map((row) => row.handId));
  const ordered = chronological.filter((row) => rowIds.has(row.handId));
  const splitIndex = Math.max(1, Math.floor(ordered.length / 2));
  const baselineRows = ordered.slice(0, splitIndex);
  const recentRows = ordered.slice(splitIndex);
  const baselineNetBB = roundToTenth(
    sumBy(baselineRows, (row) => row.heroProfitBB ?? 0)
  );
  const recentNetBB = roundToTenth(
    sumBy(
      recentRows.length > 0 ? recentRows : baselineRows,
      (row) => row.heroProfitBB ?? 0
    )
  );
  const delta = roundToTenth(recentNetBB - baselineNetBB);

  return {
    key,
    title,
    focus,
    hands: rows.length,
    baselineNetBB,
    recentNetBB,
    trend:
      rows.length < 4
        ? "insufficient_data"
        : delta > 1
          ? "improving"
          : delta < -1
            ? "declining"
            : "flat",
    progressPct:
      baselineNetBB >= 0
        ? recentNetBB >= baselineNetBB
          ? 100
          : 60
        : clampPercent(
            Math.round(
              ((recentNetBB - baselineNetBB) / Math.abs(baselineNetBB)) * 100
            )
          )
  };
}

function buildScenarioRecommendations(
  history: HandHistoryRow[]
): TrainingScenarioRecommendation[] {
  const baseBlind = resolveMostRecentBlind(history);
  const weakTag = aggregateResults(
    history.flatMap((row) => row.labelKeys.map((label) => ({ ...row, label }))),
    (row) => row.label
  ).find((bucket) => bucket.netBB < 0);
  const weakPosition = aggregateResults(
    history,
    (row) => row.heroPosition ?? "unknown"
  ).find((bucket) => bucket.netBB < 0);
  const pressureOpponent = aggregateResults(
    history.flatMap((row) =>
      row.opponentStyles.map((style) => ({ ...row, opponentStyle: style }))
    ),
    (row) => row.opponentStyle
  ).find((bucket) => bucket.netBB < 0);
  const recommendations: TrainingScenarioRecommendation[] = [];

  if (weakTag) {
    recommendations.push({
      id: `weak-tag-${slug(weakTag.key)}`,
      title: `${problemLabel(weakTag.key)} 主题局`,
      source: "history_weakness",
      focus: weakTag.key,
      rationale: `${weakTag.hands} 手牌累计 ${bbCopy(weakTag.netBB)}，优先复练同类决策。`,
      playerCount: resolveMostCommonPlayerCount(history),
      ...baseBlind,
      tableMode:
        weakTag.key === "range_construction" ? "fast_fold" : "standard",
      aiStylePreset: weakTag.key === "bet_sizing" ? "pressure" : "mixed",
      preflopStrategyPreset:
        weakTag.key === "range_construction" ? "fit_or_fold" : "tight_open",
      preflopStrategyMode: "suggest",
      filters: { problemType: weakTag.key, result: "loss" }
    });
  }

  if (weakPosition && weakPosition.key !== "unknown") {
    recommendations.push({
      id: `weak-position-${slug(weakPosition.key)}`,
      title: `${positionLabelForGoal(weakPosition.key)} 位置专项`,
      source: "history_weakness",
      focus: weakPosition.key,
      rationale: `${positionLabelForGoal(weakPosition.key)} 当前累计 ${bbCopy(weakPosition.netBB)}，用更高频同位置主题校准范围。`,
      playerCount: resolveMostCommonPlayerCount(history),
      ...baseBlind,
      tableMode: weakPosition.key === "button" ? "fast_fold" : "standard",
      aiStylePreset: weakPosition.key === "big_blind" ? "pressure" : "mixed",
      preflopStrategyPreset:
        weakPosition.key === "button" ? "button_steal" : "fit_or_fold",
      preflopStrategyMode: "suggest",
      filters: { position: weakPosition.key, result: "loss" }
    });
  }

  if (pressureOpponent) {
    recommendations.push({
      id: `opponent-${slug(pressureOpponent.key)}`,
      title: `${styleLabelForScenario(pressureOpponent.key)} 对抗局`,
      source: "history_weakness",
      focus: pressureOpponent.key,
      rationale: `对该风格累计 ${bbCopy(pressureOpponent.netBB)}，创建同风格压力桌复练。`,
      playerCount: resolveMostCommonPlayerCount(history),
      ...baseBlind,
      tableMode: "standard",
      aiStylePreset:
        pressureOpponent.key === "loose-aggressive" ? "pressure" : "mixed",
      preflopStrategyPreset: "fit_or_fold",
      preflopStrategyMode: "suggest",
      filters: { opponentStyle: pressureOpponent.key, result: "loss" }
    });
  }

  recommendations.push({
    id: "preset-fast-fold-range",
    title: "Rush 翻前范围冲刺",
    source: "preset",
    focus: "range_construction",
    rationale: "高频过掉边缘牌，集中训练开池、跟注和 3bet 阈值。",
    playerCount: resolveMostCommonPlayerCount(history),
    ...baseBlind,
    tableMode: "fast_fold",
    aiStylePreset: "mixed",
    preflopStrategyPreset: "fit_or_fold",
    preflopStrategyMode: "suggest",
    filters: { problemType: "range_construction" }
  });

  return uniqueBy(recommendations, (scenario) => scenario.id).slice(0, 4);
}

function aggregateResults<T>(
  rows: T[],
  keyFor: (row: T) => string
): Array<{
  key: string;
  hands: number;
  netChips: number;
  netBB: number;
  winRate: number;
}> {
  return aggregateBy(rows, keyFor)
    .map(([key, values]) => {
      const handRows = values as Array<
        HandHistoryRow & Record<string, unknown>
      >;
      return {
        key,
        hands: values.length,
        netChips: sumBy(handRows, (row) => row.heroProfit ?? 0),
        netBB: roundToTenth(sumBy(handRows, (row) => row.heroProfitBB ?? 0)),
        winRate: percent(
          handRows.filter((row) => (row.heroProfit ?? 0) > 0).length,
          handRows.length
        )
      };
    })
    .sort((left, right) => Math.abs(right.netBB) - Math.abs(left.netBB));
}

function aggregateBy<T>(
  rows: T[],
  keyFor: (row: T) => string
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return Array.from(groups.entries());
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function uniqueBy<T>(values: T[], keyFor: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function sumBy<T>(rows: T[], valueFor: (row: T) => number): number {
  return rows.reduce((sum, row) => sum + valueFor(row), 0);
}

function percent(value: number, total: number): number {
  return total <= 0 ? 0 : Math.round((value / total) * 100);
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function bbCopy(netBB: number): string {
  return `${netBB >= 0 ? "+" : ""}${roundToTenth(netBB)}BB`;
}

function problemLabel(key: string): string {
  const labels: Record<string, string> = {
    range_construction: "翻前范围",
    bet_sizing: "下注尺度",
    pot_odds: "底池赔率",
    bluff_catcher: "抓诈牌",
    thin_value: "薄价值"
  };

  return labels[key] ?? key;
}

function positionLabelForGoal(position: string): string {
  const labels: Record<string, string> = {
    button: "BTN",
    small_blind: "SB",
    big_blind: "BB",
    other: "其他位置",
    unknown: "未知位置"
  };

  return labels[position] ?? position;
}

function styleLabelForScenario(style: string): string {
  const labels: Record<string, string> = {
    "tight-passive": "紧弱",
    "tight-aggressive": "紧凶",
    balanced: "均衡",
    "loose-passive": "松弱",
    "loose-aggressive": "松凶"
  };

  return labels[style] ?? style;
}

function resolveMostRecentBlind(history: HandHistoryRow[]): {
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
} {
  const latest = [...history].sort(
    (left, right) =>
      new Date(right.completedAt ?? right.startedAt).getTime() -
      new Date(left.completedAt ?? left.startedAt).getTime()
  )[0];

  return {
    smallBlind: latest?.smallBlind ?? 1,
    bigBlind: latest?.bigBlind ?? 2,
    startingStack: latest?.startingStack ?? 200
  };
}

function resolveMostCommonPlayerCount(
  history: HandHistoryRow[]
): 4 | 6 | 9 | 12 {
  const counts = aggregateBy(history, (row) => row.playerCount.toString()).sort(
    ([, leftRows], [, rightRows]) => rightRows.length - leftRows.length
  );
  const parsed = Number(counts[0]?.[0] ?? 6);

  return parsed === 4 || parsed === 6 || parsed === 9 || parsed === 12
    ? parsed
    : 6;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function minDate(values: Date[]): Date | null {
  if (values.length === 0) {
    return null;
  }

  return new Date(Math.min(...values.map((value) => value.getTime())));
}

function maxDate(values: Date[]): Date | null {
  if (values.length === 0) {
    return null;
  }

  return new Date(Math.max(...values.map((value) => value.getTime())));
}

function readLimit(value: string | null): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 100) {
    return 20;
  }

  return parsed;
}

function readOptionalInteger(value: string | null): number | undefined {
  if (value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function readOptionalString(value: string | null): string | undefined {
  return value === null || value.trim() === "" ? undefined : value;
}
