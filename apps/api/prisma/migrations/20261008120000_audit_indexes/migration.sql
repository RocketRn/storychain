-- DropIndex
DROP INDEX "Chain_isFeatured_createdAt_idx";

-- CreateIndex
CREATE INDEX "Chain_isFeatured_isHidden_createdAt_id_idx" ON "Chain"("isFeatured", "isHidden", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Chain_isHidden_postsCount_createdAt_id_idx" ON "Chain"("isHidden", "postsCount", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Chain_isHidden_createdAt_id_idx" ON "Chain"("isHidden", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Chain_creatorId_isHidden_createdAt_id_idx" ON "Chain"("creatorId", "isHidden", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Chain_isHidden_boostedUntil_id_idx" ON "Chain"("isHidden", "boostedUntil", "id");

-- CreateIndex
CREATE INDEX "Post_userId_createdAt_id_idx" ON "Post"("userId", "createdAt", "id");

