import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
loadDotenv({ path: path.join(rootDir, '.env') });

const nextConfig: NextConfig = {
  serverExternalPackages: ['@prisma/client', 'bullmq'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  // Monorepo: trace server dependencies from the repo root so serverless
  // bundles (Netlify/Vercel) include workspace packages and Prisma engines.
  outputFileTracingRoot: rootDir,
  outputFileTracingIncludes: {
    '/api/**': [
      '../../node_modules/.pnpm/**/.prisma/client/libquery_engine-*.node',
      '../../node_modules/.pnpm/**/.prisma/client/schema.prisma',
    ],
  },
};

export default nextConfig;
