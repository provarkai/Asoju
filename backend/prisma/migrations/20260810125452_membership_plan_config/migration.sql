-- CreateTable
CREATE TABLE "MembershipPlanConfig" (
    "id" TEXT NOT NULL,
    "plan" "MembershipPlan" NOT NULL,
    "priceUsd" DECIMAL(12,2) NOT NULL,
    "scGrantUsd" DECIMAL(12,2) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL,
    "eligibleRequestsPerMonth" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "MembershipPlanConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPlanConfig_plan_key" ON "MembershipPlanConfig"("plan");

-- AddForeignKey
ALTER TABLE "MembershipPlanConfig" ADD CONSTRAINT "MembershipPlanConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the two default plans with the same values the old MEMBERSHIP_PLANS
-- code constant shipped with, so existing behaviour is unchanged until an
-- admin edits one via PATCH /admin/membership-plans/:plan.
INSERT INTO "MembershipPlanConfig" ("id", "plan", "priceUsd", "scGrantUsd", "discountPercent", "eligibleRequestsPerMonth", "updatedAt")
VALUES
    (gen_random_uuid(), 'PRIORITY', 99, 50, 10, 2, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'PREMIUM', 299, 150, 15, 5, CURRENT_TIMESTAMP);
