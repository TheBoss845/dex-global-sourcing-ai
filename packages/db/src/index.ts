import { PrismaClient } from '@prisma/client';

// Netlify's one-click Neon database sets NETLIFY_DATABASE_URL; use it
// automatically when DATABASE_URL isn't set explicitly.
if (!process.env.DATABASE_URL?.trim() && process.env.NETLIFY_DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = process.env.NETLIFY_DATABASE_URL;
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient, Prisma } from '@prisma/client';
export type * from '@prisma/client';
