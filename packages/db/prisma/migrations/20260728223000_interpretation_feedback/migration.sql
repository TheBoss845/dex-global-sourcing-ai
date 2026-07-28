-- User corrections that teach the product-interpretation AI
CREATE TABLE "interpretation_feedback" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "interpreted_name" TEXT,
    "interpreted_mpn" TEXT,
    "correction" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interpretation_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "interpretation_feedback_created_at_idx" ON "interpretation_feedback"("created_at");
