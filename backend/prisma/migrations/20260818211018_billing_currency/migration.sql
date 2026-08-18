-- CreateEnum
CREATE TYPE "BillingCurrency" AS ENUM ('USD', 'GBP', 'EUR');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "billingCurrency" "BillingCurrency";
