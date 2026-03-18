-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "ClipDispute" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "discordChannelId" TEXT,
    "discordMessageId" TEXT,
    "staffNotes" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "discordChannelId" TEXT,
    "discordMessageId" TEXT,
    "assignedTo" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "transcript" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionCache" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "linkUrl" TEXT,
    "editorId" TEXT,
    "status" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClipDispute_submissionId_idx" ON "ClipDispute"("submissionId");

-- CreateIndex
CREATE INDEX "ClipDispute_userId_status_idx" ON "ClipDispute"("userId", "status");

-- CreateIndex
CREATE INDEX "ClipDispute_status_createdAt_idx" ON "ClipDispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_status_idx" ON "SupportTicket"("userId", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_status_priority_idx" ON "SupportTicket"("status", "priority");

-- CreateIndex
CREATE INDEX "SupportTicket_assignedTo_status_idx" ON "SupportTicket"("assignedTo", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

-- CreateIndex
CREATE INDEX "SubmissionCache_campaignId_idx" ON "SubmissionCache"("campaignId");

-- CreateIndex
CREATE INDEX "SubmissionCache_syncedAt_idx" ON "SubmissionCache"("syncedAt");
