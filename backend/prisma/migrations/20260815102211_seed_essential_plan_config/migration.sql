-- Seed ESSENTIAL's pricing, same as the original two plans' seed
-- migration (20260810125452_membership_plan_config) — the entry-level
-- tier's numbers match the asoju-app-main prototype's own intended
-- PLAN_META (src/convex/cases.ts): $49/mo, $30 SC grant, 5% discount.
-- eligibleRequestsPerMonth of 1 keeps it proportional to PRIORITY's 2
-- and PREMIUM's 5 — the prototype's PLAN_META didn't carry this field
-- (it predates the eligible-requests-per-month concept), so there's no
-- "original" number to match here, only a reasonable one to set.
INSERT INTO "MembershipPlanConfig" ("id", "plan", "priceUsd", "scGrantUsd", "discountPercent", "eligibleRequestsPerMonth", "updatedAt")
VALUES
    (gen_random_uuid(), 'ESSENTIAL', 49, 30, 5, 1, CURRENT_TIMESTAMP);
