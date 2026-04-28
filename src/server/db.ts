import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  prismaClient?: PrismaClient;
};

export function getPrisma(): PrismaClient {
  const prisma =
    globalForPrisma.prismaClient ??
    createPrismaClient(process.env.DATABASE_URL);

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prismaClient = prisma;
  }

  return prisma;
}

function createPrismaClient(databaseUrl: string | undefined): PrismaClient {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set before creating PrismaClient.");
  }

  return new PrismaClient({
    adapter: new PrismaPg(databaseUrl)
  });
}
