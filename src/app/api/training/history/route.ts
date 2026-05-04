import { NextResponse } from "next/server";

import { getPrisma } from "@/server/db";
import { PrismaTrainingAssetRepository } from "@/server/persistence/prisma-training-assets";
import { TrainingAssetService } from "@/server/persistence/training-assets";
import type {
  HandHistoryFilters,
  HandHistoryRow
} from "@/server/persistence/types";

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

function buildHistoryAnalytics(history: HandHistoryRow[]) {
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
    )
  };
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

function sumBy<T>(rows: T[], valueFor: (row: T) => number): number {
  return rows.reduce((sum, row) => sum + valueFor(row), 0);
}

function percent(value: number, total: number): number {
  return total <= 0 ? 0 : Math.round((value / total) * 100);
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
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
