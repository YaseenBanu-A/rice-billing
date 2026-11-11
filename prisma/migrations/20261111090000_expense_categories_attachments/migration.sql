-- Expenses module: expense categories, an optional title, and a receipt attachment per expense.
-- Additive only: no existing table, column or row is dropped or deleted. Existing expenses keep every value;
-- they are only linked to the category row that has their category name.

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "categoryId" UUID,
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseAttachment" (
    "id" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseAttachment_expenseId_key" ON "ExpenseAttachment"("expenseId");

-- CreateIndex
CREATE INDEX "Expense_categoryId_idx" ON "Expense"("categoryId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAttachment" ADD CONSTRAINT "ExpenseAttachment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity rules
-- category names are unique ignoring case ("Rent" and "rent" are the same head)
CREATE UNIQUE INDEX "ExpenseCategory_name_lower_key" ON "ExpenseCategory" (lower(name));
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_name_not_blank" CHECK (length(trim(name)) > 0);
-- receipts: at most 5 MB each (the API allows less; this is the hard ceiling)
ALTER TABLE "ExpenseAttachment" ADD CONSTRAINT "ExpenseAttachment_size" CHECK (size > 0 AND size <= 5242880);

-- Data: one category per category name already used by expenses (first spelling found wins) ...
INSERT INTO "ExpenseCategory" ("id", "name", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), name, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON (lower(trim("category"))) trim("category") AS name
    FROM "Expense"
    WHERE length(trim("category")) > 0
    ORDER BY lower(trim("category")), "createdAt"
) used;

-- ... plus the categories the app has always offered
INSERT INTO "ExpenseCategory" ("id", "name", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), d.name, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES ('Transport'), ('Loading / Unloading'), ('Labour'), ('Rent'), ('Electricity'), ('Salary'), ('Packing material'), ('Maintenance'), ('Office'), ('Other')) AS d(name)
WHERE NOT EXISTS (SELECT 1 FROM "ExpenseCategory" c WHERE lower(c.name) = lower(d.name));

-- link existing expenses to their category (their own category text is left exactly as it was)
UPDATE "Expense" e
SET "categoryId" = c."id"
FROM "ExpenseCategory" c
WHERE e."categoryId" IS NULL AND lower(c.name) = lower(trim(e."category"));
