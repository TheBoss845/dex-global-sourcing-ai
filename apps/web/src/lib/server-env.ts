import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '@dex/core';

const rootDir = path.resolve(process.cwd(), '../..');
loadDotenv({ path: path.join(rootDir, '.env') });
// Also try repo-relative when cwd is workspace root during some scripts
loadDotenv({ path: path.resolve(process.cwd(), '.env') });

export function getServerEnv() {
  return loadEnv(process.env);
}
