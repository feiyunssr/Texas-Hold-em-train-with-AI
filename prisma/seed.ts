import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";

const DEMO_USER_ID = "demo-user";
const DEMO_WALLET_ACCOUNT_ID = "demo-wallet-account";
const DEMO_INITIAL_CREDIT_REQUEST_ID = "demo-initial-credit-2026-04-28";

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];

  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set before running prisma seed.");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg(databaseUrl)
  });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.appUser.upsert({
        where: { id: DEMO_USER_ID },
        create: {
          id: DEMO_USER_ID,
          email: "demo@example.local",
          displayName: "Demo Player"
        },
        update: {
          email: "demo@example.local",
          displayName: "Demo Player"
        }
      });

      await tx.walletAccount.upsert({
        where: { id: DEMO_WALLET_ACCOUNT_ID },
        create: {
          id: DEMO_WALLET_ACCOUNT_ID,
          userId: DEMO_USER_ID,
          balance: 100
        },
        update: {
          balance: 100
        }
      });

      await tx.walletLedger.upsert({
        where: { requestId: DEMO_INITIAL_CREDIT_REQUEST_ID },
        create: {
          requestId: DEMO_INITIAL_CREDIT_REQUEST_ID,
          userId: DEMO_USER_ID,
          walletAccountId: DEMO_WALLET_ACCOUNT_ID,
          entryType: "CREDIT_GRANT",
          amountDelta: 100,
          balanceAfter: 100,
          description: "Initial demo wallet credits"
        },
        update: {
          amountDelta: 100,
          balanceAfter: 100,
          description: "Initial demo wallet credits"
        }
      });

      await tx.labelDefinition.upsert({
        where: {
          key_version: {
            key: "bet_sizing",
            version: 1
          }
        },
        create: {
          key: "bet_sizing",
          title: "Bet sizing issue",
          description: "Sizing choice likely missed value or risk control."
        },
        update: {
          title: "Bet sizing issue",
          description: "Sizing choice likely missed value or risk control.",
          isActive: true
        }
      });

      await tx.labelDefinition.upsert({
        where: {
          key_version: {
            key: "range_construction",
            version: 1
          }
        },
        create: {
          key: "range_construction",
          title: "Range construction issue",
          description: "Preflop or postflop range appears too wide or narrow."
        },
        update: {
          title: "Range construction issue",
          description: "Preflop or postflop range appears too wide or narrow.",
          isActive: true
        }
      });
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
