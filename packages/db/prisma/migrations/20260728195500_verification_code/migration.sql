-- Add 6-digit code support to email verification tokens
ALTER TABLE "email_verification_tokens" ADD COLUMN "code_hash" TEXT;
ALTER TABLE "email_verification_tokens" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
