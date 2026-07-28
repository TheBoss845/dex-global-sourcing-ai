import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
loadDotenv({ path: path.join(rootDir, '.env') });

const nextConfig: NextConfig = {
  serverExternalPackages: ['@prisma/client', 'bullmq'],
};

export default nextConfig;
