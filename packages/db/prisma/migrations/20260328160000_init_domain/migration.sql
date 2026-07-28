-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SearchInputType" AS ENUM ('MPN', 'URL');

-- CreateEnum
CREATE TYPE "SearchJobStatus" AS ENUM ('queued', 'resolving', 'discovering', 'extracting', 'normalizing', 'enriching', 'completed', 'completed_with_errors', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('pending', 'extracting', 'extracted', 'rejected', 'failed');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('api', 'search', 'scrape', 'cache', 'knowledge');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" TEXT NOT NULL,
    "raw_mpn" TEXT NOT NULL,
    "normalized_mpn" TEXT NOT NULL,
    "manufacturer" TEXT,
    "description_raw" TEXT,
    "description_clean" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_jobs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "input_type" "SearchInputType" NOT NULL,
    "input_value" TEXT NOT NULL,
    "force_refresh" BOOLEAN NOT NULL DEFAULT false,
    "status" "SearchJobStatus" NOT NULL DEFAULT 'queued',
    "trace_id" TEXT NOT NULL,
    "part_id" TEXT,
    "budget_json" JSONB NOT NULL,
    "progress_json" JSONB,
    "summary_json" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "offer_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_events" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "stage" TEXT,
    "message" TEXT NOT NULL,
    "data_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_candidates" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "snippet" TEXT,
    "source_type" "SourceType" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "CandidateStatus" NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "website" TEXT,
    "country" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_suppliers" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,

    CONSTRAINT "job_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "mpn" TEXT NOT NULL,
    "manufacturer" TEXT,
    "product_url" TEXT NOT NULL,
    "price" DECIMAL(18,6),
    "currency" TEXT,
    "price_usd" DECIMAL(18,6),
    "stock_quantity" INTEGER,
    "lead_time" TEXT,
    "moq" INTEGER,
    "source_type" "SourceType" NOT NULL,
    "match_confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "possible_match" BOOLEAN NOT NULL DEFAULT false,
    "risk_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "artifact_hash" TEXT,
    "artifact_key" TEXT,
    "extracted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_search_caches" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "normalized_mpn" TEXT NOT NULL,
    "manufacturer" TEXT,
    "payload_json" JSONB NOT NULL,
    "source_job_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "part_search_caches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_profiles" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "supplier_id" TEXT NOT NULL,
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    "countries_served" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reliability_score" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "health_status" TEXT NOT NULL DEFAULT 'unknown',
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "search_frequency" INTEGER NOT NULL DEFAULT 0,
    "avg_response_quality" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "last_success_at" TIMESTAMP(3),
    "last_failure_at" TIMESTAMP(3),
    "scoring_version" TEXT NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_manufacturers" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "hit_count" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_mpn_stats" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "normalized_mpn" TEXT NOT NULL,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "last_success_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_mpn_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_price_observations" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "normalized_mpn" TEXT NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "price_usd" DECIMAL(18,6),
    "job_id" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_price_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_events" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "data_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parts_normalized_mpn_idx" ON "parts"("normalized_mpn");

-- CreateIndex
CREATE INDEX "search_jobs_org_id_created_at_idx" ON "search_jobs"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "search_jobs_status_created_at_idx" ON "search_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "job_events_job_id_created_at_idx" ON "job_events"("job_id", "created_at");

-- CreateIndex
CREATE INDEX "job_candidates_job_id_status_idx" ON "job_candidates"("job_id", "status");

-- CreateIndex
CREATE INDEX "job_candidates_domain_idx" ON "job_candidates"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "job_candidates_job_id_url_key" ON "job_candidates"("job_id", "url");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_domain_key" ON "suppliers"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "job_suppliers_job_id_supplier_id_key" ON "job_suppliers"("job_id", "supplier_id");

-- CreateIndex
CREATE INDEX "offers_job_id_price_usd_idx" ON "offers"("job_id", "price_usd");

-- CreateIndex
CREATE INDEX "offers_supplier_id_idx" ON "offers"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "offers_job_id_product_url_key" ON "offers"("job_id", "product_url");

-- CreateIndex
CREATE INDEX "part_search_caches_normalized_mpn_expires_at_idx" ON "part_search_caches"("normalized_mpn", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "part_search_caches_normalized_mpn_manufacturer_key" ON "part_search_caches"("normalized_mpn", "manufacturer");

-- CreateIndex
CREATE INDEX "exchange_rates_base_quote_as_of_idx" ON "exchange_rates"("base", "quote", "as_of");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_base_quote_as_of_source_key" ON "exchange_rates"("base", "quote", "as_of", "source");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_profiles_supplier_id_key" ON "supplier_profiles"("supplier_id");

-- CreateIndex
CREATE INDEX "supplier_profiles_org_id_reliability_score_idx" ON "supplier_profiles"("org_id", "reliability_score");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_manufacturers_profile_id_manufacturer_key" ON "supplier_manufacturers"("profile_id", "manufacturer");

-- CreateIndex
CREATE INDEX "supplier_mpn_stats_normalized_mpn_idx" ON "supplier_mpn_stats"("normalized_mpn");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_mpn_stats_profile_id_normalized_mpn_key" ON "supplier_mpn_stats"("profile_id", "normalized_mpn");

-- CreateIndex
CREATE INDEX "supplier_price_observations_profile_id_normalized_mpn_obser_idx" ON "supplier_price_observations"("profile_id", "normalized_mpn", "observed_at");

-- CreateIndex
CREATE INDEX "knowledge_events_job_id_idx" ON "knowledge_events"("job_id");

-- AddForeignKey
ALTER TABLE "search_jobs" ADD CONSTRAINT "search_jobs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_jobs" ADD CONSTRAINT "search_jobs_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "search_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_candidates" ADD CONSTRAINT "job_candidates_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "search_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_suppliers" ADD CONSTRAINT "job_suppliers_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "search_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_suppliers" ADD CONSTRAINT "job_suppliers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "search_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_search_caches" ADD CONSTRAINT "part_search_caches_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_manufacturers" ADD CONSTRAINT "supplier_manufacturers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "supplier_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_mpn_stats" ADD CONSTRAINT "supplier_mpn_stats_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "supplier_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_price_observations" ADD CONSTRAINT "supplier_price_observations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "supplier_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

