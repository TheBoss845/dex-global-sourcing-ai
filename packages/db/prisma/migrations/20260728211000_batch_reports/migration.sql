-- Batch reports: group multiple part searches into one report
ALTER TABLE "search_jobs" ADD COLUMN "batch_id" TEXT;
CREATE INDEX "search_jobs_batch_id_created_at_idx" ON "search_jobs"("batch_id", "created_at");
