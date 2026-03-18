-- prisma:disable-transactions
-- Performance indexes for dispute-service
-- Migration: 20260316000001_indexes

-- SubmissionCache: look up cached submission records by editor
-- (used when dispute-service needs to verify editor ownership of a submission)
CREATE INDEX "SubmissionCache_editorId_idx" ON "SubmissionCache"("editorId");

-- SubmissionCache: filter cached submissions by status
-- (used to find approved/pending submissions when validating dispute eligibility)
CREATE INDEX "SubmissionCache_status_idx" ON "SubmissionCache"("status");
