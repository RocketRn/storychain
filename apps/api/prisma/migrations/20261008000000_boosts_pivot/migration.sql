-- DropIndex
DROP INDEX "DailyUsage_userId_day_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "DailyUsage";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Subscription";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "ChainBoost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chainId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "txId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChainBoost_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Chain" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "emoji" TEXT,
    "creatorId" TEXT NOT NULL,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "postsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channelUrl" TEXT,
    "isBoosted" BOOLEAN NOT NULL DEFAULT false,
    "boostedUntil" DATETIME,
    CONSTRAINT "Chain_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Chain" ("createdAt", "creatorId", "description", "emoji", "id", "isFeatured", "isHidden", "postsCount", "title") SELECT "createdAt", "creatorId", "description", "emoji", "id", "isFeatured", "isHidden", "postsCount", "title" FROM "Chain";
DROP TABLE "Chain";
ALTER TABLE "new_Chain" RENAME TO "Chain";
CREATE INDEX "Chain_isFeatured_createdAt_idx" ON "Chain"("isFeatured", "createdAt");
CREATE INDEX "Chain_isBoosted_boostedUntil_idx" ON "Chain"("isBoosted", "boostedUntil");
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "externalId" TEXT,
    "rawJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "chainId" TEXT,
    CONSTRAINT "Transaction_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("amount", "createdAt", "currency", "expiresAt", "externalId", "id", "paidAt", "planId", "provider", "rawJson", "reference", "status", "userId") SELECT "amount", "createdAt", "currency", "expiresAt", "externalId", "id", "paidAt", "planId", "provider", "rawJson", "reference", "status", "userId" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_reference_key" ON "Transaction"("reference");
CREATE UNIQUE INDEX "Transaction_externalId_key" ON "Transaction"("externalId");
CREATE INDEX "Transaction_status_provider_idx" ON "Transaction"("status", "provider");
CREATE INDEX "Transaction_chainId_idx" ON "Transaction"("chainId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT NOT NULL,
    "languageCode" TEXT,
    "isTgPremium" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "firstName", "id", "isTgPremium", "languageCode", "lastSeenAt", "telegramId", "username") SELECT "createdAt", "firstName", "id", "isTgPremium", "languageCode", "lastSeenAt", "telegramId", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ChainBoost_txId_key" ON "ChainBoost"("txId");

-- CreateIndex
CREATE INDEX "ChainBoost_chainId_endsAt_idx" ON "ChainBoost"("chainId", "endsAt");


-- Legacy PRO purchases are gone: orders that were still waiting for payment can no longer be fulfilled.
-- Paid legacy transactions are intentionally left untouched as history.
UPDATE "Transaction" SET "status" = 'expired' WHERE "status" = 'pending' AND "planId" = 'pro_30d';
